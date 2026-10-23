// JSON UI binding/variable expression evaluator.
// Semantics follow the guide chapter 5 (EXP-*) and the Cinnabar reconstruction
// (cinnabar/README.md 3.6, CN-26..CN-30). Values are tagged:
//   { k: 'int', v } | { k: 'num', v } | { k: 'str', v } | { k: 'bool', v } | { k: 'null' } | { k: 'json', v }

export const NULL = Object.freeze({ k: 'null' });
export const int = (v) => ({ k: 'int', v: v | 0 });
export const num = (v) => ({ k: 'num', v: Math.fround(v) });
export const str = (v) => ({ k: 'str', v: String(v) });
export const bool = (v) => ({ k: 'bool', v: !!v });

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

// Converts a plain JS/JSON value (from property bags, variables, mock data) to a tagged value.
export function fromJson(x) {
  if (x === null || x === undefined) return NULL;
  if (typeof x === 'boolean') return bool(x);
  if (typeof x === 'number') return Number.isInteger(x) ? int(x) : num(x);
  if (typeof x === 'string') return str(x);
  if (x && typeof x === 'object' && 'k' in x && Object.keys(x).length <= 3 && ['int', 'num', 'str', 'bool', 'null', 'json'].includes(x.k)) return x;
  return { k: 'json', v: x };
}

export function toJson(val) {
  switch (val.k) {
    case 'null': return null;
    case 'json': return val.v;
    default: return val.v;
  }
}

export function truthy(val) {
  switch (val.k) {
    case 'int': case 'num': return val.v !== 0;
    case 'str': return val.v.length > 0;
    case 'bool': return val.v;
    case 'json': return Array.isArray(val.v) ? val.v.length > 0 : val.v && Object.keys(val.v).length > 0;
    default: return false;
  }
}

const isNumeric = (val) => val.k === 'int' || val.k === 'num' || val.k === 'bool' || val.k === 'null';
const numberOf = (val) => (val.k === 'bool' ? (val.v ? 1 : 0) : val.k === 'int' || val.k === 'num' ? val.v : 0);

// Text used when a value is concatenated with `+` (integers in decimal, floats vanish: EXP-22).
function textForConcat(val) {
  switch (val.k) {
    case 'str': return val.v;
    case 'int': return String(val.v);
    case 'bool': return val.v ? 'true' : 'false';
    default: return '';
  }
}
// Text used as the right operand of `-`, `*`, `/` on strings: numbers have no text (CN-28).
function textForStringOp(val) {
  if (val.k === 'str') return val.v;
  if (val.k === 'bool') return val.v ? 'true' : 'false';
  return '';
}

export function utf8Truncate(s, n) {
  const bytes = encoder.encode(s);
  if (bytes.length <= n) return s;
  let end = n;
  // Do not leave a partial multi-byte character behind (EXP-24: cutting mid-character breaks it).
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return decoder.decode(bytes.slice(0, end));
}
export const utf8Length = (s) => encoder.encode(s).length;

// strtol-like: optional sign and at least one digit at the start.
const INT_PREFIX = /^\s*([+-]?\d+)/;
// strtof for words starting with a dot (".3", "-.25").
const DOT_FLOAT = /^\s*([+-]?\.\d+(?:[eE][+-]?\d+)?)/;

// Re-reads a word the way the tokenizer would (CN-26, CN-29).
export function classifyWord(w) {
  const lower = w.toLowerCase();
  if (w.startsWith('#')) return str(w); // property names stay text until a group closes
  const mi = INT_PREFIX.exec(w);
  if (mi) {
    const n = parseInt(mi[1], 10);
    return int(n > 2147483647 || n < -2147483648 ? (n | 0) : n);
  }
  const mf = DOT_FLOAT.exec(w);
  if (mf) return num(parseFloat(mf[1]));
  if (lower === 'true' || lower === 'yes') return bool(true);
  if (lower === 'false' || lower === 'no') return bool(false);
  return str(w);
}

const reinterpret = (val) => (val.k === 'str' && val.v !== '' ? classifyWord(val.v) : val);

function arith(op, a, b) {
  const x = numberOf(a), y = numberOf(b);
  const intMode = (a.k === 'int' || a.k === 'bool' || a.k === 'null') && (b.k === 'int' || b.k === 'bool' || b.k === 'null');
  if (intMode) {
    switch (op) {
      case '+': return int((x + y) | 0);
      case '-': return int((x - y) | 0);
      case '*': return int(Math.imul(x, y));
      case '/': return y === 0 ? int(x) : int(Math.trunc(x / y));
    }
  }
  switch (op) {
    case '+': return num(x + y);
    case '-': return num(x - y);
    case '*': return num(x * y);
    case '/': return y === 0 ? a : num(x / y);
  }
}

