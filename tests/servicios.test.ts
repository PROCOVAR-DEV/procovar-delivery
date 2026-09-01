/**
 * Lo que no es mercancía.
 *
 * «ENTREGA A DOMICILIO» viene en el catálogo de Ventra como un producto más —categoría
 * SERV, peso cero— y salía en el buscador al meter un pedido a mano, con «0 kg» al lado.
 * Metida en un pedido no pesa nada y cobra el reparto dos veces: una en la línea y otra
 * en el domicilio.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { esServicio } from '../src/lib/servicios.ts'

test('la categoría SERV de Ventra es servicio', () => {
  assert.ok(esServicio({ name: 'ENTREGA A DOMICILIO', category: 'SERV' }))
  assert.ok(esServicio({ name: 'LO QUE SEA', category: 'Servicios' }))
})

test('y por el nombre, para cuando falte la categoría', () => {
  assert.ok(esServicio({ name: 'Entrega a domicilio', category: null }))
})

test('una cerveza no es un servicio por llevar una palabra suelta', () => {
  // Se pide la frase entera: con «entrega» a secas, cualquier producto que la mencionara
  // desaparecería del catálogo y nadie sabría por qué.
  assert.equal(esServicio({ name: 'CERVEZA PARRANDA 1500 ML', category: 'BEBIDAS' }), false)
  assert.equal(esServicio({ name: 'CAJA DE ENTREGA RAPIDA', category: 'ENVASES' }), false)
})
