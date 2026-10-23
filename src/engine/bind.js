// Binding stage: property bags, factories and collections, global/collection/view bindings,
// binding_condition over ticks. Rules: BND-*, COL-*, CN-31..CN-46, NB-04..NB-09.

import { evaluate, fromJson, toJson, truthy, lintExpression } from './expr.js';
import { instantiate, Scope, scopeVar, pathOf } from './resolve.js';
import { splitKey, qualify } from './catalog.js';

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const CONDITIONS = ['none', 'once', 'always', 'always_when_visible', 'visible', 'visibility_changed'];
const TYPES = ['global', 'collection', 'collection_details', 'view', 'none'];

export function walk(node, fn, includeIgnored = false) {
  if (node.ignored && !includeIgnored) return;
  fn(node);
  for (const c of node.children) walk(c, fn, includeIgnored);
}

// host: { globals: {'#x': v}, collections: { name: [ {'#k': v, role?} ] }, factories: { name: { roles: [...], vars: {} } } }
export class Session {
  constructor(cat, tree, opts = {}) {
    this.cat = cat;
    this.tree = tree;
    this.opts = opts; // { measured: bool }
    this.tick = 0;
    this.events = [];
  }

  diag(node, level, msg) {
    const d = { level, msg, where: pathOf(node) };
    node.bindDiags.push(d);
  }

  run(host) {
    this.host = host;
    this.tick++;
    walk(this.tree, (n) => { n.bindDiags = []; });
    for (let round = 0; round < 8; round++) {
      this.prepareBags();
      this.bindAll();
      if (!this.expandFactories()) break;
    }
    this.applyAll();
    walk(this.tree, (n) => { n.prevVisible = n.effVisible; n.bound = true; });
    return this.tree;
  }

  prepareBags() {
    const setup = (node, inherited) => {
      if (!node.bag) {
        node.bag = new Map();
        for (const [k, v] of Object.entries(isObj(node.props.property_bag) ? node.props.property_bag : {})) {
          // constant expressions in a bag literal are computed (BND-28)
          if (typeof v === 'string' && v.startsWith('(') && !v.includes('#')) {
            const r = evaluate(v, { variable: scopeVar(node.scope) });
            node.bag.set(k, r.error ? fromJson(v) : r.value);
          } else node.bag.set(k, fromJson(v));
        }
        node.bindState = new Map();
      }
      const next = new Map(inherited);
      // engine factories hand the made control a creation bag (form title/body: CN-60)
      if (node.creationBag) for (const [k, v] of Object.entries(node.creationBag)) next.set(k, fromJson(v));
      for (const [k, v] of next) if (!node.bag.has(k)) node.bag.set(k, v);
      if (isObj(node.props.property_bag_for_children)) {
        for (const [k, v] of Object.entries(node.props.property_bag_for_children)) next.set(k, fromJson(v));
      }
      for (const c of node.children) if (!c.ignored) setup(c, next);
    };
    setup(this.tree, new Map());
  }

  // ---------- collections ----------
  isCollectionParent(node) {
    return node && typeof node.props.collection_name === 'string' && node.props.collection_name !== '';
  }
  collectionItem(node) {
    // a control is a collection item only as a direct child of a collection parent (COL-44, NB-07)
    for (let n = node; n; n = n.parent) {
      if (n.parent && this.isCollectionParent(n.parent) && !n.props.ignoreCollectionItem) {
        const idx = n.factoryIndex ?? (Number.isInteger(n.props.collection_index) ? n.props.collection_index : -1);
        return { index: idx, collection: n.parent.props.collection_name, item: n };
      }
    }
    return null;
  }
  collectionValue(node, cname, key) {
    const ci = this.collectionItem(node);
    const idx = ci ? ci.index : 0; // outside a collection item, index 0 (COL-05)
    if (idx < 0) return undefined;
    const list = this.host.collections?.[cname];
    if (!list) return undefined;
    const item = list[idx];
    if (!item) return undefined;
    return item[key];
  }

