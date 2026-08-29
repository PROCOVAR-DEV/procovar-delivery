'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProveedorDeAvisos } from '@/components/Avisos'
import { useState } from 'react'
import AvisosEnVivo from '@/components/AvisosEnVivo'

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  /**
   * Que la pantalla se ponga al día SOLA.
   *
   * Los datos vienen de otros sitios —el espejo trae pedidos cada minuto, el repartidor
   * pone el costo desde Entrega— así que lo que se está mirando envejece mientras se
   * mira. Sin esto había que recargar para ver un cambio, y recargar es lo que nadie
   * hace: se queda uno mirando una pantalla que ya no es verdad.
   *
   * Y se refresca CUANDO ALGO CAMBIA, no cada X segundos.
   *
   * Había un sondeo cada treinta segundos además de los avisos en vivo, y con el espejo
   * avisando por cada lote la pantalla se recargaba sola sin parar: los desplegables se
   * cerraban solos y no se podía ni escribir en un filtro. Ahora:
   *
   *   staleTime 30 s   — cambiar de pantalla y volver es instantáneo.
   *   sin sondeo       — lo que cambia lo avisa Redis por SSE (ver `AvisosEnVivo`), y con
   *                      freno: como mucho una recarga cada quince segundos.
   *   onWindowFocus    — al volver de Entrega o de PEDIDO, lo primero es refrescar.
   */
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            // Un fallo de red no puede dejar la pantalla en blanco: se reintenta y se
            // sigue enseñando lo último bueno mientras tanto.
            retry: 2,
            placeholderData: (anterior: unknown) => anterior,
          },
        },
      }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      {/* Lo que cambia fuera de esta pantalla, en vivo. Ver `AvisosEnVivo`. */}
      <AvisosEnVivo />
      {/* Los avisos, por encima de todo: tienen que poder salir sobre un modal. */}
      <ProveedorDeAvisos>{children}</ProveedorDeAvisos>
    </QueryClientProvider>
  )
}
