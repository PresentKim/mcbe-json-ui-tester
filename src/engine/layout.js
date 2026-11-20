// Layout: sizes, anchors, stack panels, grids, layers, clipping.
// Rules: LAY-03..LAY-43, CN-47..CN-50. Text width is approximated with the default font metrics
// (6 px per ASCII glyph, 9 px per wide glyph, 10 px line) unless a measure function is given.

import { parseSize, resolveTerms, usesChildren, usesSiblings } from './size.js';
import { layoutText } from './font.js';
import { isAnimRef } from './anim.js';
import { bool } from './expr.js';

const FONT_SCALE = { small: 0.8, normal: 1, large: 1.5, extra_large: 2 };

// Approximate font used until the real metrics (font.js) are loaded: 6 px per ASCII glyph,
// 9 px per wide glyph, 4 px space, 10 px line.
export function defaultMeasure(text, scale = 1, maxWidth = Infinity, opts = {}) {
  return layoutText(String(text ?? ''), scale, maxWidth, (ch) => (ch === ' ' ? 4 : ch.codePointAt(0) > 0x2e80 ? 9 : 6), opts);
}

const linePaddingOf = (p) => (typeof p.line_padding === 'number' ? p.line_padding : 0);
const textWidthLimit = (w) => Math.trunc(w + 1e-6);

const ANCHORS = ['top_left', 'top_middle', 'top_right', 'left_middle', 'center', 'right_middle', 'bottom_left', 'bottom_middle', 'bottom_right'];
const anchorFactor = (a) => {
  const i = ANCHORS.indexOf(a);
  return i < 0 ? [0.5, 0.5] : [(i % 3) / 2, Math.floor(i / 3) / 2];
};

const sizePair = (v) => (Array.isArray(v) ? [v[0], v[1]] : ['default', 'default']);
const sizeProp = (n) => n.anim?.size ?? n.props.size;
const usesSelf = (spec, unit) => spec.kind === 'terms' && spec.terms.some((t) => t.unit === unit);
const SIZE_MIN = -32768, SIZE_MAX = 32767;

