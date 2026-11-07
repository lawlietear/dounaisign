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

async function waitForCaptchaReady(page, image, input) {
  const startedAt = Date.now();
  const deadline = startedAt + 5000;
  let previousImage;
  let stableSince = startedAt;
  while (true) {
    const currentImage = await image.evaluateAll((elements) => {
      if (elements.length !== 1) return null;
      const element = elements[0];
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden') return null;
      if (element.tagName.toLowerCase() === 'img') {
        if (!element.complete || !element.naturalWidth || !element.naturalHeight) return null;
      } else {
        // A visible SVG shell can precede the actual question.
        const text = [...element.querySelectorAll('text')].some((node) => node.textContent.trim());
        const drawing = element.querySelector('path[d], use[href], image[href], polygon[points], polyline[points]');
        if (!text && !drawing) return null;
      }
      return element.outerHTML;
    });
    const now = Date.now();
    if (currentImage !== previousImage) {
      previousImage = currentImage;
      stableSince = now;
    }
    const inputCount = await input.count();
    const inputVisible = inputCount === 1 && await input.isVisible();
    const inputEditable = inputVisible && await input.isEditable();
    if (currentImage && inputEditable && now - startedAt >= 2000 && now - stableSince >= 250) return;
    if (now >= deadline) {
      const error = inputEditable
        ? ocr.captchaError('captcha_image_not_ready', '等待5秒后验证码图片仍未加载完成或稳定，未识别或提交。')
        : ocr.captchaError('captcha_input_not_ready', '等待5秒后验证码输入框仍未就绪，未识别或提交。');
      error.captchaStage = inputEditable ? 'before_image' : 'before_input';
      if (!inputEditable) error.inputCheck = {
        count: inputCount, visible: inputVisible, editable: inputEditable,
        reason: inputCount !== 1 ? 'not_unique' : !inputVisible ? 'not_visible' : 'not_editable',
      };
      throw error;
    }
    await page.waitForTimeout(Math.min(100, deadline - now));
  }
}

// The caller supplies an existing page. Neither mode opens a browser or refreshes a challenge.
async function processDounaiCaptcha(page, { expectedAccount, submit = false, timeoutMs = 5000, captureImage } = {}) {
  await assertDounaiAccount(page, 'before_ocr', expectedAccount);
  const modal = page.locator('#checkin-captcha-modal');
  if (await modal.count() !== 1 || !await modal.isVisible()) {
    throw ocr.captchaError('captcha_not_visible', '签到验证码弹窗未显示。');
  }
  const image = modal.locator('#checkin-captcha-box svg, #checkin-captcha-box img');
  const input = modal.locator('#checkin_captcha_code');
  if (await input.count() === 1 && await input.inputValue()) throw ocr.captchaError('already_filled', '输入框已有内容，保留原输入。');
  await waitForCaptchaReady(page, image, input);
  await assertDounaiAccount(page, 'before_ocr', expectedAccount);
  if (!await modal.isVisible()) throw ocr.captchaError('captcha_not_visible', '签到验证码弹窗已关闭。');
  if (await input.inputValue()) throw ocr.captchaError('already_filled', '等待图片期间输入框已填写，保留原输入。');
  const originalImage = await image.evaluate((element) => element.outerHTML);
  const png = await image.screenshot({ type: 'png', timeout: 5000 });
  if (originalImage !== await image.evaluate((element) => element.outerHTML)) {
    throw ocr.captchaError('captcha_changed', '截图期间验证码已变化，未继续识别。');
  }
  if (captureImage) await captureImage(png);
  let result;
  try { result = await ocr.recognizeCaptchaImage(png); }
  catch (error) {
    error.captchaStage = 'recognition';
    throw error;
  }
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

async function recognizeFillAndSubmitDounaiCaptcha(page, { expectedAccount, timeoutMs = 30000, captureImage } = {}) {
  await assertDounaiAccount(page, 'before_image', expectedAccount);
  return processDounaiCaptcha(page, { expectedAccount, submit: true, timeoutMs, captureImage });
}

module.exports = { recognizeAndFillDounaiCaptcha, recognizeFillAndSubmitDounaiCaptcha };
