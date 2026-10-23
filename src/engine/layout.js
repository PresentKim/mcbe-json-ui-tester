// Layout: sizes, anchors, stack panels, grids, layers, clipping.
// Rules: LAY-03..LAY-43, CN-47..CN-50. Text width is approximated with the default font metrics
// (6 px per ASCII glyph, 9 px per wide glyph, 10 px line) unless a measure function is given.

import { parseSize, resolveTerms, usesChildren, usesSiblings } from './size.js';
import { layoutText } from './font.js';

const FONT_SCALE = { small: 0.8, normal: 1, large: 1.5, extra_large: 2 };

// Approximate font used until the real metrics (font.js) are loaded: 6 px per ASCII glyph,
// 9 px per wide glyph, 4 px space, 10 px line.
export function defaultMeasure(text, scale = 1, maxWidth = Infinity) {
  return layoutText(String(text ?? ''), scale, maxWidth, (ch) => (ch === ' ' ? 4 : ch.codePointAt(0) > 0x2e80 ? 9 : 6));
}

const ANCHORS = ['top_left', 'top_middle', 'top_right', 'left_middle', 'center', 'right_middle', 'bottom_left', 'bottom_middle', 'bottom_right'];
function anchorFactor(a) {
  // anchors are judged by whether the name contains left/right/top/bottom (LAY-43)
  const s = typeof a === 'string' ? a : 'center';
  return [s.includes('left') ? 0 : s.includes('right') ? 1 : 0.5, s.includes('top') ? 0 : s.includes('bottom') ? 1 : 0.5];
}

