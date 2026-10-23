import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const atlas = JSON.parse(fs.readFileSync(new URL('../data/item-atlas.json', import.meta.url), 'utf8')).items;

test('item atlas: blocks are cubes, items and plants are flat pictures', () => {
  assert.equal(atlas[1].n, 'stone');
  assert.equal(atlas[1].b.length, 3);
  assert.equal(atlas[58].n, 'crafting_table');
  // the front shows on the right face, as in game
  assert.match(atlas[58].b[2], /crafting_table_front/);
  const byName = Object.fromEntries(Object.values(atlas).map((e) => [e.n, e]));
  assert.match(byName.diamond_sword.t, /diamond_sword/);
  assert.match(byName.golden_sword.t, /gold_sword/);
  assert.match(byName.poppy.t, /flower_rose/);
  // a glass pane is a thin plate (front texture, edge texture), as the game draws it
  // a slab is the lower half of the cell
  assert.equal(byName.cobblestone_slab.h, 8);
  assert.deepEqual(byName.glass_pane.p, ['textures/blocks/glass', 'textures/blocks/glass_pane_top']);
  const covered = Object.values(atlas).filter((e) => e.t || e.b || e.p).length;
  assert.ok(covered / Object.keys(atlas).length > 0.9);
});
