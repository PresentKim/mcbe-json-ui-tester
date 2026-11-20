// Canvas renderer for a laid-out control tree; a DOM overlay above it carries the inspection boxes.
import { walk } from './engine/bind.js';
import { modelFaces, modelBounds, sphereFit } from './engine/geometry.js';
import { rendererOf } from './engine/controls.js';
import { t } from './i18n.js';

const COLOR_CODES = {
  0: '#000000', 1: '#0000AA', 2: '#00AA00', 3: '#00AAAA', 4: '#AA0000', 5: '#AA00AA', 6: '#FFAA00', 7: '#AAAAAA',
  8: '#555555', 9: '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
  g: '#DDD605', h: '#E3D4D1', i: '#CECACA', j: '#443A3B', m: '#971607', n: '#B4684D', p: '#DEB12D', q: '#47A036',
  s: '#2CBAA8', t: '#21497B', u: '#9A5CC6', v: '#EB7114', w: '#5FB4DC',
};
const FONT_FAMILY = '"Minecraft", "Malgun Gothic", ui-monospace, Consolas, monospace';

const css = (c) => {
  if (Array.isArray(c)) {
    const [r, g, b, a = 1] = c.map(Number);
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
  }
  if (typeof c === 'string' && c.startsWith('#')) return c;
  return null;
};

const images = new Map();
const shades = new Map();
let lastCall = null, redrawQueued = false;

function redrawSoon() {
  if (redrawQueued || !lastCall) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    const { canvas, args } = lastCall;
    if (args[0].contains(canvas)) renderTree(...args);
  });
}

