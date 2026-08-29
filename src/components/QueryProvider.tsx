'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProveedorDeAvisos } from '@/components/Avisos'
import { useState } from 'react'

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  /**
   * Que la pantalla se ponga al día SOLA.
   *
   * Los datos vienen de otros sitios —el espejo trae pedidos cada minuto, el repartidor
   * pone el costo desde Entrega— así que lo que se está mirando envejece mientras se
   * mira. Sin esto había que recargar para ver un cambio, y recargar es lo que nadie
   * hace: se queda uno mirando una pantalla que ya no es verdad.
   *
   *   staleTime 15 s   — dentro de ese rato no se vuelve a pedir: cambiar de pantalla y
   *                      volver es instantáneo, que es el otro reclamo.
   *   refetchInterval   — cada 30 s, y sólo si la pestaña está delante: no tiene sentido
   *                      castigar al servidor por una pestaña olvidada.
   *   onWindowFocus     — al volver de Entrega o de PEDIDO, lo primero es refrescar.
   */
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchInterval: 30_000,
            refetchIntervalInBackground: false,
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
      {/* Los avisos, por encima de todo: tienen que poder salir sobre un modal. */}
      <ProveedorDeAvisos>{children}</ProveedorDeAvisos>
    </QueryClientProvider>
  )
}
