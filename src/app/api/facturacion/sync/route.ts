import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { ventraDatabases, ventraVentas } from '@/lib/warehouse'
import { emparejarConVentra } from '@/lib/emparejarVentra'
import { cotejar, type LineaFactura, type LineaPedido } from '@/lib/cotejarFactura'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/facturacion/sync — trae la FACTURACIÓN de Ventra y coteja los pedidos.
 *
 * # Por qué
 *
 * El pedido y la factura no coinciden: el cliente cambia lo que pidió antes de que se le
 * facture. La ruta se arma con lo FACTURADO —es lo que va en el camión y lo que se cobra—
 * y repartir por el pedido viejo significa cargar de más y descuadrar la caja.
 *
 * # Qué hace
 *
 * Trae las ventas de cada sucursal de los últimos días, las guarda tal cual, y marca cada
 * pedido de esos días con cómo quedó: `igual`, `cambiado` o `sin_factura`. No toca el
 * pedido: sólo dice en qué estado está, y la pantalla decide qué enseñar.
 *
 * Ventana corta a propósito: la facturación del día se mueve todo el rato y la de hace un
 * mes ya no. Se repasa lo reciente, cada vez.
 */

/** Cuántos días atrás se repasa. La facturación vieja no se mueve. */
const DIAS = Number(process.env.FACTURACION_DIAS || 3)

const soloFecha = (d: Date) => d.toISOString().slice(0, 10)

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-api-key')
  const conLlave = Boolean(key && key === process.env.SERVICE_API_KEY)

  if (!conLlave && !getUserFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hasta = new Date()
  const desde = new Date(hasta.getTime() - DIAS * 86400000)

  let bases
  try {
    bases = await ventraDatabases()
  } catch (e) {
    // Sin VPN no hay facturación, y lo cotejado se queda como estaba: no se borra ni se
    // marca nada. Un pedido que pasa de «igual» a «sin cotejar» porque se cayó la red se
    // leería como que cambió la factura.
    return NextResponse.json(
      { error: `No se pudo preguntar a Ventra (¿VPN?): ${(e as Error).message}` },
      { status: 502 },
    )
  }

  const sucursales = await prisma.branch.findMany({ select: { id: true, name: true, externalId: true } })
  const emparejadas = emparejarConVentra(sucursales, bases)
  const resultado: Array<{ sucursal: string; lineas: number; cotejados: number; igual: number; cambiado: number; sinFactura: number; error?: string }> = []

  for (const s of emparejadas) {
    if (!s.database || !s.externalId) continue

    try {
      const ventas = await ventraVentas(s.database, soloFecha(desde), soloFecha(hasta))

      // Se guardan tal cual, por su id de Ventra: correrlo dos veces deja lo mismo.
      for (const v of ventas) {
        const datos = {
          ventraId: v.id,
          sucursalCodigo: s.externalId,
          fecha: new Date(v.fecha),
          operNumber: v.operNumber,
          clienteCodigo: v.clienteCodigo,
          clienteNombre: v.clienteNombre,
          productoCodigo: v.productoCodigo,
          productoNombre: v.productoNombre,
          cantidad: v.cantidad,
          precioUsd: v.precioUsd,
          traidoAt: new Date(),
        }

        await prisma.ventaFacturada.upsert({ where: { ventraId: v.id }, update: datos, create: datos })
      }

      /**
       * Y se cotejan los pedidos de esos días.
       *
       * Sólo los de ESA sucursal y ESE rango: cotejar el catálogo entero contra la
       * facturación de tres días marcaría como «sin factura» cincuenta mil pedidos
       * viejos que nadie va a repartir.
       */
      const pedidos = await prisma.order.findMany({
        where: {
          sucursalCodigo: s.externalId,
          OR: [
            { orderDate: { gte: desde } },
            { orderDate: null, createdAt: { gte: desde } },
          ],
        },
        select: { id: true, customerName: true, items: true, orderDate: true, createdAt: true },
      })

      let igual = 0
      let cambiado = 0
      let sinFactura = 0

      for (const p of pedidos) {
        const dia = soloFecha(p.orderDate ?? p.createdAt)
        // La factura del MISMO día: la de otro día es de otro pedido del mismo cliente.
        const suyas = ventas
          .filter((v) => soloFecha(new Date(v.fecha)) === dia)
          .map<LineaFactura>((v) => ({
            operNumber: v.operNumber,
            clienteNombre: v.clienteNombre,
            productoNombre: v.productoNombre,
            cantidad: v.cantidad,
          }))

        const r = cotejar((Array.isArray(p.items) ? p.items : []) as LineaPedido[], suyas, p.customerName)

        if (r.estado === 'igual') igual++
        else if (r.estado === 'cambiado') cambiado++
        else sinFactura++

        await prisma.order.update({
          where: { id: p.id },
          data: { facturaEstado: r.estado, facturaNumero: r.numero, facturaAt: new Date() },
        })
      }

      resultado.push({
        sucursal: s.name,
        lineas: ventas.length,
        cotejados: pedidos.length,
        igual,
        cambiado,
        sinFactura,
      })
    } catch (e) {
      resultado.push({ sucursal: s.name, lineas: 0, cotejados: 0, igual: 0, cambiado: 0, sinFactura: 0, error: (e as Error).message })
    }
  }

  return NextResponse.json({
    desde: soloFecha(desde),
    hasta: soloFecha(hasta),
    sucursales: resultado,
    lineas: resultado.reduce((t, r) => t + r.lineas, 0),
    cotejados: resultado.reduce((t, r) => t + r.cotejados, 0),
  })
}
