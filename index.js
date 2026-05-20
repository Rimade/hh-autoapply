require('dotenv').config();

const path = require('path');
const { loginInteractive } = require('./src/auth');
const { runAutoApply } = require('./src/apply');
const { loadCoverLetter } = require('./src/config');

const config = {
  storagePath: process.env.STORAGE_STATE_PATH || path.join('cookies', 'hh-storage.json'),
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
};

const command = process.argv[2] || 'apply';

async function main() {
  if (command === 'login') {
    await loginInteractive({
      storagePath: config.storagePath,
      headless: 'false',
    });
    process.exit(0);
  }

  if (command === 'apply') {
    await runAutoApply(config);
    process.exit(0);
  }

  console.log('Использование:');
  console.log('  npm run login   — войти на hh.ru и сохранить cookies');
  console.log('  npm run apply   — откликаться по поиску из .env');
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
