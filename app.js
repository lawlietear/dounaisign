#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { BASE_DIR, loadConfig, findChrome } = require('./lib/config');
const { withExclusiveLock } = require('./lib/lockfile');
const { buildResult } = require('./lib/result');
const { appendLog } = require('./lib/logging');
const { PANEL_URL, readDounaiAccount } = require('./lib/dounai-account');
const { runDounaiSignin } = require('./sites/dounai');

function shanghaiDate(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}

function readStatus(baseDir = BASE_DIR, now = new Date()) {
  const file = path.join(baseDir, 'data/dounai-signin-status.json');
  let result;
  try { result = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { completionOk: false, status: 'missing_or_invalid', checkedAt: now.toISOString() }; }
  const isStale = !result || typeof result.timestamp !== 'string' || !shanghaiDate(result.timestamp) ||
    shanghaiDate(result.timestamp) !== shanghaiDate(now);
  return { completionOk: Boolean(result?.site === 'dounai' && result.ok === true &&
    ['signed', 'already_done'].includes(result.status) && !isStale),
  isStale, checkedAt: now.toISOString(), result };
}

async function waitForLogin(page, expectedAccount, timeoutMs = 300000) {
  await page.goto(PANEL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const deadline = Date.now() + timeoutMs;
  while (true) {
    let check;
    try { check = await readDounaiAccount(page, expectedAccount); }
    catch (error) {
      if (!/Execution context was destroyed|Cannot find context/i.test(error.message)) throw error;
    }
    if (check?.ok) return buildResult('dounai', true, 'logged_in', 'Account confirmed. No sign-in action was performed.');
    if (check?.reason === 'unexpected_page' && check.loggedIn) {
      await page.goto(PANEL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    if (Date.now() >= deadline) return buildResult('dounai', false, 'auth_required', 'Login was not confirmed within five minutes.');
    await page.waitForTimeout(Math.min(1000, deadline - Date.now()));
  }
}

async function main(args = process.argv.slice(2), { baseDir = BASE_DIR, chromium } = {}) {
  const [command, ...flags] = args;
  if (!command || command === '--help') {
    console.log('node app.js login | signin [--interactive] | status | doctor\nlogin never signs in; signin enables local arithmetic CAPTCHA recognition.');
    return 0;
  }
  if (!['login', 'signin', 'status', 'doctor'].includes(command) ||
      flags.some(flag => command !== 'signin' || flag !== '--interactive') || flags.length > 1) {
    console.error('Unknown command or option. Use --help.');
    return 2;
  }
  if (command === 'status') {
    const status = readStatus(baseDir);
    console.log(JSON.stringify(status, null, 2));
    return status.completionOk ? 0 : 1;
  }
  if (command === 'doctor') return require('./scripts/doctor').doctor(baseDir);
  let result;
  try {
    const config = loadConfig(baseDir);
    const executablePath = findChrome(config.chromePath);
    const interactive = command === 'login' || flags.includes('--interactive');
    const locked = await withExclusiveLock(path.join(baseDir, '.signin.lock'), async () => {
      // Lazy load so help/status need neither installed Playwright nor a browser.
      const browser = chromium || require('playwright-core').chromium;
      const context = await browser.launchPersistentContext(path.join(baseDir, 'profiles/chrome'), {
        executablePath, headless: interactive ? false : config.headless, timeout: config.timeoutMs,
        proxy: config.proxy ? { server: config.proxy } : undefined,
      });
      try {
        const page = await context.newPage();
        let outcome;
        if (command === 'login') {
          console.error('Complete login in the dedicated Chrome window. Waiting up to five minutes.');
          outcome = await waitForLogin(page, config.expectedAccount);
        } else {
          outcome = await runDounaiSignin(page, {
            expectedAccount: config.expectedAccount, timeoutMs: config.timeoutMs,
            autoCaptcha: true, interactive,
          });
          if (outcome.ok) {
            const screenshot = `data/dounai-signin-${shanghaiDate(new Date())}.png`;
            fs.mkdirSync(path.join(baseDir, 'data'), { recursive: true });
            try {
              await page.getByRole('button', { name: /今日已签到/ }).screenshot({ path: path.join(baseDir, screenshot) });
              outcome.screenshot = screenshot;
            } catch { outcome.screenshotWarning = 'Confirmed signed state, but screenshot could not be saved.'; }
          }
        }
        return { ...outcome, executionMode: interactive || !config.headless ? 'foreground' : 'background' };
      } finally { await context.close(); }
    });
    result = locked.locked ? buildResult('dounai', false, 'busy', 'Another operation is using this package profile.') : locked.value;
  } catch (error) { result = buildResult('dounai', false, 'runner_error', error.message); }
  result.source = 'dounai_windows';
  result.executionMode ||= 'not_started';
  fs.mkdirSync(path.join(baseDir, 'data'), { recursive: true });
  // A login is never recorded as today's successful sign-in.
  const filename = command === 'login' ? 'login-status.json' : 'dounai-signin-status.json';
  fs.writeFileSync(path.join(baseDir, 'data', filename), `${JSON.stringify(result, null, 2)}\n`);
  appendLog(path.join(baseDir, 'logs', `${command}.log`), result);
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

if (require.main === module) main().then(code => { process.exitCode = code; })
  .catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { main, readStatus, shanghaiDate, waitForLogin };
