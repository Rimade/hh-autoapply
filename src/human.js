const { randomDelay, sleep } = require('./utils');

async function humanScroll(page) {
	await page.evaluate(() => {
		const steps = 2 + Math.floor(Math.random() * 5);
		for (let i = 0; i < steps; i++) {
			window.scrollBy(0, 180 + Math.random() * 420);
		}
	});
	await sleep(400 + Math.floor(Math.random() * 1200));
}

async function humanScrollUp(page) {
	await page.evaluate(() => {
		window.scrollBy(0, -(120 + Math.random() * 350));
	});
	await sleep(300 + Math.floor(Math.random() * 900));
}

async function humanScrollToBottom(page) {
	await page.evaluate(() => {
		const target = document.body.scrollHeight * (0.4 + Math.random() * 0.5);
		window.scrollTo({ top: target, behavior: 'smooth' });
	});
	await sleep(800 + Math.floor(Math.random() * 1500));
}

async function humanMicroPause() {
	await randomDelay(250, 900);
}

async function humanHoverClick(locator) {
	await locator.scrollIntoViewIfNeeded().catch(() => {});
	await locator.hover({ timeout: 5000 }).catch(() => {});
	await sleep(180 + Math.floor(Math.random() * 700));
	await locator.click({ timeout: 10000 });
}

async function maybeIdlePause(idleChance) {
	if (Math.random() < idleChance) {
		const sec = 20 + Math.floor(Math.random() * 21);
		console.log(`  … пауза ${sec} сек (human idle)`);
		await sleep(sec * 1000);
	}
}

async function humanReadVacancy(page) {
	await humanScroll(page);
	if (Math.random() < 0.45) {
		await humanScrollUp(page);
	}
	await randomDelay(2000, 6500);
}

async function maybeBrowseVacancy(context, item, browseChance) {
	if (!item.href || Math.random() > browseChance) {
		return false;
	}

	const page = await context.newPage();
	try {
		await page.goto(item.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await humanReadVacancy(page);
		return true;
	} catch {
		return false;
	} finally {
		await page.close().catch(() => {});
	}
}

async function humanizeSearchPage(page) {
	await humanScroll(page);
	if (Math.random() < 0.35) {
		await humanScrollToBottom(page);
	}
	if (Math.random() < 0.2) {
		await humanScrollUp(page);
	}
	if (Math.random() < 0.25) {
		const x = 120 + Math.floor(Math.random() * 700);
		const y = 80 + Math.floor(Math.random() * 500);
		await page.mouse.move(x, y).catch(() => {});
	}
	await humanMicroPause();
}

async function maybeVisitCompany(context, item) {
	if (!item.companyHref) return false;

	const page = await context.newPage();
	try {
		await page.goto(item.companyHref, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await humanReadVacancy(page);
		return true;
	} catch {
		return false;
	} finally {
		await page.close().catch(() => {});
	}
}

/**
 * Ломает линейный flow: компания / вакансия / движение мыши на выдаче.
 */
async function maybeNavigationEntropy(context, searchPage, item, chance) {
	if (Math.random() > chance) {
		return false;
	}

	const roll = Math.random();

	if (roll < 0.3 && item.companyHref) {
		await maybeVisitCompany(context, item);
		console.log('    (entropy: страница компании)');
		return true;
	}

	if (roll < 0.65) {
		await maybeBrowseVacancy(context, item, 1);
		console.log('    (entropy: просмотр вакансии)');
		return true;
	}

	await humanizeSearchPage(searchPage);
	console.log('    (entropy: пауза на выдаче)');
	return true;
}

module.exports = {
	humanScroll,
	humanScrollUp,
	humanScrollToBottom,
	humanMicroPause,
	humanHoverClick,
	maybeIdlePause,
	humanReadVacancy,
	maybeBrowseVacancy,
	maybeVisitCompany,
	maybeNavigationEntropy,
	humanizeSearchPage,
};