const FORMAT = /^%\.(\d+)s$/;

export function applyBinary(op, a, b, opts = {}) {
  const aStr = a.k === 'str', bStr = b.k === 'str';
  switch (op) {
    case '+':
      if (aStr || bStr) return reinterpret(str(textForConcat(a) + textForConcat(b)));
      return arith('+', a, b);
    case '-':
      if (aStr) {
        const needle = textForStringOp(b);
        return reinterpret(str(needle === '' ? a.v : a.v.split(needle).join('')));
      }
      if (bStr) return a;
      return arith('-', a, b);
    case '*':
      if (aStr) {
        const m = FORMAT.exec(a.v);
        if (m) {
          // Game measurement: '%.Ns' * 'literal' does not truncate (EXP-10, C-42).
          if (opts.literalNoTruncate && b.literal) return b;
          return reinterpret(str(utf8Truncate(textForStringOp(b), +m[1])));
        }
        return reinterpret(str(textForStringOp(b)));
      }
      if (bStr) return a;
      return arith('*', a, b);
    case '/':
      if (aStr) {
        const needle = textForStringOp(b);
        if (needle === '') return int(1);
        return int(a.v.split(needle).length - 1);
      }
      if (bStr) return a;
      return arith('/', a, b);
    case '=':
      if (aStr && bStr) return bool(a.v === b.v);
      if (aStr || bStr) return bool(!truthy(a) && !truthy(b));
      if (a.k === 'bool' || b.k === 'bool') return bool(truthy(a) === truthy(b));
      return bool(Math.fround(numberOf(a)) === Math.fround(numberOf(b)));
    case '<':
    case '>': {
      let x, y;
      if (aStr && bStr) {
        const c = Buffer_compare(a.v, b.v);
        return bool(op === '<' ? c < 0 : c > 0);
      }
      if (aStr || bStr) { x = truthy(a) ? 1 : 0; y = truthy(b) ? 1 : 0; }
      else { x = Math.fround(numberOf(a)); y = Math.fround(numberOf(b)); }
      return bool(op === '<' ? x < y : x > y);
    }
    case 'and': return bool(truthy(a) && truthy(b));
    case 'or': return bool(truthy(a) || truthy(b));
  }
  throw new Error('unknown operator ' + op);
}

function Buffer_compare(s, t) {
  const a = encoder.encode(s), b = encoder.encode(t);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

// ---------- tokenizer ----------
const DELIMS = new Set([' ', '\t', '\n', '\r', '(', ')', '$', '*', '+', '-', '/', '<', '=', '>']);
const OPS = new Set(['*', '+', '-', '/', '<', '=', '>']);

export function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '(' || c === ')') { toks.push({ t: c }); i++; continue; }
    if (OPS.has(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    if (c === "'" || c === '"') {
      const j = src.indexOf(c, i + 1);
      if (j < 0) { toks.push({ t: 'err', v: 'unterminated string' }); break; }
      toks.push({ t: 'val', v: { ...str(src.slice(i + 1, j)), literal: true } });
      i = j + 1;
      continue;
    }
    if (c === '$') {
      let j = i + 1;
      while (j < src.length && !DELIMS.has(src[j]) && src[j] !== "'" && src[j] !== '"') j++;
      toks.push({ t: 'var', v: src.slice(i, j) });
      i = j;
      continue;
    }
    let j = i;
    while (j < src.length && !DELIMS.has(src[j]) && src[j] !== "'" && src[j] !== '"') j++;
    const w = src.slice(i, j);
    i = j;
    const lw = w.toLowerCase();
    if (lw === 'and' || lw === 'or') toks.push({ t: 'op', v: lw });
    else if (lw === 'not') toks.push({ t: 'not' });
    else if (w.startsWith('#')) toks.push({ t: 'prop', v: w });
    else toks.push({ t: 'val', v: classifyWord(w) });
  }
  return toks;
}

const PREC = { '*': 2, '/': 2, '+': 3, '-': 3, '=': 4, '<': 4, '>': 4, and: 5, or: 5 };

class ExprError extends Error {}

