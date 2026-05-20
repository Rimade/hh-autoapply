/** Скрипт в каждую страницу — снижает типичные признаки automation. */
const STEALTH_INIT_SCRIPT = () => {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });

  if (!window.chrome) {
    window.chrome = { runtime: {} };
  }

  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
    configurable: true,
  });

  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
    configurable: true,
  });

  Object.defineProperty(navigator, 'languages', {
    get: () => ['ru-RU', 'ru', 'en-US', 'en'],
    configurable: true,
  });

  const originalQuery = window.navigator.permissions?.query;
  if (originalQuery) {
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  }
};

const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

module.exports = {
  STEALTH_INIT_SCRIPT,
  CHROME_USER_AGENT,
};
