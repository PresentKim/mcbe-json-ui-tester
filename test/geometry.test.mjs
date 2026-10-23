import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeometryFiles, modelFaces, modelBounds, sphereFit } from '../src/engine/geometry.js';

const cube = (origin, size, uv) => ({ origin, size, uv });
const faces6 = (mat) => Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map((f) => [f, { uv: [0, 0], uv_size: [16, 16], ...(f === 'north' && mat ? { material_instance: mat } : {}) }]));

test('geometry: both file formats are read', () => {
  const m = parseGeometryFiles([
    JSON.stringify({ format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: 'geometry.a', texture_width: 32, texture_height: 16 }, bones: [] }] }),
    JSON.stringify({ format_version: '1.8.0', 'geometry.b:geometry.base': { texturewidth: 64, textureheight: 64, bones: [] } }),
  ]);
  assert.deepEqual([m.get('geometry.a').tw, m.get('geometry.a').th], [32, 16]);
  assert.equal(m.get('geometry.b').tw, 64);
});

test('geometry: an icon sees the top, east and north faces; north keeps its material (a drawer front)', () => {
  const geo = { tw: 16, th: 16, bones: [{ name: 'b', cubes: [cube([-8, 0, -8], [16, 16, 16], faces6('front'))] }] };
  const f = modelFaces(geo);
  assert.deepEqual(f.map((x) => x.name).sort(), ['east', 'north', 'up']);
  assert.equal(f.find((x) => x.name === 'north').material, 'front');
  assert.equal(f.find((x) => x.name === 'east').material, 'east');
});

test('geometry: a cube in front is drawn after one behind it', () => {
  // two small cubes: one at the north-east corner (near the viewer), one at the south-west (far)
  const geo = { tw: 16, th: 16, bones: [{ name: 'b', cubes: [cube([4, 0, -8], [4, 4, 4], faces6()), cube([-8, 0, 4], [4, 4, 4], faces6())] }] };
  const f = modelFaces(geo);
  const lastFar = Math.max(...f.map((x, i) => (x.o[0] < 0 ? i : -1)));
  const firstNear = Math.min(...f.map((x, i) => (x.o[0] > 0 ? i : Infinity)));
  assert.ok(lastFar < firstNear);
});

test('geometry: models are fitted by their bounding sphere (measured: sieve 1.12, pane 1.22)', () => {
  const sieve = { tw: 16, th: 16, bones: [{ name: 'b', cubes: [cube([-7, 0, -7], [14, 15, 14], faces6())] }] };
  assert.deepEqual(modelBounds(sieve), [[-7, 0, -7], [7, 15, 7]]);
  assert.ok(Math.abs(sphereFit(modelBounds(sieve)) - 1.116) < 0.005);
  assert.ok(Math.abs(sphereFit([[0, 0, 7], [16, 16, 9]]) - 1.22) < 0.005);
  assert.equal(sphereFit([[-8, 0, -8], [8, 16, 8]]), 1);
});

test('geometry: a bone rotation turns its cubes about the pivot', () => {
  const geo = { tw: 16, th: 16, bones: [{ name: 'b', pivot: [0, 0, 0], rotation: [0, 90, 0], cubes: [cube([0, 0, -1], [8, 2, 2], faces6())] }] };
  const [lo, hi] = modelBounds(geo);
  // an 8-long bar along +x turned 90° about y lies along z
  assert.ok(Math.abs(hi[2] - lo[2] - 8) < 1e-9 && Math.abs(hi[0] - lo[0] - 2) < 1e-9);
});
