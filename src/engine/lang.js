export function parseLang(text, into = new Map()) {
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (raw.startsWith('##')) continue;
    const eq = raw.indexOf('=');
    if (eq <= 0) continue;
    into.set(raw.slice(0, eq), raw.slice(eq + 1));
  }
  return into;
}

const lookup = (lang, key) => lang.get(key) ?? lang.get(key.toLowerCase());

export function localize(text, lang) {
  if (!lang || typeof text !== 'string' || text === '') return text;
  if (!text.includes('%')) return lookup(lang, text) ?? text;
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text[i] !== '%') { out += text[i++]; continue; }
    let j = i + 1;
    while (j < text.length && TOKEN_CHAR.test(text[j])) j++;
    const key = text.slice(i + 1, j);
    if (key) out += lookup(lang, key) ?? key;
    if (j < text.length) out += text[j++];
    i = j;
  }
  return out;
}

const TOKEN_CHAR = /[A-Za-z0-9._-]/;
