'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require('playwright-core');

const { findChrome } = require('../lib/config');
const { PANEL_URL } = require('../lib/dounai-account');
const { dismissDounaiNotice } = require('../lib/dounai-notice');
const { waitForLogin } = require('../app');
const { runDounaiSignin } = require('../sites/dounai');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TASK_DIR = path.basename(PROJECT_ROOT) === 'release'
  ? path.dirname(PROJECT_ROOT)
  : path.join(PROJECT_ROOT, 'temp/notice-win-20261031');
const TEST_ACCOUNT = (process.env.DOUNAI_TEST_ACCOUNT || 'friend-test').trim();
const CHROME_EXECUTABLE = process.env.DOUNAI_TEST_CHROME_PATH ||
  (process.platform === 'win32'
    ? findChrome()
    : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const PANEL_ORIGIN = new URL(PANEL_URL).origin;

let browserContext;
let profileDir;

test.before(async () => {
  assert.ok(TEST_ACCOUNT, 'Set DOUNAI_TEST_ACCOUNT to a test username.');
  assert.ok(fs.existsSync(CHROME_EXECUTABLE), `System Chrome not found: ${CHROME_EXECUTABLE}`);
  fs.mkdirSync(TASK_DIR, { recursive: true });
  profileDir = fs.mkdtempSync(path.join(TASK_DIR, 'profile-notice-'));
  browserContext = await chromium.launchPersistentContext(profileDir, {
    executablePath: CHROME_EXECUTABLE,
    headless: false,
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
    if (browserContext) await browserContext.close();
  } finally {
    if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function panelHtml(fixture = {}) {
  const heading = fixture.noticeHeading ?? '消息提示';
  const ackLabel = fixture.noticeButton ?? '好的，我知道了';
  const hiddenStyle = fixture.noticeInitiallyHidden ? ' style="display: none;"' : '';
  const noticeMarkup = fixture.notice === false ? '' : [
    `<div id="notice" class="overlay"${hiddenStyle}>`,
    '<section class="notice" role="dialog" aria-modal="true">',
    `<h2>${escapeHtml(heading)}</h2>`,
    '<p>SYNTHETIC fixture announcement. No live account or site data.</p>',
    fixture.noticeInput ? '<form><input aria-label="verification code"></form>' : '',
    `<button id="notice-ack">${escapeHtml(ackLabel)}</button>`,
    '</section>',
    '</div>',
  ].join('\n');
  const noticeTemplate = noticeMarkup
    ? `<template id="notice-template">${noticeMarkup}</template>`
    : '';
  const notice = noticeMarkup && fixture.noticeInsertDelayMs === undefined ? noticeMarkup : '';
  const hideDelay = fixture.noticeHideDelayMs ?? 200;
  const initialDone = Boolean(fixture.initialDone);
  const account = JSON.stringify(TEST_ACCOUNT);
  const loginScript = fixture.loggedIn === false
    ? [
      `setTimeout(() => { document.querySelector('.user-name-title').textContent = 'Hi! ' + ${account};`,
      'const logout = document.createElement("a"); logout.href = "/user/logout"; logout.textContent = "退出";',
      'document.body.append(logout); window.__events.push("login_ready"); }, ' + (fixture.loginAfterMs ?? 100) + ');',
    ].join('\n')
    : '';
  const initialAccount = fixture.loggedIn === false ? 'waiting-for-login' : TEST_ACCOUNT;
  const logoutLink = fixture.loggedIn === false ? '' : '<a href="/user/logout">退出</a>';
  const checkinDisabled = initialDone ? ' disabled' : '';
  const checkinText = initialDone ? '今日已签到' : '立即签到';

  return [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8"><title>豆奶用户面板</title>',
    '<style>',
    'body { margin: 0; min-height: 100vh; font: 16px -apple-system, sans-serif; }',
    '#checkin { position: absolute; left: 32px; top: 150px; }',
    '.overlay { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; background: #0008; }',
    '.notice { width: 340px; padding: 24px; border-radius: 12px; background: white; }',
    '</style></head><body>',
    '<div class="synthetic-stamp">SYNTHETIC TEST FIXTURE</div>',
    `<div class="user-name-title">Hi! ${escapeHtml(initialAccount)}</div>`,
    logoutLink,
    '<button id="checkin"' + checkinDisabled + '>' + checkinText + '</button>',
    noticeTemplate,
    notice,
    '<script>',
    'window.__events = []; window.__ackClicks = 0; window.__checkinClicks = 0;',
    'window.__noticeVisibleAtCheckin = null;',
    'document.addEventListener("click", (event) => {',
    '  const button = event.target.closest("#notice-ack"); if (!button) return;',
    '  event.preventDefault(); window.__ackClicks += 1; window.__events.push("notice_ack");',
    '  button.remove();',
    hideDelay < 0
      ? ''
      : '  setTimeout(() => { const notice = document.querySelector("#notice"); if (notice) notice.remove(); window.__events.push("notice_hidden"); }, ' + hideDelay + ');',
    '});',
    fixture.noticeInsertDelayMs === undefined || fixture.notice === false
      ? ''
      : 'setTimeout(() => { document.body.append(document.querySelector("#notice-template").content.cloneNode(true)); window.__events.push("notice_inserted"); }, ' + fixture.noticeInsertDelayMs + ');',
    fixture.noticeVisibleDelayMs === undefined || fixture.notice === false
      ? ''
      : 'setTimeout(() => { document.querySelector("#notice").style.display = "flex"; window.__events.push("notice_visible"); }, ' + fixture.noticeVisibleDelayMs + ');',
    'document.querySelector("#checkin")?.addEventListener("click", (event) => {',
    '  window.__checkinClicks += 1; window.__events.push("checkin");',
    '  const overlay = document.querySelector("#notice");',
    '  window.__noticeVisibleAtCheckin = Boolean(overlay && getComputedStyle(overlay).display !== "none");',
    '  event.currentTarget.disabled = true; event.currentTarget.textContent = "今日已签到";',
    '});',
    loginScript,
    '</script></body></html>',
  ].join('\n');
}

async function installFixtureRoute(target, fixture, requests) {
  await target.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === PANEL_ORIGIN && url.pathname === new URL(PANEL_URL).pathname) {
      requests.servedUrls.push(url.href);
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: panelHtml(fixture) });
      return;
    }
    requests.blockedUrls.push(url.href);
    await route.abort('blockedbyclient');
  });
}

