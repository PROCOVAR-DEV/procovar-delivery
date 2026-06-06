import { create } from 'zustand'

interface User {
  id: string
  email: string
  name: string
  role: string
}

export type Lang = 'es' | 'en'

interface AppState {
  user: User | null
  token: string | null
  displayCurrency: string
  language: Lang
  setUser: (user: User | null) => void
  setToken: (token: string | null) => void
  setDisplayCurrency: (code: string) => void
  setLanguage: (lang: Lang) => void
  logout: () => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  token: null,
  displayCurrency: 'USD',
  language: 'es',
  setUser: (user) => set({ user }),
  setToken: (token) => {
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('token', token)
      } else {
        localStorage.removeItem('token')
      }
    }
    set({ token })
  },
  setDisplayCurrency: (code) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('displayCurrency', code)
    }
    set({ displayCurrency: code })
  },
  setLanguage: (lang) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('language', lang)
    }
    set({ language: lang })
  },
  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token')
    }
    set({ user: null, token: null })
  },
}))

// Hydrate from localStorage on client only
if (typeof window !== 'undefined') {
  const storedToken = localStorage.getItem('token')
  if (storedToken) {
    useAppStore.setState({ token: storedToken })
  }
  const storedCurrency = localStorage.getItem('displayCurrency')
  if (storedCurrency) {
    useAppStore.setState({ displayCurrency: storedCurrency })
  }
  const storedLang = localStorage.getItem('language')
  if (storedLang === 'es' || storedLang === 'en') {
    useAppStore.setState({ language: storedLang })
  }
}
