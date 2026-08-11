/**
 * Ni editar ni borrar cuentas: se gestionan en el sistema de accesos.
 *
 * Editarlas aquí no serviría de nada aunque se dejara. El rol y la sucursal se
 * refrescan desde accesos **cada vez que la persona entra**, así que cualquier
 * cambio hecho aquí duraría hasta su siguiente inicio de sesión — que es la peor
 * clase de fallo: el que parece que funcionó.
 *
 * Y borrar, menos: estas fichas son a las que apuntan los pedidos, las rutas y
 * los vehículos que cada uno creó. Quitarle el acceso a alguien se hace en
 * accesos; la ficha se queda aquí, sosteniendo el histórico.
 *
 * El fichero se conserva sin métodos para que quede escrito el porqué. Borrarlo
 * dejaría el hueco sin explicación, y dentro de tres meses alguien volvería a
 * añadir un PATCH sin saber por qué no estaba.
 */
export const dynamic = 'force-dynamic'
