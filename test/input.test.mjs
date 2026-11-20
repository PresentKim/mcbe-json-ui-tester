import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { Session, walk } from '../src/engine/bind.js';
import { layoutTree, wheelScroll } from '../src/engine/layout.js';

const pack = (defs) => ({ name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/n.json'] }), 'ui/n.json': JSON.stringify({ namespace: 'n', ...defs }) } });
const corner = { anchor_from: 'top_left', anchor_to: 'top_left' };
const select = (to, extra = {}) => ({ from_button_id: 'button.menu_select', to_button_id: to, mapping_type: 'pressed', ...extra });
const panel = (controls) => ({ type: 'panel', size: [200, 200], controls });
const btn = (extra = {}) => ({
  type: 'button', size: [50, 20], ...corner,
  default_control: 'd', hover_control: 'h', pressed_control: 'p', locked_control: 'l',
  button_mappings: [select('go')],
  controls: ['d', 'h', 'p', 'l'].map((k) => ({ [k]: { type: 'panel' } })),
  ...extra,
});
const STATES = ['unchecked_control', 'checked_control', 'unchecked_hover_control', 'checked_hover_control', 'unchecked_locked_control', 'checked_locked_control', 'unchecked_locked_hover_control', 'checked_locked_hover_control'];
const toggle = (extra = {}) => ({
  type: 'toggle', size: [50, 20], ...corner,
  toggle_on_button: 'on', toggle_off_button: 'off',
  button_mappings: [select('button.menu_select')],
  ...Object.fromEntries(STATES.map((k, i) => [k, `s${i}`])),
  controls: STATES.map((k, i) => ({ [`s${i}`]: { type: 'panel' } })),
  ...extra,
});

function run(r, opts = { measured: true }, collections = {}) {
  const cat = buildCatalog([pack({ r })]);
  const { tree } = buildTree(cat, 'n.r');
  const s = new Session(cat, tree, opts);
  s.run({ globals: {}, collections, factories: {} });
  layoutTree(tree, { w: 200, h: 200 });
  const byName = {};
  walk(tree, (n) => { byName[n.name] = n; });
  const nodes = () => { const out = []; walk(tree, (n) => { if (n.rect) out.push(n); }); return out; };
  const hover = (x, y) => { const h = s.hoverAt(nodes(), x, y); s.applyAll(); return h; };
  return { tree, s, byName, nodes, hover };
}

test('a locked button shows locked_control, or default_control when it has none', () => {
  const { byName } = run(panel([{ a: btn({ enabled: false }) }, { b: btn({ enabled: false, locked_control: '' }) }]));
  assert.equal(byName.a.stateName, 'locked_control');
  assert.equal(byName.b.stateName, 'default_control');
});

test('pressed_control shows while the pointer is held and beats hover', () => {
  const { s, byName, hover } = run(panel([{ a: btn() }]));
  hover(5, 5);
  assert.equal(byName.a.stateName, 'hover_control');
  s.pointerButton(true, { x: 5, y: 5 });
  s.applyAll();
  assert.equal(byName.a.stateName, 'pressed_control');
  s.pointerButton(false, { x: 5, y: 5 });
  s.applyAll();
  assert.equal(byName.a.stateName, 'hover_control');
});

test('leaving hover releases a pressed button', () => {
  const { s, byName, hover } = run(panel([{ a: btn() }]));
  hover(5, 5);
  s.pointerButton(true, { x: 5, y: 5 });
  hover(150, 150);
  assert.equal(byName.a.stateName, 'default_control');
});

test('hover skips locked controls, hover_enabled false and points outside the clip', () => {
  const { s, byName, hover } = run(panel([
    { locked: btn({ enabled: false }) },
    { off: btn({ offset: [60, 0], hover_enabled: false }) },
    { box: { type: 'panel', size: [10, 10], offset: [0, 100], ...corner, clips_children: true, controls: [{ clipped: btn() }] } },
  ]));
  hover(5, 5);
  hover(65, 5);
  assert.equal(s.hoverUids.size, 0);
  hover(30, 105);
  assert.equal(s.hoverUids.size, 0);
  hover(5, 105);
  assert.ok(s.hoverUids.has(byName.clipped.uid));
});

test('consume_hover_events decides whether a control below also gets hover', () => {
  const both = run(panel([{ top: btn({ layer: 2, consume_hover_events: false }) }, { under: btn() }]));
  both.hover(5, 5);
  assert.deepEqual([both.byName.top.stateName, both.byName.under.stateName], ['hover_control', 'hover_control']);
  const one = run(panel([{ top: btn({ layer: 2 }) }, { under: btn() }]));
  one.hover(5, 5);
  assert.deepEqual([one.byName.top.stateName, one.byName.under.stateName], ['hover_control', 'default_control']);
});

test('toggle state is checked + 4 x hover + 8 x locked with no fallback', () => {
  const { byName, hover } = run(panel([
    { t: toggle({ unchecked_hover_control: '' }) },
    { l: toggle({ offset: [60, 0], enabled: false }) },
  ]));
  hover(5, 5);
  assert.equal(byName.t.stateName, 'unchecked_hover_control');
  assert.ok(byName.t.bindDiags.some((d) => /INP-10/.test(d.msg)));
  assert.ok(byName.t.children.filter((c) => c.name !== 's2').every((c) => !c.effVisible));
  hover(65, 5);
  assert.equal(byName.l.stateName, 'unchecked_locked_control');
});

test('a toggle starts at toggle_default_state, not its property bag', () => {
  const { byName } = run(panel([
    { on: toggle({ toggle_default_state: true }) },
    { off: toggle({ property_bag: { '#toggle_state': true } }) },
  ]));
  assert.deepEqual([byName.on.eff.toggle_state, byName.off.eff.toggle_state], [true, false]);
});

test('a radio toggle takes its index from the toggle_grid_collection_name item', () => {
  const radio = toggle({ radio_toggle_group: true, toggle_name: 'g', toggle_grid_collection_name: 'tabs', toggle_group_default_selected: 2 });
  const { byName } = run(panel([{ list: { type: 'stack_panel', collection_name: 'tabs', controls: [2, 1, 0].map((index, i) => ({ [`c${i}`]: { type: 'panel', size: [50, 20], collection_index: index, controls: [{ [`t${i}`]: radio }] } })) } }]));
  assert.deepEqual(['t0', 't1', 't2'].map((n) => byName[n].eff.toggle_state), [true, false, false]);
});

for (const measured of [true, false]) {
  test(`a toggle without toggle_on_button flips (INP-11, measured: ${measured})`, () => {
    const bare = toggle({ toggle_on_button: '', toggle_off_button: '' });
    const r = run(panel([{ t: bare }]), { measured });
    assert.match(r.s.press(r.byName.t).msg, /INP-11/);
    r.s.applyAll();
    assert.equal(r.byName.t.eff.toggle_state, true);
  });
}

test('a toggle without a mapping for the input is not pressed', () => {
  const { s, byName } = run(panel([{ t: toggle({ button_mappings: [] }) }]), { measured: false });
  s.press(byName.t);
  s.applyAll();
  assert.equal(byName.t.eff.toggle_state, false);
});

test('mappings run in array order and stop at the first that fires', () => {
  const { s, byName } = run(panel([
    { a: btn({ button_mappings: [select('first'), select('second')] }) },
    { b: btn({ button_mappings: [select('pad', { input_mode_condition: 'gamepad' }), select('mouse')] }) },
    { c: btn({ button_mappings: [{ from_button_id: 'any', to_button_id: 'x' }] }) },
  ]));
  assert.deepEqual(['a', 'b', 'c'].map((n) => s.press(byName[n]).to), ['first', 'mouse', 'button.menu_select']);
});

test('a mapping without from_button_id is a hover notification, not a click', () => {
  const { s, byName, hover } = run(panel([{ a: btn({ button_mappings: [{ to_button_id: 'hint', mapping_type: 'pressed' }] }) }]));
  assert.equal(s.press(byName.a).kind, 'none');
  assert.deepEqual(hover(5, 5).notes.map((n) => n.to), ['hint']);
  assert.match(hover(150, 150).notes[0].msg, /leave/);
});

test('a global mapping fires without hover', () => {
  const { s, hover } = run(panel([{ a: btn({ button_mappings: [select('g', { mapping_type: 'global' })] }) }]));
  hover(150, 150);
  assert.deepEqual(s.pointerButton(true, { x: 150, y: 150 }).map((r) => r.to), ['g']);
});

test('a second press within 500 ms sends only the double_pressed mapping', () => {
  const { s, hover } = run(panel([{ a: btn({ button_mappings: [select('one'), select('two', { mapping_type: 'double_pressed' })] }) }]));
  hover(5, 5);
  const click = (now) => { const r = s.pointerButton(true, { x: 5, y: 5, now }); s.pointerButton(false, { x: 5, y: 5, now }); return r.map((x) => x.to); };
  assert.deepEqual([click(0), click(200), click(2000)], [['one'], ['two'], ['one']]);
});

test('an event stops only when both the button and the mapping consume it', () => {
  const reached = (top) => {
    const { s, hover } = run(panel([{ top: btn({ layer: 2, consume_hover_events: false, ...top }) }, { under: btn() }]));
    hover(5, 5);
    return s.pointerButton(true, { x: 5, y: 5 }).length;
  };
  assert.equal(reached({}), 1);
  assert.equal(reached({ consume_event: false }), 2);
  assert.equal(reached({ button_mappings: [select('go', { consume_event: false })] }), 2);
});

const scroller = (contentH, extra = {}) => ({
  type: 'scroll_view', size: [100, 100], ...corner,
  scroll_content: 'content', scroll_view_port: 'port', scrollbar_track: 'track', scrollbar_box: 'box', scroll_box_and_track_panel: 'bar',
  ...extra,
  controls: [
    { port: { type: 'panel', size: [90, 100], ...corner, clips_children: true, controls: [{ content: { type: 'panel', size: [90, contentH], ...corner } }] } },
    { bar: { type: 'panel', size: [6, 100], anchor_from: 'top_right', anchor_to: 'top_right', controls: [
      { track: { type: 'panel', size: [6, 80], ...corner } },
      { box: { type: 'scrollbar_box', draggable: 'vertical', ...corner } },
    ] } },
  ],
});

test('the scrollbar box is ceil(track x clamp(viewport / content, 0.1, 1)) long', () => {
  assert.deepEqual([400, 300, 2000, 50].map((h) => run(scroller(h)).byName.box.rect.h), [20, 27, 8, 80]);
});

test('the wheel moves the content and box, clamps, and keeps the first scroll_speed for every view', () => {
  const { tree, byName } = run(panel([{ a: scroller(400, { scroll_speed: 2 }) }, { b: { type: 'panel', size: [100, 100], offset: [0, 100], ...corner, controls: [{ v: scroller(400, { scroll_speed: 5 }) }] } }]));
  const under = (view, name) => { let hit = null; walk(view, (n) => { if (n.name === name) hit = n; }); return hit; };
  const [a, b] = [byName.a, byName.v];
  assert.equal(a.bag.get('#scrolled_to_end').v, false);
  wheelScroll(a, -1);
  wheelScroll(b, -1);
  layoutTree(tree, { w: 200, h: 200 });
  assert.deepEqual([a.scrollPos, b.scrollPos], [40, 40]);
  assert.equal(under(a, 'content').rect.y, a.rect.y - 40);
  assert.equal(under(a, 'box').rect.y, a.rect.y + 8);
  wheelScroll(a, -20);
  layoutTree(tree, { w: 200, h: 200 });
  assert.equal(a.scrollPos, 300);
  assert.equal(a.bag.get('#scrolled_to_end').v, true);
  assert.equal(a.bag.get('#scrollbar_hit_bottom').v, true);
});
