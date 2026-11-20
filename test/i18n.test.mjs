import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { t, setLocale } from '../src/i18n.js';
import { KO } from '../src/locales/ko.js';

const SOURCES = ['src/app.js', 'src/render.js', 'cli.mjs', ...fs.readdirSync('src/engine').map((f) => `src/engine/${f}`)];

function keysIn(file) {
  const text = fs.readFileSync(file, 'utf8');
  const keys = [];
  for (const m of text.matchAll(/\bt\((['"])((?:\\.|(?!\1).)*)\1/g)) keys.push(m[2].replace(/\\(.)/g, '$1'));
  return keys;
}

test('every message has a Korean translation', () => {
  const missing = SOURCES.flatMap((f) => keysIn(f).filter((k) => !(k in KO)).map((k) => `${f}: ${k}`));
  assert.deepEqual(missing, []);
});

test('Korean translations keep the placeholders', () => {
  const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const broken = Object.entries(KO).filter(([en, ko]) => names(en).join() !== names(ko).join()).map(([en]) => en);
  assert.deepEqual(broken, []);
});

test('English is the default and Korean is chosen by locale', () => {
  assert.equal(t('No namespace'), 'No namespace');
  setLocale('ko');
  assert.equal(t('Inheritance cycle: {chain}', { chain: 'a > b' }), '상속 순환: a > b');
  setLocale('xx');
  assert.equal(t('No namespace'), 'No namespace');
  setLocale('en');
});
