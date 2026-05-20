const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');
const { ensureDir } = require('./utils');

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

const HH_HOME = 'https://hh.ru/';

async function isLoggedIn(page) {
  await page.goto(HH_HOME, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const accountLink = page.locator('[data-qa="mainmenu_applicantProfile"]').first();
  if (await accountLink.isVisible().catch(() => false)) {
    return true;
  }

  const loginBtn = page.locator('[data-qa="login"]').first();
  return !(await loginBtn.isVisible().catch(() => false));
}

async function loginInteractive({ storagePath, headless }) {
  ensureDir(storagePath);

  const browser = await chromium.launch({
    headless: headless === 'true',
    slowMo: 50,
  });

  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  console.log('Открой браузер и войди на hh.ru вручную (телефон, почта, OAuth).');
  console.log('Когда увидишь свой профиль — нажми Enter в этом терминале.\n');

  await page.goto(`${HH_HOME}account/login`, { waitUntil: 'domcontentloaded' });

  await waitForEnter();

  if (!(await isLoggedIn(page))) {
    await context.close();
    await browser.close();
    throw new Error('Похоже, вход не выполнен. Попробуй снова: npm run login');
  }

  await context.storageState({ path: storagePath });
  console.log(`Сессия сохранена: ${path.resolve(storagePath)}`);

  await context.close();
  await browser.close();
  console.log('Готово. Можно запускать: npm run apply');
}

module.exports = {
  isLoggedIn,
  loginInteractive,
  HH_HOME,
};
