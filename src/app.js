import { buildCatalog } from './engine/catalog.js';
import { parseJsonc } from './engine/jsonc.js';
import { buildTree, pathOf } from './engine/resolve.js';
import { Session, walk } from './engine/bind.js';
import { layoutTree, findOcclusions } from './engine/layout.js';
import { evaluate, show, fromJson, lintExpression } from './engine/expr.js';
import { serverFormHost, hudHost, chestHost, mergeHost, PLATFORMS, SCREENS } from './engine/host.js';
import { renderTree } from './render.js';
import { SAMPLE_PACK, SAMPLE_FORM } from '../samples/sample-pack.js';

const $ = (id) => document.getElementById(id);
window.__tester = null;
const state = { packs: [], cat: null, tree: null, session: null, selected: null, buildDiags: [], textureInfo: new Map() };

// ---------- tabs ----------
for (const nav of document.querySelectorAll('.tabs')) {
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    const pane = nav.parentElement;
    nav.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    pane.querySelectorAll(':scope > .panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === b.dataset.tab));
  });
}
const showTab = (name) => document.querySelector(`.tabs button[data-tab="${name}"]`)?.click();

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- packs ----------
const UI_EXT = /\.(json|r4ui|uidx)$/i;

function packFromEntries(name, entries, vanilla) {
  // entries: [{ rel: 'ui/x.json' | 'textures/ui/a.png', text?, blob?, url? }]
  const pack = { name, files: {}, textures: new Map(), vanilla };
  for (const e of entries) {
    if (e.rel.startsWith('ui/') && UI_EXT.test(e.rel) && e.text !== undefined) pack.files[e.rel] = e.text;
    else if (e.rel.startsWith('textures/')) pack.textures.set(e.rel, e);
  }
  return pack;
}

async function loadFolder(fileList, vanilla) {
  const entries = [];
  let packName = null;
  for (const f of fileList) {
    const p = f.webkitRelativePath || f.name;
    const m = p.match(/(?:^|\/)((?:ui|textures)\/.+)$/);
    if (!m) continue;
    packName = packName || p.split('/')[0];
    const rel = m[1];
    if (rel.startsWith('ui/') && UI_EXT.test(rel)) entries.push({ rel, text: await f.text() });
    else if (rel.startsWith('textures/') && /\.(png|jpe?g)$/i.test(rel)) entries.push({ rel, blob: f });
    else if (rel.startsWith('textures/') && rel.endsWith('.json')) entries.push({ rel, text: await f.text() });
  }
  if (!entries.length) { toast('ui/ 또는 textures/ 폴더가 없다. 리소스팩 루트 폴더를 고른다.'); return; }
  const pack = packFromEntries(vanilla ? `vanilla (${packName})` : packName, entries, vanilla);
  if (vanilla) state.packs = [pack, ...state.packs.filter((p) => !p.vanilla)];
  else state.packs.push(pack);
  afterPacksChanged();
}

async function loadVanillaFromServer() {
  try {
    const idx = await (await fetch('./vanilla-index.json')).json();
    const entries = [];
    for (const rel of idx.files) {
      if (idx.text[rel] !== undefined) entries.push({ rel, text: idx.text[rel] });
      else if (/\.(png|jpe?g)$/i.test(rel)) entries.push({ rel, url: `./vanilla/${rel}` });
    }
    const pack = packFromEntries('vanilla 1.26.50.4 (bedrock-samples)', entries, true);
    state.packs = [pack, ...state.packs.filter((p) => !p.vanilla)];
    afterPacksChanged();
    toast(`바닐라 UI 파일 ${Object.keys(pack.files).length}개를 읽었다`);
  } catch (e) {
    toast('로컬 서버에서 바닐라를 못 읽었다. "바닐라 폴더 고르기"를 쓴다(node serve.mjs로 띄우면 자동).');
  }
}

// Vanilla 1.26.50.4 straight from GitHub (raw.githubusercontent.com allows CORS), pinned to the guide baseline.
const VANILLA_SHA = '46ba6ea985fb5a92d79a9419198f10dda14c199d';
const VANILLA_RAW = `https://raw.githubusercontent.com/Mojang/bedrock-samples/${VANILLA_SHA}/resource_pack/`;

