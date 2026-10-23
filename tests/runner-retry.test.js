'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');

const packageRoot = path.resolve(__dirname, '..');
const appPath = path.join(packageRoot, 'app.js');
const realLockfile = require('../lib/lockfile');
const realLogging = require('../lib/logging');
let activeScenario;

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent?.filename === appPath && request === './sites/dounai') {
    return {
      runDounaiSignin: async (page, options) => {
        const { state, settings } = activeScenario;
        const call = ++state.signinCalls;
        state.events.push(`adapter:${page.attempt}:${options.autoCaptcha}:${options.expectedAccount}`);
        state.captchaAttemptRefs.push(options.captchaAttempts);
        state.captchaAttemptCounts.push(options.captchaAttempts?.count);
        const budgetStep = settings.captchaBudgetSteps?.[call - 1];
        if (budgetStep) {
          assert.equal(options.captchaAttempts?.count, budgetStep.start);
          options.captchaAttempts.count = budgetStep.end;
        }
        if ((settings.throwAdapterOn || []).includes(call)) throw new Error('mock adapter failure');
        return structuredClone(settings.outcomes[call - 1] || {
          ok: false, status: 'runner_error', message: 'no mock outcome',
        });
      },
    };
  }
  if (parent?.filename === appPath && request === './lib/lockfile') {
    return {
      withExclusiveLock: async (lockFile, work) => {
        const { state } = activeScenario;
        const call = ++state.lockCalls;
        state.events.push(`lock:acquire:${call}`);
        try {
          return await realLockfile.withExclusiveLock(lockFile, work);
        } finally {
          state.events.push(`lock:release:${call}`);
        }
      },
    };
  }
  if (parent?.filename === appPath && request === './lib/logging') {
    return {
      appendLog: (logFile, result) => {
        activeScenario.state.events.push(`save:${result.attempt}:${result.status}`);
        return realLogging.appendLog(logFile, result);
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { main } = require(appPath);
Module._load = originalLoad;

function createHarness(t, settings = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dounai isolated runner '));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(baseDir, 'config.json'), `${JSON.stringify({
    expectedAccount: 'test-user', chromePath: path.join(packageRoot, 'app.js'), headless: true, timeoutMs: 1000,
  }, null, 2)}\n`);
  const state = {
    events: [], waits: [], profiles: [], pages: [], launchOptions: [], accountChecks: [],
    captchaAttemptRefs: [], captchaAttemptCounts: [],
    launches: 0, lockCalls: 0, signinCalls: 0, pageWaits: 0, fakeTime: 1000,
  };
  const scenario = { state, settings };

  const chromium = {
    launchPersistentContext: async (userDataDir, options) => {
      const attempt = ++state.launches;
      state.profiles.push(userDataDir);
      state.launchOptions.push(options);
      state.events.push(`launch:${attempt}`);
      return {
        newPage: async () => {
          state.pages.push(attempt);
          state.events.push(`page:${attempt}`);
          return {
            attempt,
            goto: async () => ({ status: () => 200 }),
            evaluate: async (_callback, parameters) => {
              if (parameters?.panelUrl) {
                state.accountChecks.push(parameters.expectedAccount);
                return settings.accountCheck || {
                  ok: true, loggedIn: true, reason: 'confirmed',
                  counts: { accountTotal: 1, accountVisible: 1, accountMatching: 1, logoutTotal: 1, logoutVisible: 1 },
                };
              }
              state.events.push(`diagnostics:${attempt}`);
              return {
                url: 'https://dounai.pro/user/panel?private=fixture#private-fragment',
                title: 'Local fixture', loginFormVisible: false, captchaVisible: true,
                captchaErrorText: settings.pageErrorText || '模拟页面拒绝提示',
              };
            },
            locator: () => ({}),
            screenshot: async ({ path: screenshotPath }) => {
              state.events.push(`screenshot:${attempt}`);
              if ((settings.screenshotFails || []).includes(attempt)) throw new Error('mock screenshot failure');
              fs.writeFileSync(screenshotPath, Buffer.from(`mock screenshot ${attempt}`));
            },
            getByRole: () => ({ screenshot: async () => state.events.push(`success-screenshot:${attempt}`) }),
            waitForTimeout: async (milliseconds) => {
              state.pageWaits += 1;
              state.fakeTime += milliseconds;
            },
          };
        },
        close: async () => {
          state.events.push(`close:${attempt}`);
          if ((settings.closeFails || []).includes(attempt)) throw new Error('mock close failure');
        },
      };
    },
  };

  async function run(args, waitObserver) {
    activeScenario = scenario;
    try {
      return await main(args, {
        baseDir, chromium,
        wait: async (milliseconds) => {
          state.waits.push(milliseconds);
          state.events.push(`wait:${milliseconds}`);
          await waitObserver?.(milliseconds);
        },
      });
    } finally {
      activeScenario = undefined;
    }
  }

  return { baseDir, state, run };
}

function resultFile(baseDir, result) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, result.record), 'utf8'));
}

function assertBefore(events, first, second) {
  const firstIndex = events.indexOf(first);
  const secondIndex = events.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing event: ${first}`);
  assert.notEqual(secondIndex, -1, `missing event: ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} should precede ${second}`);
}

