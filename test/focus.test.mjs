import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { Session, walk } from '../src/engine/bind.js';
import { layoutTree } from '../src/engine/layout.js';

const pack = (defs) => ({ name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/n.json'] }), 'ui/n.json': JSON.stringify({ namespace: 'n', ...defs }) } });
const corner = { anchor_from: 'top_left', anchor_to: 'top_left' };
const panel = (controls, extra = {}) => ({ type: 'panel', size: [200, 200], ...corner, controls, ...extra });
const btn = (x, y, extra = {}) => ({
  type: 'button', size: [50, 20], offset: [x, y], ...corner, focus_enabled: true,
  default_control: 'idle', hover_control: 'lit',
  button_mappings: [{ from_button_id: 'button.menu_ok', to_button_id: 'go', mapping_type: 'focused' }],
  controls: [{ idle: { type: 'panel' } }, { lit: { type: 'panel' } }],
  ...extra,
});
const grid = (extra = {}) => [{ a: btn(0, 0, extra.a) }, { b: btn(100, 0, extra.b) }, { c: btn(0, 50, extra.c) }, { d: btn(100, 50, extra.d) }];

function run(r, globals = {}) {
  const cat = buildCatalog([pack({ r })]);
  const { tree } = buildTree(cat, 'n.r');
  const s = new Session(cat, tree, { measured: true });
  s.run({ globals, collections: {}, factories: {} });
  layoutTree(tree, { w: 200, h: 200 });
  const byName = {};
  walk(tree, (n) => { byName[n.name] = n; });
  const nodes = () => { const out = []; walk(tree, (n) => { if (n.rect) out.push(n); }); return out; };
  const hover = (x, y) => { const h = s.hoverAt(nodes(), x, y); s.applyAll(); return h; };
  const focused = () => s.focusNode()?.name ?? null;
  const move = (...dirs) => { for (const d of dirs) s.moveFocus(d); return focused(); };
  return { s, byName, hover, focused, move };
}

test('controls outside the highest-layer modal get no hover or focus', () => {
  const { s, byName, hover } = run(panel([
    { a: btn(0, 0) },
    { low: { type: 'input_panel', modal: true, layer: 1, size: [60, 30], offset: [0, 100], ...corner, controls: [{ m1: btn(0, 0) }] } },
    { top: { type: 'input_panel', modal: true, layer: 5, size: [60, 30], offset: [100, 100], ...corner, controls: [{ m2: btn(0, 0, { layer: 1 }) }] } },
  ]));
  assert.equal(s.activeModal(), byName.top);
  hover(5, 5);
  assert.equal(s.hoverUids.size, 0);
  hover(5, 105);
  assert.equal(s.hoverUids.size, 0);
  hover(105, 105);
  assert.ok(s.hoverUids.has(byName.m2.uid));
  assert.deepEqual(s.focusList().map((n) => n.name), ['m2']);
});

test('without a modal the screen root is the active modal', () => {
  const { s } = run(panel(grid()));
  assert.equal(s.activeModal(), s.tree);
  assert.equal(s.focusList().length, 4);
});

test('inline_modal frees only scroll views outside the modal', () => {
  const { s, byName } = run(panel([
    { a: btn(0, 0) },
    { sv: { type: 'scroll_view', size: [50, 50], offset: [0, 50], ...corner } },
    { m: { type: 'input_panel', modal: true, inline_modal: true, size: [60, 30], offset: [100, 100], ...corner } },
  ]));
  const allowed = s.modalFilter();
  assert.equal(allowed(byName.sv), true);
  assert.equal(allowed(byName.a), false);
});

test('same-layer input goes to the earlier control first', () => {
  const { s, byName, hover } = run(panel([{ first: btn(0, 0) }, { second: btn(0, 0) }]));
  hover(5, 5);
  assert.deepEqual([...s.hoverUids], [byName.first.uid]);
});

test('initial focus takes the highest precedence, then reading order', () => {
  assert.equal(run(panel(grid())).move(2), 'a');
  assert.equal(run(panel(grid({ c: { default_focus_precedence: 5 }, d: { default_focus_precedence: 5 } }))).move(2), 'c');
  assert.equal(run(panel(grid({ a: { focus_enabled: false } }))).move(2), 'b');
});

test('all negative precedences leave nothing focused', () => {
  const p = { default_focus_precedence: -20 };
  const { s, move } = run(panel(grid({ a: p, b: p, c: p, d: p })));
  assert.equal(move(2), null);
  assert.match(s.moveFocus(2).msg, /negative/);
});

test('non-focus types are not candidates', () => {
  const { s } = run(panel([{ p: { type: 'panel', size: [10, 10], focus_enabled: true } }, { a: btn(0, 50) }]));
  assert.deepEqual(s.focusList().map((n) => n.name), ['a']);
});

test('arrows move to the nearest control in that direction', () => {
  const { move } = run(panel(grid()));
  assert.equal(move(2, 4), 'b');
  assert.equal(move(2), 'd');
  assert.equal(move(3), 'c');
});

test('wrap restarts from the opposite edge unless focus_wrap_enabled is false', () => {
  assert.equal(run(panel(grid())).move(2, 1), 'c');
  assert.equal(run(panel(grid({ a: { focus_wrap_enabled: false } }))).move(2, 1), 'a');
});

test('FOCUS_OVERRIDE_STOP keeps focus', () => {
  assert.equal(run(panel(grid({ a: { focus_change_right: 'FOCUS_OVERRIDE_STOP' } }))).move(2, 4), 'a');
});

test('focus_change jumps to the first matching focus_identifier', () => {
  const { move } = run(panel(grid({ a: { focus_change_right: 'far' }, d: { focus_identifier: 'far' } })));
  assert.equal(move(2, 4), 'd');
});

test('a missing focus_identifier falls back to geometry', () => {
  assert.equal(run(panel(grid({ a: { focus_change_right: 'nope' } }))).move(2, 4), 'b');
});

test('focus draws as hover at its center and takes menu_ok first', () => {
  const { s, byName, hover, move } = run(panel(grid()));
  move(2, 4);
  hover(5, 55);
  assert.equal(byName.b.stateName, 'hover_control');
  const [r] = s.pointerButton(true, { x: 125, y: 10, id: 'button.menu_ok' });
  assert.equal(r.node, byName.b);
  assert.equal(r.to, 'go');
});

test('focus_navigation_mode stop and contained keep focus inside the container', () => {
  const box = () => panel([
    { box: { type: 'panel', size: [60, 100], ...corner, focus_container: true, bindings: [{ binding_name: '#focus_navigation_mode_right' }], controls: [{ a: btn(0, 0) }, { c: btn(0, 50) }] } },
    { b: btn(100, 0) },
  ]);
  assert.equal(run(box()).move(2, 4), 'b');
  assert.equal(run(box(), { '#focus_navigation_mode_right': 'stop' }).move(2, 4), 'a');
  assert.equal(run(box(), { '#focus_navigation_mode_right': 'contained' }).move(2, 4), 'a');
});

test('use_last_focus returns to the last focused control of the container', () => {
  const { s, byName, move } = run(panel([
    { a: btn(0, 0) },
    { right: { type: 'panel', size: [100, 100], offset: [100, 0], ...corner, focus_container: true, use_last_focus: true, controls: [{ b: btn(0, 0) }, { d: btn(0, 50) }] } },
  ]));
  s.setFocus(byName.d);
  s.setFocus(byName.a);
  assert.equal(move(4), 'd');
});

test('the pointer focuses the first candidate under it', () => {
  const { s } = run(panel([{ first: btn(0, 0) }, { second: btn(0, 0) }, { c: btn(0, 50) }]));
  assert.equal(s.focusAt(10, 10).name, 'first');
  assert.equal(s.focusAt(150, 150), null);
  assert.equal(s.focusNode().name, 'first');
});
