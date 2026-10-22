'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require('playwright-core');

const packageRoot = path.resolve(__dirname, '..');
const { main, readStatus, waitForLogin } = require('../app');
const { loadConfig, findChrome } = require('../lib/config');
const { PANEL_URL } = require('../lib/dounai-account');
const captchaOcr = require('../lib/dounai-captcha-ocr');
const { runDounaiSignin } = require('../sites/dounai');
const { verifyAssets } = require('../scripts/doctor');
const { TEST_ACCOUNT, panelHtml } = require('./fixtures/route-fixtures');

const CHROME_EXECUTABLE = process.env.DOUNAI_TEST_CHROME_PATH ||
  (process.platform === 'win32' ? findChrome() : '');
let context;
let profileDir;

test.before(async () => {
  assert.ok(CHROME_EXECUTABLE && fs.existsSync(CHROME_EXECUTABLE),
    'Set DOUNAI_TEST_CHROME_PATH to the installed Chrome executable for local browser tests.');
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dounai-windows-route-'));
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: CHROME_EXECUTABLE,
    headless: true,
    timeout: 30000,
    serviceWorkers: 'block',
    args: [
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
      '--disable-default-apps',
    ],
  });
});

test.after(async () => {
  try {
    if (context) await context.close();
  } finally {
    if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

function temporaryDirectory(t, prefix = 'dounai windows test-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

async function withPanelFixture(fixture, callback) {
  const page = await context.newPage();
  const requests = { served: [], blocked: [] };
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === PANEL_URL) {
      requests.served.push(url);
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: panelHtml(fixture),
      });
      return;
    }
    requests.blocked.push(url);
    await route.abort('blockedbyclient');
  });
  try {
    return await callback(page, requests);
  } finally {
    assert.deepEqual(requests.served, [PANEL_URL], 'only the exact local panel route was fulfilled');
    await page.close();
  }
}

async function evidence(page) {
  return page.evaluate(() => ({
    checkinClicks: window.__dounai.checkinClicks,
    captchaButtonClicks: window.__dounai.captchaButtonClicks,
    captchaSubmits: window.__dounai.captchaSubmits,
    inputEvents: window.__dounai.inputEvents,
    inputValue: window.__dounai.inputValue,
    signedMarker: Boolean([...document.querySelectorAll('button')].some((button) =>
      button.disabled && button.textContent.includes('今日已签到'))),
  }));
}

function mockOcr(t, implementation = async () => ({
  expression: '12+7', answer: '19', confidence: 0.99,
})) {
  let calls = 0;
  t.mock.method(captchaOcr, 'recognizeCaptchaImage', async (png) => {
    calls += 1;
    assert.ok(Buffer.isBuffer(png) && png.length > 0, 'OCR receives a non-empty screenshot PNG');
    return implementation(png);
  });
  return () => calls;
}

function writeConfig(baseDir, config) {
  fs.writeFileSync(path.join(baseDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
}

function writeStatus(baseDir, result) {
  const directory = path.join(baseDir, 'data');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'dounai-signin-status.json'), `${JSON.stringify(result, null, 2)}\n`);
}

test('configuration requires an expected username and trims it', (t) => {
  const baseDir = temporaryDirectory(t);
  writeConfig(baseDir, { expectedAccount: '  test-user  ', chromePath: CHROME_EXECUTABLE });
  assert.equal(loadConfig(baseDir).expectedAccount, TEST_ACCOUNT);

  writeConfig(baseDir, { expectedAccount: '   ' });
  assert.throws(() => loadConfig(baseDir), /expectedAccount must be your Dounai username/);
});

test('Chrome discovery checks Windows install roots and accepts an explicit executable', () => {
  const roots = [
    ['PROGRAMFILES', 'C:\\Program Files'],
    ['PROGRAMFILES(X86)', 'C:\\Program Files (x86)'],
    ['LOCALAPPDATA', 'C:\\Users\\test-user\\AppData\\Local'],
    ['ProgramFiles', 'C:\\Program Files'],
    ['ProgramFiles(x86)', 'C:\\Program Files (x86)'],
    ['LocalAppData', 'C:\\Users\\test-user\\AppData\\Local'],
  ];
  for (const [key, root] of roots) {
    const expected = path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe');
    assert.equal(findChrome('', { [key]: root }, (candidate) => candidate === expected), expected, key);
  }

  const explicit = 'D:\\Portable\\Chrome\\chrome.exe';
  assert.equal(findChrome(explicit, {}, (candidate) => candidate === explicit), explicit);
  assert.throws(() => findChrome(explicit, {}, () => false), /Configured chromePath does not exist/);
});

