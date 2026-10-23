#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { BASE_DIR, loadConfig, findChrome } = require('./lib/config');
const { withExclusiveLock } = require('./lib/lockfile');
const { buildResult } = require('./lib/result');
const { appendLog } = require('./lib/logging');
const { PANEL_URL, readDounaiAccount } = require('./lib/dounai-account');
const { runDounaiSignin } = require('./sites/dounai');
const { evidencePaths, captureCaptchaEvidence, captureFailureEvidence } = require('./lib/dounai-diagnostics');
const { runWithRetry } = require('./lib/dounai-retry');

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

async function runBrowserAttempt({ command, baseDir, chromium, interactive, autoCaptcha, attempt, captchaAttempts }) {
  const attemptId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  let result;
  let operationStarted = false;
  try {
    const config = loadConfig(baseDir);
    const executablePath = findChrome(config.chromePath);
    const locked = await withExclusiveLock(path.join(baseDir, '.signin.lock'), async () => {
      // Lazy load so help/status need neither installed Playwright nor a browser.
      const browser = chromium || require('playwright-core').chromium;
      const context = await browser.launchPersistentContext(path.join(baseDir, 'profiles/chrome'), {
        executablePath, headless: interactive ? false : config.headless, timeout: config.timeoutMs,
        proxy: config.proxy ? { server: config.proxy } : undefined,
      });
      let outcome;
      try {
        const page = await context.newPage();
        operationStarted = true;
        try {
          if (command === 'login') {
            console.error('Complete login in the dedicated Chrome window. Waiting up to five minutes.');
            outcome = await waitForLogin(page, config.expectedAccount);
          } else {
            outcome = await runDounaiSignin(page, {
              expectedAccount: config.expectedAccount, timeoutMs: config.timeoutMs, autoCaptcha, interactive, captchaAttempts,
              captureCaptcha: ({ recognitionAttempt = 1 } = {}) => captureCaptchaEvidence(page, {
                baseDir, attemptId, timeoutMs: config.timeoutMs, recognitionAttempt,
              }),
            });
          }
        } catch (error) {
          outcome = buildResult('dounai', false, command === 'signin' ? 'unconfirmed' : 'runner_error',
            'Page operation failed; result was not confirmed.', { details: { executionError: {
              name: error.name, message: String(error.message || '').split(/\r?\nCall log:/, 1)[0].slice(0, 500),
            } } });
        }
        if (command === 'signin' && outcome.ok) {
          const screenshot = `data/dounai-signin-${shanghaiDate(new Date())}.png`;
          fs.mkdirSync(path.join(baseDir, 'data'), { recursive: true });
          try {
            await page.getByRole('button', { name: /今日已签到/ }).screenshot({ path: path.join(baseDir, screenshot) });
            outcome.screenshot = screenshot;
          } catch { outcome.screenshotWarning = 'Confirmed signed state, but screenshot could not be saved.'; }
        } else if (!outcome.ok) {
          outcome.details = { ...outcome.details,
            diagnostics: await captureFailureEvidence(page, { baseDir, attemptId }) };
        }
        outcome.executionMode = interactive || !config.headless ? 'foreground' : 'background';
        return outcome;
      } finally {
        try { await context.close(); }
        catch { if (outcome) outcome.browserCloseWarning = 'Package Chrome did not close normally.'; }
      }
    });
    result = locked.locked ? buildResult('dounai', false, 'busy', 'Another operation is using this package profile.') : locked.value;
  } catch (error) {
    result = buildResult('dounai', false, operationStarted && command === 'signin' ? 'unconfirmed' : 'runner_error', error.message);
  }
  result.source = 'dounai_windows';
  result.executionMode ||= 'not_started';
  result.attempt = attempt;
  result.attemptId = attemptId;
  return result;
}

function saveResult(command, baseDir, result) {
  const paths = evidencePaths(baseDir, result.attemptId);
  result.record = `${paths.relative}/result.json`;
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  fs.writeFileSync(path.join(paths.directory, 'result.json'), serialized, { mode: 0o600 });
  fs.mkdirSync(path.join(baseDir, 'data'), { recursive: true });
  // A login is never recorded as today's successful sign-in.
  const filename = command === 'login' ? 'login-status.json' : 'dounai-signin-status.json';
  fs.writeFileSync(path.join(baseDir, 'data', filename), serialized, { mode: 0o600 });
  appendLog(path.join(baseDir, 'logs', `${command}.log`), result);
  console.log(JSON.stringify(result, null, 2));
}

async function main(args = process.argv.slice(2), { baseDir = BASE_DIR, chromium, wait } = {}) {
  const [command, ...flags] = args;
  if (!command || command === '--help') {
    console.log('node app.js login | signin [--interactive] [--retry-captcha] | status | doctor\nlogin never signs in; signin enables local recognition. Recognition errors before filling can close and reopen the challenge, up to five recognitions including the first, shared across browser attempts. Temporary failures share one retry after three minutes; --retry-captcha also permits one retry after an explicit rejection.');
    return 0;
  }
  if (!['login', 'signin', 'status', 'doctor'].includes(command) ||
      flags.some(flag => command !== 'signin' || !['--interactive', '--retry-captcha'].includes(flag)) ||
      flags.length !== new Set(flags).size) {
    console.error('Unknown command or option. Use --help.');
    return 2;
  }
  if (command === 'status') {
    const status = readStatus(baseDir);
    console.log(JSON.stringify(status, null, 2));
    return status.completionOk ? 0 : 1;
  }
  if (command === 'doctor') return require('./scripts/doctor').doctor(baseDir);
  const interactive = command === 'login' || flags.includes('--interactive');
  const retryCaptcha = flags.includes('--retry-captcha');
  const captchaAttempts = { count: 0 };
  const attempt = ({ attempt, retry = false }) => runBrowserAttempt({
    command, baseDir, chromium, interactive, autoCaptcha: !retry || retryCaptcha, attempt, captchaAttempts,
  });
  const persist = (result) => saveResult(command, baseDir, result);
  let result;
  if (command === 'signin') {
    result = await runWithRetry({ runAttempt: attempt, saveResult: persist, retryCaptcha, wait });
  } else {
    result = await attempt({ attempt: 1 });
    persist(result);
  }
  return result.ok ? 0 : 1;
}

if (require.main === module) main().then(code => { process.exitCode = code; })
  .catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { main, readStatus, shanghaiDate, waitForLogin };
