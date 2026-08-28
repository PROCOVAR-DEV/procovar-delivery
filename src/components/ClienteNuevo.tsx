'use client'

/**
 * Dar de alta un cliente LOCAL de delivery.
 *
 * Los de PEDIDO llegan solos por el espejo; éste es para el que no está allí: alguien que
 * llama, un punto nuevo que se atiende hoy. Vive aparte de la pantalla de Clientes porque
 * se usa en dos sitios —allí y dentro del pedido a mano—, y tener dos formularios que
 * escriben el mismo cliente es tener dos formas distintas de que falte algo.
 *
 * La ubicación es OBLIGATORIA: sin coordenadas el cliente no se puede repartir ni cotizar,
 * y darlo de alta sin ellas es crear algo que no sirve para lo único que hace falta.
 */

import { useState } from 'react'
import axios from 'axios'
import { useQueryClient } from '@tanstack/react-query'
import LocationInput, { type LocationValue } from '@/components/LocationInput'
import { useAppStore } from '@/store/useAppStore'

const vacia: LocationValue = { address: '', lat: null, lng: null }

export interface ClienteCreado {
  id: string
  name: string
  address?: string | null
  municipio?: string | null
  lat: number
  lng: number
}

export default function ClienteNuevo({
  nombreInicial = '',
  alGuardar,
  alCancelar,
}: {
  /** Lo que ya se había escrito en el buscador: no se teclea dos veces. */
  nombreInicial?: string
  alGuardar: (c: ClienteCreado) => void
  alCancelar?: () => void
}) {
  const { token } = useAppStore()
  const queryClient = useQueryClient()
  const [name, setName] = useState(nombreInicial)
  const [phone, setPhone] = useState('')
  const [municipio, setMunicipio] = useState('')
  const [loc, setLoc] = useState<LocationValue>(vacia)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const puede = name.trim() !== '' && loc.lat != null && loc.lng != null

  const guardar = async () => {
    if (!puede || guardando) return
    setGuardando(true)
    setError('')
    try {
      const r = await axios.post(
        '/api/customers',
        { name: name.trim(), phone, municipio, address: loc.address, lat: loc.lat, lng: loc.lng },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      alGuardar((r.data?.customer ?? r.data) as ClienteCreado)
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre *"
          className="px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Teléfono"
          className="px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <input
          value={municipio}
          onChange={(e) => setMunicipio(e.target.value)}
          placeholder="Municipio"
          className="px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <LocationInput value={loc} onChange={setLoc} label="Dirección y ubicación *" />

      {!puede && (
        <p className="text-xs text-ink-soft/70">
          Hace falta el nombre y el punto en el mapa: sin ubicación no se puede repartir ni
          medir el domicilio.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        {alCancelar && (
          <button onClick={alCancelar} className="px-4 py-2 rounded-xl border border-line text-sm text-ink-soft hover:bg-ink/5">
            Cancelar
          </button>
        )}
        <button
          disabled={!puede || guardando}
          onClick={guardar}
          className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {guardando ? 'Guardando…' : 'Guardar cliente'}
        </button>
      </div>
    </div>
  )
}
