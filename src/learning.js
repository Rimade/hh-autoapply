const OUTCOMES = ['replied', 'ignored', 'rejected', 'interview', 'pending'];
const LABELED_OUTCOMES = new Set(['replied', 'ignored', 'rejected', 'interview']);
const POSITIVE_OUTCOMES = new Set(['replied', 'interview']);

function parseSignals(raw) {
	try {
		const arr = JSON.parse(raw || '[]');
		return Array.isArray(arr) ? [...new Set(arr.filter(Boolean))] : [];
	} catch {
		return [];
	}
}

function pairKey(a, b) {
	return [a, b].sort().join(' + ');
}

function pairsFromSignals(signals) {
	const sorted = [...signals].sort();
	const pairs = [];
	for (let i = 0; i < sorted.length; i++) {
		for (let j = i + 1; j < sorted.length; j++) {
			pairs.push(pairKey(sorted[i], sorted[j]));
		}
	}
	return pairs;
}

function freshnessWeight(appliedAtIso, nowMs = Date.now()) {
	if (!appliedAtIso) return 1;

	const ageDays = (nowMs - new Date(appliedAtIso).getTime()) / (24 * 60 * 60 * 1000);
	if (ageDays < 30) return 1.0;
	if (ageDays < 90) return 0.7;
	if (ageDays < 180) return 0.4;
	return 0.2;
}

function computeConfidence(
	effectiveSamples,
	weightedPositiveRate,
	minSamples,
	{ rawSamples = 0, sparsityPenalty = false } = {},
) {
	if (effectiveSamples < minSamples) return null;

	const sampleFactor = Math.min(1, effectiveSamples / (minSamples * 2));
	let confidence = sampleFactor * weightedPositiveRate;

	if (sparsityPenalty && rawSamples > 0) {
		confidence *= rawSamples / (rawSamples + 2);
	}

	return Math.round(confidence * 100) / 100;
}

function latencyDays(appliedAtIso, outcomeAtIso) {
	if (!appliedAtIso || !outcomeAtIso) return null;
	const ms = new Date(outcomeAtIso).getTime() - new Date(appliedAtIso).getTime();
	if (Number.isNaN(ms) || ms < 0) return null;
	return Math.round((ms / (24 * 60 * 60 * 1000)) * 10) / 10;
}

function median(values) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getLabeledRows(db) {
	return db
		.prepare(
			`SELECT vacancy_id, title, company, score_signals, outcome, applied_at, outcome_at
     FROM vacancies
     WHERE status = 'ok'
       AND score_signals IS NOT NULL
       AND outcome IS NOT NULL
       AND outcome NOT IN ('pending', 'skipped')`,
		)
		.all();
}

function accumulateSignalStats(rows, { useDecay, getKeys }) {
	const byKey = {};

	for (const row of rows) {
		const signals = parseSignals(row.score_signals);
		const keys = getKeys(signals);
		if (!keys.length) continue;

		const w = useDecay ? freshnessWeight(row.applied_at) : 1;
		const isPositive = POSITIVE_OUTCOMES.has(row.outcome);

		for (const key of keys) {
			if (!byKey[key]) {
				byKey[key] = {
					samples: 0,
					effectiveSamples: 0,
					weightedPositive: 0,
				};
			}
			byKey[key].samples++;
			byKey[key].effectiveSamples += w;
			if (isPositive) byKey[key].weightedPositive += w;
		}
	}

	return byKey;
}

function insightsFromBuckets(byKey, minSamples, { sparsityPenalty = false } = {}) {
	const insights = [];

	for (const [key, counts] of Object.entries(byKey)) {
		if (counts.samples < minSamples) continue;

		const weightedPositiveRate =
			counts.effectiveSamples > 0 ? counts.weightedPositive / counts.effectiveSamples : 0;

		insights.push({
			key,
			samples: counts.samples,
			effectiveSamples: Math.round(counts.effectiveSamples * 10) / 10,
			positiveRate: Math.round(weightedPositiveRate * 100),
			confidence: computeConfidence(counts.effectiveSamples, weightedPositiveRate, minSamples, {
				rawSamples: counts.samples,
				sparsityPenalty,
			}),
		});
	}

	insights.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
	return insights;
}

function getSignalInsights(db, { minSamples = 5, useDecay = true } = {}) {
	const rows = getLabeledRows(db);
	const byKey = accumulateSignalStats(rows, {
		useDecay,
		getKeys: (signals) => signals,
	});

	return insightsFromBuckets(byKey, minSamples).map((row) => ({ signal: row.key, ...row }));
}

function getPairwiseInsights(db, { minSamples = 3, useDecay = true } = {}) {
	const rows = getLabeledRows(db);
	const byKey = accumulateSignalStats(rows, {
		useDecay,
		getKeys: pairsFromSignals,
	});

	return insightsFromBuckets(byKey, minSamples, { sparsityPenalty: true }).map((row) => ({
		pair: row.key,
		...row,
	}));
}

