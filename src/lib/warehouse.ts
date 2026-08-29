// Cliente del Data Warehouse (API "Ventra", NestJS, read-only).
// Alcanzable SOLO por la VPN WireGuard. Token permanente en WAREHOUSE_API_TOKEN.
//
// Endpoints CONFIRMADOS (2026-07-07):
//   GET /branches         -> sucursales con { id, name, code, warehouses[] }
//   GET /warehouses       -> almacenes { id, name, code, branch, company }
//   GET /branch-entries   -> movimientos contables paginados; filas con
//                            { productCode, productName, quantity, amount, ... }
//                            query: ?database=<camaguey|santiago|...>&page&pageSize&from&to
//   GET /products/weights -> catálogo de PESOS por producto (= /axis/products):
//                            { sku, name, category, unit, weightKg, isActive }
//                            weightKg = peso en kg por unidad de venta (aplica a todas
//                            las sucursales). El sku coincide con productCode de las entries.
//                            OJO: hoy ~70/111 tienen weightKg en null (los están llenando).
// Scopes del token: accounting.read, axis.read, branch_entries.read, branches.read, warehouses.read

import { cacheGetJSON, cacheSetJSON, cacheDel, K_WAREHOUSE_WEIGHTS } from './redis'

const BASE = process.env.WAREHOUSE_API_URL || 'http://10.188.2.2:3001/api/external-api'
const TOKEN = process.env.WAREHOUSE_API_TOKEN || ''
// TTL del cache de pesos (segundos). El catálogo cambia poco; 10 min por defecto.
const WEIGHTS_TTL = Number(process.env.WAREHOUSE_WEIGHTS_TTL || 600)

