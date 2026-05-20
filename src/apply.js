const { chromium } = require('playwright');
const { isLoggedIn } = require('./auth');
const { handleResponseAfterClick } = require('./hh-response');
const { randomDelay, loadJson, saveJson } = require('./utils');

const TEST_HINT_RE = /тест|анкет|опрос|задани[ея]|вопрос/i;
const ASSESSMENT_URL_RE = /\/assessment\/|\/applicant\/tests\/|\/questionnaire\/|\/employer\/test|vacancy_response.*test/i;

async function createContext(browser, storagePath) {
  if (!require('fs').existsSync(storagePath)) {
    throw new Error(
      `Нет файла сессии: ${storagePath}\nСначала выполни: npm run login`
    );
  }

  return browser.newContext({
    storageState: storagePath,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    viewport: { width: 1280, height: 900 },
  });
}

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
      const id =
        card.getAttribute('data-vacancy-id') ||
        href.match(/vacancy\/(\d+)/)?.[1] ||
        href;

      return {
        id: String(id),
        href,
        requiresTest: testHintRe.test(text),
      };
    });
  });
}

function shouldPersistVacancy(result) {
  const permanent = new Set([
    'already_on_hh',
    'requires_test',
    'requires_test_hint',
    'no_link',
  ]);
  return result.status === 'ok' || permanent.has(result.reason);
}

async function clickResponseButton(page) {
  const selectors = [
    '[data-qa="vacancy-response-link-top"]',
    '[data-qa="vacancy-response-button"]',
    '[data-qa="vacancy-serp__vacancy_response"]',
    '[data-qa="vacancy-response-link-top"]',
  ];

  for (const selector of selectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      const text = (await btn.innerText().catch(() => '')).toLowerCase();
      if (text.includes('откликнулись') || text.includes('отправлен')) {
        return { clicked: false, already: true };
      }
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ timeout: 10000 });
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
  if (isAssessmentUrl(page.url())) {
    return { status: 'skip', reason: 'requires_test' };
  }

  const pageText = await page.locator('body').innerText().catch(() => '');
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

  await page.waitForTimeout(2500);

  if (isAssessmentUrl(page.url())) {
    return { status: 'skip', reason: 'requires_test' };
  }

  const submitResult = await handleResponseAfterClick(page, coverLetter);
  if (submitResult.ok) {
    const flow = submitResult.flow ? ` (${submitResult.flow})` : '';
    return { status: 'ok', reason: submitResult.flow || undefined };
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
      'unknown_flow',
    ]);
    return {
      status: asSkip.has(submitResult.reason) ? 'skip' : 'fail',
      reason: submitResult.reason,
    };
  }

  if (isAssessmentUrl(page.url())) {
    return { status: 'skip', reason: 'requires_test' };
  }

  return { status: 'fail', reason: 'response_failed' };
}

async function applyVacancy(context, item, { skipTests, coverLetter }) {
  if (!item.href) {
    return { status: 'skip', reason: 'no_link' };
  }

  const workPage = await context.newPage();

  try {
    await workPage.goto(item.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissOverlays(workPage);
    return await tryApplyOnPage(workPage, { skipTests, coverLetter });
  } catch (err) {
    return { status: 'fail', reason: err.message?.slice(0, 80) || 'error' };
  } finally {
    await workPage.close().catch(() => {});
  }
}

async function runAutoApply(config) {
  const {
    searchUrl,
    storagePath,
    appliedDbPath,
    maxApplications,
    delayMinMs,
    delayMaxMs,
    headless,
    maxPages,
    skipTests,
    coverLetter,
  } = config;

  const appliedDb = loadJson(appliedDbPath, { ids: [] });
  const appliedIds = new Set(appliedDb.ids);

  if (coverLetter) {
    console.log(`Сопроводительное письмо: ${coverLetter.length} символов`);
  } else {
    console.log(
      'Письмо не задано (COVER_LETTER_FILE). Вакансии с обязательным письмом будут пропущены.'
    );
  }

  const browser = await chromium.launch({
    headless: headless === 'true',
    slowMo: 30,
  });

  const context = await createContext(browser, storagePath);
  const searchPage = await context.newPage();

  if (!(await isLoggedIn(searchPage))) {
    await browser.close();
    throw new Error('Сессия устарела. Запусти снова: npm run login');
  }

  let appliedCount = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
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

      if (appliedIds.has(item.id)) {
        console.log(`  [${i + 1}/${items.length}] skip — ${item.id} (already_applied)`);
        continue;
      }

      if (skipTests && item.requiresTest) {
        appliedIds.add(item.id);
        console.log(`  [${i + 1}/${items.length}] skip — ${item.id} (requires_test_hint)`);
        await randomDelay(300, 800);
        continue;
      }

      let result;
      try {
        result = await applyVacancy(context, item, { skipTests, coverLetter });
      } catch (err) {
        result = { status: 'fail', reason: err.message?.slice(0, 80) || 'error' };
      }

      if (shouldPersistVacancy(result)) {
        appliedIds.add(item.id);
      }

      const reason = result.reason ? ` (${result.reason})` : '';
      console.log(`  [${i + 1}/${items.length}] ${result.status} — ${item.id}${reason}`);

      if (result.status === 'ok') {
        appliedCount++;
        await randomDelay(delayMinMs, delayMaxMs);
      } else {
        await randomDelay(800, 2000);
      }
    }

    console.log(
      `Страница ${pageIndex + 1} завершена. Откликов за сессию: ${appliedCount}/${maxApplications}`
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

  saveJson(appliedDbPath, { ids: [...appliedIds], updatedAt: new Date().toISOString() });

  console.log(`\nГотово. Новых откликов за сессию: ${appliedCount}`);
  console.log(`Всего в базе: ${appliedIds.size}`);

  await context.close();
  await browser.close();
}

/** HH: первая страница без page, вторая page=1, третья page=2 (нумерация с 0) */
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
  await searchPage.waitForTimeout(2000);
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

  await nextBtn.click();
  await searchPage.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await dismissOverlays(searchPage);
  await searchPage.waitForTimeout(2000);
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
