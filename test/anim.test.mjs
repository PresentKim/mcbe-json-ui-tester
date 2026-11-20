import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { Session, walk } from '../src/engine/bind.js';
import { layoutTree } from '../src/engine/layout.js';
import { EASINGS } from '../src/engine/anim.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

function setup(defs, prepare = () => {}) {
  const files = { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/t.json'] }), 'ui/t.json': JSON.stringify({ namespace: 't', ...defs }) };
  const cat = buildCatalog([{ name: 't', vanilla: true, files }]);
  const { tree } = buildTree(cat, 't.root');
  const s = new Session(cat, tree);
  prepare(s);
  s.run({ globals: {}, collections: {}, factories: {} });
  const find = (name) => { let hit = null; walk(tree, (n) => { if (n.name === name) hit = n; }); return hit; };
  return { s, tree, find };
}

const root = (controls) => ({ type: 'panel', size: [200, 100], controls });

test('easing values', () => {
  assert.equal(Object.keys(EASINGS).length, 32);
  near(EASINGS.linear(0, 10, 0.25), 2.5);
  near(EASINGS.out_bounce(0, 1, 0.5), 0.765625);
  near(EASINGS.in_back(0, 1, 0.5), -0.0876975);
  near(EASINGS.spring(0, 1, 0.5), 1.0510158018655051);
  near(EASINGS.spring(0, 1, 1), 1);
});

test('alpha goes from to over duration', () => {
  const { s, find } = setup({ fade: { anim_type: 'alpha', from: 0, to: 1, duration: 2 }, root: root([{ img: { type: 'image', alpha: '@t.fade' } }]) });
  near(find('img').eff.alpha, 0);
  s.advanceAnimations(1);
  near(find('img').eff.alpha, 0.5);
  s.advanceAnimations(1.5);
  near(find('img').eff.alpha, 1);
});

test('next carries overflow time', () => {
  const { s, find } = setup({
    a: { anim_type: 'alpha', from: 0, to: 1, duration: 1, next: '@t.b' },
    b: { anim_type: 'alpha', from: 1, to: 0, duration: 2 },
    root: root([{ img: { type: 'image', alpha: '@t.a' } }]),
  });
  s.advanceAnimations(1.5);
  near(find('img').eff.alpha, 0.75);
});

test('flip_book steps one frame per interval and writes uv', () => {
  const { s, find } = setup(
    { fb: { anim_type: 'flip_book', fps: 10, frame_count: 4 }, root: root([{ img: { type: 'image', texture: 'x', uv: '@t.fb', uv_size: [8, 8] } }]) },
    (s) => { s.anim.textureSize = () => [32, 8]; },
  );
  const img = find('img');
  near(img.eff.uv[0], 1 / 256);
  near(img.eff.uv_size[0], 8 - 1 / 128);
  assert.equal(img.eff.uv_size[1], 8);
  s.advanceAnimations(0.12);
  near(img.eff.uv[0], 8 + 1 / 256);
  s.advanceAnimations(0.05);
  near(img.eff.uv[0], 8 + 1 / 256);
  s.advanceAnimations(0.5);
  near(img.eff.uv[0], 16 + 1 / 256);
});

test('offset animation replaces the static offset in layout', () => {
  const { s, tree, find } = setup({
    slide: { anim_type: 'offset', from: [0, 0], to: ['100% - 10px', 0], duration: 1 },
    root: root([{ box: { type: 'panel', size: [10, 10], anchor_from: 'top_left', anchor_to: 'top_left', offset: [5, 5], anims: ['@t.slide'] } }]),
  });
  layoutTree(tree, { w: 200, h: 100 });
  near(find('box').rect.x, 0);
  near(find('box').rect.y, 0);
  assert.equal(s.advanceAnimations(0.5).layout, true);
  layoutTree(tree, { w: 200, h: 100 });
  near(find('box').rect.x, 95);
});

test('reference starts at from while waiting for play_event', () => {
  const { s, find } = setup({
    fade: { anim_type: 'alpha', from: 0.25, to: 1, duration: 1, play_event: 'go' },
    root: root([
      { img: { type: 'image', alpha: '@t.fade' } },
      { btn: { type: 'button', button_mappings: [{ from_button_id: 'button.menu_select', to_button_id: 'go', mapping_type: 'pressed' }] } },
    ]),
  });
  near(find('img').eff.alpha, 0.25);
  s.advanceAnimations(1);
  near(find('img').eff.alpha, 0.25);
  assert.equal(s.press(find('btn')).anim.reacted, 1);
  s.advanceAnimations(0.5);
  near(find('img').eff.alpha, 0.625);
});

test('destroy_at_end removes the named ancestor and sends end_event', () => {
  const { s, find } = setup({
    out: { anim_type: 'alpha', from: 1, to: 0, duration: 1, destroy_at_end: 'holder', end_event: 'done' },
    root: root([{ holder: { type: 'panel', controls: [{ img: { type: 'image', alpha: '@t.out' } }] } }]),
  });
  const r = s.advanceAnimations(2);
  assert.deepEqual(r.events, ['done']);
  assert.equal(r.destroyed, true);
  assert.equal(find('holder'), null);
});
