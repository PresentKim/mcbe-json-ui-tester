// Binding stage: property bags, factories and collections, global/collection/view bindings,
// binding_condition over ticks. Rules: BND-*, COL-*, CN-31..CN-46, NB-04..NB-09.

import { evaluate, fromJson, toJson, truthy, lintExpression, tokenize } from './expr.js';
import { instantiate, Scope, scopeVar, pathOf } from './resolve.js';
import { splitKey, qualify } from './catalog.js';
import { localize } from './lang.js';
import { AnimRuntime } from './anim.js';
import { findByName, scrollToEdge } from './layout.js';
import { t } from '../i18n.js';

const ANIM_EFF = ['alpha', 'clip_ratio', 'color', 'uv', 'uv_size'];

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function expressionProps(expr, variable) {
  const names = new Set();
  for (const t of tokenize(expr)) {
    if (t.t === 'prop') names.add(t.v);
    else if (t.t === 'var') {
      const v = variable(t.v);
      if (v?.k === 'str' && v.v.length > 1 && v.v.startsWith('#')) names.add(v.v);
    }
  }
  return [...names];
}
const CONDITIONS = ['none', 'once', 'always', 'always_when_visible', 'visible', 'visibility_changed'];
const TYPES = ['global', 'collection', 'collection_details', 'view', 'none'];
const COLLECTION_TYPES = ['stack_panel', 'grid', 'collection_panel'];
const NO_INDEX_TYPES = ['label', 'image'];
const FORM_BUTTON_EXPR = /^\(.*#form_button_(contents|length)(?![\w.:])/;
const INPUT_TYPES = new Set(['button', 'dropdown', 'edit_box', 'input_panel', 'screen', 'scrollbar_box', 'scroll_track', 'scroll_view', 'selection_wheel', 'slider', 'slider_box', 'toggle', 'image_cycler', 'label_cycler', 'tooltip_trigger']);
const MAPPING_TYPES = ['global', 'double_pressed', 'pressed', 'focused'];
const mappingType = (m) => (MAPPING_TYPES.includes(m.mapping_type) ? m.mapping_type : 'pressed');
const flag = (v, dflt) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : dflt);
const inside = (r, x, y) => !!r && r.w > 0 && r.h > 0 && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const FOCUS_TYPES = new Set(['button', 'dropdown', 'edit_box', 'grid', 'grid_page_indicator', 'input_panel', 'scroll_track', 'selection_wheel', 'slider', 'toggle', 'tooltip_trigger']);
const DIRS = { 1: 'up', 2: 'down', 3: 'left', 4: 'right' };
const DIR_VECTORS = { 1: [0, -1], 2: [0, 1], 3: [-1, 0], 4: [1, 0] };
const isModal = (n) => INPUT_TYPES.has(n.props.type) && flag(n.props.modal, false);
const isContainer = (n) => flag(n.props.focus_container, false);
const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function within(node, ancestor) {
  for (let a = node; a; a = a.parent) if (a === ancestor) return true;
  return false;
}

function nearestContainer(node) {
  for (let a = node; a; a = a.parent) if (isContainer(a)) return a;
  return null;
}

function cornerInClip(n) {
  const c = n.clip, r = n.rect;
  if (!c || !INPUT_TYPES.has(n.props.type)) return true;
  return [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]
    .some(([x, y]) => x >= c.x && y >= c.y && x <= c.x + c.w && y <= c.y + c.h);
}

function facingPoint(r, [px, py], dx, dy) {
  if (dy) return [clamp(px, r.x, r.x + r.w), dy < 0 ? r.y + r.h : r.y];
  return [dx < 0 ? r.x + r.w : r.x, clamp(py, r.y, r.y + r.h)];
}

export function focusSearch(from, dir, candidates, { wrap = false, clip = false, screen = { w: 0, h: 0 } } = {}) {
  const r = from.rect, [dx, dy] = DIR_VECTORS[dir], [cx, cy] = center(r);
  const half = Math.hypot(r.w / 2, r.h / 2);
  const limit = half > 0 ? Math.min(0.02, (dy ? r.h / 2 : r.w / 2) / half) : 0.02;
  const pass = (p) => {
    let best = null, bestDist = 1e6;
    for (const c of candidates) {
      if (c === from || (clip && !cornerInClip(c))) continue;
      const q = facingPoint(c.rect, p, dx, dy);
      const vx = q[0] - p[0], vy = q[1] - p[1], dist = Math.hypot(vx, vy);
      const cos = dist <= 1.19e-7 ? 1 : (vx * dx + vy * dy) / dist;
      if (cos >= limit && dist < bestDist) { best = c; bestDist = dist; }
    }
    return best;
  };
  const p = [dx ? (dx < 0 ? r.x + 2 : r.x + r.w - 2) : cx, dy ? (dy < 0 ? r.y + 2 : r.y + r.h - 2) : cy];
  const to = pass(p);
  if (to || !wrap) return { to, wrapped: false };
  const edge = dy ? [p[0], dy < 0 ? screen.h : 0] : [dx < 0 ? screen.w : 0, p[1]];
  return { to: pass(edge), wrapped: true };
}

