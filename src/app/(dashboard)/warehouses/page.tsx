'use client'

/**
 * Los ALMACENES de cada sucursal.
 *
 * Vivían en Accesos, junto a la sucursal. Se gestionan AQUÍ porque el domicilio se cobra
 * por la distancia desde el almacén: un punto mal puesto se cobra mal en cada entrega, y
 * quien lo nota es el que reparte, no quien administra cuentas. El dato sigue guardado en
 * Accesos —una sola copia— y esta pantalla lo lee y lo escribe firmado.
 *
 * # Uno cada vez
 *
 * Estaban todos en una columna, cada uno con su mapa. Con tres almacenes eso son tres
 * mapas cargando a la vez y una página que hay que recorrer entera para llegar al de
 * abajo. Ahora se elige cuál en un desplegable y se edita ése: es como se trabaja —se
 * viene a corregir UNO— y el mapa sale donde está el punto, no en cualquier parte.
 *
 * La sucursal se elige arriba, en la barra. Sólo se pregunta aquí cuando arriba está
 * puesto «todas», que es cuando de verdad hay algo que decidir.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { Icon } from '@iconify/react'
import Navbar from '@/components/Navbar'
import Selector from '@/components/Selector'
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

/** El que se está editando. `null` = ninguno todavía; `-1` = uno nuevo sin guardar. */
const NUEVO = -1

const vacio = (principal: boolean): Almacen => ({
  nombre: '',
  direccion: '',
  latitud: null,
  longitud: null,
  principal,
  activo: true,
})

