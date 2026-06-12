// Tiny JSON-file data store. Writes are atomic (write to .tmp, then rename)
// so a crash mid-write can't corrupt the data files.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function file(name) {
  return path.join(DATA_DIR, name + '.json');
}

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function write(name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const target = file(name);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

function exists(name) {
  return fs.existsSync(file(name));
}

module.exports = { read, write, exists, DATA_DIR };