// An array element can carry its own `ignored` (FILE-18): a boolean, or a $ expression already folded.
function elementIgnored(el, node) {
  const g = el && el.ignored;
  if (g === undefined || g === null || g === false) return false;
  if (g === true) return true;
  if (typeof g === 'number') return g !== 0;
  if (typeof g === 'string' && g.startsWith('(')) {
    const r = evaluate(g, { variable: scopeVar(node.scope) });
    return !r.error && truthy(r.value);
  }
  return false;
}

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
    this.anim = new AnimRuntime(cat);
    this.animTime = 0;
    this.hoverUids = new Set();
    this.pressUids = new Set();
    this.inputOrder = [];
    this.focusUid = null;
    this.focusActive = false;
    this.lastFocus = new Map();
  }

  advanceAnimations(dt) {
    const { events, destroyed } = this.anim.step(dt);
    this.animTime += dt;
    for (const e of events) this.anim.dispatch(e);
    return { events, destroyed, layout: this.syncAnimations() || destroyed };
  }

  syncAnimations() {
    const { touched, layout } = this.anim.takeChanges();
    for (const n of touched) if (n.eff) this.applyAnim(n, n.eff);
    return layout;
  }

  applyAnim(node, eff) {
    if (node.anim) for (const k of ANIM_EFF) if (node.anim[k] !== undefined) eff[k] = node.anim[k];
  }

  diag(node, level, msg) {
    const d = { level, msg, where: pathOf(node) };
    (node.bindDiags ||= []).push(d);
  }

  diagOnce(node, level, msg) {
    if (!(node.bindDiags || []).some((d) => d.msg === msg)) this.diag(node, level, msg);
  }

  reportHazards(node, src, r) {
    if (r.hazards?.has('EXP-49')) this.diagOnce(node, 'error', t('A string divided by a number: {src}. The Windows 1.26.65 client froze on this expression (mobile 1.26.63 did not). Convert with (#v - 0) before dividing [EXP-49]', { src }));
    if (r.hazards?.has('EXP-16')) this.diagOnce(node, 'warn', t('A string times a number: {src}. `* 1` does not turn a string into a number. Use (#v - 0) [EXP-16]', { src }));
  }

  run(host) {
    this.host = host;
    this.tick++;
    walk(this.tree, (n) => { n.bindDiags = [...(n.animDiags || [])]; });
    // A tick runs frames until visibility settles: a layout shown in one frame runs its
    // "visible" bindings in the next one, as the game does over its next frames.
    for (let frame = 0; frame < 6; frame++) {
      for (let round = 0; round < 8; round++) {
        this.prepareBags();
        this.initToggles();
        this.bindAll();
        if (!this.expandFactories()) break;
      }
      walk(this.tree, (n) => this.anim.attach(n));
      this.applyAll();
      let changed = false;
      walk(this.tree, (n) => { if (n.prevVisible !== n.effVisible) changed = true; n.prevVisible = n.effVisible; n.bound = true; });
      if (!changed && frame > 0) break;
      if (frame > 0) this.tick++;
    }
    walk(this.tree, (n) => { this.checkCollectionProps(n); this.checkFormButtonLength(n); });
    return this.tree;
  }

  checkFormButtonLength(node) {
    const bs = Array.isArray(node.props.bindings) ? node.props.bindings : [];
    if (bs.some((b) => isObj(b) && [b.binding_name, b.source_property_name].some((s) => typeof s === 'string' && /#form_button_length(?![\w.:])/.test(s)))) {
      this.diagOnce(node, 'warn', t('In game #form_button_length stays at the button count of the largest form shown so far. Send the cell count through another channel such as the body [COL-34]'));
    }
  }

  checkCollectionProps(node) {
    const p = node.props;
    if (typeof p.collection_name === 'string' && p.collection_name !== '' && !COLLECTION_TYPES.includes(p.type)) {
      this.diag(node, 'error', t('Unknown property [collection_name]: {type} has no collection. Use it on stack_panel, grid or collection_panel [COL-01]', { type: p.type }));
    }
    if (p.collection_index === undefined || node.fromFactory) return;
    if (!this.isCollectionParent(node.parent)) this.diag(node, 'warn', t('Unknown property [collection_index]: it is read only on direct children of a stack_panel with collection_name [COL-38, COL-50]'));
    else if (this.opts.measured && NO_INDEX_TYPES.includes(p.type)) this.diag(node, p.type === 'image' ? 'error' : 'warn', t(p.type === 'image' ? 'collection_index on {type} is rejected. Wrap it in a panel and give it to the panel reference [COL-02]' : 'collection_index on {type} is ignored. Wrap it in a panel and give it to the panel reference [COL-02]', { type: p.type }));
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

  radioGroup(node) {
    const isRadio = (n) => n.props.type === 'toggle' && (n.props.radio_toggle_group === true || n.props.radio_toggle_group === 'true');
    if (!isRadio(node)) return null;
    const members = [];
    walk(this.tree, (n) => { if (isRadio(n) && n.props.toggle_name === node.props.toggle_name) members.push(n); });
    return members;
  }

  // Radio toggles group by toggle_name across parents; the one whose index equals
  // toggle_group_default_selected starts checked, -1 checks none (INP-12, INP-35).
  initToggles() {
    walk(this.tree, (node) => {
      if (node.toggleInit || !node.bag || node.props.type !== 'toggle') return;
      node.toggleInit = true;
      const members = this.radioGroup(node);
      if (!members) {
        const d = node.props.toggle_default_state;
        node.bag.set('#toggle_state', fromJson(d === true || d === 'true'));
        return;
      }
      const selected = node.props.toggle_group_default_selected ?? 0;
      node.bag.set('#toggle_state', fromJson(this.toggleIndex(node, members) === selected));
    });
  }

  toggleIndex(node, members) {
    const forced = node.props.toggle_group_forced_index;
    if (Number.isInteger(forced) && forced >= 0) return forced;
    const cname = node.props.toggle_grid_collection_name;
    if (typeof cname === 'string' && cname) {
      for (let n = node; n.parent; n = n.parent) {
        if (this.isCollectionParent(n.parent) && n.parent.props.collection_name === cname) return n.factoryIndex ?? (Number.isInteger(n.props.collection_index) ? n.props.collection_index : -1);
      }
    }
    this.diagOnce(node, 'info', t('The radio toggle got no index from toggle_group_forced_index or a toggle_grid_collection_name item, so the tree order of toggles with the same toggle_name is used. The engine index in this case is unknown'));
    return members.indexOf(node);
  }

  // ---------- collections ----------
  isCollectionParent(node) {
    return node && COLLECTION_TYPES.includes(node.props.type) && typeof node.props.collection_name === 'string' && node.props.collection_name !== '';
  }
  collectionItem(node) {
    // a control is a collection item only as a direct child of a collection parent (COL-44, NB-07)
    for (let n = node; n; n = n.parent) {
      if (n.parent && this.isCollectionParent(n.parent) && !n.props.ignoreCollectionItem) {
        const idx = n.factoryIndex ?? (Number.isInteger(n.props.collection_index) && !(this.opts.measured && NO_INDEX_TYPES.includes(n.props.type)) ? n.props.collection_index : -1);
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
    const blocked = this.opts.measured && this.blockedLength(node);
    if (blocked) {
      this.diagOnce(node, 'warn', blocked);
      roles = [];
    } else if (bound && bound.k !== 'null') {
      if (bound.k === 'json' && Array.isArray(bound.v)) roles = bound.v.map(String);
      else if (bound.k === 'int' || bound.k === 'bool') {
        const n = bound.k === 'bool' ? (bound.v ? 1 : 0) : bound.v;
        roles = Array.from({ length: Math.max(0, n) }, () => null);
      } else roles = [];
    } else if (this.opts.measured && this.declaresLength(node)) {
      // the length binding has not run yet (e.g. binding_condition "visible" on a hidden layout):
      // in game such a layout made no buttons (BND-32); CN-44 would fall back to the collection
      roles = [];
    } else if (hostF) {
      roles = hostF.roles.slice();
    } else if (cname && this.host.collections?.[cname]) {
      roles = this.host.collections[cname].map((it) => it.role ?? null);
    } else roles = [];
    const max = Number.isInteger(info.max) && info.max > 0 ? info.max : Infinity;
    return roles.slice(0, max);
  }

  bindingsTo(node, target) {
    const bs = Array.isArray(node.props.bindings) ? node.props.bindings : [];
    return bs.filter((b) => isObj(b) && !elementIgnored(b, node) && (b.binding_name_override === target || b.binding_name === target || b.target_property_name === target));
  }

  declaresLength(node) {
    return this.bindingsTo(node, '#collection_length').length > 0;
  }

  blockedLength(node) {
    const bs = this.bindingsTo(node, '#collection_length');
    if (bs.some((b) => FORM_BUTTON_EXPR.test((b.binding_type === 'view' ? b.source_property_name : b.binding_name) ?? ''))) {
      return t('In game a length computed by an expression from #form_button_contents or #form_button_length made no buttons. Pass it unchanged with binding_name_override [COL-36]');
    }
    if (bs.length && !bs.some((b) => b.binding_condition === 'always') && this.insidePackFactoryCell(node)) {
      return t('In game a factory inside a factory-made cell made nothing at first unless its length binding was always. Give the length and its source binding binding_condition "always", or use a grid [COL-48]');
    }
    return null;
  }

  insidePackFactoryCell(node) {
    for (let n = node.parent; n; n = n.parent) if (n.madeBy === 'factory' && !n.madeByHost) return true;
    return false;
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
            child.madeBy = 'factory';
            child.madeByHost = !!this.host.factories?.[info.name];
            const cb = this.host.factories?.[info.name]?.bag;
            if (cb) child.creationBag = cb;
            for (const d of env.diags) (node.bindDiags ||= []).push(d);
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
    if (this.opts.measured && this.bindingsTo(node, '#maximum_grid_items').some((b) => FORM_BUTTON_EXPR.test((b.binding_type === 'view' ? b.source_property_name : b.binding_name) ?? ''))) {
      this.diagOnce(node, 'warn', t('In game a grid size computed by an expression from #form_button_contents or #form_button_length was not set right. Pass it unchanged with binding_name_override [COL-36]'));
    }
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
      child.madeBy = 'grid';
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
            this.diag(node, 'error', t("Must define a source property name in the binding! The expression has no '#', so every binding of this control was dropped [BND-05]"));
            node.droppedBindings = true;
          }
        }
        if (node.droppedBindings) return;
      }
      bs.forEach((b, i) => {
        if (!isObj(b) || elementIgnored(b, node)) return;
        let type = b.binding_type ?? 'global';
        if (!TYPES.includes(type)) { this.diag(node, 'warn', t("Unknown binding_type '{type}', read as global [BND-22]", { type })); type = 'global'; }
        if (type === 'none') return;
        let cond = b.binding_condition ?? 'none';
        if (typeof cond !== 'string') { this.diag(node, 'error', 'JSON UI parse failure - expected a string.'); cond = 'none'; }
        if (!CONDITIONS.includes(cond)) { this.diag(node, 'warn', t("Unknown binding_condition '{cond}', read as none [BND-35]", { cond })); cond = 'none'; }
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
    if (rounds === 32) this.diag(this.tree, 'warn', t('View bindings do not settle (binding loop)'));
  }

  conditionAllows(node, i, cond) {
    const st = node.bindState;
    const k = `c${i}`;
    const visible = node.prevVisible ?? this.initialVisible(node);
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

  // Before the first apply, visibility is the literal `visible` of the control and its ancestors:
  // a layout that starts hidden does not run its `visible` bindings (BND-32).
  initialVisible(node) {
    for (let n = node; n; n = n.parent) {
      if (n.prevVisible !== undefined) return n.prevVisible;
      if (n.props.visible === false || n.props.visible === 'false') return false;
    }
    return true;
  }

  write(node, name, val) {
    if (val === undefined) return false;
    (node.boundKeys ||= new Set()).add(name);
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
    const src = this.bindingSource(node, b.binding_name);
    if (!src) { this.diag(node, 'error', 'Must define a binding name!'); return; }
    const name = src.expr ?? src.name;
    const override = typeof b.binding_name_override === 'string' && b.binding_name_override !== '' ? b.binding_name_override : null;
    const target = override || name;
    if (type === 'collection') {
      const cname = b.binding_collection_name;
      if (!cname) { this.diag(node, 'error', 'Must define a collection name for the binding!'); return; }
      const read = (k) => { const v = this.collectionValue(node, cname, k); return v === undefined ? undefined : fromJson(v); };
      if (src.expr) {
        if (this.opts.measured) this.diagOnce(node, 'warn', t("An expression in the binding_name of a collection binding: {name}. In a server form button cell, ('%.12s' * #form_button_text) written like this froze the Windows 1.26.65 client (which expression was not isolated). Take the value with the collection binding and compute it in a later view binding [BND-37]", { name }));
        this.writeExpression(node, src, override, read);
        return;
      }
      const raw = read(name);
      if (raw !== undefined) this.write(node, target, raw);
      return;
    }
    if (src.expr) {
      this.writeExpression(node, src, override, (n) => this.globalValue(n));
      return;
    }
    const v = this.globalValue(name);
    if (v !== undefined) this.write(node, target, v);
    else if (target === '#visible' && this.host.assumeHidden !== false) {
      // the real screen controller answers flags the mock does not know; vanilla mostly hides them
      if (this.write(node, target, fromJson(false))) node.assumedHidden = name;
    }
  }

  bindingSource(node, raw) {
    const variable = this.varFn(node);
    let name = raw;
    for (let depth = 0; depth < 8; depth++) {
      if (typeof name !== 'string' || name === '') return null;
      if (name.startsWith('$')) {
        const v = variable(name);
        if (v?.k !== 'str') return null;
        name = v.v;
        continue;
      }
      if (name.startsWith('#')) return { name };
      if (!name.startsWith('(')) return null;
      const names = expressionProps(name, variable);
      if (names.length) return { expr: name, names };
      const r = evaluate(name, { variable, opts: this.opts });
      if (r.value.k !== 'str') return null;
      name = r.value.v;
    }
    return null;
  }

  writeExpression(node, src, override, read) {
    const r = evaluate(src.expr, { prop: read, variable: this.varFn(node), opts: this.opts });
    this.reportHazards(node, src.expr, r);
    if (r.error) { this.diag(node, 'error', t('Expression binding failed: {expr}', { expr: src.expr })); return; }
    if (override) { this.write(node, override, r.value); return; }
    for (const n of src.names) {
      const v = read(n);
      if (v !== undefined) this.write(node, n, v);
    }
  }

  globalValue(name) {
    const g = this.host.globals || {};
    if (!(name in g)) return undefined;
    if (this.opts.measured && name === '#form_button_length' && typeof g[name] === 'number') {
      this.largestFormButtonLength = Math.max(this.largestFormButtonLength ?? g[name], g[name]);
      return fromJson(this.largestFormButtonLength);
    }
    return fromJson(g[name]);
  }

  varFn(node) {
    const v = scopeVar(node.scope);
    if (!this.opts.measured) return v;
    return (n) => {
      if (n !== '$container_title') return v(n);
      if (!node.reportedTitleVar) { node.reportedTitleVar = true; this.diag(node, 'warn', t('$container_title does not work inside binding expressions [HOST-19]. Compare it in ignored or visible property expressions or through a copied variable [HOST-48]')); }
      return undefined;
    };
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
      if (!node.missingSourceReported) { this.diag(node, 'warn', t("source_control_name '{name}' not found", { name: b.source_control_name })); node.missingSourceReported = true; }
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
    else {
      r = evaluate(src, { prop, variable: this.varFn(node), opts: this.opts });
      this.reportHazards(node, src, r);
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
            (node.bindDiags ||= []).push({ level: 'warn', msg: t('{name} got a value that is not a boolean ({value}), so it is ignored [BND-27]', { name: bindName, value: JSON.stringify(toJson(v)) }), where: pathOf(node) });
          } else if (kind === 'num') {
            if (v.k === 'int' || v.k === 'num' || v.k === 'bool') return v.k === 'bool' ? +v.v : v.v;
          } else if (kind === 'text') {
            return v.k === 'str' ? v.v : ''; // a label draws only text values (entity-inventory-ui 2.4, measured)
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
      const onlyBound = (k) => !this.opts.measured || node.boundKeys?.has(k);
      eff.alpha = (onlyBound('#alpha') ? pick('#alpha', 'alpha', 'num') : this.literalProp(node, 'alpha')) ?? 1;
      if (this.opts.measured && node.boundKeys?.has('#alpha')) eff.alpha = eff.alpha >= 1 ? 1 : eff.alpha <= 0 ? 0 : eff.alpha; // C-45 note in inspector
      eff.clip_ratio = pick('#clip_ratio', 'clip_ratio', 'num') ?? 1;
      eff.text = pick('#text', 'text', 'text');
      if (p.type === 'label' && p.localize !== false && this.opts.lang) {
        eff.sourceText = eff.text;
        eff.text = localize(eff.text, this.opts.lang);
      }
      eff.texture = pick('#texture', 'texture', 'str');
      eff.color = pick('#color', 'color', 'json');
      eff.toggle_state = pick('#toggle_state', null, 'bool');
      this.applyAnim(node, eff);
      for (const k of ['#size_binding_x', '#size_binding_y', '#size_binding_x_absolute', '#size_binding_y_absolute', '#anchored_offset_value_x', '#anchored_offset_value_y']) {
        const v = onlyBound(k) ? bag.get(k) : undefined;
        if (v && (v.k === 'int' || v.k === 'num')) eff[k] = v.v;
        else if (v && v.k !== 'null') (node.bindDiags ||= []).push({ level: 'error', msg: t('{k} got a value that is not a number. It must be a number; a community report says anything else crashes (not measured)', { k }), where: pathOf(node) });
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
    const hover = this.hoverUids.has(node.uid), pressed = this.pressUids.has(node.uid), locked = node.eff.enabled === false;
    let keys, want;
    if (p.type === 'button') {
      keys = ['default_control', 'hover_control', 'pressed_control', 'locked_control'];
      if (locked) want = typeof p.locked_control === 'string' && p.locked_control && find(p.locked_control) ? 'locked_control' : 'default_control';
      else want = pressed ? 'pressed_control' : hover ? 'hover_control' : 'default_control';
    } else {
      const checked = !!node.eff.toggle_state;
      keys = ['unchecked_control', 'checked_control', 'unchecked_hover_control', 'checked_hover_control', 'unchecked_locked_control', 'checked_locked_control', 'unchecked_locked_hover_control', 'checked_locked_hover_control'];
      want = `${checked ? 'checked' : 'unchecked'}${locked ? '_locked' : ''}${hover ? '_hover' : ''}_control`;
    }
    node.stateName = want;
    for (const k of keys) {
      const name = p[k];
      if (typeof name !== 'string' || !name) {
        if (k === want && p.type === 'toggle') (node.bindDiags ||= []).push({ level: 'error', msg: t("Toggle state '{k}' is not defined, so the control disappears in this state [INP-10]", { k }), where: pathOf(node) });
        continue;
      }
      const target = find(name);
      if (!target) { if (k === want) (node.bindDiags ||= []).push({ level: 'warn', msg: t("{k} '{name}' has no matching child", { k, name }), where: pathOf(node) }); continue; }
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
      if (prop === 'text') return b !== undefined && b.k === 'str' ? b.v : '';
      if (b === undefined) return undefined;
      return toJson(b);
    }
    if (typeof v === 'string' && v.startsWith('##')) return v.slice(1);
    return v;
  }

  // ---------- input ----------
  mappingsOf(node) {
    const list = (Array.isArray(node.props.button_mappings) ? node.props.button_mappings : []).filter((m) => isObj(m) && !elementIgnored(m, node));
    const out = { any: null, general: [], toOnly: [] };
    for (const m of list) {
      const from = typeof m.from_button_id === 'string' ? m.from_button_id : '';
      const to = typeof m.to_button_id === 'string' ? m.to_button_id : '';
      if (from === 'any') out.any = m;
      else if (!to) continue;
      else if (from) out.general.push(m);
      else if (mappingType(m) === 'pressed') out.toOnly.push(m);
    }
    return out;
  }

  activeModal() {
    let best = null;
    walk(this.tree, (n) => { if (isModal(n) && n.effVisible && (!best || (n.layerAbs ?? 0) > (best.layerAbs ?? 0))) best = n; });
    return best || this.tree;
  }

  modalFilter() {
    const modal = this.activeModal();
    const inline = modal !== this.tree && flag(modal.props.inline_modal, false);
    return (n) => {
      if (inline && n.props.type === 'scroll_view') return true;
      let m = n;
      while (m && m !== this.tree && !isModal(m)) m = m.parent;
      return (m || this.tree) === modal;
    };
  }

  focusValue(node, key, dflt) {
    const v = node.bag?.get(`#${key}`);
    if (v !== undefined && v.k !== 'null') return toJson(v);
    return this.literalProp(node, key) ?? dflt;
  }

  focusPrecedence(node) {
    return Math.trunc(Number(this.focusValue(node, 'default_focus_precedence', 0))) || 0;
  }

  focusList() {
    const allowed = this.modalFilter();
    const out = [];
    walk(this.tree, (n) => {
      if (FOCUS_TYPES.has(n.props.type) && n.rect && n.effVisible && n.eff?.enabled !== false && flag(this.focusValue(n, 'focus_enabled', false), false) && allowed(n)) out.push(n);
    });
    return out;
  }

  initialFocus(list = this.focusList()) {
    const best = Math.max(0, ...list.map((n) => this.focusPrecedence(n)));
    const width = this.tree.rect?.w ?? 0;
    const key = (n) => n.rect.y * width + n.rect.x;
    let pick = null;
    for (const n of list) if (this.focusPrecedence(n) === best && (!pick || key(n) < key(pick))) pick = n;
    return pick;
  }

  setFocus(node) {
    this.focusUid = node ? node.uid : null;
    if (node) for (let a = node; a; a = a.parent) if (isContainer(a)) this.lastFocus.set(a.uid, node.uid);
  }

  focusNode(list = this.focusList()) {
    const f = list.find((n) => n.uid === this.focusUid);
    if (f || this.focusUid === null) return f || null;
    const modal = this.activeModal();
    const last = isContainer(modal) && flag(modal.props.use_last_focus, false) ? list.find((n) => n.uid === this.lastFocus.get(modal.uid)) : null;
    const next = last || (this.focusActive ? this.initialFocus(list) : null);
    this.setFocus(next);
    return next;
  }

  focusAt(x, y) {
    const px = Math.round(x), py = Math.round(y);
    const hit = this.focusList().find((n) => {
      const r = n.rect;
      if (px < r.x - 1 || py < r.y - 1 || px > r.x + r.w + 1 || py > r.y + r.h + 1) return false;
      for (let a = n.parent; a; a = a.parent) if (flag(a.props.clips_children, false) && a.rect && !inside(a.rect, px, py)) return false;
      return true;
    });
    if (hit) this.setFocus(hit);
    return hit || null;
  }

  sweep(from, dir, list) {
    const key = `focus_change_${DIRS[dir]}`;
    const change = String(this.focusValue(from, key, '') ?? '');
    if (change === 'FOCUS_OVERRIDE_STOP') return { to: null, rule: 'FOCUS_OVERRIDE_STOP' };
    if (change) {
      const hit = list.find((n) => String(this.focusValue(n, 'focus_identifier', '')) === change);
      if (hit) return { to: hit, rule: `${key} ${change}` };
    }
    for (let a = from.parent; a; a = a.parent) {
      if (a.props.type !== 'scroll_view') continue;
      const content = findByName(a, a.props.scroll_content);
      if (!content) continue;
      const { to } = focusSearch(from, dir, list.filter((n) => n !== content && within(n, content)));
      if (to) return { to, rule: t('scroll view {name}', { name: a.name }) };
    }
    const screen = { w: this.tree.rect?.w ?? 0, h: this.tree.rect?.h ?? 0 };
    const { to, wrapped } = focusSearch(from, dir, list, { wrap: flag(this.focusValue(from, 'focus_wrap_enabled', true), true), clip: true, screen });
    if (!to) return { to: null, rule: null };
    return { to, rule: wrapped ? t('wrap from the opposite edge') : t('geometric search') };
  }

  containerRule(from, to, dir, list) {
    const oldC = nearestContainer(from), newC = nearestContainer(to);
    const v = oldC?.bag?.get(`#focus_navigation_mode_${DIRS[dir]}`);
    const mode = v?.k === 'str' ? v.v : '';
    if (oldC !== newC && mode === 'stop') return { to: null, rule: `${oldC.name} focus_navigation_mode stop` };
    if (mode === 'contained' && !within(to, oldC)) return { to: null, rule: `${oldC.name} focus_navigation_mode contained` };
    if (newC && !(oldC && within(oldC, newC)) && flag(newC.props.use_last_focus, false)) {
      const last = list.find((n) => n.uid === this.lastFocus.get(newC.uid));
      if (last) return { to: last, rule: `${newC.name} use_last_focus` };
    }
    return { to, rule: null };
  }

  moveFocus(dir) {
    this.focusActive = true;
    const list = this.focusList();
    const from = this.focusNode(list);
    if (!from) {
      const to = this.initialFocus(list);
      this.setFocus(to);
      if (to) return { node: to, kind: 'focus', moved: true, msg: t('Focus starts on {name} (default_focus_precedence {p}, then reading order)', { name: to.name, p: this.focusPrecedence(to) }) };
      const msg = list.length
        ? t('No control takes focus: every candidate has a negative default_focus_precedence and the engine starts the maximum at 0')
        : t('No control can take focus: none is visible, enabled, focus_enabled and inside the active modal');
      return { node: this.tree, kind: 'focus', moved: false, msg };
    }
    let { to, rule } = this.sweep(from, dir, list);
    if (to && to !== from) {
      const c = this.containerRule(from, to, dir, list);
      to = c.to;
      rule = c.rule ? `${rule}, ${c.rule}` : rule;
    }
    if (!to || to === from) {
      if (dir === 1 || dir === 2) for (const n of this.inputOrder) if (this.hoverUids.has(n.uid)) this.scrollHovered(n, dir === 2);
      return { node: from, kind: 'focus', moved: false, msg: t('Focus stays on {name} ({rule})', { name: from.name, rule: rule || t('no candidate') }) };
    }
    this.setFocus(to);
    return { node: to, kind: 'focus', moved: true, msg: t('Focus {from} -> {to} ({rule})', { from: from.name, to: to.name, rule }) };
  }

  scrollHovered(node, end) {
    for (let a = node; a; a = a.parent) if (a.props.type === 'scroll_view') return scrollToEdge(a, end);
    return false;
  }

  hoverAt(nodes, x, y) {
    if (this.focusActive) {
      const f = this.focusNode();
      if (f) [x, y] = center(f.rect);
    }
    const order = new Map();
    walk(this.tree, (n) => order.set(n, order.size));
    const allowed = this.modalFilter();
    this.inputOrder = nodes.filter((n) => INPUT_TYPES.has(n.props.type) && n.effVisible && order.has(n) && allowed(n))
      .sort((a, b) => b.layerAbs - a.layerAbs || order.get(a) - order.get(b));
    const next = new Set();
    let taken = false;
    for (const n of this.inputOrder) {
      if (taken || flag(n.props.hover_enabled, true) === false) continue;
      if (n.eff?.enabled === false || !inside(n.rect, x, y) || (n.clip && !inside(n.clip, x, y))) continue;
      next.add(n.uid);
      taken = flag(n.props.consume_hover_events, true);
    }
    const notes = [];
    const byUid = new Map([...order.keys()].map((n) => [n.uid, n]));
    for (const uid of new Set([...this.hoverUids, ...next])) {
      const entered = next.has(uid);
      if (entered === this.hoverUids.has(uid)) continue;
      const n = byUid.get(uid);
      if (!entered) this.pressUids.delete(uid);
      if (n) notes.push(...this.hoverNotes(n, entered));
    }
    const changed = next.size !== this.hoverUids.size || [...next].some((u) => !this.hoverUids.has(u));
    this.hoverUids = next;
    return { changed, notes };
  }

  hoverNotes(node, entered) {
    return this.mappingsOf(node).toOnly.map((m) => {
      const r = { node, kind: 'hover', to: m.to_button_id, msg: t(entered ? 'Hover enter notice {to}. A mapping without from_button_id is not a click' : 'Hover leave notice {to}. A mapping without from_button_id is not a click', { to: m.to_button_id }) };
      if (entered) this.dispatchAnim(r);
      return r;
    });
  }

  pointerButton(down, { x, y, now = Date.now(), id = 'button.menu_select' } = {}) {
    const out = [];
    const focus = this.inputOrder.find((n) => n.uid === this.focusUid && n.eff?.enabled !== false);
    for (const n of focus ? [focus, ...this.inputOrder.filter((o) => o !== focus)] : this.inputOrder) {
      const r = this.inputEvent(n, id, down, { x, y, now });
      if (!r) continue;
      out.push(r);
      if (r.consumed) break;
    }
    return out;
  }

  inputEvent(node, id, down, ctx) {
    const maps = this.mappingsOf(node);
    const st = (node.inputState ||= { prev: new Map(), lastPress: new Map() });
    const hovered = this.hoverUids.has(node.uid);
    const touch = node.scope?.lookup('$touch') === true;
    const candidates = maps.general.map((m, key) => ({ m, key })).filter((c) => c.m.from_button_id === id);
    if (maps.any) candidates.unshift({ m: { from_button_id: id, to_button_id: id, mapping_type: 'pressed', scope: maps.any.scope }, key: 'any' });
    let second = false;
    if (down && candidates.some((c) => mappingType(c.m) === 'double_pressed')) {
      const last = st.lastPress.get(id);
      second = !!last && ctx.now - last.now <= 500 && Math.hypot(ctx.x - last.x, ctx.y - last.y) <= 10;
      st.lastPress.set(id, { now: ctx.now, x: ctx.x, y: ctx.y });
    }
    for (const { m, key } of candidates) {
      if (m.input_mode_condition === 'gamepad') continue;
      const type = mappingType(m);
      if ((type === 'double_pressed') !== second) continue;
      const prev = st.prev.get(key) === true;
      const ok = type === 'global' || (type === 'focused' ? hovered : this.positionOk(node, m, down, hovered, prev, ctx));
      if (!ok) continue;
      st.prev.set(key, down);
      return this.deliver(node, m, down, touch ? !down && prev : down && !prev);
    }
    return null;
  }

  positionOk(node, m, down, hovered, prev, ctx) {
    if (flag(m.ignore_input_scope, false) && node.eff?.enabled !== false) return true;
    if (hovered) return true;
    if (flag(node.props.always_listen_to_input, false) && inside(node.rect, ctx.x, ctx.y)) return true;
    return !down && prev && flag(m.button_up_right_of_first_refusal, false);
  }

  deliver(node, m, down, edge) {
    const type = node.props.type, locked = node.eff?.enabled === false;
    const isButton = type === 'button' || type === 'edit_box';
    if (isButton && !locked) {
      if (down) this.pressUids.add(node.uid);
      else this.pressUids.delete(node.uid);
    }
    const consumed = (isButton ? locked || flag(node.props.consume_event, true) : true) && flag(m.consume_event, true);
    const r = { node, to: m.to_button_id, down, edge, consumed, kind: 'event', msg: t('Button event {to}', { to: m.to_button_id }) };
    if (!edge) return r;
    if (type === 'toggle') Object.assign(r, this.toggleClick(node));
    else if (type === 'button') Object.assign(r, this.pressAnswer(node, [m.to_button_id]));
    this.dispatchAnim(r);
    return r;
  }

  dispatchAnim(r) {
    const reacted = this.anim.dispatch(r.to);
    if (!reacted) return;
    r.anim = { reacted, layout: this.syncAnimations() };
    r.msg += t(' ({count} animations reacted to the button event)', { count: reacted });
  }

  toggleClick(btn) {
    const p = btn.props;
    if (!btn.effVisible || btn.eff?.enabled === false) return { kind: 'toggle', msg: t('A locked toggle does not change') };
    const noOnOff = !p.toggle_on_button || !p.toggle_off_button;
    const note = noOnOff ? t('. It changes with button_mappings alone, without toggle_on_button/toggle_off_button (measured on Windows 1.26.65, same as the client code). Those two keys are used only by enable_directional_toggling [INP-11]') : '';
    const group = this.radioGroup(btn);
    if (group) {
      for (const m of group) m.bag?.set('#toggle_state', fromJson(m === btn));
      return { kind: 'toggle', msg: t('Radio {group}: only {name} turns on ({count} toggles) [INP-35]', { group: p.toggle_name, name: btn.name, count: group.length }) + note };
    }
    const cur = btn.bag.get('#toggle_state');
    btn.bag.set('#toggle_state', fromJson(!(cur && truthy(cur))));
    return { kind: 'toggle', msg: t('Toggle {name}: {state}', { name: btn.name, state: !(cur && truthy(cur)) }) + note };
  }

  // A whole click (press and release) on the nearest button or toggle, as if the pointer were over it.
  press(node, now = Date.now()) {
    let btn = node;
    while (btn && btn.props.type !== 'button' && btn.props.type !== 'toggle') btn = btn.parent;
    if (!btn) return { kind: 'none', msg: t('Not a button') };
    const hover = this.hoverUids;
    this.hoverUids = new Set([...hover, btn.uid]);
    const rs = [true, false].map((down) => this.inputEvent(btn, 'button.menu_select', down, { now }));
    this.hoverUids = hover;
    const r = rs.find((x) => x?.edge);
    if (r) return r;
    if (btn.props.type === 'toggle') return { kind: 'toggle', msg: t('No button_mappings take button.menu_select, so it is not pressed [INP-11]') };
    return this.pressAnswer(btn, []);
  }

  pressAnswer(btn, to) {
    const known = to.find((t) => /^button\.(form_button_click|submit_custom_form|menu_exit|menu_cancel|close|drop_one|drop_all)$/.test(t));
    if (to.includes('button.form_button_click')) {
      if (!btn.details || !btn.details.has('form_buttons')) {
        return { kind: 'form', msg: t('The form closes and the script gets canceled: the button has no form_buttons collection_details binding of its own [COL-04]') };
      }
      const ci = this.collectionItem(btn);
      return { kind: 'form', msg: t('The form closes and answers selection = {index}', { index: ci ? ci.index : 0 }) };
    }
    if (known) return { kind: 'engine', msg: t('Engine button {id}', { id: known }) };
    if (to.includes('button.container_auto_place')) return { kind: 'engine', msg: t('Quick move: the slot item moves at once') };
    if (to.includes('button.container_take_all_place_all')) {
      if (btn.scope?.lookup('$touch') === true) return { kind: 'engine', msg: t('Touch slot press: the first tap only selects the slot, and the item swaps with the next slot tapped. Nothing goes to the cursor (entity-inventory-ui 2.5, measured)') };
      return { kind: 'engine', msg: t('Engine button {id}', { id: 'button.container_take_all_place_all' }) };
    }
    if (to.length) return { kind: 'custom', msg: t('Button IDs unknown to the engine: {ids}. The form gets no answer; only animations on the screen react [INP-20, INP-31]', { ids: to.join(', ') }) };
    return { kind: 'none', msg: t('No pressed mapping') };
  }
}
