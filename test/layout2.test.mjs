import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { Session, walk } from '../src/engine/bind.js';
import { layoutTree } from '../src/engine/layout.js';
import { nameTagBox } from '../src/render.js';

const pack = (defs) => ({ name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/n.json'] }), 'ui/n.json': JSON.stringify({ namespace: 'n', ...defs }) } });

function lay(defs, opts = {}) {
  const cat = buildCatalog([pack(defs)]);
  const { tree } = buildTree(cat, 'n.r');
  new Session(cat, tree, { measured: true }).run({ globals: {}, collections: {}, factories: {} });
  layoutTree(tree, { w: 200, h: 100 }, opts);
  const byName = {};
  walk(tree, (n) => { byName[n.name] = n; });
  return byName;
}

const box = (size, extra = {}) => ({ type: 'image', size, ...extra });
const rel = (n, p) => [n.rect.x - p.rect.x, n.rect.y - p.rect.y];
const row = (width, controls) => ({ r: { type: 'panel', controls: [{ s: { type: 'stack_panel', orientation: 'horizontal', use_priority: true, size: [width, 10], controls } }] } });

test('use_priority hides the highest priority child that does not fit', () => {
  const n = lay(row(100, [{ a: box([40, 10], { priority: 3 }) }, { b: box([40, 10], { priority: 1 }) }, { c: box([40, 10], { priority: 2 }) }]));
  assert.deepEqual([n.a.effVisible, n.b.effVisible, n.c.effVisible], [false, true, true]);
  assert.deepEqual([rel(n.b, n.s), rel(n.c, n.s)], [[0, 0], [40, 0]]);
  assert.equal(n.a.bag.get('a_invisible').v, true);
  assert.equal(n.s.bag.get('s_first_hidden_child_index').v, 2);
});

test('use_priority without overflow hides show_when_controls_are_hidden children', () => {
  const n = lay(row(200, [{ a: box([40, 10]) }, { b: box([40, 10], { priority_rule: 'show_when_controls_are_hidden' }) }, { c: box([40, 10], { priority_rule: 'other' }) }]));
  assert.deepEqual([n.a.effVisible, n.b.effVisible, n.c.effVisible], [true, false, true]);
  assert.deepEqual(rel(n.c, n.s), [40, 0]);
  assert.equal(n.s.bag.has('s_first_hidden_child_index'), false);
});

test('fill divides what visible fixed siblings leave', () => {
  const n = lay({ r: { type: 'stack_panel', orientation: 'horizontal', size: [100, 10], controls: [
    { a: box([20, 10]) }, { b: box([50, 10], { visible: false }) }, { f: box(['fill', 10]) }, { g: box(['fill', 10]) }, { h: box(['fill', 10], { visible: false }) },
  ] } });
  assert.deepEqual([n.f.rect.w, n.g.rect.w, n.g.rect.x - n.r.rect.x], [40, 40, 60]);
});

test('inherit_max_sibling_width takes the widest visible sibling', () => {
  const n = lay({ r: { type: 'panel', controls: [
    { a: box([30, 10], { inherit_max_sibling_width: true }) }, { b: box([50, 20]) }, { c: box([80, 30], { visible: false }) },
  ] } });
  assert.deepEqual([n.a.rect.w, n.a.rect.h], [50, 10]);
});

test('a default grid is dimensions times the template size', () => {
  const n = lay({ r: { type: 'panel', controls: [
    { g: { type: 'grid', grid_dimensions: [3, 2], controls: [{ a: box([10, 10]) }, { b: box([10, 10]) }] } },
    { h: { type: 'grid', grid_dimensions: [3, 2], size: ['50%c', 7], controls: [{ c: box([10, 10]) }] } },
  ] } });
  assert.deepEqual([n.g.rect.w, n.g.rect.h], [30, 20]);
  assert.deepEqual([n.h.rect.w, n.h.rect.h], [15, 7]);
});

test('default_size_scales_to_ratio sizes the default axis from the texture', () => {
  const textureSize = (p) => (p === 't' ? [40, 20] : null);
  const n = lay({ r: { type: 'panel', controls: [
    { a: box([20, 'default'], { texture: 't', default_size_scales_to_ratio: true }) },
    { b: box([20, 'default'], { texture: 't' }) },
  ] } }, { textureSize });
  assert.deepEqual([n.a.rect.h, n.b.rect.h], [10, 100]);
});

test('name_tag_renderer box centres #playername with padding', () => {
  const n = lay({ r: { type: 'panel', controls: [
    { tag: { type: 'custom', renderer: 'name_tag_renderer', size: [40, 20], property_bag: { '#playername': 'Ab', '#x_padding': 2 } } },
  ] } });
  const b = nameTagBox(n.tag);
  assert.deepEqual([b.x0, b.y0, b.x1, b.y1, b.textX, b.textY], [91, 44, 108, 55, 94, 46]);
  assert.deepEqual([b.background, b.text], [[0, 0, 0, 0.25], [255, 255, 255, 1]]);
});
