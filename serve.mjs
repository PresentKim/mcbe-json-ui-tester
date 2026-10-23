// Static server for the tester. Also exposes a vanilla resource pack (bedrock-samples) under /vanilla/
// so the page can load it without a folder picker.
//   node serve.mjs [port]            VANILLA=<path to resource_pack> to override the default location
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 5178);
// --no-vanilla serves the page alone, the way GitHub Pages does
const candidates = ['../bedrock-samples/resource_pack', '../../bedrock-samples/resource_pack'].map((p) => path.resolve(here, p));
const vanilla = process.argv.includes('--no-vanilla') ? path.join(here, '.no-vanilla') : process.env.VANILLA || candidates.find((p) => fs.existsSync(p)) || candidates[0];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/plain' };

function listFiles(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  };
  for (const sub of ['ui', 'textures/ui', 'textures/gui', 'textures/items', 'textures/blocks']) {
    const d = path.join(root, sub);
    if (fs.existsSync(d)) walk(d, sub);
  }
  return out;
}

// --pack <dir> (repeatable, bottom of the stack first) loads your own resource packs on start
const packDirs = process.argv.flatMap((a, i, all) => (a === '--pack' && all[i + 1] ? [path.resolve(all[i + 1])] : []));
function listPack(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  for (const sub of ['ui', 'textures']) if (fs.existsSync(path.join(dir, sub))) walk(path.join(dir, sub), sub);
  return out;
}

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/vanilla-index.json') {
    if (!fs.existsSync(vanilla)) { res.writeHead(404); return res.end('no vanilla'); }
    // one response with every UI file and texture sidecar, textures as paths (loaded on demand)
    const files = listFiles(vanilla);
    const text = {};
    for (const f of files) if (f.startsWith('ui/') || f.endsWith('.json')) text[f] = fs.readFileSync(path.join(vanilla, f), 'utf8');
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ root: vanilla, files, text }));
  }
  if (url === '/packs-index.json') {
    const packs = packDirs.map((dir, i) => {
      const files = listPack(dir);
      const text = {};
      for (const f of files) if (f.startsWith('ui/') || f.endsWith('.json')) text[f] = fs.readFileSync(path.join(dir, f), 'utf8');
      return { name: path.basename(dir), base: `./packs/${i}/`, files, text };
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(packs));
  }
  const pm = url.match(/^\/packs\/(\d+)\/(.+)$/);
  if (pm && packDirs[+pm[1]]) {
    const file = path.join(packDirs[+pm[1]], pm[2]);
    if (!path.resolve(file).startsWith(packDirs[+pm[1]])) { res.writeHead(403); return res.end(); }
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  }
  if (url === '/serve-info') { res.writeHead(fs.existsSync(vanilla) ? 200 : 404); return res.end(); }
  let file;
  if (url.startsWith('/vanilla/')) file = path.join(vanilla, url.slice('/vanilla/'.length));
  else file = path.join(here, url === '/' ? 'index.html' : url);
  const base = url.startsWith('/vanilla/') ? vanilla : here;
  if (!path.resolve(file).startsWith(path.resolve(base))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log(`JSON UI tester: http://localhost:${port}  (vanilla: ${vanilla}${packDirs.length ? `, packs: ${packDirs.join(', ')}` : ''})`));
