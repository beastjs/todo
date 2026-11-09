import { createContext, use } from 'octane'
import type { Theme } from './theme'

export interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

// Keep the context shared by the provider and consumers outside component HMR.
export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext)
  if (context === null) throw new Error('useTheme must be used within ThemeProvider.')
  return context
}
