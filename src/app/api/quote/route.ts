import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * El cotizador de UN pedido se retira.
 *
 * Esto lo llamaba PEDIDO para que delivery le dijera cuánto costaba un domicilio. Ya no:
 * el costo lo pone el repartidor desde Entrega y llega a PEDIDO por su webhook. El
 * endpoint se quedó sin nadie que lo llamara.
 *
 * Y no era inofensivo estando ahí. Usaba `calculateHomeDeliveryPrice` —base + km + kg—,
 * que es una fórmula DISTINTA de la oficial que usa el lote (C = CKK x D x PP). Dos
 * precios distintos para el mismo pedido según por qué puerta entrara, con la pantalla de
 * Configuración diciendo que la fórmula es una sola. Un desacuerdo así no falla: sale un
 * número, cuadra, y se descubre cuando alguien compara dos informes.
 *
 * Para cotizar hay `/api/quote/batch`, que es lo que usa el espejo y lleva la fórmula
 * buena. Se contesta 410 y no 404: 404 dice "no existe" y manda a buscar el error en la
 * URL. Esto existió, y lo que hay que saber es que se quitó.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'El cotizador individual se retiró. El costo del domicilio lo pone Entrega y lo escribe en PEDIDO. Para el reparto de carga de delivery, usa POST /api/quote/batch.',
    },
    { status: 410 },
  )
}
