'use client'

import { useState } from 'react'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'
import Pagination, { usePagedList } from '@/components/Pagination'
import { useAppStore } from '@/store/useAppStore'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

interface UserRow {
  id: string
  email: string
  name: string
  role: string
  createdAt: string
  branchId?: string | null
  branch?: { id: string; name: string } | null
  _count?: {
    orders: number
    routes: number
    vehicles: number
  }
}

interface BranchOption {
  id: string
  name: string
}

const ACCESOS = 'https://auth.procovar.cloud'

/**
 * Quién trabaja en delivery. Solo mirar.
 *
 * Las personas viven en Accesos; esta lista es su reflejo y se rellena sola
 * cuando alguien entra. Aquí ya no se crea, ni se edita, ni se borra:
 *
 * - Editar no serviría de nada. El rol y la sucursal se refrescan desde Accesos
 *   CADA VEZ que la persona entra, así que un cambio hecho aquí duraría hasta su
 *   siguiente inicio de sesión — la peor clase de fallo, el que parece que
 *   funcionó.
 * - Borrar, menos. Estas fichas son a las que apuntan los pedidos, las rutas y
 *   los vehículos de cada uno. Quitarle el acceso a alguien se hace en Accesos;
 *   la ficha se queda aquí sosteniendo el histórico.
 *
 * La columna de actividad se queda, y es lo más útil de la pantalla: dice qué
 * hay colgado de cada ficha, que es justo lo que hay que mirar antes de tocar
 * nada.
 */
export default function UsersPage() {
  const { token, user } = useAppStore()
  const t = useT()
  const [search, setSearch] = useState('')

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await axios.get('/api/users', {
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.data as UserRow[]
    },
    enabled: !!token && user?.role === 'admin',
  })

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await axios.get('/api/branches', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as BranchOption[]
    },
    enabled: !!token && user?.role === 'admin',
  })

  const q = search.trim().toLowerCase()
  const filtered = users.filter(
    (u) =>
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q),
  )

  const paged = usePagedList(filtered, 25)

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col">
        <Navbar title={t('usr.title')} />
        <div className="p-6">
          <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-md">
            {t('usr.noPermission')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <Navbar title={t('usr.title')} />
      <div className="space-y-4 p-6">
        {/* Decirlo arriba evita que alguien busque el botón de crear durante
            diez minutos antes de preguntar. */}
        <div className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <Icon icon="mdi:information-outline" className="mt-0.5 shrink-0 text-base" />
          <span>
            Las personas, sus roles y sus permisos se gestionan en{' '}
            <a href={ACCESOS} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
              Accesos de Procovar
            </a>
            . Esta lista se rellena sola cuando alguien entra, y su rol y su sucursal se
            actualizan en cada entrada.
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-gray-700">{t('usr.admin')}</h3>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Icon
                icon="mdi:magnify"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('common.search')}
                className="rounded-xl border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <a
              href={`${ACCESOS}/dashboard/organizations`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl bg-[#054C74] px-4 py-2 font-medium text-white hover:bg-[#04324C]"
            >
              <Icon icon="mdi:shield-account" />
              Gestionar en Accesos
            </a>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl bg-white shadow-md">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">{t('usr.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              {q
                ? `Nadie coincide con "${search.trim()}".`
                : 'Todavía no ha entrado nadie en delivery.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-3 text-left">{t('common.name')}</th>
                  <th className="px-4 py-3 text-left">{t('usr.colEmail')}</th>
                  <th className="px-4 py-3 text-left">{t('usr.colRole')}</th>
                  <th className="px-4 py-3 text-left">{t('usr.branch')}</th>
                  <th className="px-4 py-3 text-left">{t('usr.colActivity')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((row) => (
                  <tr key={row.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">{row.name}</td>
                    <td className="px-4 py-3 text-gray-600">{row.email}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                        {row.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {row.branchId ? (
                        row.branch?.name ||
                        branches.find((b) => b.id === row.branchId)?.name ||
                        row.branchId
                      ) : (
                        <span className="text-gray-400">{t('usr.branchGlobal')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {row._count
                        ? t('usr.activity', {
                            o: row._count.orders,
                            r: row._count.routes,
                            v: row._count.vehicles,
                          })
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <Pagination
          {...paged}
          onPage={paged.setPage}
          onPageSize={paged.setPageSize}
        />
      </div>
    </div>
  )
}
