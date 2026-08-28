/**
 * Pruebas de la API contra una instancia DE VERDAD, con su base detrás.
 *
 * Las pruebas de `tests/` comprueban el cálculo; esto comprueba lo otro: que el endpoint
 * conteste, que el alcance por sucursal no deje pasar lo que no es tuyo, que la lista no
 * se traiga el mundo entero y que lo retirado esté retirado. Es donde salen los fallos
 * que no son de lógica sino de cableado, que son los que llegaron a producción.
 *
 * Uso:
 *   BASE=http://localhost:3399 JWT_SECRET=... DATABASE_URL=... node scripts/pruebas-api.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://localhost:3399'
const SECRET = process.env.JWT_SECRET
if (!SECRET) throw new Error('Falta JWT_SECRET: es con lo que se firma la sesión de prueba.')

const prisma = new PrismaClient()

const admin = await prisma.user.findFirst({ where: { branchId: null }, orderBy: { createdAt: 'asc' } })
const jefe = await prisma.user.findFirst({ where: { branchId: { not: null } } })
const habana = await prisma.branch.findUnique({ where: { externalId: 'HAB' } })
const camaguey = await prisma.branch.findUnique({ where: { externalId: 'CMG' } })

if (!admin || !jefe || !habana || !camaguey) {
  throw new Error('Falta la siembra: corré antes `node scripts/sembrar-pruebas.mjs`.')
}

/** El token es el mismo que emite el login: se firma igual y lleva los mismos campos. */
const tokenDe = (u) =>
  jwt.sign({ id: u.id, email: u.email, name: u.name, role: u.role, branchId: u.branchId }, SECRET, {
    expiresIn: '1h',
  })

const TOKEN_ADMIN = tokenDe(admin)
const TOKEN_JEFE = tokenDe(jefe)

async function pedir(ruta, { token = TOKEN_ADMIN, metodo = 'GET', cuerpo, cabeceras = {} } = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...cabeceras,
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  const texto = await res.text()
  let json = null
  try { json = JSON.parse(texto) } catch { /* no era JSON */ }
  return { status: res.status, json, texto, bytes: Buffer.byteLength(texto) }
}

const soloFecha = (d) => new Date(d).toISOString().slice(0, 10)

/** La lista de pedidos ahora viene paginada: `{ orders, total, pagina, paginas }`. */
const listaPedidos = async (query = '', opciones = {}) =>
  (await pedir(`/api/orders${query ? `?${query}` : ''}`, opciones))

// ---------------------------------------------------------------- sesión

test('sin sesión, todo contesta 401 y no filtra nada', async () => {
  for (const ruta of ['/api/orders', '/api/customers', '/api/dashboard', '/api/apps', '/api/orders/available']) {
    const r = await pedir(ruta, { token: null })
    assert.equal(r.status, 401, `${ruta} debería exigir sesión`)
  }
})

test('un token firmado con otro secreto no vale', async () => {
  const falso = jwt.sign({ id: admin.id, email: admin.email, name: admin.name, role: 'admin' }, 'otro-secreto')
  const r = await pedir('/api/orders', { token: falso })

  assert.equal(r.status, 401)
})

// ---------------------------------------------------------------- pedidos

test('la lista de pedidos NO devuelve `meta`, que era lo que la hacía impagable', async () => {
  const r = await listaPedidos()

  assert.equal(r.status, 200)
  assert.ok(Array.isArray(r.json.orders))
  assert.ok(r.json.orders.length > 0, 'la siembra tiene pedidos')
  for (const o of r.json.orders) {
    assert.equal(o.meta, undefined, `el pedido ${o.operationNumber} sigue mandando meta`)
  }
})

test('la lista viene PAGINADA, con el total de verdad', async () => {
  const r = await listaPedidos('porPagina=10')

  assert.equal(r.json.orders.length, 10, 'la página tiene que respetar el tamaño pedido')
  assert.ok(r.json.total > 10, 'y el total tiene que ser el del catálogo, no el de la página')
  assert.equal(r.json.paginas, Math.ceil(r.json.total / 10))

  // La segunda página trae pedidos DISTINTOS: si el `skip` no se aplicara, serían los mismos.
  const dos = await listaPedidos('porPagina=10&pagina=2')
  const primeros = new Set(r.json.orders.map((o) => o.id))

  assert.equal(dos.json.orders.some((o) => primeros.has(o.id)), false, 'la página 2 repite pedidos de la 1')
})

