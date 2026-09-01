/**
 * Recotizar el domicilio cuando la FACTURA cambia el pedido.
 *
 * El domicilio se cobra por peso. El cliente pide veinte cajas, al ir a facturar se lleva
 * quince, y el precio que había puesto es el de veinte: se cobra de más y nadie lo mira.
 *
 * Lo que más importa aquí no es que el número salga bien, sino que NO salga cuando no se
 * sabe. Un precio calculado con la mitad de los kilos es creíble, entra sin protestar y
 * pisa el que puso el repartidor —que sí estaba bien—.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { pesarFactura, recotizar } from '../src/lib/recotizarDomicilio.ts'

const CATALOGO = [
  { sku: 'C-1500', name: 'CERVEZA PARRANDA 1500 ML BLISTER 6U', weight: 9.5 },
  { sku: 'M-350', name: 'MALTA PARRANDA 350 ML', weight: 4.2 },
  { sku: 'S-000', name: 'SERVILLETAS', weight: null },
]

const ALMACEN = { latitud: 23.08428, longitud: -82.16714 }
const CLIENTE = { latitud: 23.062691, longitud: -82.290024 }

test('la factura se pesa por el código de Ventra, que es el sku del catálogo', () => {
  const p = pesarFactura(
    [
      { producto: 'CERVEZA PARRANDA 1500 ML BLISTER 6U', codigo: 'C-1500', cantidad: 10 },
      { producto: 'MALTA PARRANDA 350 ML', codigo: 'M-350', cantidad: 5 },
    ],
    CATALOGO,
  )

  assert.equal(p.kg, 9.5 * 10 + 4.2 * 5)
  assert.equal(p.sinPeso, 0)
  assert.equal(p.conPeso, 2)
})

test('sin código se cae al nombre exacto, y nada más', () => {
  const porNombre = pesarFactura([{ producto: 'MALTA PARRANDA 350 ML', codigo: null, cantidad: 2 }], CATALOGO)

  assert.equal(porNombre.kg, 8.4)

  /**
   * Y un nombre PARECIDO no cuenta.
   *
   * En el cotejo se empareja por palabras compartidas, que allí vale: si sobra una
   * coincidencia, sale una etiqueta de más en pantalla. Aquí no: aquí sale un importe que
   * se le cobra a alguien, así que se prefiere no saber.
   */
  const parecido = pesarFactura([{ producto: 'MALTA PARRANDA 350', codigo: null, cantidad: 2 }], CATALOGO)

  assert.equal(parecido.conPeso, 0)
  assert.equal(parecido.sinPeso, 1)
})

test('una línea sin peso en Ventra deja la factura SIN recotizar', () => {
  const lineas = [
    { producto: 'CERVEZA PARRANDA 1500 ML BLISTER 6U', codigo: 'C-1500', cantidad: 10 },
    { producto: 'SERVILLETAS', codigo: 'S-000', cantidad: 3 },
  ]

  // El peso se calcula igual, y dice cuántas se quedaron fuera…
  assert.equal(pesarFactura(lineas, CATALOGO).sinPeso, 1)
  // …pero no se pone precio con él: iría corto, y de menos también es cobrar mal.
  assert.equal(recotizar(lineas, CATALOGO, ALMACEN, CLIENTE, 685, 685), null)
})

test('sin almacén, sin cliente, sin tarifa o sin tasa no se inventa un precio', () => {
  const lineas = [{ producto: 'MALTA PARRANDA 350 ML', codigo: 'M-350', cantidad: 10 }]

  assert.equal(recotizar(lineas, CATALOGO, null, CLIENTE, 685, 685), null)
  assert.equal(recotizar(lineas, CATALOGO, ALMACEN, null, 685, 685), null)
  assert.equal(recotizar(lineas, CATALOGO, ALMACEN, CLIENTE, null, 685), null)
  assert.equal(recotizar(lineas, CATALOGO, ALMACEN, CLIENTE, 685, 0), null)
  // Y una factura vacía tampoco vale cero: vale «no se sabe».
  assert.equal(recotizar([], CATALOGO, ALMACEN, CLIENTE, 685, 685), null)
})

test('con todo, sale la fórmula de Entrega: tarifa en USD × km × kg', () => {
  const r = recotizar(
    [{ producto: 'MALTA PARRANDA 350 ML', codigo: 'M-350', cantidad: 10 }],
    CATALOGO,
    ALMACEN,
    CLIENTE,
    685,
    685,
  )

  assert.ok(r)
  assert.equal(r?.peso.kg, 42)
  assert.equal(r?.costo.tarifaUsd, 1)
  // 13,0 km × 42 kg × 1 USD/km·kg, redondeado a dos decimales.
  assert.equal(r?.costo.usd, Number((r!.costo.distanciaKm * 42).toFixed(2)))
})

test('menos kilos, menos domicilio: es de lo que va todo esto', () => {
  const pedido = recotizar(
    [{ producto: 'MALTA PARRANDA 350 ML', codigo: 'M-350', cantidad: 20 }],
    CATALOGO, ALMACEN, CLIENTE, 685, 685,
  )
  const facturado = recotizar(
    [{ producto: 'MALTA PARRANDA 350 ML', codigo: 'M-350', cantidad: 15 }],
    CATALOGO, ALMACEN, CLIENTE, 685, 685,
  )

  assert.ok(pedido && facturado)
  assert.ok(facturado!.costo.usd < pedido!.costo.usd)
})