  // ---------- factories ----------
  factoryInfo(node) {
    const p = node.props;
    if (p.type === 'factory' && (p.control_name || p.control_ids)) {
      return { name: node.name, control_name: p.control_name, control_ids: p.control_ids, max: p.max_children_size, vars: p.factory_variables, insert: p.insert_location };
    }
    if (isObj(p.factory)) {
      const f = p.factory;
      if (!f.name && p.type !== 'factory') this.diag(node, 'error', 'The factory name should not be empty!');
      return { name: f.name || node.name, control_name: f.control_name, control_ids: f.control_ids, max: f.max_children_size, vars: f.factory_variables, insert: f.insert_location };
    }
    return null;
  }

  wantedRoles(node, info) {
    const bound = node.bag.get('#collection_length');
    const cname = node.props.collection_name;
    const hostF = this.host.factories?.[info.name];
    let roles;
    if (bound && bound.k !== 'null') {
      if (bound.k === 'json' && Array.isArray(bound.v)) roles = bound.v.map(String);
      else if (bound.k === 'int' || bound.k === 'bool') {
        const n = bound.k === 'bool' ? (bound.v ? 1 : 0) : bound.v;
        roles = Array.from({ length: Math.max(0, n) }, () => null);
      } else roles = [];
    } else if (hostF) {
      roles = hostF.roles.slice();
    } else if (cname && this.host.collections?.[cname]) {
      roles = this.host.collections[cname].map((it) => it.role ?? null);
    } else roles = [];
    const max = Number.isInteger(info.max) && info.max > 0 ? info.max : Infinity;
    return roles.slice(0, max);
  }

  expandFactories() {
    let changed = false;
    const visit = (node) => {
      if (node.ignored || !node.bag) return; // made this round; expanded on the next one
      const info = this.factoryInfo(node);
      if (info) {
        const roles = this.wantedRoles(node, info);
        const key = JSON.stringify(roles) + JSON.stringify(this.host.factories?.[info.name]?.vars || {});
        if (node.factoryKey !== key) {
          node.factoryKey = key;
          node.children = node.children.filter((c) => !c.fromFactory);
          const made = [];
          roles.forEach((role, i) => {
            let tmpl = null;
            if (info.control_name) tmpl = info.control_name;
            else if (isObj(info.control_ids)) {
              tmpl = role !== null ? info.control_ids[role] : Object.values(info.control_ids)[0];
              if (role !== null && !tmpl) return; // roles the factory does not know make nothing (COL-27)
            }
            if (!tmpl) return;
            let { name, base } = splitKey(tmpl.startsWith('@') ? tmpl : tmpl.includes('@') ? tmpl : '@' + tmpl);
            if (!name) name = role || node.name + '_item';
            const scope = new Scope(node.scope, `factory:${info.name}`);
            for (const [k, v] of Object.entries(this.host.factories?.[info.name]?.vars || {})) scope.declare(k, v);
            if (Array.isArray(info.vars)) for (const v of info.vars) {
              if (typeof v !== 'string') { this.diag(node, 'error', 'factory_variables should all be strings of json variables created higher up the tree.'); continue; }
              const val = node.scope.lookup(v);
              if (val === undefined) this.diag(node, 'warn', `Expected variable not found in ancestor tree: '${v}'`);
              else scope.declare(v, val);
            }
            const env = { diags: [], ns: node.ns };
            const child = instantiate(this.cat, qualify(base, node.ns), name, {}, scope, node, env);
            child.fromFactory = true;
            child.factoryIndex = i;
            const cb = this.host.factories?.[info.name]?.bag;
            if (cb) child.creationBag = cb;
            for (const d of env.diags) node.bindDiags.push(d);
            made.push(child);
          });
          node.children = info.insert === 'front' ? [...made, ...node.children] : [...node.children, ...made];
          changed = true;
        }
      }
      if (node.props.type === 'grid' && node.props.grid_item_template) this.expandGrid(node) && (changed = true);
      for (const c of node.children) visit(c);
    };
    visit(this.tree);
    return changed;
  }

