import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { PLATFORMS } from '../src/engine/host.js';

const profiles = Object.entries(PLATFORMS);

test('input mode is named $game_pad, never $gamepad', () => {
  for (const [, p] of profiles) {
    assert.equal(p.$game_pad, false);
    assert.ok(!('$gamepad' in p));
  }
});

test('desktop reads as mouse input and the desktop UI profile', () => {
  const p = PLATFORMS.desktop;
  assert.deepEqual([p.$desktop_screen, p.$pocket_screen, p.$mouse, p.$touch, p.$game_pad], [true, false, true, false, false]);
});

test('pocket reads as a touch mobile device with the pocket UI profile', () => {
  const p = PLATFORMS.pocket;
  assert.deepEqual([p.$desktop_screen, p.$pocket_screen, p.$mouse, p.$touch, p.$game_pad], [false, true, false, true, false]);
  assert.deepEqual([p.$pocket_edition, p.$win10_edition, p.$is_desktop], [true, false, false]);
});

test('desktop holds the constants of the Windows build', () => {
  const p = PLATFORMS.desktop;
  assert.equal(p.$win10_edition, true);
  assert.equal(p.$pocket_edition, false);
  assert.equal(p.$build_platform_UWP, false);
  assert.equal(p.$is_publish, true);
  assert.equal(p.$pre_release, false);
  assert.equal(p.$is_preview_app, false);
  assert.equal(p.$new_video_settings, true);
  assert.equal(p.$is_xboxlive_enabled, true);
  assert.equal(p.$fire_tv, false);
});

test('desktop Win32 build platform reads as microsoft and not another platform', () => {
  const p = PLATFORMS.desktop;
  assert.equal(p.$microsoft_os, true);
  assert.equal(p.$ms_platform, true);
  for (const k of ['$is_android', '$is_ios', '$apple_os', '$google_os', '$nx_os', '$is_ps4', '$thirdpartyconsole']) assert.equal(p[k], false, k);
});

test('every profile value is a boolean', () => {
  for (const [name, p] of profiles) for (const [k, v] of Object.entries(p)) assert.equal(typeof v, 'boolean', `${name} ${k}`);
});

test('profile variables are declared in the root scope', () => {
  const pack = { name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/n.json'] }), 'ui/n.json': JSON.stringify({ namespace: 'n', r: { type: 'panel' } }) } };
  const cat = buildCatalog([pack]);
  const { rootScope } = buildTree(cat, 'n.r', { platform: PLATFORMS.pocket });
  assert.equal(rootScope.lookup('$game_pad'), false);
  assert.equal(rootScope.lookup('$pocket_edition'), true);
  assert.equal(rootScope.lookup('$pocket_screen'), true);
  assert.equal(rootScope.lookup('$gamepad'), undefined);
});
