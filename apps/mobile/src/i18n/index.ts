/**
 * The whole i18n layer. Two equal languages (DESIGN §2.7) and switching must take
 * effect immediately, without a restart — so the current locale lives in a tiny
 * external store that screens read through `useT()`.
 *
 * Nothing outside this folder is allowed to contain Thai characters
 * (APP-RUN §0.2 rule 7 — enforced by `scripts/fitness.mts` and oracle S5.3).
 */

import { useSyncExternalStore } from 'react';

import { en } from './en';
import { th, type Translations, type TranslationKey } from './th';

export type Locale = 'th' | 'en';

export const LOCALES: readonly Locale[] = ['th', 'en'];

const CATALOGUES: Record<Locale, Translations> = { th, en };

/**
 * Default locale. The owner is Thai, so Thai is the default until L1.2 wires
 * `expo-localization` + the stored preference (see notes: debt H-1).
 */
let currentLocale: Locale = 'th';

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(next: Locale): void {
  if (next === currentLocale) return;
  currentLocale = next;
  emit();
}

export type TranslateParams = Readonly<Record<string, string | number>>;

/** Fill `{name}` placeholders. Missing params are left visible so QC can spot them. */
function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Translate a key in a given locale. Never throws: an unknown key falls back to the
 * Thai string and then to the key itself, so a missing string can never blank a screen.
 */
export function translate(locale: Locale, key: TranslationKey, params?: TranslateParams): string {
  const template = CATALOGUES[locale][key] ?? th[key] ?? key;
  return interpolate(template, params);
}

/** Non-reactive translate, for use outside React (engine adapters, error logs). */
export function t(key: TranslationKey, params?: TranslateParams): string {
  return translate(currentLocale, key, params);
}

export interface UseTranslation {
  locale: Locale;
  t: (key: TranslationKey, params?: TranslateParams) => string;
  setLocale: (next: Locale) => void;
}

/** Hook used by every screen. Re-renders on `setLocale` with no restart. */
export function useT(): UseTranslation {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return {
    locale,
    t: (key, params) => translate(locale, key, params),
    setLocale,
  };
}

export type { TranslationKey, Translations };
export { th, en };
