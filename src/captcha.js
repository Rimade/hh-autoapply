class SafetyStopError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'SafetyStopError';
    this.reason = reason;
  }
}

const BLOCK_TEXT_PATTERNS = [
  /подтвердите,?\s*что вы не робот/i,
  /подтвердите,?\s*что вы человек/i,
  /проверка,?\s*что вы не робот/i,
  /проверка безопасности/i,
  /security check/i,
  /unusual activity/i,
  /подозрительн(ая|ой) активност/i,
  /введите символы/i,
  /слишком много запросов/i,
  /доступ ограничен/i,
  /доступ временно ограничен/i,
  /access denied/i,
  /ваш аккаунт заблокирован/i,
  /robot/i,
  /verify/i,
  /captcha/i,
  /hcaptcha/i,
  /recaptcha/i,
];

const BLOCK_URL_PATTERNS =
  /captcha|challenge|blocked|robot|hcaptcha|recaptcha|security|verify|access.denied/i;

const HH_HOST_RE = /hh\.ru|hhcdn\.ru|headhunter\.ru/i;

function attachSafetyWatchers(context) {
  context._hhBlockedHttp = false;
  context._hhBlockStatus = null;

  context.on('response', (response) => {
    const url = response.url();
    if (!HH_HOST_RE.test(url)) {
      return;
    }

    const status = response.status();
    if (status === 403 || status === 429 || status === 503) {
      context._hhBlockedHttp = true;
      context._hhBlockStatus = status;
    }
  });
}

function assertNoHttpBlock(context) {
  if (context._hhBlockedHttp) {
    throw new SafetyStopError(
      'http_block',
      `HH вернул HTTP ${context._hhBlockStatus} (403/429/503). Остановка. Подожди и зайди вручную: npm run login`
    );
  }
}

async function assertSafePage(page) {
  const context = page.context();
  assertNoHttpBlock(context);

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

  if (/search\/vacancy/i.test(url)) {
    const suspiciousEmpty = await page
      .locator('text=/подозрительн|проверьте подключение|ошибка загрузки/i')
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false);

    if (suspiciousEmpty) {
      throw new SafetyStopError(
        'soft_block',
        'Подозрительная пустая выдача HH. Остановка для проверки аккаунта.'
      );
    }
  }
}

module.exports = {
  SafetyStopError,
  attachSafetyWatchers,
  assertSafePage,
  assertNoHttpBlock,
};
