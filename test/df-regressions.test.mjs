// Regressions found while running a real server's packs (df-server, 2026-10-23).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { Session, walk } from '../src/engine/bind.js';
import { layoutTree } from '../src/engine/layout.js';

const pack = (files) => ({ name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: Object.keys(files) }), ...files } });
const host = (n) => ({ globals: { '#n': n }, collections: { items: Array.from({ length: n }, (_, i) => ({ '#t': `i${i}` })) }, factories: {} });

test('%c of a plain panel is its children reach, whatever their anchor', () => {
  const cat = buildCatalog([pack({ 'ui/n.json': JSON.stringify({
    namespace: 'n',
    r: { type: 'panel', size: [100, '100%c'], controls: [{ a: { type: 'panel', size: [10, 40] } }] },
  }) })]);
  const { tree } = buildTree(cat, 'n.r');
  new Session(cat, tree).run(host(0));
  layoutTree(tree, { w: 200, h: 200 });
  assert.equal(tree.rect.h, 40);
  assert.equal(tree.children[0].rect.y, tree.rect.y);
});

test('a hidden layout whose length binding waits for "visible" makes nothing (BND-32), and fills once shown', () => {
  const layout = (visible) => ({ type: 'stack_panel', visible, size: [100, '100%c'], collection_name: 'items',
    factory: { name: 'f', control_name: 'n.row' },
    bindings: [{ binding_name: '#n', binding_name_override: '#collection_length', binding_condition: 'visible' }] });
  const cat = buildCatalog([pack({ 'ui/n.json': JSON.stringify({
    namespace: 'n', row: { type: 'panel', size: [10, 10] },
    r: { type: 'panel', controls: [{ hidden: layout(false) }, { shown: layout(true) }] },
  }) })]);
  const { tree } = buildTree(cat, 'n.r');
  new Session(cat, tree, { measured: true }).run(host(5));
  const count = (name) => { let c = 0; walk(tree, (x) => { if (x.parent?.name === name && x.fromFactory) c++; }); return c; };
  assert.equal(count('hidden'), 0);
  assert.equal(count('shown'), 5);
});
