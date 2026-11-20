// Text measurement with the game's bitmap font advances (data/font-metrics.json, built from the
// client's font.brarchive by tools/build-font-metrics.mjs).
// ASCII (default8.png): advance = last opaque column + 2; a space is 4.
// Other characters (glyph_XX.png, 16 px cells drawn at half size): advance = (right + 1 - left) / 2 + 1.
// A line is 10 + line_padding px tall at scale 1. A line's width is ceil(sum of advances x scale)
// (client 0x140e6ba60). Lines break at spaces; a word wider than the line breaks by character.
// Lines past maxHeight are dropped and the last kept line ends in "..." (client 0x146c06f90).
// With unicodeAscii (the game in Korean, measured 2026-10-23) a text that has any character outside
// ASCII takes the advance of its ASCII from glyph_00 too ("/menu" in a Korean sentence is 20 px wide,
// not 30), while a text of ASCII only keeps default8 (an invite code "QHJUJB" at scale 0.7 is 24.75 px,
// as default8 gives).

export function createMeasure(metrics, { unicodeAscii = false } = {}) {
  const pages = {};
  for (const [k, v] of Object.entries(metrics.pages || {})) pages[k] = decode(v);
  const advance = (ch, unicode) => {
    if (ch === ' ') return 4;
    const cp = ch.codePointAt(0);
    if (cp < 128 && !unicode) {
      const r = metrics.asciiRight[cp];
      return r < 0 ? 0 : r + 2;
    }
    const page = pages[(cp >> 8).toString(16).toUpperCase().padStart(2, '0')];
    if (!page || cp > 0xffff) return 9;
    const s = page[cp & 255];
    if (!s) return 4;
    return ((s & 15) + 1 - (s >> 4)) / 2 + 1;
  };
  return (text, scale = 1, maxWidth = Infinity, opts = {}) => {
    const t = String(text ?? '');
    const unicode = unicodeAscii && /[^\x00-\x7f]/.test(t.replace(/§./g, ''));
    return layoutText(t, scale, maxWidth, (ch) => advance(ch, unicode), opts);
  };
}

function decode(b64) {
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64');
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Splits text into visible characters with their advance; § codes take no space, bold (from §l to §r)
// adds 1 to every glyph with an advance, spaces included. Colour codes and uppercase codes leave bold on.
function glyphs(text, scale, advance) {
  const out = [];
  let bold = false;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '§' && i + 1 < chars.length) {
      const c = chars[++i];
      if (c === 'l') bold = true;
      else if (c === 'r') bold = false;
      out.push({ ch: `§${c}`, w: 0, code: true, bold });
      continue;
    }
    const a = advance(ch);
    out.push({ ch, w: (a + (bold && a > 0 ? 1 : 0)) * scale, bold });
  }
  return out;
}

const ceilWidth = (w) => Math.max(0, Math.ceil(w - 1e-6));
const sumWidth = (gs) => gs.reduce((a, g) => a + g.w, 0);

function ellipsize(line, scale, maxWidth, advance) {
  const bold = line.glyphs.length ? line.glyphs[line.glyphs.length - 1].bold : false;
  const dot = { ch: '.', w: (advance('.') + (bold ? 1 : 0)) * scale, bold };
  const dots = [dot, dot, dot];
  if (ceilWidth(sumWidth(dots)) > maxWidth) return { text: '', w: 0, glyphs: [] };
  const body = line.glyphs.slice(0, -1);
  while (body.length && ceilWidth(sumWidth(body) + sumWidth(dots)) > maxWidth) body.pop();
  const gs = [...body, ...dots];
  return { text: gs.map((g) => g.ch).join(''), w: ceilWidth(sumWidth(gs)), glyphs: gs };
}

export function layoutText(text, scale, maxWidth, advance, { linePadding = 0, maxHeight = Infinity } = {}) {
  const fits = (w) => ceilWidth(w) <= maxWidth + 1e-6;
  const lines = [];
  // a trailing newline adds no empty line (measured in game 2026-10-23: a body ending in "\n"
  // took two lines, not three)
  const paras = text.split('\n');
  if (paras.length > 1 && paras[paras.length - 1] === '') paras.pop();
  for (const para of paras) {
    const gs = glyphs(para, scale, advance);
    let line = [], lineW = 0, i = 0;
    const flush = () => { lines.push({ text: line.map((g) => g.ch).join(''), w: ceilWidth(lineW), glyphs: line }); line = []; lineW = 0; };
    while (i < gs.length) {
      // the next word, with the spaces before it
      let j = i;
      while (j < gs.length && gs[j].ch === ' ') j++;
      while (j < gs.length && gs[j].ch !== ' ') j++;
      const word = gs.slice(i, j);
      const wordW = sumWidth(word);
      if (fits(lineW + wordW) || line.length === 0) {
        if (!fits(lineW + wordW) && line.length === 0) {
          // a word wider than the line: break it by character
          for (const g of word) {
            if (!fits(lineW + g.w) && line.length) flush();
            if (line.length === 0 && g.ch === ' ') continue;
            line.push(g); lineW += g.w;
          }
        } else { line.push(...word); lineW += wordW; }
      } else {
        flush();
        let k = 0;
        while (k < word.length && word[k].ch === ' ') k++; // a wrapped line drops its leading spaces
        for (const g of word.slice(k)) { line.push(g); lineW += g.w; }
      }
      i = j;
    }
    flush();
  }
  const lineH = (10 + linePadding) * scale;
  const room = Math.floor(maxHeight / lineH + 1e-6);
  const ellipsis = room >= 1 && lines.length > room;
  if (ellipsis) {
    lines.length = room;
    lines[room - 1] = ellipsize(lines[room - 1], scale, maxWidth, advance);
  }
  const w = Math.max(0, ...lines.map((l) => l.w));
  const unicode = /[^\x00-\x7f -]/u.test(text.replace(/§./gu, ''));
  return { w, h: lines.length * lineH, lines: lines.length, lineTexts: lines, ellipsis, unicode };
}