test('RapidOCR resolver accepts the single equals suffix and refuses weak or invalid readings', () => {
  assert.deepEqual(captchaOcr.resolveRapidRecognition({
    rows: [{ text: '陆x五=$', confidence: 0.76 }],
  }), {
    expression: '6*5', answer: '30', confidence: 0.76,
    recognitionMode: 'rapidocr_ppocrv5', engine: 'rapidocr', rawText: '陆x五=$',
  });
  for (const row of [
    { text: '陆x五=$', confidence: 0.499 },
    { text: '陆x五=$=30', confidence: 0.9 },
    { text: 'x五=$', confidence: 0.9 },
  ]) {
    assert.throws(() => captchaOcr.resolveRapidRecognition({ rows: [row] }), {
      code: 'uncertain_recognition',
    });
  }
});

test('direct numeric text before equals preserves mixed digits and leading zeroes', () => {
  for (const [text, answer] of [
    ['玖5=', '95'], ['９５＝忽略', '95'], ['壹贰叁四等於?', '1234'],
    ['００７=', '007'], ['零玖5=', '095'], ['九十五=', '95'], ['零=', '0'],
  ]) {
    assert.deepEqual(captchaOcr.parseArithmeticCaptcha(text), { expression: answer, answer });
  }
  for (const text of ['95', '玖5', '=95', '95==?', '玖O=', '9?5=', '9.5=', '-95=', '9+=', '9×=', '一百二=']) {
    assert.throws(() => captchaOcr.parseArithmeticCaptcha(text), { code: 'unsupported_expression' });
  }
  assert.throws(() => captchaOcr.resolveRapidRecognition({ rows: [{ text: '玖5=', confidence: 0.499 }] }),
    { code: 'uncertain_recognition' });
});

test('direct mixed digits fill 95 through the resolver and submit once with a success marker', async (t) => {
  const calls = mockOcr(t, async () => captchaOcr.resolveRapidRecognition({
    rows: [{ text: '玖5=', confidence: 0.80411 }],
  }));
  await withPanelFixture({ expression: '玖5=', expectedAnswer: '95' }, async (page) => {
    const result = await runDounaiSignin(page, {
      expectedAccount: TEST_ACCOUNT, autoCaptcha: true, timeoutMs: 1200,
    });
    const counts = await evidence(page);
    assert.equal(result.status, 'signed');
    assert.equal(result.ok, true);
    assert.equal(counts.inputValue, '95');
    assert.equal(counts.captchaButtonClicks, 1);
    assert.equal(counts.captchaSubmits, 1);
    assert.equal(counts.signedMarker, true);
  });
  assert.equal(calls(), 1);
});

test('already signed panel returns success with zero check-in or OCR actions', async (t) => {
  const calls = mockOcr(t);
  await withPanelFixture({ initialDone: true, captchaVisible: false }, async (page) => {
    const result = await runDounaiSignin(page, {
      expectedAccount: TEST_ACCOUNT, autoCaptcha: true, timeoutMs: 800,
    });
    const counts = await evidence(page);
    assert.equal(result.status, 'already_done');
    assert.equal(result.ok, true);
    assert.equal(counts.checkinClicks, 0);
    assert.equal(counts.captchaSubmits, 0);
    assert.equal(counts.inputEvents, 0);
  });
  assert.equal(calls(), 0);
});

test('panel without a CAPTCHA signs once without calling OCR', async (t) => {
  const calls = mockOcr(t);
  await withPanelFixture({ captchaVisible: false }, async (page) => {
    const result = await runDounaiSignin(page, {
      expectedAccount: TEST_ACCOUNT, autoCaptcha: true, timeoutMs: 800,
    });
    const counts = await evidence(page);
    assert.equal(result.status, 'signed');
    assert.equal(result.ok, true);
    assert.equal(counts.checkinClicks, 1);
    assert.equal(counts.captchaSubmits, 0);
  });
  assert.equal(calls(), 0);
});

test('RapidOCR resolver fills 30 for the synthetic equals-suffix challenge and submits once', async (t) => {
  const calls = mockOcr(t, async () => captchaOcr.resolveRapidRecognition({
    rows: [{ text: '陆x五=$', confidence: 0.76 }],
  }));
  await withPanelFixture({ expression: '陆x五=$', expectedAnswer: '30' }, async (page) => {
    const result = await runDounaiSignin(page, {
      expectedAccount: TEST_ACCOUNT, autoCaptcha: true, timeoutMs: 1200,
    });
    const counts = await evidence(page);
    assert.equal(result.status, 'signed');
    assert.equal(result.ok, true);
    assert.equal(counts.inputValue, '30');
    assert.equal(counts.captchaButtonClicks, 1);
    assert.equal(counts.captchaSubmits, 1);
    assert.equal(counts.checkinClicks, 0);
    assert.equal(counts.signedMarker, true);
  });
  assert.equal(calls(), 1);
});

