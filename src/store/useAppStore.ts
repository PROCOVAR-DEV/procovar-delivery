import { create } from 'zustand'
import axios from 'axios'

// Header que el backend usa para scopear por sucursal (el admin elige una en el panel).
function applySucursalHeader(id: string | null) {
  if (id) axios.defaults.headers.common['x-sucursal-id'] = id
  else delete axios.defaults.headers.common['x-sucursal-id']
}

export interface BranchInfo {
  id: string
  name: string
  lat: number
  lng: number
  areaKm2: number
}

interface User {
  id: string
  email: string
  name: string
  role: string
  branchId?: string | null
  branch?: BranchInfo | null
}

export type Lang = 'es' | 'en'

interface AppState {
  user: User | null
  token: string | null
  displayCurrency: string
  language: Lang
  sucursalId: string | null
  setUser: (user: User | null) => void
  setToken: (token: string | null) => void
  setDisplayCurrency: (code: string) => void
  setLanguage: (lang: Lang) => void
  setSucursalId: (id: string | null) => void
  logout: () => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  token: null,
  displayCurrency: 'USD',
  language: 'es',
  sucursalId: null,
  setUser: (user) => {
    if (typeof window !== 'undefined') {
      if (user) localStorage.setItem('user', JSON.stringify(user))
      else localStorage.removeItem('user')
    }
    set({ user })
  },
  setToken: (token) => {
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('token', token)
      } else {
        localStorage.removeItem('token')
      }
    }
    set({ token })
  },
  setDisplayCurrency: (code) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('displayCurrency', code)
    }
    set({ displayCurrency: code })
  },
  setLanguage: (lang) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('language', lang)
    }
    set({ language: lang })
  },
  setSucursalId: (id) => {
    applySucursalHeader(id)
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem('sucursalId', id)
      else localStorage.removeItem('sucursalId')
    }
    set({ sucursalId: id })
  },
  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    }
    set({ user: null, token: null })
  },
}))

/** Resuelve cuando se sabe qué sucursal se está mirando. Ver el interceptor de abajo. */
let hidratacion: Promise<void> = Promise.resolve()

// Hydrate from localStorage on client only
if (typeof window !== 'undefined') {
  const storedToken = localStorage.getItem('token')
  if (storedToken) {
    useAppStore.setState({ token: storedToken })
  }
  const storedUser = localStorage.getItem('user')
  if (storedUser) {
    try { useAppStore.setState({ user: JSON.parse(storedUser) }) } catch { /* ignore */ }
  }
  const storedCurrency = localStorage.getItem('displayCurrency')
  if (storedCurrency) {
    useAppStore.setState({ displayCurrency: storedCurrency })
  }
  const storedLang = localStorage.getItem('language')
  if (storedLang === 'es' || storedLang === 'en') {
    useAppStore.setState({ language: storedLang })
  }
  /**
   * La sucursal guardada, pero COMPROBANDO que todavía exista.
   *
   * Antes se aplicaba a ciegas, y eso dejaba la aplicación entera en blanco sin decir
   * por qué: el id viaja en la cabecera x-sucursal-id, el backend filtra por él, y si
   * ese id ya no está en la tabla NADA cuadra — cero pedidos, cero clientes, cero
   * vehículos, y las rutas sin nada que planificar. Todo con 200 y sin un solo error.
   *
   * Pasa de verdad: las sucursales se recrearon en algún momento (unas tienen id de
   * cuid y otras hexadecimal), así que cualquier navegador que hubiera elegido una antes
   * se quedó con un id que ya no apunta a ninguna parte, y para siempre — nada lo
   * limpiaba.
   *
   * Si no cuadra se borra y se pasa a "todas", que para un administrador es lo correcto.
   */
  const storedSucursalId = localStorage.getItem('sucursalId')

  /**
   * La guardada NO se aplica hasta comprobarla. Antes se aplicaba y se comprobaba
   * después, y esa carrera es la que dejaba la aplicación en blanco.
   *
   * La cabecera se ponía en el mismo momento en que se carga el módulo, así que las
   * consultas de la pantalla salían YA con ella. Si el id era de una sucursal que ya no
   * existe, todas contestaban 200 con cero filas, y la comprobación llegaba tarde: para
   * cuando borraba el id, react-query tenía la respuesta vacía en caché. Y si la
   * comprobación fallaba —sin red, o la sesión todavía no puesta al volver del login
   * único, que es justo cuando pasa— se dejaba el id malo, y entonces no se limpiaba
   * NUNCA: cero pedidos, cero clientes, cero rutas, para siempre y sin un solo error.
   *
   * Comprobar primero cuesta una consulta al arrancar y quita la carrera entera.
   */
  hidratacion = storedSucursalId ? comprobarSucursalGuardada(storedSucursalId) : Promise.resolve()
}