function failed(status, details = {}) {
  return { ok: false, status, message: `mock ${status}`, timestamp: `mock-${status}`, details };
}

test('signin --retry-captcha records rejection before waiting and reopens the same package profile', async (t) => {
  t.mock.method(console, 'log', () => {});
  const harness = createHarness(t, {
    outcomes: [
      failed('captcha_rejected', { captchaRecognition: { rawText: 'mock text', confidence: 0.91, expression: '4+3' } }),
      { ok: true, status: 'signed', message: 'mock success', timestamp: 'mock-signed' },
    ],
    screenshotFails: [1], closeFails: [1, 2],
  });
  const { baseDir, state } = harness;
  const code = await harness.run(['signin', '--retry-captcha'], async () => {
    if (state.waits.length === 1) {
      const status = JSON.parse(fs.readFileSync(path.join(baseDir, 'data/dounai-signin-status.json'), 'utf8'));
      state.firstRecord = status.record;
      assert.equal(status.status, 'captcha_rejected');
      assert.equal(fs.existsSync(path.join(baseDir, '.signin.lock')), false);
      assert.equal(resultFile(baseDir, status).details.captchaRecognition.rawText, 'mock text');
    }
  });

  assert.equal(code, 0);
  assert.deepEqual(state.events.filter((event) => event.startsWith('adapter:')), [
    'adapter:1:true:test-user', 'adapter:2:true:test-user',
  ]);
  assert.deepEqual(state.profiles, [path.join(baseDir, 'profiles/chrome'), path.join(baseDir, 'profiles/chrome')]);
  assert.deepEqual(state.pages, [1, 2]);
  assert.deepEqual(state.waits, [60000, 60000, 60000]);
  assertBefore(state.events, 'diagnostics:1', 'close:1');
  assertBefore(state.events, 'screenshot:1', 'close:1');
  assertBefore(state.events, 'close:1', 'lock:release:1');
  assertBefore(state.events, 'lock:release:1', 'save:1:captcha_rejected');
  assertBefore(state.events, 'save:1:captcha_rejected', 'wait:60000');
  assertBefore(state.events, 'wait:60000', 'launch:2');

  const status = JSON.parse(fs.readFileSync(path.join(baseDir, 'data/dounai-signin-status.json'), 'utf8'));
  const first = resultFile(baseDir, { record: state.firstRecord });
  assert.deepEqual([first.attempt, first.status], [1, 'captcha_rejected']);
  assert.equal(first.details.captchaRecognition.rawText, 'mock text');
  assert.equal(first.details.diagnostics.screenshotWarning, '失败页面截图未保存；请查看页面状态与错误记录。');
  assert.match(first.browserCloseWarning, /did not close normally/);
  assert.deepEqual([status.attempt, status.status], [2, 'signed']);
  assert.notEqual(status.record, state.firstRecord);
  assert.equal(status.retry.previousRecord, state.firstRecord);
  assert.match(status.browserCloseWarning, /did not close normally/);
  assert.equal(fs.existsSync(path.join(baseDir, 'profiles/chrome')), false, 'mock Chromium did not create a real profile');
});

test('network failure followed by CAPTCHA rejection stops at two attempts and disables retry CAPTCHA by default', async (t) => {
  t.mock.method(console, 'log', () => {});
  const harness = createHarness(t, {
    outcomes: [failed('network_error'), failed('captcha_rejected'), { ok: true, status: 'signed', message: 'must not run' }],
  });
  const code = await harness.run(['signin']);

  assert.equal(code, 1);
  assert.deepEqual(harness.state.events.filter((event) => event.startsWith('adapter:')), [
    'adapter:1:true:test-user', 'adapter:2:false:test-user',
  ]);
  assert.deepEqual(harness.state.waits, [60000, 60000, 60000]);
  assert.equal(harness.state.launches, 2);
  const status = JSON.parse(fs.readFileSync(path.join(harness.baseDir, 'data/dounai-signin-status.json'), 'utf8'));
  assert.deepEqual([status.attempt, status.status], [2, 'captcha_rejected']);
  assert.equal(status.retry.exhausted, true);
});

