require('dotenv').config();

const path = require('path');
const { loginInteractive } = require('./src/auth');
const { runAutoApply } = require('./src/apply');
const { loadCoverLetter, loadTemplateLetterPath } = require('./src/config');
const { runOutcomesCli, runStats } = require('./src/outcomes');
const { runExport } = require('./src/export');
const { parseKeywordList } = require('./src/score');
const { SafetyStopError } = require('./src/captcha');

const scoreEnabled = process.env.SCORE_ENABLED === 'true';

const config = {
	userDataDir: process.env.USER_DATA_DIR || path.join('user-data', 'hh-profile'),
	legacyStoragePath: process.env.STORAGE_STATE_PATH || path.join('cookies', 'hh-storage.json'),
	dbPath: process.env.DATABASE_PATH || path.join('data', 'hh.db'),
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
	staticCoverLetter: loadCoverLetter(),
	useTemplateLetter: process.env.USE_TEMPLATE_LETTER === 'true',
	templateLetterPath: loadTemplateLetterPath(),
	outcomesBatchSize: Number(process.env.OUTCOMES_BATCH_SIZE || 25),
	learningMinSamples: Number(process.env.LEARNING_MIN_SAMPLES || 5),
	learningDecay: process.env.LEARNING_DECAY !== 'false',
	pairwiseMinSamples: Number(process.env.PAIRWISE_MIN_SAMPLES || 3),
	timelineLimit: Number(process.env.TIMELINE_LIMIT || 12),
	exportCsvPath: process.env.EXPORT_CSV_PATH || '',
	humanBrowseChance: Number(process.env.HUMAN_BROWSE_CHANCE || 0.06),
	humanIdleChance: Number(process.env.HUMAN_IDLE_CHANCE || 0.03),
	navigationEntropyChance: Number(process.env.NAVIGATION_ENTROPY_CHANCE || 0.08),
	slowMo: Number(process.env.SLOW_MO || 0),
	useSystemChrome: process.env.USE_SYSTEM_CHROME === 'true',
	companyCooldownHours: Number(process.env.COMPANY_COOLDOWN_HOURS || 24),
	failedRetryDays: Number(process.env.FAILED_RETRY_DAYS || 3),
	dailyLimit: Number(process.env.DAILY_LIMIT || 40),
	hourlyLimit: Number(process.env.HOURLY_LIMIT || 12),
	scoreEnabled,
	scoreThreshold: Number(process.env.SCORE_THRESHOLD || 0),
	negativeDominates: process.env.NEGATIVE_DOMINATES !== 'false',
	positiveKeywords: parseKeywordList(
		process.env.POSITIVE_KEYWORDS || 'typescript,javascript,node,nest,react',
	),
	negativeKeywords: parseKeywordList(
		process.env.NEGATIVE_KEYWORDS || 'php,python,java,1c,qa,devops',
	),
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

	if (command === 'outcomes') {
		await runOutcomesCli(config);
		process.exit(0);
	}

	if (command === 'stats') {
		runStats(config);
		process.exit(0);
	}

	if (command === 'export') {
		runExport(config);
		process.exit(0);
	}

	console.log('Использование:');
	console.log('  npm run login    — войти на hh.ru (persistent-профиль)');
	console.log('  npm run apply    — откликаться по поиску из .env');
	console.log('  npm run outcomes — разметить исходы откликов (ground truth)');
	console.log('  npm run stats    — сигналы, пары, latency, timeline');
	console.log('  npm run export   — CSV для Excel / pivot tables');
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