export async function whFetch<T = unknown>(pathAndQuery: string): Promise<T> {
  if (!TOKEN) throw new Error('WAREHOUSE_API_TOKEN no configurado (.env)')
  const url = `${BASE}${pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Warehouse ${res.status} en ${pathAndQuery}: ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

export interface WarehouseBranch {
  id: string
  name: string
  code: string
  address: string | null
  isActive: boolean
  warehouses?: Array<{ id: string; name: string; code: string; isActive: boolean }>
}

export interface BranchEntryRow {
  id: string
  source: string
  database: string
  branchName: string
  date: string
  productCode: string | null
  productName: string | null
  objectName: string | null
  quantity: number | null
  amount: number | null
  note: string | null
  className: string | null
  subtype: string | null
  account: string | null
  movesInventory: boolean
  movesExpense: boolean
}

export interface BranchEntriesPage {
  database: string
  page: number
  pageSize: number
  total: number
  totalPages: number
  branchOptions: Array<{ database: string; branchName: string; branchId: string | null }>
  rows: BranchEntryRow[]
}

export interface ProductWeight {
  id: string
  sku: string
  name: string
  category: string
  unit: string
  weightKg: number | null
  isActive: boolean
}

export const warehouse = {
  branches: () => whFetch<WarehouseBranch[]>('/branches'),
  warehouses: () => whFetch('/warehouses'),
  branchEntries: (params: { database?: string; page?: number; pageSize?: number; from?: string; to?: string } = {}) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v))
    const qs = q.toString()
    return whFetch<BranchEntriesPage>(`/branch-entries${qs ? `?${qs}` : ''}`)
  },
  productWeights: () => whFetch<ProductWeight[]>('/products/weights'),
}

/**
 * Una fila del catálogo, YA POR SUCURSAL.
 *
 * `productWeights()` de arriba pide `/products/weights` sin `database`, y así sólo llegan
 * los pesos. La documentación de Ventra lo dice con todas las letras: el precio y las
 * existencias VARÍAN POR SUCURSAL y hay que pasar `database` para tenerlos. Sin eso, el
 * precio que llega no es de ninguna sucursal en concreto, y guardarlo como si lo fuera es
 * peor que no tenerlo.
 */
export interface FilaCatalogoVentra {
  sku: string | null
  name: string | null
  category: string | null
  unit: string | null
  weightKg: number | null
  stock: number | null
  price: number | null
  isActive: boolean | null
}

export interface BaseVentra {
  /** El slug que se manda en `?database=`. Ej: "camaguey", "granma". */
  database: string
  /** Cómo llama Ventra a esa sucursal. Ej: "CAMAGUEY", "BAYAMO". */
  branchName: string
  connected: boolean
}

/** El primer campo que exista de una lista de nombres posibles. */
function numero(fila: Record<string, unknown>, ...nombres: string[]): number | null {
  for (const n of nombres) {
    const v = fila[n]

    if (v == null || v === '') continue
    const x = Number(v)

    if (!Number.isNaN(x)) return x
  }
  return null
}

function texto(fila: Record<string, unknown>, ...nombres: string[]): string | null {
  for (const n of nombres) {
    const v = fila[n]

    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function filas(d: unknown): Record<string, unknown>[] {
  return (Array.isArray(d)
    ? d
    : ((d as Record<string, unknown>)?.items as unknown[])
      || ((d as Record<string, unknown>)?.data as unknown[])
      || []) as Record<string, unknown>[]
}

/**
 * Las bases (sucursales) que Ventra tiene configuradas.
 *
 * Hay que PREGUNTÁRSELAS, no deducirlas de nuestros nombres. Sus slugs no se parecen a lo
 * que uno supondría —`granma` es BAYAMO, `sspiritus` es Sancti Spíritus, `tunas` es Las
 * Tunas—, y adivinar falla en cuatro de diez: una sucursal entera se queda sin catálogo
 * sin que salte nada.
 */
export async function ventraDatabases(): Promise<BaseVentra[]> {
  return filas(await whFetch('/axis/databases'))
    .map((f) => ({
      database: texto(f, 'database') || '',
      branchName: texto(f, 'branchName', 'name') || '',
      connected: (f.connected as boolean) ?? true,
    }))
    .filter((b) => b.database)
}

/**
 * Una línea de FACTURA de Ventra: lo que de verdad se vendió.
 *
 * `operNumber` es el número de la factura —varias líneas lo comparten— y `quantity` va en
 * unidades de venta, igual que el precio y el peso del catálogo.
 */
export interface LineaVentaVentra {
  id: string
  fecha: string
  operNumber: string
  clienteCodigo: string | null
  clienteNombre: string
  productoCodigo: string | null
  productoNombre: string
  cantidad: number
  precioUsd: number | null
}

/**
 * Las ventas facturadas de una sucursal, entre dos fechas.
 *
 * `database` es obligatorio: sin él Ventra devuelve el consolidado de todas y no hay forma
 * de saber de qué sucursal es cada factura.
 */
export async function ventraVentas(database: string, desde: string, hasta: string, tope = 5000): Promise<LineaVentaVentra[]> {
  const d = await whFetch(
    `/axis/sales?database=${encodeURIComponent(database)}&from=${desde}&to=${hasta}&limit=${tope}`,
  )
  const cuerpo = d as { rows?: unknown[] }

  return filas(cuerpo?.rows ?? d).map((f) => ({
    id: String(f.id ?? ''),
    fecha: texto(f, 'date', 'fecha') ?? '',
    operNumber: String(f.operNumber ?? f.numero ?? ''),
    clienteCodigo: texto(f, 'customerCode', 'clienteCodigo'),
    clienteNombre: texto(f, 'customerName', 'clienteNombre') ?? '',
    productoCodigo: texto(f, 'productCode', 'productoCodigo'),
    productoNombre: texto(f, 'productName', 'productoNombre') ?? '',
    cantidad: numero(f, 'quantity', 'cantidad') ?? 0,
    precioUsd: numero(f, 'priceOut', 'precioUsd'),
  })).filter((l) => l.id && l.productoNombre)
}

/** El catálogo de UNA sucursal: peso, existencias y precio. */
export async function ventraCatalogo(database: string): Promise<FilaCatalogoVentra[]> {
  const d = await whFetch(`/products/weights?database=${encodeURIComponent(database)}`)

  return filas(d).map((f) => ({
    sku: texto(f, 'sku', 'productCode', 'code'),
    name: texto(f, 'name', 'productName', 'descripcion'),
    category: texto(f, 'category', 'categoria'),
    unit: texto(f, 'unit', 'unidad'),
    weightKg: numero(f, 'weightKg', 'weight', 'pesoKg'),
    // Los nombres reales son `existencias` y `precioUsd`; los demás quedan de red por si
    // un día renombran la columna. Perder todos los precios en silencio por un nombre
    // cambiado es el fallo que no se ve.
    stock: numero(f, 'existencias', 'stock', 'quantity', 'onHand'),
    price: numero(f, 'precioUsd', 'price', 'unitPrice', 'salePrice', 'precio'),
    isActive: (f.isActive as boolean) ?? null,
  }))
}

/**
 * Igual que warehouse.productWeights() pero CACHEADO en Redis (TTL): evita re-bajar por
 * VPN el catálogo entero en cada lote de cotización, que era el patrón caro y repetido.
 * Sin Redis, baja directo (comportamiento actual). Se invalida al importar pesos.
 */
export async function productWeightsCached(): Promise<ProductWeight[]> {
  const cached = await cacheGetJSON<ProductWeight[]>(K_WAREHOUSE_WEIGHTS)
  if (cached) return cached
  const list = await warehouse.productWeights()
  await cacheSetJSON(K_WAREHOUSE_WEIGHTS, list, WEIGHTS_TTL)
  return list
}

/** Borra el cache de pesos. Llamar tras importar/actualizar pesos del warehouse. */
export async function invalidateWeightsCache(): Promise<void> {
  await cacheDel(K_WAREHOUSE_WEIGHTS)
}

/** Mapa SKU(mayúsculas) -> weightKg, solo con los productos que tienen peso. */
export async function fetchWeightMap(): Promise<Map<string, number>> {
  const list = await productWeightsCached()
  const m = new Map<string, number>()
  for (const p of list) {
    if (p.sku && p.weightKg != null) m.set(p.sku.toUpperCase(), p.weightKg)
  }
  return m
}

/**
 * Catálogo de pesos con match por código SKU y por NOMBRE (normalizado + fuzzy), ya que
 * los pedidos no traen código. Ver productMatch.ts.
 */
export async function fetchWeightCatalog() {
  const { buildWeightCatalog } = await import('./productMatch')
  const list = await productWeightsCached()
  return buildWeightCatalog(list)
}
