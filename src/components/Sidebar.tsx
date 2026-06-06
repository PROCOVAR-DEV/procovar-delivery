'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAppStore } from '@/store/useAppStore'
import { useRouter } from 'next/navigation'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

const navItems = [
  { href: '/dashboard', icon: 'mdi:view-dashboard-outline', key: 'nav.dashboard' },
  { href: '/routes', icon: 'mdi:map-marker-path', key: 'nav.routes' },
  { href: '/vehicles', icon: 'mdi:truck-outline', key: 'nav.vehicles' },
  { href: '/reports', icon: 'mdi:chart-bar', key: 'nav.reports' },
  { href: '/settings', icon: 'mdi:cog-outline', key: 'nav.settings' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { logout, user } = useAppStore()
  const router = useRouter()
  const t = useT()

  const items = user?.role === 'admin'
    ? [...navItems, { href: '/users', icon: 'mdi:account-group-outline', key: 'nav.users' }]
    : navItems

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  return (
    <div className="w-64 bg-white h-screen shadow-md flex flex-col fixed left-0 top-0 z-10">
      <div className="p-6 border-b">
        <h1 className="text-xl font-bold text-primary flex items-center gap-2">
          <Icon icon="mdi:truck-delivery" className="text-2xl" />
          ProCovar
        </h1>
        <p className="text-xs text-gray-500 mt-1">{t('nav.platform')}</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
              pathname === item.href
                ? 'bg-blue-50 text-primary'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Icon icon={item.icon} className="text-xl" />
            <span>{t(item.key)}</span>
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition-colors"
        >
          <Icon icon="mdi:logout" className="text-xl" />
          <span>{t('nav.logout')}</span>
        </button>
      </div>
    </div>
  )
}