export function layoutTree(root, screen, opts = {}) {
  const measure = opts.measure || defaultMeasure;
  const out = [];
  const place = (node, rect, layer, clip) => {
    node.rect = rect;
    node.layerAbs = layer;
    node.clip = clip;
    out.push(node);
  };

  function isStack(n) { return n.props.type === 'stack_panel'; }
  function axisIndex(n) { return (n.props.orientation ?? 'vertical') === 'horizontal' ? 0 : 1; }

  // Measures a node's own size given the parent's size; children sizes are filled in by layoutChildren.
  function sizeOf(node, pw, ph, siblingMax) {
    const p = node.props;
    const eff = node.eff || {};
    const [sx, sy] = sizePair(sizeProp(node));
    const specs = [parseSize(sx), parseSize(sy)];
    const res = [0, 0];
    const label = p.type === 'label';
    const scale = (FONT_SCALE[p.font_size] ?? 1) * (typeof p.font_scale_factor === 'number' && p.font_scale_factor > 0 ? p.font_scale_factor : 1);
    let text = null;
    if (label) text = measure(eff.text ?? '', scale, Infinity, { linePadding: linePaddingOf(p) });
    const order = usesSelf(specs[0], '%y') && !usesSelf(specs[1], '%x') ? [1, 0] : [0, 1];
    for (const ax of order) {
      const spec = specs[ax];
      const parent = ax === 0 ? pw : ph;
      if (spec.kind === 'fill') { res[ax] = 0; continue; } // resolved by a stack parent
      if (spec.kind === 'default') {
        if (label) res[ax] = ax === 0 ? text.w : text.h;
        else if (isStack(node) && axisIndex(node) === ax) res[ax] = NaN; // 100%c, after children
        else if (p.type === 'grid') res[ax] = NaN;
        else res[ax] = parent;
        continue;
      }
      res[ax] = resolveTerms(spec, { parent, childSum: 0, childMax: 0, siblingMax: siblingMax?.[ax] ?? 0, selfW: res[0], selfH: res[1] });
    }
    // bound sizes: relative multiplier of the parent, or pixels with _absolute (LAY-10, CN-39)
    if (eff['#size_binding_x'] !== undefined) res[0] = eff['#size_binding_x'] * pw;
    if (eff['#size_binding_y'] !== undefined) res[1] = eff['#size_binding_y'] * ph;
    if (eff['#size_binding_x_absolute'] !== undefined) res[0] = eff['#size_binding_x_absolute'];
    if (eff['#size_binding_y_absolute'] !== undefined) res[1] = eff['#size_binding_y_absolute'];
    if (label && specs[0].kind !== 'default' && specs[1].kind === 'default') res[1] = measure(eff.text ?? '', scale, textWidthLimit(res[0]), { linePadding: linePaddingOf(p) }).h;
    return { res, specs };
  }

  function clamp(node, v, ax, env) {
    const p = node.props;
    const lim = (x, dflt) => {
      const s = parseSize(sizePair(x)[ax]);
      if (s.kind !== 'terms' || s.terms.length === 0) return dflt;
      return resolveTerms(s, env);
    };
    const mn = lim(p.min_size, SIZE_MIN), mx = lim(p.max_size, SIZE_MAX);
    const out = v > mx ? mx : Math.max(v, mn);
    return Number.isFinite(out) ? out : 0;
  }

  // Lays out node inside a parent of size (pw, ph); returns [w, h].
  const cache = new Map();
  function measureNode(node, pw, ph, siblingMax, forced) {
    const key = `${node.uid}:${pw}:${ph}:${siblingMax?.[0] ?? 0}:${siblingMax?.[1] ?? 0}:${forced ? forced.join() : ''}`;
    const hit = cache.get(key);
    if (hit) { node.size = hit.size.slice(); node.kidsLayout = hit.kids; return node.size; }
    const r = measureNodeRaw(node, pw, ph, siblingMax, forced);
    cache.set(key, { size: r.slice(), kids: node.kidsLayout });
    return r;
  }
  function measureNodeRaw(node, pw, ph, siblingMax, forced) {
    const { res, specs } = sizeOf(node, pw, ph, siblingMax);
    // a scroll view's engine sizes its scrollbar box (sizeScrollBoxes)
    if (node.engineSize) for (const ax of [0, 1]) if (node.engineSize[ax] !== undefined) { res[ax] = node.engineSize[ax]; specs[ax] = { kind: 'forced' }; }
    // a stack parent decides the size of a "fill" axis (CN-49)
    if (forced) for (const ax of [0, 1]) if (forced[ax] !== undefined) { res[ax] = forced[ax]; specs[ax] = { kind: 'forced' }; }
    let [w, h] = res;
    const needKids = [0, 1].some((ax) => Number.isNaN(res[ax]) || usesChildren(specs[ax]));
    const kidsW = Number.isNaN(w) ? 0 : w, kidsH = Number.isNaN(h) ? 0 : h;
    const kids = layoutChildren(node, kidsW, kidsH);
    const envOf = (ax) => ({ parent: ax === 0 ? pw : ph, childSum: kids.sum[ax], childMax: kids.max[ax], siblingMax: siblingMax?.[ax] ?? 0, selfW: res[0], selfH: res[1] });
    if (needKids) {
      for (const ax of [0, 1]) {
        const spec = specs[ax];
        if (Number.isNaN(res[ax])) {
          if (node.props.type === 'grid') res[ax] = kids.extent[ax];
          else res[ax] = kids.sum[ax];
        } else if (usesChildren(spec)) res[ax] = resolveTerms(spec, envOf(ax));
      }
      [w, h] = res;
    }
    w = clamp(node, w, 0, envOf(0));
    h = clamp(node, h, 1, envOf(1));
    node.size = [w, h];
    if (needKids && (w !== kidsW || h !== kidsH)) layoutChildren(node, w, h);
    return [w, h];
  }

  // Sizes and positions children relative to the node's own box (0,0,w,h).
  function layoutChildren(node, w, h) {
    const kids = node.children.filter((c) => !c.ignored);
    const sum = [0, 0], max = [0, 0], extent = [0, 0];
    if (kids.length === 0) { node.kidsLayout = []; return { sum, max, extent }; }
    const visibleKids = kids.filter((c) => c.eff?.visible !== false);
    // sibling max for %sm; siblings that use %sm themselves are excluded (CN-47)
    const sibMax = [0, 0];
    if (kids.some((c) => sizePair(sizeProp(c)).some((s) => usesSiblings(parseSize(s))))) {
      for (const c of kids) {
        const pr = sizePair(sizeProp(c)).map(parseSize);
        if (pr.some(usesSiblings)) continue;
        const [cw, ch] = measureNode(c, w, h, [0, 0]);
        sibMax[0] = Math.max(sibMax[0], cw); sibMax[1] = Math.max(sibMax[1], ch);
      }
    }
    const placed = [];
    if (node.props.type === 'stack_panel') {
      const ax = axisIndex(node), cross = 1 - ax;
      const fills = [];
      let used = 0;
      for (const c of kids) {
        const spec = parseSize(sizePair(sizeProp(c))[ax]);
        if (spec.kind === 'fill') { fills.push(c); continue; }
        const sz = measureNode(c, w, h, sibMax);
        if (c.eff?.visible !== false) used += sz[ax]; // hidden children take no space (LAY-04)
      }
      const share = fills.length ? Math.max(0, ((ax === 0 ? w : h) - used) / fills.filter((c) => c.eff?.visible !== false).length || 0) : 0;
      for (const c of fills) {
        measureNode(c, w, h, sibMax, ax === 0 ? [share, undefined] : [undefined, share]);
      }
      let cur = 0;
      for (const c of kids) {
        const sz = c.size;
        const hidden = c.eff?.visible === false;
        const pos = [0, 0];
        pos[ax] = cur;
        if (node.props.use_child_anchors) {
          const [fx, fy] = anchorFactor(c.props.anchor_from), [tx, ty] = anchorFactor(c.props.anchor_to);
          const f = [fx, fy], t = [tx, ty];
          pos[cross] = f[cross] * (cross === 0 ? w : h) - t[cross] * sz[cross];
        }
        // offset is ignored inside a stack (LAY-38)
        placed.push({ c, x: pos[0], y: pos[1] });
        if (!hidden) cur += sz[ax];
        // %c across a stack adds the children too: two boards in a horizontal stack doubled its height (LAY-52)
        if (!hidden) { sum[ax] += sz[ax]; max[ax] = Math.max(max[ax], sz[ax]); sum[cross] += sz[cross]; max[cross] = Math.max(max[cross], sz[cross]); }
      }
      extent[ax] = sum[ax]; extent[cross] = max[cross];
    } else if (node.props.type === 'grid') {
      const dims = node.gridDims || node.props.grid_dimensions || null;
      let cellW = 0, cellH = 0;
      for (const c of kids) { const sz = measureNode(c, w, h, sibMax); cellW = Math.max(cellW, sz[0]); cellH = Math.max(cellH, sz[1]); }
      const fitCols = Math.max(1, Math.floor(w / (cellW || 1)));
      let cols = dims ? dims[0] : fitCols;
      if (node.props.grid_rescaling_type === 'horizontal') cols = fitCols; // LAY-30
      else if (node.props.grid_rescaling_type === 'vertical') {
        const rows = Math.max(1, Math.floor(h / (cellH || 1)));
        cols = Math.max(1, Math.ceil(kids.length / rows));
      } else if (dims && w > 0) {
        // fixed dimensions split the grid width into equal cells, and a template wider than a cell wraps to its own row (LAY-41)
        cols = Math.min(dims[0], fitCols);
        cellW = Math.max(cellW, w / dims[0]);
      }
      const vertical = node.props.grid_fill_direction === 'vertical';
      const rowsFixed = dims ? dims[1] : Math.ceil(kids.length / cols);
      kids.forEach((c, i) => {
        // explicit grid_position wins; template cells fill row-major and ignore their own anchor/offset (LAY-41)
        let col, row;
        if (Array.isArray(c.props.grid_position)) [col, row] = c.props.grid_position;
        else if (vertical) { row = i % rowsFixed; col = Math.floor(i / rowsFixed); }
        else { col = i % cols; row = Math.floor(i / cols); }
        placed.push({ c, x: col * cellW, y: row * cellH });
        extent[0] = Math.max(extent[0], (col + 1) * cellW);
        extent[1] = Math.max(extent[1], (row + 1) * cellH);
      });
      sum[0] = extent[0]; sum[1] = extent[1]; max[0] = cellW; max[1] = cellH;
    } else {
      for (const c of kids) {
        const sz = measureNode(c, w, h, sibMax);
        const [fx, fy] = anchorFactor(c.props.anchor_from);
        let [tx, ty] = anchorFactor(c.props.anchor_to);
        let ox = 0, oy = 0;
        const off = c.anim?.offset || c.eff?.offsetBound || c.props.offset;
        if (off !== undefined) {
          const [a, b] = sizePair(off);
          const pa = parseSize(a), pb = parseSize(b);
          const env = { childSum: 0, childMax: 0, siblingMax: 0, selfW: sz[0], selfH: sz[1] };
          ox = pa.kind === 'terms' ? resolveTerms(pa, { ...env, parent: w }) : 0;
          oy = pb.kind === 'terms' ? resolveTerms(pb, { ...env, parent: h }) : 0;
        }
        if (c.props.use_anchored_offset) {
          const vx = c.eff?.['#anchored_offset_value_x'], vy = c.eff?.['#anchored_offset_value_y'];
          if (vx !== undefined || vy !== undefined) {
            [tx, ty] = [fx, fy];
            if (vx !== undefined && fx !== 0.5) ox = (fx === 1 ? -1 : 1) * vx * w;
            if (vy !== undefined && fy !== 0.5) oy = (fy === 1 ? -1 : 1) * vy * h;
          }
        }
        const x = fx * w - tx * sz[0] + ox, y = fy * h - ty * sz[1] + oy;
        placed.push({ c, x, y });
        if (c.eff?.visible !== false) {
          for (const a of [0, 1]) {
            max[a] = Math.max(max[a], sz[a]);
            extent[a] = Math.max(extent[a], sz[a]);
            sum[a] += sz[a];
          }
        }
      }
    }
    node.kidsLayout = placed;
    return { sum, max, extent };
  }

  function position(node, x, y, layer, clip, parentAllowsClipping = true) {
    const allowsClipping = typeof node.props.allow_clipping === 'boolean' ? node.props.allow_clipping : parentAllowsClipping;
    const [w, h] = node.size || [0, 0];
    if (node.props.type === 'label') {
      // the lines the label draws, broken at its final width with the same measure as its size
      const p = node.props;
      const scale = (FONT_SCALE[p.font_size] ?? 1) * (typeof p.font_scale_factor === 'number' && p.font_scale_factor > 0 ? p.font_scale_factor : 1);
      node.fontScale = scale;
      node.linePadding = linePaddingOf(p);
      const text = measure(node.eff?.text ?? '', scale, textWidthLimit(w), { linePadding: node.linePadding, maxHeight: h });
      node.textLines = text.lineTexts;
      node.textUnicode = text.unicode;
      if (node.bag) node.bag.set('#using_ellipses', bool(text.ellipsis));
    }
    const rect = { x, y, w, h };
    const lay = layer + (typeof node.props.layer === 'number' ? Math.trunc(node.props.layer) : 0); // relative to the parent (LAY-18)
    const childClip = node.props.clips_children ? clipRect(rect, node.props.clip_offset, clip) : clip;
    place(node, rect, lay, allowsClipping ? childClip : null);
    for (const k of node.kidsLayout || []) {
      const [sx, sy] = k.c.scrollShift || [0, 0];
      position(k.c, x + k.x + sx, y + k.y + sy, lay, childClip, allowsClipping);
    }
  }

  measureNode(root, screen.w, screen.h, [0, 0]);
  // A scroll view hides its bar panel when the content fits the viewport (CN-51); the layout then
  // runs again so a "fill" viewport takes the bar's place.
  if (hideFittingScrollbars(root)) { cache.clear(); measureNode(root, screen.w, screen.h, [0, 0]); }
  if (sizeScrollBoxes(root)) { cache.clear(); measureNode(root, screen.w, screen.h, [0, 0]); }
  applyScroll(root);
  const [rw, rh] = root.size;
  const [fx, fy] = anchorFactor(root.props.anchor_from), [tx, ty] = anchorFactor(root.props.anchor_to);
  position(root, fx * screen.w - tx * rw, fy * screen.h - ty * rh, 0, null);
  return out;
}

