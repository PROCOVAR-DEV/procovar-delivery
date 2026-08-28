/**
 * La fórmula del domicilio, la MISMA que usa Entrega.
 *
 * Un pedido metido a mano en delivery tiene que salir por el mismo número que uno hecho
 * desde el teléfono. Cuando esto se desvía no falla nada: sale un importe creíble y se
 * cobra distinto según por dónde entró el pedido.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { costoDomicilioEntrega, distanciaHaversineKm, redondear } from '../src/lib/domicilioEntrega.ts'

test('la distancia es la de la APK: línea recta entre dos puntos', () => {
  // Almacén de La Habana → un cliente de Cotorro, del pedido real de la captura.
  const km = distanciaHaversineKm(23.08428, -82.16714, 23.062691, -82.290024)

  assert.ok(km > 12 && km < 14, `${km} km no cuadra con la distancia real`)
  // Un punto contra sí mismo son cero km, no un mínimo inventado.
  assert.equal(redondear(distanciaHaversineKm(23.1, -82.3, 23.1, -82.3)), 0)
})

test('el importe es tarifa × distancia × peso, con la tarifa pasada a USD', () => {
  /**
   * La APK guarda la tarifa en CUP y la divide por la tasa antes de multiplicar
   * (`services/calculo.ts`). Hacerlo al revés —multiplicar en CUP y dividir al final—
   * da lo mismo aquí, pero con el redondeo de por medio no siempre: se sigue su orden.
   */
  const r = costoDomicilioEntrega(685, 685, 10, 100)

  assert.ok(r)
  assert.equal(r?.tarifaUsd, 1)
  assert.equal(r?.usd, 1000)
  assert.equal(r?.cup, 685000)
})

test('sin tarifa o sin tasa NO sale un cero: sale nada', () => {
  // Un cero se suma y se lee como «este domicilio es gratis». Que no se pueda calcular es
  // otra cosa, y hay que poder distinguirlas.
  assert.equal(costoDomicilioEntrega(null, 685, 10, 100), null)
  assert.equal(costoDomicilioEntrega(685, null, 10, 100), null)
  assert.equal(costoDomicilioEntrega(685, 0, 10, 100), null)
})

test('un pedido sin peso resuelto sale a cero, no a un número inventado', () => {
  // 72 de los 128 productos de Ventra no traen peso. Con peso 0 el importe es 0 y se ve,
  // que es mejor que estimarlo por lo bajo y cobrarlo.
  assert.equal(costoDomicilioEntrega(685, 685, 10, 0)?.usd, 0)
})