test('an explicit second CAPTCHA rejection stops, while default rejection remains single-attempt', async (t) => {
  t.mock.method(console, 'log', () => {});
  const retry = createHarness(t, { outcomes: [failed('captcha_rejected'), failed('captcha_rejected')] });
  assert.equal(await retry.run(['signin', '--retry-captcha']), 1);
  assert.equal(retry.state.launches, 2);
  assert.deepEqual(retry.state.events.filter((event) => event.startsWith('adapter:')), [
    'adapter:1:true:test-user', 'adapter:2:true:test-user',
  ]);
  assert.deepEqual(retry.state.waits, [60000, 60000, 60000]);
  const finalRetry = JSON.parse(fs.readFileSync(path.join(retry.baseDir, 'data/dounai-signin-status.json'), 'utf8'));
  assert.deepEqual([finalRetry.attempt, finalRetry.status], [2, 'captcha_rejected']);

  const noRetry = createHarness(t, { outcomes: [failed('captcha_rejected')] });
  assert.equal(await noRetry.run(['signin']), 1);
  assert.equal(noRetry.state.launches, 1);
  assert.deepEqual(noRetry.state.waits, []);
  const finalDefault = JSON.parse(fs.readFileSync(path.join(noRetry.baseDir, 'data/dounai-signin-status.json'), 'utf8'));
  assert.deepEqual([finalDefault.attempt, finalDefault.status], [1, 'captcha_rejected']);
  assert.equal(finalDefault.retry.scheduled, false);
});

test('signin shares the five-recognition budget across an outer browser retry', async (t) => {
  t.mock.method(console, 'log', () => {});
  const harness = createHarness(t, {
    outcomes: [failed('network_error'), failed('verification_required')],
    captchaBudgetSteps: [{ start: 0, end: 4 }, { start: 4, end: 5 }],
  });

  assert.equal(await harness.run(['signin', '--retry-captcha']), 1);
  assert.deepEqual(harness.state.events.filter((event) => event.startsWith('adapter:')), [
    'adapter:1:true:test-user', 'adapter:2:true:test-user',
  ]);
  assert.deepEqual(harness.state.captchaAttemptCounts, [0, 4]);
  assert.equal(harness.state.captchaAttemptRefs.length, 2);
  assert.ok(harness.state.captchaAttemptRefs[0]);
  assert.strictEqual(harness.state.captchaAttemptRefs[0], harness.state.captchaAttemptRefs[1]);
  assert.equal(harness.state.captchaAttemptRefs[0].count, 5);
  assert.equal(harness.state.launches, 2);
  assert.deepEqual(harness.state.waits, [60000, 60000, 60000]);
  const status = JSON.parse(fs.readFileSync(path.join(harness.baseDir, 'data/dounai-signin-status.json'), 'utf8'));
  assert.equal(status.status, 'verification_required');
  assert.equal(status.attempt, 2);
});

test('login failure and status read do not enter the signin retry flow', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const login = createHarness(t, {
    accountCheck: {
      ok: false, loggedIn: false, reason: 'logout_missing',
      counts: { accountTotal: 0, accountVisible: 0, accountMatching: 0, logoutTotal: 0, logoutVisible: 0 },
    },
  });
  const originalNow = Date.now;
  Date.now = () => login.state.fakeTime;
  let loginCode;
  try {
    loginCode = await login.run(['login']);
  } finally {
    Date.now = originalNow;
  }
  assert.equal(loginCode, 1);
  assert.equal(login.state.launches, 1);
  assert.equal(login.state.signinCalls, 0);
  assert.deepEqual(login.state.waits, []);
  assert.equal(login.state.accountChecks.every((account) => account === 'test-user'), true);
  const loginStatus = JSON.parse(fs.readFileSync(path.join(login.baseDir, 'data/login-status.json'), 'utf8'));
  assert.equal(loginStatus.status, 'auth_required');
  assert.ok(loginStatus.details.diagnostics.screenshot);
  assert.equal(fs.existsSync(path.join(login.baseDir, 'data/dounai-signin-status.json')), false);

  const status = createHarness(t);
  const statusFile = path.join(status.baseDir, 'data/dounai-signin-status.json');
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(statusFile, `${JSON.stringify({
    site: 'dounai', ok: false, status: 'captcha_rejected', timestamp: new Date().toISOString(),
  })}\n`);
  const before = fs.readFileSync(statusFile);
  assert.equal(await status.run(['status']), 1);
  assert.deepEqual(fs.readFileSync(statusFile), before);
  assert.equal(status.state.launches, 0);
  assert.equal(status.state.signinCalls, 0);
  assert.deepEqual(status.state.waits, []);
});