function getLatencyStats(db) {
	const rows = getLabeledRows(db);
	const byOutcome = {};
	const buckets = {
		fast_positive: 0,
		fast_reject: 0,
		slow_silence: 0,
		unknown: 0,
	};

	for (const row of rows) {
		const days = latencyDays(row.applied_at, row.outcome_at);
		if (days == null) {
			buckets.unknown++;
			continue;
		}

		if (!byOutcome[row.outcome]) byOutcome[row.outcome] = [];
		byOutcome[row.outcome].push(days);

		if (POSITIVE_OUTCOMES.has(row.outcome) && days <= 3) buckets.fast_positive++;
		if (row.outcome === 'rejected' && days <= 2) buckets.fast_reject++;
		if (row.outcome === 'ignored' && days >= 14) buckets.slow_silence++;
	}

	const summary = {};
	for (const [outcome, values] of Object.entries(byOutcome)) {
		summary[outcome] = {
			count: values.length,
			medianDays: median(values),
			minDays: Math.min(...values),
			maxDays: Math.max(...values),
		};
	}

	return { byOutcome: summary, buckets, withLatency: rows.length - buckets.unknown };
}

function getOutcomeTimeline(db, limit = 15) {
	return db
		.prepare(
			`SELECT vacancy_id, title, company, outcome, applied_at, outcome_at
     FROM vacancies
     WHERE status = 'ok'
       AND outcome IS NOT NULL
       AND outcome NOT IN ('pending', 'skipped')
     ORDER BY COALESCE(outcome_at, applied_at, '') DESC
     LIMIT ?`,
		)
		.all(limit);
}

function printSignalReport(db, opts) {
	const { minSamples = 5, useDecay = true } = opts;
	const insights = getSignalInsights(db, { minSamples, useDecay });

	console.log(`\n── Одиночные сигналы (n >= ${minSamples}) ──`);
	if (useDecay) console.log('Decay: <30д=1.0 · 30–90д=0.7 · 90–180д=0.4 · >180д=0.2');

	if (!insights.length) {
		console.log('Недостаточно данных. Сначала: npm run outcomes\n');
		return;
	}

	for (const row of insights) {
		const conf = row.confidence != null ? row.confidence.toFixed(2) : '—';
		console.log(
			`  ${row.signal.padEnd(22)} n=${String(row.samples).padStart(3)}  eff=${String(row.effectiveSamples).padStart(5)}  pos=${String(row.positiveRate).padStart(3)}%  conf=${conf}`,
		);
	}
}

function printPairwiseReport(db, opts) {
	const { pairwiseMinSamples = 3, useDecay = true } = opts;
	const insights = getPairwiseInsights(db, { minSamples: pairwiseMinSamples, useDecay });

	console.log(`\n── Пары сигналов (n >= ${pairwiseMinSamples}) ──`);
	console.log('Комбинации на одной вакансии. conf с sparsity penalty (3/3 не = 1.0)\n');

	if (!insights.length) {
		console.log('Мало парных наблюдений — нужно больше размеченных откликов с 2+ сигналами.\n');
		return;
	}

	for (const row of insights.slice(0, 12)) {
		const conf = row.confidence != null ? row.confidence.toFixed(2) : '—';
		console.log(
			`  ${row.pair.padEnd(36)} n=${String(row.samples).padStart(3)}  eff=${String(row.effectiveSamples).padStart(5)}  pos=${String(row.positiveRate).padStart(3)}%  conf=${conf}`,
		);
	}
}

function printLatencyReport(db) {
	const { byOutcome, buckets, withLatency } = getLatencyStats(db);

	console.log('\n── Outcome latency (отклик → разметка) ──');
	console.log('outcome_at ставится при npm run outcomes. Старые записи без даты — unknown.\n');

	if (!withLatency) {
		console.log('Нет записей с outcome_at. Переразмети новые исходы или подожди новых.\n');
		return;
	}

	for (const [outcome, s] of Object.entries(byOutcome)) {
		console.log(
			`  ${outcome.padEnd(10)} n=${s.count}  median=${s.medianDays}д  range=${s.minDays}–${s.maxDays}д`,
		);
	}

	console.log('\n  Эвристики (интерпретация, не правило):');
	console.log(`    быстрый positive (≤3д):     ${buckets.fast_positive}`);
	console.log(`    быстрый reject (≤2д):      ${buckets.fast_reject}  → возможный mismatch`);
	console.log(`    долгое молчание (≥14д):    ${buckets.slow_silence}  → шумный pipeline / ignore`);
	if (buckets.unknown) console.log(`    без даты latency:        ${buckets.unknown}`);
}

function printTimeline(db, limit = 12) {
	const rows = getOutcomeTimeline(db, limit);

	console.log(`\n── Timeline (последние ${limit}) ──\n`);

	if (!rows.length) {
		console.log('Пусто.\n');
		return;
	}

	for (const row of rows) {
		const days = latencyDays(row.applied_at, row.outcome_at);
		const lat = days != null ? `${days}д` : '—';
		const title = (row.title || row.vacancy_id).slice(0, 42);
		console.log(
			`  ${(row.outcome_at || '').slice(0, 10)}  ${row.outcome.padEnd(10)}  +${lat.padStart(5)}  ${title}`,
		);
	}
}

function printAnalyticsReport(db, opts = {}) {
	printSignalReport(db, opts);
	printPairwiseReport(db, opts);
	printLatencyReport(db);
	printTimeline(db, opts.timelineLimit ?? 12);
	console.log('conf = reliability estimate, не truth. Ranking не меняется автоматически.\n');
}

module.exports = {
	OUTCOMES,
	LABELED_OUTCOMES,
	parseSignals,
	freshnessWeight,
	computeConfidence,
	latencyDays,
	getSignalInsights,
	getPairwiseInsights,
	getLatencyStats,
	getOutcomeTimeline,
	printSignalReport,
	printAnalyticsReport,
};
