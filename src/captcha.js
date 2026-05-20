const { sleep } = require('./utils');

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
const SOFT_503_TYPES = new Set(['document', 'fetch', 'xhr']);

function isMainHhHost(url) {
	try {
		return (
			/(^|\.)hh\.ru$/i.test(new URL(url).hostname) ||
			/(^|\.)headhunter\.ru$/i.test(new URL(url).hostname)
		);
	} catch {
		return false;
	}
}

function initHttpSafetyState(context) {
	context._hhBlockHard = false;
	context._hhBlockStatus = null;
	context._hh503Count = 0;
	context._hh503WindowStart = 0;
	context._hh503RecoveryUsed = false;
	context._hhSafety = {
		wait503Ms: 90_000,
		soft503WindowMs: 120_000,
		max503InWindow: 2,
	};
}

function attachSafetyWatchers(context, options = {}) {
	initHttpSafetyState(context);
	context._hhSafety.wait503Ms = Number(options.wait503Ms || 90_000);
	context._hhSafety.soft503WindowMs = Number(options.soft503WindowMs || 120_000);
	context._hhSafety.max503InWindow = Number(options.max503InWindow || 2);

	context.on('response', (response) => {
		const url = response.url();
		if (!HH_HOST_RE.test(url)) return;

		const status = response.status();
		if (status === 403 || status === 429) {
			context._hhBlockHard = true;
			context._hhBlockStatus = status;
			return;
		}

		if (status !== 503) return;

		const type = response.request().resourceType();
		if (!SOFT_503_TYPES.has(type)) return;

		// hhcdn/статика часто даёт ложный 503 — только основной домен hh.ru
		if (!isMainHhHost(url)) return;

		const now = Date.now();
		if (now - context._hh503WindowStart > context._hhSafety.soft503WindowMs) {
			context._hh503Count = 0;
			context._hh503WindowStart = now;
		}
		if (!context._hh503WindowStart) context._hh503WindowStart = now;
		context._hh503Count++;
		context._hhBlockStatus = 503;
	});
}

function clearSoft503(context) {
	context._hh503Count = 0;
	context._hh503WindowStart = 0;
	context._hhBlockStatus = null;
}

async function resolveHttpBlock(context) {
	if (context._hhBlockHard) {
		throw new SafetyStopError(
			'http_block',
			`HH вернул HTTP ${context._hhBlockStatus}. Остановка. Подожди 1–2 ч, затем: npm run login`,
		);
	}

	if (context._hh503Count < 1) return;

	const { wait503Ms, max503InWindow } = context._hhSafety;

	if (context._hh503Count >= max503InWindow) {
		throw new SafetyStopError(
			'http_block',
			`HH несколько раз вернул 503 за короткий период. Остановка. Подожди 1–2 ч, npm run login`,
		);
	}

	if (!context._hh503RecoveryUsed) {
		const sec = Math.round(wait503Ms / 1000);
		console.log(`\n  ⏸ HH 503 — пауза ${sec} сек, одна попытка продолжить (anti-block)…`);
		context._hh503RecoveryUsed = true;
		clearSoft503(context);
		await sleep(wait503Ms);
		return;
	}

	throw new SafetyStopError(
		'http_block',
		'HH 503 после паузы. Остановка. Подожди 1–2 ч и: npm run login',
	);
}

async function assertSafePage(page) {
	const context = page.context();
	await resolveHttpBlock(context);

	const url = page.url() || '';
	if (BLOCK_URL_PATTERNS.test(url)) {
		throw new SafetyStopError(
			'captcha_or_block',
			`Обнаружена защита HH в URL. Зайди вручную через npm run login. URL: ${url}`,
		);
	}

	const captchaFrame = page.locator(
		'iframe[src*="captcha"], iframe[src*="hcaptcha"], iframe[src*="recaptcha"]',
	);
	if (
		await captchaFrame
			.first()
			.isVisible({ timeout: 500 })
			.catch(() => false)
	) {
		throw new SafetyStopError(
			'captcha',
			'На странице iframe-капча. Остановка. Пройди проверку вручную: npm run login',
		);
	}

	const bodyText = await page
		.locator('body')
		.innerText({ timeout: 5000 })
		.catch(() => '');

	for (const pattern of BLOCK_TEXT_PATTERNS) {
		if (pattern.test(bodyText)) {
			throw new SafetyStopError(
				'captcha_or_block',
				'HH просит проверку или ограничил доступ. Остановка. Зайди вручную: npm run login',
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
				'Подозрительная пустая выдача HH. Остановка для проверки аккаунта.',
			);
		}
	}

	clearSoft503(context);
}

function assertNoHttpBlock(context) {
	return resolveHttpBlock(context);
}

module.exports = {
	SafetyStopError,
	attachSafetyWatchers,
	assertSafePage,
	assertNoHttpBlock,
};
