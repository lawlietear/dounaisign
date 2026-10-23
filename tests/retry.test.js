'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runWithRetry, shouldRetry } = require('../lib/dounai-retry');

function failed(status) {
  return { ok: false, status, timestamp: `time-${status}`, message: status };
}

test('only transient failures retry by default; CAPTCHA rejection requires opt-in', () => {
  for (const status of ['network_error', 'runner_error', 'busy', 'auth_required']) {
    assert.equal(shouldRetry(failed(status)), true, status);
  }
  assert.equal(shouldRetry(failed('captcha_rejected')), false);
  assert.equal(shouldRetry(failed('captcha_rejected'), { retryCaptcha: true }), true);
  for (const status of ['verification_required', 'account_mismatch', 'account_unconfirmed', 'unconfirmed', 'signed']) {
    assert.equal(shouldRetry(failed(status)), false, status);
    assert.equal(shouldRetry(failed(status), { retryCaptcha: true }), false, status);
  }
});

test('each eligible status shares three 60-second waits and a two-attempt maximum', async () => {
  for (const [status, retryCaptcha] of [
    ['network_error', false], ['runner_error', false], ['busy', false], ['auth_required', false],
    ['captcha_rejected', true],
  ]) {
    const attempts = [];
    const saved = [];
    const waits = [];
    const result = await runWithRetry({
      retryCaptcha,
      runAttempt: async ({ attempt, retry }) => {
        attempts.push({ attempt, retry });
        return attempt === 1 ? failed(status) : { ok: true, status: 'signed', timestamp: 'signed-time' };
      },
      saveResult: async (value) => {
        value.record = `attempt-${value.attempt}.json`;
        saved.push(structuredClone(value));
      },
      wait: async (milliseconds) => waits.push(milliseconds),
    });

    assert.deepEqual(attempts, [{ attempt: 1, retry: false }, { attempt: 2, retry: true }], status);
    assert.deepEqual(waits, [60000, 60000, 60000], status);
    assert.equal(saved.length, 2, status);
    assert.equal(saved[0].status, status, status);
    assert.equal(saved[1].status, 'signed', status);
    assert.equal(saved[1].retry.previousRecord, saved[0].record, status);
    assert.equal(result.status, 'signed', status);
  }
});

test('network error followed by CAPTCHA rejection stops after the second saved attempt', async () => {
  const attempts = [];
  const saved = [];
  const waits = [];
  const result = await runWithRetry({
    retryCaptcha: true,
    runAttempt: async ({ attempt, retry }) => {
      attempts.push({ attempt, retry });
      return attempt === 1 ? failed('network_error') : failed('captcha_rejected');
    },
    saveResult: async (value) => {
      value.record = `attempt-${value.attempt}.json`;
      saved.push(structuredClone(value));
    },
    wait: async (milliseconds) => waits.push(milliseconds),
  });

  assert.deepEqual(attempts, [{ attempt: 1, retry: false }, { attempt: 2, retry: true }]);
  assert.deepEqual(waits, [60000, 60000, 60000]);
  assert.deepEqual(saved.map(({ attempt, status }) => [attempt, status]), [
    [1, 'network_error'], [2, 'captcha_rejected'],
  ]);
  assert.equal(saved[1].retry.exhausted, true);
  assert.equal(result.attempt, 2);
});

test('an opted-in second CAPTCHA rejection ends without a third attempt', async () => {
  let attempts = 0;
  const saved = [];
  const result = await runWithRetry({
    retryCaptcha: true,
    runAttempt: async () => {
      attempts += 1;
      return failed('captcha_rejected');
    },
    saveResult: async (value) => saved.push(structuredClone(value)),
    wait: async () => {},
  });

  assert.equal(attempts, 2);
  assert.deepEqual(saved.map(({ attempt, status }) => [attempt, status]), [
    [1, 'captcha_rejected'], [2, 'captcha_rejected'],
  ]);
  assert.equal(saved[1].retry.exhausted, true);
  assert.equal(result.attempt, 2);
});
