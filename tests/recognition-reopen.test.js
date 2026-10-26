'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright-core');

const packageRoot = path.resolve(__dirname, '..');
const temporaryRoot = path.join(packageRoot, 'temp');
const TEST_ACCOUNT = process.env.DOUNAI_TEST_ACCOUNT || 'test-user';
const { findChrome } = require('../lib/config');
const accountApi = require('../lib/dounai-account');
const actualReadDounaiAccount = accountApi.readDounaiAccount;
const accountReads = [];
accountApi.readDounaiAccount = async (page, expectedAccount) => {
  accountReads.push(expectedAccount);
  return actualReadDounaiAccount(page, expectedAccount);
};
const { PANEL_URL } = accountApi;
const captchaOcr = require('../lib/dounai-captcha-ocr');
const { captureCaptchaEvidence } = require('../lib/dounai-diagnostics');
const { runDounaiSignin } = require('../sites/dounai');
const { shouldRetry } = require('../lib/dounai-retry');

const CHROME_EXECUTABLE = process.env.DOUNAI_TEST_CHROME_PATH ||
  (process.platform === 'win32' ? findChrome() : '');
let context;
let profileDir;
const cleanupDirs = new Set();

function makeTemporaryDirectory(prefix) {
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temporaryRoot, prefix));
  cleanupDirs.add(directory);
  return directory;
}

