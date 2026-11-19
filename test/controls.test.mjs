import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { Session, walk } from '../src/engine/bind.js';
import { layoutTree } from '../src/engine/layout.js';

const pack = (defs) => ({ name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/n.json'] }), 'ui/n.json': JSON.stringify({ namespace: 'n', ...defs }) } });

function build(defs) {
  const cat = buildCatalog([pack(defs)]);
  const { tree, diags } = buildTree(cat, 'n.r');
  new Session(cat, tree, { measured: true }).run({ globals: {}, collections: {}, factories: {} });
  const byName = {};
  walk(tree, (n) => { byName[n.name] = n; }, true);
  return { tree, diags, byName };
}

test('a control with an unknown type is not created', () => {
  const { diags, byName } = build({ r: { type: 'panel', controls: [{ c: { type: 'carousel_label', controls: [{ inner: { type: 'label', text: 'x' } }] } }] } });
  assert.equal(byName.c.ignored, true);
  assert.equal(byName.inner, undefined);
  assert.ok(diags.some((d) => d.msg === "Type 'carousel_label' not recognized for control: c"));
});

test('an unknown renderer name is reported', () => {
  const { diags } = build({ r: { type: 'panel', controls: [
    { a: { type: 'custom', renderer: 'inventory_item_renderer' } },
    { b: { type: 'custom', renderer: 'my_item_renderer' } },
  ] } });
  assert.deepEqual(diags.filter((d) => /Unrecognized renderer/.test(d.msg)).map((d) => d.msg), ["Unrecognized renderer: 'my_item_renderer'"]);
});

test('allow_clipping false is inherited by children', () => {
  const { tree, byName } = build({ r: { type: 'panel', size: [100, 100], clips_children: true, controls: [
    { free: { type: 'panel', allow_clipping: false, controls: [{ kid: { type: 'image', size: [10, 10] } }] } },
    { held: { type: 'panel', controls: [{ inner: { type: 'image', size: [10, 10] } }] } },
  ] } });
  layoutTree(tree, { w: 200, h: 200 });
  assert.equal(byName.free.clip, null);
  assert.equal(byName.kid.clip, null);
  assert.deepEqual(byName.inner.clip, byName.r.rect);
});
