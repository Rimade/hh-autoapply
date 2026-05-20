const fs = require('fs');
const path = require('path');
const { openDatabase } = require('./db');
const { ensureDir } = require('./utils');
const { latencyDays } = require('./learning');

function escapeCsv(value) {
	const s = String(value ?? '');
	if (/[",\n\r]/.test(s)) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

function formatSignals(raw) {
	if (!raw) return '';
	try {
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? arr.join(';') : raw;
	} catch {
		return raw;
	}
}

function listVacanciesForExport(db) {
	return db
		.prepare(
			`SELECT vacancy_id, title, company, applied_at, last_seen_at, outcome, outcome_at,
              score, score_signals, response_type, url, fail_reason, status
       FROM vacancies
       ORDER BY COALESCE(applied_at, last_seen_at, '') DESC`,
		)
		.all();
}

const CSV_HEADERS = [
	'vacancy_id',
	'title',
	'company',
	'applied_at',
	'last_seen_at',
	'status',
	'outcome',
	'outcome_at',
	'latency_days',
	'score',
	'score_signals',
	'response_type',
	'url',
	'fail_reason',
];

function vacanciesToCsv(rows) {
	const lines = [CSV_HEADERS.join(',')];

	for (const row of rows) {
		lines.push(
			[
				row.vacancy_id,
				row.title,
				row.company,
				row.applied_at,
				row.last_seen_at,
				row.status,
				row.outcome,
				row.outcome_at,
				latencyDays(row.applied_at, row.outcome_at) ?? '',
				row.score,
				formatSignals(row.score_signals),
				row.response_type,
				row.url,
				row.fail_reason,
			]
				.map(escapeCsv)
				.join(','),
		);
	}

	return lines.join('\n') + '\n';
}

function defaultExportPath() {
	const stamp = new Date().toISOString().slice(0, 10);
	return path.join('data', `hh-export-${stamp}.csv`);
}

function runExport(config) {
	const db = openDatabase(config.dbPath);
	const rows = listVacanciesForExport(db);
	const outPath = path.resolve(process.cwd(), config.exportCsvPath || defaultExportPath());

	ensureDir(outPath);
	fs.writeFileSync(outPath, vacanciesToCsv(rows), 'utf8');

	const labeled = rows.filter(
		(r) => r.outcome && r.outcome !== 'pending' && r.outcome !== 'skipped',
	).length;

	console.log(`Экспорт: ${outPath}`);
	console.log(`Строк: ${rows.length} (размеченных outcomes: ${labeled})`);
	db.close();
}

module.exports = {
	runExport,
	vacanciesToCsv,
	listVacanciesForExport,
};
