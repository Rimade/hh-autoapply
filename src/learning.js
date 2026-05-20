const OUTCOMES = ['replied', 'ignored', 'rejected', 'interview', 'pending'];
const LABELED_OUTCOMES = new Set(['replied', 'ignored', 'rejected', 'interview']);

const POSITIVE_OUTCOMES = new Set(['replied', 'interview']);

/**
 * Свежесть наблюдения: старые отклики меньше влияют на выводы.
 * @param {string} [appliedAtIso]
 */
function freshnessWeight(appliedAtIso, nowMs = Date.now()) {
	if (!appliedAtIso) return 1;

	const ageDays = (nowMs - new Date(appliedAtIso).getTime()) / (24 * 60 * 60 * 1000);
	if (ageDays < 30) return 1.0;
	if (ageDays < 90) return 0.7;
	if (ageDays < 180) return 0.4;
	return 0.2;
}

/**
 * Уверенность: decay-weighted rate × насыщение выборки (не ML).
 * @param {number} effectiveSamples — сумма freshness по размеченным откликам
 * @param {number} weightedPositiveRate — 0..1
 */
function computeConfidence(effectiveSamples, weightedPositiveRate, minSamples) {
	if (effectiveSamples < minSamples) return null;

	const sampleFactor = Math.min(1, effectiveSamples / (minSamples * 2));
	const confidence = sampleFactor * weightedPositiveRate;
	return Math.round(confidence * 100) / 100;
}

function getLabeledRows(db) {
	return db
		.prepare(
			`SELECT score_signals, outcome, applied_at FROM vacancies
     WHERE status = 'ok'
       AND score_signals IS NOT NULL
       AND outcome IS NOT NULL
       AND outcome NOT IN ('pending', 'skipped')`,
		)
		.all();
}

/**
 * Корреляция score_signals с исходами (decay-weighted + confidence).
 */
function getSignalInsights(db, { minSamples = 5, useDecay = true } = {}) {
	const rows = getLabeledRows(db);
	const bySignal = {};

	for (const row of rows) {
		let signals = [];
		try {
			signals = JSON.parse(row.score_signals || '[]');
		} catch {
			continue;
		}

		const w = useDecay ? freshnessWeight(row.applied_at) : 1;
		const isPositive = POSITIVE_OUTCOMES.has(row.outcome);

		for (const sig of signals) {
			if (!bySignal[sig]) {
				bySignal[sig] = {
					samples: 0,
					effectiveSamples: 0,
					weightedPositive: 0,
					replied: 0,
					interview: 0,
					rejected: 0,
					ignored: 0,
				};
			}

			const bucket = bySignal[sig];
			bucket.samples++;
			bucket.effectiveSamples += w;
			if (isPositive) bucket.weightedPositive += w;
			if (row.outcome === 'replied') bucket.replied++;
			if (row.outcome === 'interview') bucket.interview++;
			if (row.outcome === 'rejected') bucket.rejected++;
			if (row.outcome === 'ignored') bucket.ignored++;
		}
	}

	const insights = [];

	for (const [signal, counts] of Object.entries(bySignal)) {
		if (counts.samples < minSamples) continue;

		const weightedPositiveRate =
			counts.effectiveSamples > 0 ? counts.weightedPositive / counts.effectiveSamples : 0;

		const positiveRate = Math.round(weightedPositiveRate * 100);
		const confidence = computeConfidence(counts.effectiveSamples, weightedPositiveRate, minSamples);

		insights.push({
			signal,
			samples: counts.samples,
			effectiveSamples: Math.round(counts.effectiveSamples * 10) / 10,
			positiveRate,
			weightedPositiveRate,
			confidence,
			counts,
		});
	}

	insights.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
	return insights;
}

function printSignalReport(db, { minSamples = 5, useDecay = true } = {}) {
	const insights = getSignalInsights(db, { minSamples, useDecay });

	console.log(`\nСигналы (размеченные outcomes, n >= ${minSamples}):`);
	if (useDecay) {
		console.log('Decay: <30д=1.0 · 30–90д=0.7 · 90–180д=0.4 · >180д=0.2\n');
	} else {
		console.log('');
	}

	if (!insights.length) {
		console.log('Недостаточно данных. Сначала: npm run outcomes');
		return;
	}

	for (const row of insights) {
		const conf = row.confidence != null ? row.confidence.toFixed(2) : '—';
		console.log(
			`  ${row.signal.padEnd(18)} n=${String(row.samples).padStart(3)}  eff=${String(row.effectiveSamples).padStart(5)}  pos=${String(row.positiveRate).padStart(3)}%  conf=${conf}`,
		);
	}

	console.log(
		'\nconf = decay-weighted positive rate × sample saturation. Подсказка, не автоправило.\n',
	);
}

module.exports = {
	OUTCOMES,
	LABELED_OUTCOMES,
	freshnessWeight,
	computeConfidence,
	getSignalInsights,
	printSignalReport,
};
