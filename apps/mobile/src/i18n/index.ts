/**
 * The whole i18n layer. Two equal languages (DESIGN §2.7) and switching must take
 * effect immediately, without a restart — so the current locale lives in a tiny
 * external store that screens read through `useT()`.
 *
 * Nothing outside this folder is allowed to contain Thai characters
 * (APP-RUN §0.2 rule 7 — enforced by `scripts/fitness.mts` and oracle S5.3).
 */

import { useSyncExternalStore } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { en } from './en';
import { th, type Translations, type TranslationKey } from './th';

export type Locale = 'th' | 'en';

export const LOCALES: readonly Locale[] = ['th', 'en'];

const CATALOGUES: Record<Locale, Translations> = { th, en };

const STORAGE_KEY = 'lucid.locale';

/**
 * L1.2 pays down L1.1 debt H-1: the default used to be hardcoded `'th'`. Now it reads
 * the device locale (via `Intl`, already bundled with Hermes — no `expo-localization`
 * dependency needed) and, once storage has loaded, the user's own last choice wins.
 *
 * `Intl.DateTimeFormat().resolvedOptions().locale` works the same on iOS Hermes and on
 * the web QC build, which is exactly the two places this needs to work in Phase 1.
 */
function detectDeviceLocale(): Locale {
  try {
    const tag = new Intl.DateTimeFormat().resolvedOptions().locale;
    return tag.toLowerCase().startsWith('th') ? 'th' : 'en';
  } catch {
    return 'en';
  }
}

let currentLocale: Locale = detectDeviceLocale();

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
  if (next !== currentLocale) {
    currentLocale = next;
    emit();
  }
  // Always persist, even if unchanged — a user tapping the language they are already
  // on should still "stick" past the AsyncStorage hydration race below.
  AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
}

/**
 * Runs once at module load: if the user picked a language before, it wins over the
 * device-locale guess above. `setLocale` (not a direct assignment) so any screen
 * already mounted re-renders when the stored value turns out to differ.
 */
async function hydrateStoredLocale(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'th' || stored === 'en') {
      if (stored !== currentLocale) {
        currentLocale = stored;
        emit();
      }
    }
  } catch {
    // No storage (or it failed) — keep the device-locale guess.
  }
}

void hydrateStoredLocale();

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

export interface UseLocale {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

/**
 * Lighter than `useT()` for screens that only need the current locale + a setter (the
 * language switch in Settings) and do not translate anything themselves.
 */
export function useLocale(): UseLocale {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, setLocale };
}

export type { TranslationKey, Translations };
export { th, en };
