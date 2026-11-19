// Canvas renderer for a laid-out control tree; a DOM overlay above it carries the inspection boxes.
import { walk } from './engine/bind.js';
import { modelFaces, modelBounds, sphereFit } from './engine/geometry.js';
import { rendererOf } from './engine/controls.js';

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
  const { zoom, textures, items: itemIcons, outlines, showHidden, selectedUid, onPick, onHover } = opts;
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
    const drawable = t === 'image' || t === 'label' || isItem || (t === 'custom' && outlines) || n.props.debug;
    const showBox = outlines || n.uid === selectedUid;
    if (!drawable && !showBox) continue;
    const { x, y, w, h } = n.rect;
    const inset = n.clip ? clipInset(n.rect, n.clip) : [0, 0, 0, 0];
    if (t === 'image') ratioInset(n).forEach((v, i) => { inset[i] = Math.max(inset[i], v); });
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
    if (t === 'image') mark = drawImage(ctx, n, textures, k);
    else if (t === 'label') drawLabel(ctx, n, zoom, dpr);
    else {
      const item = isItem && itemIcons ? drawItem(ctx, n, itemIcons, textures, zoom, dpr) : false;
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
  stage.onmousemove = (e) => onHover?.(pickAt(stage, e, items, zoom, showHidden, true));
}

function pickAt(stage, e, items, zoom, showHidden, buttonsOnly) {
  const r = stage.getBoundingClientRect();
  const px = (e.clientX - r.left) / zoom, py = (e.clientY - r.top) / zoom;
  let best = null;
  for (const n of items) {
    if (!n.effVisible && !showHidden) continue;
    if (buttonsOnly && n.props.type !== 'button' && n.props.type !== 'toggle') continue;
    const { x, y, w, h } = n.rect;
    if (px >= x && py >= y && px < x + w && py < y + h && w > 0 && h > 0) {
      if (!best || n.layerAbs > best.layerAbs || (n.layerAbs === best.layerAbs && n.drawOrder > best.drawOrder)) best = n;
    }
  }
  return best ? best.uid : null;
}

function drawImage(ctx, n, textures, k) {
  const tex = n.eff?.texture;
  if (!tex) return null;
  const color = css(n.eff?.color ?? n.props.color);
  const info = textures(tex);
  const { x, y, w, h } = n.rect;
  const snap = (v) => Math.round(v * k);
  const box = (bx = x * k, by = y * k, bw = w * k, bh = h * k) => { const x0 = Math.round(bx), y0 = Math.round(by); return [x0, y0, Math.round(bx + bw) - x0, Math.round(by + bh) - y0]; };
  const white = /\/(White|white)$/.test(tex);
  if (!info) {
    if (white || /\/Black$/.test(tex)) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = white ? color || '#fff' : '#000';
      ctx.fillRect(...box());
      return null;
    }
    return { cls: 'missing', title: `${tex} (텍스처 없음)` };
  }
  const img = imageOf(info.url);
  if (!img) return null;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const src = shaded(img, color && !white ? color : null, n.props.grayscale === true);
  ctx.imageSmoothingEnabled = n.props.bilinear === true;
  const ns = info.nineslice;
  if (ns && ns.nineslice_size !== undefined) {
    // nineslice_size is in base_size units (the sidecar's texture size), not image pixels (LAY-27)
    const s = (Array.isArray(ns.nineslice_size) ? ns.nineslice_size : [ns.nineslice_size, ns.nineslice_size, ns.nineslice_size, ns.nineslice_size]).slice();
    const base = Array.isArray(ns.base_size) ? ns.base_size : ns.base_size ? [ns.base_size, ns.base_size] : [iw, ih];
    // Slices that meet or cross on an axis leave nothing but the corners, while the game still
    // covers the whole control with the texture (measured: vanilla ScrollRail, 1×1 with
    // nineslice_size 1, is a solid dark rail in game). That axis is then stretched.
    if (s[0] + s[2] >= base[0]) s[0] = s[2] = 0;
    if (s[1] + s[3] >= base[1]) s[1] = s[3] = 0;
    const kx = iw / base[0], ky = ih / base[1];
    const f = Math.min(1, s[0] + s[2] > 0 ? w / (s[0] + s[2]) : 1, s[1] + s[3] > 0 ? h / (s[1] + s[3]) : 1);
    const sx = [0, s[0] * kx, iw - s[2] * kx, iw], sy = [0, s[1] * ky, ih - s[3] * ky, ih];
    const dx = [x, x + s[0] * f, x + w - s[2] * f, x + w].map(snap), dy = [y, y + s[1] * f, y + h - s[3] * f, y + h].map(snap);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (sx[i + 1] <= sx[i] || sy[j + 1] <= sy[j] || dx[i + 1] <= dx[i] || dy[j + 1] <= dy[j]) continue;
        ctx.drawImage(src, sx[i], sy[j], sx[i + 1] - sx[i], sy[j + 1] - sy[j], dx[i], dy[j], dx[i + 1] - dx[i], dy[j + 1] - dy[j]);
      }
    }
    return null;
  }
  const tiled = n.props.tiled;
  const repeat = { x: 'repeat-x', y: 'repeat-y', xy: 'repeat', yx: 'repeat' }[tiled] ?? (tiled === true ? 'repeat' : null);
  const uv = Array.isArray(n.props.uv) && Array.isArray(n.props.uv_size);
  if (repeat && !uv) {
    const pattern = ctx.createPattern(src, repeat);
    pattern.setTransform(new DOMMatrix([1, 0, 0, 1, x, y]));
    ctx.fillStyle = pattern;
    ctx.fillRect(x, y, w, h);
    return null;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (uv) {
    const [u, v] = n.props.uv, [uw, vh] = n.props.uv_size;
    ctx.drawImage(src, u, v, uw, vh, ...box());
  } else if (n.props.keep_ratio !== false) {
    // keep_ratio (on by default) fits the texture inside, centred; with fill it covers and is cut
    // (ANI-23; measured in game: a 6×27 tree strip in a 4×23 image is 4×18, 2.5 px from each end)
    const [bx, by, bw, bh] = box();
    const f = (n.props.fill === true ? Math.max : Math.min)(bw / iw, bh / ih);
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();
    ctx.drawImage(src, ...box(bx + (bw - iw * f) / 2, by + (bh - ih * f) / 2, iw * f, ih * f));
  } else {
    ctx.drawImage(src, ...box());
  }
  return null;
}