  expandGrid(node) {
    const p = node.props;
    let count;
    const maxBound = node.bag.get('#maximum_grid_items');
    const dimsName = p.grid_dimension_binding;
    let dims = Array.isArray(p.grid_dimensions) ? p.grid_dimensions : null;
    if (dimsName) {
      const d = node.bag.get(dimsName) ?? fromJson(this.host.globals?.[dimsName]);
      dims = d && d.k === 'json' && Array.isArray(d.v) ? d.v : [0, 0];
    }
    if (maxBound && (maxBound.k === 'int' || maxBound.k === 'num')) count = Math.trunc(maxBound.v);
    else if (Number.isInteger(p.maximum_grid_items)) count = p.maximum_grid_items;
    else if (dims) count = dims[0] * dims[1];
    else if (p.collection_name && this.host.collections?.[p.collection_name]) count = this.host.collections[p.collection_name].length;
    else count = 0;
    if (dims && p.grid_rescaling_type == null) count = Math.min(count, dims[0] * dims[1]);
    const key = `grid:${count}:${JSON.stringify(dims)}`;
    if (node.factoryKey === key) return false;
    node.factoryKey = key;
    node.gridDims = dims;
    node.children = node.children.filter((c) => !c.fromFactory);
    const { name, base } = splitKey(p.grid_item_template.includes('@') ? p.grid_item_template : '@' + p.grid_item_template);
    for (let i = 0; i < count; i++) {
      const env = { diags: [], ns: node.ns };
      const child = instantiate(this.cat, qualify(base || name, node.ns), `${name || 'grid_item'}${i}`, {}, node.scope, node, env);
      child.fromFactory = true;
      child.factoryIndex = i;
      node.children.push(child);
    }
    return true;
  }

  // ---------- bindings ----------
  bindAll() {
    const views = [];
    walk(this.tree, (node) => {
      const bs = node.props.bindings;
      node.droppedBindings = false;
      if (bs === undefined) return;
      if (!Array.isArray(bs)) { this.diag(node, 'error', 'Must define bindings as an array.'); return; }
      // measured: a view expression without any #property drops the whole array (BND-05)
      if (this.opts.measured) {
        for (const b of bs) {
          if (isObj(b) && b.binding_type === 'view' && typeof b.source_property_name === 'string' && !b.source_property_name.includes('#')) {
            this.diag(node, 'error', `Must define a source property name in the binding! — '#'가 없는 식이라 이 컨트롤의 bindings 전체가 버려졌다 [BND-05]`);
            node.droppedBindings = true;
          }
        }
        if (node.droppedBindings) return;
      }
      bs.forEach((b, i) => {
        if (!isObj(b)) return;
        let type = b.binding_type ?? 'global';
        if (!TYPES.includes(type)) { this.diag(node, 'warn', `알 수 없는 binding_type '${type}' → global [BND-22]`); type = 'global'; }
        if (type === 'none') return;
        let cond = b.binding_condition ?? 'none';
        if (typeof cond !== 'string') { this.diag(node, 'error', 'JSON UI parse failure - expected a string.'); cond = 'none'; }
        if (!CONDITIONS.includes(cond)) { this.diag(node, 'warn', `알 수 없는 binding_condition '${cond}' → none [BND-35]`); cond = 'none'; }
        if (!this.conditionAllows(node, i, cond)) return;
        if (type === 'view') { views.push({ node, b, i }); return; }
        this.bindDirect(node, b, type);
      });
    });
    // view bindings run until nothing changes (CN-36)
    let rounds = 0;
    for (; rounds < 32; rounds++) {
      let changed = false;
      for (const v of views) if (this.bindView(v.node, v.b)) changed = true;
      if (!changed) break;
    }
    if (rounds === 32) this.diag(this.tree, 'warn', 'view 바인딩이 수렴하지 않는다(바인딩 루프)');
  }

  conditionAllows(node, i, cond) {
    const st = node.bindState;
    const k = `c${i}`;
    const visible = node.prevVisible ?? true;
    switch (cond) {
      case 'once': if (st.get(k) === this.tick || !st.has(k)) { st.set(k, this.tick); return true; } return false;
      case 'visible': case 'always_when_visible': return visible;
      case 'visibility_changed': {
        const last = st.get(k + 'v');
        const ok = last === undefined || last !== visible;
        if (ok) st.set(k + 'v', visible);
        return ok;
      }
      default: return true;
    }
  }

