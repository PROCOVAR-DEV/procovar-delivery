/**
 * El peso de las líneas: de dónde sale y en qué orden.
 *
 * Es el punto donde delivery deja de tener catálogo propio. Si esto se rompe no falla
 * nada: sale un peso, la ruta se planifica, y el camión va cargado por un número que no
 * es. Por eso se prueba el ORDEN de las fuentes, no sólo que el total cuadre.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { computeItemsWeights, buildOrderData } from '../src/lib/homeDeliveryQuote.ts'
import type { WeightCatalog } from '../src/lib/productMatch.ts'

// Un catálogo que dice que TODO pesa 99 kg por unidad de venta. Así, si alguna vez se
// usa cuando no debe, el número canta.
const catalogoRuidoso: WeightCatalog = {
  bySku: new Map(),
  resolve: () => ({ weightKg: 99, how: 'name-exact' as const }),
}

test('el peso de la línea que manda PEDIDO gana al catálogo propio', () => {
  const { total, items } = computeItemsWeights(
    [{ name: 'CERVEZA PARRANDA 0.33L', packs: 4, quantity: 24, pesoKg: 3.2, pesoLineaKg: 12.8 }],
    catalogoRuidoso,
  )

  assert.equal(total, 12.8)
  assert.equal(items[0].weightSource, 'pedido')
  assert.equal(items[0].unitWeightKg, 3.2)
})

test('con sólo el peso por unidad de venta, se multiplica por los packs', () => {
  const { total, items } = computeItemsWeights(
    [{ name: 'MALTA', packs: 5, quantity: 30, pesoKg: 2 }],
    catalogoRuidoso,
  )

  assert.equal(total, 10)
  assert.equal(items[0].weightSource, 'pedido')
})

test('sin packs, el peso por unidad de venta se aplica a las unidades sueltas', () => {
  const { total } = computeItemsWeights([{ name: 'RON', quantity: 3, pesoKg: 1.5 }])

  assert.equal(total, 4.5)
})

test('el peso escrito a mano va por delante del catálogo, pero detrás de PEDIDO', () => {
  const soloManual = computeItemsWeights([{ name: 'X', quantity: 2, weight: 5 }], catalogoRuidoso)
  assert.equal(soloManual.total, 10)
  assert.equal(soloManual.items[0].weightSource, 'manual')

  const conPedido = computeItemsWeights(
    [{ name: 'X', quantity: 2, weight: 5, pesoLineaKg: 7 }],
    catalogoRuidoso,
  )
  assert.equal(conPedido.total, 7)
  assert.equal(conPedido.items[0].weightSource, 'pedido')
})

test('el catálogo propio sigue de respaldo para los pedidos que no traen peso', () => {
  const { total, items } = computeItemsWeights([{ name: 'X', packs: 2, quantity: 12 }], catalogoRuidoso)

  assert.equal(total, 198) // 99 x 2 packs
  assert.equal(items[0].weightSource, 'catalogo')
})

test('un peso de cero o negativo no cuenta como peso: se sigue buscando', () => {
  const cero = computeItemsWeights([{ name: 'X', packs: 2, quantity: 1, pesoLineaKg: 0 }], catalogoRuidoso)
  assert.equal(cero.items[0].weightSource, 'catalogo')

  const negativo = computeItemsWeights([{ name: 'X', packs: 2, quantity: 1, pesoLineaKg: -3 }], catalogoRuidoso)
  assert.equal(negativo.items[0].weightSource, 'catalogo')
})

test('sin peso por ningún lado, la línea aporta 0 y se marca como no resuelta', () => {
  const { total, items } = computeItemsWeights([{ name: 'X', packs: 2, quantity: 1 }])

  assert.equal(total, 0)
  assert.equal(items[0].matched, false)
  assert.equal(items[0].weightSource, 'none')
})

test('varias líneas suman, aunque cada una resuelva por un camino distinto', () => {
  const { total } = computeItemsWeights(
    [
      { name: 'A', packs: 2, quantity: 12, pesoLineaKg: 10 },   // de PEDIDO
      { name: 'B', packs: 3, quantity: 18, pesoKg: 2 },         // de PEDIDO, por unidad
      { name: 'C', quantity: 4, weight: 1.5 },                  // a mano
      { name: 'D', packs: 1, quantity: 6 },                     // catálogo
    ],
    catalogoRuidoso,
  )

  assert.equal(total, 10 + 6 + 6 + 99)
})

test('buildOrderData guarda la fecha del pedido, no la de copiado', () => {
  const branch = { id: 'b1', name: 'Habana', lat: 23.1, lng: -82.3, creatorId: 'u1' }
  const data = buildOrderData(
    { customerName: 'Ana', lat: 23.2, lng: -82.4, externalId: 'p1', orderDate: '2026-08-14T10:30:00.000Z' },
    branch,
    { weightKg: 10, distanceKm: 5, items: [], quote: { distanceKm: 5, chargeableKm: 0, weightKg: 10, price: 3, breakdown: { base: 0, distance: 0, weight: 0, beforeMin: 3, beforeRound: 3 } } },
  )

  assert.ok(data.orderDate instanceof Date)
  assert.equal((data.orderDate as Date).toISOString(), '2026-08-14T10:30:00.000Z')
})

test('sin fecha de PEDIDO, orderDate queda en null y no se inventa la de hoy', () => {
  const branch = { id: 'b1', name: 'Habana', lat: 23.1, lng: -82.3, creatorId: 'u1' }
  const data = buildOrderData(
    { customerName: 'Ana', lat: 23.2, lng: -82.4, externalId: 'p1' },
    branch,
    { weightKg: 0, distanceKm: 1, items: [], quote: { distanceKm: 1, chargeableKm: 0, weightKg: 0, price: 0, breakdown: { base: 0, distance: 0, weight: 0, beforeMin: 0, beforeRound: 0 } } },
  )

  assert.equal(data.orderDate, null)
})