function assertOnlyFixtureServed(servedUrls) {
  assert.ok(servedUrls.length > 0, 'the test must load the local panel fixture');
  for (const rawUrl of servedUrls) {
    const url = new URL(rawUrl);
    assert.equal(url.origin, PANEL_ORIGIN);
    assert.equal(url.pathname, new URL(PANEL_URL).pathname);
  }
}

async function withPageFixture(fixture, callback) {
  const page = await browserContext.newPage();
  const requests = { servedUrls: [], blockedUrls: [] };
  await installFixtureRoute(page, fixture, requests);
  try {
    return await callback(page, requests);
  } finally {
    await page.close();
  }
}

async function pageEvidence(page) {
  return page.evaluate(() => ({
    ackClicks: window.__ackClicks,
    checkinClicks: window.__checkinClicks,
    noticeVisibleAtCheckin: window.__noticeVisibleAtCheckin,
    events: window.__events,
  }));
}

test('sign-in waits for a delayed inserted notice to close before one configured-account click', async () => {
  await withPageFixture({ noticeInsertDelayMs: 200 }, async (page, requests) => {
    const result = await runDounaiSignin(page, { expectedAccount: TEST_ACCOUNT, timeoutMs: 2500 });
    const evidence = await pageEvidence(page);

    assert.equal(result.status, 'signed');
    assert.equal(result.ok, true);
    assert.equal(evidence.ackClicks, 1);
    assert.equal(evidence.checkinClicks, 1);
    assert.equal(evidence.noticeVisibleAtCheckin, false);
    assert.deepEqual(evidence.events, ['notice_inserted', 'notice_ack', 'notice_hidden', 'checkin']);
    assertOnlyFixtureServed(requests.servedUrls);
  });
});