// Evaluates an expression string. ctx: { prop(name) -> tagged|undefined, variable(name) -> tagged|undefined, opts }
// Returns { value, error, props: Set of #names read, vars: Set of $names read }.
export function evaluate(src, ctx = {}) {
  const props = new Set(), vars = new Set();
  const opts = ctx.opts || {};
  let toks;
  try {
    toks = tokenize(src);
    if (toks.some((t) => t.t === 'err')) throw new ExprError('Invalid expression');
    let pos = 0;
    const peek = () => toks[pos];
    const lookupProp = (name) => {
      props.add(name);
      const v = ctx.prop ? ctx.prop(name) : undefined;
      return v === undefined ? NULL : v;
    };
    const resolveHash = (val) => (val.k === 'str' && val.v.startsWith('#') && val.v.length > 1 ? lookupProp(val.v) : val);

    function operand() {
      const t = toks[pos++];
      if (!t) throw new ExprError('Invalid expression');
      if (t.t === 'not') return bool(!truthy(operand()));
      if (t.t === 'op' && (t.v === '-' || t.v === '+')) {
        const v = operand();
        if (t.v === '+') return v;
        if (v.k === 'str') return int(0);
        return v.k === 'num' ? num(-v.v) : int(-numberOf(v));
      }
      if (t.t === '(') {
        const v = expression(99);
        if (!peek() || peek().t !== ')') throw new ExprError('Invalid expression');
        pos++;
        return resolveHash(v);
      }
      if (t.t === 'prop') return lookupProp(t.v);
      if (t.t === 'var') {
        vars.add(t.v);
        const v = ctx.variable ? ctx.variable(t.v) : undefined;
        return v === undefined ? NULL : v;
      }
      if (t.t === 'val') return t.v;
      throw new ExprError('Invalid expression');
    }
    // Precedence climbing; `level` is the loosest operator rank allowed here.
    // Binary operators are left-associative, so the right side only takes tighter ranks.
    function expression(level) {
      let left = operand();
      for (;;) {
        const t = peek();
        if (!t || t.t === ')') return left;
        if (t.t !== 'op') throw new ExprError('Invalid expression'); // two operands in a row, e.g. `%`
        const p = PREC[t.v];
        if (p > level) return left;
        pos++;
        left = applyBinary(t.v, left, expression(p - 1), opts);
      }
    }
    const value = expression(99);
    if (pos !== toks.length) throw new ExprError('Invalid expression');
    return { value: resolveHash(value), error: null, props, vars };
  } catch (e) {
    if (e instanceof ExprError) return { value: NULL, error: e.message, props, vars };
    throw e;
  }
}

// Operators that do not exist in the language; reported as hints when an expression fails.
export function lintExpression(src) {
  const hints = [];
  const outside = src.replace(/'[^']*'|"[^"]*"/g, "''");
  if (/>=|<=/.test(outside)) hints.push('`>=`/`<=` 없음: `((a > b) or (a = b))` [EXP-03]');
  if (/!=|==|&&|\|\|/.test(outside)) hints.push('`!=`, `==`, `&&`, `||` 없음: `not`, `and`, `or` [EXP-01]');
  if (/\s%\s|\w%\s|\s%\w/.test(outside)) hints.push('`%` 연산자 없음(개발 빌드 assert) [EXP-02]');
  if (/[<>]\s*[#$\w.']+\s*[<>]/.test(outside)) hints.push('사슬 비교는 범위 검사가 아님 [EXP-28]');
  if (/\*\s*1(?![\d.])/.test(outside) || /(?<![\d.])1\s*\*/.test(outside)) hints.push('`* 1`은 숫자 변환이 아님. `(#v - 0)` [EXP-16]');
  if (/(?<![\w.])\d+\.\d+/.test(outside)) hints.push('`0.3`처럼 앞자리가 있는 소수는 정수. `.3`을 쓴다 [EXP-27]');
  if (/'%\.'\s*\+/.test(src)) hints.push('동적 N 서식은 1.21.130부터 막힘 [EXP-09, 종합-가이드 D-04]');
  return hints;
}

export function show(val) {
  switch (val.k) {
    case 'int': return `Int(${val.v})`;
    case 'num': return `Num(${val.v})`;
    case 'str': return `Text(${JSON.stringify(val.v)})`;
    case 'bool': return `Bool(${val.v})`;
    case 'json': return `Json(${JSON.stringify(val.v)})`;
    default: return 'Json(Null)';
  }
}
