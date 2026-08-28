import { prisma } from '@/lib/prisma'
import { pedirFirmado } from '@/lib/procovar-auth'

/**
 * La tasa de cambio USD -> CUP: se PIDE a Accesos, no se teclea aquí.
 *
 * Antes vivía en la pantalla de Configuración, en el bloque de «Monedas»: alguien escribía
 * un número a mano y ése era el que usaba toda la aplicación. PEDIDO, mientras, la traía
 * de Entrega. Dos tasas para lo mismo se separan en cuanto una de las dos se olvida —y se
 * olvida, porque la de aquí no la refresca nadie—, y entonces el mismo domicilio vale
 * distinto según dónde se mire. Eso no falla en pantalla: sale un importe creíble y cuadra
 * mal en la caja, que es donde se descubre tarde.
 *
 * Ahora la fuente es Accesos, que la mantiene por sucursal sacándola de Entrega. Aquí no
 * se guarda ninguna copia editable: si Accesos no contesta, no hay tasa, y se dice.
 */

export interface Tasa {
  codigo: string
  cupPorUsd: number
  fuente: string | null
  traidoAt: string
  /** false cuando lleva demasiado sin actualizarse en Accesos. */
  fresca: boolean
}

/**
 * Un recuerdo corto, en memoria.
 *
 * El costo del domicilio se calcula por LOTES de doscientos pedidos, y cada uno necesita
 * la tasa de su sucursal: sin esto son doscientas llamadas a Accesos para cotizar una
 * tanda. Dura poco a propósito —la tasa se mueve a diario, no por minuto— y se pierde al
 * reiniciar, que es lo correcto para algo que no es nuestro.
 */
const RECUERDO_MS = Number(process.env.TASA_CACHE_MS || 5 * 60 * 1000)

/**
 * El «no hay tasa» se recuerda MUCHO menos.
 *
 * Una tasa que existe no cambia en cinco minutos, así que guardarla ese rato está bien.
 * Pero «esta sucursal todavía no tiene» es un estado que alguien está arreglando ahora
 * mismo: se pone en Entrega, Accesos la trae... y aquí seguía diciendo que no hay durante
 * cinco minutos más. Pasó de verdad — la tasa estaba puesta y la pantalla seguía en USD.
 */
const RECUERDO_SIN_TASA_MS = Number(process.env.TASA_CACHE_VACIA_MS || 20 * 1000)
const recordadas = new Map<string, { tasa: Tasa | null; cuando: number }>()

async function preguntarAAccesos(codigo: string): Promise<Tasa | null> {
  /**
   * Firmado, como el resto de lo que delivery le pide a Accesos.
   *
   * Accesos no acepta una clave suelta en una cabecera: cada aplicación firma con SU
   * llave lo que pide —método, ruta, hora, nonce y el hash del cuerpo—, así que una
   * petición copiada de un registro no vale al minuto siguiente. delivery ya tiene esa
   * llave para el login único; se reutiliza en vez de abrirle una segunda puerta.
   */
  const b = await pedirFirmado<{ tasa?: null; cupPorUsd?: number } & Partial<Tasa>>(
    `/api/service/tasas?codigo=${encodeURIComponent(codigo)}`,
  )

  // Accesos contesta 200 con `tasa: null` cuando esa sucursal no tiene: que falte es un
  // estado normal, no un error, y por eso no viene como 404.
  if (b?.tasa === null || typeof b?.cupPorUsd !== 'number') return null

  return {
    codigo: b.codigo ?? codigo.toUpperCase(),
    cupPorUsd: b.cupPorUsd,
    fuente: b.fuente ?? null,
    traidoAt: String(b.traidoAt ?? ''),
    fresca: b.fresca !== false,
  }
}

/**
 * La tasa de UNA sucursal, por su código. `null` si no la tiene.
 *
 * NUNCA la de otra sucursal. Es el error que más daño hace aquí: convertir un importe de
 * Granma con la tasa de La Habana da un número creíble que nadie cuestiona, y aparece en
 * la caja. Sin tasa, el pedido se queda sin precio en CUP y se dice de qué sucursal falta.
 */
export async function tasaDeSucursal(codigo: string | null | undefined): Promise<Tasa | null> {
  if (!codigo) return null

  const clave = codigo.trim().toUpperCase()
  const guardada = recordadas.get(clave)

  const dura = guardada?.tasa ? RECUERDO_MS : RECUERDO_SIN_TASA_MS

  if (guardada && Date.now() - guardada.cuando < dura) return guardada.tasa

  try {
    const tasa = await preguntarAAccesos(clave)

    recordadas.set(clave, { tasa, cuando: Date.now() })
    return tasa
  } catch {
    /**
     * Si Accesos no contesta se devuelve lo último que se supo, aunque esté pasado.
     *
     * Es mejor que nada: una tasa de ayer convierte con un error pequeño, y sin ninguna
     * no se puede cotizar ni un pedido. Lo que no se hace es guardarlo como si fuera
     * fresco — se devuelve tal cual, con su fecha, y quien lo enseñe puede avisar.
     */
    return guardada?.tasa ?? null
  }
}

/**
 * La tasa de la sucursal de un ALMACÉN de delivery, por su id.
 *
 * Delivery trabaja con `Branch.id`; las tasas van por CÓDIGO de sucursal, que es la clave
 * que cruza todas las aplicaciones. La traducción se hace aquí para que quien cotiza no
 * tenga que llevarse el mapa.
 */
export async function tasaDeAlmacen(branchId: string | null | undefined): Promise<Tasa | null> {
  if (!branchId) return null

  const b = await prisma.branch.findUnique({ where: { id: branchId }, select: { externalId: true } })

  return tasaDeSucursal(b?.externalId)
}
