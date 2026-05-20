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

/**
 * Иногда только смотрит вакансию без отклика — ломает одинаковый паттерн «клик-отклик».
 */
async function maybeBrowseVacancy(context, item, browseChance) {
  if (!item.href || Math.random() > browseChance) {
    return false;
  }

  const page = await context.newPage();
  try {
    await page.goto(item.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await humanScroll(page);
    await randomDelay(2500, 7000);
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
  await humanMicroPause();
}

module.exports = {
  humanScroll,
  humanScrollToBottom,
  humanMicroPause,
  maybeBrowseVacancy,
  humanizeSearchPage,
};
