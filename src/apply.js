const { isLoggedIn } = require('./auth');
const {
	launchPersistentBrowser,
	closePersistentBrowser,
	isProfileInitialized,
	resolveUserDataDir,
} = require('./browser');
const { SafetyStopError, attachSafetyWatchers, assertSafePage } = require('./captcha');
const { handleResponseAfterClick } = require('./hh-response');
const {
	humanizeSearchPage,
	humanMicroPause,
	humanHoverClick,
	humanReadVacancy,
	maybeBrowseVacancy,
	maybeIdlePause,
	maybeNavigationEntropy,
} = require('./human');
const {
	openDatabase,
	migrateFromAppliedJson,
	startRun,
	finishRun,
	canApplyVacancy,
	canApplyCompany,
	checkRateLimits,
	recordVacancyResult,
	getStats,
} = require('./db');
const { shouldApplyByScore } = require('./score');
const { randomDelay } = require('./utils');

const TEST_HINT_RE = /тест|анкет|опрос|задани[ея]|вопрос/i;
const ASSESSMENT_URL_RE =
	/\/assessment\/|\/applicant\/tests\/|\/questionnaire\/|\/employer\/test|vacancy_response.*test/i;

function isAssessmentUrl(url) {
	return ASSESSMENT_URL_RE.test(url || '');
}

async function dismissOverlays(page) {
	const cookieBtn = page.locator('button:has-text("Понятно"), button:has-text("Согласен")').first();
	if (await cookieBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
		await cookieBtn.click().catch(() => {});
		await page.waitForTimeout(500);
	}
}

async function extractVacancies(page) {
	return page.locator('[data-qa="vacancy-serp__vacancy"]').evaluateAll((cards) => {
		const testHintRe = /тест|анкет|опрос|задани[ея]|вопрос/i;

		return cards.map((card) => {
			const titleLink =
				card.querySelector('[data-qa="vacancy-serp__vacancy-title"]') ||
				card.querySelector('a[data-qa="serp-item__title"]') ||
				card.querySelector('h3 a') ||
				card.querySelector('a[href*="/vacancy/"]');

			const href = titleLink?.href || '';
			const text = card.innerText || '';
			const id = card.getAttribute('data-vacancy-id') || href.match(/vacancy\/(\d+)/)?.[1] || href;
			const employer =
				card.querySelector('[data-qa="vacancy-serp__vacancy-employer"]') ||
				card.querySelector('a[data-qa="vacancy-serp__vacancy-employer"]');

			return {
				id: String(id),
				href,
				title: (titleLink?.textContent || '').trim(),
				company: (employer?.textContent || '').trim(),
				companyHref: employer?.href || '',
				snippet: text.slice(0, 600),
				requiresTest: testHintRe.test(text),
			};
		});
	});
}

function shouldPersistVacancy(result) {
	const permanent = new Set(['already_on_hh', 'requires_test', 'requires_test_hint', 'no_link']);
	return result.status === 'ok' || permanent.has(result.reason);
}

async function clickResponseButton(page) {
	const selectors = [
		'[data-qa="vacancy-response-link-top"]',
		'[data-qa="vacancy-response-button"]',
		'[data-qa="vacancy-serp__vacancy_response"]',
	];

	for (const selector of selectors) {
		const btn = page.locator(selector).first();
		if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
			const text = (await btn.innerText().catch(() => '')).toLowerCase();
			if (text.includes('откликнулись') || text.includes('отправлен')) {
				return { clicked: false, already: true };
			}
			await humanMicroPause();
			if (Math.random() < 0.55) {
				await humanHoverClick(btn);
			} else {
				await btn.scrollIntoViewIfNeeded().catch(() => {});
				await btn.click({ timeout: 10000 });
			}
			await page.waitForTimeout(1500);
			return { clicked: true, already: false };
		}
	}

	const appliedLabel = page.locator('text=/вы откликнулись|отклик отправлен/i').first();
	if (await appliedLabel.isVisible({ timeout: 1000 }).catch(() => false)) {
		return { clicked: false, already: true };
	}

	return { clicked: false, already: false };
}

async function tryApplyOnPage(page, { skipTests, coverLetter }) {
	await assertSafePage(page);

	if (isAssessmentUrl(page.url())) {
		return { status: 'skip', reason: 'requires_test' };
	}

	const pageText = await page
		.locator('body')
		.innerText()
		.catch(() => '');
	if (skipTests && TEST_HINT_RE.test(pageText.slice(0, 3000))) {
		const hasTestBlock = await page
			.locator('text=/пройдите тест|пройти тест|тестовое задание|анкета/i')
			.first()
			.isVisible({ timeout: 1500 })
			.catch(() => false);
		if (hasTestBlock) {
			return { status: 'skip', reason: 'requires_test' };
		}
	}

	const { clicked, already } = await clickResponseButton(page);
	if (already) {
		return { status: 'skip', reason: 'already_on_hh' };
	}
	if (!clicked) {
		return { status: 'skip', reason: 'no_button' };
	}

	await page.waitForTimeout(2000 + Math.floor(Math.random() * 800));

	if (isAssessmentUrl(page.url())) {
		return { status: 'skip', reason: 'requires_test' };
	}

	await assertSafePage(page);

	const submitResult = await handleResponseAfterClick(page, coverLetter);
	if (submitResult.ok) {
		return { status: 'ok', flow: submitResult.flow, reason: submitResult.flow };
	}

	if (submitResult.reason) {
		const asSkip = new Set([
			'cover_letter_required',
			'cover_letter_fill_failed',
			'letter_field_not_found',
			'submit_click_failed',
			'modal_submit_not_found',
			'inline_submit_not_found',
			'unknown_flow',
			'modal_not_submitted',
			'inline_not_submitted',
		]);
		return {
			status: asSkip.has(submitResult.reason) ? 'skip' : 'fail',
			reason: submitResult.reason,
		};
	}

	return { status: 'fail', reason: 'response_failed' };
}

