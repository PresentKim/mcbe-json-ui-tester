#!/usr/bin/env node
// Headless run of the tester: load packs, build a screen, bind mock host data, lay out, print findings.
//   node cli.mjs --vanilla <resource_pack dir> [--pack <dir>]... [--sample] --root <ns.name>
//                [--host server_form|hud|chest|none] [--title T] [--body B] [--buttons "a;b;c"]
//                [--hud-title T] [--actionbar A] [--cn] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { buildCatalog } from './src/engine/catalog.js';
import { buildTree, pathOf } from './src/engine/resolve.js';
import { Session, walk } from './src/engine/bind.js';
import { layoutTree, findOcclusions } from './src/engine/layout.js';
import { serverFormHost, hudHost, chestHost, PLATFORMS } from './src/engine/host.js';
import { SAMPLE_PACK } from './samples/sample-pack.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const flag = (name) => args.includes(`--${name}`);

function readPack(dir, name, vanilla) {
  const files = {};
  const walkDir = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walkDir(path.join(d, e.name), r);
      else if (/\.(json|r4ui|uidx)$/i.test(e.name)) files[r.slice(1)] = fs.readFileSync(path.join(d, e.name), 'utf8');
    }
  };
  const ui = path.join(dir, 'ui');
  if (!fs.existsSync(ui)) throw new Error(`${dir}: ui/ 폴더가 없다`);
  walkDir(ui, '/ui');
  return { name, files, vanilla };
}

if (flag('help') || !opt('root')) {
  console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 6).join('\n'));
  process.exit(opt('root') ? 0 : 1);
}

const packs = [];
if (opt('vanilla')) packs.push(readPack(opt('vanilla'), 'vanilla', true));
for (const p of all('pack')) packs.push(readPack(p, path.basename(path.resolve(p)), false));
if (flag('sample')) packs.push(SAMPLE_PACK);
const measured = !flag('cn');
const cat = buildCatalog(packs, { measured });

const kind = opt('host', 'server_form');
let host = { globals: {}, collections: {}, factories: {} };
if (kind === 'server_form') host = serverFormHost({ kind: 'action', title: opt('title', ''), body: opt('body', ''), buttons: (opt('buttons', '') || '').split(';').filter(Boolean).map((text) => ({ text })) });
if (kind === 'hud') host = hudHost({ title: opt('hud-title', ''), actionbar: opt('actionbar', '') });
if (kind === 'chest') host = chestHost({ title: opt('title', 'Chest'), slots: [] });

const root = opt('root');
if (!cat.defs.has(root)) { console.error(`UI control reference not found: '${root}'`); process.exit(2); }
const { tree, diags } = buildTree(cat, root, { platform: PLATFORMS[opt('platform', 'desktop')], hostVars: host.hostVars });
const s = new Session(cat, tree, { measured });
s.run(host);
const laid = layoutTree(tree, { w: Number(opt('w', 427)), h: Number(opt('h', 240)) });

const findings = [...cat.diags.filter((d) => d.level !== 'info'), ...diags];
let count = 0;
walk(tree, (n) => { count++; for (const d of n.bindDiags || []) findings.push(d); });
for (const { node, by } of findOcclusions(laid)) findings.push({ level: 'warn', msg: `라벨 "${node.eff.text}"이 더 높은 레이어의 ${by.name}에 가려진다 [LAY-18]`, where: pathOf(node) });
const texts = [];
walk(tree, (n) => { if (n.effVisible && n.props.type === 'label' && n.eff?.text) texts.push({ text: n.eff.text, rect: n.rect && [n.rect.x, n.rect.y, n.rect.w, n.rect.h].map(Math.round), where: pathOf(n) }); });

if (flag('json')) {
  console.log(JSON.stringify({ root, controls: count, findings, labels: texts }, null, 1));
} else {
  console.log(`${root}: 정의 ${cat.defs.size}개, 컨트롤 ${count}개, 모드 ${measured ? '실측 우선' : 'CN'}`);
  console.log(`\n진단 ${findings.length}건`);
  for (const d of findings) console.log(`  [${d.level}] ${d.msg}\n          ${d.where || ''}`);
  console.log(`\n보이는 라벨 ${texts.length}개`);
  for (const t of texts) console.log(`  ${JSON.stringify(t.text)} @ ${t.rect}`);
}
process.exit(findings.some((d) => d.level === 'error') ? 1 : 0);
