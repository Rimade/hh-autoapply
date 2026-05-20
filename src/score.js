/** Встроенные сигналы с карточки вакансии (не только keywords из .env). */
const BUILTIN_SIGNALS = [
	{ id: 'remote', re: /удалён|удален|remote|из дома|дистанцион/i, score: 18 },
	{ id: 'hybrid', re: /гибрид|hybrid/i, score: 8 },
	{ id: 'senior', re: /\bsenior\b|ведущий|lead/i, score: 6 },
	{
		id: 'office_only',
		re: /только офис|office only|в офисе обязательно/i,
		score: -28,
		hardSkip: true,
	},
	{ id: 'relocation', re: /релокац|relocation|переезд/i, score: -22, hardSkip: true },
	{
		id: 'agency',
		re: /аутстафф|outstaff|рекрутинг|кадровое агент|аутсорс/i,
		score: -35,
		hardSkip: true,
	},
];

function parseKeywordList(raw) {
	if (!raw) return [];
	return raw
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

function scoreVacancy(item, config) {
	const text = `${item.title || ''} ${item.company || ''} ${item.snippet || ''}`.toLowerCase();
	let score = 0;
	const signals = [];

	for (const sig of BUILTIN_SIGNALS) {
		if (sig.re.test(text)) {
			score += sig.score;
			signals.push(sig.id);
			if (config.negativeDominates && sig.hardSkip) {
				return { score, signals, hardSkip: sig.id };
			}
		}
	}

	for (const kw of config.positiveKeywords) {
		if (text.includes(kw)) {
			score += 10;
			signals.push(`+${kw}`);
		}
	}

	for (const kw of config.negativeKeywords) {
		if (text.includes(kw)) {
			score -= 22;
			signals.push(`-${kw}`);
			if (config.negativeDominates) {
				return { score, signals, hardSkip: `negative:${kw}` };
			}
		}
	}

	if (item.requiresTest) {
		score -= 25;
		signals.push('requires_test');
	}

	return { score, signals, hardSkip: null };
}

function shouldApplyByScore(item, config) {
	const { score, signals, hardSkip } = scoreVacancy(item, config);

	if (!config.scoreEnabled) {
		return { ok: true, score, signals };
	}

	if (hardSkip) {
		return { ok: false, score, signals, reason: hardSkip };
	}

	if (score < config.scoreThreshold) {
		return { ok: false, score, signals, reason: 'low_score' };
	}

	return { ok: true, score, signals };
}

module.exports = {
	scoreVacancy,
	shouldApplyByScore,
	parseKeywordList,
	BUILTIN_SIGNALS,
};
