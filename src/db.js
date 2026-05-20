const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { ensureDir } = require('./utils');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  company_name TEXT PRIMARY KEY,
  last_apply_at TEXT,
  apply_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vacancies (
  vacancy_id TEXT PRIMARY KEY,
  title TEXT,
  company TEXT,
  score INTEGER,
  status TEXT,
  applied_at TEXT,
  last_seen_at TEXT,
  last_failed_at TEXT,
  requires_test INTEGER DEFAULT 0,
  cover_required INTEGER DEFAULT 0,
  response_type TEXT,
  url TEXT,
  fail_reason TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  finished_at TEXT,
  applications_sent INTEGER DEFAULT 0,
  blocks_detected INTEGER DEFAULT 0
);
`;

function openDatabase(dbPath) {
	ensureDir(dbPath);
	const db = new DatabaseSync(dbPath);
	db.exec(SCHEMA);
	return db;
}

function migrateFromAppliedJson(db, appliedJsonPath) {
	if (!fs.existsSync(appliedJsonPath)) return 0;

	let data;
	try {
		data = JSON.parse(fs.readFileSync(appliedJsonPath, 'utf8'));
	} catch {
		return 0;
	}

	const ids = data.ids || [];
	let n = 0;
	const stmt = db.prepare(
		`INSERT OR IGNORE INTO vacancies (vacancy_id, status, applied_at, last_seen_at)
     VALUES (?, 'ok', ?, ?)`,
	);

	const now = new Date().toISOString();
	for (const id of ids) {
		const r = stmt.run(String(id), now, now);
		if (r.changes) n++;
	}

	if (n > 0) {
		console.log(`Миграция из applied.json: ${n} записей → SQLite`);
	}
	return n;
}

function startRun(db) {
	const now = new Date().toISOString();
	const r = db.prepare('INSERT INTO runs (started_at) VALUES (?)').run(now);
	return { runId: Number(r.lastInsertRowid), startedAt: now };
}

function finishRun(db, runId, { applicationsSent, blocksDetected }) {
	db.prepare(
		`UPDATE runs SET finished_at = ?, applications_sent = ?, blocks_detected = ? WHERE id = ?`,
	).run(new Date().toISOString(), applicationsSent, blocksDetected, runId);
}

function getVacancyStatus(db, vacancyId) {
	return db
		.prepare('SELECT status, last_failed_at FROM vacancies WHERE vacancy_id = ?')
		.get(vacancyId);
}

function canApplyVacancy(db, vacancyId, failedRetryDays) {
	const row = getVacancyStatus(db, vacancyId);
	if (!row) return { ok: true };

	if (row.status === 'ok' || row.status === 'skip') {
		return { ok: false, reason: 'already_applied' };
	}

	if (row.status === 'fail' && row.last_failed_at) {
		const failedAt = new Date(row.last_failed_at).getTime();
		const retryAfter = failedAt + failedRetryDays * 24 * 60 * 60 * 1000;
		if (Date.now() < retryAfter) {
			return { ok: false, reason: 'fail_cooldown' };
		}
	}

	return { ok: true };
}

function canApplyCompany(db, companyName, cooldownHours) {
	if (!companyName) return { ok: true };

	const row = db
		.prepare('SELECT last_apply_at FROM companies WHERE company_name = ?')
		.get(companyName);
	if (!row?.last_apply_at) return { ok: true };

	const last = new Date(row.last_apply_at).getTime();
	const waitUntil = last + cooldownHours * 60 * 60 * 1000;
	if (Date.now() < waitUntil) {
		return { ok: false, reason: 'company_cooldown' };
	}

	return { ok: true };
}

function countApplicationsSince(db, sinceIso) {
	const row = db
		.prepare(`SELECT COUNT(*) AS c FROM vacancies WHERE status = 'ok' AND applied_at >= ?`)
		.get(sinceIso);
	return row?.c || 0;
}

function checkRateLimits(db, { dailyLimit, hourlyLimit }) {
	const now = Date.now();
	const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
	const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

	const hourCount = countApplicationsSince(db, hourAgo);
	if (hourCount >= hourlyLimit) {
		return { ok: false, reason: 'hourly_limit' };
	}

	const dayCount = countApplicationsSince(db, dayAgo);
	if (dayCount >= dailyLimit) {
		return { ok: false, reason: 'daily_limit' };
	}

	return { ok: true };
}

function upsertVacancySeen(db, item) {
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO vacancies (vacancy_id, title, company, url, last_seen_at, requires_test, score)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(vacancy_id) DO UPDATE SET
       title = excluded.title,
       company = excluded.company,
       url = excluded.url,
       last_seen_at = excluded.last_seen_at,
       requires_test = excluded.requires_test,
       score = COALESCE(excluded.score, vacancies.score)`,
	).run(
		String(item.id),
		item.title || null,
		item.company || null,
		item.href || null,
		now,
		item.requiresTest ? 1 : 0,
		item.score ?? null,
	);
}

function recordVacancyResult(db, item, result) {
	const now = new Date().toISOString();
	const status = result.status === 'ok' ? 'ok' : result.status === 'skip' ? 'skip' : 'fail';
	const responseType = status === 'ok' ? result.flow || result.reason || null : null;
	const failReason = status === 'fail' ? result.reason || null : null;

	db.prepare(
		`INSERT INTO vacancies (
      vacancy_id, title, company, url, status, applied_at, last_seen_at, last_failed_at,
      requires_test, response_type, fail_reason, score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vacancy_id) DO UPDATE SET
      title = excluded.title,
      company = excluded.company,
      url = excluded.url,
      status = excluded.status,
      applied_at = CASE WHEN excluded.status = 'ok' THEN excluded.applied_at ELSE vacancies.applied_at END,
      last_seen_at = excluded.last_seen_at,
      last_failed_at = CASE WHEN excluded.status = 'fail' THEN excluded.last_failed_at ELSE vacancies.last_failed_at END,
      response_type = excluded.response_type,
      fail_reason = excluded.fail_reason,
      score = excluded.score`,
	).run(
		String(item.id),
		item.title || null,
		item.company || null,
		item.href || null,
		status,
		status === 'ok' ? now : null,
		now,
		status === 'fail' ? now : null,
		item.requiresTest ? 1 : 0,
		responseType,
		failReason,
		item.score ?? null,
	);

	if (status === 'ok' && item.company) {
		db.prepare(
			`INSERT INTO companies (company_name, last_apply_at, apply_count)
       VALUES (?, ?, 1)
       ON CONFLICT(company_name) DO UPDATE SET
         last_apply_at = excluded.last_apply_at,
         apply_count = companies.apply_count + 1`,
		).run(item.company, now);
	}
}

function getStats(db) {
	const total = db.prepare('SELECT COUNT(*) AS c FROM vacancies WHERE status = ?').get('ok');
	return { appliedTotal: total?.c || 0 };
}

module.exports = {
	openDatabase,
	migrateFromAppliedJson,
	startRun,
	finishRun,
	canApplyVacancy,
	canApplyCompany,
	checkRateLimits,
	upsertVacancySeen,
	recordVacancyResult,
	getStats,
};
