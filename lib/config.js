const fs = require('node:fs');
const path = require('node:path');

const BASE_DIR = path.resolve(__dirname, '..');

function loadConfig(baseDir = BASE_DIR) {
  const file = path.join(baseDir, 'config.json');
  if (!fs.existsSync(file)) throw new Error('Missing config.json. Run setup.ps1 -Account "your-account" first.');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (typeof raw.expectedAccount !== 'string' || !raw.expectedAccount.trim()) {
    throw new Error('config.json expectedAccount must be your Dounai username, not a password.');
  }
  if (raw.headless !== undefined && typeof raw.headless !== 'boolean') throw new Error('headless must be a boolean.');
  if (raw.timeoutMs !== undefined && (!Number.isFinite(raw.timeoutMs) || raw.timeoutMs <= 0)) {
    throw new Error('timeoutMs must be positive.');
  }
  return {
    expectedAccount: raw.expectedAccount.trim(),
    proxy: typeof raw.proxy === 'string' ? raw.proxy.trim() : '',
    chromePath: typeof raw.chromePath === 'string' ? raw.chromePath.trim() : '',
    headless: raw.headless === true,
    timeoutMs: raw.timeoutMs || 60000,
  };
}

function findChrome(explicit = '', env = process.env, exists = fs.existsSync) {
  if (explicit) {
    if (!exists(explicit)) throw new Error('Configured chromePath does not exist.');
    return explicit;
  }
  const candidates = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA,
    env.ProgramFiles, env['ProgramFiles(x86)'], env.LocalAppData]
    .filter(Boolean).map(root => path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  const found = candidates.find(candidate => exists(candidate));
  if (!found) throw new Error('Chrome was not found. Install Chrome or set chromePath in config.json.');
  return found;
}

module.exports = { BASE_DIR, loadConfig, findChrome };
