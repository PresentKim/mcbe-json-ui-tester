// Size expression parser (LAY-03, LAY-34..37, CN-47).
// A parsed size is { kind: 'fill' } | { kind: 'default' } | { kind: 'terms', terms: [{ v, unit }] }
// with unit one of px, %, %c, %cm, %sm, %x, %y.

const SEPARATORS = new Set(['%', 'm', 'x', 'y', 'c', 's', '+', '-']);
const PERCENT_SUFFIX = [[['c', 'm'], '%cm'], [['c'], '%c'], [['s', 'm'], '%sm'], [['x'], '%x'], [['y'], '%y']];

function sizeTokens(s) {
  const out = [];
  let word = '';
  const flush = () => { if (word !== '') { out.push({ num: word }); word = ''; } };
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith('px', i)) { flush(); out.push({ sep: 'px' }); i++; continue; }
    if (SEPARATORS.has(s[i])) { flush(); out.push({ sep: s[i] }); continue; }
    word += s[i];
  }
  flush();
  return out;
}

const readFloat = (w) => {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/.exec(w);
  return m ? Math.fround(parseFloat(m[1])) : 0;
};

export function parseSize(x) {
  if (x === 'fill') return { kind: 'fill' };
  if (x === 'default') return { kind: 'default' };
  if (typeof x === 'number') return { kind: 'terms', terms: [{ v: x, unit: 'px' }] };
  if (typeof x !== 'string') return { kind: 'default' };
  const toks = sizeTokens(x.toLowerCase());
  const terms = [];
  let last = 0, neg = false, dangling = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.num !== undefined) { last = readFloat(t.num); dangling = true; continue; }
    if (t.sep === '-') { neg = true; continue; }
    if (t.sep === '+') { neg = false; continue; }
    if (t.sep === 'px') { terms.push({ v: neg ? -last : last, unit: 'px' }); dangling = false; continue; }
    if (t.sep !== '%') continue;
    let unit = '%';
    for (const [seq, u] of PERCENT_SUFFIX) {
      if (seq.every((c, k) => toks[i + 1 + k]?.sep === c)) { unit = u; i += seq.length; break; }
    }
    terms.push({ v: neg ? -last : last, unit });
    dangling = false;
  }
  return { kind: 'terms', terms, dangling };
}

// Resolves terms to pixels. env: { parent, self: {w,h}, axis: 'w'|'h', childSum, childMax, siblingMax }
export function resolveTerms(size, env) {
  let px = 0;
  for (const t of size.terms) {
    switch (t.unit) {
      case 'px': px += t.v; break;
      case '%': px += (t.v / 100) * env.parent; break;
      case '%c': px += (t.v / 100) * env.childSum; break;
      case '%cm': px += env.childMax; break; // coefficient and sign ignored (LAY-37)
      case '%sm': px += env.siblingMax; break;
      case '%x': px += (t.v / 100) * (env.selfW ?? 0); break;
      case '%y': px += (t.v / 100) * (env.selfH ?? 0); break;
    }
  }
  return px;
}

export const usesChildren = (size) => size.kind === 'terms' && size.terms.some((t) => t.unit === '%c' || t.unit === '%cm');
export const usesSiblings = (size) => size.kind === 'terms' && size.terms.some((t) => t.unit === '%sm');
