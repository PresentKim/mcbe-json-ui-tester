// jsoncpp-style reader used by the game for UI files (FILE-30, CN-01, CN-02):
// comments and leading zeros are accepted, trailing commas and unquoted keys are errors.
// On an error the members read before it are kept and the rest of the file is dropped.

export function parseJsonc(text) {
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const err = (msg) => {
    const before = text.slice(0, i);
    const line = before.split('\n').length;
    const col = i - before.lastIndexOf('\n');
    const e = new Error(`${msg} (줄 ${line}, 칸 ${col})`);
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
        if (j < 0) err('닫히지 않은 주석');
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
      if (i >= text.length) err('닫히지 않은 문자열');
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
    err('알 수 없는 값');
  }
  function object(partial) {
    i++;
    const obj = partial || {};
    ws();
    if (text[i] === '}') { i++; return obj; }
    for (;;) {
      ws();
      if (text[i] === '}') err('뒤따르는 쉼표');
      if (text[i] !== '"') err('따옴표 없는 키');
      const k = string();
      ws();
      if (text[i] !== ':') err("':' 없음");
      i++;
      obj[k] = value();
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return obj; }
      err("',' 또는 '}' 없음");
    }
  }
  function array() {
    i++;
    const arr = [];
    ws();
    if (text[i] === ']') { i++; return arr; }
    for (;;) {
      ws();
      if (text[i] === ']') err('뒤따르는 쉼표');
      arr.push(value());
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return arr; }
      err("',' 또는 ']' 없음");
    }
  }
  const root = {};
  try {
    ws();
    if (text[i] !== '{') err('최상위가 객체가 아님');
    object(root);
    return { value: root, error: null };
  } catch (e) {
    return { value: root, error: e.message, line: e.line };
  }
}
