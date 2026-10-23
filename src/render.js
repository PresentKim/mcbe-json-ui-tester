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
export function renderTree(stage, root, { zoom, textures, outlines, showHidden, selectedUid, onPick, onHover }) {
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
    const drawable = t === 'image' || t === 'label' || t === 'custom' || n.props.debug;
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
    else if (t === 'custom') {
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
  if (ns && ns.nineslice_size !== undefined) {
    const s = Array.isArray(ns.nineslice_size) ? ns.nineslice_size : [ns.nineslice_size, ns.nineslice_size, ns.nineslice_size, ns.nineslice_size];
    el.style.borderStyle = 'solid';
    el.style.borderWidth = s.map((v) => `${v * zoom}px`).join(' ');
    el.style.borderImage = `url("${info.url}") ${s.join(' ')} fill / ${s.map((v) => `${v * zoom}px`).join(' ')} stretch`;
    el.style.boxSizing = 'border-box';
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

function drawLabel(el, n, zoom) {
  el.classList.add('label');
  const scale = ({ small: 0.8, normal: 1, large: 1.5, extra_large: 2 }[n.props.font_size] ?? 1) * (n.props.font_scale_factor > 0 ? n.props.font_scale_factor : 1);
  el.style.fontSize = `${8 * scale * zoom}px`;
  el.style.lineHeight = `${10 * scale * zoom}px`;
  const base = css(n.eff?.color ?? n.props.color) || '#ffffff';
  el.style.color = base;
  if (n.props.shadow) el.style.textShadow = `${zoom}px ${zoom}px 0 rgba(0,0,0,.6)`;
  el.style.textAlign = n.props.text_alignment || 'left';
  el.append(formatText(n.eff?.text ?? '', base));
  if (n.props.localize !== false && /^[a-z0-9_.-]+$/i.test(n.eff?.text || '') && (n.eff?.text || '').includes('.')) el.classList.add('lang-key');
}
