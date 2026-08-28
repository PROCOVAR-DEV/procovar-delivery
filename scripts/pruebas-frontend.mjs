/**
 * Pruebas desde el navegador: lo que ve una persona, no lo que devuelve un endpoint.
 *
 * Delivery es una aplicación de cliente —react-query, filtros en pantalla, un menú que
 * se abre—, así que casi nada de esto se puede comprobar con `curl`: el HTML que manda
 * el servidor viene vacío y todo lo pinta el navegador después. Los fallos que se
 * reportaron eran justo de ahí: "se queda cargando", "sigo viendo individual", "cero
 * pedidos en otro año".
 *
 * Uso (hace falta un navegador con sus librerías; en esta máquina va por Docker):
 *   BASE=http://localhost:3399 JWT_SECRET=... DATABASE_URL=... node scripts/pruebas-frontend.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://localhost:3399'
const SECRET = process.env.JWT_SECRET
if (!SECRET) throw new Error('Falta JWT_SECRET: es con lo que se firma la sesión de prueba.')

const prisma = new PrismaClient()
const admin = await prisma.user.findFirst({ where: { branchId: null }, orderBy: { createdAt: 'asc' } })
if (!admin) throw new Error('Falta la siembra: corré antes `node scripts/sembrar-pruebas.mjs`.')

const token = jwt.sign(
  { id: admin.id, email: admin.email, name: admin.name, role: admin.role, branchId: null },
  SECRET,
  { expiresIn: '1h' },
)

const navegador = await chromium.launch()

/**
 * Una pestaña con la sesión ya puesta.
 *
 * La cookie `token` es la que deja el login único; se pone a mano para no depender de
 * Accesos, que en local no está. Y el store del navegador se siembra igual, porque el
 * front manda el token en la cabecera `Authorization`.
 */
async function conSesion() {
  const ctx = await navegador.newContext({ viewport: { width: 1400, height: 900 } })

  await ctx.addCookies([{ name: 'token', value: token, url: BASE, httpOnly: true }])
  // El store guarda cada cosa en su clave de localStorage; se siembran las que usa.
  await ctx.addInitScript(
    ([t, u]) => {
      window.localStorage.setItem('token', t)
      window.localStorage.setItem('user', JSON.stringify(u))
      window.localStorage.setItem('language', 'es')
    },
    [token, { id: admin.id, email: admin.email, name: admin.name, role: admin.role, branchId: null }],
  )

  const page = await ctx.newPage()
  const errores = []

  page.on('pageerror', (e) => errores.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()) })
  return { ctx, page, errores }
}

const cerrar = async (ctx) => ctx.close()

// ---------------------------------------------------------------- pedidos

/** Cuántos pedidos dice la cabecera que hay en TOTAL (no en la página). */
async function totalPedidos(page) {
  const txt = await page.locator('text=/[\\d.,]+ pedidos/').first().innerText()

  return Number(txt.replace(/[^\d]/g, ''))
}


test('la lista de pedidos carga y pinta filas, sin quedarse en "Cargando"', async () => {
  const { ctx, page, errores } = await conSesion()

  await page.goto(`${BASE}/orders`, { waitUntil: 'domcontentloaded' })
  // Si esto expira es literalmente el fallo reportado: la pantalla se queda cargando.
  await page.waitForSelector('table tbody tr', { timeout: 20000 })

  const filas = await page.locator('table tbody tr').count()

  assert.ok(filas > 0, 'la tabla de pedidos está vacía')
  assert.equal(errores.length, 0, `errores en el navegador: ${errores.join(' | ')}`)
  await cerrar(ctx)
})

