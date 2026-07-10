import { create } from 'zustand'
import axios from 'axios'

// Header que el backend usa para scopear por sucursal (el admin elige una en el panel).
function applySucursalHeader(id: string | null) {
  if (id) axios.defaults.headers.common['x-sucursal-id'] = id
  else delete axios.defaults.headers.common['x-sucursal-id']
}

export interface BranchInfo {
  id: string
  name: string
  lat: number
  lng: number
  areaKm2: number
}

interface User {
  id: string
  email: string
  name: string
  role: string
  branchId?: string | null
  branch?: BranchInfo | null
}

export type Lang = 'es' | 'en'

interface AppState {
  user: User | null
  token: string | null
  displayCurrency: string
  language: Lang
  sucursalId: string | null
  setUser: (user: User | null) => void
  setToken: (token: string | null) => void
  setDisplayCurrency: (code: string) => void
  setLanguage: (lang: Lang) => void
  setSucursalId: (id: string | null) => void
  logout: () => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  token: null,
  displayCurrency: 'USD',
  language: 'es',
  sucursalId: null,
  setUser: (user) => {
    if (typeof window !== 'undefined') {
      if (user) localStorage.setItem('user', JSON.stringify(user))
      else localStorage.removeItem('user')
    }
    set({ user })
  },
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
  setSucursalId: (id) => {
    applySucursalHeader(id)
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem('sucursalId', id)
      else localStorage.removeItem('sucursalId')
    }
    set({ sucursalId: id })
  },
  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
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
  const storedUser = localStorage.getItem('user')
  if (storedUser) {
    try { useAppStore.setState({ user: JSON.parse(storedUser) }) } catch { /* ignore */ }
  }
  const storedCurrency = localStorage.getItem('displayCurrency')
  if (storedCurrency) {
    useAppStore.setState({ displayCurrency: storedCurrency })
  }
  const storedLang = localStorage.getItem('language')
  if (storedLang === 'es' || storedLang === 'en') {
    useAppStore.setState({ language: storedLang })
  }
  const storedSucursalId = localStorage.getItem('sucursalId')
  applySucursalHeader(storedSucursalId)
  if (storedSucursalId) {
    useAppStore.setState({ sucursalId: storedSucursalId })
  }
}