export default function WarehousesPage() {
  const { token, sucursalId } = useAppStore()
  const queryClient = useQueryClient()
  const [codigo, setCodigo] = useState('')
  const [cual, setCual] = useState<number | null>(null)
  const [borrador, setBorrador] = useState<Almacen | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardado, setGuardado] = useState(false)

  const { data, isLoading, error: fallo } = useQuery<{ sucursales: Sucursal[] }>({
    // La sucursal de arriba entra en la clave: al cambiarla se vuelve a pedir sola.
    queryKey: ['almacenes', sucursalId],
    queryFn: async () => (await axios.get('/api/almacenes', { headers: { Authorization: `Bearer ${token}` } })).data,
    enabled: !!token,
  })

  const sucursales = useMemo(() => data?.sucursales ?? [], [data])
  const sucursal = sucursales.find((s) => s.codigo === codigo) ?? null
  const almacenes = sucursal?.almacenes ?? []

  // La primera que haya: con una sola no hay nada que elegir, y con varias se empieza por
  // alguna en vez de por una pantalla vacía.
  useEffect(() => {
    if (!sucursales.length) return
    if (!sucursales.some((s) => s.codigo === codigo)) setCodigo(sucursales[0].codigo)
  }, [sucursales, codigo])

  /**
   * Al cambiar de SUCURSAL se abre su primer almacén, o el formulario del primero si no
   * tiene ninguno: entrar y ver un hueco no dice qué hacer.
   *
   * Sólo por la sucursal. Estaba también atado a cuántos almacenes tiene, y eso rompía el
   * guardado: al crear uno, la lista pasa de 0 a 1, esto se disparaba y borraba el
   * «Guardado en Accesos» en el mismo instante en que aparecía — el trabajo se hacía y
   * nadie llegaba a verlo confirmado.
   */
  useEffect(() => {
    if (!sucursal) return
    if (sucursal.almacenes.length) {
      setCual(0)
      setBorrador({ ...sucursal.almacenes[0] })
    } else {
      setCual(NUEVO)
      setBorrador(vacio(true))
    }
    setAviso(null)
    setError(null)
    setGuardado(false)
  }, [sucursal?.codigo]) // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = useMutation({
    mutationFn: async (lista: Almacen[]) =>
      (await axios.put('/api/almacenes', { codigo, almacenes: lista }, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: (r: { aviso: string | null; almacenes?: Almacen[] }) => {
      setAviso(r?.aviso ?? null)
      setError(null)
      setGuardado(true)

      /**
       * El recién creado se queda abierto, ya con su id.
       *
       * Accesos devuelve la lista como quedó. Sin esto, el que se acaba de crear seguía
       * siendo «uno nuevo» para esta pantalla, y guardar otra vez lo habría creado por
       * segunda vez en vez de corregirlo.
       */
      const lista = r?.almacenes ?? []
      const mio = borrador ? lista.findIndex((a) => a.nombre === borrador.nombre.trim()) : -1

      if (mio >= 0) {
        setCual(mio)
        setBorrador({ ...lista[mio] })
      }
      queryClient.invalidateQueries({ queryKey: ['almacenes'] })
    },
    onError: (e: unknown) => {
      const ax = e as { response?: { data?: { error?: string } } }

      setError(ax.response?.data?.error ?? 'No se pudo guardar')
      setGuardado(false)
    },
  })

  /**
   * Se manda la lista COMPLETA de la sucursal, con el editado en su sitio.
   *
   * Accesos guarda la lista entera —así no hay que llevar la cuenta de qué se creó, qué
   * se cambió y qué se borró—, así que aquí se compone: los demás tal cual estaban y
   * éste con lo que se acaba de escribir.
   */
  const listaCon = (editado: Almacen | null, quitar = false) => {
    const otros = almacenes.filter((_, i) => i !== cual)

    if (quitar || !editado) return otros
    const lista = cual === NUEVO ? [...almacenes, editado] : almacenes.map((a, i) => (i === cual ? editado : a))

    // Uno principal y sólo uno: es desde el que se mide cuando nadie dice cuál.
    return editado.principal ? lista.map((a) => ({ ...a, principal: a === editado })) : lista
  }

  const abrir = (i: number) => {
    setCual(i)
    setBorrador(i === NUEVO ? vacio(almacenes.length === 0) : { ...almacenes[i] })
    setAviso(null)
    setError(null)
    setGuardado(false)
  }

  const cambiar = (campo: Partial<Almacen>) => {
    setBorrador((b) => (b ? { ...b, ...campo } : b))
    setGuardado(false)
  }

  const sinPunto = borrador != null && (borrador.latitud == null || borrador.longitud == null)
  const opcionesAlmacen = [
    ...almacenes.map((a, i) => ({
      valor: String(i),
      etiqueta: a.nombre || '(sin nombre)',
      nota: a.principal ? 'principal' : a.latitud == null ? 'sin punto' : undefined,
    })),
    { valor: String(NUEVO), etiqueta: '+ Añadir un almacén' },
  ]

  return (
    <div className="min-h-screen bg-canvas">
      <Navbar title="Almacenes" />

      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
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

        {sucursal && (
          <div className="bg-white border border-line rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Sólo cuando arriba está «todas»: con una elegida, ésta es la suya. */}
              {sucursales.length > 1 ? (
                <Selector
                  icono="mdi:store-outline"
                  titulo="Sucursal"
                  opciones={sucursales.map((s) => ({
                    valor: s.codigo,
                    etiqueta: s.nombre,
                    nota: s.almacenes.length ? `${s.almacenes.length}` : 'sin almacenes',
                  }))}
                  valor={codigo}
                  onCambio={setCodigo}
                />
              ) : (
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Icon icon="mdi:store-outline" className="text-ink-soft" />
                  {sucursal.nombre}
                </span>
              )}

              <Selector
                icono="mdi:warehouse"
                titulo="Almacén"
                opciones={opcionesAlmacen}
                valor={String(cual ?? '')}
                onCambio={(v) => abrir(Number(v))}
              />

              {almacenes.length === 0 && (
                <span className="text-xs text-amber-700">
                  Esta sucursal no tiene ninguno: sus domicilios no se pueden cotizar.
                </span>
              )}
            </div>

            {borrador && (
              <div className="space-y-3 border-t border-line pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={borrador.nombre}
                    onChange={(e) => cambiar({ nombre: e.target.value })}
                    placeholder="Nombre del almacén"
                    className="flex-1 min-w-[12rem] px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <button
                    type="button"
                    onClick={() => cambiar({ principal: !borrador.principal })}
                    title="Desde éste se mide cuando nadie dice cuál"
                    className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                      borrador.principal
                        ? 'bg-primary/10 border-primary/40 text-primary'
                        : 'border-line text-ink-soft hover:border-primary/40'
                    }`}
                  >
                    <Icon icon={borrador.principal ? 'mdi:star' : 'mdi:star-outline'} className="inline mr-1" />
                    Principal
                  </button>
                  <button
                    type="button"
                    onClick={() => cambiar({ activo: !borrador.activo })}
                    className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                      borrador.activo ? 'border-line text-ink-soft' : 'bg-amber-50 border-amber-200 text-amber-700'
                    }`}
                  >
                    {borrador.activo ? 'Activo' : 'Inactivo'}
                  </button>
                  {cual !== NUEVO && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(`¿Quitar «${borrador.nombre}»? Deja de poder medirse desde ahí.`)) return
                        guardar.mutate(listaCon(null, true))
                      }}
                      title="Quitar este almacén"
                      className="p-2 rounded-xl border border-line text-red-600 hover:bg-red-50"
                    >
                      <Icon icon="mdi:trash-can-outline" />
                    </button>
                  )}
                </div>

                {/* El mapa abre donde está el punto: se viene a corregirlo, no a buscarlo. */}
                <LocationInput
                  label="Dónde está"
                  value={{ address: borrador.direccion ?? '', lat: borrador.latitud, lng: borrador.longitud }}
                  onChange={(v) => cambiar({ direccion: v.address, latitud: v.lat, longitud: v.lng })}
                />

                {sinPunto && (
                  <p className="text-xs text-amber-700">
                    Sin coordenadas: desde éste no se puede medir el domicilio.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={!borrador.nombre.trim() || guardar.isPending}
                    onClick={() => guardar.mutate(listaCon(borrador))}
                    className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-50"
                  >
                    {guardar.isPending ? 'Guardando…' : 'Guardar'}
                  </button>

                  {!borrador.nombre.trim() && <span className="text-xs text-red-600">Le falta el nombre.</span>}
                  {aviso && <span className="text-xs text-amber-700">{aviso}</span>}
                  {error && <span className="text-xs text-red-600">{error}</span>}
                  {guardado && !error && <span className="text-xs text-green-700">Guardado en Accesos.</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
