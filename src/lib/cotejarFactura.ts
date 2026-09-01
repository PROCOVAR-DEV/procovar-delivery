/**
 * Cotejar un PEDIDO con su FACTURA.
 *
 * El cliente cambia lo que pidió antes de que se le facture: pide veinte cajas y se lleva
 * quince. La ruta hay que armarla con lo FACTURADO, porque es lo que va en el camión y lo
 * que se cobra; repartir por el pedido viejo es cargar de más y descuadrar la caja.
 *
 * Aquí no se decide nada de negocio: se compara y se dice en qué estado quedó.
 *
 *   igual        — lo facturado coincide con lo pedido. Se puede repartir tal cual.
 *   cambiado     — se facturó otra cosa: más, menos o distinto.
 *   sin_factura  — ese pedido todavía no aparece en la facturación de ese día.
 *
 * # Por qué se cruza por NOMBRE
 *
 * Ventra numera a sus clientes con su propio código ("8214") y PEDIDO con el suyo
 * ("LH05TCP0025"): no hay ninguna clave común. Lo único que comparten es el nombre, así
 * que se normaliza —sin tildes, sin signos, sin dobles espacios— y se compara.
 *
 * Y por eso, ante la duda, NO se empareja: dar por buena la factura de otro cliente es
 * mandar el camión con la mercancía equivocada y cobrarla, que no se arregla después.
 */

export interface LineaPedido {
  name?: string | null
  description?: string | null
  packs?: number | null
  quantity?: number | null
}

export interface LineaFactura {
  operNumber: string
  clienteNombre: string
  /** El código de Ventra. Es el mismo `sku` del catálogo: sirve para pesar la factura. */
  productoCodigo?: string | null
  productoNombre: string
  cantidad: number
}

export type EstadoFactura = 'igual' | 'cambiado' | 'sin_factura'

export interface Cotejo {
  estado: EstadoFactura
  numero: string | null
  /** Lo que la factura dice, por producto. Sirve para poder corregir el pedido. */
  lineas: Array<{ producto: string; codigo: string | null; cantidad: number }>
  /** En qué se diferencian, en palabras. Vacío cuando cuadra. */
  diferencias: string[]
}

