import { ref, watch } from 'vue'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

const theme = ref<Theme>((localStorage.getItem(STORAGE_KEY) as Theme) || 'system')

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(current: Theme) {
  const resolved = current === 'system' ? getSystemTheme() : current
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

// Apply immediately on module load (before app mount)
applyTheme(theme.value)

// Watch for system changes
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
mediaQuery.addEventListener('change', () => {
  if (theme.value === 'system') {
    applyTheme('system')
  }
})

watch(theme, (newTheme) => {
  localStorage.setItem(STORAGE_KEY, newTheme)
  applyTheme(newTheme)
})

export function useTheme() {
  return {
    theme,
    setTheme: (t: Theme) => { theme.value = t },
  }
}
