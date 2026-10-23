// Scope cases from the Cinnabar evaluator run results (section 3, CN-run 2026-10-21), plus modifications rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';

const pack = (files, extra = {}) => ({ name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: Object.keys(files) }), ...files }, ...extra });
const kids = (node) => node.children.filter((c) => !c.ignored).map((c) => [c.name, c.props.text]);

test("reference-site $ value is invisible to the control's own ignored (FILE-34)", () => {
  const cat = buildCatalog([pack({ 'ui/n.json': JSON.stringify({
    namespace: 'n',
    item: { type: 'label', text: '$t', ignored: '$hide', '$t|default': 'dflt' },
    root: { type: 'panel', controls: [{ 'a@n.item': { $hide: true, $t: 'A' } }, { 'b@n.item': {} }] },
    root2: { type: 'panel', $hide: true, controls: [{ 'c@n.item': {} }] },
  }) })]);
  assert.deepEqual(kids(buildTree(cat, 'n.root').tree), [['a', 'A'], ['b', 'dflt']]);
  assert.deepEqual(kids(buildTree(cat, 'n.root2').tree), []);
});

test('outer concrete beats inner default; defaults pick the nearest (FILE-33)', () => {
  const cat = buildCatalog([pack({ 'ui/n.json': JSON.stringify({
    namespace: 'n',
    leaf: { type: 'label', text: '$v', '$v|default': 'inner-default' },
    r1: { type: 'panel', $v: 'outer-concrete', controls: [{ 'a@n.leaf': {} }] },
    r2: { type: 'panel', '$v|default': 'outer-default', controls: [{ 'a@n.leaf': {} }] },
  }) })]);
  assert.deepEqual(kids(buildTree(cat, 'n.r1').tree), [['a', 'outer-concrete']]);
  assert.deepEqual(kids(buildTree(cat, 'n.r2').tree), [['a', 'inner-default']]);
});

test('only whole-value $ substitutes; expressions combine (FILE-10, FILE-11)', () => {
  const cat = buildCatalog([pack({ 'ui/n.json': JSON.stringify({
    namespace: 'n',
    r: { type: 'panel', $v: 'X', controls: [
      { a: { type: 'label', text: 'pre $v' } },
      { b: { type: 'label', text: '$v' } },
      { c: { type: 'label', text: "('pre ' + $v)" } },
    ] },
  }) })]);
  assert.deepEqual(kids(buildTree(cat, 'n.r').tree), [['a', 'pre $v'], ['b', 'X'], ['c', 'pre X']]);
});

test('variables blocks apply when requires holds (FILE-13)', () => {
  const cat = buildCatalog([pack({ 'ui/n.json': JSON.stringify({
    namespace: 'n',
    r: { type: 'label', $mode: 'b', text: '$t', variables: [
      { requires: "($mode = 'a')", $t: 'A' },
      { requires: "($mode = 'b')", $t: 'B' },
    ] },
  }) })]);
  assert.equal(buildTree(cat, 'n.r').tree.props.text, 'B');
});

test('derived property replaces the base object whole (FILE-37)', () => {
  const cat = buildCatalog([pack({ 'ui/n.json': JSON.stringify({
    namespace: 'n',
    base: { type: 'panel', property_bag: { '#a': 1, '#b': 2 } },
    d: { '@': 0, property_bag: { '#a': 9 } },
  }).replace('"d"', '"d@n.base"') })]);
  assert.deepEqual(buildTree(cat, 'n.d').tree.props.property_bag, { '#a': 9 });
});

const vanilla = { name: 'vanilla', vanilla: true, files: {
  'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/hud.json'] }),
  'ui/hud.json': JSON.stringify({ namespace: 'hud', root_panel: { type: 'panel', controls: [{ a: { type: 'label', text: 'a' } }, { b: { type: 'label', text: 'b' } }] } }),
} };

test('same-path modifications apply in order (MOD-02)', () => {
  const p1 = { name: 'p1', files: { 'ui/hud.json': JSON.stringify({ root_panel: { modifications: [{ array_name: 'controls', operation: 'insert_front', value: [{ x: { type: 'label', text: 'x' } }] }] } }) } };
  const p2 = { name: 'p2', files: { 'ui/hud.json': JSON.stringify({ root_panel: { modifications: [{ array_name: 'controls', operation: 'remove', control_name: 'b' }] } }) } };
  const cat = buildCatalog([vanilla, p1, p2]);
  assert.deepEqual(kids(buildTree(cat, 'hud.root_panel').tree).map((k) => k[0]), ['x', 'a']);
});

test('modifications from another path do not touch vanilla (MOD-02)', () => {
  const p = { name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/mine.json'] }), 'ui/mine.json': JSON.stringify({ namespace: 'hud', root_panel: { modifications: [{ array_name: 'controls', operation: 'remove', control_name: 'a' }] } }) } };
  const cat = buildCatalog([vanilla, p], { measured: true });
  assert.deepEqual(kids(buildTree(cat, 'hud.root_panel').tree).map((k) => k[0]), ['a', 'b']);
  assert.ok(cat.diags.some((d) => /FILE-22|MOD-02/.test(d.msg)));
});

test('an op cannot select an element added earlier in the same block (MOD-17)', () => {
  const p = { name: 'p', files: { 'ui/hud.json': JSON.stringify({ root_panel: { modifications: [
    { array_name: 'controls', operation: 'insert_back', value: [{ x: { type: 'label' } }] },
    { array_name: 'controls', operation: 'remove', control_name: 'x' },
  ] } }) } };
  const cat = buildCatalog([vanilla, p]);
  assert.deepEqual(kids(buildTree(cat, 'hud.root_panel').tree).map((k) => k[0]), ['a', 'b', 'x']);
});

test('array elements with ignored are skipped (FILE-18)', async () => {
  const { Session } = await import('../src/engine/bind.js');
  const cat = buildCatalog([pack({ 'ui/n.json': JSON.stringify({
    namespace: 'n',
    r: { type: 'label', text: '#t', $skip: true, bindings: [
      { ignored: '$skip', binding_name: '' },
      { binding_name: '#title_text', binding_name_override: '#t' }] },
  }) })]);
  const { tree } = buildTree(cat, 'n.r');
  const s = new Session(cat, tree);
  s.run({ globals: { '#title_text': 'ok' }, collections: {}, factories: {} });
  assert.equal(tree.eff.text, 'ok');
  assert.equal((tree.bindDiags || []).length, 0);
});

test("a $ variable holding '#name' makes a binding expression (CN-17)", () => {
  const cat = buildCatalog([pack({ 'ui/n.json': JSON.stringify({
    namespace: 'n',
    r: { type: 'panel', $sel: '#is_selected', bindings: [{ binding_name: '(not $sel)', binding_name_override: '#visible' }] },
  }) })]);
  assert.equal(buildTree(cat, 'n.r').tree.props.bindings[0].binding_name, '(not #is_selected)');
});
