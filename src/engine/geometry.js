// Block models (models/**/*.geo.json) turned into the faces an item icon shows.
// Formats: 1.12+ ("minecraft:geometry": [{ description, bones }]) and 1.8 ("geometry.x": { bones }).
// Cubes: origin, size, inflate, per-face uv ({ north: { uv, uv_size, material_instance } }) or box uv
// ([u, v]), rotation about pivot; bones: pivot, rotation, parent.
//
// Model space is the block's: x from -8 to 8 (east +x), y from 0 to 16, z from -8 to 8 (north -z).
// The icon sees the model from above its north-east corner: east on the left, north on the right
// (measured in game 2026-10-23: a drawer whose north face is its "front" material shows the front on
// the right, where a cube block shows its south texture: a model is turned half round from a cube
// block. The left face being east, not a mirrored west, follows from that turn; the models at hand
// look the same either way). A face's texture runs as seen from outside the face.

export function parseGeometryFiles(texts) {
  const out = new Map();
  for (const text of texts) {
    let doc;
    try { doc = typeof text === 'string' ? JSON.parse(text.replace(/^\s*\/\/.*$/gm, '')) : text; } catch { continue; }
    if (!doc || typeof doc !== 'object') continue;
    for (const g of doc['minecraft:geometry'] || []) {
      const d = g.description || {};
      if (d.identifier) out.set(d.identifier, { tw: d.texture_width || 16, th: d.texture_height || 16, bones: g.bones || [] });
    }
    for (const [k, g] of Object.entries(doc)) {
      if (!k.startsWith('geometry.') || !g || typeof g !== 'object') continue;
      out.set(k.split(':')[0], { tw: g.texturewidth || 16, th: g.textureheight || 16, bones: g.bones || [] });
    }
  }
  return out;
}