function imageOf(url) {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.onload = redrawSoon;
    img.src = url;
    images.set(url, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

function shaded(img, color, gray) {
  if (!color && !gray) return img;
  const key = `${img.src}|${color}|${gray}`;
  let c = shades.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  if (gray) g.filter = 'grayscale(1)';
  g.drawImage(img, 0, 0);
  g.filter = 'none';
  if (color) {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, 0, 0);
  }
  shades.set(key, c);
  return c;
}

// textures: (path) -> { url, nineslice?: { nineslice_size, base_size } } | null
export function renderTree(stage, root, opts) {
  const { zoom, textures, items: itemIcons, outlines, showHidden, selectedUid, onPick, onHover, measured = true } = opts;
  stage.textContent = '';
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(stage.clientWidth * dpr);
  canvas.height = Math.round(stage.clientHeight * dpr);
  Object.assign(canvas.style, { width: `${canvas.width / dpr}px`, height: `${canvas.height / dpr}px` });
  stage.append(canvas);
  lastCall = { canvas, args: [stage, root, opts] };
  const ctx = canvas.getContext('2d');
  const k = zoom * dpr;
  const items = [];
  let order = 0;
  walk(root, (n) => { n.drawOrder = order++; if (n.rect) items.push(n); });
  items.sort((a, b) => a.layerAbs - b.layerAbs || a.drawOrder - b.drawOrder);
  const alphaOf = (n) => {
    let a = n.eff?.alpha ?? 1;
    for (let p = n.parent; p; p = p.parent) if (p.props.propagate_alpha) a *= p.eff?.alpha ?? 1;
    return a;
  };
  for (const n of items) {
    const visible = n.effVisible;
    if (!visible && !showHidden) continue;
    const t = n.props.type;
    // engine renderers other than item icons are only placeholders: show them with the outlines
    const isItem = rendererOf(n) === 'inventory_item_renderer';
    const isGradient = rendererOf(n) === 'gradient_renderer';
    const drawable = t === 'image' || t === 'label' || isItem || isGradient || (t === 'custom' && outlines) || n.props.debug;
    const showBox = outlines || n.uid === selectedUid;
    if (!drawable && !showBox) continue;
    const { x, y, w, h } = n.rect;
    const inset = n.clip ? clipInset(n.rect, n.clip) : [0, 0, 0, 0];
    const clipped = inset.some((v) => v > 0);
    const alpha = alphaOf(n);
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = visible ? Math.max(0, Math.min(1, alpha)) : 0.25;
    ctx.imageSmoothingEnabled = false;
    if (clipped) {
      ctx.beginPath();
      ctx.rect(x + inset[3], y + inset[0], Math.max(0, w - inset[1] - inset[3]), Math.max(0, h - inset[0] - inset[2]));
      ctx.clip();
    }
    let mark = null;
    if (t === 'image') {
      mark = drawImage(ctx, n, textures, k, measured);
      if (visible && n.eff?.texture) opts.onRendered?.(n);
    }
    else if (t === 'label') drawLabel(ctx, n, zoom, dpr);
    else if (isGradient) drawGradient(ctx, n);
    else {
      const item = isItem && itemIcons ? drawItem(ctx, n, itemIcons, textures, zoom, dpr, measured) : false;
      if (item !== false) mark = item;
      else if (t === 'custom' && !outlines) { ctx.restore(); continue; }
      else if (t === 'custom') {
        const extra = n.bag?.get('#item_id_aux');
        const text = w * zoom > 30 && h * zoom > 10 ? (n.props.renderer || 'custom').replace(/_renderer$/, '') + (extra && extra.v !== undefined ? ` ${extra.v}` : '') : '';
        mark = { cls: 'renderer', title: n.props.renderer || 'custom', text };
      }
    }
    ctx.restore();
    const boxed = (outlines && !drawable) || n.uid === selectedUid;
    if (!mark && visible && !n.props.debug && !boxed) continue;
    const el = document.createElement('div');
    el.className = 'ctl';
    el.dataset.uid = n.uid;
    Object.assign(el.style, { left: `${x * zoom}px`, top: `${y * zoom}px`, width: `${Math.max(0, w) * zoom}px`, height: `${Math.max(0, h) * zoom}px` });
    if (clipped) el.style.clipPath = `inset(${inset.map((v) => `${v * zoom}px`).join(' ')})`;
    if (!visible) el.classList.add('hidden-ctl');
    else if (alpha < 1) el.style.opacity = String(Math.max(0, alpha));
    if (mark) {
      el.classList.add(mark.cls);
      if (mark.title) el.title = mark.title;
      if (mark.text) el.textContent = mark.text;
    }
    if (n.props.debug) el.style.outline = `1px solid ${n.props.debug}`;
    if (outlines && !drawable) el.classList.add('outline');
    if (n.uid === selectedUid) el.classList.add('selected');
    stage.append(el);
  }
  stage.onclick = (e) => {
    const uid = pickAt(stage, e, items, zoom, showHidden);
    if (uid) onPick?.(uid, e);
  };
  stage.onmousemove = (e) => onHover?.(stagePoint(stage, e, zoom));
  stage.onmouseleave = () => onHover?.(null);
}

export function stagePoint(stage, e, zoom) {
  const r = stage.getBoundingClientRect();
  return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
}

function pickAt(stage, e, items, zoom, showHidden) {
  const { x: px, y: py } = stagePoint(stage, e, zoom);
  let best = null;
  for (const n of items) {
    if (!n.effVisible && !showHidden) continue;
    const { x, y, w, h } = n.rect;
    if (px >= x && py >= y && px < x + w && py < y + h && w > 0 && h > 0) {
      if (!best || n.layerAbs > best.layerAbs || (n.layerAbs === best.layerAbs && n.drawOrder > best.drawOrder)) best = n;
    }
  }
  return best ? best.uid : null;
}

const FP_SLACK = 1e-6;
export const snapRect = ({ x, y, w, h }) => ({ x: Math.trunc(x + FP_SLACK), y: Math.trunc(y + FP_SLACK), w: Math.ceil(w - FP_SLACK), h: Math.ceil(h - FP_SLACK) });

function drawImage(ctx, n, textures, k, measured) {
  const tex = n.eff?.texture;
  if (!tex) return null;
  const color = css(n.eff?.color ?? n.props.color);
  const info = textures(tex);
  const { x, y, w, h } = n.rect;
  const box = snapRect({ x: x * k, y: y * k, w: w * k, h: h * k });
  const direction = n.props.clip_direction, ratio = n.eff?.clip_ratio ?? 1;
  if (clipDirection(direction) && ratio >= 1) return null;
  const cutting = clipDirection(direction) && ratio > 0;
  const white = /\/(White|white)$/.test(tex);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!info) {
    if (white || /\/Black$/.test(tex)) {
      const d = cutting ? clipCut(box, box, direction, ratio, false).dest : box;
      const r = snapRect(d);
      ctx.fillStyle = white ? color || '#fff' : '#000';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      return null;
    }
    return { cls: 'missing', title: t('{tex} (no texture)', { tex }) };
  }
  if (info.format) return { cls: 'missing', title: t('{tex}{format} (the browser cannot draw this format)', { tex, format: info.format }) };
  const img = imageOf(info.url);
  if (!img) return null;
  const pic = shaded(img, color && !white ? color : null, n.props.grayscale === true);
  ctx.imageSmoothingEnabled = n.props.bilinear === true;
  const src = uvRect(n.eff?.uv ?? n.props.uv, n.eff?.uv_size ?? n.props.uv_size, img.naturalWidth, img.naturalHeight);
  const paint = (s, d, snap = true) => {
    const r = snap ? snapRect(d) : d;
    if (!(r.w > 0 && r.h > 0 && s.w && s.h)) return;
    ctx.drawImage(pic, Math.min(s.x, s.x + s.w), Math.min(s.y, s.y + s.h), Math.abs(s.w), Math.abs(s.h), r.x, r.y, r.w, r.h);
  };
  const nine = nineSlices(n.props.nineslice_size, info.nineslice);
  if (nine) {
    for (const p of ninePieces(box, src, nine.slices, nine.base, k, measured)) paint(p.src, p.dest, false);
    return null;
  }
  const axes = tileAxes(n.props.tiled);
  const [tsx, tsy] = Array.isArray(n.props.tiled_scale) ? n.props.tiled_scale.map(Number) : [1, 1];
  const tile = () => tileCells(box, src, axes, src.w * tsx * k, src.h * tsy * k).forEach((c) => paint(c.src, c.dest));
  if (cutting) {
    const cut = clipCut(box, src, direction, ratio, n.props.clip_pixelperfect !== false);
    if (axes) {
      const r = snapRect(cut.dest);
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      tile();
    } else paint(cut.src, cut.dest);
  } else if (axes) tile();
  else if (n.props.fill === true) paint(fillSource(src, box.w, box.h), box);
  else if (n.props.keep_ratio !== false) paint(src, keepRatioRect(box, src.w, src.h));
  else paint(src, box);
  return null;
}