  write(node, name, val) {
    if (val === undefined) return false;
    const prev = node.bag.get(name);
    if (prev && prev.k === val.k && JSON.stringify(prev.v) === JSON.stringify(val.v)) return false;
    node.bag.set(name, val);
    return true;
  }

  bindDirect(node, b, type) {
    if (type === 'collection_details') {
      const cname = b.binding_collection_name;
      const ci = this.collectionItem(node);
      node.details = node.details || new Set();
      if (cname) node.details.add(cname);
      if (ci) {
        this.write(node, '#collection_index', fromJson(ci.index));
        this.write(node, '#collection_name', fromJson(ci.collection));
      }
      return;
    }
    const name = b.binding_name;
    if (typeof name !== 'string' || name === '') { this.diag(node, 'error', 'Must define a binding name!'); return; }
    const target = b.binding_name_override || name;
    if (type === 'collection') {
      const cname = b.binding_collection_name;
      if (!cname) { this.diag(node, 'error', 'Must define a collection name for the binding!'); return; }
      const raw = this.collectionValue(node, cname, name);
      if (raw !== undefined) this.write(node, target, fromJson(raw));
      return;
    }
    // global
    if (name.startsWith('(')) {
      const r = evaluate(name, { prop: (n) => this.globalValue(n), variable: this.varFn(node), opts: this.opts });
      if (r.error) this.diag(node, 'error', `식 바인딩 실패: ${name}`);
      else this.write(node, target, r.value);
      return;
    }
    if (!name.startsWith('#')) return; // a bare word makes no binding (CN-33)
    const v = this.globalValue(name);
    if (v !== undefined) this.write(node, target, v);
    else if (target === '#visible' && this.host.assumeHidden !== false) {
      // the real screen controller answers flags the mock does not know; vanilla mostly hides them
      if (this.write(node, target, fromJson(false))) node.assumedHidden = name;
    }
  }

  globalValue(name) {
    const g = this.host.globals || {};
    return name in g ? fromJson(g[name]) : undefined;
  }

  varFn(node) {
    if (this.opts.measured) return () => undefined; // partial $ inside expressions is not substituted in game (BND-33)
    return scopeVar(node.scope);
  }

  findSource(node, b) {
    const scn = b.source_control_name;
    if (!scn) return node;
    let sib = !!b.resolve_sibling_scope, anc = !!b.resolve_ancestor_scope;
    if (sib && anc) { this.diag(node, 'error', 'resolve_ancestor_scope and resolve_sibling_scope cannot both be set!'); anc = false; }
    if (anc) {
      for (let n = node.parent; n; n = n.parent) if (n.name === scn) return n;
      return null;
    }
    const start = sib ? node.parent : this.tree;
    if (!start) return null;
    const q = [start];
    while (q.length) {
      const n = q.shift();
      if (n.name === scn) return n;
      for (const c of n.children) if (!c.ignored) q.push(c);
    }
    return null;
  }

