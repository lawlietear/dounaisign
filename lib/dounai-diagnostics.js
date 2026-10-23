const fs = require('node:fs');
const path = require('node:path');

function evidencePaths(baseDir, attemptId) {
  const relative = `data/dounai-diagnostics/${attemptId}`;
  const directory = path.join(baseDir, relative);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return { relative, directory };
}

async function captureCaptchaEvidence(page, { baseDir, attemptId, timeoutMs, recognitionAttempt = 1 }) {
  const image = page.locator('#checkin-captcha-modal #checkin-captcha-box').locator('svg, img');
  await image.waitFor({ state: 'visible', timeout: timeoutMs });
  const paths = evidencePaths(baseDir, attemptId);
  const name = recognitionAttempt === 1 ? 'captcha-before-processing.png' : `captcha-before-processing-${recognitionAttempt}.png`;
  const file = path.join(paths.directory, name);
  await image.screenshot({ path: file, type: 'png', timeout: 5000 });
  fs.chmodSync(file, 0o600);
  return { image: `${paths.relative}/${name}`, capturedAt: new Date().toISOString(), stage: 'before_processing' };
}

async function captureFailureEvidence(page, { baseDir, attemptId }) {
  const paths = evidencePaths(baseDir, attemptId);
  const diagnostics = {};
  try {
    diagnostics.page = await page.evaluate(() => {
      const visible = (element) => Boolean(element?.getClientRects().length);
      const error = document.querySelector('#checkin-captcha-err');
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      url.username = '';
      url.password = '';
      return {
        // Never persist URL queries, fragments, form values, cookies or HTML.
        url: url.href,
        title: document.title.slice(0, 160),
        loginFormVisible: [...document.querySelectorAll('input[type="password"]')].some(visible),
        captchaVisible: visible(document.querySelector('#checkin-captcha-modal')),
        captchaErrorText: visible(error) ? (error.textContent || '').trim().slice(0, 500) : '',
      };
    });
  } catch {
    diagnostics.pageWarning = '页面状态无法读取，可能已经关闭或仍在跳转。';
  }
  try {
    const file = path.join(paths.directory, 'failure.png');
    await page.screenshot({
      path: file, fullPage: false, timeout: 5000, animations: 'disabled', caret: 'hide',
      mask: [page.locator('input, textarea, [contenteditable]')], maskColor: '#000000',
    });
    fs.chmodSync(file, 0o600);
    diagnostics.screenshot = `${paths.relative}/failure.png`;
  } catch {
    diagnostics.screenshotWarning = '失败页面截图未保存；请查看页面状态与错误记录。';
  }
  return diagnostics;
}

module.exports = { evidencePaths, captureCaptchaEvidence, captureFailureEvidence };
