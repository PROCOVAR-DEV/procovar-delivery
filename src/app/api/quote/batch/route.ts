import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isValidServiceKey } from '@/lib/serviceAuth'
import {
  OrderQuoteInput,
  computeItemsWeights,
  buildOrderData,
  BranchOrigin,
} from '@/lib/homeDeliveryQuote'
import { haversineDistance } from '@/lib/pricing'
import { fetchWeightCatalog } from '@/lib/warehouse'
import type { WeightCatalog } from '@/lib/productMatch'

import { avisarCambio } from '@/lib/avisarCambio'

export const dynamic = 'force-dynamic'

/**
 * POST /api/quote/batch — el ESPEJO: trae de PEDIDO los pedidos y los deja aquí con su
 * peso y su distancia listos para armar rutas. Auth: header `x-api-key`.
 *
 * Body: { preview?: boolean, orders: OrderQuoteInput[] }
 *
 * El nombre `quote` se quedó de cuando esto cotizaba. **Ya no cotiza**: el precio del
 * domicilio lo pone la APK de Entrega y llega en `pedidoCosto`. Lo que sí calcula, porque
 * es suyo, es el PESO —lo que decide si la carga cabe en el camión— y la DISTANCIA al
 * almacén, que es lo que arma el recorrido.
 *
 * Regla clave: sin geolocalización del cliente no hay distancia, así que ese pedido se
 * SALTA (no es error) y se dice por qué. Igual si su sucursal no está mapeada o no tiene
 * punto de partida.
 */
