import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { resolveScope, scopeWhere } from '@/lib/scope'
import { avisarCambio } from '@/lib/avisarCambio'
import { avisarEstadoAPedido, type EstadoEntrega } from '@/lib/avisarEstadoAPedido'

export const dynamic = 'force-dynamic'

/**
 * POST /api/routes/[id]/results — cerrar la ruta: qué se entregó y qué volvió.
 *
 * Body: { resultados: [{ orderId, resultado, nota? }] }
 *
 * # Para qué
 *
 * El camión vuelve y hay que cuadrar lo que baja. Hasta ahora eso se hacía de memoria:
 * la ruta se marcaba «completada» entera y no quedaba en ningún sitio qué cliente no
 * recibió lo suyo. Aquí se marca parada por parada, y de esto sale el POST-DESPACHO: lo
 * que tiene que quedar en el camión es lo que no se entregó.
 *
 * # Lo que NO hace
 *
 * No toca inventario. Un pedido devuelto o cancelado vuelve al almacén, pero el reintegro
 * lo hace Ventra: aquí queda la constancia y el control lo lleva el logístico. Poner el
 * estado esperando que el stock vuelva solo es contar con algo que no pasa.
 */

const RESULTADOS = new Set(['entregado', 'devuelto', 'cancelado'])

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveScope(req, user)
  const ruta = await prisma.route.findFirst({ where: { id, ...scopeWhere(scope) }, select: { id: true } })

  if (!ruta) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as {
    resultados?: Array<{ orderId?: string; resultado?: string; nota?: string | null }>
  }
  const entradas = Array.isArray(body.resultados) ? body.resultados : []

  if (entradas.length === 0) {
    return NextResponse.json({ error: 'No vino ningún resultado' }, { status: 400 })
  }

  /**
   * Sólo se tocan los pedidos que VIAJARON EN ESTA RUTA.
   *
   * Se comprueba contra la lista de la ruta y no sólo por el id que venga: un id de otra
   * ruta —o de otra sucursal— marcaría como entregado un pedido que nadie llevó.
   *
   * Va por `ultimaRutaId` y no por `routeId` porque uno ya marcado como devuelto soltó su
   * `routeId` para poder repartirse otra vez. Con `routeId` no se le podía corregir el
   * resultado: contestaba «ese pedido no va en esta ruta» al que acababa de bajar de ella.
   */
  const suyos = await prisma.order.findMany({
    where: { ultimaRutaId: id },
    select: { id: true, externalId: true, source: true, customerName: true },
  })
  const porId = new Map(suyos.map((o) => [o.id, o]))

  const aplicados: Array<{ orderId: string; resultado: string }> = []
  const rechazados: Array<{ orderId?: string; motivo: string }> = []
  const avisos: Array<{ pedidoId: string; estado: EstadoEntrega; nota?: string | null }> = []

  for (const e of entradas) {
    const orden = e.orderId ? porId.get(e.orderId) : undefined

    if (!orden) {
      rechazados.push({ orderId: e.orderId, motivo: 'ese pedido no va en esta ruta' })
      continue
    }
    if (!e.resultado || !RESULTADOS.has(e.resultado)) {
      rechazados.push({ orderId: e.orderId, motivo: `resultado '${e.resultado}' desconocido` })
      continue
    }

    const nota = e.nota?.trim() ? e.nota.trim().slice(0, 500) : null

    const entregado = e.resultado === 'entregado'

    await prisma.order.update({
      where: { id: orden.id },
      data: {
        resultado: e.resultado,
        resultadoAt: new Date(),
        resultadoNota: nota,
        // `deliveredAt` se queda con lo que siempre significó: cuándo se entregó. Un
        // pedido que vuelve lo pierde, porque no se entregó.
        deliveredAt: entregado ? new Date() : null,
        status: entregado ? 'delivered' : 'pending',
        /**
         * Y lo que VUELVE, baja del camión.
         *
         * Un devuelto o un cancelado siguen atados a la ruta y por eso no se podían
         * volver a repartir: `routeId` los daba por ocupados y no aparecían en el armador.
         * Se sueltan, así que vuelven a la lista como «sin entregar» y pueden ir en la
         * ruta de mañana.
         *
         * `ultimaRutaId` NO se toca: viajaron en este camión, y de ahí sale el
         * post-despacho y el histórico de la ruta. Soltar los dos campos a la vez era lo
         * que borraba al devuelto de la hoja de cierre.
         *
         * `stopOrder` se queda: es el orden en que se visitó, y en la hoja de cierre hace
         * falta para leerla en el mismo orden en que se hizo el recorrido.
         */
        ...(entregado ? {} : { routeId: null }),
      },
    })

    aplicados.push({ orderId: orden.id, resultado: e.resultado })
    if (orden.source === 'pedido' && orden.externalId) {
      avisos.push({ pedidoId: orden.externalId, estado: e.resultado as EstadoEntrega, nota })
    }
  }

  // Aquí sí se espera a PEDIDO: quien cierra la ruta necesita saber si el vendedor va a
  // ver que su pedido volvió, que es media razón para hacer esto.
  const aPedido = await avisarEstadoAPedido(avisos)

  await avisarCambio('rutas')

  return NextResponse.json({ aplicados, rechazados, aPedido })
}
