// Size expression parser (LAY-03, LAY-34..37, CN-47).
// A parsed size is { kind: 'fill' } | { kind: 'default' } | { kind: 'terms', terms: [{ v, unit }] }
// with unit one of px, %, %c, %cm, %sm, %x, %y.

export function parseSize(x) {
  if (x === 'fill') return { kind: 'fill' };
  if (x === 'default' || x === null || x === undefined || typeof x === 'boolean') return { kind: 'default' };
  if (typeof x === 'number') return { kind: 'terms', terms: [{ v: x, unit: 'px' }] };
  if (typeof x !== 'string') return { kind: 'default' };
  const s = x.toLowerCase();
  const terms = [];
  let sign = 1;
  const re = /\s*([+-])|\s*(\d*\.?\d+)\s*(?:[cmsxy]+(?=%))?(px|%(cm|sm|c|x|y)?)?|\s*([a-z%]+)/gy;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < s.length && (m = re.exec(s))) {
    if (m[0] === '') break;
    if (m[1]) { sign = m[1] === '-' ? -1 : 1; continue; }
    if (m[2] !== undefined) {
      const unit = m[3] ? (m[3] === 'px' ? 'px' : '%' + (m[4] || '')) : null;
      if (unit) terms.push({ v: sign * parseFloat(m[2]), unit }); // unitless numbers are dropped
      continue;
    }
    // a bare '%' counts as 0%; other words are ignored ("Fill", "DEFAULT" become 0)
    if (m[5] === '%') terms.push({ v: 0, unit: '%' });
  }
  return { kind: 'terms', terms };
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
