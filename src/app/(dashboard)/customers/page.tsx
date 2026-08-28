'use client'

import { useEffect, useState } from 'react'
import Navbar from '@/components/Navbar'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'
import { Icon } from '@iconify/react'
import Selector from '@/components/Selector'
import Drawer from '@/components/Drawer'
import ClienteNuevo from '@/components/ClienteNuevo'

interface Customer {
  id: string
  source?: string | null
  externalId?: string | null
  name: string
  phone?: string | null
  address?: string | null
  municipio?: string | null
  /** El código en PEDIDO: es como lo nombra la gente cuando llama por él. */
  codigo?: string | null
  /** Quién lo atiende. */
  vendedor?: string | null
  lat: number
  lng: number
  sucursalCodigo?: string | null
}


export default function CustomersPage() {
  const { token } = useAppStore()
  const [query, setQuery] = useState('')
  const [municipio, setMunicipio] = useState('')
  const [zona, setZona] = useState('')
  const [vendedor, setVendedor] = useState('')
  const [telefono, setTelefono] = useState('')
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
  useEffect(() => { setPagina(1) }, [buscado, municipio, zona, origen, vendedor, telefono])

  const { data, isLoading } = useQuery({
    queryKey: ['customers', { buscado, municipio, zona, origen, vendedor, telefono, pagina }],
    queryFn: async () => {
      const res = await axios.get('/api/customers', {
        params: {
          ...(buscado ? { q: buscado } : {}),
          ...(municipio ? { municipio } : {}),
          ...(zona ? { zona } : {}),
          ...(vendedor ? { vendedor } : {}),
          ...(telefono ? { telefono } : {}),
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
        vendedores: { valor: string; clientes: number }[]
        sinTelefono: number
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
  const zonas = data?.zonas ?? []
  const vendedores = data?.vendedores ?? []
  const sinTelefono = data?.sinTelefono ?? 0
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
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 flex items-center gap-1"
          >
            <Icon icon="mdi:account-plus-outline" />
            Nuevo cliente manual
          </button>
        </div>

        {/*
          El alta, en CAJÓN.

          Se abría empujando la lista hacia abajo: el mapa ocupa media pantalla, así que al
          pulsar «nuevo» desaparecía de la vista lo que se estaba mirando y había que
          desplazarse para volver. Un cajón deja la lista donde estaba.
        */}
        <Drawer
          abierto={showForm}
          alCerrar={() => setShowForm(false)}
          titulo="Nuevo cliente"
          subtitulo="Local de delivery: los de PEDIDO llegan solos"
          ancho="lg"
        >
          {/* El mismo formulario que se usa dentro del pedido a mano: uno solo, para
              que no haya dos formas distintas de que falte un dato. */}
          <ClienteNuevo alGuardar={() => setShowForm(false)} alCancelar={() => setShowForm(false)} />
        </Drawer>

        {/* Los mismos filtros que en Pedidos, con lo que un cliente tiene. Los aplica la
            base: son siete mil, y filtrar en la pantalla obliga a traérselos todos. */}
        <div className="flex flex-wrap gap-2">
          {/* La sucursal la manda el selector de la barra de arriba, no éste. Ver la nota
              en la pantalla de Pedidos: dos sitios para elegir lo mismo es poder elegir
              dos cosas distintas. */}
          {municipios.length > 1 && (
            <Selector
              titulo="Municipio del cliente"
              valor={municipio}
              todos="Todos los municipios"
              onCambio={setMunicipio}
              opciones={municipios.map((m) => ({ valor: m.valor, etiqueta: m.valor, nota: m.clientes.toLocaleString() }))}
            />
          )}
          {/*
            De quién es el cliente y si se le puede llamar.

            Los dos estaban en el dato y no se podían usar: el vendedor vivía dentro del
            payload entero —filtrar por él era leerse los siete mil— y el teléfono no se
            miraba. «Los míos» es el filtro que más se pide, y «sin teléfono» es una
            carencia de verdad: a ése no se le puede avisar de que va el reparto.
          */}
          {vendedores.length > 1 && (
            <Selector
              titulo="Vendedor que lo atiende"
              icono="mdi:account-tie-outline"
              valor={vendedor}
              todos={`Todos los vendedores (${vendedores.length})`}
              onCambio={setVendedor}
              opciones={vendedores.map((v) => ({ valor: v.valor, etiqueta: v.valor, nota: v.clientes.toLocaleString() }))}
            />
          )}

          <Selector
            titulo="Si tiene teléfono"
            icono="mdi:phone-outline"
            valor={telefono}
            todos="Con y sin teléfono"
            onCambio={setTelefono}
            opciones={[
              { valor: '1', etiqueta: 'Con teléfono' },
              { valor: '0', etiqueta: 'Sin teléfono', nota: sinTelefono ? sinTelefono.toLocaleString() : undefined },
            ]}
          />

          {zonas.length > 1 && (
            <Selector
              titulo="Zona de reparto"
              valor={zona}
              todos="Todas las zonas"
              onCambio={setZona}
              opciones={zonas.map((z) => ({ valor: z.valor, etiqueta: z.valor, nota: z.clientes.toLocaleString() }))}
            />
          )}
          {/* De dónde salió: del espejo de PEDIDO o dado de alta a mano aquí. Los manuales
              son los que nadie más conoce, y por eso hay que poder aislarlos. */}
          <Selector
            titulo="De dónde salió el cliente"
            valor={origen}
            todos="De PEDIDO y manuales"
            onCambio={setOrigen}
            opciones={[
              { valor: 'pedido', etiqueta: 'Sólo los de PEDIDO' },
              { valor: 'manual', etiqueta: 'Sólo los manuales' },
            ]}
          />
          {(municipio || zona || origen || query) && (
            <button
              type="button"
              onClick={() => { setQuery(''); setMunicipio(''); setZona(''); setOrigen('') }}
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
            <p className="p-3 sm:p-6 text-center text-sm text-ink-soft/70">Cargando…</p>
          ) : filtered.length === 0 ? (
            <p className="p-3 sm:p-6 text-center text-sm text-ink-soft/70">
              {customers.length === 0
                ? 'Sin clientes todavía. Los de PEDIDO aparecen solos cuando tengan geolocalización.'
                : 'Sin resultados.'}
            </p>
          ) : (
            /* A lo ancho se desplaza LA TABLA, no la página: si no, en un teléfono se
               mueve todo —barra de arriba incluida— y se pierde dónde se estaba. */
            <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-gray-50 text-ink-soft/70">
                <tr>
                  <th className="px-4 py-2 text-left">Cliente</th>
                  <th className="px-4 py-2 text-left">Dirección</th>
                  <th className="px-4 py-2 text-left">Vendedor</th>
                  <th className="px-4 py-2 text-left">Origen</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-4 py-2 font-medium">
                      {c.name}
                      {/* El código es como lo nombra la gente cuando llama por él. */}
                      {c.codigo && <span className="block font-mono text-[11px] text-ink-soft/60">{c.codigo}</span>}
                      {c.phone
                        ? <span className="block text-[11px] text-ink-soft/60">{c.phone}</span>
                        : <span className="block text-[11px] text-amber-700">sin teléfono</span>}
                    </td>
                    <td className="px-4 py-2 text-ink-soft/80">
                      {[c.address, c.municipio].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-soft/80">{c.vendedor || '—'}</td>
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
            </div>
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
