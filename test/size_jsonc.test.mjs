// Size cases from cinnabar/samples/평가기-실행-결과.md section 2, jsonc rules from FILE-30.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSize, resolveTerms } from '../src/engine/size.js';
import { parseJsonc } from '../src/engine/jsonc.js';

const env = { parent: 200, selfW: 80, selfH: 40, childSum: 30, childMax: 12, siblingMax: 50 };
const px = (x) => {
  const s = parseSize(x);
  if (s.kind !== 'terms') return s.kind;
  return resolveTerms(s, env);
};

const cases = [
  ['100c%', 200], ['50c%', 100], ['10', 0], ['10px', 10], ['50%cm', 12], ['200%cm', 12], ['0%cm', 12],
  ['100% - 10px 5px', 185], ['Fill', 0], ['fill', 'fill'], ['DEFAULT', 0], ['default', 'default'],
  ['100%sm - 4px', 46], ['56.25%x', 45], ['100 % - 2 px', 198], ['%', 0], [24, 24], ['100%c + 5px', 35],
];
for (const [input, want] of cases) test(`size ${JSON.stringify(input)}`, () => assert.equal(px(input), want));

test('jsonc accepts comments and leading zeros', () => {
  const r = parseJsonc('// head\n{ "a": 007, /* c */ "b": [1, 2] }');
  assert.equal(r.error, null);
  assert.deepEqual(r.value, { a: 7, b: [1, 2] });
});
test('trailing comma is an error and keeps earlier members', () => {
  const r = parseJsonc('{ "a": 1, "b": { "x": 2, }, "c": 3 }');
  assert.match(r.error, /뒤따르는 쉼표/);
  assert.equal(r.value.a, 1);
  assert.equal(r.value.c, undefined);
});
test('unquoted key is an error', () => {
  assert.match(parseJsonc('{ a: 1 }').error, /따옴표 없는 키/);
});
