import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * A qué otras aplicaciones puede ir esta persona.
 *
 * La lista se decide AQUÍ y no en el navegador. Si la pintara el cliente filtrando por
 * el rol que lleva en el store, cualquiera que edite ese valor se pinta los enlaces de
 * administrador — que no le darían acceso a nada, porque cada aplicación comprueba su
 * propia sesión, pero le enseñan qué hay y dónde está. Enseñar el mapa de lo que no te
 * toca no es un fallo de seguridad, pero tampoco es lo que se pidió.
 *
 * Que un enlace aparezca no garantiza la entrada: quien manda es la sesión única de
 * Accesos en el destino. Esto es el menú, no el permiso.
 */
interface Destino {
  href: string
  icon: string
  title: string
  description: string
  /** Sólo para quien administra. */
  soloAdmin?: boolean
}

// Las mismas que enseña Accesos en su portada, menos delivery —que es donde estás—.
// n8n se queda fuera a propósito: es la herramienta de automatizaciones, no una
// aplicación de negocio.
const APPS: Destino[] = [
  { href: 'https://pedidos.procovar.cloud', icon: 'mdi:clipboard-list-outline', title: 'PEDIDO', description: 'Pedidos, clientes y vendedores.' },
  { href: 'https://entrega.procovar.cloud', icon: 'mdi:package-variant-closed-check', title: 'Entrega', description: 'El panel de los repartidores.' },
  { href: 'https://rutas.procovar.cloud', icon: 'mdi:routes', title: 'Rutas', description: 'Recorridos de los vendedores en el mapa.' },
  { href: 'https://analitics.procovar.cloud', icon: 'mdi:chart-bar', title: 'Analitics', description: 'Informes de ventas y gestores.' },
  { href: 'https://caja.procovar.cloud', icon: 'mdi:cash-register', title: 'Caja', description: 'Cobros y cierres de caja.' },
  { href: 'https://traslado.procovar.cloud', icon: 'mdi:swap-horizontal', title: 'Traslado', description: 'Mercancía entre sucursales.' },
  { href: 'https://ccsa.procovar.cloud', icon: 'mdi:view-dashboard-outline', title: 'Tablero Parranda', description: 'El tablero de Parranda / CCSA.' },
  { href: 'https://procovar.cloud', icon: 'mdi:home-outline', title: 'Portal', description: 'La entrada común a todo lo demás.' },
  { href: 'https://auth.procovar.cloud/dashboard', icon: 'mdi:shield-account-outline', title: 'Accesos', description: 'Cuentas, sucursales y permisos.', soloAdmin: true },
]

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Administrador GLOBAL = sin sucursal asignada. Un administrador de UNA sucursal
  // administra la suya, no las cuentas de la empresa.
  const esAdminGlobal = user.role === 'admin' && !user.branchId
  const apps = APPS.filter((a) => !a.soloAdmin || esAdminGlobal)

  return NextResponse.json({ apps: apps.map(({ soloAdmin: _s, ...rest }) => rest) })
}
