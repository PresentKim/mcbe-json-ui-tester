#!/usr/bin/env node
// Builds data/font-metrics.json: glyph advances of the game's bitmap fonts, read from the
// font.brarchive of an installed client (the glyph pictures themselves are not copied).
//   node tools/build-font-metrics.mjs "<…>/Minecraft for Windows/Content/data/resource_packs/vanilla/__brarchive/font.brarchive"
// default8.png: 16×16 cells of 8 px, a glyph is as wide as its last opaque column (+1 px gap).
// glyph_XX.png: unicode page XX, 16×16 cells of 16 px drawn at half size; the left and right
// opaque columns are stored as in the Java glyph_sizes.bin (left << 4 | right).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const archive = process.argv[2] || 'C:/XboxGames/Minecraft for Windows/Content/data/resource_packs/vanilla/__brarchive/font.brarchive';

// brarchive: 8-byte magic, u32 count, u32 version, count × 256-byte entries
// (u8 name length, name, …, u32 offset, u32 size at +248), then the data.
function readArchive(file) {
  const d = fs.readFileSync(file);
  const count = d.readUInt32LE(8);
  const dataStart = 16 + count * 256;
  const out = {};
  for (let k = 0; k < count; k++) {
    const e = 16 + k * 256;
    const name = d.subarray(e + 1, e + 1 + d[e]).toString('utf8');
    const off = d.readUInt32LE(e + 248), size = d.readUInt32LE(e + 252);
    out[name] = d.subarray(dataStart + off, dataStart + off + size);
  }
  return out;
}

// Minimal PNG decoder: 8-bit greyscale(+alpha), RGB(A) and palette images. Returns alpha per pixel.
function decodeAlpha(buf) {
  let pos = 8, w = 0, h = 0, type = 0, depth = 0, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; }
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  if (depth > 8) throw new Error(`bit depth ${depth} not supported`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = Math.ceil((w * ch * depth) / 8), bpp = Math.max(1, (ch * depth) >> 3);
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  // value of sample s (0-based channel index within the pixel) at (x, y)
  const sample = (x, y, s) => {
    if (depth === 8) return px[y * stride + x * ch + s];
    const bit = (x * ch + s) * depth, byte = px[y * stride + (bit >> 3)];
    return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const alpha = (x, y) => {
    if (type === 6) return sample(x, y, 3);
    if (type === 4) return sample(x, y, 1);
    if (type === 3) { const i = sample(x, y, 0); return trns && i < trns.length ? trns[i] : 255; }
    if (type === 0 && trns) return sample(x, y, 0) === trns.readUInt16BE(0) ? 0 : 255;
    return 255;
  };
  return { w, h, alpha };
}

function columns(img, cx, cy, cell) {
  let left = -1, right = -1;
  for (let x = 0; x < cell; x++) {
    for (let y = 0; y < cell; y++) {
      if (img.alpha(cx * cell + x, cy * cell + y) > 0) { if (left < 0) left = x; right = x; break; }
    }
  }
  return [left, right];
}

const files = readArchive(archive);
const ascii = decodeAlpha(files['default8.png']);
const asciiCell = ascii.w / 16;
const asciiRight = [];
for (let c = 0; c < 256; c++) asciiRight.push(columns(ascii, c % 16, c >> 4, asciiCell)[1]);

const pages = {};
for (const [name, buf] of Object.entries(files)) {
  const m = name.match(/^glyph_([0-9A-F]{2})\.png$/);
  if (!m) continue;
  const img = decodeAlpha(buf);
  const cell = img.w / 16;
  const sizes = Buffer.alloc(256);
  for (let c = 0; c < 256; c++) {
    const [l, r] = columns(img, c % 16, c >> 4, cell);
    sizes[c] = l < 0 ? 0 : ((Math.round(l * 16 / cell) & 15) << 4) | (Math.round(r * 16 / cell) & 15);
  }
  pages[m[1]] = sizes.toString('base64');
}

const dest = path.join(here, '../data/font-metrics.json');
fs.writeFileSync(dest, JSON.stringify({ source: 'font.brarchive (default8.png, glyph_XX.png)', asciiCell, asciiRight, pages }));
console.log(`ascii cell ${asciiCell}px, unicode pages ${Object.keys(pages).length} → ${dest}`);
