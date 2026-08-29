'use client'

/**
 * Escucha lo que cambia y pone la pantalla al día, sin recargar.
 *
 * Va montado una vez, en el armazón: cualquier pantalla se beneficia sin tener que
 * enterarse de que esto existe. Cuando llega un aviso se invalidan las consultas que ese
 * cambio afecta —no todas—: invalidarlo todo es volver a pedir el catálogo entero cada
 * vez que alguien cotiza un domicilio.
 *
 * Si no hay avisos en vivo (sin Redis, o la conexión se cae) no pasa nada malo: las
 * consultas siguen refrescándose solas cada treinta segundos, que es como estaban.
 */

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store/useAppStore'

/** Qué se vuelve a pedir según lo que cambió. */
const AFECTA: Record<string, string[]> = {
  pedidos: ['orders', 'orders-resumen', 'orders-available', 'orders-available-opciones', 'orders-facetas', 'dashboard'],
  facturacion: ['orders', 'orders-available', 'orders-available-opciones'],
  catalogo: ['products'],
  rutas: ['routes', 'orders', 'orders-available', 'vehicles'],
  clientes: ['customers'],
}

/**
 * Cada cuánto, como mucho, se hace caso a los avisos.
 *
 * El espejo importa por lotes y avisa por cada uno: sin freno, la pantalla se recargaba
 * varias veces seguidas, los desplegables se cerraban solos y no se podía ni escribir en
 * un filtro. Se juntan los avisos que llegan seguidos y se atiende uno.
 */
const FRENO_MS = 15000

export default function AvisosEnVivo() {
  const queryClient = useQueryClient()
  const token = useAppStore((e) => e.token)

  useEffect(() => {
    if (!token || typeof window === 'undefined') return

    const fuente = new EventSource('/api/eventos')
    const pendientes = new Set<string>()
    let temporizador: ReturnType<typeof setTimeout> | null = null

    const atender = () => {
      temporizador = null
      const claves = new Set<string>()

      for (const tipo of pendientes) for (const c of AFECTA[tipo] ?? []) claves.add(c)
      pendientes.clear()

      if (claves.size === 0) {
        // Un aviso que no se sabe de qué es: se refresca lo que se está mirando y ya.
        void queryClient.invalidateQueries({ type: 'active' })
        return
      }
      for (const clave of claves) void queryClient.invalidateQueries({ queryKey: [clave] })
    }

    fuente.addEventListener('cambio', (e) => {
      let tipo = ''

      try {
        tipo = (JSON.parse((e as MessageEvent).data) as { tipo?: string }).tipo ?? ''
      } catch { /* un aviso ilegible no puede tumbar la pantalla */ }

      pendientes.add(tipo)
      // Se juntan los que llegan seguidos: el espejo avisa por cada lote que importa.
      if (!temporizador) temporizador = setTimeout(atender, FRENO_MS)
    })

    /**
     * Si se cae, el navegador reintenta solo.
     *
     * `EventSource` reconecta por su cuenta; lo único que hace falta es no cerrarla aquí.
     * Y si el servidor dice que no hay avisos en vivo, se deja de escuchar: mantener
     * abierta una conexión que no trae nada sólo gasta.
     */
    fuente.addEventListener('sin-vivo', () => fuente.close())

    return () => {
      if (temporizador) clearTimeout(temporizador)
      fuente.close()
    }
  }, [token, queryClient])

  return null
}
