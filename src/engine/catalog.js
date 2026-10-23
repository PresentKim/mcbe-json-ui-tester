// Loads UI files from packs and builds the definition catalog.
// Order and merge rules: CN-03..CN-13, FILE-20..22, MOD-01..05, MOD-17..19, MOD-23..25.

import { parseJsonc } from './jsonc.js';

export const MOD_OPS = ['insert_back', 'insert_front', 'insert_after', 'insert_before', 'move_back', 'move_front', 'move_after', 'move_before', 'swap', 'remove', 'replace'];

export function splitKey(key) {
  const at = key.indexOf('@');
  if (at < 0) return { name: key, base: null };
  return { name: key.slice(0, at), base: key.slice(at + 1) };
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

function deepMerge(into, from) {
  for (const [k, v] of Object.entries(from)) {
    if (isObj(v) && isObj(into[k])) deepMerge(into[k], v);
    else into[k] = clone(v);
  }
  return into;
}

// packs: [{ name, files: { 'ui/x.json': text, ... }, vanilla?: boolean }] in pack order (vanilla first)
export function buildCatalog(packs, opts = {}) {
  const diags = [];
  const diag = (level, msg, where) => diags.push({ level, msg, where });
  const defs = new Map(); // 'ns.name' -> def
  const globals = {};
  const pathNamespace = new Map();

  // _ui_defs from every pack, sorted and de-duplicated (CN-03)
  const paths = new Set();
  for (const p of packs) {
    const t = p.files['ui/_ui_defs.json'];
    if (!t) continue;
    const r = parseJsonc(t);
    if (r.error) diag('error', `_ui_defs.json: ${r.error}`, `${p.name}:ui/_ui_defs.json`);
    for (const f of r.value.ui_defs || []) paths.add(f);
  }
  for (const p of packs) {
    const t = p.files['ui/_global_variables.json'];
    if (!t) continue;
    const r = parseJsonc(t);
    if (r.error) diag('error', `JSON UI parse failure: ${r.error}`, `${p.name}:ui/_global_variables.json`);
    deepMerge(globals, r.value);
  }
  for (const p of packs) for (const f of Object.keys(p.files)) {
    if (/^ui\/.+/.test(f) && !paths.has(f) && !f.endsWith('_ui_defs.json') && !f.endsWith('_global_variables.json') && /\.(json|r4ui|uidx)$/i.test(f)) {
      diag(p.vanilla ? 'info' : 'warn', `${f}: _ui_defs.json에 등록되지 않아 로드되지 않는다 [FILE-01]`, p.name);
    }
  }

  const sorted = [...paths].sort();
  for (const path of sorted) {
    let firstFailed = false;
    let seenOnce = false;
    for (const pack of packs) {
      const text = pack.files[path];
      if (text === undefined) continue;
      const where = `${pack.name}:${path}`;
      const r = parseJsonc(text);
      if (r.error) {
        diag('error', `JSON UI parse failure: ${r.error}. 오류 앞까지만 로드 [FILE-30]`, where);
        if (!seenOnce) firstFailed = true;
      } else if (firstFailed) {
        diag('warn', '같은 경로의 첫 파일이 실패해 이 덮어쓰기는 받지 않는다 [CN-02]', where);
        continue;
      }
      const doc = r.value;
      let ns = doc.namespace || pathNamespace.get(path);
      if (!ns) {
        diag('error', 'namespace가 없다', where);
        continue;
      }
      if (!pathNamespace.has(path)) pathNamespace.set(path, ns);
      const samePathRedef = seenOnce;
      seenOnce = true;
      for (const [key, body] of Object.entries(doc)) {
        if (key === 'namespace') continue;
        if (!isObj(body)) { diag('warn', `${key}: 정의가 객체가 아님`, where); continue; }
        if (key.includes('/')) { applyPathKey(defs, ns, key, body, where, diag); continue; }
        let { name, base } = splitKey(key);
        let defNs = ns;
        if (!base && name.includes('.')) {
          // a dotted key without @ reads as namespace.name (FILE-32)
          const dot = name.indexOf('.');
          defNs = name.slice(0, dot) || ns;
          name = name.slice(dot + 1);
          diag('warn', `${key}: '@' 없는 키의 점은 namespace 구분자로 읽힌다 [FILE-32]`, where);
        }
        const id = `${defNs}.${name}`;
        const existing = defs.get(id);
        const own = clone(body);
        const mods = own.modifications;
        delete own.modifications;
        if (!existing) {
          if (mods && !samePathRedef) {
            diag('error', `${id}: Unknown property [modifications] — modifications는 바닐라와 같은 경로 파일에서만 동작한다 [MOD-02]`, where);
          }
          if (!base && !own.type) {
            // may be completed by a later same-path redefinition; checked in resolve
          }
          defs.set(id, { id, ns: defNs, name, base: base ? qualify(base, defNs) : null, props: own, path, pack: pack.name, vanilla: !!pack.vanilla, history: [where] });
          if (mods) applyModifications(defs.get(id), mods, where, diag);
          continue;
        }
        if (existing.path !== path) {
          if (opts.measured && existing.vanilla) {
            diag('warn', `${id}: 다른 경로 파일의 바닐라 재선언은 무시된다 [FILE-22, MOD-02]`, where);
            continue;
          }
          if (opts.measured) {
            diag('warn', `${id}: 다른 경로에서 다시 정의해 원래 정의를 대체한다 [MOD-02]`, where);
            defs.set(id, { id, ns: defNs, name, base: base ? qualify(base, defNs) : null, props: own, path, pack: pack.name, vanilla: false, history: [...existing.history, where] });
            if (mods) diag('error', `${id}: Unknown property [modifications] [MOD-02]`, where);
            continue;
          }
        }
        // same-path redefinition: merge property by property (FILE-21, CN-05/06)
        const qBase = base ? qualify(base, defNs) : null;
        if (qBase && qBase !== existing.base) {
          diag('info', `${id}: 다른 @base로 재선언해 기존 정의를 버린다 [MOD-19]`, where);
          existing.props = own;
          existing.base = qBase;
        } else {
          deepMerge(existing.props, own);
        }
        existing.history.push(where);
        existing.pack = pack.name;
        existing.vanilla = existing.vanilla && !!pack.vanilla;
        if (mods) applyModifications(existing, mods, where, diag);
      }
    }
  }
  for (const { def, arrayName, where } of diag.pending || []) {
    for (let id = def.base, guard = 0; id && guard < 32; guard++) {
      const b = defs.get(id);
      if (!b) break;
      if (Array.isArray(b.props[arrayName]) && b.props[arrayName].length) {
        diag('warn', `${def.id}: 상속만 받은 '${arrayName}'(${b.id})에 넣어 상속 내용이 가려진다 [MOD-04]`, where);
        break;
      }
      id = b.base && !b.base.startsWith('$') ? b.base : null;
    }
  }
  return { defs, globals, diags, paths: sorted };
}

export function qualify(ref, ns) {
  if (ref.startsWith('$')) return ref;
  if (ref.startsWith('.')) return ns + ref; // "@.name" means the same file's namespace
  return ref.includes('.') ? ref : `${ns}.${ref}`;
}

function controlName(el) {
  if (!isObj(el)) return null;
  const k = Object.keys(el)[0];
  return k ? splitKey(k).name : null;
}

function selectIndex(arr, original, sel, isControls) {
  // only elements present before this modifications block can be selected (MOD-17, CN-12)
  for (let i = 0; i < arr.length; i++) {
    if (!original.has(arr[i])) continue;
    if (sel.control_name !== undefined && isControls) {
      if (controlName(arr[i]) === sel.control_name) return i;
      continue;
    }
    if (isObj(sel.where)) {
      const entries = Object.entries(sel.where);
      if (entries.length === 0) return -1;
      if (isObj(arr[i]) && entries.some(([k, v]) => JSON.stringify(arr[i][k]) === JSON.stringify(v))) return i;
      continue;
    }
    if (sel.control_name === undefined && sel.where === undefined) return i;
  }
  return -1;
}

export function applyModifications(def, mods, where, diag) {
  if (!Array.isArray(mods)) { diag('error', `${def.id}: modifications는 배열이어야 한다`, where); return; }
  const props = def.props;
  const originals = new Map();
  for (const m of mods) {
    if (!isObj(m)) continue;
    let arrayName = m.array_name;
    if (!arrayName && typeof m.control_name === 'string') arrayName = 'controls'; // NB-03
    if (!arrayName) { diag('error', `${def.id}: array_name이 없다`, where); continue; }
    const op = m.operation;
    if (!MOD_OPS.includes(op)) { diag('error', `${def.id}: 알 수 없는 operation '${op}' (엔진 연산은 11개) [MOD-23]`, where); continue; }
    if (arrayName === 'variables') diag('warn', `${def.id}: variables 대상 modifications는 게임에서 무시됐다 [MOD-03, C-64]`, where);
    if (!Array.isArray(props[arrayName])) {
      if (props[arrayName] !== undefined && !Array.isArray(props[arrayName])) { diag('error', `${def.id}.${arrayName}: 배열이 아니다`, where); continue; }
      // the definition does not declare the array itself: a new array masks the inherited one (MOD-04).
      // Whether the base really has that array is checked once every file is loaded.
      if (def.base) (diag.pending ||= []).push({ def, arrayName, where });
      props[arrayName] = [];
    }
    const arr = props[arrayName];
    if (!originals.has(arrayName)) originals.set(arrayName, new Set(arr));
    const original = originals.get(arrayName);
    const isControls = arrayName === 'controls';
    const values = m.value == null ? null : Array.isArray(m.value) ? clone(m.value) : [clone(m.value)];
    const idx = () => selectIndex(arr, original, { control_name: m.control_name, where: m.where }, isControls);
    const targetSel = typeof m.target_control === 'string' ? { control_name: m.target_control } : isObj(m.target) ? { where: m.target } : null; // MOD-24
    const tIdx = () => (targetSel ? selectIndex(arr, original, targetSel, isControls) : -1);
    const miss = () => diag('warn', `${def.id}: ${op} 대상(${m.control_name ?? JSON.stringify(m.where)})을 찾지 못했다`, where);
    switch (op) {
      case 'insert_back': if (values) arr.push(...values); break;
      case 'insert_front': if (values) arr.unshift(...values); break;
      case 'insert_after': case 'insert_before': {
        const i = idx(); if (i < 0) { miss(); break; }
        if (values) arr.splice(op === 'insert_after' ? i + 1 : i, 0, ...values); break;
      }
      case 'remove': {
        const i = idx(); if (i < 0) { miss(); break; }
        arr.splice(i, 1);
        if (isControls && def.base && !def.vanilla) diag('warn', `${def.id}: 컨트롤 remove — 상속받은 자식이면 게임에서는 이 파일의 수정 전체가 무효가 된다 [MOD-05]`, where);
        break;
      }
      case 'replace': {
        const i = idx(); if (i < 0) { miss(); break; }
        if (values) arr.splice(i, 1, ...values); break;
      }
      case 'move_back': case 'move_front': {
        const i = idx(); if (i < 0) { miss(); break; }
        const [el] = arr.splice(i, 1);
        op === 'move_back' ? arr.push(el) : arr.unshift(el); break;
      }
      case 'move_after': case 'move_before': {
        const i = idx(); if (i < 0) { miss(); break; }
        const el = arr[i];
        const j0 = tIdx(); if (j0 < 0 || j0 === i) break;
        arr.splice(i, 1);
        const j = arr.indexOf(arr[j0 > i ? j0 - 1 : j0]);
        arr.splice(op === 'move_after' ? j + 1 : j, 0, el); break;
      }
      case 'swap': {
        const i = idx(), j = tIdx(); if (i < 0 || j < 0) { miss(); break; }
        [arr[i], arr[j]] = [arr[j], arr[i]]; break;
      }
    }
    if (arr.length === 0) props[arrayName] = null;
  }
}

// "a/b/c": { … } merges into a nested inline control of definition `a` (FILE-20, CN-08).
function applyPathKey(defs, ns, key, body, where, diag) {
  const parts = key.split('/');
  const def = defs.get(`${ns}.${parts[0]}`);
  if (!def) { diag('warn', `${key}: 경로 키의 시작 정의가 없다 [FILE-27]`, where); return; }
  let node = def.props;
  for (const seg of parts.slice(1)) {
    const kids = Array.isArray(node.controls) ? node.controls : [];
    const hit = kids.find((el) => controlName(el) === seg);
    if (!hit) {
      def.pathKeys = def.pathKeys || [];
      def.pathKeys.push({ path: parts.slice(1), body: clone(body), where });
      return; // may live in an inherited subtree; applied at resolve time
    }
    node = hit[Object.keys(hit)[0]];
  }
  deepMerge(node, body);
}
