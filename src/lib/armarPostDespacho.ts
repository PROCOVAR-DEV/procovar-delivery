/**
 * La cuenta del post-despacho: qué salió, qué se entregó y qué tiene que quedar arriba.
 *
 * Se hace aquí y no en la pantalla porque es una resta que decide si falta mercancía, y
 * eso hay que poder probarlo. Puro: entran los pedidos de la ruta, sale la hoja.
 */

import type { LineaPostDespacho, ParadaPendiente, PostDespacho } from '@/lib/imprimirPostDespacho'

export interface ItemDePedido {
  name?: string | null
  description?: string | null
  packs?: number | null
  quantity?: number | null
}

export interface PedidoDeRuta {
  customerName: string
  /** `entregado`, `devuelto`, `cancelado`, o nada si nadie lo marcó al volver. */
  resultado?: string | null
  resultadoNota?: string | null
  items?: unknown
}

const lineas = (p: PedidoDeRuta): Array<{ producto: string; formatos: number }> => {
  const items = (Array.isArray(p.items) ? p.items : []) as ItemDePedido[]

  return items
    .map((it) => ({
      producto: (it?.name || it?.description || '').trim(),
      // Los formatos son la unidad con la que se carga y se cuenta un camión. Cuando la
      // línea no los trae, se cae a las unidades: es lo que hay, y cero sería mentira.
      formatos: Number(it?.packs) > 0 ? Number(it.packs) : Number(it?.quantity) || 0,
    }))
    .filter((l) => l.producto)
}

export interface DatosDeRuta {
  ruta: string
  sucursal: string
  vehiculo: string
  salida?: string
  regreso?: string
}

/**
 * @param pedidos las paradas de la ruta, con su resultado ya marcado.
 *
 * Lo que QUEDA es todo lo que no se entregó: lo devuelto, lo cancelado y —sobre todo— lo
 * que nadie marcó. Eso último se cuenta como que sigue arriba a propósito: dar por
 * entregada una parada que nadie tocó es justo como se pierde mercancía sin que salte
 * nada. En la hoja sale aparte, para que se vea que falta marcarla.
 */
export function armarPostDespacho(datos: DatosDeRuta, pedidos: PedidoDeRuta[]): PostDespacho {
  const porProducto = new Map<string, LineaPostDespacho>()
  const pendientes: ParadaPendiente[] = []

  let entregadas = 0
  let devueltas = 0
  let canceladas = 0
  let sinMarcar = 0

  for (const p of pedidos) {
    const entregado = p.resultado === 'entregado'

    if (entregado) entregadas++
    else if (p.resultado === 'devuelto') devueltas++
    else if (p.resultado === 'cancelado') canceladas++
    else sinMarcar++

    const suyas = lineas(p)

    for (const l of suyas) {
      const acc = porProducto.get(l.producto) ?? { producto: l.producto, salio: 0, entregado: 0, queda: 0 }

      acc.salio += l.formatos
      if (entregado) acc.entregado += l.formatos
      else acc.queda += l.formatos
      porProducto.set(l.producto, acc)
    }

    if (!entregado) {
      pendientes.push({
        cliente: p.customerName,
        resultado: p.resultado ?? null,
        nota: p.resultadoNota ?? null,
        productos: suyas,
      })
    }
  }

  return {
    ...datos,
    entregadas,
    devueltas,
    canceladas,
    sinMarcar,
    // Lo que más queda primero: es por donde se empieza a contar al bajar el camión.
    lineas: [...porProducto.values()].sort((a, b) => b.queda - a.queda || a.producto.localeCompare(b.producto)),
    pendientes,
  }
}
