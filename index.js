require('dotenv').config();

const path = require('path');
const { loginInteractive } = require('./src/auth');
const { runAutoApply } = require('./src/apply');
const { loadCoverLetter } = require('./src/config');
const { SafetyStopError } = require('./src/captcha');

const config = {
	userDataDir: process.env.USER_DATA_DIR || path.join('user-data', 'hh-profile'),
	legacyStoragePath: process.env.STORAGE_STATE_PATH || path.join('cookies', 'hh-storage.json'),
	appliedDbPath: process.env.APPLIED_DB_PATH || path.join('data', 'applied.json'),
	searchUrl:
		process.env.HH_SEARCH_URL ||
		'https://hh.ru/search/vacancy?text=frontend&area=1&ored_clusters=true',
	maxApplications: Number(process.env.MAX_APPLICATIONS || 15),
	delayMinMs: Number(process.env.DELAY_MIN_MS || 4000),
	delayMaxMs: Number(process.env.DELAY_MAX_MS || 9000),
	headless: process.env.HEADLESS || 'false',
	maxPages: Number(process.env.MAX_PAGES || 3),
	skipTests: process.env.SKIP_VACANCIES_WITH_TESTS !== 'false',
	coverLetter: loadCoverLetter(),
	humanBrowseChance: Number(process.env.HUMAN_BROWSE_CHANCE || 0.06),
	humanIdleChance: Number(process.env.HUMAN_IDLE_CHANCE || 0.03),
	slowMo: Number(process.env.SLOW_MO || 0),
	useSystemChrome: process.env.USE_SYSTEM_CHROME === 'true',
};

const command = process.argv[2] || 'apply';

async function main() {
	if (command === 'login') {
		await loginInteractive(config);
		process.exit(0);
	}

	if (command === 'apply') {
		await runAutoApply(config);
		process.exit(0);
	}

	console.log('Использование:');
	console.log('  npm run login   — войти на hh.ru (persistent-профиль)');
	console.log('  npm run apply   — откликаться по поиску из .env');
	process.exit(1);
}

main().catch((err) => {
	if (err instanceof SafetyStopError) {
		console.error(`\n⛔ Остановка: ${err.reason}`);
		console.error(err.message);
		process.exit(2);
	}
	console.error(err.message || err);
	process.exit(1);
});
