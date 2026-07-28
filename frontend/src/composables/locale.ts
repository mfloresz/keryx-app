export type Locale = 'en' | 'es'

export const STORAGE_KEY = 'app-locale'
export const DEFAULT_LOCALE: Locale = 'en'
export const supportedLocales: Locale[] = ['en', 'es']

function getBrowserLocale(): Locale | null {
  if (typeof navigator === 'undefined' || typeof navigator.language !== 'string') {
    return null
  }

  const browserLang = navigator.language.split('-')[0]
  return supportedLocales.includes(browserLang as Locale) ? (browserLang as Locale) : null
}

export function resolveInitialLocale(): Locale {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  if (stored && supportedLocales.includes(stored as Locale)) {
    return stored as Locale
  }

  return getBrowserLocale() || DEFAULT_LOCALE
}

export function applyLocaleToDocument(locale: Locale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}