const sizePair = (v) => (Array.isArray(v) ? [v[0], v[1]] : v === undefined ? ['default', 'default'] : [v, v]);

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
    const [sx, sy] = sizePair(p.size);
    const specs = [parseSize(sx), parseSize(sy)];
    const res = [0, 0];
    const label = p.type === 'label';
    const scale = (FONT_SCALE[p.font_size] ?? 1) * (typeof p.font_scale_factor === 'number' && p.font_scale_factor > 0 ? p.font_scale_factor : 1);
    let text = null;
    if (label) text = measure(eff.text ?? '', scale);
    for (const ax of [0, 1]) {
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
    if (label && specs[0].kind !== 'default' && specs[1].kind === 'default') res[1] = measure(eff.text ?? '', scale, res[0]).h;
    return { res, specs };
  }

  function clamp(node, v, ax, pw, ph) {
    const p = node.props;
    const lim = (x) => {
      if (x === undefined) return undefined;
      const s = parseSize(sizePair(x)[ax]);
      if (s.kind !== 'terms' || s.terms.length === 0) return undefined;
      return resolveTerms(s, { parent: ax === 0 ? pw : ph, childSum: 0, childMax: 0, siblingMax: 0 });
    };
    const mn = lim(p.min_size), mx = lim(p.max_size);
    if (mx !== undefined && v > mx) return mx; // max wins even when min is larger (CN-48)
    if (mn !== undefined && v < mn) return mn;
    return v;
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
    if (needKids) {
      for (const ax of [0, 1]) {
        const spec = specs[ax];
        const env = { parent: ax === 0 ? pw : ph, childSum: kids.sum[ax], childMax: kids.max[ax], siblingMax: siblingMax?.[ax] ?? 0 };
        if (Number.isNaN(res[ax])) {
          if (node.props.type === 'grid') res[ax] = kids.extent[ax];
          else res[ax] = kids.sum[ax];
        } else if (usesChildren(spec)) res[ax] = resolveTerms(spec, env);
      }
      [w, h] = res;
    }
    w = clamp(node, w, 0, pw, ph);
    h = clamp(node, h, 1, pw, ph);
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
    if (kids.some((c) => sizePair(c.props.size).some((s) => usesSiblings(parseSize(s))))) {
      for (const c of kids) {
        const pr = sizePair(c.props.size).map(parseSize);
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
        const spec = parseSize(sizePair(c.props.size)[ax]);
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
        if (c.props.use_child_anchors || node.props.use_child_anchors) {
          const [fx, fy] = anchorFactor(c.props.anchor_from), [tx, ty] = anchorFactor(c.props.anchor_to);
          const f = [fx, fy], t = [tx, ty];
          pos[cross] = f[cross] * (cross === 0 ? w : h) - t[cross] * sz[cross];
        }
        // offset is ignored inside a stack (LAY-38)
        placed.push({ c, x: pos[0], y: pos[1] });
        if (!hidden) cur += sz[ax];
        if (!hidden) { sum[ax] += sz[ax]; max[ax] = Math.max(max[ax], sz[ax]); sum[cross] = Math.max(sum[cross], sz[cross]); max[cross] = Math.max(max[cross], sz[cross]); }
      }
      extent[ax] = sum[ax]; extent[cross] = sum[cross];
    } else if (node.props.type === 'grid') {
      const dims = node.gridDims || node.props.grid_dimensions || null;
      let cellW = 0, cellH = 0;
      for (const c of kids) { const sz = measureNode(c, w, h, sibMax); cellW = Math.max(cellW, sz[0]); cellH = Math.max(cellH, sz[1]); }
      let cols = dims ? dims[0] : Math.max(1, Math.floor(w / (cellW || 1)));
      if (node.props.grid_rescaling_type === 'horizontal') cols = Math.max(1, Math.floor(w / (cellW || 1))); // LAY-30
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
        const [fx, fy] = anchorFactor(c.props.anchor_from), [tx, ty] = anchorFactor(c.props.anchor_to);
        let ox = 0, oy = 0;
        const off = c.eff?.offsetBound || c.props.offset;
        if (off !== undefined) {
          const [a, b] = sizePair(off);
          const pa = parseSize(a), pb = parseSize(b);
          ox = pa.kind === 'terms' ? resolveTerms(pa, { parent: w, childSum: 0, childMax: 0, siblingMax: 0 }) : 0;
          oy = pb.kind === 'terms' ? resolveTerms(pb, { parent: h, childSum: 0, childMax: 0, siblingMax: 0 }) : 0;
        }
        if (c.props.use_anchored_offset) {
          // value is a fraction of the parent size, measured inward from the anchored edge (CN-39)
          const vx = c.eff?.['#anchored_offset_value_x'], vy = c.eff?.['#anchored_offset_value_y'];
          if (vx !== undefined) ox += (fx === 1 ? -1 : 1) * vx * w;
          if (vy !== undefined) oy += (fy === 1 ? -1 : 1) * vy * h;
        }
        const x = fx * w - tx * sz[0] + ox, y = fy * h - ty * sz[1] + oy;
        placed.push({ c, x, y });
        if (c.eff?.visible !== false) {
          max[0] = Math.max(max[0], sz[0]); max[1] = Math.max(max[1], sz[1]);
          // the children's own size, independent of where the anchor would put them in a panel
          // whose size is not known yet, and of their offset (measured in game 2026-10-23: a
          // [152, "100%c + 8px"] panel round a 128 px child at offset [4, 4] was 136 tall, not 140)
          extent[0] = Math.max(extent[0], sz[0]); extent[1] = Math.max(extent[1], sz[1]);
        }
      }
      // %c on a plain panel is the children's reach, not their sum
      sum[0] = extent[0]; sum[1] = extent[1];
    }
    node.kidsLayout = placed;
    return { sum, max, extent };
  }

  function position(node, x, y, layer, clip) {
    const [w, h] = node.size || [0, 0];
    if (node.props.type === 'label') {
      // the lines the label draws, broken at its final width with the same measure as its size
      const p = node.props;
      const scale = (FONT_SCALE[p.font_size] ?? 1) * (typeof p.font_scale_factor === 'number' && p.font_scale_factor > 0 ? p.font_scale_factor : 1);
      node.fontScale = scale;
      node.textLines = measure(node.eff?.text ?? '', scale, w + 0.01).lineTexts;
    }
    const rect = { x, y, w, h };
    const lay = layer + (typeof node.props.layer === 'number' ? node.props.layer : 0); // relative to the parent (LAY-18)
    place(node, rect, lay, clip);
    let childClip = clip;
    if (node.props.clips_children) {
      const r = { x, y, w, h };
      childClip = clip ? intersect(clip, r) : r;
    }
    for (const k of node.kidsLayout || []) {
      const cc = k.c.props.allow_clipping === false ? null : childClip;
      position(k.c, x + k.x, y + k.y, lay, cc);
    }
  }

  measureNode(root, screen.w, screen.h, [0, 0]);
  // A scroll view hides its bar panel when the content fits the viewport (CN-51); the layout then
  // runs again so a "fill" viewport takes the bar's place.
  if (hideFittingScrollbars(root)) { cache.clear(); measureNode(root, screen.w, screen.h, [0, 0]); }
  if (sizeScrollBoxes(root)) { cache.clear(); measureNode(root, screen.w, screen.h, [0, 0]); }
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

// The scrollbar box of a scroll view whose content overflows is as long as the track times the
// part of the content the viewport shows, at the top (nothing is scrolled yet). Measured in game
// 2026-10-23 (dfui help cards, research tree): the JSON gives the box no height; the engine does.
function sizeScrollBoxes(root) {
  let changed = false;
  const visit = (n) => {
    if (n.ignored) return;
    const p = n.props;
    if (p.type === 'scroll_view') {
      const content = findByName(n, p.scroll_content), port = findByName(n, p.scroll_view_port);
      const track = findByName(n, p.scrollbar_track), box = findByName(n, p.scrollbar_box);
      if (content?.size && port?.size && track?.size && box) {
        const ratio = content.size[1] > port.size[1] + 0.01 ? port.size[1] / content.size[1] : 1;
        const h = track.size[1] * ratio;
        if (!box.engineSize || Math.abs(box.engineSize[1] - h) > 0.01) { box.engineSize = [undefined, h]; changed = true; }
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  return changed;
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

export { ANCHORS };

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
