const fs = require('fs');
const path = require('path');

const STACK_DETECTORS = [
	{ re: /\bnestjs\b/i, label: 'NestJS' },
	{ re: /\bnode\.?js\b/i, label: 'Node.js' },
	{ re: /\btypescript\b/i, label: 'TypeScript' },
	{ re: /\bjavascript\b/i, label: 'JavaScript' },
	{ re: /\breact\b/i, label: 'React' },
	{ re: /\bvue\b/i, label: 'Vue.js' },
	{ re: /\bpostgresql\b|\bpostgres\b/i, label: 'PostgreSQL' },
	{ re: /\bmongodb\b/i, label: 'MongoDB' },
	{ re: /\bredis\b/i, label: 'Redis' },
	{ re: /\bkafka\b/i, label: 'Kafka' },
	{ re: /\bgraphql\b/i, label: 'GraphQL' },
];

function loadTemplateFile(filePath) {
	if (!filePath) return null;
	const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
	if (!fs.existsSync(resolved)) return null;
	return fs.readFileSync(resolved, 'utf8').trim();
}

function detectStacks(text) {
	const seen = new Set();
	const found = [];

	for (const { re, label } of STACK_DETECTORS) {
		if (re.test(text) && !seen.has(label)) {
			seen.add(label);
			found.push(label);
		}
	}

	return found;
}

function buildStackLine(stacks) {
	if (!stacks.length) {
		return 'Имею релевантный коммерческий опыт в разработке.';
	}
	if (stacks.length === 1) {
		return `У меня коммерческий опыт с ${stacks[0]}.`;
	}
	return `У меня коммерческий опыт с ${stacks.slice(0, 4).join(', ')}.`;
}

function fillTemplate(template, { title, company, stackLine }) {
	const companyLine = company ? ` в ${company}` : '';

	return template
		.replace(/\{\{STACK_LINE\}\}/g, stackLine)
		.replace(/\{\{TITLE\}\}/g, title || 'вакансия')
		.replace(/\{\{COMPANY\}\}/g, company || '')
		.replace(/\{\{COMPANY_LINE\}\}/g, companyLine);
}

/**
 * Шаблон + адаптация под стек вакансии (без GPT).
 * @param {object} item — карточка вакансии
 * @param {string} [extraText] — описание со страницы вакансии
 */
function buildLetterForVacancy(config, item, extraText = '') {
	const corpus = `${item.title || ''} ${item.company || ''} ${item.snippet || ''} ${extraText}`;
	const stacks = detectStacks(corpus);
	const stackLine = buildStackLine(stacks);

	if (config.useTemplateLetter) {
		const template =
			loadTemplateFile(config.templateLetterPath) ||
			loadTemplateFile(path.join(process.cwd(), 'cover-letter-template.txt'));

		if (template) {
			return fillTemplate(template, {
				title: item.title,
				company: item.company,
				stackLine,
			});
		}
	}

	if (config.staticCoverLetter) {
		return config.staticCoverLetter;
	}

	return fillTemplate(
		`Здравствуйте.\n\n{{STACK_LINE}}\n\nИнтересна позиция «{{TITLE}}»{{COMPANY_LINE}}.\n\nБуду рад обсудить.`,
		{ title: item.title, company: item.company, stackLine },
	);
}

function resolveCoverLetter(config, item, extraText = '') {
	if (config.useTemplateLetter || !config.staticCoverLetter) {
		return buildLetterForVacancy(config, item, extraText);
	}
	return config.staticCoverLetter;
}

module.exports = {
	detectStacks,
	buildLetterForVacancy,
	resolveCoverLetter,
	loadTemplateFile,
};
