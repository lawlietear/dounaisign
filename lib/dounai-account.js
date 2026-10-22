const PANEL_URL = 'https://dounai.pro/user/panel';

async function readDounaiAccount(page, expectedAccount) {
  if (typeof expectedAccount !== 'string' || !expectedAccount.trim()) {
    throw new Error('Expected account is required; configure config.json first.');
  }
  return page.evaluate(({ panelUrl, expectedAccount }) => {
    const panel = new URL(panelUrl);
    const visible = (el) => Boolean(el.getClientRects().length) &&
      !['hidden', 'collapse'].includes(getComputedStyle(el).visibility);
    const titles = [...document.querySelectorAll('.user-name-title')];
    const visibleTitles = titles.filter(visible);
    const logouts = [...document.querySelectorAll('a[href="/user/logout"]')];
    const visibleLogouts = logouts.filter(visible);
    const matchingTitles = visibleTitles.filter((el) =>
      el.innerText.replace(/\s+/g, ' ').trim() === `Hi! ${expectedAccount}`);
    const counts = {
      accountTotal: titles.length,
      accountVisible: visibleTitles.length,
      accountMatching: matchingTitles.length,
      logoutTotal: logouts.length,
      logoutVisible: visibleLogouts.length,
    };
    const loggedIn = location.origin === panel.origin && visibleLogouts.length > 0;
    let reason = 'confirmed';
    if (location.origin !== panel.origin || location.pathname !== panel.pathname) reason = 'unexpected_page';
    else if (!logouts.length) reason = 'logout_missing';
    else if (!visibleLogouts.length) reason = 'logout_not_visible';
    else if (!titles.length) reason = 'account_missing';
    else if (!visibleTitles.length) reason = 'account_not_visible';
    else if (!matchingTitles.length) reason = 'account_mismatch';
    else if (matchingTitles.length !== visibleTitles.length) reason = 'account_conflict';
    return { ok: reason === 'confirmed', loggedIn, reason, counts };
  }, { panelUrl: PANEL_URL, expectedAccount });
}

module.exports = { PANEL_URL, readDounaiAccount };