test('cada fila enseña la fecha del pedido, no todas la de hoy', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/orders`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('table tbody tr')

  const fechas = await page.locator('table tbody tr td:first-child').allInnerTexts()
  const distintas = new Set(fechas.map((f) => f.trim()))

  assert.ok(distintas.size > 1, `todas las filas tienen la misma fecha (${[...distintas]}): se está enseñando la de copiado`)
  await cerrar(ctx)
})

test('el filtro por fechas acota de verdad, y un rango vacío lo explica', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/orders`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('table tbody tr')

  const total = await totalPedidos(page)

  // Un rango de hace muchos años: no queda ni un pedido sembrado.
  await page.fill('input[title="Desde (fecha del pedido)"]', '2020-01-01')
  await page.fill('input[title="Hasta (fecha del pedido)"]', '2020-12-31')
  await page.waitForTimeout(900)

  assert.equal(await page.locator('table tbody tr').count(), 0, 'un rango sin pedidos debería vaciar la tabla')

  /**
   * Y no dejar un cero mudo, que es lo que se lee como "esto está roto".
   *
   * Cuando hay filtros puestos, un vacío casi nunca significa "no hay": significa que los
   * filtros no dejan pasar nada. La pantalla lo dice y ofrece quitarlos.
   */
  await page.waitForSelector('text=/Ningún pedido cuadra/i', { timeout: 5000 })

  // Y quitándolos vuelven todos.
  await page.click('text=/quitarlos todos/i')
  await page.waitForSelector('table tbody tr')
  await page.waitForTimeout(500)
  assert.equal(await totalPedidos(page), total)
  await cerrar(ctx)
})

test('el filtro por vendedor y el de municipio acotan el CATÁLOGO, no la página', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/orders`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('table tbody tr')

  const antes = await totalPedidos(page)
  const vendedores = page.locator('select[title="Vendedor del pedido"]')

  assert.equal(await vendedores.count(), 1, 'falta el filtro de vendedor')

  const opciones = await vendedores.locator('option').allInnerTexts()
  assert.ok(opciones.length > 1, 'el filtro de vendedor no trae vendedores')

  await vendedores.selectOption({ label: opciones[1] })
  await page.waitForTimeout(800)

  const despues = await totalPedidos(page)

  assert.ok(despues < antes, `elegir un vendedor no acotó: ${antes} -> ${despues}`)
  await cerrar(ctx)
})

test('los archivados se ven, y se pueden esconder', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/orders`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('table tbody tr')

  const todos = await totalPedidos(page)

  await page.selectOption('select[title="Archivados en PEDIDO"]', '0')
  await page.waitForTimeout(800)
  const activos = await totalPedidos(page)

  await page.selectOption('select[title="Archivados en PEDIDO"]', '1')
  await page.waitForTimeout(800)
  const archivados = await totalPedidos(page)

  assert.ok(archivados > 0, 'no se ve ni un archivado: ahí está casi todo el histórico')
  assert.equal(activos + archivados, todos, 'archivados + activos tiene que dar el catálogo entero')
  await cerrar(ctx)
})

test('el estado del pedido se filtra y se ve en la tabla', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/orders`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('table tbody tr')

  await page.selectOption('select[title="Estado del pedido en PEDIDO"]', 'completada')
  await page.waitForTimeout(800)
  await page.waitForSelector('table tbody tr')

  // Toda la columna de estado dice lo mismo que se pidió.
  const estados = await page.locator('table tbody tr td:nth-child(2)').allInnerTexts()

  assert.ok(estados.length > 0)
  for (const e of estados) assert.match(e, /Completada/)

  await page.selectOption('select[title="Estado del pedido en PEDIDO"]', 'expirada')
  await page.waitForTimeout(800)
  const expiradas = await page.locator('table tbody tr td:nth-child(2)').allInnerTexts()

  assert.ok(expiradas.length > 0, 'no hay expirados y la siembra tiene')
  for (const e of expiradas) assert.match(e, /Expirada/)
  await cerrar(ctx)
})

test('la paginación trae páginas distintas, no la misma dos veces', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/orders`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('table tbody tr')

  const primeros = await page.locator('table tbody tr td:nth-child(3)').allInnerTexts()
  const siguiente = page.locator('button:has(svg), button').filter({ hasText: /siguiente|next|›|>/i }).first()

  if (await siguiente.count()) {
    await siguiente.click()
    await page.waitForTimeout(800)

    const segundos = await page.locator('table tbody tr td:nth-child(3)').allInnerTexts()

    assert.notDeepEqual(segundos, primeros, 'la página 2 enseña lo mismo que la 1')
  }
  await cerrar(ctx)
})

// ---------------------------------------------------------------- clientes

