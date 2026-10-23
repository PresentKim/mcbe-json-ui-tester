// DOM renderer for a laid-out control tree.
import { walk } from './engine/bind.js';

const COLOR_CODES = {
  0: '#000000', 1: '#0000AA', 2: '#00AA00', 3: '#00AAAA', 4: '#AA0000', 5: '#AA00AA', 6: '#FFAA00', 7: '#AAAAAA',
  8: '#555555', 9: '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
  g: '#DDD605', h: '#E3D4D1', i: '#CECACA', j: '#443A3B', m: '#971607', n: '#B4684D', p: '#DEB12D', q: '#47A036',
  s: '#2CBAA8', t: '#21497B', u: '#9A5CC6', v: '#EB7114', w: '#5FB4DC',
};

const css = (c) => {
  if (Array.isArray(c)) {
    const [r, g, b, a = 1] = c.map(Number);
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
  }
  if (typeof c === 'string' && c.startsWith('#')) return c;
  return null;
};

export function formatText(text, base) {
  const frag = document.createDocumentFragment();
  let color = base, bold = false, italic = false;
  const parts = String(text).split(/(§.)/);
  for (const part of parts) {
    if (/^§.$/.test(part)) {
      const c = part[1].toLowerCase();
      if (COLOR_CODES[c]) { color = COLOR_CODES[c]; bold = false; italic = false; }
      else if (c === 'l') bold = true;
      else if (c === 'o') italic = true;
      else if (c === 'r') { color = base; bold = false; italic = false; }
      continue;
    }
    if (!part) continue;
    const span = document.createElement('span');
    span.textContent = part;
    if (color) span.style.color = color;
    if (bold) span.style.fontWeight = '700';
    if (italic) span.style.fontStyle = 'italic';
    frag.append(span);
  }
  return frag;
}

