/**
 * Los almacenes de una sucursal, tal como están en Accesos.
 *
 * Se gestionan en esta aplicación (pantalla Almacenes) pero viven allí: el almacén es de
 * la sucursal. Aquí sólo se leen, firmado, y se recuerdan un rato — hacen falta para
 * medir cada domicilio y no cambian de un minuto a otro.
 */

import { pedirFirmado } from '@/lib/procovar-auth'

export interface Almacen {
  id: string
  nombre: string
  direccion: string | null
  latitud: number | null
  longitud: number | null
  principal: boolean
  activo: boolean
}

interface Respuesta {
  sucursales: Array<{ codigo: string; nombre: string; almacenes: Almacen[] }>
}

const RECUERDO_MS = Number(process.env.ALMACENES_CACHE_MS || 5 * 60 * 1000)
let recuerdo: { cuando: number; porCodigo: Map<string, Almacen[]> } | null = null

export async function almacenesDeSucursal(codigo: string): Promise<Almacen[]> {
  const clave = codigo.trim().toUpperCase()

  if (recuerdo && Date.now() - recuerdo.cuando < RECUERDO_MS) {
    return recuerdo.porCodigo.get(clave) ?? []
  }

  const r = await pedirFirmado<Respuesta>('/api/service/almacenes')
  const porCodigo = new Map<string, Almacen[]>()

  for (const s of r.sucursales ?? []) porCodigo.set(s.codigo?.toUpperCase(), s.almacenes ?? [])
  recuerdo = { cuando: Date.now(), porCodigo }

  return porCodigo.get(clave) ?? []
}
