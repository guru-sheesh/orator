export type Theme = 'dark' | 'light'

const KEY = 'orator-theme'
const THEME_COLOR: Record<Theme, string> = { dark: '#121315', light: '#f7f5f1' }

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
  applyTheme(theme)
}

export function applyTheme(theme: Theme) {
  if (theme === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}
