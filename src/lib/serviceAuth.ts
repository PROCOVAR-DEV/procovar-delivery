import { NextRequest } from 'next/server'

/**
 * Autenticación servidor-a-servidor para integraciones (ej. la app PEDIDO).
 * Valida el header `x-api-key` contra SERVICE_API_KEY. No usa JWT de usuario:
 * la cotización de domicilio es global (depende de Settings, no de un usuario).
 */
export function isValidServiceKey(req: NextRequest): boolean {
  const expected = process.env.SERVICE_API_KEY
  if (!expected) return false
  const provided = req.headers.get('x-api-key')
  return provided === expected
}
