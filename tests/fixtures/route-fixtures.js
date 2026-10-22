'use strict';

const TEST_ACCOUNT = 'test-user';

function svgMarkup(expression) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="150" viewBox="0 0 560 150"><rect width="100%" height="100%" fill="white"/><text x="280" y="105" text-anchor="middle" font-family="Arial" font-size="76" font-weight="700" fill="#111">${expression}</text></svg>`;
}

function panelHtml(fixture = {}) {
  const settings = {
    captchaVisible: fixture.captchaVisible ?? true,
    expression: fixture.expression ?? '12 + 7 = ?',
    expectedAnswer: fixture.expectedAnswer ?? '19',
    submitMode: fixture.submitMode ?? 'success',
    loginAfterMs: fixture.loginAfterMs ?? 0,
    errorNode: fixture.errorNode !== false,
  };
  const accounts = fixture.accounts ?? (fixture.loggedIn === false ? [] : [
    { text: fixture.accountText ?? `Hi! ${TEST_ACCOUNT}` },
  ]);
  const logouts = fixture.logouts ?? (fixture.loggedIn === false ? [] : [{}]);
  const account = accounts.map((entry) =>
    `<div class="user-name-title"${entry.visible === false ? ' style="display:none"' : ''}>${entry.text ?? `Hi! ${TEST_ACCOUNT}`}</div>`
  ).join('');
  const logout = logouts.map((entry) =>
    `<a href="/user/logout"${entry.visible === false ? ' style="display:none"' : ''}>退出</a>`
  ).join('');
  const checkinButton = fixture.initialDone
    ? '<button id="checkin" disabled>今日已签到</button>'
    : '<button id="checkin">立即签到</button>';
  const modalStyle = settings.captchaVisible ? 'block' : 'none';
  const errorNode = settings.errorNode ? '<div id="checkin-captcha-err"></div>' : '';
  const captchaMarkup = svgMarkup(settings.expression);

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>本地豆奶签到模拟</title></head>
    <body><h1>仅本地 route fixture</h1>
      ${account}${logout}${checkinButton}<div id="simulation-notice"></div>
      <div id="checkin-captcha-modal" style="display:${modalStyle}">
        <form id="checkin-captcha-form" action="/user/checkin/verify" method="post">
          <div id="checkin-captcha-box">${captchaMarkup}</div>
          <input id="checkin_captcha_code" autocomplete="off">
          ${errorNode}<button id="checkin-submit-btn" type="submit">提交验证码</button>
        </form>
      </div>
      <script>
        const fixture = ${JSON.stringify(settings)};
        window.__dounai = { checkinClicks: 0, captchaButtonClicks: 0, captchaSubmits: 0,
          inputEvents: 0, inputValue: '' };
        const modal = document.querySelector('#checkin-captcha-modal');
        const checkin = document.querySelector('#checkin');
        const form = document.querySelector('#checkin-captcha-form');
        const input = document.querySelector('#checkin_captcha_code');
        const submit = document.querySelector('#checkin-submit-btn');
        const err = document.querySelector('#checkin-captcha-err');
        function markDone() {
          checkin.disabled = true;
          checkin.textContent = '今日已签到';
          modal.style.display = 'none';
        }
        window.__markDounaiDone = markDone;
        if (fixture.loginAfterMs > 0) window.setTimeout(() => {
          const title = document.createElement('div');
          title.className = 'user-name-title';
          title.textContent = 'Hi! ${TEST_ACCOUNT}';
          document.body.append(title);
          const logout = document.createElement('a');
          logout.href = '/user/logout';
          logout.textContent = '退出';
          document.body.append(logout);
        }, fixture.loginAfterMs);
        checkin?.addEventListener('click', () => {
          window.__dounai.checkinClicks += 1;
          if (!fixture.captchaVisible) markDone();
        });
        input?.addEventListener('input', () => {
          window.__dounai.inputEvents += 1;
          window.__dounai.inputValue = input.value;
        });
        submit?.addEventListener('click', () => { window.__dounai.captchaButtonClicks += 1; });
        form?.addEventListener('submit', (event) => {
          event.preventDefault();
          window.__dounai.captchaSubmits += 1;
          if (input.value !== fixture.expectedAnswer) {
            if (err) err.textContent = '验证码错误';
            return;
          }
          if (fixture.submitMode === 'success') markDone();
          if (fixture.submitMode === 'reject' && err) err.textContent = '验证码错误或过期';
        });
      </script>
    </body></html>`;
}

module.exports = { TEST_ACCOUNT, panelHtml };
