'use client'

/**
 * Cerrar la ruta: qué se entregó y qué vuelve en el camión.
 *
 * El camión regresa y hay que cuadrar lo que baja. Hasta ahora la ruta se marcaba
 * «completada» entera y no quedaba en ningún sitio qué cliente no recibió lo suyo: el
 * descuadre aparecía días después, sin poder decir de qué reparto salió.
 *
 * Aquí se marca parada por parada —entregado, devuelto o cancelado— y de eso sale el
 * POST-DESPACHO: la hoja de lo que tiene que quedar arriba, para contarlo contra lo que
 * de verdad baja.
 *
 * Ni «devuelto» ni «cancelado» tocan el inventario: el reintegro lo hace Ventra. Esto es
 * el control del logístico, y se dice en pantalla para que nadie lo dé por hecho.
 */

import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@iconify/react'
import Drawer from '@/components/Drawer'
import { useAppStore } from '@/store/useAppStore'
import { armarPostDespacho, type PedidoDeRuta } from '@/lib/armarPostDespacho'
import { imprimirPostDespacho } from '@/lib/imprimirPostDespacho'

export type Resultado = 'entregado' | 'devuelto' | 'cancelado'

export interface ParadaDeRuta {
  id: string
  customerName: string
  endAddress?: string | null
  address: string
  stopOrder?: number | null
  resultado?: string | null
  resultadoNota?: string | null
  items?: Array<{ name?: string; description?: string; quantity?: number; packs?: number | null }>
}

interface Props {
  abierto: boolean
  alCerrar: () => void
  rutaId: string
  titulo: string
  sucursal: string
  vehiculo: string
  salida?: string | null
  regreso?: string | null
  paradas: ParadaDeRuta[]
}

const ETIQUETAS: Record<Resultado, { texto: string; icono: string; clase: string }> = {
  entregado: { texto: 'Entregado', icono: 'mdi:check-circle-outline', clase: 'bg-green-600 text-white' },
  devuelto: { texto: 'Devuelto', icono: 'mdi:truck-remove-outline', clase: 'bg-red-600 text-white' },
  cancelado: { texto: 'Cancelado', icono: 'mdi:close-circle-outline', clase: 'bg-gray-600 text-white' },
}

