(() => {
  try {
    const supportedLocales = ['en', 'es']
    const storedLocale = localStorage.getItem('app-locale')
    const browserLocale = navigator.language.split('-')[0]
    const locale = supportedLocales.includes(storedLocale)
      ? storedLocale
      : supportedLocales.includes(browserLocale)
        ? browserLocale
        : 'en'

    document.documentElement.lang = locale
  }
  catch {
    // Ignore storage or navigator access failures and fall back to the app bootstrap.
  }
})()