// textures: (path) -> { url, nineslice?: { nineslice_size, base_size } } | null
export function renderTree(stage, root, { zoom, textures, items: itemIcons, outlines, showHidden, selectedUid, onPick, onHover }) {
  stage.textContent = '';
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
    const isItem = t === 'custom' && /item_renderer$/.test(n.props.renderer || '');
    const drawable = t === 'image' || t === 'label' || isItem || (t === 'custom' && outlines) || n.props.debug;
    const showBox = outlines || n.uid === selectedUid;
    if (!drawable && !showBox) continue;
    const { x, y, w, h } = n.rect;
    const el = document.createElement('div');
    el.className = 'ctl';
    el.dataset.uid = n.uid;
    Object.assign(el.style, { left: `${x * zoom}px`, top: `${y * zoom}px`, width: `${Math.max(0, w) * zoom}px`, height: `${Math.max(0, h) * zoom}px` });
    if (n.clip) {
      const c = n.clip;
      const top = Math.max(0, c.y - y), left = Math.max(0, c.x - x);
      const right = Math.max(0, x + w - (c.x + c.w)), bottom = Math.max(0, y + h - (c.y + c.h));
      el.style.clipPath = `inset(${top * zoom}px ${right * zoom}px ${bottom * zoom}px ${left * zoom}px)`;
    }
    const alpha = alphaOf(n);
    if (!visible) el.classList.add('hidden-ctl');
    else if (alpha < 1) el.style.opacity = String(Math.max(0, alpha));
    if (t === 'image') { drawImage(el, n, textures, zoom); clipRatio(el, n); }
    else if (t === 'label') drawLabel(el, n, zoom);
    else if (t === 'custom' && /item_renderer$/.test(n.props.renderer || '') && itemIcons && drawItem(el, n, itemIcons, textures, zoom)) {
      /* drawn as the item's icon */
    } else if (t === 'custom' && !outlines) {
      continue;
    } else if (t === 'custom') {
      el.classList.add('renderer');
      const extra = n.bag?.get('#item_id_aux');
      el.title = n.props.renderer || 'custom';
      if (w * zoom > 30 && h * zoom > 10) el.textContent = (n.props.renderer || 'custom').replace(/_renderer$/, '') + (extra && extra.v !== undefined ? ` ${extra.v}` : '');
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

function drawImage(el, n, textures, zoom) {
  const tex = n.eff?.texture;
  el.classList.add('image');
  const color = css(n.eff?.color ?? n.props.color);
  const info = tex ? textures(tex) : null;
  if (!tex) { el.classList.add('empty'); return; }
  if (!info) {
    if (/\/(White|white)$/.test(tex)) el.style.background = color || '#fff';
    else if (/\/Black$/.test(tex)) el.style.background = '#000';
    else { el.classList.add('missing'); el.title = `${tex} (텍스처 없음)`; }
    return;
  }
  el.title = tex;
  const ns = info.nineslice;
  if (ns && ns.nineslice_size !== undefined && info.w) {
    // nineslice_size is in base_size units (the sidecar's texture size), not image pixels (LAY-27)
    const s = Array.isArray(ns.nineslice_size) ? ns.nineslice_size : [ns.nineslice_size, ns.nineslice_size, ns.nineslice_size, ns.nineslice_size];
    const base = Array.isArray(ns.base_size) ? ns.base_size : ns.base_size ? [ns.base_size, ns.base_size] : [info.w, info.h];
    const kx = info.w / base[0], ky = info.h / base[1];
    // nineslice_size order is [left, top, right, bottom]; CSS wants top right bottom left
    const sl = [s[1] * ky, s[2] * kx, s[3] * ky, s[0] * kx];
    const width = [s[1], s[2], s[3], s[0]].map((v) => `${v * zoom}px`).join(' ');
    el.style.borderStyle = 'solid';
    el.style.borderWidth = width;
    el.style.borderImage = `url("${info.url}") ${sl.join(' ')} fill / ${width} stretch`;
    el.style.boxSizing = 'border-box';
  } else if (ns && ns.nineslice_size !== undefined) {
    return; // drawn once the image size is known
  } else {
    el.style.backgroundImage = `url("${info.url}")`;
    const tiled = n.props.tiled;
    if (tiled === true || tiled === 'x' || tiled === 'y') {
      el.style.backgroundRepeat = tiled === true ? 'repeat' : tiled === 'x' ? 'repeat-x' : 'repeat-y';
      el.style.backgroundSize = info.w ? `${info.w * zoom}px ${info.h * zoom}px` : 'auto';
    } else if (n.props.keep_ratio !== false && n.props.fill !== true && info.w) {
      el.style.backgroundSize = 'contain';
      el.style.backgroundRepeat = 'no-repeat';
      el.style.backgroundPosition = 'center';
      el.style.backgroundSize = '100% 100%';
    } else {
      el.style.backgroundSize = '100% 100%';
    }
    if (Array.isArray(n.props.uv) && Array.isArray(n.props.uv_size) && info.w) {
      const [u, v] = n.props.uv, [uw, vh] = n.props.uv_size;
      const sx = (n.rect.w * zoom) / uw, sy = (n.rect.h * zoom) / vh;
      el.style.backgroundSize = `${info.w * sx}px ${info.h * sy}px`;
      el.style.backgroundPosition = `${-u * sx}px ${-v * sy}px`;
    }
  }
  if (color && !/\/(White|white)$/.test(tex)) {
    el.style.backgroundColor = color;
    el.style.backgroundBlendMode = 'multiply';
    el.style.webkitMaskImage = `url("${info.url}")`;
    el.style.webkitMaskSize = '100% 100%';
  }
}

// clip_ratio is the part cut away, measured from the clip_direction side (ANI-03, CN-54)
function clipRatio(el, n) {
  const ratio = n.eff?.clip_ratio ?? 0;
  if (!(ratio > 0)) return;
  const pct = Math.min(1, ratio) * 100;
  const inset = { left: `0 ${pct}% 0 0`, right: `0 0 0 ${pct}%`, up: `0 0 ${pct}% 0`, down: `${pct}% 0 0 0` }[n.props.clip_direction || 'left'];
  if (inset) el.style.clipPath = `inset(${inset})`;
}

// #item_id_aux = numeric ID × 65536 + data (ANI-06); the atlas maps the ID to its icon textures.
function drawItem(el, n, items, textures, zoom) {
  const v = n.bag?.get('#item_id_aux') ?? n.bag?.get('#item_renderer_data');
  if (!v || (v.k !== 'int' && v.k !== 'num')) return false;
  const aux = Math.trunc(v.v);
  if (aux === -1 || aux === 0) return true; // empty slot
  const id = Math.floor(aux / 65536);
  const entry = items(id);
  el.title = entry ? `${entry.n} (#item_id_aux ${aux})` : `#item_id_aux ${aux}`;
  if (!entry || (!entry.t && !entry.b && !entry.p)) {
    el.classList.add('renderer');
    el.textContent = entry ? entry.n : String(id);
    return true;
  }
  // Icons are 16 texels drawn at a whole number of screen pixels per texel: a 22 px renderer at
  // GUI scale 4 is 88 screen px, 5 px per texel, so the icon is 80 px (20 GUI px), centred.
  const avail = Math.min(n.rect.w, n.rect.h) * zoom;
  const s = 16 * Math.max(1, Math.floor(avail / 16 + 1e-6));
  const box = document.createElement('div');
  box.className = 'item-icon';
  Object.assign(box.style, { width: `${s}px`, height: `${s}px`, left: `${(n.rect.w * zoom - s) / 2}px`, top: `${(n.rect.h * zoom - s) / 2}px` });
  const url = (p) => textures(p)?.url;
  if (entry.t) {
    const u = url(entry.t);
    if (u) box.style.backgroundImage = `url("${u}")`;
  } else {
    // The block cell seen by an orthographic camera turned 45° and tilted 30°, its centre on the
    // icon's centre (measured in game 2026-10-23: edges climb 1 px per 2 px across; a full cube is
    // 7/8 of the icon wide and 0.97 of it tall; a slab sits where the cube's lower half would).
    // Model space is in texels, 0..16: a runs along the left face (west side), b along the right
    // face (front) away from the viewer, y up.
    const c45 = Math.SQRT1_2, s30 = 0.5, c30 = Math.sqrt(3) / 2;
    // A pane is drawn 1.22 times bigger than the cell (measured: glass_pane 38×61 px where its
    // plate at this camera would be 31×50). Why is not known; it equals the ratio of the cube's
    // bounding sphere to the plate's, but a slab is not scaled up that way.
    const k = ((7 / 8) * s) / (32 * c45) * (entry.p ? 1.22 : 1); // px per texel
    const ea = [k * c45, k * c45 * s30], eb = [k * c45, -k * c45 * s30], ey = [0, -k * c30];
    const at = (a, y, b) => [0, 1].map((i) => s / 2 + (a - 8) * ea[i] + (y - 8) * ey[i] + (b - 8) * eb[i]);
    const down = [-ey[0], -ey[1]];
    const h = entry.h ?? 16;
    // [texture, u axis, v axis, model point of texel (0, 0), light, texel crop [u0, u1, v0, v1]]
    const faces = entry.p
      // a pane is the plate between b = 7 and 9: its left face, then its top and right edges,
      // whose columns 7..9 of the edge texture are the plate's thickness
      ? [[entry.p[0], ea, down, at(0, 16, 7), 0.8], [entry.p[1], eb, ea, at(0, 16, 0), 1, [7, 9, 0, 16]], [entry.p[1], eb, down, at(16, 16, 0), 0.6, [7, 9, 0, 16]]]
      // a slab's sides show the lower rows of the side texture, as in the world
      : [[entry.b[0], eb, ea, at(0, h, 0), 1], [entry.b[1], ea, down, at(0, 16, 0), 0.8, [0, 16, 16 - h, 16]], [entry.b[2], eb, down, at(16, 16, 0), 0.6, [0, 16, 16 - h, 16]]];
    for (const [tex, ua, va, o, light, [u0, u1, v0, v1] = [0, 16, 0, 16]] of faces) {
      const f = document.createElement('div');
      f.className = 'cube-face';
      const u = url(tex);
      if (u) f.style.backgroundImage = `url("${u}")`;
      Object.assign(f.style, { width: `${u1 - u0}px`, height: `${v1 - v0}px`, backgroundPosition: `${-u0}px ${-v0}px` });
      f.style.transform = `matrix(${ua[0]},${ua[1]},${va[0]},${va[1]},${o[0] + u0 * ua[0] + v0 * va[0]},${o[1] + u0 * ua[1] + v0 * va[1]})`;
      f.style.filter = light < 1 ? `brightness(${light})` : '';
      box.append(f);
    }
  }
  el.append(box);
  return true;
}

// Draws the lines the layout broke, each glyph in the advance the font metrics gave it, so line
// breaks and text extents are the layout's (the glyph shapes come from the browser's font).
function drawLabel(el, n, zoom) {
  el.classList.add('label');
  const scale = n.fontScale ?? 1;
  el.style.fontSize = `${8 * scale * zoom}px`;
  el.style.lineHeight = `${10 * scale * zoom}px`;
  const base = css(n.eff?.color ?? n.props.color) || '#ffffff';
  el.style.color = base;
  if (n.props.shadow) el.style.textShadow = `${zoom}px ${zoom}px 0 rgba(0,0,0,.6)`;
  const align = n.props.text_alignment || 'left';
  const lines = n.textLines || [{ text: n.eff?.text ?? '', w: 0, glyphs: null }];
  let color = base, bold = false;
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'line';
    row.style.height = `${10 * scale * zoom}px`;
    const offset = align === 'center' ? (n.rect.w - line.w) / 2 : align === 'right' ? n.rect.w - line.w : 0;
    row.style.paddingLeft = `${Math.max(0, offset) * zoom}px`;
    if (!line.glyphs) { row.append(formatText(line.text, base)); el.append(row); continue; }
    for (const g of line.glyphs) {
      if (g.code) {
        const c = g.ch[1].toLowerCase();
        if (COLOR_CODES[c]) { color = COLOR_CODES[c]; bold = false; }
        else if (c === 'l') bold = true;
        else if (c === 'r') { color = base; bold = false; }
        continue;
      }
      const span = document.createElement('span');
      span.className = 'glyph';
      span.textContent = g.ch;
      span.style.width = `${g.w * zoom}px`;
      if (color !== base) span.style.color = color;
      if (bold) span.style.fontWeight = '700';
      row.append(span);
    }
    el.append(row);
  }
  const text = n.eff?.text || '';
  if (n.props.localize !== false && /^[a-z0-9_.-]+$/i.test(text) && text.includes('.')) el.classList.add('lang-key');
}
