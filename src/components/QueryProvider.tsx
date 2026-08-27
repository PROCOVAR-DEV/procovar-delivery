'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProveedorDeAvisos } from '@/components/Avisos'
import { useState } from 'react'

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      {/* Los avisos, por encima de todo: tienen que poder salir sobre un modal. */}
      <ProveedorDeAvisos>{children}</ProveedorDeAvisos>
    </QueryClientProvider>
  )
}