test('el catálogo trae los ARCHIVADOS: ahí está casi todo el histórico', async () => {
  const todos = await listaPedidos('porPagina=200')
  const archivados = todos.json.orders.filter((o) => o.archivado)

  assert.ok(archivados.length > 0, 'sin archivados no hay catálogo: en producción son 51.871 de 56.208')

  const soloActivos = await listaPedidos('archivado=0&porPagina=200')

  assert.ok(soloActivos.json.total < todos.json.total)
  assert.equal(soloActivos.json.orders.every((o) => o.archivado === false), true)

  const soloArchivados = await listaPedidos('archivado=1&porPagina=200')

  assert.equal(soloArchivados.json.orders.every((o) => o.archivado === true), true)
  assert.equal(soloArchivados.json.total + soloActivos.json.total, todos.json.total)
})

test('el filtro por estado distingue completada, en proceso y expirada', async () => {
  const completadas = await listaPedidos('estado=completada&porPagina=200')

  assert.ok(completadas.json.total > 0)
  assert.equal(completadas.json.orders.every((o) => o.estado === 'completada'), true)

  // «Expirada» no es una columna: es que la fecha comprometida pasó y no se completó.
  const expiradas = await listaPedidos('estado=expirada&porPagina=200')

  assert.ok(expiradas.json.total > 0, 'la siembra tiene pedidos con la fecha comprometida pasada')
  for (const o of expiradas.json.orders) {
    assert.notEqual(o.estado, 'completada')
    assert.ok(new Date(o.fechaComprometida) < new Date(), `${o.operationNumber} no está expirado`)
  }

  const enProceso = await listaPedidos('estado=en_proceso&porPagina=200')

  assert.equal(enProceso.json.orders.some((o) => o.estado === 'completada'), false)
  // Los tres son excluyentes y cubren todo lo que tiene estado.
  assert.equal(
    completadas.json.total + expiradas.json.total + enProceso.json.total,
    (await listaPedidos('porPagina=1')).json.total,
    'los tres estados tienen que sumar el catálogo entero',
  )
})

test('se puede filtrar por domicilio y por si la APK ya lo cotizó', async () => {
  const conDom = await listaPedidos('domicilio=1&porPagina=200')
  const sinDom = await listaPedidos('domicilio=0&porPagina=200')

  assert.ok(conDom.json.total > 0 && sinDom.json.total > 0)
  assert.equal(conDom.json.orders.every((o) => o.requiereDomicilio === true), true)
  assert.equal(sinDom.json.orders.some((o) => o.requiereDomicilio === true), false)

  const cotizados = await listaPedidos('cotizado=1&porPagina=200')

  assert.ok(cotizados.json.total > 0)
  assert.equal(cotizados.json.orders.every((o) => o.pedidoCosto != null), true)
})

test('se puede filtrar por municipio y por vendedor, con lo que existe de verdad', async () => {
  const f = await pedir('/api/orders/facetas')

  assert.equal(f.status, 200)
  assert.ok(f.json.municipios.length > 0 && f.json.vendedores.length > 0)

  const m = f.json.municipios[0]
  const r = await listaPedidos(`municipio=${encodeURIComponent(m.valor)}&porPagina=200`)

  assert.equal(r.json.total, m.pedidos, 'el conteo de la faceta tiene que cuadrar con el filtro')
  assert.equal(r.json.orders.every((o) => o.municipio === m.valor), true)

  const v = f.json.vendedores[0]
  const rv = await listaPedidos(`vendedor=${encodeURIComponent(v.valor)}&porPagina=200`)

  assert.equal(rv.json.total, v.pedidos)
})

test('la búsqueda mira folio, cliente, dirección, municipio y vendedor', async () => {
  const uno = (await listaPedidos('porPagina=1')).json.orders[0]

  const porFolio = await listaPedidos(`q=${encodeURIComponent(uno.operationNumber)}`)
  assert.ok(porFolio.json.orders.some((o) => o.id === uno.id), 'no se encuentra por su folio')

  const porCliente = await listaPedidos(`q=${encodeURIComponent(uno.customerName.slice(0, 6))}`)
  assert.ok(porCliente.json.total > 0)
})

