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
  return text.replace(/%([A-Za-z0-9._-]+)/g, (_, key) => lookup(lang, key) ?? key);
}
