class SafetyStopError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'SafetyStopError';
    this.reason = reason;
  }
}

const BLOCK_TEXT_PATTERNS = [
  /подтвердите,?\s*что вы не робот/i,
  /проверка,?\s*что вы не робот/i,
  /введите символы/i,
  /слишком много запросов/i,
  /доступ ограничен/i,
  /доступ временно ограничен/i,
  /ваш аккаунт заблокирован/i,
  /captcha/i,
  /hcaptcha/i,
  /recaptcha/i,
];

const BLOCK_URL_PATTERNS = /captcha|challenge|blocked|robot|hcaptcha|recaptcha/i;

async function assertSafePage(page) {
  const url = page.url() || '';
  if (BLOCK_URL_PATTERNS.test(url)) {
    throw new SafetyStopError(
      'captcha_or_block',
      `Обнаружена защита HH в URL. Зайди вручную через npm run login. URL: ${url}`
    );
  }

  const captchaFrame = page.locator(
    'iframe[src*="captcha"], iframe[src*="hcaptcha"], iframe[src*="recaptcha"]'
  );
  if (await captchaFrame.first().isVisible({ timeout: 500 }).catch(() => false)) {
    throw new SafetyStopError(
      'captcha',
      'На странице iframe-капча. Остановка. Пройди проверку вручную: npm run login'
    );
  }

  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

  for (const pattern of BLOCK_TEXT_PATTERNS) {
    if (pattern.test(bodyText)) {
      throw new SafetyStopError(
        'captcha_or_block',
        'HH просит проверку или ограничил доступ. Остановка. Зайди вручную: npm run login'
      );
    }
  }

}

module.exports = {
  SafetyStopError,
  assertSafePage,
};