test('sign-in waits for an initially hidden notice to become visible and close', async () => {
  await withPageFixture({ noticeInitiallyHidden: true, noticeVisibleDelayMs: 200 }, async (page, requests) => {
    const result = await runDounaiSignin(page, { expectedAccount: TEST_ACCOUNT, timeoutMs: 2500 });
    const evidence = await pageEvidence(page);

    assert.equal(result.status, 'signed');
    assert.equal(evidence.ackClicks, 1);
    assert.equal(evidence.checkinClicks, 1);
    assert.equal(evidence.noticeVisibleAtCheckin, false);
    assert.deepEqual(evidence.events, ['notice_visible', 'notice_ack', 'notice_hidden', 'checkin']);
    assertOnlyFixtureServed(requests.servedUrls);
  });
});

test('already-done state acknowledges the notice without a sign-in click', async () => {
  await withPageFixture({ initialDone: true }, async (page, requests) => {
    const result = await runDounaiSignin(page, { expectedAccount: TEST_ACCOUNT, timeoutMs: 1500 });
    const evidence = await pageEvidence(page);

    assert.equal(result.status, 'already_done');
    assert.equal(result.ok, true);
    assert.equal(evidence.ackClicks, 1);
    assert.equal(evidence.checkinClicks, 0);
    assert.deepEqual(evidence.events, ['notice_ack', 'notice_hidden']);
    assertOnlyFixtureServed(requests.servedUrls);
  });
});

test('waitForLogin accepts the configured account, acknowledges its delayed notice, and never signs in', async () => {
  await withPageFixture({ loggedIn: false, loginAfterMs: 60, noticeInsertDelayMs: 200 }, async (page, requests) => {
    const result = await waitForLogin(page, TEST_ACCOUNT, 2500);
    const evidence = await pageEvidence(page);

    assert.equal(result.status, 'logged_in');
    assert.equal(result.ok, true);
    assert.equal(evidence.ackClicks, 1);
    assert.equal(evidence.checkinClicks, 0);
    assert.deepEqual(evidence.events, ['login_ready', 'notice_inserted', 'notice_ack', 'notice_hidden']);
    assertOnlyFixtureServed(requests.servedUrls);
  });
});

test('panel without a notice keeps the original single sign-in click', async () => {
  await withPageFixture({ notice: false }, async (page, requests) => {
    const result = await runDounaiSignin(page, { expectedAccount: TEST_ACCOUNT, timeoutMs: 1000 });
    const evidence = await pageEvidence(page);

    assert.equal(result.status, 'signed');
    assert.equal(evidence.ackClicks, 0);
    assert.equal(evidence.checkinClicks, 1);
    assert.deepEqual(evidence.events, ['checkin']);
    assertOnlyFixtureServed(requests.servedUrls);
  });
});

test('notice helper refuses a mismatched title, another button, or an editable field', async () => {
  const fixtures = [
    { noticeHeading: '消息中心' },
    { noticeButton: '关闭' },
    { noticeInput: true },
  ];
  for (const fixture of fixtures) {
    await withPageFixture(fixture, async (page, requests) => {
      await page.goto(PANEL_URL, { waitUntil: 'domcontentloaded' });
      assert.equal(await dismissDounaiNotice(page, { timeoutMs: 300 }), false);
      const evidence = await pageEvidence(page);

      assert.equal(evidence.ackClicks, 0);
      assert.equal(evidence.checkinClicks, 0);
      assertOnlyFixtureServed(requests.servedUrls);
    });
  }
});

test('a removed acknowledgement button with its original notice still visible stops sign-in', async () => {
  await withPageFixture({ noticeHideDelayMs: -1 }, async (page, requests) => {
    const result = await runDounaiSignin(page, { expectedAccount: TEST_ACCOUNT, timeoutMs: 500 });
    const evidence = await pageEvidence(page);

    assert.equal(result.ok, false);
    assert.equal(evidence.ackClicks, 1);
    assert.equal(evidence.checkinClicks, 0);
    assert.deepEqual(evidence.events, ['notice_ack']);
    assertOnlyFixtureServed(requests.servedUrls);
  });
});
