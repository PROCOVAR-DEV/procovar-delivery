/**
 * Saber si el servidor ya sirve una version distinta de la que corre esta pestaña.
 *
 * EL PROBLEMA. Una pestaña abierta sigue ejecutando el JavaScript que bajo el dia que
 * se abrio. Aqui las pestañas viven abiertas dias enteros —el armador de rutas, el
 * panel— y un dia con varios despliegues significa trabajar con codigo de hace varias
 * versiones sin enterarse. No se ve como "version vieja": se ve como un filtro que no
 * esta, un boton que no hace nada o un arreglo que no llego.
 *
 * COMO SE MIDE. Se pregunta a /api/version al arrancar y ESA es la referencia; a partir
 * de ahi, cualquier respuesta distinta significa que el contenedor cambio debajo.
 *
 * # Por que no se incrusta la version en el bundle
 *
 * Antes se incrustaba `VERSION_APP` en los dos lados via `env` de next.config.js, y no
 * funcionaba: Next CARGA next.config.js VARIAS VECES en un mismo build —procesos
 * distintos para el servidor y para el cliente—, y cada evaluacion hacia su propio
 * `Date.now()`. En produccion el bundle salio con 1788891030150 y el endpoint con
 * 1788891011255: 19 segundos de diferencia y, por tanto, el aviso de "hay version nueva"
 * SIEMPRE, en cada cambio de pestaña. Se comprobo el 09/09/2026 leyendo los dos numeros
 * del contenedor.
 *
 * La comprobacion que se hizo al montarlo no lo cazo porque se paso `BUILD_ID` a mano: con
 * la variable puesta las dos evaluaciones dan lo mismo y todo cuadra. En produccion no hay
 * `BUILD_ID`. La leccion es que el valor no puede depender de CUANDO se evalua la config.
 *
 * Preguntando la referencia no hace falta que el valor signifique nada: basta con que sea
 * estable mientras el contenedor viva y distinto tras un despliegue. Y de paso el aviso ya
 * no depende de que nadie configure una variable de build.
 */

/** Cada cuanto se pregunta, con la pestaña a la vista. */
const CADA = 5 * 60_000

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
  // La referencia: la primera respuesta que se consiga. Hasta tenerla no se compara nada,
  // porque no habria contra que.
  let referencia: string | null = null

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

      if (!vivo || !remota) return

      if (referencia === null) {
        // Primera respuesta: es la referencia, no una novedad.
        referencia = remota

        return
      }
      if (remota === referencia) return

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

  // La referencia se coge YA, no al minuto: si un despliegue cayera en ese minuto se
  // tomaria como referencia la version nueva y esta pestaña no volveria a avisar nunca.
  //
  // Y no se programa nada aqui: `mirar` encadena la siguiente en su `finally`. Poniendo
  // ademas un setTimeout se pisaba el handle y quedaban DOS relojes preguntando.
  void mirar()
  // Al volver a la pestaña, porque es cuando se va a usar. Al dejarla, porque es cuando
  // se puede recargar sin molestar. Al recuperar la red, porque los despliegues suelen
  // coincidir con el rato sin enlace.
  document.addEventListener('visibilitychange', mirar)
  window.addEventListener('online', mirar)

  return parar
}
