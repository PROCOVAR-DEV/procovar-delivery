'use client'

/**
 * Los ALMACENES de cada sucursal.
 *
 * Vivían en Accesos, junto a la sucursal. Se gestionan AQUÍ porque el domicilio se cobra
 * por la distancia desde el almacén: un punto mal puesto se cobra mal en cada entrega, y
 * quien lo nota es el que reparte, no quien administra cuentas. El dato sigue guardado en
 * Accesos —una sola copia— y esta pantalla lo lee y lo escribe firmado.
 *
 * La sucursal NO se elige aquí: se elige arriba, en la barra, como en el resto de la
 * aplicación. Quien tiene una sola ve la suya y ya.
 */

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { Icon } from '@iconify/react'
import Navbar from '@/components/Navbar'
import LocationInput from '@/components/LocationInput'
import { useAppStore } from '@/store/useAppStore'

interface Almacen {
  id?: string
  nombre: string
  direccion: string | null
  latitud: number | null
  longitud: number | null
  principal: boolean
  activo: boolean
}

interface Sucursal {
  codigo: string
  nombre: string
  almacenes: Almacen[]
}

const vacio = (): Almacen => ({
  nombre: '',
  direccion: '',
  latitud: null,
  longitud: null,
  principal: false,
  activo: true,
})

