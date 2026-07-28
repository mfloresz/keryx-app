/**
 * useLanguage
 *
 * Composable for managing the application language/locale.
 * Persists the selected locale in localStorage and provides
 * a function to toggle between supported languages.
 */
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  applyLocaleToDocument,
  resolveInitialLocale,
  STORAGE_KEY,
  type Locale,
  supportedLocales,
} from "./locale";

const currentLocale = ref<Locale>(resolveInitialLocale());
applyLocaleToDocument(currentLocale.value);

export function useLanguage() {
  const { locale } = useI18n();

  // Sync with i18n on first use
  if (locale.value !== currentLocale.value) {
    locale.value = currentLocale.value;
  }

  watch(currentLocale, (newLocale) => {
    locale.value = newLocale;
    applyLocaleToDocument(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
  });

  function setLocale(lang: Locale) {
    currentLocale.value = lang;
  }

  function toggleLocale() {
    currentLocale.value = currentLocale.value === "en" ? "es" : "en";
  }

  return {
    locale: currentLocale,
    setLocale,
    toggleLocale,
    supportedLocales,
  };
}
