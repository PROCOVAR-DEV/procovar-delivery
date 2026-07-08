// Matching de productos PEDIDO <-> catálogo de pesos del Data Warehouse.
//
// Los pedidos NO traen código de producto; solo el nombre, y en otro formato que el
// warehouse (ej. "PARRANDA 0.33L" vs "CERVEZA PARRANDA 330 ML BLISTER 6U"). Este módulo
// normaliza ambos nombres a un conjunto de tokens { marca... + volumen(ML) + números
// significativos como el año del ron o el tamaño }, ignorando ruido de categoría/empaque,
// y hace match EXACTO y, si no, FUZZY tolerando un typo (Damerau ≤ 1, ej. NIGTH↔NIGHT).
//
// El peso del warehouse es POR UNIDAD DE VENTA (blister/caja). En el pedido, `packs` = nº
// de unidades de venta. Peso del ítem = weightKg(SKU) × packs.

import type { ProductWeight } from './warehouse'

// Palabras de ruido: categorías y empaque (no identifican el producto).
const NOISE = new Set([
  'ALIMENTOS', 'ASEO', 'HIGIENE', 'HOGAR', 'HIGIENEHOGAR', 'TECNOLOGIA', 'BEBIDAS',
  'CONFITERIA', 'RONES', 'CERVEZA', 'BLISTER', 'CAJA', 'PACA', 'PALET', 'TONEL',
  'BOTELLA', 'SACO', 'UNIDAD', 'UNIDADES', 'PAQUETE', 'DE', 'X', 'REFRESCO',
])

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export interface NormalResult {
  tokens: string[] // ordenados, únicos (incluye token de volumen "V<ml>" si hay)
  volMl: number | null
  key: string
}

/** Normaliza un nombre de producto a tokens comparables. */
export function normalizeProduct(nameRaw: string): NormalResult {
  let s = stripAccents(String(nameRaw || '').toUpperCase())
  s = s.replace(/[,](?=\d)/g, '.') // 0,33 -> 0.33
  // Volumen (junto o separado): "0.33L", "330 ML", "1.5 L" -> token V<ml>
  let volMl: number | null = null
  s = s.replace(/(\d+(?:\.\d+)?)\s*ML\b/g, (_m, n) => { volMl = Math.round(parseFloat(n)); return ' V' + volMl + ' ' })
  s = s.replace(/(\d+(?:\.\d+)?)\s*L\b/g, (_m, n) => { volMl = Math.round(parseFloat(n) * 1000); return ' V' + volMl + ' ' })
  // Conteos de empaque: 6U, 24U, 12P, 4U... -> fuera (no identifican, ya está packs).
  s = s.replace(/\b\d+\s*[UP]\b/g, ' ')
  // Tokenizar: letras/números/+/. ; quitar ruido; conservar números significativos
  // (año del ron "12", tamaño "7 PIES", "25KG") y el token de volumen "V<ml>".
  const raw = s.split(/[^A-Z0-9+.]+/).filter(Boolean)
  const toks = raw.filter((t) => t.length > 1 || /^\d$/.test(t)).filter((t) => !NOISE.has(t))
  const uniq = [...new Set(toks)].sort()
  return { tokens: uniq, volMl, key: uniq.join(' ') }
}

// Distancia Damerau-Levenshtein (con transposición de adyacentes), acotada: sirve para
// detectar UN typo (NIGTH<->NIGHT es transposición = distancia 1).
function damerau(a: string, b: string): number {
  const al = a.length, bl = b.length
  if (Math.abs(al - bl) > 1) return 2 // >1: no nos interesa
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0))
  for (let i = 0; i <= al; i++) d[i][0] = i
  for (let j = 0; j <= bl; j++) d[0][j] = j
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[al][bl]
}

export type MatchHow = 'sku' | 'name-exact' | 'name-fuzzy' | 'none'
export interface WeightHit {
  weightKg: number // peso POR UNIDAD DE VENTA (0 si el SKU no tiene peso o no hubo match)
  sku?: string
  whName?: string
  how: MatchHow
}

interface Entry { tokens: string[]; volMl: number | null; weightKg: number; sku: string; name: string }

export interface WeightCatalog {
  bySku: Map<string, number>
  resolve(name?: string, code?: string): WeightHit
}

/** Construye el catálogo (SKU + índice por nombre normalizado + fuzzy) desde /products/weights. */
export function buildWeightCatalog(products: ProductWeight[]): WeightCatalog {
  const bySku = new Map<string, number>()
  const byKey = new Map<string, Entry>()
  const entries: Entry[] = []
  for (const p of products) {
    const w = p.weightKg == null ? 0 : p.weightKg
    if (p.sku) bySku.set(p.sku.toUpperCase(), w)
    const n = normalizeProduct(p.name)
    const e: Entry = { tokens: n.tokens, volMl: n.volMl, weightKg: w, sku: p.sku, name: p.name }
    entries.push(e)
    if (!byKey.has(n.key)) byKey.set(n.key, e) // primer SKU con esa clave
  }

  function resolve(name?: string, code?: string): WeightHit {
    if (code) {
      const c = code.toString().toUpperCase()
      if (bySku.has(c)) return { weightKg: bySku.get(c) as number, sku: c, how: 'sku' }
    }
    if (!name) return { weightKg: 0, how: 'none' }
    const n = normalizeProduct(name)
    const exact = byKey.get(n.key)
    if (exact) return { weightKg: exact.weightKg, sku: exact.sku, whName: exact.name, how: 'name-exact' }
    // Fuzzy: mismo volumen, misma cantidad de tokens, difieren en EXACTAMENTE un token
    // con distancia Damerau ≤ 1 (y longitud ≥ 4 para no cruzar palabras cortas).
    let best: Entry | null = null
    let bestCount = 0
    for (const e of entries) {
      if (e.volMl !== n.volMl || e.tokens.length !== n.tokens.length) continue
      const onlyP = n.tokens.filter((t) => !e.tokens.includes(t))
      const onlyC = e.tokens.filter((t) => !n.tokens.includes(t))
      if (onlyP.length === 1 && onlyC.length === 1 &&
          Math.min(onlyP[0].length, onlyC[0].length) >= 4 &&
          damerau(onlyP[0], onlyC[0]) <= 1) {
        best = e; bestCount++
      }
    }
    if (best && bestCount === 1) return { weightKg: best.weightKg, sku: best.sku, whName: best.name, how: 'name-fuzzy' }
    return { weightKg: 0, how: 'none' }
  }

  return { bySku, resolve }
}
