const fs = require('fs');
const path = require('path');

function loadCoverLetter() {
  const filePath = process.env.COVER_LETTER_FILE;
  if (filePath) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (fs.existsSync(resolved)) {
      return fs.readFileSync(resolved, 'utf8').trim();
    }
    console.warn(`Файл письма не найден: ${resolved}`);
  }

  const inline = process.env.COVER_LETTER;
  if (inline) {
    return inline.replace(/\\n/g, '\n').trim();
  }

  return '';
}

function loadTemplateLetterPath() {
  return process.env.COVER_LETTER_TEMPLATE_FILE || 'cover-letter-template.txt';
}

module.exports = {
  loadCoverLetter,
  loadTemplateLetterPath,
};