function findByName(node, name) {
  const q = [...node.children];
  while (q.length) {
    const n = q.shift();
    if (n.ignored) continue;
    if (n.name === name) return n;
    q.push(...n.children);
  }
  return null;
}

function hideFittingScrollbars(root) {
  let changed = false;
  const visit = (n) => {
    if (n.ignored) return;
    const p = n.props;
    if (p.type === 'scroll_view' && !p.scrollbar_always_visible) {
      const content = findByName(n, p.scroll_content), port = findByName(n, p.scroll_view_port), bar = findByName(n, p.scroll_box_and_track_panel);
      if (content?.size && port?.size && bar && bar.eff) {
        const fits = content.size[1] <= port.size[1] + 0.01;
        if (fits && bar.eff.visible !== false) { bar.eff.visible = false; bar.scrollHidden = true; changed = true; }
        else if (!fits && bar.scrollHidden) { bar.eff.visible = true; bar.scrollHidden = false; changed = true; }
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  if (changed) {
    const vis = (n, parent) => { n.effVisible = parent && n.eff?.visible !== false; for (const c of n.children) if (!c.ignored) vis(c, n.effVisible); };
    vis(root, true);
  }
  return changed;
}

function scrollParts(view) {
  const p = view.props;
  const box = findByName(view, p.scrollbar_box);
  if (!box) return null;
  return { axis: box.props.draggable === 'horizontal' ? 0 : 1, box, content: findByName(view, p.scroll_content), port: findByName(view, p.scroll_view_port), track: findByName(view, p.scrollbar_track) };
}

const scrollRatio = (s) => {
  const content = s.content.size[s.axis];
  return content > 0 ? Math.min(1, Math.max(0.1, s.port.size[s.axis] / content)) : 1;
};

// The engine overwrites the scrollbar box length on the box's draggable axis (Windows 1.26.65.1
// client code; matches the 2026-10-23 measurement on dfui help cards and the research tree).
function sizeScrollBoxes(root) {
  let changed = false;
  const visit = (n) => {
    if (n.ignored) return;
    if (n.props.type === 'scroll_view') {
      const s = scrollParts(n);
      if (s?.content?.size && s.port?.size && s.track?.size) {
        const len = Math.ceil(s.track.size[s.axis] * scrollRatio(s));
        if (!s.box.engineSize || s.box.engineSize[s.axis] !== len) { s.box.engineSize = s.axis === 0 ? [len, undefined] : [undefined, len]; changed = true; }
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  return changed;
}

function applyScroll(root) {
  const visit = (n) => {
    if (n.ignored) return;
    if (n.props.type === 'scroll_view') scrollTo(n, n.scrollPos ?? 0);
    for (const c of n.children) visit(c);
  };
  visit(root);
}

function scrollTo(view, pos) {
  const s = scrollParts(view);
  if (!s?.content?.size || !s.port?.size) return false;
  const { axis } = s;
  const max = Math.max(0, s.content.size[axis] - s.port.size[axis]);
  view.scrollPos = Math.min(max, Math.max(0, pos));
  const shift = -Math.trunc(view.scrollPos * 8) / 8;
  s.content.scrollShift = axis === 0 ? [shift, 0] : [0, shift];
  if (s.track?.size && s.box.size) {
    const along = (s.track.size[axis] - s.box.size[axis]) * view.scrollPos / (max > 0.5 ? max : 1);
    s.box.scrollShift = axis === 0 ? [along, 0] : [0, along];
  }
  const bag = view.bag;
  if (bag) {
    if (!bag.has('#scrollbar_hit_bottom')) bag.set('#scrollbar_hit_bottom', bool(false));
    const fits = scrollRatio(s) === 1;
    if (fits || (axis === 1 && max - view.scrollPos < 0.1)) bag.set('#scrollbar_hit_bottom', bool(true));
    bag.set('#scrolled_to_end', bool(max <= view.scrollPos));
    bag.set('#scroll_bar_visible', bool(!fits || flagOn(view.props.scrollbar_always_visible)));
  }
  return true;
}

const flagOn = (v) => v === true || v === 'true';

let wheelSpeed = null;

// The client keeps -scroll_speed in a function-level static set by the first scroll view that gets
// a wheel event, so that view's scroll_speed applies to every scroll view afterwards (Windows
// 1.26.65.1 client code). The wheel unit is not known from the code: one notch is taken as the
// screen's vertical_scroll_delta (default 20).
export function wheelScroll(view, notches) {
  const s = scrollParts(view);
  if (!s || s.axis !== 1) return false;
  if (wheelSpeed === null) wheelSpeed = -(typeof view.props.scroll_speed === 'number' ? view.props.scroll_speed : 1);
  let screen = view;
  while (screen && screen.props.type !== 'screen') screen = screen.parent;
  const delta = typeof screen?.props.vertical_scroll_delta === 'number' ? screen.props.vertical_scroll_delta : 20;
  return scrollTo(view, (view.scrollPos ?? 0) + wheelSpeed * notches * delta);
}

export function scrollViewAt(nodes, x, y) {
  const hit = (r) => r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  let found = null;
  for (const n of nodes) if (n.props.type === 'scroll_view' && n.effVisible && hit(n.rect) && (!n.clip || hit(n.clip))) found = n;
  return found;
}

export function clipRect({ x, y, w, h }, offset, parent = null) {
  const [ox, oy] = Array.isArray(offset) ? offset.map((v) => Number(v) || 0) : [0, 0];
  let x0 = x + ox, y0 = y + oy, x1 = x + Math.max(0, w) - ox, y1 = y + Math.max(0, h) - oy;
  if (parent) {
    x0 = Math.max(x0, parent.x); y0 = Math.max(y0, parent.y);
    x1 = Math.min(x1, parent.x + parent.w); y1 = Math.min(y1, parent.y + parent.h);
  } else {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  }
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export { ANCHORS };

// Engine renderers the game leaves empty (ANI-38, entity-inventory-ui 2.2.3 and 10.1, measured in a chest screen).
export function findRendererIssues(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.props.type !== 'custom' || !n.effVisible) continue;
    const r = n.props.renderer;
    if ((r === 'inventory_item_renderer' || r === 'live_player_renderer') && n.layerAbs > 94) {
      out.push({ node: n, level: n.layerAbs >= 99 ? 'warn' : 'info', msg: `${r}의 조상 레이어 합이 ${n.layerAbs}다. 상자 화면 실측에서 합 94까지는 그려지고 99부터 그려지지 않았다(95~98은 시험하지 않음). 이 도구의 합은 바닐라 조상 레이어까지 더한 값이다 [ANI-38]` });
    }
    const id = n.bag?.get('#entity_id');
    if (r === 'live_horse_renderer' && id && (id.k === 'int' || id.k === 'num')) {
      out.push({ node: n, level: 'warn', msg: `#entity_id가 숫자(${id.v})라 그려지지 않는다. 칸 이름을 큰따옴표로 감싼 "<id>"로 넘겨 글자로 받는다 [EXP-30]` });
    }
  }
  return out;
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const isUnder = (n, anc) => { for (let p = n.parent; p; p = p.parent) if (p === anc) return true; return false; };

// Layouts that drew wrong in game although nothing is wrong in this model (FFR, measured on mobile).
export function findLayoutIssues(nodes) {
  const out = [];
  for (const n of nodes) {
    for (const k of ['size', 'offset', 'min_size', 'max_size']) {
      const v = n.props[k];
      if (v !== undefined && v !== null && !Array.isArray(v) && !isAnimRef(v)) out.push({ node: n, level: 'warn', msg: `${k}가 배열이 아니다(${JSON.stringify(v)}). 엔진은 expected an array를 남기고 두 축 모두 default로 읽는다` });
    }
    for (const k of ['anchor_from', 'anchor_to']) {
      const v = n.props[k];
      if (v !== undefined && !ANCHORS.includes(v)) out.push({ node: n, level: 'warn', msg: `${k} '${v}'는 엔진의 앵커 이름 9개에 없어 center로 읽힌다` });
    }
  }
  const shown = nodes.filter((n) => n.effVisible && n.rect && n.rect.w > 0 && n.rect.h > 0);
  const images = shown.filter((n) => n.props.type === 'image' && n.eff?.texture);
  for (const n of shown) {
    if (n.props.type !== 'label' || !n.eff?.text) continue;
    let cell = null, scroll = false;
    for (let p = n.parent; p; p = p.parent) {
      if (!cell && p.fromFactory) cell = p;
      if (cell && p.props.type === 'scroll_view') { scroll = true; break; }
    }
    if (!scroll) continue;
    const bg = images.find((i) => i.layerAbs === n.layerAbs && (i === cell || isUnder(i, cell)) && overlaps(i.rect, n.rect));
    if (bg) out.push({ node: n, level: 'warn', msg: `스크롤 영역 안 칸의 라벨이 이미지 ${bg.name}와 같은 레이어(${n.layerAbs})라 게임에서는 무언가를 건드리기 전까지 글자가 비었다. 라벨 layer를 이미지보다 높인다 [LAY-55]` });
  }
  const buttons = shown.filter((n) => n.props.type === 'button' || n.props.type === 'toggle');
  for (const v of shown) {
    if (v.props.type !== 'scroll_view') continue;
    const r = v.rect;
    const taken = buttons.filter((b) => !isUnder(b, v) && !isUnder(v, b) && r.x <= b.rect.x + b.rect.w / 2 && b.rect.x + b.rect.w / 2 <= r.x + r.w && r.y <= b.rect.y + b.rect.h / 2 && b.rect.y + b.rect.h / 2 <= r.y + r.h);
    if (taken.length) out.push({ node: v, level: 'warn', msg: `이 스크롤 영역이 바깥 버튼 ${taken.length}개(${taken.slice(0, 3).map((b) => b.name).join(', ')}) 위를 덮는다. 휴대폰에서는 내용이 비어 있어도 그 영역의 터치를 가져가 버튼이 눌리지 않았다 [LAY-57]` });
  }
  for (const g of shown) {
    if (g.props.type !== 'grid') continue;
    const cells = g.children.filter((c) => c.fromFactory).length;
    if (g.rect.h > 30000 || cells >= 3000) out.push({ node: g, level: 'warn', msg: `grid 높이가 ${Math.round(g.rect.h)}px, 칸이 ${cells}개다. 게임에서는 약 30000px(2열 2000칸)까지 맞았고 45000px(3000칸)부터 칸들이 맨 위 약 200px 안에 겹쳐 그려졌다. 원인이 칸 수인지 높이인지는 모른다 [COL-49]` });
  }
  return out;
}

// Visible labels and images fully covered by an opaque-looking image on a higher layer (LAY-18).
export function findOcclusions(nodes) {
  const shown = nodes.filter((n) => n.effVisible && n.rect && n.rect.w > 0 && n.rect.h > 0);
  const covers = shown.filter((n) => n.props.type === 'image' && n.eff?.texture && (n.eff?.alpha ?? 1) >= 1);
  const out = [];
  for (const n of shown) {
    if (n.props.type !== 'label' || !n.eff?.text) continue;
    for (const c of covers) {
      if (c.layerAbs <= n.layerAbs) continue;
      let anc = false;
      for (let p = n.parent; p; p = p.parent) if (p === c) anc = true;
      if (anc) continue;
      const a = n.rect, b = c.rect;
      if (b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h) {
        out.push({ node: n, by: c });
        break;
      }
    }
  }
  return out;
}