export async function POST(req: NextRequest) {
  if (!isValidServiceKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || !Array.isArray(body.orders)) {
    return NextResponse.json({ error: 'Se espera { orders: [...] }' }, { status: 400 })
  }

  const preview: boolean = !!body.preview
  const orders: OrderQuoteInput[] = body.orders

  // La moneda en la que la pantalla muestra los importes. Ya no hay nada de precios que
  // configurar aquí: el domicilio lo cobra Entrega.
  let settings = await prisma.settings.findFirst()
  if (!settings) settings = await prisma.settings.create({ data: {} })

  /**
   * El catálogo del almacén, SÓLO si hace falta.
   *
   * PEDIDO manda el peso de cada línea ya cruzado contra Ventra (`pesoKg` /
   * `pesoLineaKg`). Cuando viene, este catálogo no se usa para nada, y pedirlo igual es
   * un viaje por la VPN al almacén en cada ciclo del espejo — que además es el que falla
   * y deja el lote entero sin pesos.
   *
   * Se mira el lote: si TODAS las líneas traen su peso, no se pide. Se queda de respaldo
   * para los pedidos viejos y para el día que PEDIDO no lo tenga.
   */
  const faltaAlgunPeso = orders.some((o) =>
    (o.items || []).some((it) => {
      const linea = Number(it.pesoLineaKg)
      const unidad = Number(it.pesoKg)
      return !(Number.isFinite(linea) && linea > 0) && !(Number.isFinite(unidad) && unidad > 0)
    }),
  )
  let catalog: WeightCatalog | undefined
  let weightsSource: 'pedido' | 'warehouse' | 'mixto' | 'none' = faltaAlgunPeso ? 'none' : 'pedido'
  if (faltaAlgunPeso && body.useWarehouseWeights !== false) {
    try {
      catalog = await fetchWeightCatalog()
      weightsSource = 'mixto'
    } catch {
      catalog = undefined
    }
  }

  // Cache del almacén-origen por externalId (evita N consultas repetidas). Guarda si
  // existe y si tiene el PUNTO DE PARTIDA configurado (cada sucursal el suyo).
  type BranchInfo = { origin: BranchOrigin; configured: boolean } | null
  const branchCache = new Map<string, BranchInfo>()
  async function getBranch(externalId?: string): Promise<BranchInfo> {
    if (!externalId) return null
    if (branchCache.has(externalId)) return branchCache.get(externalId) as BranchInfo
    const b = await prisma.branch.findUnique({ where: { externalId } })
    const info: BranchInfo = b
      ? {
          origin: { id: b.id, name: b.name, lat: b.lat, lng: b.lng, creatorId: b.creatorId },
          configured: b.originConfigured,
        }
      : null
    branchCache.set(externalId, info)
    return info
  }

  const results: Array<Record<string, unknown>> = []
  let quoted = 0
  let persisted = 0
  let skipped = 0

  for (const input of orders) {
    const ref = input.externalId || input.operationNumber || null

    // Sin geolocalización → no se puede calcular; se salta (no es error).
    if (input.lat == null || input.lng == null) {
      skipped++
      results.push({ ref, status: 'skipped', reason: 'sin-geolocalizacion' })
      continue
    }
    // La sucursal de origen debe existir en delivery Y tener su punto de partida.
    const info = await getBranch(input.sucursalExternalId)
    if (!info) {
      skipped++
      results.push({ ref, status: 'skipped', reason: 'sucursal-no-mapeada' })
      continue
    }
    if (!info.configured) {
      skipped++
      results.push({ ref, status: 'skipped', reason: 'sucursal-sin-punto-de-partida' })
      continue
    }
    const branch = info.origin

    /**
     * DELIVERY YA NO COTIZA. El precio del domicilio lo pone la APK de Entrega.
     *
     * Hasta aquí había dos fórmulas vivas —la de Entrega y la «oficial» del CKK— y el
     * mismo pedido costaba una cosa u otra según por dónde entrara. Se quitan las dos: el
     * precio que se cobra es el que el repartidor pone desde Entrega y que llega en
     * `pedidoCosto`. Delivery lo muestra, no lo calcula.
     *
     * `deliveryPrice` se queda en `null` a propósito, y nunca en `0`: un cero es un
     * precio, se suma y se lee como «este reparto salió gratis».
     */
    const sinDomicilio = input.requiereDomicilio === false

    /**
     * Un pedido SIN DOMICILIO y SIN FACTURA no entra en delivery. Ni se guarda.
     *
     * Aquí se traían todos «por si acaso», y con eso la lista de pedidos de delivery
     * enseñaba miles que no se pueden repartir: sin domicilio no hay nada que llevar, y
     * sin factura no puede subir a un camión. Ver el pedido es de PEDIDO; esto es la
     * pantalla del que carga el camión.
     *
     * Se piden las DOS condiciones a la vez a propósito. Uno sin domicilio pero facturado
     * sigue entrando —hace falta para el peso y para saber que existe— y uno con domicilio
     * que todavía no se ha facturado también, porque se facturará en un rato.
     */
    if (sinDomicilio && input.facturaEstado !== 'igual') {
      skipped++
      results.push({ ref, status: 'skipped', reason: 'sin-domicilio-y-sin-factura' })
      continue
    }

    /**
     * El peso y la distancia SÍ los calcula delivery: son suyos.
     *
     * El peso es lo que decide si la carga cabe en el camión, y la distancia es lo que
     * arma el recorrido. Nada de eso es un precio.
     */
    const { total: itemsTotal, items: weightedItems } = computeItemsWeights(input.items, catalog)
    const weightKg = itemsTotal > 0 ? itemsTotal : (Number(input.weight) || 0)
    const distanceKm = haversineDistance(branch.lat, branch.lng, input.lat as number, input.lng as number)
    const price = null

    const base = sinDomicilio
      ? {
          ref,
          status: 'skipped' as const,
          reason: 'sin-domicilio',
          distanceKm,
          weightKg,
          branch: { id: branch.id, name: branch.name },
        }
      : {
          ref,
          status: 'quoted' as const,
          // Siempre null: el precio es el de Entrega, y llega por `pedidoCosto`.
          price,
          distanceKm,
          weightKg,
          branch: { id: branch.id, name: branch.name },
        }

    if (preview) {
      results.push(base)
      continue
    }

    // Persistir (idempotente por source+externalId). Requiere nombre de cliente.
    if (!input.customerName) {
      results.push({ ...base, persisted: false, reason: 'falta-customerName' })
      continue
    }
    const computed = {
      weightKg,
      distanceKm,
      items: weightedItems,
      quote: {
        price, distanceKm, chargeableKm: 0, weightKg,
        breakdown: { base: 0, distance: 0, weight: 0, beforeMin: price, beforeRound: price },
      },
    }
    const data = buildOrderData(input, branch, computed)
    const existing = data.externalId
      ? await prisma.order.findFirst({ where: { source: 'pedido', externalId: data.externalId } })
      : null
    const order = existing
      ? await prisma.order.update({ where: { id: existing.id }, data })
      : await prisma.order.create({ data })
    persisted++
    results.push({ ...base, orderId: order.id, persisted: true })
  }

  // Han entrado o cambiado pedidos: las pantallas abiertas se enteran ya.
  if (persisted > 0) await avisarCambio('pedidos', { pedidos: persisted })

  return NextResponse.json({
    total: orders.length,
    quoted,
    persisted,
    skipped,
    weightsSource,
    currency: settings.currency,
    results,
  })
}