/** Sin tildes, sin signos, en minúsculas: para poder comparar nombres escritos a mano. */
export function normalizar(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Las palabras con las que se reconoce un producto entre los dos sistemas.
 *
 * Ventra lo llama «CERVEZA PARRANDA 1500 ML BLISTER 6U» y el pedido «PARRANDA 1.5L». No
 * hay forma de que coincidan enteros, así que se comparan por las palabras que sí
 * comparten: la marca y el número del formato.
 */
export function clavesDeProducto(nombre: string): Set<string> {
  /**
   * El formato, a mililitros, ANTES de normalizar.
   *
   * Normalizar quita el punto —«1.5L» se queda en «1 5l»— y entonces ya no hay forma de
   * saber que son mil quinientos. Se convierte primero y se normaliza después.
   */
  const enMl = (nombre || '')
    .toLowerCase()
    .replace(/(\d+)[.,](\d+)\s*l\b/g, (_, a, b) => ` ${Number(`${a}.${b}`) * 1000} `)
    .replace(/(\d+)\s*ml\b/g, ' $1 ')
    .replace(/(\d+)\s*l\b/g, (_, a) => ` ${Number(a) * 1000} `)

  return new Set(normalizar(enMl).split(' ').filter((p) => p.length > 2))
}

/** ¿Son el mismo producto? Comparten marca y formato. */
export function mismoProducto(a: string, b: string): boolean {
  const ca = clavesDeProducto(a)
  const cb = clavesDeProducto(b)
  const comunes = [...ca].filter((p) => cb.has(p))

  // Al menos dos coincidencias: con una sola, «PARRANDA» casaría con cualquier parranda
  // de cualquier formato y el cotejo diría que cuadra cuando no.
  return comunes.length >= 2
}

/**
 * @param lineasPedido  lo que se pidió (`items` del pedido).
 * @param facturas      TODAS las líneas facturadas de esa sucursal ese día.
 * @param cliente       el nombre del cliente del pedido.
 */
/**
 * ¿Es el MISMO cliente escrito de dos formas?
 *
 * Ventra le pega a veces el nombre de la persona: «5TA AVENIDA(ILIANA)» en el pedido y
 * «5TA AVENIDA(ILIANA)   ILIANA CABEZA VENERO» en la factura. Exigir igualdad exacta
 * dejaba fuera medio día de facturación, y esos pedidos desaparecían del armador de rutas
 * —el filtro por defecto es «los que cuadran»— sin que nadie supiera por qué.
 *
 * Se acepta que uno EMPIECE por el otro, o que todas las palabras del más corto estén en
 * el más largo. Nada más: con dos palabras sueltas en común, «CAFETERIA ODALIS» casaría
 * con cualquier otra cafetería y el camión saldría con la mercancía de otro.
 */
/**
 * Palabras que no distinguen a nadie.
 *
 * Media lista empieza por «CAFETERIA» o «MERCADITO», y Ventra añade «Mipyme» o «PV»
 * delante. Emparejar por ellas casaría cualquier cafetería con cualquier otra, y el
 * camión saldría con la mercancía de otro cliente.
 */
const GENERICAS = new Set([
  'cafeteria', 'cafe', 'bodega', 'bodegon', 'bodeguita', 'mercadito', 'mercado', 'kiosko',
  'kiosco', 'mipyme', 'punto', 'venta', 'bar', 'restaurante', 'tienda', 'los', 'las', 'del',
  'dueno', 'calle', 'reparto', 'rpto',
])

/** Las palabras que de verdad nombran al cliente. */
function distintivas(nombre: string): string[] {
  return normalizar(nombre)
    .split(' ')
    .filter((p) => p.length >= 4 && !GENERICAS.has(p))
}

export function mismoCliente(a: string, b: string): boolean {
  const x = normalizar(a)
  const y = normalizar(b)

  if (!x || !y) return false
  if (x === y) return true

  const corto = x.length <= y.length ? x : y
  const largo = corto === x ? y : x

  /**
   * Que el largo EMPIECE por el corto, en un corte de palabra.
   *
   * Es el caso más común: la factura lleva el negocio y detrás el dueño —«BAVARIA   JUAN
   * CARLOS FEDERICK»— o una pluralización —«LOS ORLAN» / «LOS ORLANS»—.
   */
  if (largo.startsWith(corto) && corto.length >= 6) return true

  /**
   * O que todas las palabras que NOMBRAN al corto estén en el largo.
   *
   * Cubre «ABEDUL» contra «Mipyme Abedul»: Ventra le pone un prefijo. Hace falta al menos
   * una palabra propia de cinco letras — con «LA» y «EL» no se empareja nada.
   */
  const suyas = distintivas(corto)

  if (!suyas.length || !suyas.some((p) => p.length >= 5)) return false

  const enElLargo = new Set(normalizar(largo).split(' '))

  return suyas.every((p) => enElLargo.has(p))
}

export function cotejar(
  lineasPedido: LineaPedido[],
  facturas: LineaFactura[],
  cliente: string,
): Cotejo {
  const suyas = facturas.filter((f) => mismoCliente(f.clienteNombre, cliente))

  if (suyas.length === 0) {
    return { estado: 'sin_factura', numero: null, lineas: [], diferencias: [] }
  }

  /**
   * Si tiene varias facturas ese día, se cotejan TODAS juntas.
   *
   * Pasa cuando el pedido se factura en dos documentos. Compararlo contra una sola diría
   * «cambiado» siempre, y la mitad de los pedidos se quedarían fuera de la ruta.
   */
  const numero = [...new Set(suyas.map((f) => f.operNumber))].sort().join(', ')
  const facturado = new Map<string, { codigo: string | null; cantidad: number }>()

  for (const f of suyas) {
    const previo = facturado.get(f.productoNombre)

    facturado.set(f.productoNombre, {
      // El código se guarda para poder pesar la factura por sku, que es exacto; el
      // nombre queda para lo que Ventra no codifica.
      codigo: previo?.codigo ?? f.productoCodigo ?? null,
      cantidad: (previo?.cantidad ?? 0) + f.cantidad,
    })
  }

  const lineas = [...facturado.entries()].map(([producto, v]) => ({ producto, codigo: v.codigo, cantidad: v.cantidad }))
  const diferencias: string[] = []
  const usadas = new Set<string>()

  for (const l of lineasPedido) {
    const nombre = (l.name || l.description || '').trim()

    if (!nombre) continue
    // Lo pedido va en unidades de VENTA (los packs), igual que la cantidad de Ventra.
    const pedidas = Number(l.packs) > 0 ? Number(l.packs) : Number(l.quantity) || 0
    const encaje = lineas.find((f) => !usadas.has(f.producto) && mismoProducto(nombre, f.producto))

    if (!encaje) {
      diferencias.push(`${nombre}: pedido ${pedidas}, no facturado`)
      continue
    }
    usadas.add(encaje.producto)
    if (Math.abs(encaje.cantidad - pedidas) > 0.001) {
      diferencias.push(`${nombre}: pedido ${pedidas}, facturado ${encaje.cantidad}`)
    }
  }

  // Y lo que se facturó sin haberse pedido: también es una diferencia.
  for (const f of lineas) {
    if (!usadas.has(f.producto)) diferencias.push(`${f.producto}: facturado ${f.cantidad}, no pedido`)
  }

  return {
    estado: diferencias.length === 0 ? 'igual' : 'cambiado',
    numero,
    lineas,
    diferencias,
  }
}
