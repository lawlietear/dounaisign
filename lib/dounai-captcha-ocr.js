const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function captchaError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeCaptchaNumber(text) {
  const digits = {
    零: '0', 〇: '0', 一: '1', 壹: '1', 二: '2', 两: '2', 兩: '2', 贰: '2', 貳: '2',
    三: '3', 叁: '3', 参: '3', 參: '3', 四: '4', 肆: '4', 五: '5', 伍: '5',
    六: '6', 陆: '6', 陸: '6', 七: '7', 柒: '7', 八: '8', 捌: '8', 九: '9', 玖: '9',
  };
  return text.replace(/[零〇一壹二两兩贰貳三叁参參四肆五伍六陆陸七柒八捌九玖]/g, (char) => digits[char])
    .replace(/拾/g, '十').replace(/佰/g, '百');
}

function parseCaptchaOperand(text) {
  const number = normalizeCaptchaNumber(text);
  if (/^\d{1,3}$/.test(number)) return Number(number);
  const tens = /^([1-9]?)十([1-9]?)$/.exec(number);
  if (tens) return Number(tens[1] || 1) * 10 + Number(tens[2] || 0);
  const hundreds = /^([1-9])百(?:([1-9])十([1-9])?|0([1-9]))?$/.exec(number);
  if (hundreds) return Number(hundreds[1]) * 100 + Number(hundreds[2] || 0) * 10 +
    Number(hundreds[3] || hundreds[4] || 0);
  throw captchaError('unsupported_expression', '操作数须为0–999的阿拉伯数字或规范中文数字；不猜测省略位数。');
}

function parseArithmeticCaptcha(text) {
  const normalized = String(text).normalize('NFKC').replace(/\s/g, '')
    .replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-')
    .replace(/加上|加/g, '+').replace(/减去|減去|减|減/g, '-')
    .replace(/乘以|乘/g, '*').replace(/除以|除/g, '/').replace(/等于|等於/g, '=');
  const sides = normalized.split('=');
  if (sides.length > 2) throw captchaError('unsupported_expression', '只能忽略唯一等号右侧的内容。');
  if (sides.length === 2 && !/[+*/?-]/.test(sides[0])) {
    const number = normalizeCaptchaNumber(sides[0]);
    const answer = /^\d+$/.test(number) ? number : String(parseCaptchaOperand(sides[0]));
    return { expression: answer, answer };
  }
  const match = /^([^+*/=?-]+)([+*/-])([^+*/=?-]+)\??$/.exec(sides[0]);
  if (!match) throw captchaError('unsupported_expression', '只能识别两个整数之间的一次加、减、乘或整除运算。');
  const left = parseCaptchaOperand(match[1]);
  const right = parseCaptchaOperand(match[3]);
  const operator = match[2];
  if (operator === '/' && (right === 0 || left % right !== 0)) {
    throw captchaError('unsupported_expression', '除法结果不是整数或除数为零，未生成答案。');
  }
  const answer = operator === '+' ? left + right : operator === '-' ? left - right :
    operator === '*' ? left * right : left / right;
  return { expression: `${left}${operator}${right}`, answer: String(answer) };
}

function resolveRapidRecognition(record) {
  const rows = record?.rows;
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  const rawText = typeof row?.text === 'string' ? row.text.slice(0, 160) : null;
  const confidence = Number.isFinite(row?.confidence) ? row.confidence : null;
  function reject(reason) {
    const error = captchaError('uncertain_recognition', `RapidOCR结果未通过校验（${reason}），未填入。`);
    error.ocrDiagnostic = { engine: 'rapidocr', rawText, confidence, reason };
    throw error;
  }
  if (!Array.isArray(rows)) reject('invalid_result');
  if (!rows.length) reject('no_text');
  if (rows.length !== 1) reject('multiple_rows');
  if (typeof row?.text !== 'string' || !row.text.trim()) reject('no_text');
  if (confidence === null || confidence < 0 || confidence > 1) reject('invalid_confidence');
  // RapidOCR's default text_score is 0.5; this is not a calibrated correctness probability.
  if (confidence < 0.5) reject('below_minimum_confidence');
  let parsed;
  try { parsed = parseArithmeticCaptcha(row.text); }
  catch (error) { if (error.code !== 'unsupported_expression') throw error; reject('unsupported_expression'); }
  return { ...parsed, confidence, recognitionMode: 'rapidocr_ppocrv5', engine: 'rapidocr', rawText };
}

async function recognizeCaptchaImage(png) {
  if (!Buffer.isBuffer(png) || !png.length) throw captchaError('invalid_image', '验证码图片为空。');
  const toolDir = path.resolve(__dirname, '../tools/ocr');
  const python = path.join(toolDir, '.venv', 'Scripts', 'python.exe');
  const script = path.join(toolDir, 'recognize.py');
  function failure(code, reason) {
    const error = captchaError(code, `RapidOCR执行失败（${reason}），未填入。`);
    error.ocrDiagnostic = { engine: 'rapidocr', rawText: null, confidence: null, reason };
    return error;
  }
  if (!fs.existsSync(python) || !fs.existsSync(script)) throw failure('ocr_unavailable', 'environment_missing');
  const record = await new Promise((resolve, reject) => {
    const child = spawn(python, [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
        XDG_CACHE_HOME: path.join(toolDir, 'cache'), HF_HOME: path.join(toolDir, 'cache/huggingface'),
        MODELSCOPE_CACHE: path.join(toolDir, 'cache/modelscope'), HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1', MODELSCOPE_OFFLINE: '1',
        OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1' },
    });
    const chunks = [];
    let bytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 120000);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 65536) child.kill('SIGKILL');
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timer); reject(failure('ocr_unavailable', 'process_unavailable')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut || bytes > 65536) { reject(failure('ocr_failed', timedOut ? 'timeout' : 'output_limit')); return; }
      let output;
      try { output = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { reject(failure('ocr_failed', 'invalid_output')); return; }
      if (!output || typeof output !== 'object' || Array.isArray(output)) { reject(failure('ocr_failed', 'invalid_output')); return; }
      if (code !== 0 || output.ok === false) {
        reject(failure(output.code === 'ocr_unavailable' ? 'ocr_unavailable' : 'ocr_failed',
          ['assets_missing', 'environment_mismatch', 'invalid_result', 'ImportError', 'ModuleNotFoundError',
            'PackageNotFoundError', 'RuntimeError', 'ValueError', 'TypeError', 'UnidentifiedImageError',
            'RapidOCRError'].includes(output.reason) ? output.reason : 'process_failed'));
        return;
      }
      resolve(output);
    });
    child.stdin.end(png);
  });
  return resolveRapidRecognition(record);
}

module.exports = { captchaError, parseArithmeticCaptcha, resolveRapidRecognition, recognizeCaptchaImage };