export default function CierreDeRuta({
  abierto, alCerrar, rutaId, titulo, sucursal, vehiculo, salida, regreso, paradas,
}: Props) {
  const { token } = useAppStore()
  const queryClient = useQueryClient()
  /** Lo marcado en esta sesión, encima de lo que ya estaba guardado. */
  const [marcas, setMarcas] = useState<Record<string, Resultado>>({})
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  // Al abrir se parte de lo que YA está guardado: si no, reabrir el cajón parecería que
  // no se había marcado nada y se volvería a marcar todo desde cero.
  useEffect(() => {
    if (!abierto) return

    const previas: Record<string, Resultado> = {}
    const notasPrevias: Record<string, string> = {}

    for (const p of paradas) {
      if (p.resultado) previas[p.id] = p.resultado as Resultado
      if (p.resultadoNota) notasPrevias[p.id] = p.resultadoNota
    }
    setMarcas(previas)
    setNotas(notasPrevias)
    setError(null)
  }, [abierto, paradas])

  const marcadas = Object.keys(marcas).length
  const sinMarcar = paradas.length - marcadas

  /** La hoja, con lo marcado ahora mismo: se puede mirar antes de guardar. */
  const hoja = useMemo(() => {
    const pedidos: PedidoDeRuta[] = paradas.map((p) => ({
      customerName: p.customerName,
      resultado: marcas[p.id] ?? null,
      resultadoNota: notas[p.id] ?? null,
      items: p.items,
    }))

    return armarPostDespacho(
      {
        ruta: titulo,
        sucursal,
        vehiculo,
        salida: salida ? new Date(salida).toLocaleString('es') : undefined,
        regreso: regreso ? new Date(regreso).toLocaleString('es') : undefined,
      },
      pedidos,
    )
  }, [paradas, marcas, notas, titulo, sucursal, vehiculo, salida, regreso])

  const guardar = useMutation({
    mutationFn: async () =>
      (
        await axios.post(
          `/api/routes/${rutaId}/results`,
          {
            resultados: Object.entries(marcas).map(([orderId, resultado]) => ({
              orderId,
              resultado,
              nota: notas[orderId] || null,
            })),
          },
          { headers: { Authorization: `Bearer ${token}` } },
        )
      ).data,
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (e: unknown) => {
      const ax = e as { response?: { data?: { error?: string } } }

      setError(ax.response?.data?.error ?? 'No se pudo guardar el cierre')
    },
  })

  const marcarTodas = (r: Resultado) => {
    setMarcas(Object.fromEntries(paradas.map((p) => [p.id, r])))
  }

  return (
    <Drawer
      abierto={abierto}
      alCerrar={alCerrar}
      titulo="Cierre de ruta"
      subtitulo={`${titulo} · ${paradas.length} parada(s)`}
      ancho="xl"
      pie={
        <>
          <button
            onClick={() => imprimirPostDespacho(hoja)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm text-ink-soft hover:bg-ink/5"
          >
            <Icon icon="mdi:printer-outline" />
            Post-despacho
          </button>
          <button onClick={alCerrar} className="rounded-xl border border-line px-4 py-2 text-sm text-ink-soft hover:bg-ink/5">
            Cerrar
          </button>
          <button
            onClick={() => guardar.mutate()}
            disabled={marcadas === 0 || guardar.isPending}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {guardar.isPending ? 'Guardando…' : `Guardar ${marcadas} marcada(s)`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">
          Marca cada parada según cómo acabó. De aquí sale el <b>post-despacho</b>: lo que
          tiene que quedar en el camión es todo lo que no se entregó. Lo devuelto y lo
          cancelado <b>no tocan el inventario</b> —eso lo hace Ventra—: aquí queda la
          constancia y el control de lo que baja.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft/70">Todas:</span>
          {(Object.keys(ETIQUETAS) as Resultado[]).map((r) => (
            <button
              key={r}
              onClick={() => marcarTodas(r)}
              className="rounded-xl border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-ink/5"
            >
              {ETIQUETAS[r].texto}
            </button>
          ))}
          {sinMarcar > 0 && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
              {sinMarcar} sin marcar · cuentan como que siguen en el camión
            </span>
          )}
        </div>

        <div className="space-y-2">
          {paradas.map((p, i) => {
            const marca = marcas[p.id]

            return (
              <div key={p.id} className="rounded-xl border border-line p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-[11px] font-bold">
                    {p.stopOrder ?? i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{p.customerName}</p>
                    <p className="truncate text-[11px] text-ink-soft/70">{p.endAddress || p.address}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {(Object.keys(ETIQUETAS) as Resultado[]).map((r) => (
                      <button
                        key={r}
                        onClick={() => setMarcas((m) => (m[p.id] === r ? omitir(m, p.id) : { ...m, [p.id]: r }))}
                        aria-pressed={marca === r}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${
                          marca === r ? ETIQUETAS[r].clase : 'border border-line text-ink-soft hover:bg-ink/5'
                        }`}
                      >
                        <Icon icon={ETIQUETAS[r].icono} />
                        {ETIQUETAS[r].texto}
                      </button>
                    ))}
                  </div>
                </div>

                {/* El motivo, sólo cuando vuelve: un pedido devuelto sin motivo es un
                    número que nadie sabe explicar tres semanas después. */}
                {(marca === 'devuelto' || marca === 'cancelado') && (
                  <input
                    value={notas[p.id] ?? ''}
                    onChange={(e) => setNotas((n) => ({ ...n, [p.id]: e.target.value }))}
                    placeholder="¿Por qué volvió? (el cliente cerró, no lo quiso, no había nadie…)"
                    className="mt-2 w-full rounded-lg border border-line px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Lo que va a quedar arriba, según lo marcado AHORA: se ve antes de imprimir. */}
        <div className="rounded-xl bg-ink/[0.03] p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft/70">
            Queda en el camión
          </p>
          {hoja.lineas.filter((l) => l.queda > 0).length === 0 ? (
            <p className="text-sm text-ink-soft">Nada: se entregó todo lo que salió.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {hoja.lineas
                .filter((l) => l.queda > 0)
                .map((l) => (
                  <span key={l.producto} className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px]">
                    {l.producto} <b className="font-mono">×{l.queda}</b>
                  </span>
                ))}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {guardar.isSuccess && !error && (
          <p className="text-sm text-green-700">
            Cierre guardado. En PEDIDO cada pedido ya dice si se entregó o volvió.
          </p>
        )}
      </div>
    </Drawer>
  )
}

/** Quitar una clave sin mutar: pulsar dos veces el mismo botón desmarca la parada. */
function omitir(m: Record<string, Resultado>, id: string): Record<string, Resultado> {
  const { [id]: _, ...resto } = m

  return resto
}
