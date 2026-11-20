import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { Session, walk } from '../src/engine/bind.js';
import { layoutTree, clipRect } from '../src/engine/layout.js';
import { clipCut, keepRatioRect, fillSource, tileCells, tileAxes, nineSlices, ninePieces, uvRect, snapRect } from '../src/render.js';

const rect = (x, y, w, h) => ({ x, y, w, h });

function laidOut(defs) {
  const cat = buildCatalog([{ name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/n.json'] }), 'ui/n.json': JSON.stringify({ namespace: 'n', ...defs }) } }]);
  const { tree } = buildTree(cat, 'n.r');
  new Session(cat, tree, { measured: true }).run({ globals: {}, collections: {}, factories: {} });
  layoutTree(tree, { w: 100, h: 100 });
  const byName = {};
  walk(tree, (n) => { byName[n.name] = n; });
  return byName;
}

test('clip_offset insets all four sides and intersects the parent clip', () => {
  assert.deepEqual(clipRect(rect(10, 10, 40, 20), [2, 3]), rect(12, 13, 36, 14));
  assert.deepEqual(clipRect(rect(10, 10, 40, 20), [2, 3], rect(0, 0, 30, 100)), rect(12, 13, 18, 14));
  assert.deepEqual(clipRect(rect(-5, 0, 10, 10), null), rect(0, 0, 5, 10));
  assert.deepEqual(clipRect(rect(0, 0, 4, 4), [3, 3]), rect(3, 3, 0, 0));
});

test('a clips_children control clips its own drawing with clip_offset', () => {
  const byName = laidOut({ r: { type: 'panel', size: [40, 20], anchor_from: 'top_left', anchor_to: 'top_left', clips_children: true, clip_offset: [2, 3], controls: [{ kid: { type: 'image', size: [10, 10] } }] } });
  assert.deepEqual(byName.r.clip, rect(2, 3, 36, 14));
  assert.deepEqual(byName.kid.clip, rect(2, 3, 36, 14));
});

test('clip_ratio cuts only with a clip_direction and draws nothing at 1', () => {
  const d = rect(0, 0, 100, 50), s = rect(0, 0, 10, 10);
  assert.deepEqual(clipCut(d, s, undefined, 0.5), { dest: d, src: s });
  assert.equal(clipCut(d, s, 'left', 1), null);
  assert.deepEqual(clipCut(d, s, 'left', 0), { dest: d, src: s });
});

test('clip directions keep the named side; center shrinks both axes', () => {
  const d = rect(0, 0, 100, 50), s = rect(0, 0, 10, 10);
  assert.deepEqual(clipCut(d, s, 'left', 0.25, false), { dest: rect(0, 0, 75, 50), src: rect(0, 0, 7.5, 10) });
  assert.deepEqual(clipCut(d, s, 'right', 0.25, false), { dest: rect(25, 0, 75, 50), src: rect(2.5, 0, 7.5, 10) });
  assert.deepEqual(clipCut(d, s, 'up', 0.5, false), { dest: rect(0, 0, 100, 25), src: rect(0, 0, 10, 5) });
  assert.deepEqual(clipCut(d, s, 'down', 0.5, false), { dest: rect(0, 25, 100, 25), src: rect(0, 5, 10, 5) });
  assert.deepEqual(clipCut(d, s, 'center', 0.5, false), { dest: rect(25, 12.5, 50, 25), src: rect(2.5, 2.5, 5, 5) });
});

test('clip_pixelperfect rounds the ratio down to whole texels', () => {
  assert.deepEqual(clipCut(rect(0, 0, 100, 10), rect(0, 0, 10, 10), 'left', 0.37).dest, rect(0, 0, 70, 10));
});

test('keep_ratio fits uv_size inside the control, centred (ANI-23)', () => {
  assert.deepEqual(keepRatioRect(rect(0, 0, 4, 23), 6, 27), rect(0, 2.5, 4, 18));
  assert.deepEqual(keepRatioRect(rect(0, 0, 20, 10), 4, 2), rect(0, 0, 20, 10));
});

test('fill crops the source to the control aspect', () => {
  assert.deepEqual(fillSource(rect(0, 0, 20, 10), 10, 10), rect(5, 0, 10, 10));
  assert.deepEqual(fillSource(rect(0, 0, 10, 20), 20, 10), rect(0, 7.5, 10, 5));
});

test('uv and uv_size are texture pixels; a zero uv_size takes the whole texture', () => {
  assert.deepEqual(uvRect([4, 2], [8, 8], 32, 32), rect(4, 2, 8, 8));
  assert.deepEqual(uvRect([4, 2], [0, 0], 32, 16), rect(4, 2, 32, 16));
  assert.deepEqual(uvRect(undefined, undefined, 32, 16), rect(0, 0, 32, 16));
});

test('tiled x stretches cells to the control height and cuts the last cell', () => {
  assert.equal(tileAxes('x'), 1);
  assert.equal(tileAxes(true), 3);
  const cells = tileCells(rect(0, 0, 25, 40), rect(0, 0, 10, 10), 1, 10, 10);
  assert.deepEqual(cells.map((c) => c.dest), [rect(0, 0, 10, 40), rect(10, 0, 10, 40), rect(20, 0, 5, 40)]);
  assert.deepEqual(cells[2].src, rect(0, 0, 5, 10));
  assert.deepEqual(tileCells(rect(0, 0, 30, 25), rect(0, 0, 10, 10), 2, 10, 10).map((c) => c.dest.w), [30, 30, 30]);
});

test('the control nineslice_size overrides the sidecar; the sidecar takes a number or four values', () => {
  assert.deepEqual(nineSlices(2, { nineslice_size: 4, base_size: [16, 16] }), { slices: [2, 2, 2, 2], base: [16, 16] });
  assert.deepEqual(nineSlices(undefined, { nineslice_size: [1, 2, 3, 4] }), { slices: [1, 2, 3, 4], base: null });
  assert.equal(nineSlices(undefined, { nineslice_size: [1, 2] }), null);
  assert.deepEqual(nineSlices(undefined, { nineslice_size: 3, base_size: 16 }).base, null);
  assert.equal(nineSlices(undefined, { meta: {}, nineslice_size: 3 }), null);
});

test('nineslice corners keep their size in a small control', () => {
  const pieces = ninePieces(rect(0, 0, 6, 20), rect(0, 0, 32, 32), [4, 4, 4, 4], [16, 16], 1);
  assert.deepEqual(pieces.map((p) => p.dest.x), [0, 2, 0, 2, 0, 2]);
  assert.deepEqual(pieces[0].src, rect(0, 0, 8, 8));
});

test('measured nineslice stretches an axis whose slices cross the texture', () => {
  assert.equal(ninePieces(rect(0, 0, 10, 10), rect(0, 0, 1, 1), [1, 1, 1, 1], null, 1, true).length, 1);
  assert.ok(ninePieces(rect(0, 0, 10, 10), rect(0, 0, 1, 1), [1, 1, 1, 1], null, 1, false).length > 1);
});

test('pixel snapping truncates the position and rounds the size up', () => {
  assert.deepEqual(snapRect(rect(10.7, 0.5, 4.2, 3)), rect(10, 0, 5, 3));
});
