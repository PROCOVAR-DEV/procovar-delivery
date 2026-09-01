/**
 * Cuando la FACTURA cambia el pedido, el domicilio ya no vale lo que valía.
 *
 * El domicilio se cobra por peso: tarifa × distancia × kilos. El cliente pide veinte
 * cajas, al ir a facturar se lleva quince, y el precio que le puso el repartidor —o el
 * que se calculó al entrar el pedido— es el de veinte. Nadie lo vuelve a mirar, y se
 * cobra de más.
 *
 * Aquí se pesa lo FACTURADO con los pesos de Ventra y se vuelve a aplicar la fórmula de
 * Entrega, la misma de `domicilioEntrega.ts`. Delivery es quien puede hacerlo: es el
 * único que tiene a la vez el cotejo contra la factura, el catálogo con los pesos, el
 * almacén desde el que se mide y la tarifa de esa sucursal.
 *
 * Lo que sale de aquí NO se guarda en el pedido y ya: se le manda a PEDIDO, que es donde
 * vive el costo que se cobra.
 */

import { costoDomicilioEntrega, distanciaHaversineKm, type CostoDomicilio } from '@/lib/domicilioEntrega'

/** Un producto del catálogo, con lo poco que hace falta para pesar. */
export interface ProductoPesable {
  sku: string | null
  name: string
  weight: number | null
}

/** Una línea de la factura, tal como sale del cotejo. */
export interface LineaFacturada {
  producto: string
  codigo: string | null
  cantidad: number
}

export interface PesoDeFactura {
  kg: number
  /** Cuántas líneas no se pudieron pesar. Con alguna, el total se queda CORTO. */
  sinPeso: number
  /** Cuántas se pesaron. Cero significa que no se sabe nada, no que pese cero. */
  conPeso: number
}

/**
 * Lo que pesa una factura.
 *
 * Se cruza primero por CÓDIGO —el `productCode` de la venta es el mismo `sku` del
 * catálogo, los dos salen de la misma base de Ventra— y sólo si no hay código se cae al
 * nombre exacto. Nada de aproximar por palabras: aquí un emparejamiento de más no
 * confunde una etiqueta en pantalla, cambia lo que se le cobra a alguien.
 *
 * El peso del catálogo es por UNIDAD DE VENTA (el formato), igual que la cantidad que
 * factura Ventra. Multiplicar por unidades sueltas daría una cifra disparatada.
 */
export function pesarFactura(lineas: LineaFacturada[], catalogo: ProductoPesable[]): PesoDeFactura {
  const porSku = new Map<string, number>()
  const porNombre = new Map<string, number>()

  for (const p of catalogo) {
    if (!p.weight) continue
    if (p.sku) porSku.set(p.sku.trim().toUpperCase(), p.weight)
    if (p.name) porNombre.set(p.name.trim().toUpperCase(), p.weight)
  }

  let kg = 0
  let sinPeso = 0
  let conPeso = 0

  for (const l of lineas) {
    const unitario
      = (l.codigo ? porSku.get(l.codigo.trim().toUpperCase()) : undefined)
      ?? porNombre.get((l.producto || '').trim().toUpperCase())

    if (!unitario) {
      sinPeso++
      continue
    }
    conPeso++
    kg += unitario * l.cantidad
  }

  return { kg: Number(kg.toFixed(3)), sinPeso, conPeso }
}

export interface DondeSeMide {
  latitud: number
  longitud: number
}

export interface Recotizacion {
  costo: CostoDomicilio
  peso: PesoDeFactura
}

/**
 * El costo del domicilio para lo que se facturó.
 *
 * Devuelve `null` en cuanto falte cualquier cosa —el punto del almacén, la ubicación del
 * cliente, la tarifa, la tasa, o el peso de TODAS las líneas—: mandarle a PEDIDO un
 * precio calculado con la mitad de los kilos es cobrar de menos, y encima pisando el que
 * puso el repartidor, que sí estaba bien.
 *
 * @param tarifaBaseCup CUP por km·kg, de Entrega vía Accesos.
 * @param cupPorUsd     la tasa de ESA sucursal.
 */
export function recotizar(
  lineas: LineaFacturada[],
  catalogo: ProductoPesable[],
  almacen: DondeSeMide | null,
  cliente: DondeSeMide | null,
  tarifaBaseCup: number | null | undefined,
  cupPorUsd: number | null | undefined,
): Recotizacion | null {
  const peso = pesarFactura(lineas, catalogo)

  // Si alguna línea no se pudo pesar, el total va corto y no sirve para cobrar.
  if (!peso.conPeso || peso.sinPeso > 0 || peso.kg <= 0) return null
  if (!almacen || !cliente) return null

  const km = distanciaHaversineKm(almacen.latitud, almacen.longitud, cliente.latitud, cliente.longitud)
  const costo = costoDomicilioEntrega(tarifaBaseCup, cupPorUsd, km, peso.kg)

  return costo ? { costo, peso } : null
}
