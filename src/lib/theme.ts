export type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'saia-themes'

const isTheme = (value: string | null): value is Theme => value === 'light' || value === 'dark'

export function getPreferredTheme(): Theme {
  if (typeof document !== 'undefined') {
    if (document.documentElement.classList.contains('dark')) return 'dark'
    if (document.documentElement.classList.contains('light')) return 'light'
  }

  if (typeof window === 'undefined') return 'light'

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (isTheme(storedTheme)) return storedTheme
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  root.classList.toggle('light', theme === 'light')
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

export function saveTheme(theme: Theme): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // The active theme still works when storage is unavailable.
  }
}
