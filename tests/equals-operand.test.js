'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { parseArithmeticCaptcha, resolveRapidRecognition } = require('../lib/dounai-captcha-ocr');

test('repairs an equals glyph only when it is a whole operand before a separate final delimiter', () => {
  const examples = [
    ['陆除二=', { expression: '6/2', answer: '3' }],
    ['3÷三=', { expression: '3/3', answer: '1' }],
    ['陆除==', { expression: '6/2', answer: '3' }],
    ['六除以=等于?', { expression: '6/2', answer: '3' }],
    ['６÷＝＝忽略', { expression: '6/2', answer: '3' }],
    ['=加叁=噪声', { expression: '2+3', answer: '5' }],
    ['=加==?', { expression: '2+2', answer: '4' }],
    ['＝加==？', { expression: '2+2', answer: '4' }],
  ];

  for (const [rawText, parsed] of examples) {
    const confidence = 0.73;
    assert.deepEqual(resolveRapidRecognition({ rows: [{ text: rawText, confidence }] }), {
      ...parsed,
      confidence,
      recognitionMode: 'rapidocr_ppocrv5',
      engine: 'rapidocr',
      rawText,
    }, rawText);
  }
});

test('keeps strict parsing and rejects misplaced, incomplete, or invalid equals corrections', () => {
  for (const input of ['陆除==', '六除以=等于?', '=加叁=噪声', '=加==?']) {
    assert.throws(() => parseArithmeticCaptcha(input), { code: 'unsupported_expression' }, input);
  }

  const invalid = [
    '陆除=', '3÷==', '95==?', '陆=除二=', '陆除===?', '陆除+二==', '陆除?二==',
    '=除零=', '=除四=', '=加一百二=', '=加1O=',
  ];
  for (const rawText of invalid) {
    assert.throws(() => resolveRapidRecognition({ rows: [{ text: rawText, confidence: 0.9 }] }), (error) => {
      assert.equal(error.code, 'uncertain_recognition');
      assert.equal(error.ocrDiagnostic.rawText, rawText);
      assert.equal(error.ocrDiagnostic.confidence, 0.9);
      assert.equal(error.ocrDiagnostic.reason, 'unsupported_expression');
      return true;
    }, rawText);
  }
});

test('RapidOCR requires an equals delimiter and preserves missing-delimiter diagnostics', () => {
  const missingDelimiters = [
    ['4乘七三', 0.85058],
    ['4乘七三', 0.99],
    ['4*73', 0.91],
    ['4乘七', 0.92],
  ];

  for (const [rawText, confidence] of missingDelimiters) {
    assert.throws(() => resolveRapidRecognition({ rows: [{ text: rawText, confidence }] }), (error) => {
      assert.equal(error.code, 'uncertain_recognition');
      assert.deepEqual(error.ocrDiagnostic, {
        engine: 'rapidocr', rawText, confidence, reason: 'missing_equals_delimiter',
      });
      assert.equal(Object.hasOwn(error, 'answer'), false);
      return true;
    }, rawText);
  }

  // The lower-level parser remains a syntax helper; only RapidOCR resolution requires evidence of a delimiter.
  assert.deepEqual(parseArithmeticCaptcha('4乘七三'), { expression: '4*73', answer: '292' });
});

test('keeps valid final digits and explicit Chinese or fullwidth delimiters', () => {
  const examples = [
    ['4乘七=三', '4*7', '28'],
    ['4乘七三=', '4*73', '292'],
    ['4*73=', '4*73', '292'],
    ['4乘七等于三', '4*7', '28'],
    ['４×７３＝', '4*73', '292'],
  ];

  for (const [rawText, expression, answer] of examples) {
    const result = resolveRapidRecognition({ rows: [{ text: rawText, confidence: 0.99 }] });
    assert.equal(result.expression, expression, rawText);
    assert.equal(result.answer, answer, rawText);
    assert.equal(result.rawText, rawText, rawText);
  }
});

test('low confidence and multiple OCR rows remain rejected with their original diagnostics', () => {
  assert.throws(() => resolveRapidRecognition({
    rows: [{ text: '陆除==', confidence: 0.499 }],
  }), (error) => {
    assert.equal(error.code, 'uncertain_recognition');
    assert.equal(error.ocrDiagnostic.reason, 'below_minimum_confidence');
    assert.equal(error.ocrDiagnostic.rawText, '陆除==');
    assert.equal(error.ocrDiagnostic.confidence, 0.499);
    return true;
  });

  assert.throws(() => resolveRapidRecognition({
    rows: [
      { text: '陆除==', confidence: 0.9 },
      { text: '3', confidence: 0.8 },
    ],
  }), (error) => {
    assert.equal(error.code, 'uncertain_recognition');
    assert.equal(error.ocrDiagnostic.reason, 'multiple_rows');
    return true;
  });
});
