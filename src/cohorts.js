const POSITIVE = new Set(['replied', 'interview']);
const LABELED = new Set(['replied', 'ignored', 'rejected', 'interview']);

/** Фиксированные корзины score (как в heuristics ranking). */
const SCORE_BUCKETS = [
	{ label: '<0', match: (s) => s < 0 },
	{ label: '0–19', match: (s) => s >= 0 && s < 20 },
	{ label: '20–39', match: (s) => s >= 20 && s < 40 },
	{ label: '40+', match: (s) => s >= 40 },
];

function bucketScore(score) {
	if (score == null || Number.isNaN(score)) return 'unknown';
	for (const b of SCORE_BUCKETS) {
		if (b.match(score)) return b.label;
	}
	return 'unknown';
}

function weekKey(isoDate) {
	if (!isoDate) return null;
	const d = new Date(isoDate);
	if (Number.isNaN(d.getTime())) return null;
	const day = d.getUTCDay();
	const diff = day === 0 ? -6 : 1 - day;
	const monday = new Date(d);
	monday.setUTCDate(d.getUTCDate() + diff);
	return monday.toISOString().slice(0, 10);
}

function getFunnel(db) {
	const seen = db.prepare('SELECT COUNT(*) AS c FROM vacancies').get()?.c || 0;
	const applied =
		db.prepare(`SELECT COUNT(*) AS c FROM vacancies WHERE status = 'ok'`).get()?.c || 0;
	const labeled =
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM vacancies WHERE status = 'ok'
       AND outcome IS NOT NULL AND outcome NOT IN ('pending', 'skipped')`,
			)
			.get()?.c || 0;
	const positive =
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM vacancies WHERE status = 'ok' AND outcome IN ('replied', 'interview')`,
			)
			.get()?.c || 0;
	const pending =
		db
			.prepare(`SELECT COUNT(*) AS c FROM vacancies WHERE status = 'ok' AND outcome = 'pending'`)
			.get()?.c || 0;
	const failed =
		db.prepare(`SELECT COUNT(*) AS c FROM vacancies WHERE status = 'fail'`).get()?.c || 0;
	const skipped =
		db.prepare(`SELECT COUNT(*) AS c FROM vacancies WHERE status = 'skip'`).get()?.c || 0;

	return { seen, applied, labeled, positive, pending, failed, skipped };
}

function getWeeklyCohorts(db, maxWeeks = 10) {
	const rows = db
		.prepare(
			`SELECT applied_at, outcome FROM vacancies
     WHERE status = 'ok' AND applied_at IS NOT NULL
     ORDER BY applied_at ASC`,
		)
		.all();

	const byWeek = {};

	for (const row of rows) {
		const wk = weekKey(row.applied_at);
		if (!wk) continue;

		if (!byWeek[wk]) {
			byWeek[wk] = { week: wk, applied: 0, labeled: 0, positive: 0 };
		}
		byWeek[wk].applied++;
		if (LABELED.has(row.outcome)) {
			byWeek[wk].labeled++;
			if (POSITIVE.has(row.outcome)) byWeek[wk].positive++;
		}
	}

	return Object.values(byWeek)
		.sort((a, b) => b.week.localeCompare(a.week))
		.slice(0, maxWeeks)
		.reverse();
}

function getScoreBucketCohorts(db) {
	const rows = db.prepare(`SELECT score, outcome FROM vacancies WHERE status = 'ok'`).all();

	const buckets = {};
	for (const b of SCORE_BUCKETS) {
		buckets[b.label] = { label: b.label, applied: 0, labeled: 0, positive: 0 };
	}
	buckets.unknown = { label: 'unknown', applied: 0, labeled: 0, positive: 0 };

	for (const row of rows) {
		const label = bucketScore(row.score);
		const bucket = buckets[label] || buckets.unknown;
		bucket.applied++;
		if (LABELED.has(row.outcome)) {
			bucket.labeled++;
			if (POSITIVE.has(row.outcome)) bucket.positive++;
		}
	}

	return Object.values(buckets).filter((b) => b.applied > 0);
}

function pct(num, den) {
	if (!den) return '—';
	return `${Math.round((num / den) * 100)}%`;
}

function printFunnel(funnel) {
	console.log('\n── Funnel ──\n');
	console.log(`  карточек в базе (seen):     ${funnel.seen}`);
	console.log(`  успешных откликов (ok):     ${funnel.applied}`);
	console.log(
		`  размечено outcomes:         ${funnel.labeled}  (${pct(funnel.labeled, funnel.applied)} от ok)`,
	);
	console.log(
		`  positive (reply+interview): ${funnel.positive}  (${pct(funnel.positive, funnel.labeled)} от labeled)`,
	);
	console.log(`  pending разметки:           ${funnel.pending}`);
	console.log(`  skip / fail:                ${funnel.skipped} / ${funnel.failed}`);
}

function printWeeklyTrends(weeks) {
	console.log('\n── Weekly cohorts (неделя с понедельника) ──\n');

	if (!weeks.length) {
		console.log('  Нет откликов с applied_at.\n');
		return;
	}

	console.log('  week        applied  labeled  pos%   (positive / labeled)');
	for (const w of weeks) {
		const posRate = w.labeled ? pct(w.positive, w.labeled) : '—';
		console.log(
			`  ${w.week}   ${String(w.applied).padStart(5)}  ${String(w.labeled).padStart(5)}  ${posRate.padStart(5)}`,
		);
	}
}

function printScoreBuckets(buckets) {
	console.log('\n── Score buckets (decision quality по корзинам) ──\n');

	if (!buckets.length) {
		console.log('  Нет успешных откликов.\n');
		return;
	}

	console.log('  bucket   applied  labeled  pos%');
	for (const b of buckets) {
		const posRate = b.labeled ? pct(b.positive, b.labeled) : '—';
		console.log(
			`  ${b.label.padEnd(8)} ${String(b.applied).padStart(5)}  ${String(b.labeled).padStart(5)}  ${posRate.padStart(5)}`,
		);
	}
	console.log('\n  Ищи: какая корзина score даёт лучший pos% при достаточном labeled.\n');
}

function printCohortReport(db, { maxWeeks = 10 } = {}) {
	const funnel = getFunnel(db);
	const weeks = getWeeklyCohorts(db, maxWeeks);
	const buckets = getScoreBucketCohorts(db);

	printFunnel(funnel);
	printWeeklyTrends(weeks);
	printScoreBuckets(buckets);
	console.log('Cohort view — observe, не auto-score. Экспорт: npm run export\n');
}

function runCohorts(config) {
	const { openDatabase } = require('./db');
	const db = openDatabase(config.dbPath);
	printCohortReport(db, { maxWeeks: Number(config.cohortMaxWeeks || 10) });
	db.close();
}

module.exports = {
	runCohorts,
	printCohortReport,
	getFunnel,
	getWeeklyCohorts,
	getScoreBucketCohorts,
	bucketScore,
};
