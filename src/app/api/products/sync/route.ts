import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { ventraCatalogo, ventraDatabases } from '@/lib/warehouse'
import { emparejarConVentra } from '@/lib/emparejarVentra'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/products/sync — trae el catálogo DE VENTRA, sucursal por sucursal.
 *
 * # Por qué se trae solo y no se teclea
 *
 * Había una pantalla para dar de alta productos a mano y un botón de importar. Un catálogo
 * tecleado se separa del de verdad en cuanto alguien no actualiza, y entonces un pedido
 * manual sale con un peso o un precio que no existen en ningún sitio.
 *
 * # Por qué por sucursal
 *
 * En Ventra el PRECIO y las EXISTENCIAS varían por sucursal —su documentación lo dice— y
 * el peso no. Un catálogo único ofrece en Camagüey lo que sólo hay en La Habana, y al
 * precio de La Habana.
 *
 * # Idempotente
 *
 * Escribe por (sucursal, sku), así que correrlo dos veces seguidas deja lo mismo. Y NO
 * BORRA lo que deja de venir: si Ventra contesta media lista —un corte de VPN a mitad de
 * descarga— borrar lo que falta dejaría media sucursal sin catálogo. Lo que no llega se
 * queda con su `traidoAt` viejo, que es justo la señal de «esto está rancio».
 */

export async function POST(req: NextRequest) {
  /**
   * Lo puede disparar el espejo (con la llave de servicio) o una persona con sesión.
   *
   * El espejo es quien lo hace de verdad, cada doce horas. La sesión queda para poder
   * forzarlo cuando alguien acaba de cargar productos en Ventra y no quiere esperar.
   */
  const key = req.headers.get('x-api-key')
  const conLlave = Boolean(key && key === process.env.SERVICE_API_KEY)

  if (!conLlave && !getUserFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  /**
   * ¿Toca ya?
   *
   * Lo decide el endpoint y no quien llama: el espejo pasa cada minuto y no tiene por qué
   * llevar la cuenta, y así el botón de «traer ahora» y el sondeo automático comparten la
   * misma regla en vez de tener dos. `forzar=1` se la salta.
   */
  const forzar = new URL(req.url).searchParams.get('forzar') === '1'
  const CADA_MS = Number(process.env.CATALOGO_CADA_MS || 12 * 60 * 60 * 1000)
  const ajustes = (await prisma.settings.findFirst()) ?? (await prisma.settings.create({ data: {} }))

  if (!forzar && ajustes.catalogoTraidoAt && Date.now() - ajustes.catalogoTraidoAt.getTime() < CADA_MS) {
    return NextResponse.json({ saltado: true, traidoAt: ajustes.catalogoTraidoAt })
  }

  const dueño = await prisma.user.findFirst({ where: { branchId: null }, orderBy: { createdAt: 'asc' } })

  if (!dueño) return NextResponse.json({ error: 'No hay ningún usuario al que colgar el catálogo' }, { status: 500 })

  let bases
  try {
    bases = await ventraDatabases()
  } catch (e) {
    // Sin VPN esto falla, y el catálogo se queda con la última foto buena. Se dice, en
    // vez de vaciarlo: un catálogo vacío no se distingue de «no hay productos».
    return NextResponse.json(
      { error: `No se pudo preguntar a Ventra (¿VPN?): ${(e as Error).message}` },
      { status: 502 },
    )
  }

  const sucursales = await prisma.branch.findMany({ select: { id: true, name: true, externalId: true } })
  const emparejadas = emparejarConVentra(sucursales, bases)
  const resultado: Array<{ sucursal: string; database: string | null; leidos: number; escritos: number; error?: string }> = []

  for (const s of emparejadas) {
    if (!s.database) {
      // Se DICE cuál no cuadró. Una sucursal sin catálogo y sin aviso parece una sucursal
      // sin productos, y nadie va a buscar el problema en el nombre de una base.
      resultado.push({ sucursal: s.name, database: null, leidos: 0, escritos: 0, error: 'sin base de Ventra que le cuadre' })
      continue
    }

    try {
      const filas = await ventraCatalogo(s.database)
      const codigo = s.externalId ?? s.name
      let escritos = 0

      for (const f of filas) {
        if (!f.sku || !f.name) continue
        if (f.isActive === false) continue

        const datos = {
          name: f.name,
          // El peso es por UNIDAD DE VENTA (el pack/caja), igual que el precio.
          weight: f.weightKg ?? 0,
          category: f.category,
          unit: f.unit,
          price: f.price,
          stock: f.stock,
          sku: f.sku,
          sucursalCodigo: codigo,
          traidoAt: new Date(),
          userId: dueño.id,
        }

        await prisma.product.upsert({
          where: { sucursalCodigo_sku: { sucursalCodigo: codigo, sku: f.sku } },
          update: datos,
          create: datos,
        })
        escritos++
      }

      resultado.push({ sucursal: s.name, database: s.database, leidos: filas.length, escritos })
    } catch (e) {
      resultado.push({ sucursal: s.name, database: s.database, leidos: 0, escritos: 0, error: (e as Error).message })
    }
  }

  const escritos = resultado.reduce((t, r) => t + r.escritos, 0)

  // La marca se pone sólo si algo entró. Si TODAS fallaron —la VPN está caída— no se
  // apunta la hora: si no, se esperarían doce horas más para volver a intentarlo.
  if (escritos > 0) {
    await prisma.settings.update({ where: { id: ajustes.id }, data: { catalogoTraidoAt: new Date() } })
  }

  return NextResponse.json({
    sucursales: resultado,
    escritos,
    conError: resultado.filter((r) => r.error).length,
  })
}
