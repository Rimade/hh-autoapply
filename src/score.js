function parseKeywordList(raw) {
	if (!raw) return [];
	return raw
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

function scoreVacancy(item, { positive = [], negative = [] }) {
	const text = `${item.title || ''} ${item.company || ''}`.toLowerCase();
	let score = 0;

	for (const kw of positive) {
		if (text.includes(kw)) score += 10;
	}
	for (const kw of negative) {
		if (text.includes(kw)) score -= 15;
	}
	if (item.requiresTest) score -= 20;

	return score;
}

function shouldApplyByScore(item, config) {
	if (!config.scoreEnabled) return { ok: true, score: 0 };

	const score = scoreVacancy(item, {
		positive: config.positiveKeywords,
		negative: config.negativeKeywords,
	});

	if (score < config.scoreThreshold) {
		return { ok: false, score, reason: 'low_score' };
	}

	return { ok: true, score };
}

module.exports = {
	scoreVacancy,
	shouldApplyByScore,
	parseKeywordList,
};
