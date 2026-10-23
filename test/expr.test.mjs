// Cases from the Cinnabar evaluator run results (section 1, CN-run 2026-10-21) (CN-run, 2026-10-21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, show, fromJson, lintExpression } from '../src/engine/expr.js';

const bag = {
  '#s': '35', '#z': '100', '#c': 10, '#n': 10, '#i': 50, '#f': 2.5, '#t': true,
  '#x': 'hello', '#r': '042x', '#k': '3/17',
};
const ctx = { prop: (name) => (name in bag ? fromJson(bag[name]) : undefined) };
const ev = (src) => show(evaluate(src, ctx).value);

const cases = [
  ['(962 < #c < 964)', 'Bool(true)'],
  ['((962 < #c) and (#c < 964))', 'Bool(false)'],
  ['(#s * 1)', 'Text("")'],
  ['(#s - 0)', 'Int(35)'],
  ['(#s + 0)', 'Int(350)'],
  ['(0 + #s)', 'Int(35)'],
  ['(1 * #s)', 'Int(1)'],
  ['(#s = 35)', 'Bool(false)'],
  ['((#s - 0) = 35)', 'Bool(true)'],
  ["(#z - '0')", 'Int(1)'],
  ['(#z - 0)', 'Int(100)'],
  ['(#n * 0.3)', 'Int(0)'],
  ['(#n * .3)', 'Num(3)'],
  ['(#i / 100)', 'Int(0)'],
  ['(#i / 100.0)', 'Int(0)'],
  ['(#i * .01)', 'Num(0.5)'],
  ['(#f / 100)', 'Num(0.02500000037252903)'],
  ["('%5.3s' * 'abcdef')", 'Text("abcdef")'],
  ["('%.3s' * #r)", 'Int(42)'],
  ["(('#' + 'x') = 'hello')", 'Bool(true)'],
  ["('#' + 'x')", 'Text("hello")'],
  ["(#k + '')", 'Int(3)'],
  ["('' + #k)", 'Int(3)'],
  ["(#t = 'true')", 'Bool(false)'],
  ['(#t = true)', 'Bool(true)'],
  ['(#a != #b)', 'Json(Null)'],
  ['(5 >= 3)', 'Json(Null)'],
  ['(#c % 2)', 'Json(Null)'],
  ["('n=' + #f)", 'Text("n=")'],
  ["('n=' + #n)", 'Text("n=10")'],
  ['(not #missing)', 'Bool(true)'],
  ["(#missing = '')", 'Bool(true)'],
  ['(#missing = 0)', 'Bool(true)'],
  ["('abc' = 'ABC')", 'Bool(false)'],
  ["('10 apples' + '')", 'Int(10)'],
  ["('Yes' + '')", 'Bool(true)'],
  ["(#s / '5')", 'Int(1)'],
  ['(#s / 2)', 'Int(1)'],
  ["('' + #c)", 'Int(10)'],
  ['(#c / 0)', 'Int(10)'],
  ['(-#s)', 'Int(0)'],
  ['(not 0.5)', 'Bool(true)'],
  ['(not .5)', 'Bool(false)'],
];

for (const [src, want] of cases) {
  test(`CN-run ${src}`, () => assert.equal(ev(src), want));
}

test('and/or share a rank, left to right (EXP-29)', () => {
  assert.equal(ev('(true or false and false)'), 'Bool(false)');
});
test('unary not binds to the next operand (EXP-37)', () => {
  assert.equal(ev('(not 1 < 2)'), 'Bool(true)');
});
test("'%.Ns' cuts UTF-8 bytes, Korean is 3 bytes (EXP-09)", () => {
  const c = { prop: () => fromJson('가나다abc') };
  assert.equal(show(evaluate("('%.6s' * #h)", c).value), 'Text("가나")');
  assert.equal(show(evaluate("('%.7s' * #h)", c).value), 'Text("가나")');
});
test('string minus removes every occurrence (EXP-12)', () => {
  const c = { prop: () => fromJson(':20:10') };
  assert.equal(show(evaluate("(#t - ':')", c).value), 'Int(2010)');
});
test('literal is not truncated in game mode (EXP-10)', () => {
  assert.equal(show(evaluate("('%.3s' * 'abcdef')", { opts: { literalNoTruncate: true } }).value), 'Text("abcdef")');
  assert.equal(show(evaluate("('%.3s' * 'abcdef')", {}).value), 'Text("abc")');
});
test('variables resolve, missing ones are null', () => {
  const c = { variable: (n) => (n === '$a' ? fromJson(3) : undefined) };
  assert.equal(show(evaluate('($a + 2)', c).value), 'Int(5)');
  assert.equal(show(evaluate('(not $b)', c).value), 'Bool(true)');
});
test('lint flags non-operators', () => {
  assert.ok(lintExpression('(#a >= 3)').length > 0);
  assert.ok(lintExpression('(#a % 3)').length > 0);
  assert.ok(lintExpression('(#a * 1)').length > 0);
  assert.equal(lintExpression("(('%.3s' * #a) = 'abc')").length, 0);
});
