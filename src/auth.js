const readline = require('readline');
const { launchPersistentBrowser, closePersistentBrowser, isProfileInitialized, resolveUserDataDir } = require('./browser');
const { assertSafePage } = require('./captcha');

const HH_HOME = 'https://hh.ru/';

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

async function isLoggedIn(page) {
  await page.goto(HH_HOME, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await assertSafePage(page).catch((err) => {
    if (err.name === 'SafetyStopError') throw err;
  });

  const accountLink = page.locator('[data-qa="mainmenu_applicantProfile"]').first();
  if (await accountLink.isVisible().catch(() => false)) {
    return true;
  }

  const loginBtn = page.locator('[data-qa="login"]').first();
  return !(await loginBtn.isVisible().catch(() => false));
}

async function loginInteractive(config) {
  const userDataDir = resolveUserDataDir(config.userDataDir);

  console.log(`Persistent-профиль: ${userDataDir}`);
  if (!isProfileInitialized(userDataDir) && config.legacyStoragePath) {
    console.log('Старые cookies будут импортированы при первом запуске (если файл есть).');
  }

  const context = await launchPersistentBrowser({
    ...config,
    headless: false,
    slowMo: 50,
  });

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  console.log('\nВойди на hh.ru вручную (телефон, почта, OAuth).');
  console.log('Когда увидишь профиль — нажми Enter в терминале.\n');

  await page.goto(`${HH_HOME}account/login`, { waitUntil: 'domcontentloaded' });

  await waitForEnter();

  try {
    if (!(await isLoggedIn(page))) {
      throw new Error('Похоже, вход не выполнен. Попробуй снова: npm run login');
    }

    console.log('Сессия сохранена в persistent-профиле.');
    console.log('Готово. Можно запускать: npm run apply');
  } finally {
    await closePersistentBrowser(context);
  }
}

module.exports = {
  isLoggedIn,
  loginInteractive,
  HH_HOME,
};
