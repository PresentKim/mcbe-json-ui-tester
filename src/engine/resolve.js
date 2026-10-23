// Instantiates a control tree from the catalog: inheritance, $variables, variables/requires, ignored.
// Rules: FILE-06..19, FILE-33..38, FILE-43, CN-14..CN-25.

import { evaluate, fromJson, toJson, truthy } from './expr.js';
import { splitKey, qualify } from './catalog.js';

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

export class Scope {
  constructor(parent = null, label = '') {
    this.parent = parent;
    this.label = label;
    this.concrete = new Map();
    this.defaults = new Map();
  }
  declare(key, value) {
    if (value === null) return; // null counts as unset (CN-15)
    if (key.endsWith('|default')) this.defaults.set(key.slice(0, -'|default'.length), value);
    else this.concrete.set(key, value);
  }
  // Nearest concrete value anywhere outward wins over any |default (FILE-33).
  raw(name) {
    for (let s = this; s; s = s.parent) if (s.concrete.has(name)) return { value: s.concrete.get(name), scope: s };
    for (let s = this; s; s = s.parent) if (s.defaults.has(name)) return { value: s.defaults.get(name), scope: s };
    return undefined;
  }
  lookup(name, depth = 0) {
    const hit = this.raw(name);
    if (!hit) return undefined;
    let v = hit.value;
    if (depth < 8 && typeof v === 'string') {
      if (/^\$[^\s()]+$/.test(v) && v !== name) {
        const next = this.lookup(v, depth + 1);
        return next === undefined ? v : next;
      }
      if (v.startsWith('(') && !v.includes('#')) {
        const r = evaluate(v, { variable: (n) => (n === name ? undefined : wrap(this.lookup(n, depth + 1))) });
        return r.error ? v : toJson(r.value);
      }
    }
    return v;
  }
}
const wrap = (x) => (x === undefined ? undefined : fromJson(x));

export function scopeVar(scope) {
  return (n) => wrap(scope.lookup(n));
}

// Flattens the @base chain. Derived properties replace base ones whole (FILE-37, CN-23).
export function flatten(cat, id, diag, scope, seen = new Set()) {
  const def = cat.defs.get(id);
  if (!def) return null;
  if (seen.has(id)) { diag('error', `상속 순환: ${[...seen, id].join(' → ')}`, id); return { props: {}, chain: [id], propNs: {} }; }
  seen.add(id);
  let base = null;
  if (def.base) {
    let baseId = def.base;
    if (baseId.startsWith('$')) {
      const v = scope ? scope.lookup(baseId) : undefined;
      if (typeof v !== 'string') { diag('warn', `@${baseId}: 변수 기반이 문자열이 아니다 [CN-25]`, id); baseId = null; }
      else baseId = qualify(v.replace(/^@/, ''), def.ns);
    }
    if (baseId) {
      base = flatten(cat, baseId, diag, scope, seen);
      if (!base) diag('error', `UI control reference not found: '${baseId}'`, id);
    }
  }
  const props = { ...(base ? base.props : {}) };
  const propNs = { ...(base ? base.propNs : {}) };
  for (const [k, v] of Object.entries(def.props)) {
    if (v === null) { delete props[k]; continue; } // null in a named definition hides the base value (CN-24)
    props[k] = v;
    propNs[k] = def.ns;
  }
  const pathKeys = [...(base ? base.pathKeys : []), ...(def.pathKeys || [])];
  return { props, chain: [id, ...(base ? base.chain : [])], propNs, ns: def.ns, pathKeys };
}