// clip_ratio is the part cut away, measured from the clip_direction side (ANI-03, CN-54)
function ratioInset(n) {
  const ratio = n.eff?.clip_ratio ?? 0;
  if (!(ratio > 0)) return [0, 0, 0, 0];
  const r = Math.min(1, ratio), { w, h } = n.rect;
  return { left: [0, r * w, 0, 0], right: [0, 0, 0, r * w], up: [0, 0, r * h, 0], down: [r * h, 0, 0, 0] }[n.props.clip_direction || 'left'] || [0, 0, 0, 0];
}

function clipInset({ x, y, w, h }, c) {
  return [Math.max(0, c.y - y), Math.max(0, x + w - (c.x + c.w)), Math.max(0, y + h - (c.y + c.h)), Math.max(0, c.x - x)];
}

// #item_id_aux = numeric ID × 65536 + data (ANI-06); the atlas maps the ID to its icon textures.
function drawItem(ctx, n, items, textures, zoom, dpr) {
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
  const s = Math.min(n.rect.w, n.rect.h) * zoom;
  const bx = n.rect.x * zoom + (n.rect.w * zoom - s) / 2, by = n.rect.y * zoom + (n.rect.h * zoom - s) / 2;
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
  const base = css(n.eff?.color ?? n.props.color) || '#ffffff';
  const align = n.props.text_alignment || 'left';
  const lines = n.textLines || [{ text: n.eff?.text ?? '', w: 0, glyphs: null }];
  let color = base, bold = false;
  lines.forEach((line, row) => {
    const offset = align === 'center' ? (n.rect.w - line.w) / 2 : align === 'right' ? n.rect.w - line.w : 0;
    let gx = (n.rect.x + Math.max(0, offset)) * zoom;
    const gy = n.rect.y * zoom + row * lineH + baseline;
    for (const g of line.glyphs ?? plainGlyphs(ctx, line.text, zoom)) {
      if (g.code) {
        const c = g.ch[1].toLowerCase();
        if (COLOR_CODES[c]) { color = COLOR_CODES[c]; bold = false; }
        else if (c === 'l') bold = true;
        else if (c === 'r') { color = base; bold = false; }
        continue;
      }
      ctx.font = font(bold);
      if (n.props.shadow) {
        ctx.fillStyle = 'rgba(0,0,0,.6)';
        ctx.fillText(g.ch, gx + zoom, gy + zoom);
      }
      ctx.fillStyle = color;
      ctx.fillText(g.ch, gx, gy);
      gx += g.w * zoom;
    }
  });
}
