import { flatten, substitute, pathOf } from './resolve.js';
import { qualify } from './catalog.js';
import { parseSize } from './size.js';
import { t } from '../i18n.js';

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const PI = Math.PI;
const BACK = 1.70158, BACK2 = 2.5949094;

function bounce(x) {
  if (x < 1 / 2.75) return 7.5625 * x * x;
  if (x < 2 / 2.75) { const u = x - 1.5 / 2.75; return 7.5625 * u * u + 0.75; }
  if (x < 2.5 / 2.75) { const u = x - 2.25 / 2.75; return 7.5625 * u * u + 0.9375; }
  const u = x - 2.625 / 2.75;
  return 7.5625 * u * u + 0.984375;
}

const elasticSin = (x) => Math.sin(((x - 0.075) * 2 * PI) / 0.3);

export const EASINGS = {
  linear: (f, to, t) => f + (to - f) * t,
  spring: (f, to, t) => {
    const v = Math.min(1, Math.max(0, t));
    const y = (Math.sin(PI * v * (0.2 + 2.5 * v ** 3)) * (1 - v) ** 2.2 + v) * (1 + 1.2 * (1 - v));
    return f + (to - f) * y;
  },
  in_quad: (f, to, t) => f + (to - f) * t * t,
  out_quad: (f, to, t) => f - (to - f) * t * (t - 2),
  in_out_quad: (f, to, t) => { const c = to - f, u = 2 * t; return u < 1 ? f + (c / 2) * u * u : f - (c / 2) * ((u - 1) * (u - 3) - 1); },
  in_cubic: (f, to, t) => f + (to - f) * t ** 3,
  out_cubic: (f, to, t) => f + (to - f) * ((t - 1) ** 3 + 1),
  in_out_cubic: (f, to, t) => { const c = to - f, u = 2 * t; return f + (u < 1 ? (c / 2) * u ** 3 : (c / 2) * ((u - 2) ** 3 + 2)); },
  in_quart: (f, to, t) => f + (to - f) * t ** 4,
  out_quart: (f, to, t) => f - (to - f) * ((t - 1) ** 4 - 1),
  in_out_quart: (f, to, t) => { const c = to - f, u = 2 * t; return f + (u < 1 ? (c / 2) * u ** 4 : (-c / 2) * ((u - 2) ** 4 - 2)); },
  in_quint: (f, to, t) => f + (to - f) * t ** 5,
  out_quint: (f, to, t) => f + (to - f) * ((t - 1) ** 5 + 1),
  in_out_quint: (f, to, t) => { const c = to - f, u = 2 * t; return f + (u < 1 ? (c / 2) * u ** 5 : (c / 2) * ((u - 2) ** 5 + 2)); },
  in_sine: (f, to, t) => f + (to - f) - (to - f) * Math.cos((t * PI) / 2),
  out_sine: (f, to, t) => f + (to - f) * Math.sin((t * PI) / 2),
  in_out_sine: (f, to, t) => f - ((to - f) / 2) * (Math.cos(PI * t) - 1),
  in_expo: (f, to, t) => f + (to - f) * 2 ** (10 * (t - 1)),
  out_expo: (f, to, t) => f + (to - f) * (1 - 2 ** (-10 * t)),
  in_out_expo: (f, to, t) => { const c = to - f, u = 2 * t; return f + (u < 1 ? (c / 2) * 2 ** (10 * (u - 1)) : (c / 2) * (2 - 2 ** (-10 * (u - 1)))); },
  in_circ: (f, to, t) => f - (to - f) * (Math.sqrt(1 - t * t) - 1),
  out_circ: (f, to, t) => f + (to - f) * Math.sqrt(1 - (t - 1) ** 2),
  in_out_circ: (f, to, t) => { const c = to - f, u = 2 * t; return f + (u < 1 ? (-c / 2) * (Math.sqrt(1 - u * u) - 1) : (c / 2) * (Math.sqrt(1 - (u - 2) ** 2) + 1)); },
  in_bounce: (f, to, t) => f + (to - f) - (to - f) * bounce(1 - t),
  out_bounce: (f, to, t) => f + (to - f) * bounce(t),
  in_out_bounce: (f, to, t) => { const c = to - f; return t < 0.5 ? f + (c - c * bounce(1 - 2 * t)) / 2 : f + c / 2 + (c * bounce(2 * t - 1)) / 2; },
  in_back: (f, to, t) => f + (to - f) * t * t * ((BACK + 1) * t - BACK),
  out_back: (f, to, t) => { const u = t - 1; return f + (to - f) * (u * u * ((BACK + 1) * u + BACK) + 1); },
  in_out_back: (f, to, t) => {
    const c = to - f, u = 2 * t;
    if (u < 1) return f + (c / 2) * u * u * ((BACK2 + 1) * u - BACK2);
    const w = u - 2;
    return f + (c / 2) * (w * w * ((BACK2 + 1) * w + BACK2) + 2);
  },
  in_elastic: (f, to, t) => { if (t === 0) return f; if (t === 1) return to; const u = t - 1; return f - (to - f) * 2 ** (10 * u) * elasticSin(u); },
  out_elastic: (f, to, t) => { if (t === 0) return f; if (t === 1) return to; return f + (to - f) + (to - f) * 2 ** (-10 * t) * elasticSin(t); },
  in_out_elastic: (f, to, t) => {
    if (t === 0) return f;
    const u = 2 * t;
    if (u === 2) return to;
    const c = to - f, w = u - 1, s = elasticSin(w);
    return u < 1 ? f - (c / 2) * 2 ** (10 * w) * s : f + c + (c / 2) * 2 ** (-10 * w) * s;
  },
};