async function loadVanillaFromGitHub() {
  try {
    toast('GitHub에서 바닐라 UI 목록을 받는 중');
    const defsText = await (await fetch(VANILLA_RAW + 'ui/_ui_defs.json')).text();
    const list = parseUiDefsList(defsText);
    const want = ['ui/_ui_defs.json', 'ui/_global_variables.json', ...list];
    const entries = [];
    let done = 0;
    const queue = [...new Set(want)];
    const worker = async () => {
      while (queue.length) {
        const rel = queue.shift();
        const r = await fetch(VANILLA_RAW + rel);
        if (r.ok) entries.push({ rel, text: await r.text() });
        done++;
        if (done % 20 === 0) toast(`GitHub에서 바닐라 받는 중 ${done}/${want.length}`);
      }
    };
    await Promise.all(Array.from({ length: 12 }, worker));
    const pack = packFromEntries('vanilla 1.26.50.4 (GitHub bedrock-samples)', entries, true);
    pack.remote = VANILLA_RAW;
    state.packs = [pack, ...state.packs.filter((p) => !p.vanilla)];
    $('rootRef').value = 'server_form.third_party_server_screen';
    afterPacksChanged();
    toast(`바닐라 UI 파일 ${Object.keys(pack.files).length}개를 GitHub에서 읽었다. 텍스처는 쓸 때 받는다`);
  } catch (e) {
    toast('GitHub에서 바닐라를 못 받았다. "바닐라 폴더 고르기"를 쓴다.');
  }
}

function parseUiDefsList(text) {
  return parseJsonc(text).value.ui_defs || [];
}

function loadSample() {
  state.packs = state.packs.filter((p) => p.name !== SAMPLE_PACK.name);
  state.packs.push({ name: SAMPLE_PACK.name, files: { ...SAMPLE_PACK.files }, textures: new Map(), vanilla: false });
  $('hostKind').value = 'server_form';
  $('formKind').value = SAMPLE_FORM.kind;
  $('formTitle').value = SAMPLE_FORM.title;
  $('formBody').value = SAMPLE_FORM.body;
  $('formButtons').value = SAMPLE_FORM.buttons.map((b) => b.text).join('\n');
  if (!state.packs.some((p) => p.vanilla)) $('rootRef').value = 'demo.playground';
  else $('rootRef').value = 'server_form.third_party_server_screen';
  syncHostKind();
  afterPacksChanged();
}

function afterPacksChanged() {
  renderPackList();
  renderFileSelect();
  rebuild();
}

