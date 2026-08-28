/**
 * Emparejar nuestras sucursales con las bases de Ventra.
 *
 * Cuando esto falla no salta nada: la sucursal se queda sin catálogo y parece que no
 * tiene productos. Por eso se prueba con los nombres REALES, que son los que engañan.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { emparejarConVentra } from '../src/lib/emparejarVentra.ts'

const BASES = [
  { database: 'camaguey', branchName: 'CAMAGUEY' },
  { database: 'granma', branchName: 'BAYAMO' },
  { database: 'sspiritus', branchName: 'SANCTI SPIRITUS' },
  { database: 'tunas', branchName: 'LAS TUNAS' },
  { database: 'holguinmoa', branchName: 'HOLGUIN' },
]

const suc = (name: string, externalId: string | null = null) => ({ id: name, name, externalId })

test('cuadra por el nombre aunque lleve acento', () => {
  const [r] = emparejarConVentra([suc('Camagüey')], BASES)

  assert.equal(r.database, 'camaguey')
})

test('cuadra cuando Ventra la llama de otra forma', () => {
  // La nuestra se llama Granma; la suya, BAYAMO. Deducir el slug del nombre falla aquí.
  const [r] = emparejarConVentra([suc('Granma')], BASES)

  assert.equal(r.database, 'granma')
})

test('cuadra por el nombre completo aunque el slug esté abreviado', () => {
  assert.equal(emparejarConVentra([suc('Sancti Spíritus')], BASES)[0].database, 'sspiritus')
  assert.equal(emparejarConVentra([suc('Las Tunas')], BASES)[0].database, 'tunas')
  assert.equal(emparejarConVentra([suc('Holguín')], BASES)[0].database, 'holguinmoa')
})

test('la que no cuadra devuelve null, no una base cualquiera', () => {
  /**
   * Es lo único que no puede pasar: darle a una sucursal el catálogo de otra. Los
   * precios y las existencias de Ventra son POR SUCURSAL, así que un emparejamiento
   * equivocado sale con números creíbles que nadie cuestiona.
   */
  const [r] = emparejarConVentra([suc('Isla de la Juventud')], BASES)

  assert.equal(r.database, null)
})

test('si no cuadra por nombre, se prueba con el código', () => {
  const bases = [{ database: 'hab', branchName: 'LA HABANA CENTRO' }]
  const [r] = emparejarConVentra([suc('La Habana', 'HAB')], bases)

  assert.equal(r.database, 'hab')
})

test('los dos nombres reales que se quedaron sin catálogo', () => {
  /**
   * Salieron en la primera pasada de verdad, y sólo se vieron porque el sondeo dice cuál
   * no cuadró: «Bayamo (Granma)» lleva los dos nombres en uno y «Santiago de Cuba» lleva
   * un «de Cuba» que en Ventra no está.
   */
  const bases = [
    { database: 'granma', branchName: 'BAYAMO' },
    { database: 'santiago', branchName: 'SANTIAGO' },
    { database: 'palmasoriano', branchName: 'PALMA SORIANO' },
  ]

  assert.equal(emparejarConVentra([suc('Bayamo (Granma)', 'GR')], bases)[0].database, 'granma')
  assert.equal(emparejarConVentra([suc('Santiago de Cuba', 'STG')], bases)[0].database, 'santiago')
})

test('si encajaran DOS bases distintas, no se elige ninguna', () => {
  // Darle a una sucursal el catálogo de otra sale con precios y existencias creíbles que
  // nadie cuestiona. Ante la duda, sin catálogo y avisando de cuál falta.
  const bases = [
    { database: 'camaguey', branchName: 'CAMAGUEY' },
    { database: 'guantanamo', branchName: 'GUANTANAMO' },
  ]

  assert.equal(emparejarConVentra([suc('Camagüey y Guantánamo')], bases)[0].database, null)
})

test('«Holguín» se queda con holguinmoa y no con moa', () => {
  // Moa tiene su propia base ADEMÁS de estar dentro de la de Holguín. Que el nombre de
  // una contenga a la otra es justo donde un emparejamiento flojo se equivoca.
  const bases = [
    { database: 'holguinmoa', branchName: 'HOLGUIN' },
    { database: 'moa', branchName: 'MOA' },
  ]

  assert.equal(emparejarConVentra([suc('Holguin', 'HOL')], bases)[0].database, 'holguinmoa')
  assert.equal(emparejarConVentra([suc('Moa', 'MOA')], bases)[0].database, 'moa')
})