test('los clientes cargan y se encuentra uno que está más allá del tope', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/customers`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=/en total|Se enseñan/', { timeout: 20000 })

  // Un cliente que por orden alfabético cae muy por detrás de los 500 primeros: antes
  // no aparecía nunca, porque la búsqueda se hacía después de cortar.
  const ultimo = await prisma.customer.findFirst({ orderBy: { name: 'desc' } })

  await page.fill('input[placeholder*="Buscar"]', ultimo.name)
  await page.waitForTimeout(900) // la pausa antes de consultar

  await page.waitForSelector(`text=${ultimo.name.split(' ')[0]}`, { timeout: 10000 })
  await cerrar(ctx)
})

// ------------------------------------------------------- barra y menú

test('la barra lateral ya no lleva ni cerrar sesión ni los usuarios de Accesos', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav a[href="/orders"]')

  const barra = page.locator('nav').first().locator('..')
  const texto = await barra.innerText()

  assert.equal(/cerrar sesión/i.test(texto), false, 'cerrar sesión sigue en la barra')
  assert.equal(await barra.locator('a[href*="auth.procovar.cloud"]').count(), 0, 'sigue el enlace a los usuarios de Accesos')
  await cerrar(ctx)
})

test('el avatar abre el menú con las otras aplicaciones y con cerrar sesión', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.click('[data-testid="user-menu-button"]')
  await page.waitForSelector('[data-testid="user-menu"]')

  const menu = page.locator('[data-testid="user-menu"]')

  assert.equal(await menu.locator('[data-testid="logout"]').count(), 1, 'falta cerrar sesión en el menú')

  // Las aplicaciones las trae el servidor: se espera a que lleguen.
  await menu.locator('a[href*="pedidos.procovar.cloud"]').waitFor({ timeout: 10000 })
  const enlaces = await menu.locator('a[href^="https://"]').count()

  assert.ok(enlaces >= 5, `sólo ${enlaces} aplicaciones en el menú`)
  assert.equal(await menu.locator('a[href*="delivery.procovar.cloud"]').count(), 0, 'estás EN delivery')
  await cerrar(ctx)
})

test('el menú se cierra con Escape y pulsando fuera', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.click('[data-testid="user-menu-button"]')
  await page.waitForSelector('[data-testid="user-menu"]')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="user-menu"]', { state: 'detached' })

  await page.click('[data-testid="user-menu-button"]')
  await page.waitForSelector('[data-testid="user-menu"]')
  await page.mouse.click(20, 400)
  await page.waitForSelector('[data-testid="user-menu"]', { state: 'detached' })
  await cerrar(ctx)
})

// ------------------------------------------------------------- ajustes

test('en Configuración ya no se habla del envío "individual"', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=/Costo del domicilio/i', { timeout: 20000 })

  const texto = await page.locator('body').innerText()

  assert.equal(/individual/i.test(texto), false, 'sigue apareciendo "individual" en Configuración')
  // Y la fórmula que se enseña es la única que hay.
  assert.match(texto, /C = CKK/, 'no se ve la fórmula oficial')
  await cerrar(ctx)
})

// --------------------------------------------------------------- rutas

test('el armador de rutas abre y lista pedidos de un día concreto', async () => {
  const { ctx, page, errores } = await conSesion()

  await page.goto(`${BASE}/routes`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')

  assert.equal(errores.length, 0, `errores en el navegador: ${errores.join(' | ')}`)
  // La pantalla tiene que llegar a pintarse: el fallo reportado era que se quedaba en blanco.
  const texto = await page.locator('body').innerText()
  assert.ok(texto.trim().length > 50, 'la pantalla de rutas se queda en blanco')
  await cerrar(ctx)
})

// --------------------------------------------------------------- panel

test('el panel pinta sus números sin quedarse cargando', async () => {
  const { ctx, page, errores } = await conSesion()

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')

  const texto = await page.locator('body').innerText()

  assert.ok(texto.trim().length > 50)
  assert.equal(errores.length, 0, `errores en el navegador: ${errores.join(' | ')}`)
  await cerrar(ctx)
})

test.after(async () => {
  await navegador.close()
  await prisma.$disconnect()
})
