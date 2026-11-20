import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { Session, walk } from '../src/engine/bind.js';
import { layoutTree } from '../src/engine/layout.js';
import { parseSize, resolveTerms } from '../src/engine/size.js';

const px = (x) => resolveTerms(parseSize(x), { parent: 200, childSum: 0, childMax: 0, siblingMax: 0 });

test('size strings reuse the last number', () => {
  assert.equal(px('50px%'), 150);
  assert.equal(px('50px %'), 150);
  assert.equal(px('10pxpx'), 20);
  assert.equal(px('10px 5'), 10);
  assert.equal(px('10 20px'), 10);
});

const pack = (defs) => ({ name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/n.json'] }), 'ui/n.json': JSON.stringify({ namespace: 'n', ...defs }) } });

function lay(defs, globals = {}) {
  const cat = buildCatalog([pack(defs)]);
  const { tree } = buildTree(cat, 'n.r');
  new Session(cat, tree, { measured: true }).run({ globals, collections: {}, factories: {} });
  layoutTree(tree, { w: 200, h: 100 });
  const byName = {};
  walk(tree, (n) => { byName[n.name] = n; });
  return byName;
}

const box = (size, extra = {}) => ({ type: 'image', size, ...extra });

test('font_size scales by 0.5, 1, 2 and 4 and medium is normal', () => {
  const n = lay({ r: { type: 'stack_panel', controls: ['small', 'normal', 'large', 'extra_large', 'medium'].map((s) => ({ [s]: { type: 'label', text: 'Ab', localize: false, font_size: s } })) } });
  assert.deepEqual(['small', 'normal', 'large', 'extra_large', 'medium'].map((s) => n[s].rect.h), [5, 10, 20, 40, 10]);
});

test('anchor names match exactly', () => {
  const n = lay({ r: { type: 'panel', controls: [
    { a: box([10, 10], { anchor_from: 'top_left', anchor_to: 'top_left' }) },
    { b: box([10, 10], { anchor_from: 'left', anchor_to: 'left' }) },
  ] } });
  assert.deepEqual([n.a.rect.x, n.a.rect.y], [0, 0]);
  assert.deepEqual([n.b.rect.x, n.b.rect.y], [95, 45]);
});

test('a size that is not an array is default on both axes', () => {
  const n = lay({ r: { type: 'panel', controls: [{ a: box('10px') }] } });
  assert.deepEqual([n.a.rect.w, n.a.rect.h], [200, 100]);
});

test('%c on a panel adds the visible children', () => {
  const n = lay({ r: { type: 'panel', controls: [{ p: { type: 'panel', size: ['100%c', '100%c'], controls: [
    { a: box([10, 4]) }, { b: box([20, 6]) }, { c: box([40, 40], { visible: false }) },
  ] } }] } });
  assert.deepEqual([n.p.rect.w, n.p.rect.h], [30, 10]);
});

test('min and max sizes read %c', () => {
  const n = lay({ r: { type: 'panel', controls: [{ p: { type: 'panel', size: [5, 5], min_size: ['100%c', 0], controls: [{ a: box([30, 4]) }] } }] } });
  assert.equal(n.p.rect.w, 30);
});

test('anchored offset values replace the offset on edge anchors', () => {
  const n = lay({ r: { type: 'panel', controls: [
    { a: box([10, 10], { anchor_from: 'top_right', anchor_to: 'center', offset: [3, 3], use_anchored_offset: true, bindings: [
      { binding_name: '#ax', binding_name_override: '#anchored_offset_value_x' },
      { binding_name: '#ay', binding_name_override: '#anchored_offset_value_y' },
    ] }) },
  ] } }, { '#ax': 0.1, '#ay': 0.5 });
  assert.deepEqual([Math.round(n.a.rect.x), n.a.rect.y], [170, 50]);
});

test('vertical rescaling fits rows to the grid height', () => {
  const n = lay({ r: { type: 'grid', size: [100, 25], grid_rescaling_type: 'vertical', controls: [
    { a: box([10, 10]) }, { b: box([10, 10]) }, { c: box([10, 10]) }, { d: box([10, 10]) }, { e: box([10, 10]) },
  ] } });
  const at = (c) => [c.rect.x - n.r.rect.x, c.rect.y - n.r.rect.y];
  assert.deepEqual(at(n.c), [20, 0]);
  assert.deepEqual(at(n.d), [0, 10]);
});
