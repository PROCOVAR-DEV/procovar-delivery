/**
 * Lo que NO es mercancía.
 *
 * En el catálogo de Ventra conviven los productos con líneas de servicio. La importante
 * es «ENTREGA A DOMICILIO», categoría `SERV` y peso cero: no es algo que se carga en un
 * camión, es el propio cobro del reparto facturado como una línea más.
 *
 * Salía en el buscador de productos al meter un pedido a mano, con «0 kg» al lado, y
 * alguien la iba a elegir tarde o temprano. Un pedido con esa línea dentro pesa lo mismo
 * que sin ella y encima cobra el reparto dos veces: una en la línea y otra en el
 * domicilio.
 *
 * La misma regla vive en PEDIDO (`src/lib/servicios.ts`): las dos leen el mismo catálogo
 * de Ventra y tienen que estar de acuerdo en qué es mercancía.
 */

/** Categorías de Ventra que no son mercancía. */
const CATEGORIAS = new Set(['serv', 'servicio', 'servicios'])

const sinTildes = (s: string): string =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export interface AlgoDelCatalogo {
  name?: string | null
  category?: string | null
}

/** ¿Es una línea de servicio y no algo que se transporta? */
export function esServicio(x: AlgoDelCatalogo): boolean {
  if (CATEGORIAS.has(sinTildes(x.category ?? ''))) return true

  const n = sinTildes(x.name ?? '')

  // La frase entera. Con «entrega» a secas, cualquier producto que la mencionara
  // desaparecería del catálogo y nadie sabría por qué.
  return n.includes('entrega a domicilio') || n.includes('servicio de entrega')
}