test('CAPTCHA rejection is reported without a second submission', async (t) => {
  const calls = mockOcr(t);
  await withPanelFixture({ submitMode: 'reject' }, async (page) => {
    const result = await runDounaiSignin(page, {
      expectedAccount: TEST_ACCOUNT, autoCaptcha: true, timeoutMs: 800,
    });
    const counts = await evidence(page);
    assert.equal(result.status, 'captcha_rejected');
    assert.equal(counts.captchaButtonClicks, 1);
    assert.equal(counts.captchaSubmits, 1);
    assert.equal(counts.checkinClicks, 0);
  });
  assert.equal(calls(), 1);
});

test('uncertain OCR leaves the field empty and does not submit', async (t) => {
  const calls = mockOcr(t, async () => captchaOcr.resolveRapidRecognition({
    rows: [{ text: '陆x五=$', confidence: 0.499 }],
  }));
  await withPanelFixture({}, async (page) => {
    const result = await runDounaiSignin(page, {
      expectedAccount: TEST_ACCOUNT, autoCaptcha: true, timeoutMs: 800,
    });
    const counts = await evidence(page);
    assert.equal(result.status, 'verification_required');
    assert.equal(counts.inputValue, '');
    assert.equal(counts.captchaButtonClicks, 0);
    assert.equal(counts.captchaSubmits, 0);
    assert.equal(counts.checkinClicks, 0);
  });
  assert.equal(calls(), 1);
});

test('conflicting account titles block CAPTCHA processing before OCR', async (t) => {
  const calls = mockOcr(t);
  await withPanelFixture({ accounts: [
    { text: `Hi! ${TEST_ACCOUNT}` },
    { text: 'Hi! other-user' },
  ] }, async (page) => {
    const result = await runDounaiSignin(page, {
      expectedAccount: TEST_ACCOUNT, autoCaptcha: true, timeoutMs: 800,
    });
    const counts = await evidence(page);
    assert.equal(result.status, 'account_mismatch');
    assert.equal(result.ok, false);
    assert.equal(result.details.accountCheck.reason, 'account_conflict');
    assert.equal(counts.checkinClicks, 0);
    assert.equal(counts.captchaButtonClicks, 0);
    assert.equal(counts.captchaSubmits, 0);
    assert.equal(counts.inputValue, '');
  });
  assert.equal(calls(), 0);
});

test('account change during OCR blocks filling and prevents submission', async (t) => {
  let pageRef;
  const calls = mockOcr(t, async () => {
    await pageRef.locator('.user-name-title').evaluate((element) => {
      element.textContent = 'Hi! other-user';
    });
    return { expression: '12+7', answer: '19', confidence: 0.99 };
  });
  await withPanelFixture({}, async (page) => {
    pageRef = page;
    const result = await runDounaiSignin(page, {
      expectedAccount: TEST_ACCOUNT, autoCaptcha: true, timeoutMs: 800,
    });
    const counts = await evidence(page);
    assert.equal(result.status, 'account_mismatch');
    assert.equal(result.details.captchaError, 'account_unconfirmed');
    assert.equal(result.details.captchaStage, 'after_ocr');
    assert.equal(counts.captchaButtonClicks, 0);
    assert.equal(counts.captchaSubmits, 0);
    assert.equal(counts.checkinClicks, 0);
    assert.equal(counts.inputValue, '');
  });
  assert.equal(calls(), 1);
});

test('login waits for the configured account and performs zero sign-in actions', async (t) => {
  await withPanelFixture({ loggedIn: false, loginAfterMs: 60, captchaVisible: false }, async (page) => {
    const result = await waitForLogin(page, TEST_ACCOUNT, 1500);
    const counts = await evidence(page);
    assert.equal(result.status, 'logged_in');
    assert.equal(result.ok, true);
    assert.equal(counts.checkinClicks, 0);
    assert.equal(counts.captchaButtonClicks, 0);
    assert.equal(counts.captchaSubmits, 0);
    assert.equal(counts.inputEvents, 0);
  });
});

