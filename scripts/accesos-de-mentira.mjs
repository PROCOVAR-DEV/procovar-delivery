/**
 * Un Accesos de mentira, sólo para los almacenes.
 *
 * Los almacenes se guardan en Accesos y se editan aquí, así que la pantalla no se puede
 * probar sin algo al otro lado. Levantar Accesos entero —con su base, su login y su
 * firma— para comprobar que una lista se pinta y se guarda es desproporcionado.
 *
 * Esto contesta lo mismo que `/api/service/almacenes` y se guarda lo que le mandan, para
 * poder comprobar lo que de verdad importa: que lo guardado vuelve.
 *
 * NO comprueba la firma. La firma se comprueba en Accesos de verdad, y aquí sólo estorba.
 *
 * Uso:  node scripts/accesos-de-mentira.mjs [puerto]
 */

import { createServer } from 'node:http'

const PUERTO = Number(process.argv[2] || 3610)

const sucursales = new Map([
  ['HAB', { codigo: 'HAB', nombre: 'La Habana', almacenes: [
    { id: 'a1', nombre: 'Almacén central', direccion: 'Vedado', latitud: 23.12, longitud: -82.38, principal: true, activo: true },
  ] }],
  ['CMG', { codigo: 'CMG', nombre: 'Camagüey', almacenes: [] }],
  // Una que delivery NO tiene: sirve para comprobar que no se cuela en la pantalla.
  ['XXX', { codigo: 'XXX', nombre: 'Sucursal ajena', almacenes: [] }],
])

let siguiente = 100

createServer((req, res) => {
  const ruta = req.url.split('?')[0]

  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (ruta !== '/api/service/almacenes') {
    res.statusCode = 404
    res.end(JSON.stringify({ error: `sin ruta ${ruta}` }))
    return
  }

  if (req.method === 'GET') {
    res.end(JSON.stringify({ sucursales: [...sucursales.values()] }))
    return
  }

  if (req.method === 'PUT') {
    let cuerpo = ''

    req.on('data', (c) => { cuerpo += c })
    req.on('end', () => {
      const { codigo, almacenes } = JSON.parse(cuerpo || '{}')
      const s = sucursales.get(codigo)

      if (!s) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: `no hay sucursal con código ${codigo}` }))
        return
      }

      // Uno principal y sólo uno, como el de verdad.
      const principal = almacenes.find((a) => a.principal) ?? almacenes[0]

      s.almacenes = almacenes.map((a) => ({
        id: a.id ?? `n${siguiente++}`,
        nombre: a.nombre,
        direccion: a.direccion ?? null,
        latitud: a.latitud ?? null,
        longitud: a.longitud ?? null,
        principal: a === principal,
        activo: a.activo ?? true,
      }))

      res.end(JSON.stringify({ codigo, almacenes: s.almacenes }))
    })
    return
  }

  res.statusCode = 405
  res.end(JSON.stringify({ error: 'sólo GET y PUT' }))
}).listen(PUERTO, () => console.log(`accesos de mentira en http://localhost:${PUERTO}`))
