import { useSyncExternalStore } from 'react';
import '../electron/i18n/runtime.js';

export const i18n = globalThis.ApertroveI18n;
const dictionaries = import.meta.glob('../electron/i18n/locales/*.json', { eager: true, import: 'default' });
for (const locale of i18n.supportedLocales) {
  i18n.register(locale, dictionaries['../electron/i18n/locales/' + locale + '.json']);
}

const initialLocale = globalThis.focal?.initialLocale ?? globalThis.shotInspector?.initialLocale;
if (initialLocale) i18n.setLocale(initialLocale);
if (globalThis.document) document.documentElement.lang = i18n.getLocale();

export const { t, localized, number, date, legacy, error, getLocale, setLocale } = i18n;

export function useLocale() {
  return useSyncExternalStore(i18n.subscribe, i18n.getLocale);
}
