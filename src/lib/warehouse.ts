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

const BASE = process.env.WAREHOUSE_API_URL || 'http://10.188.2.2:3001/api/external-api'
const TOKEN = process.env.WAREHOUSE_API_TOKEN || ''

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

/** Mapa SKU(mayúsculas) -> weightKg, solo con los productos que tienen peso. */
export async function fetchWeightMap(): Promise<Map<string, number>> {
  const list = await warehouse.productWeights()
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
  const list = await warehouse.productWeights()
  return buildWeightCatalog(list)
}
