import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const atlas = JSON.parse(fs.readFileSync(new URL('../data/item-atlas.json', import.meta.url), 'utf8')).items;

test('item atlas: blocks are cubes, items and plants are flat pictures', () => {
  assert.equal(atlas[1].n, 'stone');
  assert.equal(atlas[1].b.length, 3);
  assert.equal(atlas[58].n, 'crafting_table');
  assert.match(atlas[58].b[1], /crafting_table_front/);
  const byName = Object.fromEntries(Object.values(atlas).map((e) => [e.n, e]));
  assert.match(byName.diamond_sword.t, /diamond_sword/);
  assert.match(byName.golden_sword.t, /gold_sword/);
  assert.match(byName.poppy.t, /flower_rose/);
  const covered = Object.values(atlas).filter((e) => e.t || e.b).length;
  assert.ok(covered / Object.keys(atlas).length > 0.9);
});
