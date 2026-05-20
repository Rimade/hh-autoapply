const readline = require('readline');
const { openDatabase, setVacancyOutcome, getStats } = require('./db');
const { printAnalyticsReport } = require('./learning');

const OUTCOME_MAP = {
	1: 'replied',
	2: 'ignored',
	3: 'rejected',
	4: 'interview',
	s: 'skipped',
};

function listForReview(db, limit = 25) {
	return db
		.prepare(
			`SELECT vacancy_id, title, company, url, applied_at, outcome
     FROM vacancies
     WHERE status = 'ok' AND (outcome IS NULL OR outcome = 'pending' OR outcome = 'skipped')
     ORDER BY applied_at DESC
     LIMIT ?`,
		)
		.all(limit);
}

function printOutcomeSummary(db) {
	const rows = db
		.prepare(`SELECT outcome, COUNT(*) AS c FROM vacancies WHERE status = 'ok' GROUP BY outcome`)
		.all();

	console.log('\nИсходы откликов:');
	for (const row of rows) {
		console.log(`  ${(row.outcome || 'null').padEnd(12)} ${row.c}`);
	}
}

async function runOutcomesCli(config) {
	const db = openDatabase(config.dbPath);
	const limit = Number(config.outcomesBatchSize || 25);

	let items = listForReview(db, limit);

	if (!items.length) {
		console.log('Нет откликов для разметки (все уже размечены или база пуста).');
		printOutcomeSummary(db);
		const stats = getStats(db);
		console.log(`Всего успешных откликов: ${stats.appliedTotal}`);
		db.close();
		return;
	}

	console.log('\n── Разметка исходов откликов ──');
	console.log('Коды: [1] replied  [2] ignored  [3] rejected  [4] interview  [s] skip  [q] выход\n');

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const ask = (q) =>
		new Promise((resolve) => {
			rl.question(q, resolve);
		});

	let idx = 0;
	let marked = 0;

	while (idx < items.length) {
		const v = items[idx];
		console.log(`\n[${idx + 1}/${items.length}] ${v.vacancy_id}`);
		console.log(`  ${v.title || '—'} @ ${v.company || '—'}`);
		console.log(`  отклик: ${v.applied_at || '—'}`);
		if (v.url) console.log(`  ${v.url}`);

		const answer = (await ask('  Исход (1/2/3/4/s/q): ')).trim().toLowerCase();

		if (answer === 'q') {
			break;
		}

		if (answer === 's') {
			setVacancyOutcome(db, v.vacancy_id, 'skipped');
			idx++;
			continue;
		}

		const outcome = OUTCOME_MAP[answer];
		if (!outcome || outcome === 'skipped') {
			console.log('  Неизвестный код, попробуй снова.');
			continue;
		}

		setVacancyOutcome(db, v.vacancy_id, outcome);
		console.log(`  → ${outcome}`);
		marked++;
		idx++;
	}

	rl.close();

	console.log(`\nРазмечено: ${marked}`);
	printOutcomeSummary(db);
	db.close();
}

function runStats(config) {
	const db = openDatabase(config.dbPath);
	const stats = getStats(db);

	console.log(`Успешных откликов: ${stats.appliedTotal}`);
	console.log(`С ответом (replied): ${stats.repliedTotal}`);

	printAnalyticsReport(db, {
		minSamples: Number(config.learningMinSamples || 5),
		pairwiseMinSamples: Number(config.pairwiseMinSamples || 3),
		useDecay: config.learningDecay !== false,
		timelineLimit: Number(config.timelineLimit || 12),
	});
	db.close();
}

module.exports = {
	runOutcomesCli,
	runStats,
};