export const easing = (name) => EASINGS[typeof name === 'string' ? name.toLowerCase() : ''] ?? EASINGS.linear;

const TYPES = ['alpha', 'clip', 'color', 'flip_book', 'aseprite_flip_book', 'offset', 'size', 'uv', 'wait'];
const FLIP_TYPES = ['flip_book', 'aseprite_flip_book'];
const IMAGE_TYPES = ['clip', 'color', 'uv', 'flip_book', 'aseprite_flip_book'];
export const ANIM_PROPS = ['alpha', 'clip_ratio', 'color', 'uv', 'offset', 'size'];

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v, d) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : d);
const str = (v) => (typeof v === 'string' ? v : '');
const vec2 = (v, d) => (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : d);
const rgba = (v) => (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => typeof x === 'number') ? [v[0], v[1], v[2], num(v[3], 1)] : [1, 1, 1, 1]);
export const isAnimRef = (v) => (typeof v === 'string' && v.startsWith('@')) || (isObj(v) && 'anim_type' in v);

function axisTerms(x) {
  const s = parseSize(x);
  const m = new Map();
  if (s.kind === 'terms') for (const t of s.terms) m.set(t.unit, (m.get(t.unit) ?? 0) + t.v);
  return m;
}

function alignTerms(from, to) {
  const pair = (v) => (Array.isArray(v) ? [v[0], v[1]] : [undefined, undefined]);
  const f = pair(from).map(axisTerms), t = pair(to).map(axisTerms);
  return [0, 1].map((ax) => [...new Set([...f[ax].keys(), ...t[ax].keys()])].map((unit) => ({ unit, from: f[ax].get(unit) ?? 0, to: t[ax].get(unit) ?? 0 })));
}

const termsAt = (axes, pick) => axes.map((terms) => ({ kind: 'terms', terms: terms.map((x) => ({ v: pick(x), unit: x.unit })) }));