before(async () => {
  assert.ok(CHROME_EXECUTABLE && fs.existsSync(CHROME_EXECUTABLE),
    'Set DOUNAI_TEST_CHROME_PATH to the installed Chrome executable for local browser tests.');
  profileDir = makeTemporaryDirectory('dounai-recognition-reopen-profile-');
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

after(async () => {
  try {
    if (context) await context.close();
  } finally {
    if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true });
    for (const directory of cleanupDirs) fs.rmSync(directory, { recursive: true, force: true });
  }
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function panelHtml(options = {}, expectedAccount = TEST_ACCOUNT) {
  const fixture = {
    account: options.account ?? expectedAccount,
    accountAfterClose: options.accountAfterClose ?? null,
    closeCount: options.closeCount ?? 1,
    closeWorks: options.closeWorks !== false,
    closeEnabled: options.closeEnabled !== false,
    captchaVisible: options.captchaVisible !== false,
    securityAfterClose: options.securityAfterClose === true,
    pageJumpAfterClose: options.pageJumpAfterClose === true,
    sameChallengeOnReopen: options.sameChallengeOnReopen === true,
    initialModalVisible: options.initialModalVisible === true,
    initialInput: options.initialInput ?? '',
    clearOnInput: options.clearOnInput === true,
    submitMode: options.submitMode ?? 'success',
  };
  const closeButtons = Array.from({ length: fixture.closeCount }, () =>
    `<button type="button" class="close"${fixture.closeEnabled ? '' : ' disabled'}>×</button>`).join('');
  const fixtureJson = JSON.stringify(fixture).replace(/</g, '\\u003c');
  const accountText = escapeHtml(fixture.account);
  const initialInput = escapeHtml(fixture.initialInput);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Local fixture</title></head>
    <body>
      <div class="user-name-title">Hi! ${accountText}</div>
      <a href="/user/logout">退出</a>
      <button id="checkin" type="button">立即签到</button>
      <div id="checkin-captcha-modal" style="display:${fixture.initialModalVisible ? 'block' : 'none'}">
        ${closeButtons}
        <form id="checkin-captcha-form">
          <div id="checkin-captcha-box"></div>
          <input id="checkin_captcha_code" autocomplete="off" value="${initialInput}">
          <div id="checkin-captcha-err"></div>
          <button id="checkin-submit-btn" type="submit">提交验证码</button>
        </form>
      </div>
      <script>
        const fixture = ${fixtureJson};
        const state = window.__dounai = {
          checkinClicks: 0, closeClicks: 0, captchaButtonClicks: 0,
          captchaSubmits: 0, inputEvents: 0, challengeIds: [],
        };
        const modal = document.querySelector('#checkin-captcha-modal');
        const box = document.querySelector('#checkin-captcha-box');
        const checkin = document.querySelector('#checkin');
        const input = document.querySelector('#checkin_captcha_code');
        const submit = document.querySelector('#checkin-submit-btn');
        function setChallenge(id) {
          state.challengeIds.push(id);
          box.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="90" data-challenge="' + id + '">' +
            '<rect width="100%" height="100%" fill="#fff"/><text x="10" y="55" font-size="32">challenge-' + id + ' 12+7</text></svg>';
        }
        function markDone() {
          checkin.disabled = true;
          checkin.textContent = '今日已签到';
          modal.style.display = 'none';
        }
        if (fixture.initialModalVisible) setChallenge(1);
        window.__markDounaiDone = markDone;
        checkin.addEventListener('click', () => {
          state.checkinClicks += 1;
          if (!fixture.captchaVisible) {
            markDone();
            return;
          }
          const nextId = state.challengeIds.length + 1;
          if (!(fixture.sameChallengeOnReopen && state.checkinClicks > 1)) setChallenge(nextId);
          input.value = '';
          document.querySelector('#checkin-captcha-err').textContent = '';
          modal.style.display = 'block';
        });
        for (const close of document.querySelectorAll('button.close')) {
          close.addEventListener('click', () => {
            state.closeClicks += 1;
            if (fixture.accountAfterClose) document.querySelector('.user-name-title').textContent = 'Hi! ' + fixture.accountAfterClose;
            if (fixture.pageJumpAfterClose) history.pushState({}, '', '/changed-page');
            if (fixture.securityAfterClose) {
              document.title = 'Just a moment...';
              document.body.append('Performing security verification');
            }
            if (fixture.closeWorks) modal.style.display = 'none';
          });
        }
        input.addEventListener('input', () => {
          state.inputEvents += 1;
          if (fixture.clearOnInput) input.value = '';
        });
        submit.addEventListener('click', () => { state.captchaButtonClicks += 1; });
        document.querySelector('#checkin-captcha-form').addEventListener('submit', (event) => {
          event.preventDefault();
          state.captchaSubmits += 1;
          if (input.value !== '19') {
            document.querySelector('#checkin-captcha-err').textContent = '验证码错误';
          } else if (fixture.submitMode === 'success') {
            markDone();
          } else if (fixture.submitMode === 'rejected') {
            document.querySelector('#checkin-captcha-err').textContent = '验证码错误或过期';
          }
        });
      </script>
    </body></html>`;
}

async function withFixture(options, callback, expectedAccount = TEST_ACCOUNT) {
  const page = await context.newPage();
  const requests = { servedUrls: [], blockedUrls: [] };
  accountReads.length = 0;
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === PANEL_URL) {
      requests.servedUrls.push(url);
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: panelHtml(options, expectedAccount),
      });
      return;
    }
    requests.blockedUrls.push(url);
    await route.abort('blockedbyclient');
  });
  try {
    const result = await callback(page, expectedAccount);
    assert.deepEqual(requests.servedUrls, [PANEL_URL], 'only the exact local panel route was fulfilled');
    assert.ok(requests.blockedUrls.every((url) => url !== PANEL_URL));
    assert.ok(accountReads.length > 0, 'the configured account was checked on the fixture route');
    assert.ok(accountReads.every((account) => account === expectedAccount),
      'every account check, including reopened challenges, uses the configured account');
    return result;
  } finally {
    await page.close().catch(() => {});
  }
}

async function pageEffects(page) {
  return page.evaluate(() => ({
    ...window.__dounai,
    inputValue: document.querySelector('#checkin_captcha_code')?.value ?? '',
    modalVisible: Boolean(document.querySelector('#checkin-captcha-modal')?.getClientRects().length),
    signedMarker: Boolean([...document.querySelectorAll('button')].some((button) =>
      button.disabled && button.textContent.includes('今日已签到'))),
    pathname: location.pathname,
  }));
}

function mockRecognition(t, page, behaviors) {
  const hashes = [];
  const mock = t.mock.method(captchaOcr, 'recognizeCaptchaImage', async (png) => {
    const attempt = hashes.length + 1;
    hashes.push(crypto.createHash('sha256').update(png).digest('hex'));
    const behavior = behaviors[attempt - 1] || {};
    if (behavior.before) await behavior.before(page, attempt, png);
    if (behavior.error) {
      const error = captchaOcr.captchaError(behavior.error, `fixture ${behavior.error}`);
      error.captchaStage = behavior.stage ?? 'recognition';
      error.ocrDiagnostic = {
        engine: 'fixture',
        rawText: behavior.rawText ?? `fixture raw ${attempt}`,
        confidence: behavior.confidence ?? 0.6 + attempt / 100,
        reason: 'fixture-only',
      };
      throw error;
    }
    return {
      expression: '12+7',
      answer: '19',
      confidence: behavior.confidence ?? 0.99,
      recognitionMode: 'fixture-only',
      engine: 'fixture',
      rawText: behavior.rawText ?? `fixture success ${attempt}`,
    };
  });
  return { mock, hashes };
}

function historyOf(result) {
  return result.details?.captchaAttempts ?? [];
}

test('missing equals delimiter is intercepted before fill or submit and the five-attempt budget blocks further action', async (t) => {
  const rawText = '4乘七三';
  const confidence = 0.85058;
  const mock = t.mock.method(captchaOcr, 'recognizeCaptchaImage', async () =>
    captchaOcr.resolveRapidRecognition({ rows: [{ text: rawText, confidence }] }));
  const captchaAttempts = { count: 0 };

  await withFixture({}, async (page, expectedAccount) => {
    const result = await runDounaiSignin(page, {
      expectedAccount,
      timeoutMs: 800,
      autoCaptcha: true,
      captchaAttempts,
    });
    const effects = await pageEffects(page);

    assert.equal(result.status, 'verification_required');
    assert.equal(mock.mock.callCount(), 5);
    assert.equal(captchaAttempts.count, 5);
    assert.equal(effects.checkinClicks, 5);
    assert.equal(effects.closeClicks, 4);
    assert.equal(effects.inputEvents, 0);
    assert.equal(effects.inputValue, '');
    assert.equal(effects.captchaButtonClicks, 0);
    assert.equal(effects.captchaSubmits, 0);
    assert.deepEqual(historyOf(result).map((attempt) => attempt.captchaRecognition), Array(5).fill({
      engine: 'rapidocr', rawText, confidence, reason: 'missing_equals_delimiter',
    }));

    const screenshotDir = path.join(temporaryRoot, 'terminator-sync-20261026');
    const screenshotPath = path.join(screenshotDir, 'synthetic-terminator-interception.png');
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.evaluate(() => {
      const marker = document.createElement('div');
      marker.textContent = 'SYNTHETIC TEST — missing equals delimiter intercepted before fill or submit';
      Object.assign(marker.style, {
        position: 'fixed', bottom: '0', left: '0', zIndex: '999999',
        padding: '8px', background: '#fff4cc', color: '#222', font: '14px sans-serif',
      });
      document.body.append(marker);
    });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    assert.ok(fs.statSync(screenshotPath).size > 0);
  });

  await withFixture({}, async (page, expectedAccount) => {
    const result = await runDounaiSignin(page, {
      expectedAccount,
      timeoutMs: 800,
      autoCaptcha: true,
      captchaAttempts,
    });
    const effects = await pageEffects(page);

    assert.equal(result.status, 'verification_required');
    assert.equal(result.details.captchaAttemptsUsed, 5);
    assert.equal(mock.mock.callCount(), 5);
    assert.equal(effects.checkinClicks, 0);
    assert.equal(effects.inputEvents, 0);
    assert.equal(effects.captchaButtonClicks, 0);
    assert.equal(effects.captchaSubmits, 0);
  });
});

test('five failed recognition attempts use fresh images, close four times, and preserve per-attempt evidence', async (t) => {
  await withFixture({}, async (page, expectedAccount) => {
    const behaviors = Array.from({ length: 5 }, (_, index) => ({
      error: 'uncertain_recognition',
      rawText: `synthetic raw ${index + 1}`,
      confidence: 0.6 + index / 100,
    }));
    const { mock, hashes } = mockRecognition(t, page, behaviors);
    const baseDir = makeTemporaryDirectory('dounai-reopen-evidence-');
    const captures = [];
    const result = await runDounaiSignin(page, {
      expectedAccount,
      timeoutMs: 800,
      autoCaptcha: true,
      captchaAttempts: { count: 0 },
      captureCaptcha: async ({ recognitionAttempt }) => {
        const capture = await captureCaptchaEvidence(page, {
          baseDir,
          attemptId: 'five-failures',
          timeoutMs: 800,
          recognitionAttempt,
        });
        captures.push(capture);
        return capture;
      },
    });
    const effects = await pageEffects(page);

    assert.equal(result.status, 'verification_required');
    assert.equal(mock.mock.callCount(), 5);
    assert.equal(effects.checkinClicks, 5);
    assert.equal(effects.closeClicks, 4);
    assert.equal(effects.inputEvents, 0);
    assert.equal(effects.inputValue, '');
    assert.equal(effects.captchaButtonClicks, 0);
    assert.equal(effects.captchaSubmits, 0);
    assert.equal(new Set(hashes).size, 5, 'each OCR attempt must receive a distinct new image');

    const attempts = historyOf(result);
    assert.equal(attempts.length, 5);
    assert.deepEqual(attempts.map((item) => item.captchaError), Array(5).fill('uncertain_recognition'));
    assert.deepEqual(attempts.map((item) => item.captchaStage), Array(5).fill('recognition'));
    assert.deepEqual(attempts.map((item) => item.captchaRecognition.rawText),
      behaviors.map((item) => item.rawText));
    assert.deepEqual(attempts.map((item) => item.captchaRecognition.confidence),
      behaviors.map((item) => item.confidence));
    assert.equal(captures.length, 5);
    assert.equal(new Set(captures.map((item) => item.image)).size, 5);
    for (const capture of captures) {
      assert.ok(fs.statSync(path.join(baseDir, capture.image)).size > 0, capture.image);
    }
    assert.deepEqual(attempts.map((item) => item.captchaEvidence.image), captures.map((item) => item.image));
  });
});

test('a fifth-round success submits once and keeps all earlier recognition diagnostics', async (t) => {
  await withFixture({}, async (page, expectedAccount) => {
    const behaviors = Array.from({ length: 4 }, (_, index) => ({
      error: 'unsupported_expression', rawText: `failed raw ${index + 1}`, confidence: 0.7 + index / 100,
    }));
    behaviors.push({ rawText: '12+7=?', confidence: 0.98 });
    const { mock } = mockRecognition(t, page, behaviors);
    const result = await runDounaiSignin(page, {
      expectedAccount, timeoutMs: 800, autoCaptcha: true, captchaAttempts: { count: 0 },
    });
    const effects = await pageEffects(page);

    assert.equal(result.status, 'signed');
    assert.equal(mock.mock.callCount(), 5);
    assert.equal(effects.checkinClicks, 5);
    assert.equal(effects.closeClicks, 4);
    assert.equal(effects.inputValue, '19');
    assert.equal(effects.captchaButtonClicks, 1);
    assert.equal(effects.captchaSubmits, 1);
    assert.equal(effects.signedMarker, true);
    assert.deepEqual(historyOf(result).slice(0, 4).map((item) => item.captchaRecognition.rawText),
      ['failed raw 1', 'failed raw 2', 'failed raw 3', 'failed raw 4']);
    assert.deepEqual(historyOf(result).slice(0, 4).map((item) => item.captchaRecognition.confidence),
      [0.7, 0.71, 0.72, 0.73]);
    assert.equal(historyOf(result)[4].captchaRecognition.rawText, '12+7=?');
    assert.equal(result.details.captchaRecognition.rawText, '12+7=?');
  });
});

test('only the three pre-fill recognition error classes reopen; unavailable OCR stops', async (t) => {
  for (const code of ['uncertain_recognition', 'unsupported_expression', 'ocr_failed']) {
    await withFixture({}, async (page, expectedAccount) => {
      const { mock } = mockRecognition(t, page, [{ error: code }, {}]);
      const result = await runDounaiSignin(page, {
        expectedAccount, timeoutMs: 800, autoCaptcha: true, captchaAttempts: { count: 0 },
      });
      const effects = await pageEffects(page);
      assert.equal(result.status, 'signed', code);
      assert.equal(mock.mock.callCount(), 2, code);
      assert.equal(effects.closeClicks, 1, code);
      assert.equal(effects.captchaSubmits, 1, code);
      mock.mock.restore();
    });
  }

  await withFixture({}, async (page, expectedAccount) => {
    const { mock } = mockRecognition(t, page, [{ error: 'ocr_unavailable' }]);
    const result = await runDounaiSignin(page, {
      expectedAccount, timeoutMs: 500, autoCaptcha: true, captchaAttempts: { count: 0 },
    });
    const effects = await pageEffects(page);
    assert.equal(result.status, 'verification_required');
    assert.equal(mock.mock.callCount(), 1);
    assert.equal(effects.checkinClicks, 1);
    assert.equal(effects.closeClicks, 0);
    assert.equal(effects.captchaSubmits, 0);
    mock.mock.restore();
  });
});

test('missing or failed close controls and user input stop recognition reopening', async (t) => {
  for (const options of [{ closeCount: 0 }, { closeCount: 2 }, { closeEnabled: false }]) {
    await withFixture(options, async (page, expectedAccount) => {
      const { mock } = mockRecognition(t, page, [{ error: 'uncertain_recognition' }]);
      const result = await runDounaiSignin(page, {
        expectedAccount, timeoutMs: 500, autoCaptcha: true, captchaAttempts: { count: 0 },
      });
      const effects = await pageEffects(page);
      assert.equal(mock.mock.callCount(), 1);
      assert.equal(effects.checkinClicks, 1);
      assert.equal(effects.closeClicks, 0);
      assert.equal(effects.captchaSubmits, 0);
      assert.equal(historyOf(result)[0].reopenStopped, 'close_button_unavailable');
      mock.mock.restore();
    });
  }

  await withFixture({ closeWorks: false }, async (page, expectedAccount) => {
    const { mock } = mockRecognition(t, page, [{ error: 'uncertain_recognition' }]);
    const result = await runDounaiSignin(page, {
      expectedAccount, timeoutMs: 200, autoCaptcha: true, captchaAttempts: { count: 0 },
    });
    const effects = await pageEffects(page);
    assert.equal(mock.mock.callCount(), 1);
    assert.equal(effects.closeClicks, 1);
    assert.equal(effects.captchaSubmits, 0);
    assert.equal(result.status, 'unconfirmed');
    mock.mock.restore();
  });

  await withFixture({ initialModalVisible: true, initialInput: 'user-entered' }, async (page, expectedAccount) => {
    const { mock } = mockRecognition(t, page, [{}]);
    const result = await runDounaiSignin(page, {
      expectedAccount, timeoutMs: 500, autoCaptcha: true, captchaAttempts: { count: 0 },
    });
    const effects = await pageEffects(page);
    assert.equal(mock.mock.callCount(), 0);
    assert.equal(effects.checkinClicks, 0);
    assert.equal(effects.closeClicks, 0);
    assert.equal(effects.inputValue, 'user-entered');
    assert.equal(effects.captchaSubmits, 0);
    assert.equal(shouldRetry(result, { retryCaptcha: true }), false);
    mock.mock.restore();
  });

  await withFixture({}, async (page, expectedAccount) => {
    const { mock } = mockRecognition(t, page, [{
      error: 'uncertain_recognition',
      before: (currentPage) => currentPage.locator('#checkin_captcha_code').fill('user-entered'),
    }]);
    const result = await runDounaiSignin(page, {
      expectedAccount, timeoutMs: 500, autoCaptcha: true, captchaAttempts: { count: 0 },
    });
    const effects = await pageEffects(page);
    assert.equal(mock.mock.callCount(), 1);
    assert.equal(effects.closeClicks, 0);
    assert.equal(effects.inputValue, 'user-entered');
    assert.equal(effects.captchaSubmits, 0);
    assert.equal(historyOf(result)[0].reopenStopped, 'input_not_empty_or_unavailable');
    mock.mock.restore();
  });
});

test('account, security, page, and image changes stop reopening before another OCR call', async (t) => {
  await withFixture({ accountAfterClose: 'other-test-user' }, async (page, expectedAccount) => {
    const { mock } = mockRecognition(t, page, [{ error: 'uncertain_recognition' }, {}]);
    const result = await runDounaiSignin(page, {
      expectedAccount, timeoutMs: 500, autoCaptcha: true, captchaAttempts: { count: 0 },
    });
    const effects = await pageEffects(page);
    assert.equal(mock.mock.callCount(), 1);
    assert.equal(effects.closeClicks, 1);
    assert.equal(effects.checkinClicks, 1);
    assert.equal(result.status, 'account_mismatch');
    mock.mock.restore();
  });

  await withFixture({ securityAfterClose: true }, async (page, expectedAccount) => {
    const { mock } = mockRecognition(t, page, [{ error: 'uncertain_recognition' }, {}]);
    const result = await runDounaiSignin(page, {
      expectedAccount, timeoutMs: 500, autoCaptcha: true, captchaAttempts: { count: 0 },
    });
    const effects = await pageEffects(page);
    assert.equal(mock.mock.callCount(), 1);
    assert.equal(effects.closeClicks, 1);
    assert.equal(effects.checkinClicks, 1);
    assert.equal(effects.captchaSubmits, 0);
    assert.equal(result.status, 'verification_required');
    mock.mock.restore();
  });

  await withFixture({ pageJumpAfterClose: true }, async (page, expectedAccount) => {
    const { mock } = mockRecognition(t, page, [{ error: 'uncertain_recognition' }, {}]);
    const result = await runDounaiSignin(page, {
      expectedAccount, timeoutMs: 500, autoCaptcha: true, captchaAttempts: { count: 0 },
    });
    const effects = await pageEffects(page);
    assert.equal(mock.mock.callCount(), 1);
    assert.equal(effects.closeClicks, 1);
    assert.equal(effects.checkinClicks, 1);
    assert.equal(effects.pathname, '/changed-page');
    assert.notEqual(result.status, 'signed');
    mock.mock.restore();
  });

  await withFixture({ sameChallengeOnReopen: true }, async (page, expectedAccount) => {
    const { mock } = mockRecognition(t, page, [{ error: 'uncertain_recognition' }, {}]);
    const result = await runDounaiSignin(page, {
      expectedAccount, timeoutMs: 200, autoCaptcha: true, captchaAttempts: { count: 0 },
    });
    const effects = await pageEffects(page);
    assert.equal(mock.mock.callCount(), 1);
    assert.equal(effects.closeClicks, 1);
    assert.equal(effects.checkinClicks, 2);
    assert.equal(effects.captchaSubmits, 0);
    assert.equal(result.status, 'unconfirmed');
    mock.mock.restore();
  });
});

test('filled, changed, rejected, and unconfirmed challenges do not use the reopen path', async (t) => {
  await withFixture({ clearOnInput: true }, async (page, expectedAccount) => {
    const { mock } = mockRecognition(t, page, [{}]);
    const result = await runDounaiSignin(page, {
      expectedAccount, timeoutMs: 500, autoCaptcha: true, captchaAttempts: { count: 0 },
    });
    const effects = await pageEffects(page);
    assert.equal(mock.mock.callCount(), 1);
    assert.equal(result.details.captchaError, 'captcha_changed');
    assert.equal(effects.closeClicks, 0);
    assert.equal(effects.captchaSubmits, 0);
    mock.mock.restore();
  });

  await withFixture({}, async (page, expectedAccount) => {
    const { mock } = mockRecognition(t, page, [{
      before: (currentPage) => currentPage.locator('.user-name-title').evaluate((element) => {
        element.textContent = 'Hi! other-test-user';
      }),
    }]);
    const result = await runDounaiSignin(page, {
      expectedAccount, timeoutMs: 500, autoCaptcha: true, captchaAttempts: { count: 0 },
    });
    const effects = await pageEffects(page);
    assert.equal(mock.mock.callCount(), 1);
    assert.equal(result.status, 'account_mismatch');
    assert.equal(result.details.captchaStage, 'after_ocr');
    assert.equal(effects.closeClicks, 0);
    assert.equal(effects.captchaSubmits, 0);
    mock.mock.restore();
  });

  for (const submitMode of ['rejected', 'pending']) {
    await withFixture({ submitMode }, async (page, expectedAccount) => {
      const { mock } = mockRecognition(t, page, [{}]);
      const result = await runDounaiSignin(page, {
        expectedAccount, timeoutMs: 500, autoCaptcha: true, captchaAttempts: { count: 0 },
      });
      const effects = await pageEffects(page);
      assert.equal(mock.mock.callCount(), 1);
      assert.equal(effects.checkinClicks, 1);
      assert.equal(effects.closeClicks, 0);
      assert.equal(effects.captchaButtonClicks, 1);
      assert.equal(effects.captchaSubmits, 1);
      assert.equal(result.status, submitMode === 'rejected' ? 'captcha_rejected' : 'unconfirmed');
      mock.mock.restore();
    });
  }
});

test('the configured account is used through the signin flow', async (t) => {
  const configuredAccount = 'fixture-user-103';
  await withFixture({ account: configuredAccount, captchaVisible: false }, async (page, expectedAccount) => {
    const { mock } = mockRecognition(t, page, []);
    const result = await runDounaiSignin(page, {
      expectedAccount,
      timeoutMs: 500,
      autoCaptcha: true,
      captchaAttempts: { count: 0 },
    });
    const effects = await pageEffects(page);
    assert.equal(result.status, 'signed');
    assert.equal(mock.mock.callCount(), 0);
    assert.equal(effects.checkinClicks, 1);
    assert.equal(effects.captchaSubmits, 0);
  }, configuredAccount);
});
