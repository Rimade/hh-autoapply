const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function startOfLocalDayIso() {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.toISOString();
}

/** Первый «тип» вакансии для лимита monoculture (builtin signal, не keyword). */
function primarySignal(signals = []) {
	if (!signals.length) return 'none';
	const builtin = signals.find((s) => !s.startsWith('+') && !s.startsWith('-'));
	return builtin || signals[0];
}

function countCompanyAppliesToday(db, company) {
	if (!company) return 0;
	const since = startOfLocalDayIso();
	return (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM vacancies
     WHERE status = 'ok' AND company = ? AND applied_at >= ?`,
			)
			.get(company.trim(), since)?.c || 0
	);
}

function countSignalAppliesToday(db, signal) {
	if (!signal || signal === 'none') return 0;
	const since = startOfLocalDayIso();
	const pattern = `%"${signal}"%`;
	return (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM vacancies
     WHERE status = 'ok' AND applied_at >= ? AND score_signals LIKE ?`,
			)
			.get(since, pattern)?.c || 0
	);
}

/**
 * Diversity guard: не уходить в monoculture за один день.
 */
function canApplyByDiversity(db, item, config) {
	if (!config.diversityEnabled) return { ok: true };

	const company = (item.company || '').trim();
	const signal = primarySignal(item.signals);

	if (config.maxCompanyAppliesPerDay > 0 && company) {
		const n = countCompanyAppliesToday(db, company);
		if (n >= config.maxCompanyAppliesPerDay) {
			return {
				ok: false,
				reason: 'diversity_company_cap',
				detail: `${n}/${config.maxCompanyAppliesPerDay}`,
			};
		}
	}

	if (config.maxSignalAppliesPerDay > 0 && signal !== 'none') {
		const n = countSignalAppliesToday(db, signal);
		if (n >= config.maxSignalAppliesPerDay) {
			return {
				ok: false,
				reason: 'diversity_signal_cap',
				detail: `${signal} ${n}/${config.maxSignalAppliesPerDay}`,
			};
		}
	}

	return { ok: true };
}

module.exports = {
	primarySignal,
	canApplyByDiversity,
	countCompanyAppliesToday,
	countSignalAppliesToday,
	startOfLocalDayIso,
	WEEKDAYS,
};
