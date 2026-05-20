const OUTCOMES = ['replied', 'ignored', 'rejected', 'interview', 'pending'];

/**
 * Корреляция score_signals с исходами. Только при n >= minSamples.
 */
function getSignalInsights(db, { minSamples = 5 } = {}) {
	const rows = db
		.prepare(
			`SELECT score_signals, outcome FROM vacancies
     WHERE status = 'ok' AND score_signals IS NOT NULL AND outcome IS NOT NULL`,
		)
		.all();

	const bySignal = {};

	for (const row of rows) {
	let signals = [];
	try {
		signals = JSON.parse(row.score_signals || '[]');
	} catch {
		continue;
	}

		for (const sig of signals) {
			if (!bySignal[sig]) {
				bySignal[sig] = { total: 0, replied: 0, interview: 0, rejected: 0, ignored: 0 };
			}
			bySignal[sig].total++;
			if (row.outcome === 'replied') bySignal[sig].replied++;
			if (row.outcome === 'interview') bySignal[sig].interview++;
			if (row.outcome === 'rejected') bySignal[sig].rejected++;
			if (row.outcome === 'ignored') bySignal[sig].ignored++;
		}
	}

	const insights = [];

	for (const [signal, counts] of Object.entries(bySignal)) {
		if (counts.total < minSamples) continue;

		const positive = counts.replied + counts.interview;
		const rate = Math.round((positive / counts.total) * 100);

		insights.push({
			signal,
			samples: counts.total,
			positiveRate: rate,
			counts,
		});
	}

	insights.sort((a, b) => b.positiveRate - a.positiveRate);
	return insights;
}

function printSignalReport(db, { minSamples = 5 } = {}) {
	const insights = getSignalInsights(db, { minSamples });

	console.log(`\nСигналы с n >= ${minSamples} (outcome ground truth):\n`);

	if (!insights.length) {
		console.log('Недостаточно размеченных откликов. Запусти: npm run outcomes');
		return;
	}

	for (const row of insights) {
		console.log(
			`  ${row.signal.padEnd(20)} n=${row.samples}  positive=${row.positiveRate}%  (replied+interview / total)`,
		);
	}

	console.log(
		'\nНе переобучайся на малой выборке — используй как подсказку, не как жёсткое правило.\n',
	);
}

module.exports = {
	getSignalInsights,
	printSignalReport,
	OUTCOMES,
};
