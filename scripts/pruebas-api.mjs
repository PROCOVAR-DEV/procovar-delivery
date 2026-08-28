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
  const r = await pedir('/api/orders')

  assert.equal(r.status, 200)
  assert.ok(Array.isArray(r.json))
  assert.ok(r.json.length > 0, 'la siembra tiene pedidos')
  for (const o of r.json) {
    assert.equal(o.meta, undefined, `el pedido ${o.operationNumber} sigue mandando meta`)
  }
})

test('de `meta` sí salen el municipio y el vendedor, que son los que se filtran', async () => {
  const r = await pedir('/api/orders')
  const conVendedor = r.json.filter((o) => o.vendedor)

  assert.ok(conVendedor.length > 0, 'el vendedor tiene que llegar a la pantalla')
  assert.ok(r.json.some((o) => o.municipio), 'el municipio también')
})

test('la lista trae la fecha del PEDIDO, no sólo la de copiado', async () => {
  const r = await pedir('/api/orders')
  const conFecha = r.json.filter((o) => o.orderDate)

  assert.ok(conFecha.length > 0)
  // La siembra crea todos los pedidos AHORA con fechas de días distintos: si `orderDate`
  // fuera la de copiado, todas serían la de hoy.
  const dias = new Set(conFecha.map((o) => soloFecha(o.orderDate)))
  assert.ok(dias.size > 3, `se esperaban pedidos de varios días, llegaron ${dias.size}`)
})

test('la lista viene ordenada por la fecha del pedido, de más nuevo a más viejo', async () => {
  const r = await pedir('/api/orders')
  const fechas = r.json.map((o) => new Date(o.orderDate || o.createdAt).getTime())

  for (let i = 1; i < fechas.length; i++) {
    assert.ok(fechas[i - 1] >= fechas[i], `fuera de orden en la posición ${i}`)
  }
})

test('la respuesta tiene un tamaño razonable: ya no se manda el pedido entero', async () => {
  const r = await pedir('/api/orders')
  const porPedido = r.bytes / r.json.length

  // Con `meta` dentro eran varios KB por fila (pedido + cliente + vendedor + gestor).
  assert.ok(porPedido < 1500, `${Math.round(porPedido)} B por pedido: alguien volvió a meter el payload entero`)
})

test('el alcance por sucursal no deja ver los pedidos de otra', async () => {
  const suyos = await pedir('/api/orders', { token: TOKEN_JEFE })

  assert.equal(suyos.status, 200)
  assert.ok(suyos.json.length > 0, 'el jefe de Camagüey tiene pedidos')
  for (const o of suyos.json) {
    assert.equal(o.branch?.id, camaguey.id, 'se coló un pedido de otra sucursal')
  }
})

test('el alta manual de pedidos está retirada, y lo dice', async () => {
  const r = await pedir('/api/orders', {
    metodo: 'POST',
    cuerpo: { customerName: 'A mano', address: 'Calle falsa' },
  })

  assert.equal(r.status, 410)
  assert.match(r.json.error, /delivery-apk|PEDIDO/)
})

test('el cotizador individual está retirado: queda UNA fórmula', async () => {
  const r = await pedir('/api/quote', { metodo: 'POST', cuerpo: {} })

  assert.equal(r.status, 410)
  assert.match(r.json.error, /batch/)
})

// -------------------------------------------------- pedidos para armar ruta

test('el filtro por día usa la fecha del pedido: pedir otro día YA no da cero', async () => {
  const orders = (await pedir('/api/orders')).json
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

test.after(() => prisma.$disconnect())
