import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { Session, walk } from '../src/engine/bind.js';
import { layoutTree, findRendererIssues } from '../src/engine/layout.js';
import { chestHost, PLATFORMS } from '../src/engine/host.js';
import { fromJson, num } from '../src/engine/expr.js';

const pack = (defs) => ({ name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/n.json'] }), 'ui/n.json': JSON.stringify({ namespace: 'n', ...defs }) } });
const label = (props) => ({ type: 'label', text: '#text', ...props });
const view = (src) => ({ binding_type: 'view', source_property_name: src, target_property_name: '#text' });

function run(defs, globals = {}, opts = { measured: true }, env = {}, collections = {}) {
  const cat = buildCatalog([pack(defs)]);
  const { tree } = buildTree(cat, 'n.r', env);
  const s = new Session(cat, tree, opts);
  s.run({ globals, collections, factories: {} });
  const byName = {};
  walk(tree, (n) => { byName[n.name] = n; });
  return { tree, s, byName };
}

for (const measured of [true, false]) {
  test(`$ inside a view expression is substituted as text (measured: ${measured})`, () => {
    const { byName } = run({ r: { type: 'panel', controls: [
      { a: label({ $v: 'hover_text', bindings: [view("('#' + $v)")] }) },
      { b: label({ $skip: '%.3s', bindings: [view('($skip * #hover_text)')] }) },
      { c: label({ $m: "'ab'", bindings: [view('(#marked - $m)')] }) },
    ] } }, { '#hover_text': 'hello', '#marked': 'abcd' }, { measured });
    assert.equal(byName.a.eff.text, 'hello');
    assert.equal(byName.b.eff.text, 'hel');
    assert.equal(byName.c.eff.text, 'abcd');
    assert.ok(!byName.a.bindDiags.some((d) => /BND-33/.test(d.msg)));
  });
}

test('variables block expressions take string and number variables', () => {
  const { byName } = run({
    cell: { type: 'label', variables: [
      { requires: '(true)', $cut: '($skip * $t)', $cutn: "(('%.' + $n + 's') * $t)" },
    ], controls: [{ s: { type: 'label', text: '$cut' } }, { n: { type: 'label', text: '$cutn' } }] },
    r: { type: 'panel', $t: 'abcdef', controls: [{ 'x@n.cell': { $skip: '%.2s', $n: 4 } }] },
  });
  assert.equal(byName.s.props.text, 'ab');
  assert.equal(byName.n.props.text, 'abcd');
});

test('a variable holding an expression stays text inside another expression', () => {
  const { byName } = run({ r: { type: 'label', $e: "('a' + 'b')", text: "('x' + $e)" } });
  assert.equal(byName.r.props.text, "x('a' + 'b')");
});

test('a view expression without #property stops every binding of the control', () => {
  const { byName } = run({ r: label({ $v: 'x', bindings: [
    { binding_name: '#title_text', binding_name_override: '#text' },
    view("('a' + $v)"),
  ] }) }, { '#title_text': 'ok' });
  assert.equal(byName.r.eff.text, '');
  assert.ok(byName.r.bindDiags.some((d) => /Must define a source property name/.test(d.msg)));
});

test('labels draw only text values', () => {
  const { byName } = run({ r: { type: 'panel', controls: [
    { int: label({ bindings: [{ binding_name: '#i', binding_name_override: '#text' }] }) },
    { float: label({ bindings: [{ binding_name: '#f', binding_name_override: '#text' }] }) },
    { vfloat: label({ bindings: [view("('v' + #f)")] }) },
    { rint: label({ bindings: [view("('§r' + #i)")] }) },
    { lead: label({ bindings: [view("('§r' + (#s - 'x'))")] }) },
    { vbool: label({ bindings: [view("('v' + (#s = ''))")] }) },
    { reread: label({ bindings: [view("(#s - 'x')")] }) },
  ] } }, { '#i': 219, '#f': 2.5, '#s': ' 1,532/4,096x' });
  const t = (n) => byName[n].eff.text;
  assert.deepEqual([t('int'), t('float'), t('vfloat'), t('rint'), t('lead'), t('vbool'), t('reread')], ['', '', 'v', '§r219', '§r1', 'vfalse', '']);
});

test('$container_title is not substituted in a binding expression (HOST-19)', () => {
  const { byName } = run({ r: label({ bindings: [view('(#t + $container_title)')] }) }, { '#t': 'a' }, { measured: true }, { hostVars: { $container_title: 'Box' } });
  assert.equal(byName.r.eff.text, 'a');
  assert.ok(byName.r.bindDiags.some((d) => /HOST-19/.test(d.msg)));
});

test('chest stack count is empty for 0 and 1; durability bindings give the max as a float', () => {
  const items = chestHost({ slots: [{ count: 0 }, { count: 1 }, { count: 2 }, { count: 64, durability: 4242 }] }).collections.container_items;
  assert.deepEqual(items.map((s) => s['#inventory_stack_count']), ['', '', '2', '64']);
  assert.deepEqual(fromJson(items[3]['#item_durability_total_amount']), num(4242));
  assert.deepEqual(fromJson(items[3]['#item_durability_current_amount']), num(4242));
  assert.equal(items[0]['#item_durability_total_amount'], undefined);
});

test('touch slot press picks first and swaps with the next slot; auto place moves', () => {
  const btn = (to) => ({ type: 'button', button_mappings: [{ from_button_id: 'button.menu_select', to_button_id: to, mapping_type: 'pressed' }] });
  const defs = { r: { type: 'panel', controls: [{ take: btn('button.container_take_all_place_all') }, { auto: btn('button.container_auto_place') }] } };
  const touch = run(defs, {}, { measured: true }, { platform: PLATFORMS.pocket });
  assert.match(touch.s.press(touch.byName.take).msg, /맞바꾼다/);
  assert.match(touch.s.press(touch.byName.auto).msg, /바로 옮긴다/);
  const desk = run(defs, {}, { measured: true }, { platform: PLATFORMS.desktop });
  assert.doesNotMatch(desk.s.press(desk.byName.take).msg, /맞바꾼다/);
});

test('item and player renderers above an ancestor layer sum of 94 are reported; horse renderer is not', () => {
  const r = (renderer, layer) => ({ type: 'custom', renderer, size: [16, 16], layer });
  const { tree } = run({ r: { type: 'panel', layer: 50, controls: [
    { low: r('inventory_item_renderer', 44) },
    { mid: r('live_player_renderer', 46) },
    { high: r('inventory_item_renderer', 49) },
    { horse: r('live_horse_renderer', 900) },
  ] } });
  const issues = findRendererIssues(layoutTree(tree, { w: 100, h: 100 })).map((i) => [i.node.name, i.level]);
  assert.deepEqual(issues, [['mid', 'info'], ['high', 'warn']]);
});

test('a digits-only #entity_id on a horse renderer is reported (EXP-30)', () => {
  const horse = (id) => ({ type: 'custom', renderer: 'live_horse_renderer', size: [16, 16], bindings: [{ binding_type: 'view', source_property_name: `(#id_${id} - 'x')`, target_property_name: '#entity_id' }] });
  const { tree } = run({ r: { type: 'panel', controls: [{ digits: horse('d') }, { quoted: horse('q') }] } }, { '#id_d': '-4294967295x', '#id_q': '"-4294967295"x' });
  const issues = findRendererIssues(layoutTree(tree, { w: 100, h: 100 })).map((i) => i.node.name);
  assert.deepEqual(issues, ['digits']);
});

test('alpha and size values in a property_bag apply only when a binding writes them (FILE-24)', () => {
  const box = (bindings) => ({ type: 'image', size: [20, 20], property_bag: { '#alpha': 0, '#size_binding_x': 0.5, '#size_binding_y': 0.5 }, bindings });
  const { byName } = run({ r: { type: 'panel', controls: [
    { bag: box([]) },
    { bound: box([{ binding_type: 'view', source_property_name: '((#alpha = #alpha) * 0)', target_property_name: '#alpha' }]) },
  ] } });
  assert.deepEqual([byName.bag.eff.alpha, byName.bag.eff['#size_binding_x'], byName.bound.eff.alpha], [1, undefined, 0]);
});

test('a factory inside a pack factory cell builds only with an always length (COL-48)', () => {
  const len = (cond) => [{ binding_name: '#n', binding_name_override: '#collection_length', ...(cond && { binding_condition: cond }) }];
  const cat = buildCatalog([pack({
    r: { type: 'panel', controls: [{ outer: { type: 'factory', control_ids: { x: '@n.layout' } } }] },
    layout: { type: 'panel', controls: [
      { fa: { type: 'stack_panel', factory: { name: 'fa', control_name: '@n.cell_default' }, bindings: len() } },
      { fb: { type: 'stack_panel', factory: { name: 'fb', control_name: '@n.cell_always' }, bindings: len() } },
    ] },
    cell_default: { type: 'panel', controls: [{ inner: { type: 'stack_panel', factory: { name: 'g', control_name: '@n.leaf' }, bindings: len() } }] },
    cell_always: { type: 'panel', controls: [{ inner: { type: 'stack_panel', factory: { name: 'g', control_name: '@n.leaf' }, bindings: len('always') } }] },
    leaf: { type: 'panel', size: [1, 1] },
  })]);
  const { tree } = buildTree(cat, 'n.r');
  new Session(cat, tree, { measured: true }).run({ globals: { '#n': 2 }, collections: {}, factories: { outer: { roles: ['x'], vars: {} } } });
  const leaves = (name) => { let n = 0; walk(tree, (c) => { if (c.name === 'inner_item' && c.parent.parent.parent.name === name) n++; }); return n; };
  assert.deepEqual([leaves('fa'), leaves('fb')], [0, 4]);
});

test('a length computed from #form_button_contents builds nothing (COL-36)', () => {
  const cat = buildCatalog([pack({
    r: { type: 'stack_panel', factory: { name: 'f', control_name: '@n.leaf' }, bindings: [{ binding_name: '(#form_button_length * 1)', binding_name_override: '#collection_length' }] },
    leaf: { type: 'panel', size: [1, 1] },
  })]);
  const { tree } = buildTree(cat, 'n.r');
  new Session(cat, tree, { measured: true }).run({ globals: { '#form_button_length': 3 }, collections: {}, factories: {} });
  assert.equal(tree.children.length, 0);
  assert.ok(tree.bindDiags.some((d) => /COL-36/.test(d.msg)));
});

test('collection_index reads only under a collection stack and never on a label (COL-02, COL-38, COL-50)', () => {
  const cell = (i, type = 'panel') => ({ [`c${type}${i}`]: { type, collection_index: i, size: [10, 10], controls: [{ [`t${type}${i}`]: label({ bindings: [{ binding_type: 'collection', binding_collection_name: 'form_buttons', binding_name: '#form_button_text', binding_name_override: '#text' }] }) }] } });
  const lab = (i) => ({ [`l${i}`]: label({ collection_index: i, bindings: [{ binding_type: 'collection', binding_collection_name: 'form_buttons', binding_name: '#form_button_text', binding_name_override: '#text' }] }) });
  const { byName } = run({ r: { type: 'panel', controls: [
    { s: { type: 'stack_panel', collection_name: 'form_buttons', controls: [cell(1), lab(2)] } },
    { p: { type: 'panel', collection_name: 'form_buttons', controls: [cell(2)] } },
  ] } }, {}, { measured: true }, {}, { form_buttons: [{ '#form_button_text': 'a' }, { '#form_button_text': 'b' }, { '#form_button_text': 'c' }] });
  assert.deepEqual([byName.tpanel1.eff.text, byName.tpanel2.eff.text, byName.l2.eff.text], ['b', 'a', '']);
  assert.ok(byName.p.bindDiags.some((d) => /COL-01/.test(d.msg)));
  assert.ok(byName.cpanel2.bindDiags.some((d) => /COL-38/.test(d.msg)));
  assert.ok(byName.l2.bindDiags.some((d) => /COL-02/.test(d.msg)));
});
