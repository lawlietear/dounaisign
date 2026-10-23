const { buildResult } = require('../lib/result');
const { PANEL_URL, readDounaiAccount } = require('../lib/dounai-account');
const captcha = require('./dounai-captcha');

async function readDounaiState(page, expectedAccount) {
  const accountCheck = await readDounaiAccount(page, expectedAccount);
  return page.evaluate((account) => {
    const visible = (el) => Boolean(el && el.getClientRects().length);
    const text = document.body?.innerText || '';
    const captchaVisible = visible(document.querySelector('#checkin-captcha-modal'));
    const loggedIn = account.loggedIn;
    const correctAccount = account.ok;
    if (captchaVisible && !loggedIn) return 'auth_required';
    if (captchaVisible && !correctAccount) return 'account_mismatch';
    const done = [...document.querySelectorAll('button')].some((el) =>
      visible(el) && el.disabled && el.textContent.includes('今日已签到'));
    if (loggedIn && correctAccount && done) return 'already_done';
    const captchaError = document.querySelector('#checkin-captcha-err')?.textContent || '';
    if (captchaVisible && /错误|失败|不正确|不匹配|过期|无效|限制|incorrect|invalid|expired|failed|error/i.test(captchaError)) {
      return 'captcha_rejected';
    }
    const verification = captchaVisible ||
      document.title === 'Just a moment...' || /Performing security verification|Verify you are human/.test(text);
    if (verification) return 'verification_required';
    if (!loggedIn) return 'auth_required';
    if (!correctAccount) return 'account_mismatch';
    const button = document.querySelector('#checkin');
    return visible(button) && !button.disabled ? 'ready_to_sign' : 'unexpected_response';
  }, accountCheck);
}

async function observeState(page, timeoutMs, waitingStates, expectedAccount) {
  const deadline = Date.now() + timeoutMs;
  let state;
  while (true) {
    try {
      state = await readDounaiState(page, expectedAccount);
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context/i.test(error.message)) throw error;
      if (Date.now() >= deadline) return state || 'unexpected_response';
      await page.waitForLoadState('domcontentloaded', { timeout: Math.max(1, deadline - Date.now()) });
      continue;
    }
    if (!waitingStates.includes(state) || Date.now() >= deadline) return state;
    await page.waitForTimeout(Math.min(500, Math.max(0, deadline - Date.now())));
  }
}

async function stateResult(state, page, extraDetails = {}, expectedAccount) {
  const messages = {
    already_done: '豆奶页面确认今日已签到。',
    auth_required: '未找到可见的豆奶登录证据；请核对项目专用 Chrome，日常 Chrome 会话不共享。',
    account_mismatch: `未确认预期豆奶账户 ${expectedAccount}，本轮未继续处理。`,
    verification_required: '豆奶需要验证码或安全验证；请使用 --interactive 在窗口中亲自完成。',
    captcha_rejected: '页面提示验证码处理失败或过期，本轮未重复提交。',
    unexpected_response: '未找到明确的豆奶签到状态，没有点击签到。',
  };
  const details = { ...extraDetails };
  if (['auth_required', 'account_mismatch'].includes(state)) {
    details.accountCheck ||= await readDounaiAccount(page, expectedAccount);
  }
  return buildResult('dounai', state === 'already_done', state, messages[state],
    Object.keys(details).length ? { details } : {});
}

