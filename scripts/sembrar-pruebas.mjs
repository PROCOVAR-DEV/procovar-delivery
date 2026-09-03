/**
 * Datos de mentira para probar delivery de verdad.
 *
 * Lo que se siembra no es "unos cuantos pedidos": es la forma exacta de lo que llega de
 * PEDIDO, incluidos los casos que rompieron algo alguna vez —pedidos de días distintos,
 * líneas con el peso ya resuelto y líneas sin él, clientes más allá del tope de la
 * pantalla— para que las pruebas los pisen.
 *
 * Uso:  DATABASE_URL=... node scripts/sembrar-pruebas.mjs
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const DIA = 86400000
const hoy = new Date()

hoy.setHours(12, 0, 0, 0)

const diaMenos = (n) => new Date(hoy.getTime() - n * DIA)

/** El día en formato YYYY-MM-DD, que es como lo manda la pantalla en los filtros. */
export const comoFecha = (d) => d.toISOString().slice(0, 10)

async function main() {
  // Se vacía primero: una siembra a medias encima de otra da resultados que dependen del
  // orden en que se lanzaron las pruebas, y eso es peor que no probar.
  await prisma.orderVehicle.deleteMany()
  await prisma.order.deleteMany()
  await prisma.route.deleteMany()
  await prisma.customer.deleteMany()
  await prisma.vehicle.deleteMany()
  await prisma.savedOrigin.deleteMany()
  // El catálogo cuelga del usuario dueño: si no se borra antes, borrar usuarios revienta
  // por la clave ajena y la siembra se queda a medias sin decir por qué.
  await prisma.product.deleteMany()
  await prisma.branch.deleteMany()
  await prisma.user.deleteMany()
  await prisma.settings.deleteMany()

  const admin = await prisma.user.create({
    data: {
      email: 'admin@procovar.test',
      password: await bcrypt.hash('procovar', 10),
      name: 'Admin Global',
      role: 'admin',
    },
  })

  const habana = await prisma.branch.create({
    data: {
      name: 'La Habana',
      externalId: 'HAB',
      lat: 23.1136,
      lng: -82.3666,
      originConfigured: true,
      creatorId: admin.id,
    },
  })

  // Una segunda sucursal, para comprobar que el alcance no deja pasar lo que no es tuyo.
  const camaguey = await prisma.branch.create({
    data: {
      name: 'Camagüey',
      externalId: 'CMG',
      lat: 21.3808,
      lng: -77.9169,
      originConfigured: true,
      creatorId: admin.id,
    },
  })

  const jefeCmg = await prisma.user.create({
    data: {
      email: 'cmg@procovar.test',
      password: await bcrypt.hash('procovar', 10),
      name: 'Jefe Camagüey',
      role: 'admin',
      branchId: camaguey.id,
    },
  })

  await prisma.vehicle.create({
    data: {
      name: 'Camión 1', type: 'truck', capacity: 3000, costoKmUsd: 0.45,
      usarParaDomicilio: true, userId: admin.id, branchId: habana.id,
    },
  })
  await prisma.vehicle.create({
    data: {
      name: 'Camión CMG', type: 'truck', capacity: 2000, costoKmUsd: 0.4,
      usarParaDomicilio: true, userId: jefeCmg.id, branchId: camaguey.id,
    },
  })

  await prisma.settings.create({
    data: {
      currencies: [{ code: 'CUP', rate: 700 }],
    },
  })

  /**
   * Clientes: más de los que caben en una página.
   *
   * El tope de la lista son 500. Se siembran 620 para que buscar uno del final —que
   * antes no aparecía nunca, porque el filtro se aplicaba después de cortar— sea una
   * prueba de verdad y no una casualidad.
   */
  const clientes = []
  for (let i = 1; i <= 620; i++) {
    clientes.push({
      source: 'pedido',
      externalId: `cli-${i}`,
      // El nombre lleva la letra delante para que el orden alfabético sea previsible.
      name: `${String.fromCharCode(65 + (i % 26))}${String(i).padStart(4, '0')} Cliente`,
      phone: `5${String(i).padStart(7, '0')}`,
      address: `Calle ${i}`,
      municipio: i % 3 === 0 ? 'Playa' : i % 3 === 1 ? 'Cerro' : 'Vedado',
      zona: `Z${i % 5}`,
      lat: 23.1 + (i % 50) * 0.002,
      lng: -82.4 + (i % 50) * 0.002,
      sucursalCodigo: 'HAB',
    })
  }
  // Uno de Camagüey, para que el alcance tenga a quién dejar fuera.
  clientes.push({
    source: 'pedido', externalId: 'cli-cmg', name: 'ZZZZ Cliente Camagüey',
    address: 'Calle CMG', municipio: 'Camagüey', lat: 21.38, lng: -77.91, sucursalCodigo: 'CMG',
  })
  await prisma.customer.createMany({ data: clientes })

  /**
   * Pedidos repartidos en el tiempo, con y sin peso resuelto.
   *
   * `orderDate` distinto de `createdAt` A PROPÓSITO: todos se crean ahora —como los crea
   * el espejo— pero son de días distintos. Es exactamente el caso que daba "cero pedidos"
   * al filtrar por cualquier día que no fuera hoy.
   */
  const pedidos = []
  for (let i = 0; i < 40; i++) {
    const dia = diaMenos(i % 10)
    const conPeso = i % 4 !== 0
    // Estados y archivado repartidos, que es como está el catálogo de verdad: la mayor
    // parte del histórico archivado, y de todo un poco en cada estado.
    const completada = i % 3 === 0
    const archivado = i % 5 !== 0
    // Un tercio con la fecha comprometida ya pasada: ésos son los «expirados».
    const comprometida = completada ? null : (i % 3 === 1 ? diaMenos(i % 10 + 2) : diaMenos(-3))

    pedidos.push({
      source: 'pedido',
      externalId: `ped-${i}`,
      operationNumber: `PAP25-${1000 + i}`,
      customerName: clientes[i].name,
      address: clientes[i].address,
      endAddress: clientes[i].address,
      lat: clientes[i].lat,
      lng: clientes[i].lng,
      endLat: clientes[i].lat,
      endLng: clientes[i].lng,
      weight: conPeso ? 12.8 : 0,
      deliveryPrice: 3.5 + i * 0.1,
      deliveryDistanceKm: 4 + (i % 7),
      orderDate: dia,
      pedidoUpdatedAt: dia,
      estado: completada ? 'completada' : 'en_proceso',
      archivado,
      fechaComprometida: comprometida,
      requiereDomicilio: i % 6 !== 0,
      // Sólo unos pocos los ha cotizado la APK, igual que en producción.
      pedidoCosto: i % 7 === 0 ? 3.5 : null,
      municipio: clientes[i].municipio,
      vendedor: `Vendedor ${i % 4}`,
      sucursalCodigo: 'HAB',
      branchId: habana.id,
      userId: admin.id,
      items: conPeso
        ? [
            { name: 'CERVEZA PARRANDA 0.33L', quantity: 24, packs: 4, pesoKg: 3.2, pesoLineaKg: 12.8, weightKg: 12.8, unitWeightKg: 3.2, matched: true, weightSource: 'pedido' },
          ]
        : [{ name: 'PRODUCTO SIN PESO', quantity: 3, packs: 1, weightKg: 0, unitWeightKg: 0, matched: false, weightSource: 'none' }],
      // La copia en texto de los nombres, que es por donde se busca «malta» sin tener que
      // leerse el JSON de los cincuenta mil pedidos.
      productosTexto: conPeso ? 'CERVEZA PARRANDA 0.33L' : 'PRODUCTO SIN PESO',
      meta: {
        folio: `PAP25-${1000 + i}`,
        cliente: { municipio: clientes[i].municipio },
        vendedor: { nombre: `Vendedor ${i % 4}`, codigo: `V-${i % 4}` },
      },
    })
  }
  // Un pedido de Camagüey, que el jefe de La Habana no debe ver.
  pedidos.push({
    source: 'pedido', externalId: 'ped-cmg', operationNumber: 'PAP25-9999',
    customerName: 'ZZZZ Cliente Camagüey', address: 'Calle CMG', endAddress: 'Calle CMG',
    lat: 21.38, lng: -77.91, endLat: 21.38, endLng: -77.91,
    weight: 5, deliveryPrice: 2, deliveryDistanceKm: 3,
    orderDate: diaMenos(1), pedidoUpdatedAt: diaMenos(1), branchId: camaguey.id, userId: jefeCmg.id,
    estado: 'en_proceso', archivado: false, requiereDomicilio: true,
    municipio: 'Camagüey', vendedor: 'Vendedor CMG', sucursalCodigo: 'CMG',
    items: [], meta: { cliente: { municipio: 'Camagüey' } },
  })
  // Y uno viejo, de hace un año: el espejo no lo traería, pero si alguien lo tiene aquí
  // el filtro de fechas tiene que saber encontrarlo y no confundirlo con los de hoy.
  pedidos.push({
    source: 'pedido', externalId: 'ped-viejo', operationNumber: 'PAP24-0001',
    customerName: 'Cliente del año pasado', address: 'Calle vieja', endAddress: 'Calle vieja',
    lat: 23.11, lng: -82.36, endLat: 23.11, endLng: -82.36,
    weight: 2, deliveryPrice: 1, deliveryDistanceKm: 2,
    orderDate: diaMenos(400), pedidoUpdatedAt: diaMenos(400), branchId: habana.id, userId: admin.id,
    estado: 'completada', archivado: true, requiereDomicilio: true,
    municipio: 'Cerro', vendedor: 'Vendedor 0', sucursalCodigo: 'HAB',
    items: [], meta: { cliente: { municipio: 'Cerro' } },
  })
  // Uno SIN `orderDate`, como los que entraron antes de que se guardara: tiene que
  // seguir apareciendo, con la fecha de copiado como respaldo.
  pedidos.push({
    source: 'pedido', externalId: 'ped-sin-fecha', operationNumber: 'PAP25-0000',
    customerName: 'Cliente sin fecha', address: 'Calle X', endAddress: 'Calle X',
    lat: 23.12, lng: -82.37, endLat: 23.12, endLng: -82.37,
    weight: 1, deliveryPrice: 1, deliveryDistanceKm: 1,
    orderDate: null, branchId: habana.id, userId: admin.id,
    estado: null, archivado: false, municipio: 'Playa', vendedor: 'Vendedor 1', sucursalCodigo: 'HAB',
    items: [], meta: {},
  })

  for (const p of pedidos) await prisma.order.create({ data: p })

  /**
   * Una ruta en CADA sucursal.
   *
   * El Super Admin las ve las dos, y era justo lo que se veía revuelto: dos rutas con el
   * mismo aspecto y nada que dijera de dónde son.
   */
  const camionHab = await prisma.vehicle.findFirst({ where: { branchId: habana.id } })
  const camionCmg = await prisma.vehicle.findFirst({ where: { branchId: camaguey.id } })

  await prisma.route.create({
    data: {
      name: 'Reparto Habana', routeCode: 'RT-HAB-001', status: 'planned',
      originAddress: 'Almacén Habana', originLat: habana.lat, originLng: habana.lng,
      branchId: habana.id, userId: admin.id, vehicleId: camionHab?.id ?? null,
    },
  })
  await prisma.route.create({
    data: {
      name: 'Reparto Camagüey', routeCode: 'RT-CMG-001', status: 'planned',
      originAddress: 'Almacén Camagüey', originLat: camaguey.lat, originLng: camaguey.lng,
      branchId: camaguey.id, userId: jefeCmg.id, vehicleId: camionCmg?.id ?? null,
    },
  })

  console.log(JSON.stringify({
    adminId: admin.id,
    adminEmail: admin.email,
    jefeCmgId: jefeCmg.id,
    jefeCmgEmail: jefeCmg.email,
    habanaId: habana.id,
    camagueyId: camaguey.id,
    clientes: clientes.length,
    pedidos: pedidos.length,
    hoy: comoFecha(hoy),
    ayer: comoFecha(diaMenos(1)),
    haceCinco: comoFecha(diaMenos(5)),
    anioPasado: comoFecha(diaMenos(400)),
  }, null, 2))
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