test('los filtros se combinan sin pisarse', async () => {
  const combinado = await listaPedidos('estado=completada&archivado=1&domicilio=1&porPagina=200')

  for (const o of combinado.json.orders) {
    assert.equal(o.estado, 'completada')
    assert.equal(o.archivado, true)
    assert.equal(o.requiereDomicilio, true)
  }
  // Y no puede dar más que el más restrictivo de ellos por separado.
  const soloEstado = await listaPedidos('estado=completada&porPagina=1')
  assert.ok(combinado.json.total <= soloEstado.json.total)
})

test('el municipio y el vendedor llegan como columnas, no dentro de `meta`', async () => {
  const r = await listaPedidos('porPagina=200')

  assert.ok(r.json.orders.some((o) => o.vendedor), 'el vendedor tiene que llegar a la pantalla')
  assert.ok(r.json.orders.some((o) => o.municipio), 'el municipio también')
})

test('la lista trae la fecha del PEDIDO, no sólo la de copiado', async () => {
  const r = await listaPedidos('porPagina=200')
  const conFecha = r.json.orders.filter((o) => o.orderDate)

  assert.ok(conFecha.length > 0)
  // La siembra crea todos los pedidos AHORA con fechas de días distintos: si `orderDate`
  // fuera la de copiado, todas serían la de hoy.
  const dias = new Set(conFecha.map((o) => soloFecha(o.orderDate)))
  assert.ok(dias.size > 3, `se esperaban pedidos de varios días, llegaron ${dias.size}`)
})

test('la lista viene ordenada por la fecha del pedido, y los sin fecha AL FINAL', async () => {
  const r = await listaPedidos('porPagina=200')
  const conFecha = r.json.orders.filter((o) => o.orderDate)
  const sinFecha = r.json.orders.filter((o) => !o.orderDate)

  const fechas = conFecha.map((o) => new Date(o.orderDate).getTime())

  for (let i = 1; i < fechas.length; i++) {
    assert.ok(fechas[i - 1] >= fechas[i], `fuera de orden en la posición ${i}`)
  }

  /**
   * Los que no tienen fecha van al final, no al principio.
   *
   * En Postgres un nulo en un DESC va PRIMERO: sin decir nada, los pedidos viejos —los
   * que entraron antes de que se guardara la fecha— se plantaban en lo alto de la primera
   * página, delante de los de hoy. Y con la paginación en el servidor eso no se puede
   * arreglar reordenando después: la página ya viene elegida.
   */
  if (sinFecha.length && conFecha.length) {
    const posiciones = r.json.orders.map((o, i) => (o.orderDate ? -1 : i)).filter((i) => i >= 0)
    const ultimoConFecha = r.json.orders.map((o, i) => (o.orderDate ? i : -1)).filter((i) => i >= 0).pop()

    assert.ok(Math.min(...posiciones) > ultimoConFecha, 'los pedidos sin fecha no están al final')
  }
})

test('la respuesta tiene un tamaño razonable: ya no se manda el pedido entero', async () => {
  const r = await listaPedidos('porPagina=200')
  const porPedido = r.bytes / r.json.orders.length

  // Con `meta` dentro eran varios KB por fila (pedido + cliente + vendedor + gestor).
  assert.ok(porPedido < 1500, `${Math.round(porPedido)} B por pedido: alguien volvió a meter el payload entero`)
})

test('el alcance por sucursal no deja ver los pedidos de otra', async () => {
  const suyos = await listaPedidos('porPagina=200', { token: TOKEN_JEFE })

  assert.equal(suyos.status, 200)
  assert.ok(suyos.json.orders.length > 0, 'el jefe de Camagüey tiene pedidos')
  for (const o of suyos.json.orders) {
    assert.equal(o.branch?.id, camaguey.id, 'se coló un pedido de otra sucursal')
  }
})

test('el alta manual de pedidos está retirada, y lo dice', async () => {
  const r = await pedir('/api/orders', {
    metodo: 'POST',
    cuerpo: { customerName: 'A mano', address: 'Calle falsa' },
  })

  assert.equal(r.status, 410)
  assert.match(r.json.error, /Entrega|PEDIDO/)
})

test('el cotizador individual está retirado: queda UNA fórmula', async () => {
  const r = await pedir('/api/quote', { metodo: 'POST', cuerpo: {} })

  assert.equal(r.status, 410)
  assert.match(r.json.error, /batch/)
})

// -------------------------------------------------- pedidos para armar ruta

