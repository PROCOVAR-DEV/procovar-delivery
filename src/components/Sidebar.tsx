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
  { href: '/orders', icon: 'mdi:package-variant-closed', key: 'nav.orders' },
  { href: '/products', icon: 'mdi:tag-multiple-outline', key: 'nav.products' },
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
    ? [
        ...navItems,
        { href: '/sync', icon: 'mdi:sync', key: 'nav.sync' },
        { href: '/branches', icon: 'mdi:office-building-marker-outline', key: 'nav.branches' },
        { href: '/users', icon: 'mdi:account-group-outline', key: 'nav.users' },
      ]
    : navItems

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  return (
    <div className="w-64 bg-white/95 backdrop-blur h-screen border-r border-line flex flex-col fixed left-0 top-0 z-10">
      <div className="px-6 py-6">
        <h1 className="text-[1.35rem] font-extrabold text-ink flex items-center gap-2.5 tracking-tight">
          <span className="w-9 h-9 rounded-xl bg-primary text-white flex items-center justify-center shadow-md">
            <Icon icon="mdi:truck-fast" className="text-xl" />
          </span>
          ProCovar
        </h1>
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-soft/70 mt-2 ml-0.5">{t('nav.platform')}</p>
      </div>
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {items.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-xl text-sm transition-all duration-150 ${
                active
                  ? 'bg-primary/[0.08] text-primary font-semibold'
                  : 'text-ink-soft hover:bg-ink/[0.035] hover:text-ink font-medium'
              }`}
            >
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-primary" />}
              <Icon icon={item.icon} className="text-xl shrink-0" />
              <span>{t(item.key)}</span>
            </Link>
          )
        })}
      </nav>
      <div className="p-3 border-t border-line">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition-colors"
        >
          <Icon icon="mdi:logout" className="text-xl" />
          <span>{t('nav.logout')}</span>
        </button>
      </div>
    </div>
  )
}
