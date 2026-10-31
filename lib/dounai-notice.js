const { PANEL_URL } = require('./dounai-account');

async function dismissDounaiNotice(page, { timeoutMs = 30000 } = {}) {
  const url = new URL(page.url());
  const panel = new URL(PANEL_URL);
  if (url.origin !== panel.origin || url.pathname !== panel.pathname) return false;
  if (await page.title() === 'Just a moment...') return false;
  const button = page.getByRole('button', { name: /^好的[，,]\s*我知道了$/ });
  if (await button.count() > 1) return false;
  // The panel can become ready before its announcement is inserted or faded in.
  try {
    await button.waitFor({ state: 'visible', timeout: Math.max(1, Math.min(timeoutMs, 3000)) });
  } catch (error) {
    if (error.name === 'TimeoutError') return false;
    throw error;
  }
  if (await button.count() !== 1 || !await button.isVisible() || !await button.isEnabled()) return false;
  // Bind the acknowledgement to its own notice, rather than a heading elsewhere on the page.
  const notice = button.locator('xpath=ancestor::*[not(self::body) and not(self::html) and .//*[normalize-space(.)="消息提示"]][1]');
  if (await notice.count() !== 1 || !await notice.isVisible()) return false;
  const heading = notice.getByText('消息提示', { exact: true });
  if (await heading.count() !== 1 || !await heading.isVisible()) return false;
  if (await notice.locator('input:not([type="hidden"]), textarea, [contenteditable="true"], #checkin-captcha-modal').count()) return false;
  const container = await notice.elementHandle();
  try {
    await button.click({ timeout: timeoutMs });
    // Keep the original container identity even if the button is removed before the overlay closes.
    await container.waitForElementState('hidden', { timeout: timeoutMs });
  } finally {
    await container.dispose();
  }
  return true;
}

module.exports = { dismissDounaiNotice };
