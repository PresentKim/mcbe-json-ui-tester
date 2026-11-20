import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutText } from '../src/engine/font.js';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { Session, walk } from '../src/engine/bind.js';
import { layoutTree } from '../src/engine/layout.js';
import { applyCode, labelPaint, shadowCss } from '../src/render.js';

const adv = () => 5;
const lay = (text, scale = 1, maxWidth = Infinity, opts) => layoutText(text, scale, maxWidth, adv, opts);

function label(props) {
  const pack = { name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/n.json'] }), 'ui/n.json': JSON.stringify({ namespace: 'n', r: { type: 'panel', controls: [{ l: { type: 'label', ...props } }] } }) } };
  const cat = buildCatalog([pack]);
  const { tree } = buildTree(cat, 'n.r');
  new Session(cat, tree, { measured: true }).run({ globals: {}, collections: {}, factories: {} });
  layoutTree(tree, { w: 200, h: 100 });
  let found;
  walk(tree, (n) => { if (n.name === 'l') found = n; });
  return found;
}

test('colour codes keep bold, only §r ends it', () => {
  assert.equal(lay('§lab§ccd§re').w, 29);
});

test('uppercase codes have no effect', () => {
  assert.equal(lay('§Lab').w, 10);
});

test('bold adds 1 to spaces too', () => {
  assert.equal(lay('§la b').w, 18);
});

test('line width is ceiled after scaling', () => {
  assert.equal(lay('abc', 0.7).w, 11);
});

test('line_padding adds to every line and scales', () => {
  assert.equal(lay('a\nb', 2, Infinity, { linePadding: 4 }).h, 56);
});

test('lines past the height end the last kept line in ...', () => {
  const r = lay('aaa bbb ccc', 1, 40, { maxHeight: 10 });
  assert.deepEqual(r.lineTexts.map((l) => l.text), ['aaa b...']);
  assert.equal(r.ellipsis, true);
});

test('a line too narrow for ... is left empty', () => {
  assert.equal(lay('aa aa', 1, 10, { maxHeight: 10 }).lineTexts[0].text, '');
});

test('text that fits sets no ellipsis', () => {
  assert.equal(lay('aaa bbb ccc', 1, 40, { maxHeight: 20 }).ellipsis, false);
});

test('unicode flag follows non-ASCII glyphs', () => {
  assert.equal(lay('§a가').unicode, true);
  assert.equal(lay('a b').unicode, false);
});

test('a label cut by its height writes #using_ellipses', () => {
  const n = label({ size: [40, 10], text: 'aaa bbb ccc' });
  assert.equal(n.textLines.at(-1).text, 'aaa ...');
  assert.deepEqual(n.bag.get('#using_ellipses'), { k: 'bool', v: true });
});

test('a default-sized label grows by line_padding', () => {
  assert.equal(label({ text: 'a\nb', line_padding: 2 }).size[1], 24);
});

test('shadow is the text colour x 0.25 with its alpha', () => {
  assert.equal(shadowCss([200, 100, 40, 0.5]), 'rgba(50,25,10,0.5)');
});

test('a colour code keeps bold and the base alpha', () => {
  const s = { color: [255, 255, 255, 0.5], bold: true };
  applyCode(s, '6', s.color);
  assert.deepEqual(s, { color: [255, 170, 0, 0.5], bold: true });
  applyCode(s, 'L', [0, 0, 0, 1]);
  assert.deepEqual(s, { color: [255, 170, 0, 0.5], bold: true });
});

test('a disabled ancestor switches a label to locked_color and locked_alpha', () => {
  const props = { color: [1, 0, 0], locked_color: [0, 1, 0], locked_alpha: 0.5 };
  const n = { eff: { enabled: true }, props, parent: { eff: { enabled: false }, props: {} } };
  assert.deepEqual(labelPaint(n), { color: [0, 255, 0, 1], alpha: 0.5 });
  assert.deepEqual(labelPaint({ ...n, parent: null }), { color: [255, 0, 0, 1], alpha: 1 });
});