function parseDef(raw) {
  const type = raw.anim_type;
  if (!TYPES.includes(type)) return null;
  const event = (v) => (typeof v === 'string' && v !== '' ? v : null);
  const def = {
    type,
    raw,
    duration: num(raw.duration, 1),
    next: str(raw.next),
    destroyAtEnd: str(raw.destroy_at_end),
    waitRendered: bool(raw.wait_until_rendered_to_play, false),
    endEvent: event(raw.end_event),
    playEvent: event(raw.play_event),
    resetEvent: event(raw.reset_event),
    ease: easing(raw.easing),
    resettable: bool(raw.resettable, true),
  };
  if (type === 'alpha' || type === 'clip') { def.from = num(raw.from, 1); def.to = num(raw.to, 1); }
  if (type === 'alpha') def.scaleFromStart = bool(raw.scale_from_starting_alpha, false);
  if (type === 'color') { def.from = rgba(raw.from); def.to = rgba(raw.to); }
  if (type === 'uv') { def.from = vec2(raw.from, [0, 0]); def.to = vec2(raw.to, [0, 0]); }
  if (type === 'offset' || type === 'size') def.terms = alignTerms(raw.from, raw.to);
  if (type === 'flip_book') {
    def.fps = num(raw.fps, 0);
    def.frameCount = Math.trunc(num(raw.frame_count, 1));
    def.reversible = bool(raw.reversible, false);
    def.vertical = raw.orientation === 'vertical';
    def.looping = bool(raw.looping, true);
  }
  return def;
}

function initialValue(key, raw) {
  const v = FLIP_TYPES.includes(raw.anim_type) ? raw.initial_uv : raw.from;
  if (key === 'alpha' || key === 'clip_ratio') return num(v, 1);
  if (key === 'color') return rgba(v);
  if (key === 'uv') return vec2(v, [0, 0]);
  return Array.isArray(v) ? [parseSize(v[0]), parseSize(v[1])] : undefined;
}

const attached = (node) => {
  for (let n = node; n.parent; n = n.parent) if (!n.parent.children.includes(n)) return false;
  return true;
};

export class AnimRuntime {
  constructor(cat) {
    this.cat = cat;
    this.comps = new Map();
    this.touched = new Set();
    this.layoutDirty = false;
    this.textureSize = () => null;
  }

  attach(node) {
    if (node.ignored || this.comps.has(node.uid)) return;
    const p = node.props;
    const refs = ANIM_PROPS.filter((k) => isAnimRef(p[k]));
    const list = Array.isArray(p.anims) ? p.anims : null;
    if (!refs.length && !list) return;
    const comp = { node, active: [], originals: [], out: [], resetName: typeof p.animation_reset_name === 'string' && p.animation_reset_name !== '' ? p.animation_reset_name : null };
    this.comps.set(node.uid, comp);
    node.anim ||= {};
    for (const k of refs) {
      const inst = this.build(comp, p[k]);
      const init = initialValue(k, inst?.def.raw ?? {});
      if (init !== undefined) this.write(node, k, init);
      if (inst) this.add(comp, inst);
    }
    for (const el of list || []) {
      if (typeof el === 'string' && !el.startsWith('@')) this.diag(node, t("'{el}' in anims does not start with @. The engine logs a warning and looks it up by name", { el }));
      if (typeof el !== 'string' && !isObj(el)) continue;
      const inst = this.build(comp, el);
      if (inst) this.add(comp, inst);
    }
  }

  diag(node, msg) {
    const d = { level: 'warn', msg, where: pathOf(node) };
    (node.animDiags ||= []).push(d);
    (node.bindDiags ||= []).push(d);
  }

