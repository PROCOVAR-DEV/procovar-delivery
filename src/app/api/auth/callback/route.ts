import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/auth'
import { canjearCodigo, rolDeDelivery } from '@/lib/procovar-auth'
import { origenPublico } from '@/lib/origen-publico'

export const dynamic = 'force-dynamic'

/**
 * La vuelta del login único.
 *
 * Auth ya ha comprobado quién es; aquí solo se traduce esa persona a la ficha
 * que delivery necesita y se le entrega **el token de siempre**. Los cuarenta y
 * pico endpoints que ya comprueban `getUserFromRequest` no se enteran de que la
 * puerta ha cambiado, que es exactamente lo que se busca: cambiar la entrada sin
 * tocar ninguna de las cerraduras de dentro.
 *
 * La cuenta local se crea o se actualiza en cada entrada. No es un
 * duplicado de la de auth: es la fila a la que apuntan los pedidos, las rutas y
 * los vehículos que esa persona ha creado. Si se borrara y se volviera a crear,
 * su trabajo se quedaría huérfano.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const origen = origenPublico(req)

  if (!code) return NextResponse.redirect(`${origen}/login?sso=sincodigo`)

  try {
    const persona = await canjearCodigo(code)

    // La sucursal se busca por su código (CAM, HOL…), que es el mismo en las dos
    // aplicaciones. Si no existe aquí, la persona entra sin sucursal: verá menos
    // de lo que debería, pero entra — y eso se nota y se arregla, mientras que
    // negarle la entrada la deja fuera sin saber por qué.
    const sucursal = persona.codigoSucursal
      ? await prisma.branch.findUnique({
          where: { externalId: persona.codigoSucursal },
          select: { id: true },
        })
      : null

    const rol = rolDeDelivery(persona)

    // El correo es la identidad compartida entre las dos aplicaciones. Quien ya
    // existía aquí conserva su fila —y con ella todo lo que ha creado—; solo se
    // le refrescan el nombre, el rol y la sucursal, que ahora manda auth.
    //
    // La contraseña local se deja como está: ya no se usa para entrar, pero
    // borrarla impediría volver al login de siempre si hubiera que dar marcha
    // atrás.
    const usuario = await prisma.user.upsert({
      where: { email: persona.email },
      update: {
        name: persona.name,
        role: rol,
        branchId: sucursal?.id ?? null,
      },
      create: {
        email: persona.email,
        name: persona.name,
        role: rol,
        branchId: sucursal?.id ?? null,
        // Sin contraseña utilizable: esta cuenta nació del login único y no
        // tiene una propia. Una cadena vacía no valdría — `bcrypt.compare`
        // contra ella nunca acierta, que es justo lo que se quiere.
        password: 'sin-contrasena-local',
      },
      select: { id: true, email: true, name: true, role: true, branchId: true },
    })

    const token = signToken({
      id: usuario.id,
      email: usuario.email,
      name: usuario.name,
      role: usuario.role,
      branchId: usuario.branchId,
    })

    const volverA = persona.returnTo ?? `${origen}/dashboard`
    const res = NextResponse.redirect(volverA)

    // El token viaja en una cookie que el navegador guarda solo: delivery lo
    // leía de localStorage y lo ponía a mano en cada llamada, y desde el
    // servidor no hay forma de escribir localStorage. `getTokenFromRequest` ya
    // sabía leer esta cookie —era el camino de respaldo que nadie usaba—, así
    // que no hay que tocar nada más.
    res.cookies.set('token', token, {
      httpOnly: true,
      secure: origen.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })
    return res
  } catch (e) {
    console.error('[login unico] fallo el canje del codigo:', (e as Error).message)
    return NextResponse.redirect(`${origen}/login?sso=error`)
  }
}