async function runDounaiSignin(page, { expectedAccount, timeoutMs = 30000, interactive = false, autoCaptcha = false, captureCaptcha,
  captchaAttempts = { count: 0 } } = {}) {
  let pageActionAttempted = false;
  let captchaProcessed = false;
  let captchaFailure;
  let captchaRecognition;
  let captchaEvidence;
  const captchaHistory = [];
  const diagnosticDetails = () => ({
    ...captchaFailure,
    ...(captchaRecognition ? { captchaRecognition } : {}),
    ...(captchaEvidence ? { captchaEvidence } : {}),
    ...(captchaHistory.length ? { captchaAttempts: captchaHistory } : {}),
  });
  try {
    const response = await page.goto(PANEL_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (response?.status() >= 500) return buildResult('dounai', false, 'network_error', '豆奶网站暂时不可用。',
      { details: { httpStatus: response.status() } });
    const modal = page.locator('#checkin-captcha-modal');
    let state = await readDounaiState(page, expectedAccount);
    if (interactive && ['auth_required', 'verification_required'].includes(state) &&
        !(autoCaptcha && state === 'verification_required' && await modal.isVisible())) {
      console.error('请在项目 Chrome 窗口中完成豆奶登录或安全验证，最多等待 5 分钟。程序不会读取密码或自动完成验证码。');
      state = await observeState(page, 300000, ['auth_required', 'verification_required', 'unexpected_response'], expectedAccount);
      if (!['auth_required', 'verification_required'].includes(state)) {
        // Login can land on a different user page before the panel greeting is ready.
        await page.goto(PANEL_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        state = await readDounaiState(page, expectedAccount);
      }
    }
    if (autoCaptcha && captchaAttempts.count >= 5 && ['ready_to_sign', 'verification_required'].includes(state)) {
      return buildResult('dounai', false, 'verification_required', '本次运行已用尽5次验证码识别额度，未再次点击签到。',
        { details: { captchaAttemptsUsed: captchaAttempts.count } });
    }
    if (state === 'ready_to_sign') {
      pageActionAttempted = true;
      await page.locator('#checkin').click({ timeout: timeoutMs });
      state = await observeState(page, timeoutMs, ['ready_to_sign', 'unexpected_response'], expectedAccount);
    } else if (!(autoCaptcha && state === 'verification_required' && await modal.isVisible())) {
      return await stateResult(state, page, {}, expectedAccount);
    }

    while (autoCaptcha && state === 'verification_required' && await modal.isVisible() && captchaAttempts.count < 5) {
      const recognitionAttempt = ++captchaAttempts.count;
      captchaFailure = undefined;
      captchaRecognition = undefined;
      captchaEvidence = undefined;
      let recognitionFailed = false;
      const history = { attempt: recognitionAttempt };
      if (captureCaptcha) {
        try { captchaEvidence = await captureCaptcha({ recognitionAttempt }); }
        catch { captchaEvidence = { warning: '处理前验证码图片未保存。' }; }
      }
      try {
        const result = await captcha.recognizeFillAndSubmitDounaiCaptcha(page, { timeoutMs, expectedAccount });
        captchaRecognition = { confidence: result.confidence, recognitionMode: result.recognitionMode };
        if (result.engine) captchaRecognition.engine = result.engine;
        if (result.rawText !== undefined) captchaRecognition.rawText = result.rawText;
        if (result.engine) captchaRecognition.expression = result.expression;
        captchaProcessed = result.status !== 'filled';
        history.status = result.status;
      } catch (error) {
        captchaFailure = { captchaError: error.code || error.name };
        if (error.ocrDiagnostic) captchaFailure.captchaRecognition = error.ocrDiagnostic;
        if (error.captchaStage) captchaFailure.captchaStage = error.captchaStage;
        if (error.accountCheck) captchaFailure.accountCheck = error.accountCheck;
        captchaProcessed = error.captchaSubmitAttempted === true;
        recognitionFailed = error.captchaStage === 'recognition' && !captchaProcessed &&
          ['uncertain_recognition', 'unsupported_expression', 'ocr_failed'].includes(error.code);
      }
      Object.assign(history, captchaFailure,
        captchaRecognition ? { captchaRecognition } : {}, captchaEvidence ? { captchaEvidence } : {});
      captchaHistory.push(history);
      if (recognitionFailed) {
        state = await readDounaiState(page, expectedAccount);
        if (state !== 'verification_required' || captchaAttempts.count >= 5) break;
        const input = modal.locator('#checkin_captcha_code');
        const close = modal.locator('button.close');
        if (await input.count() !== 1 || !await input.isVisible() || !await input.isEditable() || await input.inputValue()) {
          captchaFailure.reopenStopped = 'input_not_empty_or_unavailable';
        } else if (await close.count() !== 1 || !await close.isVisible() || !await close.isEnabled()) {
          captchaFailure.reopenStopped = 'close_button_unavailable';
        }
        if (captchaFailure.reopenStopped) {
          history.reopenStopped = captchaFailure.reopenStopped;
          state = await observeState(page, timeoutMs, ['verification_required', 'ready_to_sign', 'unexpected_response'], expectedAccount);
          break;
        }
        const previousImage = await modal.locator('#checkin-captcha-box svg, #checkin-captcha-box img')
          .evaluate((element) => element.outerHTML);
        pageActionAttempted = true;
        await close.click({ timeout: timeoutMs });
        await modal.waitFor({ state: 'hidden', timeout: timeoutMs });
        state = await readDounaiState(page, expectedAccount);
        if (state !== 'ready_to_sign') break;
        await page.locator('#checkin').click({ timeout: timeoutMs });
        state = await observeState(page, timeoutMs, ['ready_to_sign', 'unexpected_response'], expectedAccount);
        if (state !== 'verification_required' || !await modal.isVisible()) break;
        await page.waitForFunction((previous) => {
          const image = document.querySelector('#checkin-captcha-modal #checkin-captcha-box svg, #checkin-captcha-modal #checkin-captcha-box img');
          return image && image.getClientRects().length && image.outerHTML !== previous;
        }, previousImage, { timeout: timeoutMs });
        history.reopened = true;
        continue;
      }
      // A submitted form or a tool error alone never proves sign-in success.
      state = await observeState(page, timeoutMs, ['verification_required', 'ready_to_sign', 'unexpected_response'], expectedAccount);
      break;
    }
    if (interactive && state === 'verification_required' && captchaFailure?.captchaError !== 'account_unconfirmed') {
      console.error('签到验证码已打开，请亲自完成；最多等待 5 分钟，不会重复点击签到。');
      state = await observeState(page, 300000, ['verification_required', 'ready_to_sign', 'unexpected_response'], expectedAccount);
    }
    if (state === 'already_done') return buildResult('dounai', true, 'signed', '豆奶按钮已变为“今日已签到”。',
      Object.keys(diagnosticDetails()).length ? { details: diagnosticDetails() } : {});
    if (['captcha_rejected', 'auth_required', 'account_mismatch'].includes(state)) return await stateResult(state, page, diagnosticDetails(), expectedAccount);
    if (captchaProcessed) return buildResult('dounai', false, 'unconfirmed', '验证码处理后没有明确签到成功标记；未重复提交。',
      Object.keys(diagnosticDetails()).length ? { details: diagnosticDetails() } : {});
    if (captchaFailure?.captchaError === 'account_unconfirmed') {
      return buildResult('dounai', false, 'account_unconfirmed',
        `豆奶账户核验未通过（${captchaFailure.accountCheck.reason}），本轮未继续处理验证码。`,
        { details: diagnosticDetails() });
    }
    if (captchaFailure && state === 'verification_required') {
      return buildResult('dounai', false, state,
        `验证码自动处理未完成（${captchaFailure.captchaError}），本次运行已识别${captchaAttempts.count}次（上限5次）；请人工处理。`,
        { details: diagnosticDetails() });
    }
    if (state === 'verification_required') return await stateResult(state, page, diagnosticDetails(), expectedAccount);
    return buildResult('dounai', false, 'unconfirmed', '签到处理后没有明确成功标记；未重复提交。',
      Object.keys(diagnosticDetails()).length ? { details: diagnosticDetails() } : {});
  } catch (error) {
    const attempted = pageActionAttempted || captchaProcessed;
    return buildResult('dounai', false, attempted ? 'unconfirmed' : 'network_error',
      attempted ? '签到处理后未能确认结果，请核对页面；未重复提交。' : error.message,
      { details: { ...diagnosticDetails(), executionError: {
        name: error.name, message: String(error.message || '').split(/\r?\nCall log:/, 1)[0].slice(0, 500),
      } } });
  }
}

module.exports = { runDounaiSignin, readDounaiState };