test('login startup uses configured account and package-local profile without creating it', async (t) => {
  const baseDir = temporaryDirectory(t);
  writeConfig(baseDir, {
    expectedAccount: TEST_ACCOUNT,
    chromePath: CHROME_EXECUTABLE,
    headless: true,
  });
  const launch = {};
  const calls = { goto: [], evaluates: 0 };
  const page = {
    async goto(...args) { calls.goto.push(args); },
    async evaluate(_callback, parameters) {
      calls.evaluates += 1;
      assert.equal(parameters.expectedAccount, TEST_ACCOUNT);
      return {
        ok: true,
        loggedIn: true,
        reason: 'confirmed',
        counts: { accountTotal: 1, accountVisible: 1, accountMatching: 1, logoutTotal: 1, logoutVisible: 1 },
      };
    },
  };
  const fakeChromium = {
    async launchPersistentContext(userDataDir, options) {
      launch.userDataDir = userDataDir;
      launch.options = options;
      return { newPage: async () => page, close: async () => {} };
    },
  };
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  assert.equal(await main(['login'], { baseDir, chromium: fakeChromium }), 0);
  assert.equal(path.isAbsolute(launch.userDataDir), true);
  assert.match(baseDir, / /, 'test base directory contains a space');
  assert.equal(launch.userDataDir, path.join(baseDir, 'profiles/chrome'));
  assert.equal(launch.options.executablePath, CHROME_EXECUTABLE);
  assert.equal(launch.options.headless, false, 'login is interactive');
  assert.deepEqual(calls.goto, [[PANEL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }]]);
  assert.equal(calls.evaluates, 1);
  assert.equal(fs.existsSync(path.join(baseDir, 'profiles')), false, 'mock startup creates no browser profile');
  assert.equal(fs.existsSync(path.join(baseDir, 'data/login-status.json')), true);
  assert.equal(fs.existsSync(path.join(baseDir, 'data/dounai-signin-status.json')), false,
    'login does not write the sign-in result');
});

test('status compares the Beijing calendar date and accepts only signed or already_done', (t) => {
  const baseDir = temporaryDirectory(t);
  const now = new Date('2026-10-19T16:05:00.000Z');
  for (const status of ['signed', 'already_done']) {
    writeStatus(baseDir, {
      site: 'dounai', ok: true, status,
      timestamp: '2026-10-19T16:00:00.000Z',
    });
    assert.equal(readStatus(baseDir, now).completionOk, true, status);
  }

  writeStatus(baseDir, {
    site: 'dounai', ok: true, status: 'signed',
    timestamp: '2026-10-19T15:55:00.000Z',
  });
  const oldBeijingDate = readStatus(baseDir, now);
  assert.equal(oldBeijingDate.completionOk, false);
  assert.equal(oldBeijingDate.isStale, true);

  writeStatus(baseDir, {
    site: 'dounai', ok: false, status: 'unconfirmed',
    timestamp: now.toISOString(),
  });
  assert.equal(readStatus(baseDir, now).completionOk, false);

  writeStatus(baseDir, {
    site: 'dounai', ok: true, status: 'signed', timestamp: now.getTime(),
  });
  assert.equal(readStatus(baseDir, now).completionOk, false, 'timestamp must be an ISO date string');
});

test('status command returns nonzero for a failed result and does not alter its file', async (t) => {
  const baseDir = temporaryDirectory(t);
  writeStatus(baseDir, {
    site: 'dounai', ok: false, status: 'runner_error', timestamp: new Date().toISOString(),
  });
  const file = path.join(baseDir, 'data/dounai-signin-status.json');
  const before = fs.readFileSync(file);
  t.mock.method(console, 'log', () => {});
  assert.equal(await main(['status'], { baseDir }), 1);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('status command returns nonzero for an old Beijing date', async (t) => {
  const baseDir = temporaryDirectory(t);
  writeStatus(baseDir, {
    site: 'dounai', ok: true, status: 'signed', timestamp: '2000-01-01T00:00:00.000Z',
  });
  t.mock.method(console, 'log', () => {});
  assert.equal(await main(['status'], { baseDir }), 1);
});

test('shipped OCR model and dictionary hashes match their manifest', () => {
  assert.equal(verifyAssets(packageRoot), true);
});

test('Windows requirements retain hashes for each x64 or universal wheel in the source lock', () => {
  const sourceLock = fs.readFileSync(path.join(packageRoot, 'tools/ocr/source-uv.lock'), 'utf8');
  const requirements = fs.readFileSync(path.join(packageRoot, 'tools/ocr/requirements.lock.txt'), 'utf8');
  const normalizedName = (name) => name.toLowerCase().replace(/[-_.]/g, '');
  const requirementsByName = new Map();
  let current;
  for (const line of requirements.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_.-]+)==([^\s;\\]+)/.exec(line);
    if (match) {
      current = {
        version: match[2],
        hashes: new Set(),
      };
      requirementsByName.set(normalizedName(match[1]), current);
    } else if (current && line.includes('--hash=sha256:')) {
      current.hashes.add(/--hash=sha256:([a-f0-9]{64})/.exec(line)[1]);
    } else if (!line.trim()) {
      current = undefined;
    }
  }

  const sourcePackages = new Map();
  for (const block of sourceLock.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    if (!name || !version) continue;
    const wheels = [...block.matchAll(/url = "([^"]+\.whl)", hash = "sha256:([a-f0-9]{64})"/g)]
      .map((match) => ({ url: match[1], hash: match[2] }));
    sourcePackages.set(normalizedName(name), { version, wheels });
  }

  assert.ok(requirementsByName.size > 0);
  for (const [name, requirement] of requirementsByName) {
    const source = sourcePackages.get(name);
    assert.ok(source, `package is present in source lock: ${name}`);
    assert.equal(source.version, requirement.version, `locked version: ${name}`);
    const windowsWheels = source.wheels.filter(({ url }) =>
      url.includes('win_amd64') || /py[^/]*-none-any\.whl$/.test(url));
    assert.ok(windowsWheels.length > 0, `Windows x64 or universal wheel: ${name}`);
    for (const wheel of windowsWheels) {
      assert.ok(requirement.hashes.has(wheel.hash), `wheel hash retained: ${wheel.url}`);
    }
  }
});

