/** Inline init script с фиксированными значениями из profile meta (без рандома на каждый запуск). */
function getStealthScript(meta) {
	const hwCores = meta.hardwareConcurrency;
	const deviceMem = meta.deviceMemory;

	return `(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
  if (!window.chrome) window.chrome = { runtime: {} };
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${hwCores}, configurable: true });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => ${deviceMem}, configurable: true });
  Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en-US', 'en'], configurable: true });
  const q = window.navigator.permissions?.query;
  if (q) window.navigator.permissions.query = (p) => p.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission }) : q(p);
})();`;
}

const CHROME_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

module.exports = {
	getStealthScript,
	CHROME_USER_AGENT,
};