export function uvRect(uv, uvSize, iw, ih) {
  const [u, v] = Array.isArray(uv) ? [Number(uv[0]) || 0, Number(uv[1]) || 0] : [0, 0];
  const [uw, vh] = Array.isArray(uvSize) ? [Number(uvSize[0]) || 0, Number(uvSize[1]) || 0] : [0, 0];
  return uw || vh ? { x: u, y: v, w: uw, h: vh } : { x: u, y: v, w: iw, h: ih };
}

const CLIP_DIRECTIONS = { left: 1, right: 2, up: 3, down: 4, center: 5 };
export const clipDirection = (d) => CLIP_DIRECTIONS[d] ?? 0;

export function clipCut(dest, src, direction, ratio, pixelPerfect = true) {
  const dir = clipDirection(direction);
  if (!dir || !(ratio > 0)) return { dest, src };
  if (ratio >= 1) return null;
  const axisRatio = (len) => (pixelPerfect && len > 0 ? Math.floor(ratio * len) / len : ratio);
  const shift = dir === 2 || dir === 4 ? 1 : dir === 5 ? 0.5 : 0;
  const out = { dest: { ...dest }, src: { ...src } };
  const cut = (pos, size, r) => {
    for (const rect of [out.dest, out.src]) {
      rect[pos] += rect[size] * r * shift;
      rect[size] *= 1 - r;
    }
  };
  if (dir === 1 || dir === 2 || dir === 5) cut('x', 'w', axisRatio(Math.abs(src.w)));
  if (dir === 3 || dir === 4 || dir === 5) cut('y', 'h', axisRatio(Math.abs(src.h)));
  return out;
}