const rad = (d) => (d * Math.PI) / 180;
// rotation [x, y, z] in degrees, applied x then y then z
function rotate(p, rot, pivot) {
  if (!rot || (!rot[0] && !rot[1] && !rot[2])) return p;
  let [x, y, z] = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
  const [ax, ay, az] = rot.map((v) => rad(v || 0));
  [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  return [x + pivot[0], y + pivot[1], z + pivot[2]];
}

// box uv layout of a cube of size (w, h, d) at (u, v)
function boxUv([u, v], [w, h, d]) {
  return {
    up: [u + d, v, w, d], down: [u + d + w, v, w, d],
    east: [u, v + d, d, h], north: [u + d, v + d, w, h], west: [u + d + w, v + d, d, h], south: [u + 2 * d + w, v + d, w, h],
  };
}

// The faces of a cube: the texture's top-left corner and the directions its u and v run.
function cubeFaces(o, s) {
  const [x0, y0, z0] = o, [x1, y1, z1] = [o[0] + s[0], o[1] + s[1], o[2] + s[2]];
  return {
    north: { o: [x1, y1, z0], u: [-1, 0, 0], v: [0, -1, 0], n: [0, 0, -1], size: [s[0], s[1]] },
    south: { o: [x0, y1, z1], u: [1, 0, 0], v: [0, -1, 0], n: [0, 0, 1], size: [s[0], s[1]] },
    west: { o: [x0, y1, z0], u: [0, 0, 1], v: [0, -1, 0], n: [-1, 0, 0], size: [s[2], s[1]] },
    east: { o: [x1, y1, z1], u: [0, 0, -1], v: [0, -1, 0], n: [1, 0, 0], size: [s[2], s[1]] },
    up: { o: [x0, y1, z0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0], size: [s[0], s[2]] },
    down: { o: [x0, y0, z1], u: [1, 0, 0], v: [0, 0, -1], n: [0, -1, 0], size: [s[0], s[2]] },
  };
}

// toward the viewer: out of the north-east corner, 30° up (the icon camera's tilt)
export const VIEW = (() => { const v = [1, Math.SQRT2 * Math.tan(Math.PI / 6), -1]; const l = Math.hypot(...v); return v.map((c) => c / l); })();
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Faces the viewer sees, back to front: { name, material, o, u, v (3D, one texel of uv each), uv:
// [u, v, w, h] in texture units, normal }.
export function modelFaces(geo) {
  const bones = new Map(geo.bones.map((b) => [b.name, b]));
  const chain = (b) => { const out = []; for (let c = b; c; c = c.parent ? bones.get(c.parent) : null) out.push(c); return out; };
  const faces = [];
  for (const bone of geo.bones) {
    const up = chain(bone);
    const place = (p) => up.reduce((q, b) => rotate(q, b.rotation, b.pivot || [0, 0, 0]), p);
    for (const c of bone.cubes || []) {
      const inf = c.inflate || 0;
      const o = [c.origin[0] - inf, c.origin[1] - inf, c.origin[2] - inf], s = [c.size[0] + 2 * inf, c.size[1] + 2 * inf, c.size[2] + 2 * inf];
      const uvs = Array.isArray(c.uv) ? boxUv(c.uv, c.size) : null;
      const at = (p) => place(rotate(p, c.rotation, c.pivot || [0, 0, 0]));
      for (const [name, f] of Object.entries(cubeFaces(o, s))) {
        const spec = uvs ? { uv: uvs[name].slice(0, 2), uv_size: uvs[name].slice(2) } : c.uv?.[name];
        if (!spec) continue;
        const p0 = at(f.o), pu = at(f.o.map((v, i) => v + f.u[i] * f.size[0])), pv = at(f.o.map((v, i) => v + f.v[i] * f.size[1]));
        const n = [at(f.n.map((v, i) => v + f.o[i])), at(f.o)].reduce((a, b) => a.map((v, i) => v - b[i]));
        if (dot(n, VIEW) <= 1e-6) continue;
        const [uw, vh] = spec.uv_size || [f.size[0], f.size[1]];
        // one texel of the face's uv rectangle, as a 3D step
        const du = pu.map((v, i) => (v - p0[i]) / (uw || 1)), dv = pv.map((v, i) => (v - p0[i]) / (vh || 1));
        const centre = p0.map((v, i) => v + (pu[i] - p0[i]) / 2 + (pv[i] - p0[i]) / 2);
        faces.push({ name, material: spec.material_instance || name, o: p0, u: du, v: dv, uv: [spec.uv[0], spec.uv[1], uw, vh], normal: n, depth: dot(centre, VIEW) });
      }
    }
  }
  return faces.sort((a, b) => a.depth - b.depth);
}

// The box round every cube of the model, rotations applied: [[x0, y0, z0], [x1, y1, z1]].
export function modelBounds(geo) {
  const bones = new Map(geo.bones.map((b) => [b.name, b]));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const bone of geo.bones) {
    const up = [];
    for (let c = bone; c; c = c.parent ? bones.get(c.parent) : null) up.push(c);
    for (const c of bone.cubes || []) {
      const inf = c.inflate || 0;
      for (let i = 0; i < 8; i++) {
        let p = [0, 1, 2].map((k) => c.origin[k] - inf + ((i >> k) & 1) * (c.size[k] + 2 * inf));
        p = rotate(p, c.rotation, c.pivot || [0, 0, 0]);
        p = up.reduce((q, b) => rotate(q, b.rotation, b.pivot || [0, 0, 0]), p);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
      }
    }
  }
  return lo[0] === Infinity ? [[-8, 0, -8], [8, 16, 8]] : [lo, hi];
}

// How much bigger than a full block a model is drawn: the icon fits the bounding sphere of the
// model's box (measured in game 2026-10-23: a 14×15×14 sieve is 1.12 times a cube's scale, a
// 16×16×2 glass pane 1.22; a vanilla slab is the exception, drawn as the cube's lower half).
export function sphereFit([lo, hi]) {
  const r = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
  return r > 0 ? (8 * Math.sqrt(3)) / r : 1;
}
