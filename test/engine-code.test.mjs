import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, show, fromJson } from '../src/engine/expr.js';
import { buildCatalog } from '../src/engine/catalog.js';
import { buildTree } from '../src/engine/resolve.js';
import { Session, walk } from '../src/engine/bind.js';

const bag = { '#x': 'hello', '#t': true, '#n': 7 };
const ev = (src, vars = {}) => show(evaluate(src, {
  prop: (n) => (n in bag ? fromJson(bag[n]) : undefined),
  variable: (n) => (n in vars ? fromJson(vars[n]) : undefined),
}).value);

const cases = [
  ['(3000000000)', 'Num(3000000000)'],
  ['(1 AND 1)', 'Json(Null)'],
  ['(#t / 0)', 'Bool(true)'],
  ["(.5 / 'a')", 'Num(0)'],
  ["(5 / 'a')", 'Int(0)'],
  ["(+'abc')", 'Int(0)'],
  ['(+#t)', 'Int(1)'],
  ["#n 'abc", 'Int(7)'],
  [`("'a'" + "b'")`, 'Text("a\'b")'],
];
for (const [src, want] of cases) test(`engine evaluator: ${src}`, () => assert.equal(ev(src), want));

test('a variable holding #name reads the property where it stands', () => {
  assert.equal(ev('(#n + $v)', { $v: '#n' }), 'Int(14)');
});

test('#name without a binding context is its own text', () => {
  assert.equal(show(evaluate('(#a)').value), 'Text("#a")');
  assert.equal(show(evaluate('(not #a)').value), 'Bool(false)');
});

const pack = (defs) => ({ name: 'p', files: { 'ui/_ui_defs.json': JSON.stringify({ ui_defs: ['ui/n.json'] }), 'ui/n.json': JSON.stringify({ namespace: 'n', ...defs }) } });

function build(defs, globals = {}) {
  const cat = buildCatalog([pack(defs)]);
  const { tree, diags } = buildTree(cat, 'n.r');
  new Session(cat, tree, { measured: true }).run({ globals, collections: {}, factories: {} });
  const byName = {};
  walk(tree, (n) => { byName[n.name] = n; }, true);
  return { diags, byName };
}

test('variables blocks need a requires that holds', () => {
  const { byName } = build({ r: { type: 'label', $a: 'base', variables: [
    { $a: 'none' },
    { requires: '$unset', $b: 'unset applies' },
    { requires: '(#x)', $c: 'text applies' },
    { requires: '(not #x)', $d: 'skipped' },
  ] } });
  const s = byName.r.scope;
  assert.equal(s.lookup('$a'), 'base');
  assert.equal(s.lookup('$b'), 'unset applies');
  assert.equal(s.lookup('$c'), 'text applies');
  assert.equal(s.lookup('$d'), undefined);
});

test('ignored takes bools and integers and warns on other values', () => {
  const { diags, byName } = build({ r: { type: 'panel', controls: [
    { a: { type: 'panel', ignored: '(#x = \'#x\')' } },
    { b: { type: 'panel', ignored: 'yes' } },
    { c: { type: 'panel', ignored: '#flag' } },
  ] } });
  assert.equal(byName.a.ignored, true);
  assert.equal(byName.b.ignored, undefined);
  assert.equal(byName.c.ignored, undefined);
  const invalid = diags.filter((d) => d.msg === 'An invalid value was provided for "ignored" field.').map((d) => d.where.split('/').pop());
  assert.deepEqual(invalid, ['b']);
});

test('a binding_name expression without #names writes only when it folds to a #name', () => {
  const { diags, byName } = build({ r: { type: 'panel', controls: [
    { folded: { type: 'label', bindings: [{ binding_name: "('#' + 'title')" }] } },
    { literal: { type: 'label', bindings: [{ binding_name: '(1 + 2)', binding_name_override: '#v' }] } },
  ] } }, { '#title': 'T' });
  assert.equal(byName.folded.bag.get('#title').v, 'T');
  assert.equal(byName.literal.bag.get('#v'), undefined);
  assert.ok(diags.some((d) => d.msg === 'Must define a binding name!') || byName.literal.bindDiags.some((d) => d.msg === 'Must define a binding name!'));
});

test('an expression binding without override writes each #name it reads', () => {
  const { byName } = build({ r: { type: 'label', bindings: [{ binding_name: '(not #hidden)' }] } }, { '#hidden': true });
  assert.equal(byName.r.bag.get('#hidden').v, true);
  assert.equal(byName.r.bag.get('(not #hidden)'), undefined);
});
