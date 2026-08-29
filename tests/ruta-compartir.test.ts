/**
 * La ruta que se manda al que reparte, y cuánto se demoró.
 *
 * Es lo que sale de esta aplicación hacia fuera: un enlace por WhatsApp que se abre en el
 * teléfono del chofer. Si el orden de las paradas o el punto de vuelta salen mal, nadie
 * se entera aquí — se entera el que está dando vueltas en la calle.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { duracionDeRuta, enlaceGoogleMaps, paradasFueraDelEnlace } from '../src/lib/rutaCompartir.ts'

const ruta = {
  originLat: 23.08,
  originLng: -82.16,
  orders: [
    { endLat: 23.2, endLng: -82.4, stopOrder: 2 },
    { endLat: 23.1, endLng: -82.3, stopOrder: 1 },
    { endLat: 23.3, endLng: -82.5, stopOrder: 3 },
  ],
}

test('el enlace sale y vuelve al ALMACÉN, con las paradas en su orden', () => {
  const url = new URL(enlaceGoogleMaps(ruta) as string)

  // El camión vuelve: una ruta que termina en el último cliente deja al chofer
  // buscándose la vuelta.
  assert.equal(url.searchParams.get('origin'), '23.08,-82.16')
  assert.equal(url.searchParams.get('destination'), '23.08,-82.16')
  // Y en el orden en que se optimizaron, no en el que estaban en la lista.
  assert.equal(url.searchParams.get('waypoints'), '23.1,-82.3|23.2,-82.4|23.3,-82.5')
  // Lista para arrancar en el móvil.
  assert.equal(url.searchParams.get('dir_action'), 'navigate')
  assert.equal(url.searchParams.get('travelmode'), 'driving')
})

test('sin almacén o sin paradas no hay enlace, en vez de uno roto', () => {
  assert.equal(enlaceGoogleMaps({ ...ruta, originLat: null }), null)
  assert.equal(enlaceGoogleMaps({ ...ruta, orders: [] }), null)
  assert.equal(enlaceGoogleMaps(null), null)
})

test('con más de 25 paradas se recorta, y se DICE cuántas quedan fuera', () => {
  const larga = {
    originLat: 23,
    originLng: -82,
    orders: Array.from({ length: 30 }, (_, i) => ({ endLat: 23 + i / 100, endLng: -82, stopOrder: i })),
  }
  const url = new URL(enlaceGoogleMaps(larga) as string)

  assert.equal(url.searchParams.get('waypoints')?.split('|').length, 25)
  // Comerse cinco paradas en silencio manda al chofer a dar media vuelta.
  assert.equal(paradasFueraDelEnlace(larga), 5)
})

test('la duración sale de la salida y el regreso, no de otra cosa', () => {
  const conHoras = {
    ...ruta,
    startedAt: '2026-08-29T08:05:00.000Z',
    finishedAt: '2026-08-29T11:25:00.000Z',
  }

  assert.equal(duracionDeRuta(conHoras), '3 h 20 min')
  assert.equal(duracionDeRuta({ ...conHoras, finishedAt: null }), null, 'todavía en la calle: no hay duración')
  // Menos de una hora se dice en minutos, no como «0 h 40 min».
  assert.equal(duracionDeRuta({ ...conHoras, finishedAt: '2026-08-29T08:45:00.000Z' }), '40 min')
})
