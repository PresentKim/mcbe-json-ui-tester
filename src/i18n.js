import { KO } from './locales/ko.js';

const CATALOGS = { en: null, ko: KO };
export const LOCALES = { en: 'English', ko: '한국어' };

let current = 'en';

export function setLocale(code) {
  current = code in CATALOGS ? code : 'en';
}

export const getLocale = () => current;

export function t(template, params = {}) {
  const text = CATALOGS[current]?.[template] ?? template;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}
