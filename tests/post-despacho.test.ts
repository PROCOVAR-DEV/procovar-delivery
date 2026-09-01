/**
 * El post-despacho: lo que tiene que quedar en el camión cuando vuelve.
 *
 * Es una resta, y de ella depende que se note si falta mercancía. Salieron cuarenta
 * cajas, se entregaron treinta y una, tienen que bajar nueve: si esta cuenta se equivoca
 * hacia arriba, alguien devuelve de menos y nadie se entera hasta el inventario.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { armarPostDespacho } from '../src/lib/armarPostDespacho.ts'

const RUTA = { ruta: 'RT-1', sucursal: 'La Habana', vehiculo: 'Camión 1' }

const pedido = (customerName: string, resultado: string | null, items: Array<[string, number]>) => ({
  customerName,
  resultado,
  items: items.map(([name, packs]) => ({ name, packs, quantity: packs * 6 })),
})

test('lo que queda es lo que salió menos lo entregado', () => {
  const d = armarPostDespacho(RUTA, [
    pedido('Ana', 'entregado', [['MALTA 350', 20]]),
    pedido('Beto', 'devuelto', [['MALTA 350', 9]]),
  ])
  const malta = d.lineas.find((l) => l.producto === 'MALTA 350')

  assert.equal(malta?.salio, 29)
  assert.equal(malta?.entregado, 20)
  assert.equal(malta?.queda, 9)
  assert.equal(d.entregadas, 1)
  assert.equal(d.devueltas, 1)
})

test('lo que NADIE marcó cuenta como que sigue arriba', () => {
  /**
   * Es la decisión que importa. Dar por entregada una parada que nadie tocó es
   * exactamente como se pierde mercancía sin que salte nada: la hoja diría que no baja
   * nada y el camión se va con la carga dentro.
   */
  const d = armarPostDespacho(RUTA, [pedido('Ana', null, [['PARRANDA 1.5L', 12]])])

  assert.equal(d.lineas[0].queda, 12)
  assert.equal(d.sinMarcar, 1)
  // Y sale en la lista de quién es, con su etiqueta de que falta marcarla.
  assert.equal(d.pendientes[0].cliente, 'Ana')
  assert.equal(d.pendientes[0].resultado, null)
})

test('lo cancelado también vuelve: no se entregó', () => {
  const d = armarPostDespacho(RUTA, [pedido('Ana', 'cancelado', [['MALTA 350', 5]])])

  assert.equal(d.canceladas, 1)
  assert.equal(d.lineas[0].queda, 5)
})

test('una ruta entregada entera no deja nada que bajar', () => {
  const d = armarPostDespacho(RUTA, [
    pedido('Ana', 'entregado', [['MALTA 350', 20]]),
    pedido('Beto', 'entregado', [['MALTA 350', 9]]),
  ])

  assert.equal(d.lineas[0].queda, 0)
  assert.equal(d.pendientes.length, 0)
})

test('sin formatos se cuenta por unidades, que es lo que hay', () => {
  // Cero sería mentira: esa línea existe y va en el camión.
  const d = armarPostDespacho(RUTA, [
    { customerName: 'Ana', resultado: 'devuelto', items: [{ name: 'CAJA SUELTA', quantity: 7 }] },
  ])

  assert.equal(d.lineas[0].queda, 7)
})

test('lo que más queda va primero: por ahí se empieza a contar', () => {
  const d = armarPostDespacho(RUTA, [
    pedido('Ana', 'devuelto', [['POCO', 2], ['MUCHO', 30]]),
  ])

  assert.equal(d.lineas[0].producto, 'MUCHO')
})
