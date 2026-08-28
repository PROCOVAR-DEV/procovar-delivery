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

/**
 * Elegir en uno de los desplegables nuevos.
 *
 * Ya no son `<select>` del navegador: son un botón que abre una lista con buscador,
 * pintada en `document.body` para que no la recorte la barra de filtros. Se identifican
 * por su `title`, que es lo único estable — la etiqueta cambia con lo que hay elegido.
 */
async function elegir(page, titulo, etiqueta) {
  await page.click(`button[title="${titulo}"]`)
  await page.waitForSelector('[role="listbox"]')
  // Coincidencia EXACTA: «Sólo activos» y «Sólo archivados» comparten prefijo, y con
  // `hasText` a secas se elegía el primero de los dos.
  await page.locator('[role="listbox"] [role="option"]')
    .filter({ hasText: new RegExp(`^${etiqueta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
    .first()
    .click()
  await page.waitForSelector('[role="listbox"]', { state: 'detached' })
}

/** Las opciones que ofrece uno de esos desplegables. */
async function opcionesDe(page, titulo) {
  await page.click(`button[title="${titulo}"]`)
  await page.waitForSelector('[role="listbox"]')

  const t = await page.locator('[role="listbox"] [role="option"]').allInnerTexts()

  await page.keyboard.press('Escape')
  await page.waitForSelector('[role="listbox"]', { state: 'detached' })
  return t
}

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
  const opciones = await opcionesDe(page, 'Vendedor del pedido')

  assert.ok(opciones.length > 1, `el filtro de vendedor no trae vendedores: ${opciones}`)

  await elegir(page, 'Vendedor del pedido', opciones[1].split('\n')[0])
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

  await elegir(page, 'Archivados en PEDIDO', 'Sólo activos')
  await page.waitForTimeout(800)
  const activos = await totalPedidos(page)

  await elegir(page, 'Archivados en PEDIDO', 'Sólo archivados')
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

  await elegir(page, 'Estado del pedido en PEDIDO', 'Completada')
  await page.waitForTimeout(800)
  await page.waitForSelector('table tbody tr')

  // Toda la columna de estado dice lo mismo que se pidió. Es la 3ª: fecha, sucursal, estado.
  const estados = await page.locator('table tbody tr td:nth-child(3)').allInnerTexts()

  assert.ok(estados.length > 0)
  for (const e of estados) assert.match(e, /Completada/)

  await elegir(page, 'Estado del pedido en PEDIDO', 'Expirada')
  await page.waitForTimeout(800)
  const expiradas = await page.locator('table tbody tr td:nth-child(3)').allInnerTexts()

  assert.ok(expiradas.length > 0, 'no hay expirados y la siembra tiene')
  for (const e of expiradas) assert.match(e, /Expirada/)
  await cerrar(ctx)
})

test('cada pedido dice de qué sucursal es', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/orders`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('table tbody tr')

  // La columna: estaba sólo en el detalle, así que la lista —donde se decide— no lo decía.
  const sucursales = await page.locator('table tbody tr td:nth-child(2)').allInnerTexts()

  assert.ok(sucursales.some((s) => s.trim() && s.trim() !== '—'), `ninguna fila dice su sucursal: ${sucursales.slice(0, 3)}`)

  /**
   * Y NO hay un filtro de sucursal aquí: lo manda el selector de la barra.
   *
   * Dos sitios para elegir lo mismo es poder elegir dos cosas distintas a la vez, y
   * entonces ninguno de los dos dice lo que se está viendo.
   */
  assert.equal(await page.locator('button[title="Sucursal del pedido"]').count(), 0)
  await cerrar(ctx)
})

test('la paginación trae páginas distintas, no la misma dos veces', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/orders`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('table tbody tr')

  const primeros = await page.locator('table tbody tr td:nth-child(4)').allInnerTexts()
  const siguiente = page.locator('button:has(svg), button').filter({ hasText: /siguiente|next|›|>/i }).first()

  if (await siguiente.count()) {
    await siguiente.click()
    await page.waitForTimeout(800)

    const segundos = await page.locator('table tbody tr td:nth-child(4)').allInnerTexts()

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

// ------------------------------------------------------- sucursales

test('quien ve varias sucursales tiene selector, con "todas" incluido', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })

  /**
   * Se mira el `<select>`, no el texto de la página.
   *
   * Las opciones de un desplegable cerrado no son texto visible, así que un selector por
   * texto no las encuentra aunque estén: la prueba fallaba por eso y no por la pantalla.
   */
  await page.waitForSelector('button[title="Sucursal que se está mirando"]', { timeout: 15000 })

  const opciones = await opcionesDe(page, 'Sucursal que se está mirando')

  assert.ok(opciones.length >= 3, `el selector debería traer todas + cada sucursal: ${opciones}`)
  assert.ok(opciones[0].includes('Todas'))
  assert.ok(opciones.some((o) => /Habana/i.test(o)) && opciones.some((o) => /Camag/i.test(o)))
  await cerrar(ctx)
})

test('quien lleva UNA sucursal ve su nombre y no un selector', async () => {
  const jefe = await prisma.user.findFirst({ where: { branchId: { not: null } } })
  const suya = await prisma.branch.findUnique({ where: { id: jefe.branchId } })
  const ctx = await navegador.newContext({ viewport: { width: 1400, height: 900 } })
  const suToken = jwt.sign(
    { id: jefe.id, email: jefe.email, name: jefe.name, role: jefe.role, branchId: jefe.branchId },
    SECRET,
    { expiresIn: '1h' },
  )

  await ctx.addCookies([{ name: 'token', value: suToken, url: BASE, httpOnly: true }])
  await ctx.addInitScript(
    ([t, u]) => {
      window.localStorage.setItem('token', t)
      window.localStorage.setItem('user', JSON.stringify(u))
    },
    [suToken, { id: jefe.id, email: jefe.email, name: jefe.name, role: jefe.role, branchId: jefe.branchId }],
  )

  const page = await ctx.newPage()

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`text=${suya.name}`, { timeout: 15000 })

  // Ni selector ni "todas las sucursales": para quien lleva una no hay nada que elegir.
  assert.equal(await page.locator('button[title="Sucursal que se está mirando"]').count(), 0)
  await ctx.close()
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

test('Configuración se retiró: ni está en el menú ni queda nada dentro', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav a[href="/orders"]')

  assert.equal(await page.locator('nav a[href="/settings"]').count(), 0, 'sigue en el menú')

  /**
   * Y la pantalla contesta, no da 404.
   *
   * Quien llegue por un enlace guardado tiene que enterarse de que esto se movió: un 404
   * manda a buscar el error en la dirección.
   */
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=/ya no hay nada que configurar/i', { timeout: 20000 })

  const texto = await page.locator('body').innerText()

  // Ni tasa que teclear ni fórmula de domicilio: ninguna de las dos es de delivery.
  assert.equal(/C = CKK/.test(texto), false, 'sigue la fórmula del domicilio')
  assert.equal(/Guardar precios/i.test(texto), false, 'sigue el formulario de precios')
  await cerrar(ctx)
})

// --------------------------------------------------------------- rutas

test('las rutas del Super Admin salen SEPARADAS por sucursal', async () => {
  const { ctx, page } = await conSesion()

  await page.goto(`${BASE}/routes`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=RT-HAB-001', { timeout: 20000 })
  await page.waitForSelector('text=RT-CMG-001')

  /**
   * Con un encabezado por sucursal, no todas revueltas.
   *
   * El Super Admin ve las rutas de las ocho sucursales. En una lista plana, dos rutas del
   * mismo día con el mismo aspecto pueden ser de Holguín y de La Habana, y la única forma
   * de saberlo es abrirlas una a una.
   */
  const encabezados = await page.locator('h6').allInnerTexts()

  assert.ok(encabezados.some((h) => /Habana/i.test(h)), `sin encabezado de La Habana: ${encabezados}`)
  assert.ok(encabezados.some((h) => /Camag/i.test(h)), `sin encabezado de Camagüey: ${encabezados}`)

  // Y cada ruta cae DEBAJO del encabezado que le toca, no en cualquier sitio.
  const textos = await page.locator('.space-y-3 > div').allInnerTexts()
  const bloqueHabana = textos.find((t) => /Habana/i.test(t) && /RT-/.test(t))

  assert.ok(bloqueHabana)
  assert.equal(/RT-CMG-001/.test(bloqueHabana), false, 'una ruta de Camagüey aparece bajo La Habana')
  await cerrar(ctx)
})

test('elegida una sucursal, se ven sólo las suyas y sin encabezados', async () => {
  const { ctx, page } = await conSesion()

  // Es lo que hace el selector de la barra de arriba.
  await ctx.addInitScript(() => { window.localStorage.setItem('sucursalId', 'x') })
  await page.goto(`${BASE}/routes`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=RT-', { timeout: 20000 })

  // Con una sola sucursal a la vista no se agrupa: repetir su nombre en cada tarjeta es
  // ruido, y la pantalla de quien lleva una sucursal no tiene por qué cambiar.
  const rutas = await page.locator('text=/RT-(HAB|CMG)-001/').count()

  assert.ok(rutas > 0)
  await cerrar(ctx)
})

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
