function buildResult(site, ok, status, message, extra = {}) {
  return {
    site,
    ok,
    status,
    message: typeof message === 'string' ? message.split(/\r?\nCall log:/, 1)[0] : message,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

module.exports = { buildResult };
