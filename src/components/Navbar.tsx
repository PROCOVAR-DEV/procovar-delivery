'use client'

import { useAppStore } from '@/store/useAppStore'
import { useCurrency } from '@/lib/useCurrency'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

export default function Navbar({ title }: { title: string }) {
  const { user, language, setLanguage } = useAppStore()
  const { code, currencies, setDisplayCurrency } = useCurrency()
  const t = useT()

  return (
    <div className="h-16 bg-white border-b px-6 flex items-center justify-between shadow-sm">
      <h2 className="text-xl font-bold text-gray-800">{title}</h2>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Icon icon="mdi:translate" className="text-gray-400 text-lg" />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'es' | 'en')}
            className="text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
            title={t('navbar.language')}
          >
            <option value="es">ES</option>
            <option value="en">EN</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <Icon icon="mdi:cash-multiple" className="text-gray-400 text-lg" />
          <select
            value={code}
            onChange={(e) => setDisplayCurrency(e.target.value)}
            className="text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
            title={t('navbar.currency')}
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>{c.code}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white text-sm font-bold">
            {user?.name?.[0] || 'U'}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">{user?.name || 'User'}</p>
            <p className="text-xs text-gray-500">{user?.role || 'admin'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
