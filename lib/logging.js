const fs = require('node:fs');
const path = require('node:path');

function appendLog(logFile, payload) {
  const logDir = path.dirname(logFile);
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(logFile, `${JSON.stringify(payload)}\n`, 'utf8');
}

module.exports = {
  appendLog,
};
