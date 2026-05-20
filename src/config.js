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

module.exports = {
  loadCoverLetter,
};