  bindView(node, b) {
    const src = b.source_property_name, tgt = b.target_property_name;
    if (typeof src !== 'string' || src === '') { this.diag(node, 'error', 'Must define a source property name in the binding!'); return false; }
    if (typeof tgt !== 'string' || tgt === '') { this.diag(node, 'error', 'Must define a target property name in the binding!'); return false; }
    if (!src.includes('#')) { this.diag(node, 'error', 'Must define a source property name in the binding!'); return false; }
    const source = this.findSource(node, b);
    if (!source) {
      if (!node.missingSourceReported) { this.diag(node, 'warn', `source_control_name '${b.source_control_name}'을 찾지 못했다`); node.missingSourceReported = true; }
      return false;
    }
    const named = !!b.source_control_name;
    const prop = (n) => {
      const v = source.bag?.get(n);
      if (v !== undefined) return v;
      return named ? undefined : this.globalValue(n); // unnamed view falls back to the screen controller (CN-36)
    };
    let r;
    if (/^#[^\s()]+$/.test(src)) r = { value: prop(src) ?? fromJson(null), error: null };
    else r = evaluate(src, { prop, variable: this.varFn(node), opts: this.opts });
    if (this.opts.measured && r.vars && r.vars.size && !node.reportedVars) {
      node.reportedVars = true;
      this.diag(node, 'warn', `실측 우선 모드: 식 안의 ${[...r.vars].join(', ')}를 치환하지 않았다 [BND-33]. 디스코드는 preserved title 패턴에서 이 형태가 동작한다고 보고한다 — 게임 확인 필요 (CN 모드로 바꾸면 치환)`);
    }
    if (r.error) {
      const hints = lintExpression(src);
      if (!node.reportedExpr) { this.diag(node, 'error', `Invalid expression: ${src}${hints.length ? ' — ' + hints.join(' / ') : ''}`); node.reportedExpr = true; }
      return false;
    }
    return this.write(node, tgt, r.value);
  }

  // ---------- applying the bag ----------
  applyAll() {
    const overrides = new Map();
    const apply = (node, parentVisible) => {
      const p = node.props;
      const bag = node.bag || new Map();
      const eff = {};
      const pick = (bindName, prop, kind) => {
        const v = bag.get(bindName);
        if (v !== undefined && v.k !== 'null') {
          if (kind === 'bool') {
            if (v.k === 'bool') return v.v;
            node.bindDiags.push({ level: 'warn', msg: `${bindName}에 불리언이 아닌 값(${JSON.stringify(toJson(v))})이 들어와 무시된다 [BND-27]`, where: pathOf(node) });
          } else if (kind === 'num') {
            if (v.k === 'int' || v.k === 'num' || v.k === 'bool') return v.k === 'bool' ? +v.v : v.v;
          } else if (kind === 'str') {
            if (v.k === 'str') return v.v;
            if (v.k === 'int') return String(v.v);
            if (v.k === 'bool') return v.v ? 'true' : 'false';
            return '';
          } else return toJson(v);
        }
        return this.literalProp(node, prop);
      };
      eff.visible = pick('#visible', 'visible', 'bool');
      if (eff.visible === undefined) eff.visible = true;
      if (typeof eff.visible === 'string') eff.visible = !(eff.visible === 'false');
      eff.enabled = pick('#enabled', 'enabled', 'bool') ?? true;
      eff.alpha = pick('#alpha', 'alpha', 'num') ?? 1;
      if (this.opts.measured && bag.get('#alpha')) eff.alpha = eff.alpha >= 1 ? 1 : eff.alpha <= 0 ? 0 : eff.alpha; // C-45 note in inspector
      eff.clip_ratio = pick('#clip_ratio', 'clip_ratio', 'num') ?? 0;
      eff.text = pick('#text', 'text', 'str');
      eff.texture = pick('#texture', 'texture', 'str');
      eff.color = pick('#color', 'color', 'json');
      eff.toggle_state = pick('#toggle_state', null, 'bool');
      for (const k of ['#size_binding_x', '#size_binding_y', '#size_binding_x_absolute', '#size_binding_y_absolute', '#anchored_offset_value_x', '#anchored_offset_value_y']) {
        const v = bag.get(k);
        if (v && (v.k === 'int' || v.k === 'num')) eff[k] = v.v;
        else if (v && v.k !== 'null') node.bindDiags.push({ level: 'error', msg: `${k}에 숫자가 아닌 값 — 게임에서는 크래시 위험 [LAY-14, 5.4절]`, where: pathOf(node) });
      }
      if (!this.opts.measured) {
        const off = bag.get('#offset');
        if (off && off.k === 'json' && Array.isArray(off.v)) eff.offsetBound = off.v;
      }
      if (overrides.has(node.uid)) eff.visible = overrides.get(node.uid);
      node.eff = eff;
      node.effVisible = parentVisible && eff.visible !== false;
      if (p.type === 'button' || p.type === 'toggle') this.stateControls(node, overrides);
      for (const c of node.children) if (!c.ignored) apply(c, node.effVisible);
    };
    apply(this.tree, true);
  }

  // Buttons and toggles own the visibility of their state children (INP-06, INP-10, CN-57).
  stateControls(node, overrides) {
    const p = node.props;
    const find = (name) => {
      const q = [...node.children];
      while (q.length) { const n = q.shift(); if (n.ignored) continue; if (n.name === name) return n; q.push(...n.children); }
      return null;
    };
    const hover = this.hoverUid === node.uid, pressed = this.pressUid === node.uid, locked = node.eff.enabled === false;
    let keys, want;
    if (p.type === 'button') {
      keys = ['default_control', 'hover_control', 'pressed_control', 'locked_control'];
      want = locked ? 'locked_control' : pressed ? 'pressed_control' : hover ? 'hover_control' : 'default_control';
    } else {
      const checked = !!node.eff.toggle_state;
      keys = ['unchecked_control', 'checked_control', 'unchecked_hover_control', 'checked_hover_control', 'unchecked_locked_control', 'checked_locked_control', 'unchecked_locked_hover_control', 'checked_locked_hover_control'];
      want = `${checked ? 'checked' : 'unchecked'}${locked ? '_locked' : ''}${hover ? '_hover' : ''}_control`;
    }
    node.stateName = want;
    for (const k of keys) {
      const name = p[k];
      if (typeof name !== 'string' || !name) {
        if (k === want && p.type === 'toggle') node.bindDiags.push({ level: 'error', msg: `토글 상태 '${k}'가 정의되지 않아 이 상태에서 컨트롤이 사라진다 [INP-10]`, where: pathOf(node) });
        continue;
      }
      const target = find(name);
      if (!target) { if (k === want) node.bindDiags.push({ level: 'warn', msg: `${k} '${name}' 자식이 없다`, where: pathOf(node) }); continue; }
      if (k === want) overrides.set(target.uid, true);
      else if (!overrides.has(target.uid)) overrides.set(target.uid, false);
    }
  }

  literalProp(node, prop) {
    if (!prop) return undefined;
    const v = node.props[prop];
    if (typeof v === 'string' && v.startsWith('#') && !v.startsWith('##')) {
      // "#name" property values read the bag after binding (CN-38)
      const b = node.bag?.get(v);
      if (b === undefined) return prop === 'text' ? '' : undefined;
      return toJson(b);
    }
    if (typeof v === 'string' && v.startsWith('##')) return v.slice(1);
    return v;
  }

  // ---------- input ----------
  press(node) {
    // find the button the click lands on and how the engine would answer (COL-04, INP-04, INP-31)
    let btn = node;
    while (btn && btn.props.type !== 'button' && btn.props.type !== 'toggle') btn = btn.parent;
    if (!btn) return { kind: 'none', msg: '버튼이 아닌 곳' };
    if (btn.props.type === 'toggle') {
      if (!btn.props.toggle_on_button || !btn.props.toggle_off_button) return { kind: 'toggle', msg: 'toggle_on_button/toggle_off_button이 없어 그려지기만 하고 눌리지 않는다 [INP-11]' };
      const cur = btn.bag.get('#toggle_state');
      btn.bag.set('#toggle_state', fromJson(!(cur && truthy(cur))));
      return { kind: 'toggle', msg: `토글 ${btn.name} → ${!(cur && truthy(cur))}` };
    }
    const maps = Array.isArray(btn.props.button_mappings) ? btn.props.button_mappings : [];
    const pressed = maps.filter((m) => isObj(m) && (m.from_button_id === 'button.menu_select' || !m.from_button_id) && (m.mapping_type ?? 'pressed') === 'pressed');
    const to = pressed.map((m) => m.to_button_id).filter(Boolean);
    const known = to.find((t) => /^button\.(form_button_click|submit_custom_form|menu_exit|menu_cancel|close|drop_one|drop_all)$/.test(t));
    if (to.includes('button.form_button_click')) {
      if (!btn.details || !btn.details.has('form_buttons')) {
        return { kind: 'form', msg: `폼이 닫히고 스크립트에는 canceled로 온다 — 버튼 자신에 form_buttons collection_details 바인딩이 없다 [COL-04]` };
      }
      const ci = this.collectionItem(btn);
      return { kind: 'form', msg: `폼이 닫히고 selection = ${ci ? ci.index : 0} 으로 응답한다` };
    }
    if (known) return { kind: 'engine', msg: `엔진 버튼 ${known}` };
    if (to.length) return { kind: 'custom', msg: `엔진이 모르는 버튼 ID ${to.join(', ')} — 폼에 답하지 않고 화면 안 애니메이션만 [INP-20, INP-31]` };
    return { kind: 'none', msg: '눌림 매핑이 없다' };
  }
}
