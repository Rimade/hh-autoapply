const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { STEALTH_INIT_SCRIPT, CHROME_USER_AGENT } = require('./stealth');
const { ensureDir } = require('./utils');

const LOCK_FILE = '.hh-autoapply.lock';
const LOCK_MAX_AGE_MS = 45 * 60 * 1000;

let activeLockPath = null;
let lockHandlersInstalled = false;

function resolveUserDataDir(dir) {
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

function isProfileInitialized(userDataDir) {
  return (
    fs.existsSync(path.join(userDataDir, 'Default')) ||
    fs.existsSync(path.join(userDataDir, 'Local State'))
  );
}

function isProcessAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) {
    return false;
  }
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function parseLockFile(content) {
  const [pid, ts] = content.trim().split(':');
  return { pid, ts: Number(ts) || 0 };
}

function installLockCleanupHandlers() {
  if (lockHandlersInstalled) {
    return;
  }
  lockHandlersInstalled = true;

  const cleanup = () => releaseProfileLock(activeLockPath);

  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  process.on('exit', cleanup);

  process.on('uncaughtException', (err) => {
    cleanup();
    console.error(err);
    process.exit(1);
  });
}

function acquireProfileLock(userDataDir) {
  const lockPath = path.join(userDataDir, LOCK_FILE);

  if (fs.existsSync(lockPath)) {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const { pid, ts } = parseLockFile(raw);
    const age = Date.now() - (ts || fs.statSync(lockPath).mtimeMs);
    const alive = isProcessAlive(pid);

    if (alive && age < LOCK_MAX_AGE_MS) {
      throw new Error(
        `Профиль занят (PID ${pid}). Закрой другой npm run login/apply или подожди ~${Math.round((LOCK_MAX_AGE_MS - age) / 60000)} мин.`
      );
    }

    fs.unlinkSync(lockPath);
    if (!alive && pid) {
      console.warn(`Снят устаревший lock (процесс ${pid} не активен).`);
    }
  }

  fs.writeFileSync(lockPath, `${process.pid}:${Date.now()}`, 'utf8');
  activeLockPath = lockPath;
  installLockCleanupHandlers();

  return lockPath;
}

function releaseProfileLock(lockPath) {
  const target = lockPath || activeLockPath;
  if (target && fs.existsSync(target)) {
    try {
      const raw = fs.readFileSync(target, 'utf8');
      const { pid } = parseLockFile(raw);
      if (String(pid) === String(process.pid)) {
        fs.unlinkSync(target);
      }
    } catch {
      // ignore
    }
  }
  if (target === activeLockPath) {
    activeLockPath = null;
  }
}

function buildPersistentOptions({ headless, slowMo, legacyStoragePath, userDataDir, useSystemChrome }) {
  const headlessOn = headless === true || headless === 'true';

  const options = {
    headless: headlessOn,
    slowMo: Number(slowMo) || 0,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    viewport: { width: 1280, height: 900 },
    userAgent: CHROME_USER_AGENT,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };

  const canMigrate =
    legacyStoragePath &&
    fs.existsSync(legacyStoragePath) &&
    !isProfileInitialized(userDataDir);

  if (canMigrate) {
    options.storageState = legacyStoragePath;
    console.log('Миграция cookies из storageState в persistent-профиль (один раз).');
  }

  if (useSystemChrome) {
    options.channel = 'chrome';
  }

  return options;
}

async function launchPersistentBrowser(config, trySystemChrome) {
  const useChrome =
    trySystemChrome ?? (config.useSystemChrome === true || config.useSystemChrome === 'true');
  const userDataDir = resolveUserDataDir(config.userDataDir);
  ensureDir(path.join(userDataDir, '.keep'));

  const lockPath = acquireProfileLock(userDataDir);

  let context;
  try {
    const options = buildPersistentOptions({
      headless: config.headless,
      slowMo: config.slowMo,
      legacyStoragePath: config.legacyStoragePath,
      userDataDir,
      useSystemChrome: useChrome,
    });

    context = await chromium.launchPersistentContext(userDataDir, options);
    await context.addInitScript(STEALTH_INIT_SCRIPT);

    context._hhLockPath = lockPath;
    context._hhUserDataDir = userDataDir;

    return context;
  } catch (err) {
    releaseProfileLock(lockPath);

    if (useChrome && /chrome|channel/i.test(err.message)) {
      console.warn('Chrome не найден, fallback на bundled Chromium.');
      return launchPersistentBrowser(config, false);
    }

    throw err;
  }
}

async function closePersistentBrowser(context) {
  const lockPath = context?._hhLockPath;
  await context?.close().catch(() => {});
  releaseProfileLock(lockPath);
}

module.exports = {
  launchPersistentBrowser,
  closePersistentBrowser,
  isProfileInitialized,
  resolveUserDataDir,
  acquireProfileLock,
  releaseProfileLock,
};
