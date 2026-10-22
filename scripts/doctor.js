const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { loadConfig, findChrome } = require('../lib/config');

function verifyAssets(baseDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(baseDir, 'tools/ocr/assets.json'), 'utf8'));
  for (const asset of manifest.assets) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, asset.path))).digest('hex');
    if (actual !== asset.sha256) throw new Error(`Model/dictionary hash mismatch: ${asset.path}`);
  }
  return true;
}

function doctor(baseDir) {
  try {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This distribution targets Windows x64.');
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node.js 24 x64 is required.');
    const config = loadConfig(baseDir);
    findChrome(config.chromePath);
    require('playwright-core');
    verifyAssets(baseDir);
    const python = path.join(baseDir, 'tools/ocr/.venv/Scripts/python.exe');
    const checked = spawnSync(python, [path.join(baseDir, 'tools/ocr/check-env.py')], {
      encoding: 'utf8', windowsHide: true, timeout: 120000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    if (checked.error || checked.status !== 0) throw new Error('OCR environment check failed. Run setup.ps1 and inspect its output.');
    const ocr = JSON.parse(checked.stdout);
    console.log(JSON.stringify({ ok: true, status: 'ready', node: process.version, ocr,
      modelHashesVerified: true, browserStarted: false, websiteVisited: false }, null, 2));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, status: 'not_ready', message: error.message }, null, 2));
    return 1;
  }
}

module.exports = { doctor, verifyAssets };
