'use client'

import { useEffect, useState } from 'react'

import { recargarLimpio, vigilarVersion } from '@/lib/version-nueva'

/** Cuanto se calla el aviso cuando alguien pulsa «Ahora no». */
const POSPUESTO = 30 * 60_000

/**
 * «Hay una version nueva — recarga».
 *
 * Va en el layout raiz para que salga en TODAS las pantallas. Y no se puede quitar del
 * todo: «Ahora no» lo calla media hora y vuelve. Una ✕ definitiva lo convertiria en algo
 * que se cierra sin leer el primer dia y ya nunca avisa.
 */
export default function AvisoVersionNueva() {
  const [hayNueva, setHayNueva] = useState(false)

  useEffect(() => vigilarVersion(() => setHayNueva(true)), [])

  if (!hayNueva) return null

  return (
    <div
      aria-live="polite"
      role="status"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-lg sm:inset-x-auto sm:bottom-4 sm:right-4"
    >
      <p className="text-sm font-semibold text-amber-900">Hay una versión nueva</p>
      <p className="mt-1 text-xs text-amber-800">
        Esta pestaña está usando una versión anterior. Recarga para tener los últimos
        cambios; lo que ya está guardado no se pierde.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          onClick={recargarLimpio}
        >
          Recargar ahora
        </button>
        <button
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
          onClick={() => {
            setHayNueva(false)
            // Vuelve sola: el aviso no se puede quitar del todo, solo aplazar.
            setTimeout(() => setHayNueva(true), POSPUESTO)
          }}
        >
          Ahora no
        </button>
      </div>
    </div>
  )
}