  build(comp, ref) {
    const node = comp.node;
    const names = new Map();
    const ctx = { unresolved: new Set(), diag: () => {} };
    const make = (r, ns) => {
      let raw, key = null, defNs = ns;
      if (typeof r === 'string') {
        key = qualify(r.replace(/^@/, ''), ns);
        if (names.has(key)) return names.get(key);
        const flat = flatten(this.cat, key, () => {}, node.scope);
        if (!flat) { this.diag(node, t("Animation '{r}' not found", { r })); return null; }
        raw = substitute(flat.props, node.scope, ctx);
        defNs = flat.ns || ns;
      } else raw = substitute(r, node.scope, ctx);
      const def = parseDef(raw);
      if (!def) { this.diag(node, t("anim_type '{type}' is unknown to the engine, so no animation is made", { type: raw.anim_type ?? '' })); return null; }
      const inst = this.instance(def, node);
      if (key) names.set(key, inst);
      if (def.next) {
        if (!def.next.startsWith('@')) this.diag(node, t("next '{next}' does not start with @", { next: def.next }));
        inst.next = make(def.next, defNs);
      }
      return inst;
    };
    return make(ref, node.ns);
  }

  instance(def, node) {
    const inst = { def, node, elapsed: 0, duration: def.duration, rendered: false, next: null, timer: 0, frame: 0, reversed: false, scale: 1 };
    if (def.type === 'wait') {
      const s = node.bag?.get('wait_duration_scaler');
      if (s && (s.k === 'int' || s.k === 'num')) inst.duration *= s.v;
    }
    if (def.scaleFromStart) inst.scale = num(node.props.alpha, 1);
    inst.state = this.startState(inst);
    return inst;
  }

  startState(inst) {
    if (inst.def.playEvent) return 1;
    return inst.def.waitRendered && !inst.rendered ? 2 : 0;
  }

  add(comp, inst) {
    comp.active.push(inst);
    comp.originals.push(inst);
    if (inst.state === 0) this.update(inst, 0);
  }

  write(node, key, value) {
    (node.anim ||= {})[key] = value;
    this.touched.add(node);
    if (key === 'offset' || key === 'size') this.layoutDirty = true;
  }

  update(inst, dt) {
    const { def, node } = inst;
    const image = node.props.type === 'image';
    if (IMAGE_TYPES.includes(def.type) && !image) return false;
    if (def.type === 'flip_book') return this.flipBook(inst, dt);
    if (def.type === 'aseprite_flip_book') return true;
    inst.elapsed += dt;
    const t = Math.min(1, Math.max(0, inst.elapsed / Math.max(inst.duration, 0.01)));
    const e = (a, b) => def.ease(a, b, t);
    if (def.type === 'alpha') this.write(node, 'alpha', e(def.from, def.to) * inst.scale);
    else if (def.type === 'clip') this.write(node, 'clip_ratio', e(def.from, def.to));
    else if (def.type === 'color') this.write(node, 'color', def.from.map((v, i) => e(v, def.to[i])));
    else if (def.type === 'uv') this.write(node, 'uv', def.from.map((v, i) => e(v, def.to[i])));
    else if (def.type === 'offset' || def.type === 'size') this.write(node, def.type, termsAt(def.terms, (x) => e(x.from, x.to)));
    return t < 1;
  }

  flipBook(inst, dt) {
    const { def, node } = inst;
    if (!(inst.frame + 1 < def.frameCount || def.looping)) {
      if (!def.resettable) return false;
      inst.state = 1;
      return true;
    }
    inst.timer += dt;
    const interval = 1 / Math.max(def.fps, 0.1);
    if (inst.timer >= interval) { inst.timer -= interval; inst.frame += 1; }
    if (inst.frame >= def.frameCount) { inst.frame = 0; if (def.reversible) inst.reversed = !inst.reversed; }
    const tex = this.textureSize(node);
    if (!tex) return true;
    const ax = def.vertical ? 1 : 0;
    const step = def.frameCount < 1 ? 0 : tex[ax] / def.frameCount;
    const f = inst.reversed ? def.frameCount - inst.frame - 1 : inst.frame;
    const pos = f * step + 1 / 256;
    const size = (node.anim?.uv_size ?? vec2(node.props.uv_size, null) ?? tex).slice();
    size[ax] = step - 1 / 128;
    this.write(node, 'uv', def.vertical ? [0, pos] : [pos, 0]);
    this.write(node, 'uv_size', size);
    return true;
  }