function renderPackList() {
  const ol = $('packList');
  ol.textContent = '';
  state.packs.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<b></b> <span class="meta"></span> `;
    li.querySelector('b').textContent = p.name;
    li.querySelector('.meta').textContent = `UI ${Object.keys(p.files).length} · 텍스처 ${p.textures.size}`;
    const up = document.createElement('button'); up.textContent = '↑'; up.disabled = i === 0;
    up.onclick = () => { [state.packs[i - 1], state.packs[i]] = [state.packs[i], state.packs[i - 1]]; afterPacksChanged(); };
    const rm = document.createElement('button'); rm.textContent = '빼기';
    rm.onclick = () => { state.packs.splice(i, 1); afterPacksChanged(); };
    li.append(up, rm);
    ol.append(li);
  });
  if (!state.packs.length) ol.innerHTML = '<li class="hint">팩이 없다. 예제 팩이나 바닐라를 넣는다.</li>';
}

function renderFileSelect() {
  const sel = $('fileSelect');
  const cur = sel.value;
  sel.textContent = '';
  state.packs.forEach((p, pi) => {
    const g = document.createElement('optgroup');
    g.label = p.name;
    for (const f of Object.keys(p.files).sort()) {
      const o = document.createElement('option');
      o.value = `${pi}::${f}`;
      o.textContent = f;
      g.append(o);
    }
    sel.append(g);
  });
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  else {
    const firstOwn = [...sel.options].find((o) => !state.packs[+o.value.split('::')[0]].vanilla);
    if (firstOwn) sel.value = firstOwn.value;
  }
  loadFileIntoEditor();
}
function loadFileIntoEditor() {
  const v = $('fileSelect').value;
  if (!v) { $('fileEditor').value = ''; return; }
  const [pi, f] = v.split('::');
  $('fileEditor').value = state.packs[+pi].files[f];
  $('fileStatus').textContent = state.packs[+pi].vanilla ? '바닐라 파일(고쳐도 이 탭에서만 바뀜)' : '';
}
function applyFile() {
  const v = $('fileSelect').value;
  if (!v) return;
  const [pi, f] = v.split('::');
  state.packs[+pi].files[f] = $('fileEditor').value;
  $('fileStatus').textContent = '적용함';
  rebuild();
}

// ---------- textures ----------
function textureLookup(path) {
  if (state.textureInfo.has(path)) return state.textureInfo.get(path);
  let found = null;
  for (let i = state.packs.length - 1; i >= 0 && !found; i--) {
    const p = state.packs[i];
    for (const ext of ['.png', '.jpg', '.jpeg']) {
      const e = p.textures.get(path + ext);
      if (!e) continue;
      const url = e.url || (e.blobUrl ||= URL.createObjectURL(e.blob));
      const side = p.textures.get(path + '.json');
      let nineslice = null;
      if (side && side.text) { try { nineslice = JSON.parse(side.text.replace(/\/\/.*$/gm, '')); } catch { /* ignore */ } }
      found = { url, nineslice };
      const img = new Image();
      img.onload = () => { found.w = img.naturalWidth; found.h = img.naturalHeight; scheduleRender(); };
      img.src = url;
      break;
    }
  }
  if (!found) {
    // remote vanilla: try the PNG and its 9-slice sidecar on demand
    const remote = state.packs.find((p) => p.remote);
    if (remote) {
      found = { url: `${remote.remote}${path}.png`, nineslice: null };
      const img = new Image();
      img.onload = () => { found.w = img.naturalWidth; found.h = img.naturalHeight; scheduleRender(); };
      img.onerror = () => { state.textureInfo.set(path, null); scheduleRender(); };
      img.src = found.url;
      fetch(`${remote.remote}${path}.json`).then((r) => (r.ok ? r.text() : null)).then((txt) => {
        if (!txt) return;
        try { found.nineslice = JSON.parse(txt.replace(/\/\/.*$/gm, '')); scheduleRender(); } catch { /* ignore */ }
      }).catch(() => {});
    }
  }
  state.textureInfo.set(path, found);
  return found;
}

// ---------- host ----------
function syncHostKind() {
  const k = $('hostKind').value;
  document.querySelectorAll('[data-host]').forEach((el) => { el.hidden = el.dataset.host !== k; });
  if (SCREENS[k] && k !== 'custom') $('rootRef').value = $('rootRef').value && k === 'server_form' && $('rootRef').value.startsWith('demo.') ? $('rootRef').value : SCREENS[k].root;
}

function readHost() {
  const k = $('hostKind').value;
  let host;
  if (k === 'server_form') {
    const lines = $('formButtons').value.split('\n').filter((l) => l.trim() !== '');
    if ($('formKind').value === 'modal') {
      host = serverFormHost({ kind: 'modal', title: $('formTitle').value, rows: lines.map((l) => { const [type, text, value] = l.split('|'); return { type: type.trim(), text, value }; }) });
    } else {
      host = serverFormHost({ kind: 'action', title: $('formTitle').value, body: $('formBody').value, buttons: lines.map((l) => { const [text, texture] = l.split('|'); return { text, texture }; }) });
    }
  } else if (k === 'hud') {
    host = hudHost({ title: $('hudTitle').value, subtitle: $('hudSubtitle').value, actionbar: $('hudActionbar').value });
  } else if (k === 'chest') {
    host = chestHost({ title: $('chestTitle').value, slots: $('chestSlots').value.split('\n').filter(Boolean).map((l) => { const [a, c, n] = l.split('|'); return { id_aux: Number(a), count: Number(c) || 0, name: n }; }) });
  } else host = { globals: {}, collections: {}, factories: {} };
  const extra = $('hostExtra').value.trim();
  if (extra) {
    try { host = mergeHost(host, JSON.parse(extra)); } catch (e) { toast('추가 데이터 JSON 오류: ' + e.message); }
  }
  host.assumeHidden = $('assumeHidden').checked;
  return host;
}

// ---------- build / run ----------
function screenSize() { const [w, h] = $('screenSize').value.split('x').map(Number); return { w, h }; }
window.__tester = state;
const opts = () => ({ measured: $('mode').value === 'measured' });

function rebuild() {
  state.textureInfo.clear();
  state.selected = null;
  if (!state.packs.length) { state.tree = null; renderAll(); return; }
  const t0 = performance.now();
  state.cat = buildCatalog(state.packs, opts());
  const host = readHost();
  const ref = $('rootRef').value.trim();
  if (!state.cat.defs.has(ref)) {
    state.tree = null;
    state.buildDiags = [{ level: 'error', msg: `UI control reference not found: '${ref}'`, where: '루트' }];
    renderAll();
    return;
  }
  const { tree, diags } = buildTree(state.cat, ref, { platform: PLATFORMS[$('platform').value], hostVars: host.hostVars });
  state.tree = tree;
  state.buildDiags = diags;
  state.session = new Session(state.cat, tree, opts());
  state.session.run(host);
  layoutTree(tree, screenSize());
  const ms = Math.round(performance.now() - t0);
  let n = 0; walk(tree, () => n++);
  $('catalogInfo').textContent = `정의 ${state.cat.defs.size}개 · 컨트롤 ${n}개 · ${ms}ms`;
  fillRootList();
  renderAll();
}

function tick() {
  if (!state.session) return rebuild();
  state.session.opts = opts();
  state.session.run(readHost());
  layoutTree(state.tree, screenSize());
  renderAll();
}

function fillRootList() {
  const dl = $('rootList');
  if (dl.dataset.for === String(state.cat.defs.size)) return;
  dl.dataset.for = String(state.cat.defs.size);
  dl.textContent = '';
  for (const [id, d] of state.cat.defs) {
    if (d.props.type === 'screen' || !d.vanilla) {
      const o = document.createElement('option');
      o.value = id;
      dl.append(o);
    }
  }
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderStage(); });
}

function renderAll() {
  renderStage();
  renderTreeView();
  renderDetails();
  renderDiags();
  $('tickInfo').textContent = state.session ? `틱 ${state.session.tick}` : '';
}

function renderStage() {
  const stage = $('stage');
  const z = Number($('zoom').value);
  const { w, h } = screenSize();
  stage.style.width = `${w * z}px`;
  stage.style.height = `${h * z}px`;
  if (!state.tree) { stage.textContent = ''; return; }
  renderTree(stage, state.tree, {
    zoom: z, textures: textureLookup, outlines: $('outlines').checked, showHidden: $('showHidden').checked,
    selectedUid: state.selected?.uid,
    onPick: (uid) => pick(uid, true),
    onHover: (uid) => {
      if (state.session.hoverUid === uid) return;
      state.session.hoverUid = uid;
      state.session.applyAll();
      layoutTree(state.tree, screenSize());
      scheduleRender();
    },
  });
}

function findUid(uid) {
  let hit = null;
  walk(state.tree, (n) => { if (n.uid === uid) hit = n; }, true);
  return hit;
}

function pick(uid, fromStage) {
  const node = findUid(uid);
  if (!node) return;
  state.selected = node;
  if (fromStage) {
    const r = state.session.press(node);
    if (r.kind !== 'none') {
      const li = document.createElement('li');
      li.textContent = `${node.name}: ${r.msg}`;
      $('pressLog').prepend(li);
      toast(r.msg);
      if (r.kind === 'toggle') { state.session.applyAll(); layoutTree(state.tree, screenSize()); }
    }
  }
  renderStage();
  renderTreeView();
  renderDetails();
}

// ---------- inspector ----------
function renderTreeView() {
  const box = $('tree');
  box.textContent = '';
  if (!state.tree) return;
  const sel = state.selected;
  const openPath = new Set();
  for (let n = sel; n; n = n.parent) openPath.add(n.uid);
  const mk = (n, depth) => {
    const label = document.createElement('span');
    label.innerHTML = '<span class="nm"></span> <span class="t"></span>';
    label.querySelector('.nm').textContent = n.name;
    label.querySelector('.t').textContent = n.ignored ? 'ignored' : (n.type || '?') + (n.eff?.text ? ` "${String(n.eff.text).slice(0, 24)}"` : '');
    if (n.ignored) label.classList.add('ign');
    else if (!n.effVisible) label.classList.add('hid');
    if ((n.diags || []).some((d) => d.level !== 'info') || (n.bindDiags || []).length) label.classList.add('dg');
    if (sel && n.uid === sel.uid) label.classList.add('sel');
    label.onclick = (e) => { e.preventDefault(); pick(n.uid, false); };
    if (!n.children.length) {
      const d = document.createElement('div');
      d.className = 'leaf';
      d.append(label);
      return d;
    }
    const det = document.createElement('details');
    det.open = depth < 2 || openPath.has(n.uid);
    const s = document.createElement('summary');
    s.append(label);
    det.append(s);
    let filled = false;
    const fill = () => { if (filled) return; filled = true; for (const c of n.children) det.append(mk(c, depth + 1)); };
    if (det.open) fill(); else det.addEventListener('toggle', fill, { once: true });
    return det;
  };
  box.append(mk(state.tree, 0));
  box.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

function row(tbl, k, v) {
  const tr = document.createElement('tr');
  const a = document.createElement('td'); a.textContent = k;
  const b = document.createElement('td'); b.textContent = typeof v === 'string' ? v : JSON.stringify(v);
  tr.append(a, b);
  tbl.append(tr);
}

function renderDetails() {
  const box = $('details');
  box.textContent = '';
  const n = state.selected;
  if (!n) { box.innerHTML = '<p class="hint">화면이나 트리에서 컨트롤을 고른다. 화면에서 고르면 버튼 누름도 흉내 낸다.</p>'; return; }
  const h = document.createElement('h4'); h.textContent = pathOf(n); box.append(h);
  const t = document.createElement('table');
  row(t, 'type', n.type ?? '(없음)');
  row(t, '정의 사슬', n.chain.join(' → ') || '(인라인)');
  if (n.ignored) row(t, 'ignored', '생성되지 않음 (부모 스코프에서 참)');
  if (n.rect) row(t, '사각형', `x ${n.rect.x.toFixed(1)} y ${n.rect.y.toFixed(1)} w ${n.rect.w.toFixed(1)} h ${n.rect.h.toFixed(1)} · layer ${n.layerAbs}`);
  row(t, '보임', n.effVisible ? '예' : '아니오' + (n.assumedHidden ? ` (모르는 전역 ${n.assumedHidden}를 false로 가정)` : ''));
  if (n.stateName) row(t, '상태', n.stateName);
  if (n.appliedVariables?.length) row(t, '적용된 variables', n.appliedVariables.join(' / '));
  const collection = state.session?.collectionItem(n);
  if (collection) row(t, '컬렉션 항목', `${collection.collection}[${collection.index}]`);
  if (n.details) row(t, 'collection_details', [...n.details].join(', '));
  for (const k of ['text', 'texture', 'alpha', 'clip_ratio', 'color']) if (n.eff && n.eff[k] !== undefined && n.eff[k] !== null) row(t, `실효 ${k}`, n.eff[k]);
  box.append(t);
  const sec = (title, entries) => {
    if (!entries.length) return;
    const hh = document.createElement('h4'); hh.textContent = title; box.append(hh);
    const tb = document.createElement('table');
    for (const [k, v] of entries) row(tb, k, v);
    box.append(tb);
  };
  sec('속성 주머니', n.bag ? [...n.bag].map(([k, v]) => [k, show(v)]) : []);
  sec('바인딩', (n.props.bindings || []).map((b, i) => [String(i), b]));
  sec('이 컨트롤의 $ 변수', n.scope ? [...n.scope.concrete, ...[...n.scope.defaults].map(([k, v]) => [k + '|default', v])] : []);
  const props = Object.entries(n.props).filter(([k]) => !['bindings', 'controls', 'property_bag'].includes(k));
  sec('해석된 속성', props);
  sec('진단', [...(n.diags || []), ...(n.bindDiags || [])].map((d) => [d.level, d.msg]));
}

function renderDiags() {
  const ul = $('diagList');
  ul.textContent = '';
  const all = [];
  for (const d of state.cat?.diags || []) all.push({ ...d });
  for (const d of state.buildDiags) all.push({ ...d });
  if (state.tree) {
    const laid = [];
    walk(state.tree, (n) => { if (n.rect) laid.push(n); });
    for (const { node, by } of findOcclusions(laid)) {
      all.push({ level: 'warn', msg: `라벨 "${String(node.eff.text).slice(0, 20)}"(layer ${node.layerAbs})이 더 높은 레이어의 이미지 ${by.name}(layer ${by.layerAbs})에 가려진다 [LAY-18]`, where: pathOf(node), uid: node.uid });
    }
  }
  if (state.tree) walk(state.tree, (n) => {
    for (const d of n.bindDiags || []) all.push({ ...d, uid: n.uid });
    for (const d of n.diags || []) if (d.level === 'info') all.push({ ...d, where: pathOf(n), uid: n.uid });
  }, true);
  const seen = new Set();
  const list = all.filter((d) => {
    const k = d.level + d.msg + d.where;
    if (seen.has(k)) return false;
    seen.add(k);
    return $('diagInfo').checked || d.level !== 'info';
  });
  const errs = list.filter((d) => d.level === 'error').length;
  $('diagCount').textContent = String(list.length);
  $('diagCount').classList.toggle('err', errs > 0);
  for (const d of list) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="lv"></span><span class="m"></span><span class="where"></span>';
    li.querySelector('.lv').textContent = d.level;
    li.querySelector('.lv').classList.add(d.level);
    li.querySelector('.m').textContent = d.msg;
    li.querySelector('.where').textContent = d.where || '';
    if (d.uid) li.onclick = () => { pick(d.uid, false); showTab('inspect'); };
    ul.append(li);
  }
  if (!list.length) ul.innerHTML = '<li class="hint">진단 없음</li>';
}

// ---------- expression playground ----------
const EXAMPLES = ['(#s - 0)', '(#s * 1)', '(0 + #s)', '(#s + 0)', '(#c * 0.3)', '(#c * .3)', '(962 < #c < 964)', '((962 < #c) and (#c < 964))', "('%.3s' * #r)", '(#c % 2)', '(5 >= 3)', "('n=' + #f)", '(true or false and false)', "(('#' + 'x') = 'hello')"];
function runExpr() {
  const out = $('exprOut');
  let bag = {}, vars = {};
  try { bag = JSON.parse($('exprBag').value || '{}'); vars = JSON.parse($('exprVars').value || '{}'); } catch (e) { out.textContent = 'JSON 오류: ' + e.message; return; }
  const src = $('exprInput').value;
  const r = evaluate(src, { prop: (n) => (n in bag ? fromJson(bag[n]) : undefined), variable: (n) => (n in vars ? fromJson(vars[n]) : undefined), opts: opts().measured ? { literalNoTruncate: true } : {} });
  out.textContent = r.error ? `Json(Null) — ${r.error}` : show(r.value);
  for (const hint of lintExpression(src)) { const s = document.createElement('span'); s.className = 'hint'; s.textContent = '· ' + hint; out.append(s); }
}
for (const ex of EXAMPLES) {
  const b = document.createElement('button');
  b.textContent = ex;
  b.onclick = () => { $('exprInput').value = ex; runExpr(); };
  $('exprExamples').append(b);
}
$('exprBag').value = JSON.stringify({ '#s': '35', '#c': 10, '#f': 2.5, '#r': '042x', '#x': 'hello', '#h': '가나다abc' });
['exprInput', 'exprBag', 'exprVars'].forEach((id) => $(id).addEventListener('input', runExpr));
runExpr();

// ---------- wiring ----------
$('loadVanillaServer').onclick = loadVanillaFromServer;
$('loadVanillaGitHub').onclick = loadVanillaFromGitHub;
$('pickVanilla').onchange = (e) => loadFolder(e.target.files, true);
$('pickPack').onchange = (e) => loadFolder(e.target.files, false);
$('loadSample').onclick = loadSample;
$('fileSelect').onchange = loadFileIntoEditor;
$('applyFile').onclick = applyFile;
$('fileEditor').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFile(); } });
$('rebuild').onclick = rebuild;
$('tick').onclick = tick;
$('applyHost').onclick = rebuild;
$('hostKind').onchange = () => { syncHostKind(); rebuild(); };
$('rootRef').addEventListener('change', rebuild);
for (const id of ['mode', 'platform', 'assumeHidden']) $(id).addEventListener('change', rebuild);
$('screenSize').addEventListener('change', () => { if (state.tree) { layoutTree(state.tree, screenSize()); renderStage(); } });
for (const id of ['outlines', 'showHidden']) $(id).addEventListener('change', renderStage);
$('zoom').addEventListener('input', () => { $('zoomVal').textContent = `${$('zoom').value}×`; renderStage(); });
$('diagInfo').addEventListener('change', renderDiags);

// narrow screens: fit the stage width
if (window.innerWidth < 1100) {
  const fit = Math.max(0.5, Math.floor(((window.innerWidth - 32) / screenSize().w) * 4) / 4);
  $('zoom').value = String(Math.min(2, fit));
  $('zoomVal').textContent = `${$('zoom').value}×`;
}

// start: try vanilla from the local server, then add the sample pack
(async () => {
  loadSample();
  try {
    const r = await fetch('./serve-info', { method: 'HEAD' });
    if (r.ok) { await loadVanillaFromServer(); $('rootRef').value = 'server_form.third_party_server_screen'; rebuild(); return; }
  } catch { /* opened without the local server */ }
  await loadVanillaFromGitHub();
})();
