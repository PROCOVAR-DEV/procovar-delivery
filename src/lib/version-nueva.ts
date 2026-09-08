/**
 * Saber si el servidor ya sirve una version distinta de la que corre esta pestaña.
 *
 * EL PROBLEMA. Una pestaña abierta sigue ejecutando el JavaScript que bajo el dia que
 * se abrio. Aqui las pestañas viven abiertas dias enteros —el armador de rutas, el
 * panel— y un dia con varios despliegues significa trabajar con codigo de hace varias
 * versiones sin enterarse. No se ve como "version vieja": se ve como un filtro que no
 * esta, un boton que no hace nada o un arreglo que no llego.
 *
 * COMO SE MIDE. `VERSION_APP` se calcula en next.config.js durante el build y Next la
 * incrusta como literal en los dos lados: en el JavaScript que baja el navegador y en
 * /api/version. Por eso la de aqui es la del build del que salio ESTA pestaña, y la que
 * contesta /api/version es la del contenedor desplegado ahora. Distintas = version
 * vieja corriendo.
 */

/** La version del build que genero el JavaScript que corre esta pestaña. */
const VERSION_LOCAL = process.env.VERSION_APP ?? ''

/** Cada cuanto se pregunta, con la pestaña a la vista. */
const CADA = 5 * 60_000
/** Cuanto se espera antes de la primera pregunta: acabamos de cargar. */
const PRIMERA = 60_000

/**
 * Marca de la version por la que YA se recargo sola esta pestaña. Es el freno que hace
 * imposible el bucle: si al volver seguimos viendo la misma version nueva por bajar, no
 * se recarga otra vez — se enseña el aviso y decide una persona.
 */
const CLAVE_YA_RECARGADA = 'procovar:version-recargada'

function yaSeRecargoPor(marca: string): boolean {
  try {
    return sessionStorage.getItem(CLAVE_YA_RECARGADA) === marca
  } catch {
    // Sin almacenamiento no hay freno, asi que no se recarga sola nunca.
    return true
  }
}

/** Recarga trayendo el HTML nuevo de verdad, no el que el navegador tenga a mano. */
export function recargarLimpio(): void {
  const u = new URL(window.location.href)

  u.searchParams.set('v', String(Date.now()))
  window.location.replace(u.toString())
}

async function versionDelServidor(): Promise<string | null> {
  try {
    const r = await fetch('/api/version', { cache: 'no-store' })

    if (!r.ok) return null

    const datos = (await r.json()) as { version?: string | null }

    return datos?.version || null
  } catch {
    // Sin red. Se reintenta.
    return null
  }
}

/**
 * Empieza a vigilar. Devuelve la funcion para dejar de hacerlo.
 *
 * Se apaga sola al detectar: con el aviso ya puesto no hay nada mas que descubrir.
 */
export function vigilarVersion(alHaberVersionNueva: (marca: string) => void): () => void {
  // Sin marca local no se puede comparar nada. Pasa en `next dev`, y ahi el aviso
  // saldria en cada guardado.
  if (!VERSION_LOCAL) return () => {}

  let vivo = true
  let reloj: ReturnType<typeof setTimeout> | undefined
  let mirando = false

  const parar = () => {
    vivo = false
    if (reloj) clearTimeout(reloj)
    document.removeEventListener('visibilitychange', mirar)
    window.removeEventListener('online', mirar)
  }

  async function mirar() {
    if (!vivo || mirando) return
    mirando = true
    try {
      const remota = await versionDelServidor()

      if (!vivo || !remota || remota === VERSION_LOCAL) return

      // Con la pestaña OCULTA se recarga sola: no hay nadie escribiendo y quien vuelva
      // se encuentra la version buena. Con la pestaña A LA VISTA no se recarga nunca
      // sola — puede haber una ruta a medio armar, y perderla es peor que la version
      // vieja. Ahi manda el aviso, que tiene su boton.
      if (document.visibilityState === 'hidden' && !yaSeRecargoPor(remota)) {
        try {
          sessionStorage.setItem(CLAVE_YA_RECARGADA, remota)
        } catch {
          /* si no se puede anotar, `yaSeRecargoPor` ya impide llegar aqui */
        }
        parar()
        recargarLimpio()

        return
      }

      parar()
      alHaberVersionNueva(remota)
    } finally {
      mirando = false
      if (vivo) reloj = setTimeout(mirar, CADA)
    }
  }

  reloj = setTimeout(mirar, PRIMERA)
  // Al volver a la pestaña, porque es cuando se va a usar. Al dejarla, porque es cuando
  // se puede recargar sin molestar. Al recuperar la red, porque los despliegues suelen
  // coincidir con el rato sin enlace.
  document.addEventListener('visibilitychange', mirar)
  window.addEventListener('online', mirar)

  return parar
}