const EPSILON = 1.1920929e-7;

export function keepRatioRect(dest, uw, vh) {
  const fx = dest.w / uw, fy = dest.h / vh;
  if (!(Math.abs(fx - fy) > EPSILON)) return dest;
  const f = Math.min(fx, fy), w = uw * f, h = vh * f;
  return { x: dest.x + (dest.w - w) * 0.5, y: dest.y + (dest.h - h) * 0.5, w, h };
}

export function fillSource(src, w, h) {
  if (!(w > 0 && h > 0 && src.w && src.h)) return src;
  const aspect = w / h;
  if (src.w / src.h > aspect) {
    const sw = src.h * aspect;
    return { ...src, x: src.x + (src.w - sw) * 0.5, w: sw };
  }
  const sh = src.w / aspect;
  return { ...src, y: src.y + (src.h - sh) * 0.5, h: sh };
}

export const tileAxes = (t) => (t === true ? 3 : { x: 1, y: 2, xy: 3, yx: 3 }[t] ?? 0);

const MAX_TILES = 100000;

export function tileCells(dest, src, axes, cellW, cellH) {
  const cw = axes === 2 ? dest.w : cellW, ch = axes === 1 ? dest.h : cellH;
  if (!(cw > 0 && ch > 0)) return [];
  if ((dest.w / cw) * (dest.h / ch) > MAX_TILES) return [{ dest, src }];
  const cells = [];
  for (let ty = 0; ty < dest.h; ty += ch) {
    const fy = Math.min(1, (dest.h - ty) / ch);
    for (let tx = 0; tx < dest.w; tx += cw) {
      const fx = Math.min(1, (dest.w - tx) / cw);
      cells.push({ dest: { x: dest.x + tx, y: dest.y + ty, w: cw * fx, h: ch * fy }, src: { x: src.x, y: src.y, w: src.w * fx, h: src.h * fy } });
    }
  }
  return cells;
}

const sliceArray = (v) => (typeof v === 'number' ? [v, v, v, v] : Array.isArray(v) && v.length === 4 ? v.map(Number) : null);

export function nineSlices(controlSlices, sidecar) {
  const side = sidecar && !sidecar.meta ? sidecar : null;
  const own = sliceArray(controlSlices);
  const slices = own && own.some((v) => v) ? own : sliceArray(side?.nineslice_size);
  if (!slices) return null;
  const base = Array.isArray(side?.base_size) && side.base_size.length >= 2 ? side.base_size.map(Number) : null;
  return { slices, base };
}

export function ninePieces(dest, src, [l, t, r, b], base, k = 1, measured = false) {
  const kx = base?.[0] ? src.w / base[0] : 1, ky = base?.[1] ? src.h / base[1] : 1;
  let [sl, sr] = dest.w > 0 ? [l, r] : [0, 0], [st, sb] = dest.h > 0 ? [t, b] : [0, 0];
  if (measured && (sl + sr) * kx >= src.w) sl = sr = 0;
  if (measured && (st + sb) * ky >= src.h) st = sb = 0;
  const sx = [src.x, src.x + sl * kx, src.x + src.w - sr * kx, src.x + src.w];
  const sy = [src.y, src.y + st * ky, src.y + src.h - sb * ky, src.y + src.h];
  const dx = [dest.x, dest.x + sl * k, dest.x + dest.w - sr * k, dest.x + dest.w];
  const dy = [dest.y, dest.y + st * k, dest.y + dest.h - sb * k, dest.y + dest.h];
  const pieces = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const d = { x: dx[i], y: dy[j], w: dx[i + 1] - dx[i], h: dy[j + 1] - dy[j] };
      const s = { x: sx[i], y: sy[j], w: sx[i + 1] - sx[i], h: sy[j + 1] - sy[j] };
      if (d.w > 0 && d.h > 0 && s.w && s.h) pieces.push({ dest: d, src: s });
    }
  }
  return pieces;
}