async function applyVacancy(context, item, options) {
	if (!item.href) {
		return { status: 'skip', reason: 'no_link' };
	}

	const workPage = await context.newPage();

	try {
		await workPage.goto(item.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await dismissOverlays(workPage);
		await assertSafePage(workPage);
		await humanReadVacancy(workPage);
		return await tryApplyOnPage(workPage, options);
	} catch (err) {
		if (err instanceof SafetyStopError) {
			throw err;
		}
		return { status: 'fail', reason: err.message?.slice(0, 80) || 'error' };
	} finally {
		await workPage.close().catch(() => {});
	}
}

async function runAutoApply(config) {
	const {
		searchUrl,
		userDataDir,
		legacyStoragePath,
		dbPath,
		appliedDbPath,
		maxApplications,
		delayMinMs,
		delayMaxMs,
		headless,
		maxPages,
		skipTests,
		coverLetter,
		humanBrowseChance,
		humanIdleChance,
		navigationEntropyChance,
		slowMo,
		useSystemChrome,
		companyCooldownHours,
		failedRetryDays,
		dailyLimit,
		hourlyLimit,
		scoreEnabled,
		scoreThreshold,
	} = config;

	const fs = require('fs');
	const profileDir = resolveUserDataDir(userDataDir);
	const hasLegacy = legacyStoragePath && fs.existsSync(legacyStoragePath);

	if (!isProfileInitialized(profileDir) && !hasLegacy) {
		throw new Error(`Профиль не найден: ${profileDir}\nСначала выполни: npm run login`);
	}

	const db = openDatabase(dbPath);
	migrateFromAppliedJson(db, appliedDbPath);
	const run = startRun(db);
	let blocksDetected = 0;

	if (coverLetter) {
		console.log(`Сопроводительное письмо: ${coverLetter.length} символов`);
	} else {
		console.log(
			'Письмо не задано (COVER_LETTER_FILE). Вакансии с обязательным письмом будут пропущены.',
		);
	}

	console.log(`Persistent-профиль: ${profileDir}`);

	const context = await launchPersistentBrowser({
		userDataDir,
		legacyStoragePath,
		headless,
		slowMo,
		useSystemChrome: config.useSystemChrome,
	});

	attachSafetyWatchers(context);

	const pages = context.pages();
	const searchPage = pages.length > 0 ? pages[0] : await context.newPage();

	let appliedCount = 0;
	let stopRun = false;

	try {
		if (!(await isLoggedIn(searchPage))) {
			throw new Error('Сессия устарела. Запусти снова: npm run login');
		}

		for (let pageIndex = 0; pageIndex < maxPages && !stopRun; pageIndex++) {
			if (appliedCount >= maxApplications) {
				console.log(`\nЛимит откликов за сессию (${maxApplications}) достигнут.`);
				break;
			}

			const url = buildSearchPageUrl(searchUrl, pageIndex);

			console.log(`\n── Страница ${pageIndex + 1} из ${maxPages} ──`);
			console.log(url);

			const navigated = await openSearchPage(searchPage, url, pageIndex > 0);
			if (!navigated) {
				console.log('Не удалось открыть страницу выдачи.');
				break;
			}

			await assertSafePage(searchPage);
			await humanizeSearchPage(searchPage);

			const items = await extractVacancies(searchPage);

			if (items.length === 0) {
				console.log('Вакансии на странице не найдены — дальше страниц нет.');
				break;
			}

			console.log(`Найдено карточек: ${items.length}`);

			for (let i = 0; i < items.length; i++) {
				if (appliedCount >= maxApplications) {
					console.log(`  Лимит ${maxApplications} откликов — остаток страницы пропускаем.`);
					break;
				}

				const item = items[i];

				const rateCheck = checkRateLimits(db, { dailyLimit, hourlyLimit });
				if (!rateCheck.ok) {
					console.log(`  Лимит: ${rateCheck.reason}. Остановка на сегодня.`);
					stopRun = true;
					break;
				}

				const vacancyGate = canApplyVacancy(db, item.id, failedRetryDays);
				if (!vacancyGate.ok) {
					console.log(`  [${i + 1}/${items.length}] skip — ${item.id} (${vacancyGate.reason})`);
					continue;
				}

				const companyGate = canApplyCompany(db, item.company, companyCooldownHours);
				if (!companyGate.ok) {
					recordVacancyResult(db, item, { status: 'skip', reason: companyGate.reason });
					console.log(`  [${i + 1}/${items.length}] skip — ${item.id} (${companyGate.reason})`);
					continue;
				}

				const scoreGate = shouldApplyByScore(item, config);
				item.score = scoreGate.score;
				item.signals = scoreGate.signals || [];
				if (!scoreGate.ok) {
					recordVacancyResult(db, item, { status: 'skip', reason: scoreGate.reason });
					const sig = item.signals.length ? ` [${item.signals.join(', ')}]` : '';
					console.log(
						`  [${i + 1}/${items.length}] skip — ${item.id} (${scoreGate.reason}, score=${scoreGate.score})${sig}`,
					);
					continue;
				}

				if (skipTests && item.requiresTest) {
					recordVacancyResult(db, item, { status: 'skip', reason: 'requires_test_hint' });
					console.log(`  [${i + 1}/${items.length}] skip — ${item.id} (requires_test_hint)`);
					await randomDelay(300, 1200);
					continue;
				}

				await maybeNavigationEntropy(context, searchPage, item, navigationEntropyChance);

				const browsed = await maybeBrowseVacancy(context, item, humanBrowseChance);
				if (browsed) {
					console.log(`  [${i + 1}/${items.length}] browse — ${item.id} (human_behavior)`);
					await randomDelay(delayMinMs, delayMaxMs);
					continue;
				}

				let result;
				try {
					await humanMicroPause();
					result = await applyVacancy(context, item, { skipTests, coverLetter });
				} catch (err) {
					if (err instanceof SafetyStopError) {
						blocksDetected++;
						throw err;
					}
					result = { status: 'fail', reason: err.message?.slice(0, 80) || 'error' };
				}

				if (shouldPersistVacancy(result) || result.status === 'fail') {
					recordVacancyResult(db, item, result);
				}

				const reason = result.reason ? ` (${result.reason})` : '';
				const scoreTxt = item.score != null ? ` score=${item.score}` : '';
				console.log(
					`  [${i + 1}/${items.length}] ${result.status} — ${item.id}${reason}${scoreTxt}`,
				);

				if (result.status === 'ok') {
					appliedCount++;
					await randomDelay(delayMinMs, delayMaxMs);
				} else {
					await randomDelay(1000, 2800);
				}

				await maybeIdlePause(humanIdleChance);
			}

			console.log(
				`Страница ${pageIndex + 1} завершена. Откликов за сессию: ${appliedCount}/${maxApplications}`,
			);

			if (pageIndex + 1 >= maxPages) {
				break;
			}

			if (appliedCount >= maxApplications) {
				break;
			}

			const hasNext = await hasNextSearchPage(searchPage);
			if (!hasNext) {
				console.log('В выдаче больше нет страниц.');
				break;
			}

			console.log(`\n→ Переход на страницу ${pageIndex + 2}...`);
			await randomDelay(delayMinMs, delayMaxMs);
		}

		finishRun(db, run.runId, { applicationsSent: appliedCount, blocksDetected });
		const stats = getStats(db);

		console.log(`\nГотово. Новых откликов за сессию: ${appliedCount}`);
		console.log(`Всего успешных в базе: ${stats.appliedTotal}`);
		db.close();
	} finally {
		await closePersistentBrowser(context);
	}
}

function buildSearchPageUrl(searchUrl, pageIndex) {
	const u = new URL(searchUrl);
	if (pageIndex <= 0) {
		u.searchParams.delete('page');
	} else {
		u.searchParams.set('page', String(pageIndex));
	}
	return u.toString();
}

async function openSearchPage(searchPage, url, usePagerClick) {
	if (usePagerClick) {
		const clicked = await clickSearchPagerNext(searchPage);
		if (clicked) {
			return true;
		}
	}

	await searchPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
	await dismissOverlays(searchPage);
	await searchPage.waitForTimeout(1500 + Math.floor(Math.random() * 1000));
	return true;
}

async function clickSearchPagerNext(searchPage) {
	await searchPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await searchPage.waitForTimeout(1200);

	const nextBtn = searchPage.locator('[data-qa="pager-next"]').first();

	if (!(await nextBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
		return false;
	}

	const disabled = await nextBtn
		.evaluate((el) => el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'))
		.catch(() => true);

	if (disabled) {
		return false;
	}

	await humanMicroPause();
	await nextBtn.click();
	await searchPage.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
	await dismissOverlays(searchPage);
	await searchPage.waitForTimeout(1500);
	return true;
}

async function hasNextSearchPage(searchPage) {
	await searchPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await searchPage.waitForTimeout(800);

	const nextBtn = searchPage.locator('[data-qa="pager-next"]').first();
	if (!(await nextBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
		return false;
	}

	return !(await nextBtn
		.evaluate((el) => el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'))
		.catch(() => true));
}

module.exports = {
	runAutoApply,
	isAssessmentUrl,
	shouldPersistVacancy,
	TEST_HINT_RE,
};
