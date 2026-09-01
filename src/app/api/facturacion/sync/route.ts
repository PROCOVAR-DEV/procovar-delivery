import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { ventraDatabases, ventraVentas } from '@/lib/warehouse'
import { emparejarConVentra } from '@/lib/emparejarVentra'
import { cotejar, type LineaFactura, type LineaPedido } from '@/lib/cotejarFactura'
import { recotizar, pesarFactura } from '@/lib/recotizarDomicilio'
import { almacenesDeSucursal } from '@/lib/almacenes'
import { tasaDeSucursal } from '@/lib/tasaCambio'
import { avisarFacturacionAPedido, type AvisoFactura } from '@/lib/avisarPedido'

import { avisarCambio } from '@/lib/avisarCambio'

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
 *
 * # Y lo que se le devuelve a PEDIDO
 *
 * Dos cosas, por `/integration/orders/invoicing`:
 *
 *   1. EL ESTADO. En PEDIDO no había forma de saber si un pedido llegó a facturarse: el
 *      vendedor veía el suyo tal como lo tomó aunque en el almacén se hubiera facturado
 *      la mitad. Ventra no avisa a nadie —es un ERP detrás de una VPN—, así que el cotejo
 *      se hace UNA vez, aquí, y el resultado viaja allí.
 *
 *   2. EL COSTO DEL DOMICILIO, cuando la factura cambió lo que se lleva. Se cobra por
 *      peso: si el cliente pidió veinte cajas y se llevó quince, el precio de veinte se
 *      cobra de más. Se recalcula con la fórmula de Entrega —la misma, para que el mismo
 *      reparto no valga una cosa aquí y otra en el teléfono— y entra en PEDIDO por la
 *      misma puerta por la que entra el de Entrega.
 *
 * Sólo se avisa de lo que CAMBIÓ. Escribir en PEDIDO mueve su `updatedAt`, que es la
 * marca de agua con la que sincronizan las tablets de los vendedores.
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
  const resultado: Array<{ sucursal: string; lineas: number; cotejados: number; igual: number; cambiado: number; sinFactura: number; recotizados: number; error?: string }> = []
  /** Lo que hay que contarle a PEDIDO, de todas las sucursales, en una sola llamada. */
  const avisos: AvisoFactura[] = []
  /** id de delivery -> id en PEDIDO, para poder marcar lo avisado cuando conteste. */
  const dondeVive = new Map<string, string>()

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
        select: {
          id: true,
          customerName: true,
          items: true,
          orderDate: true,
          createdAt: true,
          externalId: true,
          source: true,
          weight: true,
          pesoFacturado: true,
          lat: true,
          lng: true,
          endLat: true,
          endLng: true,
          pedidoCosto: true,
          facturaEstado: true,
          facturaNumero: true,
          facturaAvisado: true,
        },
      })

      /**
       * Lo que hace falta para volver a poner precio, UNA vez por sucursal.
       *
       * El catálogo son ~127 productos y el almacén y la tasa son una fila cada uno.
       * Pedirlos por pedido serían tres consultas por cada uno de los mil de la ventana,
       * y dos de ellas salen por la VPN.
       */
      const catalogo = await prisma.product.findMany({
        where: { sucursalCodigo: s.externalId },
        select: { sku: true, name: true, weight: true },
      })
      const almacenes = await almacenesDeSucursal(s.externalId).catch(() => [])
      const almacen = almacenes.find((a) => a.principal && a.latitud != null && a.longitud != null)
        ?? almacenes.find((a) => a.latitud != null && a.longitud != null)
      const punto = almacen?.latitud != null && almacen?.longitud != null
        ? { latitud: almacen.latitud as number, longitud: almacen.longitud as number }
        : null
      const tasa = await tasaDeSucursal(s.externalId).catch(() => null)

      let igual = 0
      let cambiado = 0
      let sinFactura = 0
      let recotizados = 0

      for (const p of pedidos) {
        const cuando = p.orderDate ?? p.createdAt
        const dia = soloFecha(cuando)
        /**
         * El mismo día o el SIGUIENTE.
         *
         * Se pide un día y se factura al otro, sobre todo lo de última hora. Mirando sólo
         * el mismo día, esos pedidos salían como «sin facturar» y desaparecían del
         * armador —que por defecto ofrece los que cuadran— aunque su factura existía.
         *
         * No se abre más: con una ventana ancha, dos pedidos del mismo cliente en días
         * seguidos se cotejarían contra la factura del otro.
         */
        const siguiente = soloFecha(new Date(cuando.getTime() + 86400000))
        const suyas = ventas
          .filter((v) => {
            const f = soloFecha(new Date(v.fecha))

            return f === dia || f === siguiente
          })
          .map<LineaFactura>((v) => ({
            operNumber: v.operNumber,
            clienteNombre: v.clienteNombre,
            productoCodigo: v.productoCodigo,
            productoNombre: v.productoNombre,
            cantidad: v.cantidad,
          }))

        const r = cotejar((Array.isArray(p.items) ? p.items : []) as LineaPedido[], suyas, p.customerName)

        if (r.estado === 'igual') igual++
        else if (r.estado === 'cambiado') cambiado++
        else sinFactura++

        /**
         * Lo que PESA la factura.
         *
         * Es lo que sube de verdad al camión, así que es con lo que hay que cargar y con
         * lo que se cobra el domicilio. Se guarda también cuando la factura coincide con
         * el pedido: allí el peso sale de los productos de PEDIDO, y aquí de los de
         * Ventra, que son los que tienen kilos.
         */
        const peso = r.lineas.length ? pesarFactura(r.lineas, catalogo) : null
        const pesoFacturado = peso && peso.conPeso > 0 && peso.sinPeso === 0 ? peso.kg : null

        /**
         * Y el precio, sólo si la factura CAMBIÓ lo que se lleva.
         *
         * Cuando coincide no se toca nada: el costo que hay es el bueno, y puede que lo
         * haya puesto el repartidor a mano desde Entrega. Recalcularlo por gusto sería
         * pisarle su número con otro igual —o con uno peor, si la distancia en línea
         * recta no es la que él midió.
         */
        const nuevoCosto = r.estado === 'cambiado'
          ? recotizar(
              r.lineas,
              catalogo,
              punto,
              p.endLat != null && p.endLng != null
                ? { latitud: p.endLat, longitud: p.endLng }
                : p.lat != null && p.lng != null ? { latitud: p.lat, longitud: p.lng } : null,
              tasa?.tarifaBase,
              tasa?.cupPorUsd,
            )
          : null

        // Un céntimo de diferencia es ruido de redondeo, no un precio nuevo.
        const cambiaElCosto = nuevoCosto != null
          && (p.pedidoCosto == null || Math.abs(nuevoCosto.costo.usd - p.pedidoCosto) > 0.01)

        if (cambiaElCosto) recotizados++

        await prisma.order.update({
          where: { id: p.id },
          data: {
            facturaEstado: r.estado,
            facturaNumero: r.numero,
            facturaAt: new Date(),
            pesoFacturado,
          },
        })

        /**
         * Y se apunta lo que hay que contarle a PEDIDO.
         *
         * Sólo los pedidos que VIENEN de PEDIDO —los manuales viven sólo aquí— y sólo si
         * hay algo nuevo que decir. La firma es «estado|numero»: mientras no cambie, no
         * se repite el aviso.
         */
        const firma = `${r.estado}|${r.numero ?? ''}`
        const hayNoticia = firma !== p.facturaAvisado
          // No se avisa de un «sin factura» que nadie ha oído nunca: son casi todos los
          // pedidos del día hasta que el almacén factura, y sería mover PEDIDO entero
          // para no contarle nada.
          && (r.estado !== 'sin_factura' || Boolean(p.facturaAvisado))

        if (p.source === 'pedido' && p.externalId && (hayNoticia || cambiaElCosto)) {
          dondeVive.set(p.externalId, p.id)
          avisos.push({
            pedidoId: p.externalId,
            estado: r.estado,
            numero: r.numero,
            costo: cambiaElCosto ? nuevoCosto?.costo.usd ?? null : null,
            distanciaKm: cambiaElCosto ? nuevoCosto?.costo.distanciaKm ?? null : null,
            distanciaDesde: cambiaElCosto ? `almacen:${s.externalId}` : null,
          })
        }
      }

      resultado.push({
        sucursal: s.name,
        lineas: ventas.length,
        cotejados: pedidos.length,
        igual,
        cambiado,
        sinFactura,
        recotizados,
      })
    } catch (e) {
      resultado.push({ sucursal: s.name, lineas: 0, cotejados: 0, igual: 0, cambiado: 0, sinFactura: 0, recotizados: 0, error: (e as Error).message })
    }
  }

  /**
   * Y ahora se le cuenta a PEDIDO, de una vez y para todas las sucursales.
   *
   * Al final y no dentro del bucle: si el cotejo de la tercera sucursal se cae por un
   * corte de VPN, lo de las dos primeras ya está contado igual.
   *
   * Se marca como avisado SÓLO lo que PEDIDO dio por bueno. Un pedido que allí no existe
   * —lo borraron, o es de otra instalación— se queda sin marcar y se reintenta; que es lo
   * correcto: mientras no esté escrito allí, aquí no está avisado.
   */
  const aPedido = await avisarFacturacionAPedido(avisos)

  if (aPedido.aplicadosIds.length) {
    const porFirma = new Map(avisos.map((a) => [a.pedidoId, `${a.estado}|${a.numero ?? ''}`]))

    for (const externo of aPedido.aplicadosIds) {
      const id = dondeVive.get(externo)

      if (id) await prisma.order.update({ where: { id }, data: { facturaAvisado: porFirma.get(externo) ?? null } })
    }
  }

  // El cotejo cambia qué pedidos se pueden repartir: se avisa.
  if (resultado.some((r) => r.cotejados > 0)) await avisarCambio('facturacion')

  return NextResponse.json({
    desde: soloFecha(desde),
    hasta: soloFecha(hasta),
    sucursales: resultado,
    lineas: resultado.reduce((t, r) => t + r.lineas, 0),
    cotejados: resultado.reduce((t, r) => t + r.cotejados, 0),
    recotizados: resultado.reduce((t, r) => t + r.recotizados, 0),
    // Qué se le contó a PEDIDO. Con esto se ve de un vistazo si el aviso está llegando:
    // «enviados 40, aplicados 0» es un emparejamiento roto, no un día tranquilo.
    aPedido,
  })
}
