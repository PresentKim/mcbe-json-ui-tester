// Text measurement with the game's bitmap font advances (data/font-metrics.json, built from the
// client's font.brarchive by tools/build-font-metrics.mjs).
// ASCII (default8.png): advance = last opaque column + 2; a space is 4.
// Other characters (glyph_XX.png, 16 px cells drawn at half size): advance = (right + 1 - left) / 2 + 1.
// A line is 10 px tall at scale 1. Lines break at spaces; a word wider than the line breaks by character.

export function createMeasure(metrics) {
  const pages = {};
  for (const [k, v] of Object.entries(metrics.pages || {})) pages[k] = decode(v);
  const advance = (ch) => {
    if (ch === ' ') return 4;
    const cp = ch.codePointAt(0);
    if (cp < 128) {
      const r = metrics.asciiRight[cp];
      return r < 0 ? 0 : r + 2;
    }
    const page = pages[(cp >> 8).toString(16).toUpperCase().padStart(2, '0')];
    if (!page || cp > 0xffff) return 9;
    const s = page[cp & 255];
    if (!s) return 4;
    return ((s & 15) + 1 - (s >> 4)) / 2 + 1;
  };
  return (text, scale = 1, maxWidth = Infinity) => layoutText(String(text ?? ''), scale, maxWidth, advance);
}

function decode(b64) {
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64');
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Splits text into visible characters with their advance; § codes take no space, bold (§l) adds 1.
function glyphs(text, scale, advance) {
  const out = [];
  let bold = false;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '§' && i + 1 < chars.length) {
      const c = chars[++i].toLowerCase();
      if (c === 'l') bold = true;
      else if (c === 'r' || /[0-9a-v]/.test(c)) bold = false;
      out.push({ ch: `§${chars[i]}`, w: 0, code: true });
      continue;
    }
    out.push({ ch, w: (advance(ch) + (bold && ch !== ' ' ? 1 : 0)) * scale });
  }
  return out;
}

export function layoutText(text, scale, maxWidth, advance) {
  const lines = [];
  // a trailing newline adds no empty line (measured in game 2026-10-23: a body ending in "\n"
  // took two lines, not three)
  const paras = text.split('\n');
  if (paras.length > 1 && paras[paras.length - 1] === '') paras.pop();
  for (const para of paras) {
    const gs = glyphs(para, scale, advance);
    let line = [], lineW = 0, i = 0;
    const flush = () => { lines.push({ text: line.map((g) => g.ch).join(''), w: lineW, glyphs: line }); line = []; lineW = 0; };
    while (i < gs.length) {
      // the next word, with the spaces before it
      let j = i;
      while (j < gs.length && gs[j].ch === ' ') j++;
      while (j < gs.length && gs[j].ch !== ' ') j++;
      const word = gs.slice(i, j);
      const wordW = word.reduce((a, g) => a + g.w, 0);
      if (lineW + wordW <= maxWidth + 1e-6 || line.length === 0) {
        if (lineW + wordW > maxWidth + 1e-6 && line.length === 0) {
          // a word wider than the line: break it by character
          for (const g of word) {
            if (lineW + g.w > maxWidth + 1e-6 && line.length) flush();
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
  const w = Math.max(0, ...lines.map((l) => l.w));
  return { w, h: lines.length * 10 * scale, lines: lines.length, lineTexts: lines };
}
