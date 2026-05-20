const { openDatabase } = require('./db');
const { parseSignals } = require('./learning');
const { WEEKDAYS } = require('./diversity');

const POSITIVE = new Set(['replied', 'interview']);
const LABELED = new Set(['replied', 'ignored', 'rejected', 'interview']);

function pct(num, den) {
	if (!den) return '—';
	return `${Math.round((num / den) * 100)}%`;
}

function getExposureStats(db) {
	const rows = db
		.prepare(
			`SELECT applied_at, outcome FROM vacancies
     WHERE status = 'ok' AND applied_at IS NOT NULL
     ORDER BY applied_at ASC`,
		)
		.all();

	let firstPositiveIndex = -1;
	const byWeekday = {};
	const byHour = {};

	for (const wd of WEEKDAYS) {
		byWeekday[wd] = { applied: 0, labeled: 0, positive: 0 };
	}

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const d = new Date(row.applied_at);
		if (Number.isNaN(d.getTime())) continue;

		const wd = WEEKDAYS[d.getDay()];
		const hr = d.getHours();

		if (!byHour[hr]) byHour[hr] = { applied: 0, labeled: 0, positive: 0 };

		byWeekday[wd].applied++;
		byHour[hr].applied++;

		if (LABELED.has(row.outcome)) {
			byWeekday[wd].labeled++;
			byHour[hr].labeled++;
		}
		if (POSITIVE.has(row.outcome)) {
			if (firstPositiveIndex < 0) firstPositiveIndex = i;
			byWeekday[wd].positive++;
			byHour[hr].positive++;
		}
	}

	return {
		totalApplied: rows.length,
		appsBeforeFirstPositive: firstPositiveIndex >= 0 ? firstPositiveIndex : null,
		byWeekday,
		byHour,
	};
}

function getSaturationStats(db, windowDays = 14) {
	const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

	const repeatSeen = db
		.prepare(
			`SELECT company, COUNT(*) AS c FROM vacancies
     WHERE company IS NOT NULL AND TRIM(company) != '' AND last_seen_at >= ?
     GROUP BY company HAVING c >= 3
     ORDER BY c DESC
     LIMIT 12`,
		)
		.all(since);

	const multiApply = db
		.prepare(
			`SELECT company, COUNT(*) AS c FROM vacancies
     WHERE status = 'ok' AND applied_at >= ? AND company IS NOT NULL AND TRIM(company) != ''
     GROUP BY company HAVING c >= 2
     ORDER BY c DESC
     LIMIT 12`,
		)
		.all(since);

	const signalRows = db
		.prepare(
			`SELECT score_signals FROM vacancies WHERE status = 'ok' AND applied_at >= ? AND score_signals IS NOT NULL`,
		)
		.all(since);

	const signalCounts = {};
	let applyCount = 0;

	for (const row of signalRows) {
		applyCount++;
		for (const sig of parseSignals(row.score_signals)) {
			signalCounts[sig] = (signalCounts[sig] || 0) + 1;
		}
	}

	const topSignals = Object.entries(signalCounts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([signal, count]) => ({
			signal,
			count,
			share: applyCount ? Math.round((count / applyCount) * 100) : 0,
		}));

	return { repeatSeen, multiApply, topSignals, applyCount, windowDays };
}

function printExposure(exposure) {
	console.log('\n── Exposure (timing & первый positive) ──\n');
	console.log(`  всего откликов (ok): ${exposure.totalApplied}`);

	if (exposure.appsBeforeFirstPositive != null) {
		console.log(
			`  откликов до первого positive: ${exposure.appsBeforeFirstPositive}  (по порядку applied_at)`,
		);
	} else {
		console.log('  первого positive ещё нет в разметке');
	}

	console.log('\n  День недели (локальное время машины): applied / pos% среди labeled');
	for (const wd of WEEKDAYS) {
		const b = exposure.byWeekday[wd];
		if (!b.applied) continue;
		console.log(
			`    ${wd}   applied=${String(b.applied).padStart(3)}  pos=${pct(b.positive, b.labeled).padStart(4)}`,
		);
	}

	console.log('\n  Час суток: applied / pos% (только часы с откликами)');
	const hours = Object.keys(exposure.byHour)
		.map(Number)
		.sort((a, b) => a - b);

	for (const hr of hours) {
		const b = exposure.byHour[hr];
		console.log(
			`    ${String(hr).padStart(2)}:00  applied=${String(b.applied).padStart(3)}  pos=${pct(b.positive, b.labeled).padStart(4)}`,
		);
	}
}

function printSaturation(sat) {
	console.log(`\n── Saturation (окно ${sat.windowDays} дней) ──\n`);

	if (!sat.repeatSeen.length && !sat.multiApply.length && !sat.topSignals.length) {
		console.log('  Мало данных. Нужны отклики и просмотры вакансий.\n');
		return;
	}

	if (sat.repeatSeen.length) {
		console.log('  Компании часто в выдаче (seen ≥3):');
		for (const r of sat.repeatSeen) {
			console.log(`    ${r.company.slice(0, 40).padEnd(42)} seen×${r.c}`);
		}
	}

	if (sat.multiApply.length) {
		console.log('\n  Несколько откликов в одну компанию (ok ≥2):');
		for (const r of sat.multiApply) {
			console.log(`    ${r.company.slice(0, 40).padEnd(42)} apply×${r.c}`);
		}
	}

	if (sat.topSignals.length) {
		console.log(`\n  Доминирующие сигналы в откликах (n=${sat.applyCount}):`);
		for (const s of sat.topSignals) {
			console.log(`    ${s.signal.padEnd(20)} ${s.count}×  (~${s.share}% строк)`);
		}
	}

	console.log('\n  Узкий ranking → monoculture. Diversity guard в apply: MAX_*_PER_DAY.\n');
}

function printInsightsReport(db, opts = {}) {
	printExposure(getExposureStats(db));
	printSaturation(getSaturationStats(db, opts.saturationWindowDays ?? 14));
	console.log('insights — observe. Порядок: cohorts → insights → stats → export\n');
}

function runInsights(config) {
	const db = openDatabase(config.dbPath);
	printInsightsReport(db, {
		saturationWindowDays: Number(config.saturationWindowDays || 14),
	});
	db.close();
}

module.exports = {
	runInsights,
	getExposureStats,
	getSaturationStats,
};
