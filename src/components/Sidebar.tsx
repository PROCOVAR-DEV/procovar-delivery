'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

/**
 * Sólo lo que delivery hace de verdad: controlar envíos.
 *
 * Se van tres entradas que quedaron de cuando esto calculaba el costo del domicilio:
 *
 *   Productos  — el catálogo propio contra el almacén. PEDIDO ya manda el peso de cada
 *                línea resuelto contra Ventra, así que mantener un segundo catálogo del
 *                mismo dato sólo sirve para que los dos discrepen.
 *   Reportes   — informes de costos de domicilio, que ya no calcula delivery.
 *   Sucursales — su gestión pertenece a auth, que es el dueño de las sucursales.
 *
 * Las PANTALLAS siguen existiendo y se llegan por URL: quitarlas del menú deja de
 * ofrecerlas sin borrar la capacidad de entrar si hiciera falta configurar algo.
 *
 * Aquí abajo tampoco hay ya nada de la cuenta. Cerrar sesión, quién eres e ir a otra
 * aplicación son cosas de tu cuenta, no de esta aplicación, y viven donde la gente las
 * busca: en el avatar, arriba a la derecha. El enlace a los usuarios de Accesos se quita
 * del todo — no todo el mundo tiene por qué ver eso.
 */
const navItems = [
  { href: '/dashboard', icon: 'mdi:view-dashboard-outline', key: 'nav.dashboard' },
  { href: '/routes', icon: 'mdi:map-marker-path', key: 'nav.routes' },
  { href: '/orders', icon: 'mdi:package-variant-closed', key: 'nav.orders' },
  { href: '/customers', icon: 'mdi:account-multiple-outline', key: 'nav.customers' },
  { href: '/vehicles', icon: 'mdi:truck-outline', key: 'nav.vehicles' },
  { href: '/settings', icon: 'mdi:cog-outline', key: 'nav.settings' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const t = useT()

  // Sucursales sale también del menú del admin: su dueño es auth.
  const items = navItems

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
    </div>
  )
}
