#!/usr/bin/env node
// Builds data/item-atlas.json: numeric item ID (the one inside #item_id_aux = ID × 65536 + data)
// → the texture(s) its inventory icon uses, from a local Mojang/bedrock-samples checkout.
//   node tools/build-item-atlas.mjs [path to bedrock-samples]
// Items take their icon from item_texture.json, a BP item's minecraft:icon or, failing those, the
// closest file name under textures/items. Blocks take blocks.json (carried_textures first) through
// terrain_texture.json and are drawn as a cube, except plants and the like, which show flat.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from '../src/engine/jsonc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(process.argv[2] || path.join(here, '../../bedrock-samples'));
const rp = path.join(samples, 'resource_pack');
const read = (p) => {
  const r = parseJsonc(fs.readFileSync(p, 'utf8'));
  if (r.error) throw new Error(`${p}: ${r.error}`);
  return r.value;
};

const items = read(path.join(samples, 'metadata/vanilladata_modules/mojang-items.json')).data_items;
const itemTex = read(path.join(rp, 'textures/item_texture.json')).texture_data;
const terrain = read(path.join(rp, 'textures/terrain_texture.json')).texture_data;
const blocks = read(path.join(rp, 'blocks.json'));
const pngs = (dir) => fs.readdirSync(path.join(rp, dir)).filter((f) => f.endsWith('.png')).map((f) => `${dir}/${f.slice(0, -4)}`);
const itemPngs = pngs('textures/items');
const itemPngSet = new Set(itemPngs);
const bpIcons = {};
const bpItems = path.join(samples, 'behavior_pack/items');
if (fs.existsSync(bpItems)) {
  for (const f of fs.readdirSync(bpItems)) {
    const it = read(path.join(bpItems, f))['minecraft:item'];
    const icon = it?.components?.['minecraft:icon'];
    const key = typeof icon === 'string' ? icon : icon?.textures?.default;
    if (key) bpIcons[it.description.identifier.split(':')[1]] = key;
  }
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const texPath = (entry) => {
  if (!entry) return null;
  const t = first(entry.textures ?? entry);
  if (typeof t === 'string') return t;
  if (t && typeof t.path === 'string') return t.path;
  return null;
};
const itemTexture = (key) => texPath(itemTex[key]);
const terrainTexture = (key) => texPath(terrain[key]);

const SYNONYM = { golden: 'gold', wooden: 'wood' };
function fuzzyItem(name) {
  if (name.endsWith('_spawn_egg')) {
    const p = `textures/items/egg_${name.slice(0, -10).replace(/_/g, '')}`;
    return itemPngSet.has(p) ? p : null;
  }
  const toks = name.split('_').map((t) => SYNONYM[t] || t);
  let best = null;
  for (const p of itemPngs) {
    const base = p.slice('textures/items/'.length);
    if (base.startsWith('egg_')) continue;
    const bt = base.split('_');
    const joined = base.replace(/_/g, '');
    if (toks.every((t) => bt.includes(t) || (t.length > 3 && joined.includes(t)))) {
      if (!best || base.length < best.length - 'textures/items/'.length) best = p;
    }
  }
  return best;
}

// blocks whose inventory icon is a flat picture (plants, torches, doors, ...): matched by whole words
const FLAT = new Set('flower sapling torch rail rails ladder vine vines mushroom fern tallgrass grass_short crop wheat carrots potatoes beetroot kelp seagrass coral deadbush bush lever tripwire hook web cobweb lily waterlily lantern candle chain bars pane sign banner bed door cake dripstone roots sprouts pickle frogspawn lichen petals eyeblossom reeds bamboo propagule button plate repeater comparator hopper cauldron stand pot skull head anvil bell scaffolding campfire rose tulip orchid allium houstonia oxeye cornflower dandelion poppy lilac peony sunflower azure bluet wither cactus_flower pitcher torchflower spore blossom leaf_litter firefly'.split(' '));
const isFlat = (...names) => names.some((s) => s && s.split(/[_/]/).some((w) => FLAT.has(w)));
const ALIAS = { cod: 'fish', cooked_cod: 'cooked_fish', salmon: 'salmon', grass_block: 'grass', sea_lantern: 'seaLantern', sugar_cane: 'reeds', lapis_lazuli: 'dye_powder_blue', cocoa_beans: 'dye_powder_brown', ink_sac: 'dye_powder_black', bone_meal: 'dye_powder_white' };

const out = {};
let stats = { item: 0, block: 0, flatBlock: 0, missing: 0 };
const missing = [];
for (const it of items) {
  const name = it.name.split(':')[1];
  const id = it.raw_id;
  const alias = ALIAS[name];
  // 1) an item texture
  let t = itemTexture(bpIcons[name]) || itemTexture(name) || (itemPngSet.has(`textures/items/${name}`) ? `textures/items/${name}` : null);
  if (!t && alias) t = itemTexture(alias) || (itemPngSet.has(`textures/items/${alias}`) ? `textures/items/${alias}` : null);
  // 2) a block
  const bdef = blocks[name] || (alias && blocks[alias]);
  if (!t && bdef) {
    const tex = bdef.carried_textures || bdef.textures;
    const face = (k) => (typeof tex === 'string' ? terrainTexture(tex) : terrainTexture(tex?.[k]) || terrainTexture(tex?.side));
    const top = face('up'), left = face('south') || face('side'), right = face('east') || face('side');
    if (top || left) {
      if (isFlat(name, (left || '').split('/').pop())) { out[id] = { n: name, t: left || top }; stats.flatBlock++; }
      else { out[id] = { n: name, b: [top || left, left || top, right || left || top] }; stats.block++; }
      continue;
    }
  }
  // 3) the closest item file name
  if (!t) t = fuzzyItem(name);
  if (t) { out[id] = { n: name, t }; stats.item++; continue; }
  out[id] = { n: name };
  stats.missing++;
  missing.push(name);
}
const dest = path.join(here, '../data/item-atlas.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify({ source: 'Mojang/bedrock-samples', version: fs.existsSync(path.join(samples, 'version.json')) ? read(path.join(samples, 'version.json')).latest?.version : undefined, items: out }));
console.log(`items ${items.length}:`, stats);
console.log('no texture:', missing.join(', '));