test('el filtro por día usa la fecha del pedido: pedir otro día YA no da cero', async () => {
  const orders = (await listaPedidos('porPagina=200')).json.orders
  const conFecha = orders.filter((o) => o.orderDate && o.branch?.id === habana.id)
  // Un día que NO es hoy y que sí tiene pedidos sembrados.
  const hoy = soloFecha(new Date())
  const otroDia = conFecha.map((o) => soloFecha(o.orderDate)).find((d) => d !== hoy)

  assert.ok(otroDia, 'la siembra tiene pedidos de días distintos de hoy')

  const r = await pedir(`/api/orders/available?fecha=${otroDia}&branchId=${habana.id}`)

  assert.equal(r.status, 200)
  const lista = r.json.orders ?? r.json
  assert.ok(Array.isArray(lista))
  assert.ok(lista.length > 0, `pedir el día ${otroDia} devolvió cero: se está filtrando por la fecha de copiado`)
  for (const o of lista) {
    assert.equal(soloFecha(o.orderDate), otroDia)
  }
})

test('un día sin pedidos devuelve una lista vacía, no un error', async () => {
  const r = await pedir(`/api/orders/available?fecha=2020-01-01&branchId=${habana.id}`)

  assert.equal(r.status, 200)
  const lista = r.json.orders ?? r.json
  assert.equal(lista.length, 0)
})

test('pedir la sucursal de otro no amplía el alcance', async () => {
  const r = await pedir(`/api/orders/available?branchId=${habana.id}`, { token: TOKEN_JEFE })

  assert.equal(r.status, 200)
  const lista = r.json.orders ?? r.json
  // El jefe de Camagüey pidiendo La Habana no ve pedidos de La Habana.
  assert.equal(lista.filter((o) => o.customerName?.includes('Cliente Camagüey')).length, lista.length)
})

// ---------------------------------------------------------------- clientes

test('los clientes se buscan en la base: uno del final de la lista aparece', async () => {
  const todos = await pedir('/api/customers')

  assert.equal(todos.status, 200)
  assert.ok(todos.json.total > todos.json.customers.length, 'la siembra tiene más clientes que el tope')
  assert.equal(todos.json.truncated, true, 'y la pantalla tiene que saberlo')

  // Un cliente que por orden alfabético cae MUY por detrás del tope de 500.
  const ultimo = await prisma.customer.findFirst({ orderBy: { name: 'desc' } })
  const r = await pedir(`/api/customers?q=${encodeURIComponent(ultimo.name)}`)

  assert.equal(r.status, 200)
  assert.ok(
    r.json.customers.some((c) => c.name === ultimo.name),
    `"${ultimo.name}" no aparece buscándolo: se sigue filtrando en memoria después de cortar`,
  )
})

test('la búsqueda no distingue mayúsculas y mira también dirección y municipio', async () => {
  const porMunicipio = await pedir('/api/customers?q=playa')
  assert.ok(porMunicipio.json.customers.length > 0)
  assert.ok(porMunicipio.json.customers.every((c) => /playa/i.test(`${c.municipio} ${c.address} ${c.name}`)))

  const porDireccion = await pedir('/api/customers?q=Calle%2012')
  assert.ok(porDireccion.json.customers.length > 0)
})

test('todos los clientes que llegan tienen geolocalización', async () => {
  const r = await pedir('/api/customers')

  for (const c of r.json.customers) {
    assert.equal(typeof c.lat, 'number')
    assert.equal(typeof c.lng, 'number')
  }
})

test('el jefe de una sucursal no ve los clientes de la otra', async () => {
  const r = await pedir('/api/customers', { token: TOKEN_JEFE })

  assert.equal(r.status, 200)
  for (const c of r.json.customers) {
    assert.ok(
      c.sucursalCodigo === 'CMG' || c.sucursalCodigo == null,
      `se coló un cliente de ${c.sucursalCodigo}`,
    )
  }
})

// ---------------------------------------------------- menú de aplicaciones

