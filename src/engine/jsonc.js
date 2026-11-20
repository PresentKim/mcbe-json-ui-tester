// jsoncpp-style reader used by the game for UI files (FILE-30, CN-01, CN-02):
// comments and leading zeros are accepted, trailing commas and unquoted keys are errors.
// On an error the members read before it are kept and the rest of the file is dropped.

import { t } from '../i18n.js';

export function parseJsonc(text) {
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const err = (msg) => {
    const before = text.slice(0, i);
    const line = before.split('\n').length;
    const col = i - before.lastIndexOf('\n');
    const e = new Error(t('{msg} (line {line}, column {col})', { msg: t(msg), line, col }));
    e.line = line;
    throw e;
  };
  function ws() {
    for (;;) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (c === '/' && text[i + 1] === '*') {
        const j = text.indexOf('*/', i + 2);
        if (j < 0) err('Unclosed comment');
        i = j + 2;
        continue;
      }
      return;
    }
  }
  function string() {
    i++; // opening quote
    let out = '';
    for (;;) {
      if (i >= text.length) err('Unclosed string');
      const c = text[i++];
      if (c === '"') return out;
      if (c === '\\') {
        const e = text[i++];
        switch (e) {
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          case 'r': out += '\r'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'u': out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16)); i += 4; break;
          default: out += e;
        }
        continue;
      }
      out += c;
    }
  }
  function value(partial) {
    ws();
    const c = text[i];
    if (c === '{') return object(partial);
    if (c === '[') return array();
    if (c === '"') return string();
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
    if (m) { i += m[0].length; return Number(m[0]); }
    for (const [w, v] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(w, i)) { i += w.length; return v; }
    }
    err('Unknown value');
  }
  function object(partial) {
    i++;
    const obj = partial || {};
    ws();
    if (text[i] === '}') { i++; return obj; }
    for (;;) {
      ws();
      if (text[i] === '}') err('Trailing comma');
      if (text[i] !== '"') err('Unquoted key');
      const k = string();
      ws();
      if (text[i] !== ':') err("Missing ':'");
      i++;
      obj[k] = value();
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return obj; }
      err("Missing ',' or '}'");
    }
  }
  function array() {
    i++;
    const arr = [];
    ws();
    if (text[i] === ']') { i++; return arr; }
    for (;;) {
      ws();
      if (text[i] === ']') err('Trailing comma');
      arr.push(value());
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return arr; }
      err("Missing ',' or ']'");
    }
  }
  const root = {};
  try {
    ws();
    if (text[i] !== '{') err('The top level is not an object');
    object(root);
    return { value: root, error: null };
  } catch (e) {
    return { value: root, error: e.message, line: e.line };
  }
}
