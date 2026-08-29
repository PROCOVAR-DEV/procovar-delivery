/**
 * Cotejar el pedido con la factura.
 *
 * Es lo que decide qué sale en el camión. Si dice «igual» cuando no lo es, se carga de
 * más y se cobra de menos; si dice «cambiado» cuando sí cuadra, ese pedido se queda sin
 * repartir. Las dos cosas se ven al final del día, y para entonces ya pasó.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cotejar, mismoProducto, mismoCliente, clavesDeProducto } from '../src/lib/cotejarFactura.ts'

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

test('el mismo cliente escrito de dos formas se reconoce', () => {
  /**
   * Los nombres REALES: Ventra le pega a veces la persona detrás del negocio. Exigir
   * igualdad exacta dejaba fuera medio día de facturación, y esos pedidos desaparecían
   * del armador —que por defecto sólo ofrece los que cuadran— sin decir por qué.
   */
  assert.ok(mismoCliente('5TA AVENIDA(ILIANA)', '5TA AVENIDA(ILIANA)   ILIANA CABEZA VENERO'))
  assert.ok(mismoCliente('LA CHIQUI (C. MACEO)', 'la chiqui (c. maceo)'))
  assert.ok(mismoCliente('24 HORAS (CALZADA DE SAN MIGUEL)', '24 HORAS (CALZADA DE SAN MIGUEL)'))
})

test('los casos REALES de producción, que son los que engañan', () => {
  // Salieron del cotejo de verdad: la factura le añade el dueño, un prefijo o una ese.
  assert.ok(mismoCliente('BAVARIA', 'BAVARIA   JUAN CARLOS FEDERICK'), 'la factura lleva el dueño detrás')
  assert.ok(mismoCliente('LOS ORLAN', 'LOS ORLANS'), 'una ese de diferencia')
  assert.ok(mismoCliente('ABEDUL', 'Mipyme Abedul'), 'la factura lleva «Mipyme» delante')
  assert.ok(mismoCliente('BAR EL 40', 'BAR EL 40 CAMILO'))
})

test('pero NO confunde dos negocios distintos', () => {
  // Con una palabra en común, «CAFETERIA ODALIS» casaría con cualquier otra cafetería y
  // el camión saldría con la mercancía de otro cliente.
  assert.equal(mismoCliente('CAFETERIA ODALIS', 'CAFETERIA DALIZ'), false)
  // «MI REINA» / «MI REINA ROXANA» SÍ se emparejan, y es lo correcto: es el mismo patrón
  // que «BAVARIA» / «BAVARIA JUAN CARLOS FEDERICK» — el negocio y su dueño. Lo que no
  // puede pasar es emparejar por una palabra genérica.
  assert.ok(mismoCliente('MI REINA ROXANA', 'MI REINA'))
  assert.equal(mismoCliente('14 KILATES', 'A LO CUBANO'), false)
  // «CAFETERIA» y «MERCADITO» no nombran a nadie: media lista empieza así.
  assert.equal(mismoCliente('CAFETERIA LA RUBIA', 'CAFETERIA LA GRECO'), false)
  assert.equal(mismoCliente('LA CELESTIAL', 'CAFETERIA LA ANTILLANA'), false)
  // Y un cambio de letra tampoco: «VIDA A TU DIA» no es «VIDA A TU VIDA».
  assert.equal(mismoCliente('VIDA A TU DIA', 'VIDA A TU VIDA'), false)
})
