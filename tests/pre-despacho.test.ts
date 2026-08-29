/**
 * El pre-despacho: cuánto hay que sacar del almacén.
 *
 * Es una suma que alguien va a comprobar con la mercancía delante. Si sale corta, el
 * camión se va sin la mitad; si sale larga, se baja de más y se devuelve. Por eso se
 * prueba la suma, y sobre todo que EMPAQUES y UNIDADES no se mezclen: son dos cuentas
 * distintas —cajas y botellas— y confundirlas multiplica por sesenta.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { htmlPreDespacho } from '../src/lib/imprimirPreDespacho.ts'

const hoja = {
  sucursal: 'La Habana',
  vehiculo: 'Vehiculo HAB',
  dia: '2026-08-29',
  pedidos: 3,
  pesoKg: 337.4,
  lineas: [
    { producto: 'MALTA GUAJIRA 1.5L', formatos: 25, unidades: 150, pesoKg: 241 },
    { producto: 'PARRANDA 1.5L', formatos: 10, unidades: 60, pesoKg: 96.4 },
  ],
}

test('la hoja lleva los totales de empaques y de unidades, por separado', () => {
  const html = htmlPreDespacho(hoja)

  // Los totales de la fila final: 35 empaques y 210 unidades.
  assert.match(html, /<td class="n">35<\/td>/)
  assert.match(html, /<td class="n">210<\/td>/)
  // Y el peso, que es lo que decide si cabe en el camión.
  assert.match(html, /337\.4/)
})

test('lleva de dónde sale, en qué va y de qué día es', () => {
  const html = htmlPreDespacho(hoja)

  assert.match(html, /La Habana/)
  assert.match(html, /Vehiculo HAB/)
  assert.match(html, /2026-08-29/)
  // Y una columna para ir marcando lo que se saca: se usa con la mercancía delante.
  assert.match(html, /Sacado/)
  assert.match(html, /Sacó del almacén/)
})

test('un producto con comillas o signos no rompe la hoja', () => {
  // Los nombres vienen de Ventra y llevan de todo. Si no se escapan, la hoja sale a
  // medias y nadie sabe qué falta.
  const html = htmlPreDespacho({
    ...hoja,
    lineas: [{ producto: 'CAJA <ESPECIAL> "6u" & CO', formatos: 1, unidades: 6, pesoKg: 5 }],
  })

  assert.match(html, /CAJA &lt;ESPECIAL&gt; &quot;6u&quot; &amp; CO/)
})