  reset(inst) {
    const { def, node } = inst;
    inst.elapsed = 0;
    inst.state = this.startState(inst);
    const image = node.props.type === 'image';
    if (def.type === 'alpha') this.write(node, 'alpha', def.from);
    else if (def.type === 'clip' && image) this.write(node, 'clip_ratio', def.from);
    else if (def.type === 'color' && image) this.write(node, 'color', def.from.slice());
    else if (def.type === 'uv' && image) this.write(node, 'uv', def.from.slice());
    else if (def.type === 'offset' || def.type === 'size') this.write(node, def.type, termsAt(def.terms, (x) => x.from));
    else if (def.type === 'flip_book') {
      inst.timer = 0;
      inst.frame = 0;
      if (image) this.write(node, 'uv', [0, 0]);
    }
  }

  play(inst) {
    inst.state = inst.def.waitRendered && !inst.rendered ? 2 : 0;
  }

  dispatch(name) {
    let reacted = 0;
    for (const comp of this.comps.values()) {
      if (comp.resetName === null && !comp.originals.some((i) => i.def.playEvent || i.def.resetEvent)) continue;
      if (name === comp.resetName) {
        comp.active = comp.originals.filter((i) => i.def.resettable);
        for (const i of comp.active) this.reset(i);
        reacted += comp.active.length;
        continue;
      }
      for (const i of comp.active) {
        if (i.def.playEvent === name) { this.play(i); reacted++; }
        if (i.def.resetEvent === name) { this.reset(i); reacted++; }
      }
    }
    return reacted;
  }

  rendered(node) {
    const comp = this.comps.get(node.uid);
    if (!comp) return;
    for (const i of comp.active) {
      if (i.def.type === 'aseprite_flip_book') continue;
      i.rendered = true;
      if (i.state === 2) i.state = 0;
    }
  }

  step(dt) {
    const events = [];
    let destroyed = false;
    for (const [uid, comp] of this.comps) {
      if (!attached(comp.node)) { this.comps.delete(uid); continue; }
      if (!comp.active.some((i) => i.state === 0)) continue;
      const gone = this.run(comp, dt);
      if (gone) destroyed = true;
      if (gone || !comp.active.some((i) => i.state === 0)) events.push(...comp.out.splice(0));
    }
    return { events, destroyed };
  }

  run(comp, dt) {
    const queue = [];
    for (const inst of comp.active.slice()) {
      if (inst.state === 0 && this.advance(comp, inst, dt, queue)) return true;
    }
    for (let hops = 0; queue.length && hops < 1000; hops++) {
      const { inst, rest } = queue.shift();
      comp.active.push(inst);
      if (inst.state === 0 && rest >= 0 && this.advance(comp, inst, rest, queue)) return true;
    }
    return false;
  }

  advance(comp, inst, dt, queue) {
    if (this.update(inst, dt)) return false;
    const d = inst.def;
    comp.active.splice(comp.active.indexOf(inst), 1);
    if (d.destroyAtEnd) {
      let target = comp.node;
      while (target && target.name !== d.destroyAtEnd) target = target.parent;
      if (target) {
        const siblings = target.parent?.children;
        if (siblings?.includes(target)) siblings.splice(siblings.indexOf(target), 1);
        if (d.endEvent) comp.out.push(d.endEvent);
        return true;
      }
    }
    if (!inst.next) {
      if (d.endEvent) comp.out.push(d.endEvent);
      return false;
    }
    inst.next.elapsed = 0;
    queue.push({ inst: inst.next, rest: inst.elapsed - inst.duration });
    return false;
  }

  takeChanges() {
    const touched = [...this.touched];
    const layout = this.layoutDirty;
    this.touched.clear();
    this.layoutDirty = false;
    return { touched, layout };
  }
}
