const ocr = require('../lib/dounai-captcha-ocr');
const { readDounaiAccount } = require('../lib/dounai-account');

async function assertDounaiAccount(page, captchaStage, expectedAccount) {
  const accountCheck = await readDounaiAccount(page, expectedAccount);
  if (!accountCheck.ok) {
    const error = ocr.captchaError(
      accountCheck.reason === 'unexpected_page' ? 'unexpected_page' : 'account_unconfirmed',
      `豆奶账户核验未通过（${accountCheck.reason}），未继续处理验证码。`);
    error.accountCheck = accountCheck;
    error.captchaStage = captchaStage;
    throw error;
  }
}

// The caller supplies an existing page. Neither mode opens a browser or refreshes a challenge.
async function processDounaiCaptcha(page, { expectedAccount, submit = false, timeoutMs = 5000 } = {}) {
  await assertDounaiAccount(page, 'before_ocr', expectedAccount);
  const modal = page.locator('#checkin-captcha-modal');
  if (await modal.count() !== 1 || !await modal.isVisible()) {
    throw ocr.captchaError('captcha_not_visible', '签到验证码弹窗未显示。');
  }
  const image = modal.locator('#checkin-captcha-box svg, #checkin-captcha-box img');
  const input = modal.locator('#checkin_captcha_code');
  if (await image.count() !== 1 || !await image.isVisible() || await input.count() !== 1 ||
      !await input.isVisible() || !await input.isEditable()) {
    throw ocr.captchaError('unsupported_captcha', '未找到唯一可见图片和可填写的验证码输入框。');
  }
  if (await input.inputValue()) throw ocr.captchaError('already_filled', '输入框已有内容，保留原输入。');
  const originalImage = await image.evaluate((element) => element.outerHTML);
  const result = await ocr.recognizeCaptchaImage(await image.screenshot({ type: 'png', timeout: 5000 }));
  await assertDounaiAccount(page, 'after_ocr', expectedAccount);
  if (!await modal.isVisible() || originalImage !== await image.evaluate((element) => element.outerHTML)) {
    throw ocr.captchaError('captcha_changed', '识别期间验证码已变化，未填入旧答案。');
  }
  if (await input.inputValue()) throw ocr.captchaError('already_filled', '识别期间输入框已填写，保留原输入。');
  await input.fill(result.answer, { timeout: 5000 });
  if (!submit) {
    if (await input.inputValue() !== result.answer) throw ocr.captchaError('fill_unconfirmed', '未确认输入框接收了识别结果。');
    return { ok: true, status: 'filled', ...result };
  }

  await assertDounaiAccount(page, 'before_submit', expectedAccount);
  const done = page.getByRole('button', { name: /今日已签到/ });
  if (await done.count() === 1 && await done.isVisible() && !await done.isEnabled()) {
    return { ok: true, status: 'result_available', ...result };
  }
  if (!await modal.isVisible()) return { ok: true, status: 'submission_pending', ...result };
  if (originalImage !== await image.evaluate((element) => element.outerHTML) ||
      await input.inputValue() !== result.answer) {
    throw ocr.captchaError('captcha_changed', '提交前验证码或答案已变化，未提交。');
  }
  const button = modal.locator('#checkin-submit-btn');
  if (await button.count() !== 1 || !await button.isVisible()) {
    throw ocr.captchaError('submit_unavailable', '未找到唯一可见的验证码提交按钮。');
  }
  // A site's input handler may already have started verification. Do not send it twice.
  if (!await button.isEnabled()) return { ok: true, status: 'submission_pending', ...result };
  const error = modal.locator('#checkin-captcha-err');
  const errorText = await error.count() === 1 ? await error.textContent() : '';
  if (/错误|失败|不正确|不匹配|过期|无效|限制|incorrect|invalid|expired|failed|error/i.test(errorText || '')) {
    throw ocr.captchaError('captcha_rejected', '页面已提示验证码处理失败，未重复提交。');
  }
  try {
    await button.click({ timeout: timeoutMs });
  } catch (error) {
    error.captchaSubmitAttempted = true;
    throw error;
  }
  // This is only a submission result. The adapter must still observe the signed-in marker.
  return { ok: true, status: 'submitted', ...result };
}

async function recognizeAndFillDounaiCaptcha(page, { expectedAccount } = {}) {
  return processDounaiCaptcha(page, { expectedAccount });
}

async function recognizeFillAndSubmitDounaiCaptcha(page, { expectedAccount, timeoutMs = 30000 } = {}) {
  await assertDounaiAccount(page, 'before_image', expectedAccount);
  await page.locator('#checkin-captcha-modal #checkin-captcha-box')
    .locator('svg, img').waitFor({ state: 'visible', timeout: timeoutMs });
  return processDounaiCaptcha(page, { expectedAccount, submit: true, timeoutMs });
}

module.exports = { recognizeAndFillDounaiCaptcha, recognizeFillAndSubmitDounaiCaptcha };