function drawGradient(ctx, n) {
  const { x, y, w, h } = n.rect;
  const horizontal = n.props.gradient_direction === 'horizontal';
  const g = ctx.createLinearGradient(x, y, horizontal ? x + w : x, horizontal ? y : y + h);
  g.addColorStop(0, css(n.props.color1) || '#fff');
  g.addColorStop(1, css(n.props.color2) || '#fff');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

function clipInset({ x, y, w, h }, c) {
  return [Math.max(0, c.y - y), Math.max(0, x + w - (c.x + c.w)), Math.max(0, y + h - (c.y + c.h)), Math.max(0, c.x - x)];
}

// #item_id_aux = numeric ID × 65536 + data (ANI-06); the atlas maps the ID to its icon textures.
function drawItem(ctx, n, items, textures, zoom, dpr, measured) {
  const v = n.bag?.get('#item_id_aux') ?? n.bag?.get('#item_renderer_data');
  if (!v || (v.k !== 'int' && v.k !== 'num')) return false;
  const aux = Math.trunc(v.v);
  if (aux === -1 || aux === 0) return null; // empty slot
  const id = Math.floor(aux / 65536);
  const entry = items(id);
  const title = entry ? `${entry.n} (#item_id_aux ${aux})` : `#item_id_aux ${aux}`;
  if (!entry || (!entry.t && !entry.b && !entry.p && !entry.m)) return { cls: 'renderer', title, text: entry ? entry.n : String(id) };
  // The icon fills the renderer's square, centred (measured in game 2026-10-23: a book in a 22 px
  // card renderer at GUI scale 4 is 88 screen px wide, 5.5 px per texel, not rounded down to 5).
  // The CN model follows the client code: width / 16 per texel from the top-left corner.
  const s = (measured ? Math.min(n.rect.w, n.rect.h) : n.rect.w) * zoom;
  const bx = n.rect.x * zoom + (measured ? (n.rect.w * zoom - s) / 2 : 0), by = n.rect.y * zoom + (measured ? (n.rect.h * zoom - s) / 2 : 0);
  const image = (p) => { const u = textures(p)?.url; return u ? imageOf(u) : null; };
  const face = (src, [sx, sy, sw, sh], dw, dh, ua, va, o) => {
    ctx.setTransform(dpr * ua[0], dpr * ua[1], dpr * va[0], dpr * va[1], dpr * (bx + o[0]), dpr * (by + o[1]));
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  };
  if (entry.t) {
    const img = image(entry.t);
    if (img) {
      const f = Math.min(s / img.naturalWidth, s / img.naturalHeight), dw = img.naturalWidth * f;
      const snap = (v) => Math.round(v * dpr);
      const x0 = snap(bx + (s - dw) / 2), y0 = snap(by);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(img, x0, y0, snap(bx + (s + dw) / 2) - x0, snap(by + img.naturalHeight * f) - y0);
    }
    return null;
  }
  // The block cell seen by an orthographic camera turned 45° and tilted 30°, its centre on the
  // icon's centre (measured in game 2026-10-23: edges climb 1 px per 2 px across; a full cube is
  // 7/8 of the icon wide and 0.97 of it tall; a slab sits where the cube's lower half would).
  // Model space is in texels, 0..16: a runs along the left face (west side), b along the right
  // face (front) away from the viewer, y up.
  const c45 = Math.SQRT1_2, s30 = 0.5, c30 = Math.sqrt(3) / 2;
  // A model smaller than the block is drawn bigger, fitted by its bounding sphere and centred
  // (sphereFit): a pane's 16×16×2 plate 1.22 times (measured: glass_pane 38×61 px, not 31×50).
  const k = ((7 / 8) * s) / (32 * c45) * (entry.p ? sphereFit([[0, 0, 7], [16, 16, 9]]) : 1); // px per texel
  const ea = [k * c45, k * c45 * s30], eb = [k * c45, -k * c45 * s30], ey = [0, -k * c30];
  const at = (a, y, b) => [0, 1].map((i) => s / 2 + (a - 8) * ea[i] + (y - 8) * ey[i] + (b - 8) * eb[i]);
  const down = [-ey[0], -ey[1]];
  if (entry.m) {
    // a block's own model (engine/geometry.js): its -z runs along the left face toward the front
    // corner, its -x away along the right face
    entry.m.faces ||= modelFaces(entry.m.geo);
    entry.m.bounds ||= modelBounds(entry.m.geo);
    const [lo, hi] = entry.m.bounds, f = sphereFit(entry.m.bounds), mid = [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2);
    const ma = ea.map((v) => v * f), mb = eb.map((v) => v * f), my = ey.map((v) => v * f);
    const pt = (p) => [0, 1].map((i) => s / 2 - (p[2] - mid[2]) * ma[i] + (p[1] - mid[1]) * my[i] - (p[0] - mid[0]) * mb[i]);
    const dir = (d) => [0, 1].map((i) => -d[2] * ma[i] + d[1] * my[i] - d[0] * mb[i]);
    const { tw, th } = entry.m.geo;
    for (const fc of entry.m.faces) {
      const tex = entry.m.tex[fc.material] ?? entry.m.tex['*'];
      const img = tex && image(tex);
      if (!img) continue;
      const [fu, fv, fw, fh] = fc.uv;
      const u0 = Math.min(fu, fu + fw), v0 = Math.min(fv, fv + fh);
      const kx = img.naturalWidth / tw, ky = img.naturalHeight / th;
      const o = pt(fc.o.map((c, i) => c + (u0 - fu) * fc.u[i] + (v0 - fv) * fc.v[i]));
      face(img, [u0 * kx, v0 * ky, Math.abs(fw) * kx, Math.abs(fh) * ky], Math.abs(fw), Math.abs(fh), dir(fc.u), dir(fc.v), o);
    }
    return null;
  }
  const h = entry.h ?? 16;
  // the sides are darker than the top: 0.73 on the left, 0.5 on the right for vanilla blocks
  // (measured in game 2026-10-23 on a furnace and a chest); a server's own blocks, cube or model,
  // are not darkened (a research table and a drawer: all three faces as bright as the texture)
  const [lt, lr] = entry.unlit ? [1, 1] : [0.73, 0.5];
  // [texture, u axis, v axis, model point of texel (0, 0), light, texel crop [u0, u1, v0, v1]]
  const faces = entry.p
    // a pane is the plate between b = 7 and 9: its left face, then its top and right edges,
    // whose columns 7..9 of the edge texture are the plate's thickness
    ? [[entry.p[0], ea, down, at(0, 16, 7), lt], [entry.p[1], eb, ea, at(0, 16, 0), 1, [7, 9, 0, 16]], [entry.p[1], eb, down, at(16, 16, 0), lr, [7, 9, 0, 16]]]
    // a slab's sides show the lower rows of the side texture, as in the world
    : [[entry.b[0], eb, ea, at(0, h, 0), 1], [entry.b[1], ea, down, at(0, 16, 0), lt, [0, 16, 16 - h, 16]], [entry.b[2], eb, down, at(16, 16, 0), lr, [0, 16, 16 - h, 16]]];
  for (const [tex, ua, va, o, light, [u0, u1, v0, v1] = [0, 16, 0, 16]] of faces) {
    const img = image(tex);
    if (!img) continue;
    const kt = img.naturalWidth / 16, gray = Math.round(light * 255);
    const src = light < 1 ? shaded(img, `rgb(${gray},${gray},${gray})`, false) : img;
    face(src, [u0 * kt, v0 * kt, (u1 - u0) * kt, (v1 - v0) * kt], u1 - u0, v1 - v0, ua, va, [o[0] + u0 * ua[0] + v0 * va[0], o[1] + u0 * ua[1] + v0 * va[1]]);
  }
  return null;
}

const plainGlyphs = (ctx, text, zoom) => (String(text).match(/§.|[\s\S]/gu) || []).map((ch) => (ch[0] === '§' && ch.length > 1 ? { ch, w: 0, code: true } : { ch, w: ctx.measureText(ch).width / zoom }));

// Draws the lines the layout broke, each glyph in the advance the font metrics gave it, so line
// breaks and text extents are the layout's (the glyph shapes come from the browser's font).
function drawLabel(ctx, n, zoom, dpr) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const scale = n.fontScale ?? 1;
  const lineH = 10 * scale * zoom;
  const font = (bold) => `${bold ? '700 ' : ''}${8 * scale * zoom}px ${FONT_FAMILY}`;
  ctx.font = font(false);
  const m = ctx.measureText('M');
  const ascent = Math.round(m.fontBoundingBoxAscent), descent = Math.round(m.fontBoundingBoxDescent);
  const baseline = Math.floor((lineH - ascent - descent) / 2) + ascent;
  const step = (10 + (n.linePadding ?? 0)) * scale * zoom;
  const paint = labelPaint(n);
  ctx.globalAlpha *= paint.alpha;
  const base = paint.color;
  const align = n.props.text_alignment || 'left';
  const lines = n.textLines || [{ text: n.eff?.text ?? '', w: 0, glyphs: null }];
  const shadow = n.props.shadow ? (n.textUnicode ? 0.5 : 1) * scale * zoom : 0;
  let state = { color: base, bold: false };
  lines.forEach((line, row) => {
    const offset = align === 'center' ? (n.rect.w - line.w) / 2 : align === 'right' ? n.rect.w - line.w : 0;
    const gx = (n.rect.x + Math.max(0, offset)) * zoom;
    const gy = (n.rect.y + 1) * zoom + row * step + baseline;
    const glyphs = line.glyphs ?? plainGlyphs(ctx, line.text, zoom);
    if (shadow) drawGlyphs(ctx, glyphs, gx + shadow, gy + shadow, state, base, font, zoom, shadowCss);
    state = drawGlyphs(ctx, glyphs, gx, gy, state, base, font, zoom, rgbaCss);
  });
}