export default function WarehousesPage() {
  const { token, sucursalId } = useAppStore()
  const queryClient = useQueryClient()
  const [editando, setEditando] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<Almacen[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading, error: fallo } = useQuery<{ sucursales: Sucursal[] }>({
    // La sucursal de arriba entra en la clave: al cambiarla se vuelve a pedir sola.
    queryKey: ['almacenes', sucursalId],
    queryFn: async () => (await axios.get('/api/almacenes', { headers: { Authorization: `Bearer ${token}` } })).data,
    enabled: !!token,
  })

  const sucursales = data?.sucursales ?? []

  // Si sólo hay una sucursal a la vista, se abre sola: no hay nada que elegir.
  useEffect(() => {
    if (!editando && sucursales.length === 1) {
      setEditando(sucursales[0].codigo)
      setBorrador(sucursales[0].almacenes.map((a) => ({ ...a })))
    }
  }, [sucursales, editando])

  const guardar = useMutation({
    mutationFn: async ({ codigo, almacenes }: { codigo: string; almacenes: Almacen[] }) =>
      (await axios.put('/api/almacenes', { codigo, almacenes }, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: (r: { aviso: string | null }) => {
      setAviso(r?.aviso ?? null)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['almacenes'] })
    },
    onError: (e: unknown) => {
      const ax = e as { response?: { data?: { error?: string } } }
      setError(ax.response?.data?.error ?? 'No se pudo guardar')
    },
  })

  const abrir = (s: Sucursal) => {
    setEditando(s.codigo)
    setBorrador(s.almacenes.map((a) => ({ ...a })))
    setAviso(null)
    setError(null)
  }

  const cambiar = (i: number, campo: Partial<Almacen>) =>
    setBorrador((b) => b.map((a, j) => (j === i ? { ...a, ...campo } : a)))

  // Uno principal y sólo uno: es desde el que se mide cuando nadie dice cuál.
  const marcarPrincipal = (i: number) =>
    setBorrador((b) => b.map((a, j) => ({ ...a, principal: i === j })))

  const quitar = (i: number) => setBorrador((b) => b.filter((_, j) => j !== i))

  const sinPunto = borrador.filter((a) => a.latitud == null || a.longitud == null).length
  const sinNombre = borrador.some((a) => !a.nombre.trim())

  return (
    <div className="min-h-screen bg-canvas">
      <Navbar title="Almacenes" />

      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <p className="text-sm text-ink-soft">
          El punto desde el que se mide cada domicilio. Un almacén sin coordenadas no sirve
          para cotizar: la distancia se mide desde aquí.
        </p>

        {isLoading && <p className="text-sm text-ink-soft">Cargando…</p>}

        {fallo && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            No se pudieron traer los almacenes de Accesos. Lo de abajo está vacío por eso, no
            porque no haya ninguno.
          </div>
        )}

        {!isLoading && !fallo && sucursales.length === 0 && (
          <div className="rounded-xl border border-line bg-white px-4 py-6 text-sm text-ink-soft">
            No hay ninguna sucursal a la vista con código en Accesos.
          </div>
        )}

        {sucursales.map((s) => {
          const abierto = editando === s.codigo
          const conPunto = s.almacenes.filter((a) => a.latitud != null && a.longitud != null).length

          return (
            <div key={s.codigo} className="bg-white border border-line rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => (abierto ? setEditando(null) : abrir(s))}
                className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-ink/[0.02] transition-colors"
              >
                <Icon icon="mdi:warehouse" className="text-xl text-primary shrink-0" />
                <span className="font-semibold text-ink">{s.nombre}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-ink/5 text-ink-soft">{s.codigo}</span>
                <span className="text-xs text-ink-soft ml-auto">
                  {s.almacenes.length === 0
                    ? 'sin almacenes'
                    : `${s.almacenes.length} almacén(es)${conPunto < s.almacenes.length ? ` · ${s.almacenes.length - conPunto} sin punto` : ''}`}
                </span>
                <Icon icon="mdi:chevron-down" className={`text-ink-soft transition-transform ${abierto ? 'rotate-180' : ''}`} />
              </button>

              {abierto && (
                <div className="border-t border-line p-5 space-y-4">
                  {borrador.length === 0 && (
                    <p className="text-sm text-ink-soft">
                      Esta sucursal no tiene ninguno. Sin almacén no se puede cotizar un domicilio suyo.
                    </p>
                  )}

                  {borrador.map((a, i) => (
                    <div key={a.id ?? `nuevo-${i}`} className="rounded-xl border border-line p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <input
                          value={a.nombre}
                          onChange={(e) => cambiar(i, { nombre: e.target.value })}
                          placeholder="Nombre del almacén"
                          className="flex-1 px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <button
                          type="button"
                          onClick={() => marcarPrincipal(i)}
                          title="Desde éste se mide cuando nadie dice cuál"
                          className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                            a.principal
                              ? 'bg-primary/10 border-primary/40 text-primary'
                              : 'border-line text-ink-soft hover:border-primary/40'
                          }`}
                        >
                          <Icon icon={a.principal ? 'mdi:star' : 'mdi:star-outline'} className="inline mr-1" />
                          Principal
                        </button>
                        <button
                          type="button"
                          onClick={() => cambiar(i, { activo: !a.activo })}
                          className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                            a.activo ? 'border-line text-ink-soft' : 'bg-amber-50 border-amber-200 text-amber-700'
                          }`}
                        >
                          {a.activo ? 'Activo' : 'Inactivo'}
                        </button>
                        <button
                          type="button"
                          onClick={() => quitar(i)}
                          title="Quitar"
                          className="p-2 rounded-xl border border-line text-red-600 hover:bg-red-50"
                        >
                          <Icon icon="mdi:trash-can-outline" />
                        </button>
                      </div>

                      <LocationInput
                        label="Dónde está"
                        value={{ address: a.direccion ?? '', lat: a.latitud, lng: a.longitud }}
                        onChange={(v) => cambiar(i, { direccion: v.address, latitud: v.lat, longitud: v.lng })}
                      />

                      {(a.latitud == null || a.longitud == null) && (
                        <p className="text-xs text-amber-700">
                          Sin coordenadas: desde éste no se puede medir el domicilio.
                        </p>
                      )}
                    </div>
                  ))}

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => setBorrador((b) => [...b, { ...vacio(), principal: b.length === 0 }])}
                      className="px-4 py-2 rounded-xl border border-line text-sm text-ink hover:border-primary/40"
                    >
                      <Icon icon="mdi:plus" className="inline mr-1" />
                      Añadir un almacén
                    </button>

                    <button
                      type="button"
                      disabled={sinNombre || guardar.isPending}
                      onClick={() => guardar.mutate({ codigo: s.codigo, almacenes: borrador })}
                      className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-50"
                    >
                      {guardar.isPending ? 'Guardando…' : 'Guardar'}
                    </button>

                    {sinNombre && <span className="text-xs text-red-600">Hay un almacén sin nombre.</span>}
                    {!sinNombre && sinPunto > 0 && (
                      <span className="text-xs text-amber-700">{sinPunto} sin coordenadas.</span>
                    )}
                  </div>

                  {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
                  {error && <p className="text-xs text-red-600">{error}</p>}
                  {guardar.isSuccess && !error && <p className="text-xs text-green-700">Guardado en Accesos.</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
