'use client'

/**
 * Un pedido A MANO, en un cajón.
 *
 * Casi todos entran solos desde PEDIDO. Éste es para lo que no pasa por ahí: un cliente
 * que llama, una entrega que se arma en el momento. Se quitó en algún momento y dejó a la
 * gente sin forma de meter esos.
 *
 * El cliente sale del espejo —ya con su geolocalización, que es lo que hace falta para
 * poder repartirlo— y los productos del catálogo de Ventra de ESA sucursal, con su peso.
 * Aquí no se teclea ni un peso ni un precio: los dos salen de donde viven.
 */

import { useMemo, useState } from 'react'
import axios from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@iconify/react'
import Drawer from '@/components/Drawer'
import CustomerPicker, { type Customer } from '@/components/CustomerPicker'
import ClienteNuevo from '@/components/ClienteNuevo'
import ProductPicker, { type Product } from '@/components/ProductPicker'
import Selector from '@/components/Selector'
import { useAppStore } from '@/store/useAppStore'

interface Linea {
  producto: Product
  packs: number
}

interface Sucursal {
  id: string
  name: string
  externalId?: string | null
}

export default function NuevoPedido({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const { token, sucursalId, user } = useAppStore()
  const queryClient = useQueryClient()
  const [cliente, setCliente] = useState<Customer | null>(null)
  /** Cuando el cliente no está en la lista, se da de alta aquí mismo. */
  const [creandoCliente, setCreandoCliente] = useState(false)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [notas, setNotas] = useState('')
  const [sucursal, setSucursal] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [costo, setCosto] = useState<{ usd: number; distanciaKm: number } | null>(null)

  const { data: branches = [] } = useQuery<Sucursal[]>({
    queryKey: ['branches'],
    queryFn: async () => (await axios.get('/api/branches', { headers: { Authorization: `Bearer ${token}` } })).data,
    enabled: !!token && abierto,
  })

  /**
   * La sucursal: la de la barra de arriba, y sólo se pregunta si arriba dice «todas».
   *
   * Un pedido tiene que nacer EN una: de ella salen el almacén desde el que se mide, los
   * vehículos y la ruta.
   */
  const suya = user?.branchId ?? null
  const elegida = suya ?? sucursal ?? sucursalId ?? ''
  const hayQuePreguntar = !suya && !sucursalId && branches.length > 1
  const codigo = branches.find((b) => b.id === elegida)?.externalId ?? null

  const peso = useMemo(
    () => lineas.reduce((t, l) => t + (l.producto.weight || 0) * l.packs, 0),
    [lineas],
  )
  const sinPeso = lineas.filter((l) => !l.producto.weight).length

  const crear = useMutation({
    mutationFn: async () =>
      (
        await axios.post(
          '/api/orders',
          {
            customerId: cliente?.id,
            branchId: elegida || undefined,
            notes: notas,
            items: lineas.map((l) => ({ productId: l.producto.id, packs: l.packs, quantity: l.packs })),
          },
          { headers: { Authorization: `Bearer ${token}` } },
        )
      ).data,
    onSuccess: (r: { aviso: string | null; costo?: { usd: number; distanciaKm: number } | null }) => {
      setAviso(r?.aviso ?? null)
      setCosto(r?.costo ?? null)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      // Se limpia para poder meter el siguiente sin cerrar y volver a abrir.
      setCliente(null)
      setLineas([])
      setNotas('')
    },
    onError: (e: unknown) => {
      const ax = e as { response?: { data?: { error?: string } } }

      setError(ax.response?.data?.error ?? 'No se pudo crear el pedido')
    },
  })

  const puede = cliente != null && lineas.length > 0 && Boolean(elegida)

  return (
    <Drawer
      abierto={abierto}
      alCerrar={alCerrar}
      titulo="Nuevo pedido"
      subtitulo={branches.find((b) => b.id === elegida)?.name}
      ancho="lg"
      pie={
        <>
          <button onClick={alCerrar} className="px-4 py-2 border border-line rounded-xl text-sm text-ink-soft hover:bg-ink/5">
            Cerrar
          </button>
          <button
            onClick={() => crear.mutate()}
            disabled={!puede || crear.isPending}
            className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-50"
          >
            {crear.isPending ? 'Creando…' : 'Crear pedido'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-ink-soft">
          Para lo que no viene de PEDIDO. El costo del domicilio se calcula con la{' '}
          <b>misma fórmula que Entrega</b> —tarifa de la sucursal × distancia desde el
          almacén × peso—, así que sale por el mismo número que si se hiciera desde el
          teléfono. El repartidor puede corregirlo allí.
        </p>

        {hayQuePreguntar && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft/70 mb-1">Sucursal</p>
            <Selector
              titulo="Sucursal del pedido"
              icono="mdi:store-outline"
              valor={sucursal}
              todos="Elige la sucursal…"
              onCambio={setSucursal}
              opciones={branches.map((b) => ({ valor: b.id, etiqueta: b.name, nota: b.externalId ?? undefined }))}
            />
          </div>
        )}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft/70 mb-1">Cliente</p>
          {cliente ? (
            <div className="flex items-start gap-2 rounded-xl border border-line p-3">
              <Icon icon="mdi:account" className="mt-0.5 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{cliente.name}</p>
                <p className="text-xs text-ink-soft truncate">{cliente.address || '—'}</p>
              </div>
              <button onClick={() => setCliente(null)} className="text-xs text-primary hover:underline">
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <CustomerPicker onPick={setCliente} />
              {/* Sólo salen los que tienen geolocalización: sin ella no se puede repartir. */}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-soft/70">
                <span>Salen los clientes de PEDIDO que tienen ubicación.</span>
                {/*
                  Y si no está, se crea AQUÍ.
                  
                  Mandaba a la pantalla de Clientes: había que salirse del pedido a medias,
                  darlo de alta allí y volver a empezar. El caso es justo éste — alguien
                  que llama y no está en la lista.
                */}
                <button
                  type="button"
                  onClick={() => setCreandoCliente((v) => !v)}
                  className="font-medium text-primary hover:underline"
                >
                  {creandoCliente ? 'Cancelar' : '¿No está? Crearlo aquí'}
                </button>
              </div>

              {creandoCliente && (
                <div className="mt-3 rounded-xl border border-line p-3">
                  <ClienteNuevo
                    alGuardar={(c) => {
                      // Se elige solo: es el que se estaba buscando.
                      setCliente({ ...c, externalId: '', lat: c.lat, lng: c.lng } as Customer)
                      setCreandoCliente(false)
                    }}
                    alCancelar={() => setCreandoCliente(false)}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft/70 mb-1">Productos</p>
          <ProductPicker
            sucursal={codigo ?? undefined}
            onPick={(p) =>
              setLineas((l) =>
                l.some((x) => x.producto.id === p.id) ? l : [...l, { producto: p, packs: 1 }],
              )
            }
          />

          {lineas.length > 0 && (
            <div className="mt-2 space-y-1">
              {lineas.map((l, i) => (
                <div key={l.producto.id} className="flex items-center gap-2 rounded-xl bg-ink/[0.03] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{l.producto.name}</p>
                    <p className="text-[11px] text-ink-soft/70">
                      {l.producto.weight
                        ? `${l.producto.weight} kg/formato`
                        : <span className="text-amber-700">sin peso en Ventra</span>}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={l.packs}
                    onChange={(e) =>
                      setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, packs: Math.max(1, Number(e.target.value) || 1) } : x)))
                    }
                    className="w-20 rounded-lg border border-line px-2 py-1 text-sm"
                    aria-label={`Formatos de ${l.producto.name}`}
                  />
                  <button
                    onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                    className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                    aria-label="Quitar"
                  >
                    <Icon icon="mdi:close" />
                  </button>
                </div>
              ))}

              <p className="pt-1 text-sm text-ink">
                Peso: <b className="font-mono">{peso.toFixed(2)} kg</b>
                {sinPeso > 0 && (
                  <span className="ml-2 text-xs text-amber-700">
                    {sinPeso} sin peso en Ventra: el total se queda corto
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft/70 mb-1">Notas</p>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Lo que haga falta saber para entregarlo"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {crear.isSuccess && !error && (
          <p className="text-sm text-green-700">
            Pedido creado{costo ? ` · domicilio ${costo.usd} USD (${costo.distanciaKm} km)` : ''}.
            {aviso ? ` ${aviso}` : ''} Ya se puede meter en una ruta.
          </p>
        )}
      </div>
    </Drawer>
  )
}