function drawGlyphs(ctx, glyphs, x, y, state, base, font, zoom, paint) {
  const s = { ...state };
  for (const g of glyphs) {
    if (g.code) { applyCode(s, g.ch[1], base); continue; }
    ctx.font = font(s.bold);
    ctx.fillStyle = paint(s.color);
    ctx.fillText(g.ch, x, y);
    x += g.w * zoom;
  }
  return s;
}

const rgbaOf = (c) => {
  if (Array.isArray(c)) {
    const [r, g, b, a = 1] = c.map(Number);
    return [r * 255, g * 255, b * 255, a];
  }
  if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(1);
  return null;
};
const rgbaCss = ([r, g, b, a], k = 1) => `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`;
export const shadowCss = (rgba) => rgbaCss(rgba, 0.25);

export function applyCode(state, c, base) {
  if (c === 'l') state.bold = true;
  else if (c === 'r') { state.color = base; state.bold = false; }
  else if (COLOR_CODES[c]) state.color = [...rgbaOf(COLOR_CODES[c]).slice(0, 3), base[3]];
}

export function labelPaint(n) {
  let locked = false;
  for (let p = n; p; p = p.parent) if (p.eff?.enabled === false) locked = true;
  const color = rgbaOf(n.eff?.color ?? n.props.color) || [255, 255, 255, 1];
  if (!locked) return { color, alpha: 1 };
  return { color: rgbaOf(n.props.locked_color) || color, alpha: typeof n.props.locked_alpha === 'number' ? n.props.locked_alpha : 1 };
}
