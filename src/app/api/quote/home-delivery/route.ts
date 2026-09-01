import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { costoDomicilioEntrega, distanciaHaversineKm } from '@/lib/domicilioEntrega'
import { tasaDeSucursal } from '@/lib/tasaCambio'
import { almacenesDeSucursal } from '@/lib/almacenes'

export const dynamic = 'force-dynamic'

/**
 * POST /api/quote/home-delivery — cuánto cuesta llevar X kilos a un punto.
 *
 * # Quién llama
 *
 * PEDIDO, cuando la factura cambia lo que se lleva. El domicilio se cobra por peso: si el
 * cliente pidió veinte cajas y se llevó quince, el precio de veinte se cobra de más. A la
 * APK de Entrega no se le puede avisar —trabaja sin conexión—, así que PEDIDO rehace el
 * precio de su lado y el repartidor se lo encuentra ya corregido.
 *
 * # Por qué lo calcula delivery
 *
 * Porque es donde están las piezas: los ALMACENES desde los que se mide (se gestionan
 * aquí) y la TARIFA y la TASA de cada sucursal, que llegan de Entrega por Accesos. Y
 * porque la fórmula es la de Entrega, la misma:
 *
 *     tarifa base (CUP por km·kg) ÷ tasa × distancia (km) × peso (kg)
 *
 * Repetirla en PEDIDO serían dos fórmulas para el mismo cobro, que es de donde se viene.
 *
 * # Qué NO hace
 *
 * No escribe nada. El costo vive en PEDIDO: aquí se calcula y se contesta, y allí se
 * guarda. Delivery no es dueño de ese número.
 *
 * Body: { sucursalCodigo, lat, lng, pesoKg }
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get('x-api-key')

  if (!key || key !== process.env.SERVICE_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    sucursalCodigo?: string
    lat?: number
    lng?: number
    pesoKg?: number
  }

  const codigo = (body.sucursalCodigo || '').trim().toUpperCase()
  const lat = Number(body.lat)
  const lng = Number(body.lng)
  const peso = Number(body.pesoKg)

  if (!codigo) return NextResponse.json({ error: 'Falta sucursalCodigo' }, { status: 400 })
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'Falta la ubicación del cliente (lat/lng)' }, { status: 400 })
  }
  if (!Number.isFinite(peso) || peso <= 0) {
    // Cero no es un peso: es que no se sabe. Y un domicilio de cero kilos sale gratis.
    return NextResponse.json({ error: 'Falta el peso (pesoKg > 0)' }, { status: 400 })
  }

  const sucursal = await prisma.branch.findUnique({ where: { externalId: codigo }, select: { name: true } })

  if (!sucursal) return NextResponse.json({ error: `No hay sucursal con código ${codigo}` }, { status: 404 })

  /**
   * Desde el almacén PRINCIPAL, y si no lo hay, desde el primero con punto.
   *
   * Es desde donde sale la mercancía, que es lo que mide la APK. Sin almacén con
   * coordenadas no se contesta un número aproximado: se dice que no se puede.
   */
  const almacenes = await almacenesDeSucursal(codigo).catch(() => [])
  const almacen = almacenes.find((a) => a.principal && a.latitud != null && a.longitud != null)
    ?? almacenes.find((a) => a.latitud != null && a.longitud != null)

  if (!almacen) {
    return NextResponse.json(
      { error: `${sucursal.name} no tiene ningún almacén con coordenadas` },
      { status: 409 },
    )
  }

  const tasa = await tasaDeSucursal(codigo).catch(() => null)

  if (!tasa?.cupPorUsd) {
    return NextResponse.json({ error: `No hay tasa de cambio de ${codigo} en Accesos` }, { status: 409 })
  }
  if (!tasa?.tarifaBase) {
    return NextResponse.json({ error: `No hay tarifa base de ${codigo} en Entrega` }, { status: 409 })
  }

  const km = distanciaHaversineKm(almacen.latitud as number, almacen.longitud as number, lat, lng)
  const costo = costoDomicilioEntrega(tasa.tarifaBase, tasa.cupPorUsd, km, peso)

  if (!costo) return NextResponse.json({ error: 'No se pudo calcular con los datos que hay' }, { status: 409 })

  return NextResponse.json({
    ...costo,
    // De dónde salió, para que quien lo guarde pueda decir por qué vale eso.
    desde: `almacen:${codigo}`,
    almacen: almacen.nombre ?? null,
    sucursal: sucursal.name,
  })
}
