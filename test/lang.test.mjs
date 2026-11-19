import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLang, localize } from '../src/engine/lang.js';

const lang = parseLang('﻿## comment\ncontainer.inventory=Inventory\nmenu.play=Play=Now\ngui.ok=OK\n');

test('lang files map keys to the text after the first =', () => {
  assert.equal(lang.get('menu.play'), 'Play=Now');
  assert.equal(lang.has('## comment'), false);
});

test('labels translate a whole key, then lowercase, else keep the text', () => {
  assert.equal(localize('container.inventory', lang), 'Inventory');
  assert.equal(localize('GUI.OK', lang), 'OK');
  assert.equal(localize('Hello', lang), 'Hello');
});

test('% tokens translate one by one and lose the %', () => {
  assert.equal(localize('%gui.ok: %missing.key', lang), 'OK: missing.key');
});
