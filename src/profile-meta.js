const fs = require('fs');
const path = require('path');
const { CHROME_USER_AGENT } = require('./stealth');

const META_FILE = '.hh-profile.json';

/** Согласованные пресеты «обычный Windows ПК» — не рандом при каждом запуске. */
const CONSISTENT_PRESETS = [
	{ viewport: { width: 1536, height: 864 }, hardwareConcurrency: 8, deviceMemory: 8 },
	{ viewport: { width: 1920, height: 1080 }, hardwareConcurrency: 12, deviceMemory: 8 },
	{ viewport: { width: 1366, height: 768 }, hardwareConcurrency: 4, deviceMemory: 4 },
	{ viewport: { width: 1440, height: 900 }, hardwareConcurrency: 8, deviceMemory: 8 },
];

function metaPath(userDataDir) {
	return path.join(userDataDir, META_FILE);
}

function pickPreset() {
	return CONSISTENT_PRESETS[Math.floor(Math.random() * CONSISTENT_PRESETS.length)];
}

function loadOrCreateProfileMeta(userDataDir) {
	const file = metaPath(userDataDir);
	fs.mkdirSync(userDataDir, { recursive: true });

	if (fs.existsSync(file)) {
		try {
			const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
			if (meta.viewport?.width && meta.userAgent) {
				return meta;
			}
		} catch {
			// пересоздадим
		}
	}

	const preset = pickPreset();
	const meta = {
		...preset,
		userAgent: CHROME_USER_AGENT,
		platform: 'Win32',
		locale: 'ru-RU',
		timezoneId: 'Europe/Moscow',
		createdAt: new Date().toISOString(),
	};

	fs.writeFileSync(file, JSON.stringify(meta, null, 2), 'utf8');
	console.log(
		`Профиль браузера: ${meta.viewport.width}x${meta.viewport.height}, CPU=${meta.hardwareConcurrency}, RAM=${meta.deviceMemory}GB`,
	);

	return meta;
}

module.exports = {
	loadOrCreateProfileMeta,
	metaPath,
};
