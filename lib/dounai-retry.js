const { setTimeout: sleep } = require('node:timers/promises');

function shouldRetry(result, { retryCaptcha = false } = {}) {
  // A confirmed rejection can be retried only with the explicit manual-run option.
  // An uncertain submission is never retried.
  return !result.ok && (['network_error', 'runner_error', 'busy', 'auth_required'].includes(result.status) ||
    (retryCaptcha && result.status === 'captcha_rejected'));
}

async function runWithRetry({ runAttempt, saveResult, wait = sleep, retryCaptcha = false }) {
  const first = await runAttempt({ attempt: 1, retry: false });
  first.attempt = 1;
  if (!shouldRetry(first, { retryCaptcha })) {
    if (!first.ok) first.retry = { scheduled: false, reason: 'requires_user_or_unconfirmed' };
    await saveResult(first);
    return first;
  }
  first.retry = {
    scheduled: true, delayMs: 180000,
    nextAttemptAt: new Date(Date.now() + 180000).toISOString(),
  };
  // Persist the failure before waiting; each attempt owns and releases its lock.
  await saveResult(first);
  for (let minute = 0; minute < 3; minute += 1) await wait(60000);
  const final = await runAttempt({ attempt: 2, retry: true });
  final.attempt = 2;
  final.retry = {
    scheduled: false, previousTimestamp: first.timestamp, previousStatus: first.status,
    ...(first.record ? { previousRecord: first.record } : {}), exhausted: !final.ok,
  };
  await saveResult(final);
  return final;
}

module.exports = { shouldRetry, runWithRetry };