export function substitute(value, scope, ctx) {
  if (typeof value === 'string') {
    if (/^\$[^\s()]+$/.test(value)) {
      const v = scope.lookup(value);
      if (v === undefined) {
        ctx.unresolved.add(value);
        return value;
      }
      return v;
    }
    if (value.startsWith('(') && value.includes('$') && !value.includes('#')) {
      const r = evaluate(value, { variable: scopeVar(scope) });
      if (r.error) { ctx.diag('warn', `변수 식 실패: ${value}`); return value; }
      return toJson(r.value);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((x) => substitute(x, scope, ctx));
  if (isObj(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, scope, ctx);
    return out;
  }
  return value;
}

function evalGate(expr, scope) {
  if (expr === null || expr === undefined) return { value: false };
  if (typeof expr === 'boolean') return { value: expr };
  if (typeof expr === 'number') {
    if (!Number.isInteger(expr)) return { value: false, error: 'An invalid value was provided for "ignored" field.' };
    return { value: expr !== 0 };
  }
  if (typeof expr !== 'string') return { value: false, error: 'An invalid value was provided for "ignored" field.' };
  if (expr.startsWith('$') && !expr.includes(' ')) {
    const v = scope.lookup(expr);
    if (v === undefined) return { value: false, note: `미설정 ${expr}는 글자로 남아 생성된다 [FILE-35]` };
    if (typeof v === 'string') {
      if (v.startsWith('(')) return evalGate(v, scope);
      return { value: false };
    }
    return evalGate(v, scope);
  }
  if (expr.startsWith('(')) {
    if (expr.includes('#')) return { value: false, error: 'ignored에는 #바인딩을 쓸 수 없다 [FILE-16]' };
    const r = evaluate(expr, { variable: scopeVar(scope) });
    if (r.error) return { value: false, error: `식 실패: ${expr}` };
    const v = r.value;
    if (v.k === 'bool') return { value: v.v };
    if (v.k === 'int') return { value: v.v !== 0 };
    return { value: false };
  }
  return { value: false };
}

let nextId = 1;

// Builds a node. ref: 'ns.name' | '$var' | null (inline); inline: properties at the reference site.
export function instantiate(cat, ref, name, inline, parentScope, parent, env, pending = []) {
  const diag = (level, msg) => env.diags.push({ level, msg, where: pathOf(parent) + '/' + name });
  // reference-site $ values belong to this control's frame (CN-14)
  const frame = new Scope(parentScope, name);
  for (const [k, v] of Object.entries(inline || {})) if (k.startsWith('$')) frame.declare(k, v);

  let flat = { props: {}, chain: [], propNs: {}, ns: env.ns, pathKeys: [] };
  if (ref) {
    let id = ref;
    if (id.startsWith('$')) {
      const v = frame.lookup(id);
      if (typeof v !== 'string') { diag('error', `UI control reference not found: '${ref}'`); id = null; }
      else id = qualify(v.replace(/^@/, ''), env.ns);
    }
    if (id) {
      const f = flatten(cat, id, (lv, m, w) => env.diags.push({ level: lv, msg: m, where: w }), frame);
      if (!f) diag('error', `UI control reference not found: '${id}'`);
      else flat = f;
    }
  }
  const props = { ...flat.props };
  for (const [k, v] of Object.entries(inline || {})) {
    if (v === null) continue; // inline null keeps the base value (CN-24)
    props[k] = v;
  }
  for (const p of pending) if (p.path.length === 0) Object.assign(props, p.body);

  const node = {
    uid: nextId++, name, parent, defId: flat.chain[0] || null, chain: flat.chain,
    ns: flat.ns || env.ns, children: [], diags: [], raw: props,
  };
  node.diags = [];
  const ndiag = (level, msg) => { node.diags.push({ level, msg }); diag(level, msg); };

  // ignored is evaluated in the parent scope, before this control's own $ and variables (FILE-34, FILE-43)
  if (props.ignored !== undefined) {
    const g = evalGate(props.ignored, parentScope);
    if (g.error) ndiag('error', g.error);
    if (g.note) node.diags.push({ level: 'info', msg: g.note });
    if (g.value) { node.ignored = true; node.type = props.type || null; return node; }
    // a gate that only this control declares is invisible to its own ignored
    if (typeof props.ignored === 'string') {
      const m = props.ignored.match(/\$[\w.|]+/g) || [];
      for (const v of m) if (Object.keys(props).includes(v) || Object.keys(props).includes(v + '|default')) {
        node.diags.push({ level: 'warn', msg: `ignored가 읽는 ${v}를 이 컨트롤이 선언했지만 자기 ignored에는 닿지 않는다 [FILE-34]` });
      }
    }
  }

  for (const [k, v] of Object.entries(props)) if (k.startsWith('$') && !(inline && k in inline)) frame.declare(k, v);
  // variables: object or array of objects, a block applies when `requires` holds (FILE-13, CN-18)
  let vars = props.variables;
  if (typeof vars === 'string') vars = frame.lookup(vars);
  const blocks = Array.isArray(vars) ? vars : isObj(vars) ? [vars] : [];
  node.appliedVariables = [];
  for (const b of blocks) {
    if (!isObj(b)) continue;
    let ok = true;
    if ('requires' in b) {
      const req = b.requires;
      if (typeof req === 'string' && req.includes('#')) ok = false;
      else if (typeof req === 'string' && req.startsWith('(')) {
        const r = evaluate(req, { variable: scopeVar(frame) });
        ok = !r.error && truthy(r.value);
      } else if (typeof req === 'string' && req.startsWith('$')) {
        const v = frame.lookup(req);
        ok = v !== undefined && truthy(fromJson(v));
      } else ok = truthy(fromJson(req));
    }
    if (!ok) continue;
    node.appliedVariables.push(b.requires ?? '(always)');
    for (const [k, v] of Object.entries(b)) if (k.startsWith('$')) frame.declare(k, v);
  }
  node.scope = frame;

  const sctx = { unresolved: new Set(), diag: ndiag };
  const resolved = {};
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('$') || k === 'variables' || k === 'ignored') continue;
    if (k === 'controls') continue;
    resolved[k] = k === 'modifications' ? v : substitute(v, frame, sctx);
  }
  if (Array.isArray(resolved.bindings)) {
    // whole-value $ substitution works in bindings (BND-12); partial $ inside expressions is kept for bind time
    resolved.bindings = resolved.bindings.map((b) => (isObj(b) ? substitute(b, frame, sctx) : b));
  }
  node.props = resolved;
  node.type = resolved.type ?? null;
  if (!node.type && node.chain.length === 0 && !inline?.type) {
    ndiag('error', 'Type not specified (or @-base not found)');
  } else if (!node.type) {
    ndiag('error', 'Type not specified (or @-base not found)');
  }

  // children
  let controls = props.controls;
  if (typeof controls === 'string') controls = frame.lookup(controls);
  const childNs = (flat.propNs && flat.propNs.controls) || node.ns;
  const childPending = [...pending.filter((p) => p.path.length > 0), ...(flat.pathKeys || [])];
  if (Array.isArray(controls)) {
    for (const el of controls) {
      if (!isObj(el)) continue;
      let [key] = Object.keys(el);
      if (!key) continue;
      let body = el[key];
      if (key.startsWith('$') && !key.includes('@')) {
        // the whole key is a variable holding "name@ns.def" (CN-22)
        const v = frame.lookup(key);
        if (typeof v !== 'string') { ndiag('warn', `자식 키 ${key}의 변수가 없다`); continue; }
        key = v;
      }
      let { name: cname, base } = splitKey(key);
      let realName = cname;
      if (realName.startsWith('$')) realName = String(frame.lookup(realName) ?? realName);
      if (base && base.startsWith('$')) {
        const v = frame.lookup(base);
        if (typeof v !== 'string') { ndiag('error', `UI control reference not found: '${base}'`); continue; }
        base = v.replace(/^@/, '');
      }
      const pend = childPending.filter((p) => p.path[0] === realName).map((p) => ({ ...p, path: p.path.slice(1) }));
      const child = instantiate(cat, base ? qualify(base, childNs) : null, realName, isObj(body) ? body : {}, frame, node, { ...env, ns: childNs }, pend);
      node.children.push(child);
    }
  }
  for (const p of pending) if (p.path.length > 0 && !node.children.some((c) => c.name === p.path[0])) {
    ndiag('warn', `경로 키 대상 '${p.path.join('/')}'가 없다 [FILE-27]`);
  }
  if (sctx.unresolved.size) node.diags.push({ level: 'info', msg: `정해지지 않은 변수: ${[...sctx.unresolved].join(', ')}` });
  return node;
}

export function pathOf(node) {
  const parts = [];
  for (let n = node; n; n = n.parent) parts.unshift(n.name);
  return parts.join('/');
}

export function buildTree(cat, rootRef, env = {}) {
  const diags = [];
  const root = new Scope(null, 'global');
  for (const [k, v] of Object.entries(cat.globals)) root.declare(k, v);
  for (const [k, v] of Object.entries(env.platform || {})) root.declare(k, v);
  const hostScope = new Scope(root, 'host');
  for (const [k, v] of Object.entries(env.hostVars || {})) hostScope.declare(k, v);
  const [ns] = rootRef.split('.');
  const tree = instantiate(cat, rootRef, rootRef.split('.').slice(1).join('.'), {}, hostScope, null, { diags, ns });
  return { tree, diags, rootScope: hostScope };
}
