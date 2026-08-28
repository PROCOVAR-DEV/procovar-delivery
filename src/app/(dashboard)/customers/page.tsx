'use client'

import { useEffect, useState } from 'react'
import Navbar from '@/components/Navbar'
import LocationInput, { LocationValue } from '@/components/LocationInput'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'
import { Icon } from '@iconify/react'

interface Customer {
  id: string
  source?: string | null
  externalId?: string | null
  name: string
  phone?: string | null
  address?: string | null
  municipio?: string | null
  lat: number
  lng: number
  sucursalCodigo?: string | null
}

const emptyLoc: LocationValue = { address: '', lat: null, lng: null }

export default function CustomersPage() {
  const { token } = useAppStore()
  const [query, setQuery] = useState('')
  const [municipio, setMunicipio] = useState('')
  const [sucursal, setSucursal] = useState('')
  const [zona, setZona] = useState('')
  const [origen, setOrigen] = useState('')
  const [pagina, setPagina] = useState(1)
  const [showForm, setShowForm] = useState(false)

  /**
   * La búsqueda la hace el servidor, no esta pantalla.
   *
   * Antes se traían los 500 primeros por nombre y se filtraban aquí: buscar un cliente
   * que empezara por «S» no encontraba nada porque nunca había llegado a llegar. Ahora se
   * manda `q` y la base busca entre todos.
   *
   * Con una pausa antes de preguntar: sin ella son ocho consultas para escribir "Sánchez".
   */
  const [buscado, setBuscado] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setBuscado(query.trim()), 400)

    return () => clearTimeout(id)
  }, [query])

  // Cualquier cambio de filtro vuelve a la página 1: quedarse en la 7 de una lista que
  // ahora tiene 2 enseña un vacío que parece un fallo.
  useEffect(() => { setPagina(1) }, [buscado, municipio, sucursal, zona, origen])

  const { data, isLoading } = useQuery({
    queryKey: ['customers', { buscado, municipio, sucursal, zona, origen, pagina }],
    queryFn: async () => {
      const res = await axios.get('/api/customers', {
        params: {
          ...(buscado ? { q: buscado } : {}),
          ...(municipio ? { municipio } : {}),
          ...(sucursal ? { sucursalCodigo: sucursal } : {}),
          ...(zona ? { zona } : {}),
          ...(origen ? { origen } : {}),
          pagina,
        },
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.data as {
        customers: Customer[]
        total: number
        pagina: number
        paginas: number
        porPagina: number
        truncated: boolean
        municipios: { valor: string; clientes: number }[]
        sucursales: { valor: string; clientes: number }[]
        zonas: { valor: string; clientes: number }[]
      }
    },
    enabled: !!token,
    // Se mantiene la lista anterior mientras llega la nueva: si no, cada letra deja la
    // pantalla en blanco un instante y parece que no hay clientes.
    placeholderData: (previo) => previo,
  })

  const customers = data?.customers ?? []
  const total = data?.total ?? 0
  const paginas = data?.paginas ?? 1
  const municipios = data?.municipios ?? []
  const sucursales = data?.sucursales ?? []
  const zonas = data?.zonas ?? []
  const filtered = customers

  return (
    <>
      <Navbar title="Clientes" />
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-ink">Clientes</h1>
            <p className="text-sm text-ink-soft/70">
              Clientes de PEDIDO (sincronizados, sólo con geo) + los manuales de delivery.{' '}
              {total.toLocaleString()} en total{paginas > 1 ? ` · página ${pagina} de ${paginas}` : ''}.
            </p>
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 flex items-center gap-1"
          >
            <Icon icon={showForm ? 'mdi:close' : 'mdi:account-plus-outline'} />
            {showForm ? 'Cancelar' : 'Nuevo cliente manual'}
          </button>
        </div>

        {showForm && <ManualCustomerForm onDone={() => setShowForm(false)} />}

        {/* Los mismos filtros que en Pedidos, con lo que un cliente tiene. Los aplica la
            base: son siete mil, y filtrar en la pantalla obliga a traérselos todos. */}
        <div className="flex flex-wrap gap-2">
          {sucursales.length > 1 && (
            <select
              value={sucursal}
              onChange={(e) => setSucursal(e.target.value)}
              className="px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              title="Sucursal del cliente"
            >
              <option value="">Todas las sucursales</option>
              {sucursales.map((s) => (
                <option key={s.valor} value={s.valor}>{s.valor} ({s.clientes.toLocaleString()})</option>
              ))}
            </select>
          )}
          {municipios.length > 1 && (
            <select
              value={municipio}
              onChange={(e) => setMunicipio(e.target.value)}
              className="px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              title="Municipio del cliente"
            >
              <option value="">Todos los municipios</option>
              {municipios.map((m) => (
                <option key={m.valor} value={m.valor}>{m.valor} ({m.clientes.toLocaleString()})</option>
              ))}
            </select>
          )}
          {zonas.length > 1 && (
            <select
              value={zona}
              onChange={(e) => setZona(e.target.value)}
              className="px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              title="Zona de reparto"
            >
              <option value="">Todas las zonas</option>
              {zonas.map((z) => (
                <option key={z.valor} value={z.valor}>{z.valor} ({z.clientes.toLocaleString()})</option>
              ))}
            </select>
          )}
          {/* De dónde salió: del espejo de PEDIDO o dado de alta a mano aquí. Los manuales
              son los que nadie más conoce, y por eso hay que poder aislarlos. */}
          <select
            value={origen}
            onChange={(e) => setOrigen(e.target.value)}
            className="px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            title="De dónde salió el cliente"
          >
            <option value="">De PEDIDO y manuales</option>
            <option value="pedido">Sólo los de PEDIDO</option>
            <option value="manual">Sólo los manuales</option>
          </select>
          {(municipio || sucursal || zona || origen || query) && (
            <button
              type="button"
              onClick={() => { setQuery(''); setMunicipio(''); setSucursal(''); setZona(''); setOrigen('') }}
              className="px-3 py-2 text-sm text-ink-soft/70 hover:text-ink"
            >
              Quitar filtros
            </button>
          )}
        </div>

        <div className="relative">
          <Icon icon="mdi:magnify" className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, dirección o municipio…"
            className="w-full pl-9 pr-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div className="bg-white border border-line rounded-xl overflow-hidden">
          {isLoading ? (
            <p className="p-6 text-center text-sm text-ink-soft/70">Cargando…</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-soft/70">
              {customers.length === 0
                ? 'Sin clientes todavía. Los de PEDIDO aparecen solos cuando tengan geolocalización.'
                : 'Sin resultados.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-ink-soft/70">
                <tr>
                  <th className="px-4 py-2 text-left">Cliente</th>
                  <th className="px-4 py-2 text-left">Dirección</th>
                  <th className="px-4 py-2 text-left">Origen</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-4 py-2 font-medium">
                      {c.name}
                      {c.phone && <span className="block text-[11px] text-ink-soft/60">{c.phone}</span>}
                    </td>
                    <td className="px-4 py-2 text-ink-soft/80">
                      {[c.address, c.municipio].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2">
                      {c.source === 'pedido' ? (
                        <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[11px] font-semibold">PEDIDO</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-semibold">Manual</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Los botones de página, que NO estaban.
              La cabecera decía «página 1 de 4» y no había forma de llegar a la 2: la
              lista viene paginada del servidor —son siete mil clientes— así que sin esto
              sólo se podían ver los doscientos primeros. */}
          {paginas > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
              <span className="text-ink-soft/70">
                {((pagina - 1) * (data?.porPagina ?? 200) + 1).toLocaleString()}–
                {Math.min(pagina * (data?.porPagina ?? 200), total).toLocaleString()} de {total.toLocaleString()}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={pagina <= 1}
                  className="px-3 py-1.5 rounded-xl border border-line disabled:opacity-40 hover:bg-ink/[0.03]"
                >
                  <Icon icon="mdi:chevron-left" className="inline" /> Anterior
                </button>
                <span className="text-ink-soft/70">{pagina} / {paginas}</span>
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
                  disabled={pagina >= paginas}
                  className="px-3 py-1.5 rounded-xl border border-line disabled:opacity-40 hover:bg-ink/[0.03]"
                >
                  Siguiente <Icon icon="mdi:chevron-right" className="inline" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// Form de cliente MANUAL (source=null) local de delivery. NO crea nada en PEDIDO.
function ManualCustomerForm({ onDone }: { onDone: () => void }) {
  const { token } = useAppStore()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [municipio, setMunicipio] = useState('')
  const [loc, setLoc] = useState<LocationValue>(emptyLoc)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const canSave = name.trim() !== '' && loc.lat != null && loc.lng != null

  const save = async () => {
    if (!canSave || saving) return
    setSaving(true)
    setError('')
    try {
      await axios.post(
        '/api/customers',
        { name: name.trim(), phone, municipio, address: loc.address, lat: loc.lat, lng: loc.lng },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      onDone()
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-gray-50 border border-line rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-ink">Nuevo cliente manual (local de delivery)</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre *"
          className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Teléfono"
          className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        <input value={municipio} onChange={(e) => setMunicipio(e.target.value)} placeholder="Municipio"
          className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
      </div>
      <LocationInput value={loc} onChange={setLoc} label="Dirección y ubicación *" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <button disabled={!canSave || saving} onClick={save}
          className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar cliente'}
        </button>
      </div>
    </div>
  )
}