test('el menú de aplicaciones lo decide el servidor y no incluye delivery', async () => {
  const r = await pedir('/api/apps')

  assert.equal(r.status, 200)
  assert.ok(r.json.apps.length > 0)
  assert.equal(r.json.apps.some((a) => /delivery\.procovar/.test(a.href)), false, 'estás EN delivery')
  for (const a of r.json.apps) {
    assert.match(a.href, /^https:\/\//)
    assert.ok(a.title && a.icon && a.description)
    assert.equal(a.soloAdmin, undefined, 'no se filtra en el navegador: la bandera no debe salir')
  }
})

test('Accesos sólo se le ofrece a quien administra de verdad', async () => {
  const global = await pedir('/api/apps')
  const deSucursal = await pedir('/api/apps', { token: TOKEN_JEFE })

  assert.ok(global.json.apps.some((a) => /auth\.procovar/.test(a.href)))
  assert.equal(
    deSucursal.json.apps.some((a) => /auth\.procovar/.test(a.href)),
    false,
    'un admin de UNA sucursal no administra las cuentas de la empresa',
  )
})

// ---------------------------------------------------------------- panel

test('el panel cuenta los pedidos de la sucursal, no los de la cuenta', async () => {
  const r = await pedir('/api/dashboard')

  assert.equal(r.status, 200)
  assert.ok(r.json.totalOrders > 0, 'una cuenta nueva veía cero aunque su sucursal tuviera miles')
  assert.equal(typeof r.json.pesoPendiente, 'number')
})

// ------------------------------------------------- cotización por lotes

test('el lote usa el peso que manda PEDIDO y no llama al almacén', async () => {
  const key = process.env.SERVICE_API_KEY

  // Sin la clave —o con una que no es la del servidor— esto no se puede probar. Se avisa
  // y se sale: un `return` mudo hace creer que la prueba pasó.
  if (!key) {
    console.log('# (saltada: falta SERVICE_API_KEY, la MISMA con la que arrancó delivery)')
    return
  }

  const r = await pedir('/api/quote/batch', {
    token: null,
    metodo: 'POST',
    cabeceras: { 'x-api-key': key },
    cuerpo: {
      preview: true,
      orders: [
        {
          sucursalExternalId: 'HAB',
          customerName: 'Prueba',
          lat: 23.12, lng: -82.38,
          requiereDomicilio: true,
          items: [{ name: 'LO QUE SEA', packs: 4, quantity: 24, pesoKg: 3.2, pesoLineaKg: 12.8 }],
        },
      ],
    },
  })

  assert.equal(r.status, 200)
  assert.equal(r.json.weightsSource, 'pedido', 'con todos los pesos puestos no hay que ir al almacén')
  assert.equal(r.json.results[0].weightKg, 12.8)
})

// ---------------------------------------------------------------- rutas

test('una ruta se arma con los pedidos ya importados y suma SU peso', async () => {
  // El camino bueno: se eligen pedidos de la lista, no se re-teclea nada. Ya traen
  // ubicación, peso y costo de domicilio.
  const disponibles = await pedir(`/api/orders/available?branchId=${habana.id}`)
  const lista = (disponibles.json.orders ?? disponibles.json).slice(0, 3)

  assert.ok(lista.length >= 2, 'hacen falta pedidos sin ruta para armar una')

  const vehiculo = await prisma.vehicle.findFirst({ where: { branchId: habana.id } })
  const r = await pedir('/api/routes', {
    metodo: 'POST',
    cuerpo: {
      name: 'Ruta de prueba',
      vehicleId: vehiculo.id,
      originAddress: 'Almacén Habana',
      originLat: habana.lat,
      originLng: habana.lng,
      deliveryDate: new Date().toISOString(),
      branchId: habana.id,
      orderIds: lista.map((o) => o.id),
    },
  })

  assert.ok(r.status === 200 || r.status === 201, `la ruta no se creó: ${r.status} ${r.texto.slice(0, 200)}`)

  const ruta = await prisma.route.findFirst({
    where: { name: 'Ruta de prueba' },
    include: { orders: true },
    orderBy: { createdAt: 'desc' },
  })

  assert.ok(ruta, 'la ruta no quedó en la base')
  assert.equal(ruta.orders.length, lista.length, 'no se engancharon todos los pedidos')
  assert.equal(ruta.branchId, habana.id, 'la ruta tiene que ser de una sucursal')

  // El peso de la ruta es el de los pedidos, que a su vez es el que mandó PEDIDO. Si
  // esto sale en 1 kg por pedido es que se cayó al respaldo y la capacidad del camión se
  // está calculando con un número inventado.
  const esperado = lista.reduce((a, o) => a + (o.weight || 0), 0)

  assert.ok(Math.abs(ruta.totalWeight - esperado) < 0.01, `peso de la ruta ${ruta.totalWeight}, esperado ${esperado}`)
  assert.ok(ruta.totalDistance > 0, 'una ruta sin distancia no se ha calculado')
  assert.ok(ruta.routeCode, 'la ruta necesita su código: es como la nombra todo el mundo')
})

test('los pedidos que ya están en una ruta salen de la lista de disponibles', async () => {
  const ruta = await prisma.route.findFirst({ where: { name: 'Ruta de prueba' }, include: { orders: true } })
  const enRuta = new Set(ruta.orders.map((o) => o.id))
  const r = await pedir(`/api/orders/available?branchId=${habana.id}`)
  const lista = r.json.orders ?? r.json

  for (const o of lista) {
    assert.equal(enRuta.has(o.id), false, `${o.operationNumber} ya está en una ruta y sigue ofreciéndose`)
  }
})

test('no se arma una ruta que no cabe en el camión', async () => {
  const chico = await prisma.vehicle.create({
    data: { name: 'Moto', type: 'moto', capacity: 1, costoKmUsd: 0.1, userId: admin.id, branchId: habana.id },
  })
  const disponibles = await pedir(`/api/orders/available?branchId=${habana.id}`)
  const lista = (disponibles.json.orders ?? disponibles.json).filter((o) => (o.weight || 0) > 1).slice(0, 2)

  if (!lista.length) return // sin pedidos que pesen, no hay nada que comprobar

  const r = await pedir('/api/routes', {
    metodo: 'POST',
    cuerpo: {
      name: 'Ruta que no cabe',
      vehicleId: chico.id,
      originAddress: 'Almacén Habana',
      originLat: habana.lat, originLng: habana.lng,
      branchId: habana.id,
      orderIds: lista.map((o) => o.id),
    },
  })

  assert.equal(r.status, 400, 'metió en una moto lo que no cabe')
  assert.match(r.json.error, /capacidad|peso/i)
  await prisma.vehicle.delete({ where: { id: chico.id } })
})

test('cada ruta dice de qué sucursal es', async () => {
  const r = await pedir('/api/routes')

  assert.equal(r.status, 200)
  assert.ok(r.json.length > 0, 'la siembra tiene rutas')

  // Sin esto, el Super Admin ve las rutas de las ocho sucursales en una sola lista y no
  // hay forma de distinguirlas más que abriéndolas una a una.
  for (const ruta of r.json) {
    assert.ok(ruta.branch?.id, `la ruta ${ruta.routeCode} no dice de qué sucursal es`)
    assert.ok(ruta.branch?.name)
  }

  // Y el Super Admin las ve de MÁS de una sucursal: es el caso que había que separar.
  const sucursales = new Set(r.json.map((x) => x.branch?.id))

  assert.ok(sucursales.size > 1, 'el Super Admin debería ver rutas de varias sucursales')
})

test('quien lleva una sucursal sólo ve las rutas de la suya', async () => {
  const r = await pedir('/api/routes', { token: TOKEN_JEFE })

  assert.equal(r.status, 200)
  assert.ok(r.json.length > 0)
  for (const ruta of r.json) {
    assert.equal(ruta.branch?.id, camaguey.id, `se coló una ruta de ${ruta.branch?.name}`)
  }
})

test('el selector de sucursal acota las rutas del Super Admin', async () => {
  // Es el header que pone el selector de la barra de arriba.
  const soloHabana = await pedir('/api/routes', { cabeceras: { 'x-sucursal-id': habana.id } })

  assert.equal(soloHabana.status, 200)
  assert.ok(soloHabana.json.length > 0)
  for (const ruta of soloHabana.json) {
    assert.equal(ruta.branch?.id, habana.id)
  }
})

// -------------------------------------------------------------- sucursales

test('las sucursales se ven aunque las creara OTRA cuenta', async () => {
  /**
   * El fallo que dejó la aplicación entera vacía en producción.
   *
   * Esto filtraba por `creatorId: user.id` —«las que creó este usuario»—. Las ocho
   * sucursales las creó una cuenta, y quien entra por el login único es OTRA fila de
   * `User`: recibía una lista vacía. Sin sucursales no hay selector, el asistente de
   * nueva ruta no tiene nada que elegir, y no se puede crear ni una ruta.
   */
  const otra = await prisma.user.create({
    data: { email: `nadie-${Date.now()}@procovar.test`, password: 'x', name: 'Recién llegada', role: 'admin' },
  })
  const r = await pedir('/api/branches', { token: tokenDe(otra) })

  assert.equal(r.status, 200)
  assert.ok(r.json.length >= 2, 'una cuenta que no creó ninguna sucursal las tiene que ver igual')

  await prisma.user.delete({ where: { id: otra.id } })
})

test('quien lleva una sucursal ve SÓLO la suya', async () => {
  const r = await pedir('/api/branches', { token: TOKEN_JEFE })

  assert.equal(r.status, 200)
  assert.equal(r.json.length, 1)
  assert.equal(r.json[0].id, camaguey.id)
})

test('los pedidos se pueden filtrar por sucursal, y el conteo cuadra', async () => {
  const f = await pedir('/api/orders/facetas')

  assert.ok(Array.isArray(f.json.sucursales), 'faltan las sucursales en las facetas')
  assert.ok(f.json.sucursales.length > 1, 'la siembra tiene pedidos en dos sucursales')

  const s = f.json.sucursales[0]
  const r = await listaPedidos(`branchId=${s.valor}&porPagina=200`)

  assert.equal(r.json.total, s.pedidos, 'el conteo de la faceta no cuadra con el filtro')
  assert.equal(r.json.orders.every((o) => o.branch?.id === s.valor), true)
})

test('pedir la sucursal de otro no amplía lo que se ve', async () => {
  // El filtro se combina con el alcance: el AND de los dos no deja pasar nada.
  const r = await listaPedidos(`branchId=${habana.id}&porPagina=200`, { token: TOKEN_JEFE })

  assert.equal(r.status, 200)
  assert.equal(r.json.total, 0)
})

test('los clientes se filtran por sucursal y por municipio', async () => {
  const todos = await pedir('/api/customers')

  assert.ok(Array.isArray(todos.json.municipios) && todos.json.municipios.length > 0)
  assert.ok(Array.isArray(todos.json.sucursales) && todos.json.sucursales.length > 0)

  const m = todos.json.municipios[0]
  const r = await pedir(`/api/customers?municipio=${encodeURIComponent(m.valor)}`)

  assert.equal(r.json.total, m.clientes)
  assert.equal(r.json.customers.every((c) => c.municipio === m.valor), true)
})

test('los clientes vienen paginados: la página 2 no repite la 1', async () => {
  const una = await pedir('/api/customers?pagina=1')
  const dos = await pedir('/api/customers?pagina=2')

  assert.ok(una.json.paginas > 1, 'la siembra tiene más clientes que una página')

  const primeros = new Set(una.json.customers.map((c) => c.id))

  assert.equal(dos.json.customers.some((c) => primeros.has(c.id)), false)
})

test('una sucursal que ya NO existe no deja la aplicación vacía', async () => {
  /**
   * El fallo que se vio en producción, por los dos caminos por los que llega.
   *
   * El id de sucursal viaja en el token del login único —que dura siete días y lleva la
   * que tenía la persona cuando entró— y en la cabecera `x-sucursal-id` que guarda el
   * navegador. Las sucursales se recrearon en algún momento, así que los dos pueden
   * apuntar a algo que ya no está. Y filtrar por un id inexistente no da error: da CERO
   * pedidos, CERO clientes y CERO sucursales, con lo que desaparece hasta el selector con
   * el que se podría arreglar.
   */
  const fantasma = 'sucursal-que-ya-no-existe'

  // 1) En el TOKEN.
  const conTokenViejo = tokenDe({ ...admin, branchId: fantasma })
  const b = await pedir('/api/branches', { token: conTokenViejo })

  assert.equal(b.status, 200)
  assert.ok(b.json.length > 1, 'sin sucursales no hay selector con el que arreglarlo')

  const o = await listaPedidos('porPagina=1', { token: conTokenViejo })

  assert.ok(o.json.total > 0, 'un token con una sucursal muerta deja la aplicación en cero')

  // 2) En la CABECERA que guarda el navegador.
  const conCabecera = await listaPedidos('porPagina=1', { cabeceras: { 'x-sucursal-id': fantasma } })

  assert.ok(conCabecera.json.total > 0)
})

test('pero una sucursal que SÍ existe sigue acotando', async () => {
  // El arreglo no puede convertirse en "el filtro de sucursal ya no filtra".
  const r = await listaPedidos('porPagina=200', { cabeceras: { 'x-sucursal-id': camaguey.id } })

  assert.ok(r.json.total > 0)
  assert.equal(r.json.orders.every((o) => o.branch?.id === camaguey.id), true)
})

test.after(() => prisma.$disconnect())
