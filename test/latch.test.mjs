// Preserved-title latch over ticks (BND-18, BND-23 visibility_changed) using the sample pack on a minimal HUD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { Session, walk } from '../src/engine/bind.js';
import { hudHost } from '../src/engine/host.js';
import { SAMPLE_PACK } from '../samples/sample-pack.js';

const vanillaHud = { name: 'vanilla', vanilla: true, files: {
  'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/hud_screen.json'] }),
  'ui/hud_screen.json': JSON.stringify({ namespace: 'hud', hud_screen: { type: 'screen', controls: [{ 'root_panel@hud.root_panel': {} }] }, root_panel: { type: 'panel', controls: [{ x: { type: 'panel' } }] } }),
} };

test('preserved title keeps the last prefixed title', () => {
  const cat = buildCatalog([vanillaHud, SAMPLE_PACK]);
  const { tree } = buildTree(cat, 'hud.hud_screen');
  const s = new Session(cat, tree);
  const shown = () => { let v; walk(tree, (n) => { if (n.name === 'pin_label') v = n.eff.text; }); return v; };
  const seq = [['', '고정: '], ['pin:hello', null], ['pin:hello', '고정: hello'], ['', '고정: hello'], ['other', '고정: hello'], ['pin:bye', null], ['pin:bye', '고정: bye']];
  for (const [title, want] of seq) {
    s.run(hudHost({ title }));
    if (want !== null) assert.equal(shown(), want, `after title ${JSON.stringify(title)}`);
  }
});
