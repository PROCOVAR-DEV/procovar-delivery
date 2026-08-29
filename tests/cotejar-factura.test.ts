/**
 * Cotejar el pedido con la factura.
 *
 * Es lo que decide qué sale en el camión. Si dice «igual» cuando no lo es, se carga de
 * más y se cobra de menos; si dice «cambiado» cuando sí cuadra, ese pedido se queda sin
 * repartir. Las dos cosas se ven al final del día, y para entonces ya pasó.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cotejar, mismoProducto, clavesDeProducto } from '../src/lib/cotejarFactura.ts'

// Los nombres REALES: Ventra escribe el formato en mililitros y el pedido en litros.
const FACTURA = [
  { operNumber: '1024160', clienteNombre: 'LA CHIQUI (C. MACEO)', productoNombre: 'CERVEZA PARRANDA 1500 ML BLISTER 6U', cantidad: 20 },
  { operNumber: '1024160', clienteNombre: 'LA CHIQUI (C. MACEO)', productoNombre: 'MALTA GUAJIRA 1500 ML BLISTER 6U', cantidad: 10 },
]

test('«PARRANDA 1.5L» y «CERVEZA PARRANDA 1500 ML BLISTER 6U» son el mismo producto', () => {
  assert.ok(mismoProducto('PARRANDA 1.5L', 'CERVEZA PARRANDA 1500 ML BLISTER 6U'))
  assert.ok(clavesDeProducto('PARRANDA 1.5L').has('1500'), 'el litro no se pasó a mililitros')
})

test('pero NO confunde formatos de la misma marca', () => {
  // Con una sola palabra en común —«parranda»— casaría cualquier formato con cualquiera,
  // y el cotejo diría que cuadra cuando lo que se lleva es otra cosa.
  assert.equal(mismoProducto('PARRANDA 0.33L', 'CERVEZA PARRANDA 1500 ML BLISTER 6U'), false)
})

test('lo que cuadra sale como igual, con su número de factura', () => {
  const r = cotejar(
    [
      { name: 'PARRANDA 1.5L', packs: 20, quantity: 120 },
      { name: 'MALTA GUAJIRA 1.5L', packs: 10, quantity: 60 },
    ],
    FACTURA,
    'La Chiqui (C. Maceo)',
  )

  assert.equal(r.estado, 'igual')
  assert.equal(r.numero, '1024160')
  assert.deepEqual(r.diferencias, [])
})

test('lo que cambió lo DICE, con las cantidades de los dos lados', () => {
  const r = cotejar([{ name: 'PARRANDA 1.5L', packs: 25 }], FACTURA, 'LA CHIQUI (C. MACEO)')

  assert.equal(r.estado, 'cambiado')
  // Y se dice en qué: se pidieron 25 y se facturaron 20. Sin eso, «cambiado» a secas
  // obliga a abrir Ventra para saber qué pasó.
  assert.match(r.diferencias.join(' | '), /pedido 25, facturado 20/)
  // Lo facturado y no pedido también cuenta.
  assert.match(r.diferencias.join(' | '), /MALTA GUAJIRA .*facturado 10, no pedido/)
})

test('sin factura de ese cliente ese día, se dice: no se inventa un encaje', () => {
  const r = cotejar([{ name: 'PARRANDA 1.5L', packs: 20 }], FACTURA, 'OTRO CLIENTE')

  assert.equal(r.estado, 'sin_factura')
  assert.equal(r.numero, null)
})

test('dos facturas del mismo cliente el mismo día se cotejan JUNTAS', () => {
  /**
   * Pasa cuando el pedido se factura en dos documentos. Compararlo contra una sola diría
   * «cambiado» siempre, y media ruta se quedaría fuera.
   */
  const dos = [
    ...FACTURA,
    { operNumber: '1024199', clienteNombre: 'LA CHIQUI (C. MACEO)', productoNombre: 'ARROZ CAMIL 1 KG PACA 10U', cantidad: 5 },
  ]
  const r = cotejar(
    [
      { name: 'PARRANDA 1.5L', packs: 20 },
      { name: 'MALTA GUAJIRA 1.5L', packs: 10 },
      { name: 'ARROZ CAMIL 1 KG', packs: 5 },
    ],
    dos,
    'LA CHIQUI (C. MACEO)',
  )

  assert.equal(r.estado, 'igual')
  assert.equal(r.numero, '1024160, 1024199')
})
