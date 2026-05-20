const fs = require('fs');
const path = require('path');

function randomDelay(minMs, maxMs) {
  const min = Number(minMs);
  const max = Number(maxMs);
  const ms = min + Math.floor(Math.random() * (max - min + 1));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  randomDelay,
  ensureDir,
  loadJson,
  saveJson,
  sleep,
};