/**
 * NINGUNA consulta sale antes de saber qué sucursal se está mirando.
 *
 * Comprobar la sucursal guardada antes de aplicarla quitó una carrera y metió la
 * contraria: durante esa comprobación la cabecera `x-sucursal-id` todavía no está
 * puesta, así que todo lo que pidiera la pantalla en ese hueco salía SIN ella — y a un
 * administrador eso le contesta con las ocho sucursales. Se veía al recargar: los
 * vehículos de todas, con una sucursal elegida arriba.
 *
 * Y no se arregla pantalla por pantalla: cualquier consulta nueva que alguien escriba
 * mañana tendría el mismo agujero. Se espera aquí, una vez, para todas.
 */
axios.interceptors.request.use(async (config) => {
  await hidratacion

  /**
   * Y la cabecera se pone AQUÍ, no antes.
   *
   * Esperar no bastaba. Axios fusiona las cabeceras por defecto en el momento en que se
   * lanza la petición —antes de que corra este interceptor—, así que una consulta que
   * salía durante la comprobación llevaba ya sus cabeceras hechas SIN la sucursal: el
   * interceptor la retenía, la soltaba después, y llegaba igual de desnuda. El servidor
   * contestaba con las ocho sucursales y la pantalla enseñaba rutas de otra provincia con
   * el nombre de una sola arriba.
   *
   * Poniéndola después de esperar, la petición sale con lo que hay cuando de verdad sale.
   */
  const elegida = useAppStore.getState().sucursalId

  if (elegida) config.headers.set('x-sucursal-id', elegida)
  else config.headers.delete('x-sucursal-id')

  return config
})

/**
 * Comprueba la sucursal guardada y SÓLO entonces la aplica.
 *
 * Si ya no existe —o no se puede comprobar— se pasa a "todas las sucursales", que es lo
 * que ve un administrador y nunca esconde nada. La elección se pierde y hay que volver a
 * hacerla; a cambio, nadie se queda mirando una aplicación vacía sin saber por qué.
 */
async function comprobarSucursalGuardada(guardada: string): Promise<void> {
  const olvidar = (motivo: string) => {
    localStorage.removeItem('sucursalId')
    applySucursalHeader(null)
    useAppStore.setState({ sucursalId: null })
    console.warn(`[sucursal] ${motivo}: se pasa a todas las sucursales`)
  }

  try {
    /**
     * Con un axios PROPIO, sin el interceptor de abajo.
     *
     * El interceptor espera a que esta comprobación termine antes de dejar salir nada; si
     * esta llamada pasara por él, se estaría esperando a sí misma y no saldría jamás: la
     * aplicación entera se quedaría cargando para siempre.
     */
    const { data } = await axios.create().get('/api/branches')

    if (Array.isArray(data) && data.some((b: { id: string }) => b.id === guardada)) {
      applySucursalHeader(guardada)
      useAppStore.setState({ sucursalId: guardada })
      return
    }
    olvidar('la guardada ya no existe')
  } catch {
    olvidar('no se pudo comprobar la guardada')
  }
}