test('OCR subprocess forces UTF-8 output and decodes the Chinese resolver record', async (t) => {
  const ocrPath = require.resolve('../lib/dounai-captcha-ocr');
  const originalLoad = Module._load;
  const originalExistsSync = fs.existsSync.bind(fs);
  let executable;
  let spawnArgs;
  let spawnOptions;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = { resume() {} };
  child.stdin = new EventEmitter();
  child.stdin.end = (png) => {
    assert.ok(Buffer.isBuffer(png) && png.length > 0);
    process.nextTick(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({
        rows: [{ text: '陆x五=$', confidence: 0.76 }],
      }), 'utf8'));
      child.emit('close', 0);
    });
  };
  child.kill = () => {};
  const fakeSpawn = (command, args, options) => {
    executable = command;
    spawnArgs = args;
    spawnOptions = options;
    return child;
  };
  t.mock.method(fs, 'existsSync', (target) => {
    const normalized = String(target).replaceAll('\\', '/');
    if (normalized.endsWith('/tools/ocr/.venv/Scripts/python.exe') ||
        normalized.endsWith('/tools/ocr/recognize.py')) return true;
    return originalExistsSync(target);
  });

  delete require.cache[ocrPath];
  let isolatedOcr;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === ocrPath && request === 'node:child_process') return { spawn: fakeSpawn };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    isolatedOcr = require(ocrPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[ocrPath];
  }

  const result = await isolatedOcr.recognizeCaptchaImage(Buffer.from([1, 2, 3]));
  assert.equal(path.basename(executable), 'python.exe');
  assert.match(spawnArgs[0], /recognize\.py$/);
  assert.equal(spawnOptions.env.PYTHONIOENCODING, 'utf-8');
  assert.equal(spawnOptions.env.PYTHONUTF8, '1');
  assert.equal(result.answer, '30');
  assert.equal(result.rawText, '陆x五=$');
});

test('PowerShell entrypoints are BOM-free ASCII and preserve native failure codes', () => {
  const files = [
    'setup.ps1', 'login.ps1', 'signin.ps1', 'status.ps1', 'doctor.ps1', 'scripts/common.ps1',
  ];
  for (const relative of files) {
    const bytes = fs.readFileSync(path.join(packageRoot, relative));
    assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false, `${relative} BOM`);
    assert.equal(bytes.every((byte) => byte < 0x80), true, `${relative} non-ASCII content`);
  }
  const setup = fs.readFileSync(path.join(packageRoot, 'setup.ps1'), 'utf8');
  const common = fs.readFileSync(path.join(packageRoot, 'scripts/common.ps1'), 'utf8');
  assert.match(setup, /\[Parameter\(Mandatory = \$true\)\]\[string\]\$Account/);
  assert.match(setup, /npm\.cmd ci --no-audit --no-fund/);
  assert.match(setup, /--require-hashes --only-binary=:all:/);
  assert.match(common, /& node\.exe \(Join-Path \$DounaiPackageRoot 'app\.js'\) @DounaiArgs/);
  assert.match(common, /exit \$LASTEXITCODE/);
});

