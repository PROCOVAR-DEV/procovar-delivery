'use client'

import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'

export interface CurrencyDef {
  code: string
  /** Units of this currency per 1 USD. USD itself is 1. */
  rate: number
}

interface SettingsShape {
  currencies?: CurrencyDef[]
  cupRate?: number
}

const USD: CurrencyDef = { code: 'USD', rate: 1 }

/**
 * Reads the configured currency list from Settings and the user's selected
 * display currency from the store. Returns a `format(usd)` helper that converts
 * a USD amount into the selected currency and labels it.
 */
export function useCurrency() {
  const { token, displayCurrency, setDisplayCurrency } = useAppStore()

  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await axios.get('/api/settings', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as SettingsShape
    },
    enabled: !!token,
  })

  const configured: CurrencyDef[] = Array.isArray(data?.currencies) ? data!.currencies! : []
  const list: CurrencyDef[] = [USD, ...configured.filter((c) => c.code && c.code !== 'USD' && c.rate > 0)]

  const selected = list.find((c) => c.code === displayCurrency) ?? USD

  const format = (usd: number): string => {
    const value = (usd ?? 0) * selected.rate
    const fractionDigits = selected.code === 'USD' ? 2 : 0
    return `${value.toLocaleString('es-ES', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })} ${selected.code}`
  }

  return { code: selected.code, rate: selected.rate, currencies: list, format, setDisplayCurrency }
}
