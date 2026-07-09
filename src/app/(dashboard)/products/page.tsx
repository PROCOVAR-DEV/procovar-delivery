'use client'

import { useState } from 'react'
import axios from 'axios'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'
import Pagination, { usePagedList } from '@/components/Pagination'
import { useAppStore } from '@/store/useAppStore'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

interface Product {
  id: string
  name: string
  weight: number
  packaging?: string | null
  unitsPerPackage?: number | null
  category?: string | null
}

const emptyForm = { id: '', name: '', weight: '', packaging: '', unitsPerPackage: '', category: '' }

export default function ProductsPage() {
  const { token } = useAppStore()
  const t = useT()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [showImport, setShowImport] = useState(false)
  const [csv, setCsv] = useState('')
  const [warehouseMsg, setWarehouseMsg] = useState('')
  const [warehouseErr, setWarehouseErr] = useState('')

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await axios.get('/api/products', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as Product[]
    },
    enabled: !!token,
  })

  const saveProduct = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        weight: parseFloat(form.weight) || 0,
        packaging: form.packaging,
        unitsPerPackage: form.unitsPerPackage ? parseFloat(form.unitsPerPackage) : null,
        category: form.category,
      }
      if (form.id) {
        return (await axios.patch(`/api/products/${form.id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data
      }
      return (await axios.post('/api/products', payload, { headers: { Authorization: `Bearer ${token}` } })).data
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); closeForm() },
  })

  const importProducts = useMutation({
    mutationFn: async () => {
      const bulk = csv.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [name, weight, packaging, unitsPerPackage, category] = line.split(',').map((c) => c.trim())
        return { name, weight: parseFloat(weight) || 0, packaging, unitsPerPackage: unitsPerPackage ? parseFloat(unitsPerPackage) : null, category }
      })
      return (await axios.post('/api/products', { bulk }, { headers: { Authorization: `Bearer ${token}` } })).data
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); setShowImport(false); setCsv('') },
  })

  const importWarehouse = useMutation({
    mutationFn: async () => {
      const res = await axios.post('/api/products/import-warehouse', {}, { headers: { Authorization: `Bearer ${token}` } })
      return res.data as { total: number; creados: number; actualizados: number; sinPeso: number }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setWarehouseErr('')
      setWarehouseMsg(t('prod.importWarehouseResult', { c: data.creados, u: data.actualizados }))
    },
    onError: (err: unknown) => {
      setWarehouseMsg('')
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : null
      setWarehouseErr(msg || t('prod.importWarehouseError'))
    },
  })

  const deleteProduct = useMutation({
    mutationFn: async (id: string) => { await axios.delete(`/api/products/${id}`, { headers: { Authorization: `Bearer ${token}` } }) },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  })

  const closeForm = () => { setShowForm(false); setForm(emptyForm) }
  const openCreate = () => { setForm(emptyForm); setShowForm(true) }
  const openEdit = (p: Product) => {
    setForm({ id: p.id, name: p.name, weight: String(p.weight), packaging: p.packaging || '', unitsPerPackage: p.unitsPerPackage != null ? String(p.unitsPerPackage) : '', category: p.category || '' })
    setShowForm(true)
  }

  const q = search.trim().toLowerCase()
  const filtered = products.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q) || (p.packaging || '').toLowerCase().includes(q))

  const paged = usePagedList(filtered, 25)

  return (
    <div className="flex flex-col">
      <Navbar title={t('prod.title')} />
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft">{t('prod.subtitle')}</p>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Icon icon="mdi:magnify" className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft/50" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('common.search')}
                className="pl-9 pr-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
            <button onClick={() => setShowImport(true)} className="px-4 py-2 border border-line rounded-xl text-sm font-medium hover:bg-ink/[0.03] flex items-center gap-1.5">
              <Icon icon="mdi:file-import-outline" />{t('prod.import')}
            </button>
            <button onClick={() => importWarehouse.mutate()} disabled={importWarehouse.isPending} className="px-4 py-2 border border-line rounded-xl text-sm font-medium hover:bg-ink/[0.03] flex items-center gap-1.5 disabled:opacity-50">
              <Icon icon="mdi:cloud-download-outline" />{importWarehouse.isPending ? t('prod.importingWarehouse') : t('prod.importWarehouse')}
            </button>
            <button onClick={openCreate} className="bg-primary text-white px-4 py-2 rounded-xl font-medium hover:bg-[#1840bd]">{t('prod.new')}</button>
          </div>
        </div>

        {warehouseMsg && (
          <div className="bg-green-50 text-green-700 px-3 py-2 rounded-xl text-sm flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5"><Icon icon="mdi:check-circle-outline" />{warehouseMsg}</span>
            <button onClick={() => setWarehouseMsg('')} className="text-green-700/70 hover:text-green-700"><Icon icon="mdi:close" /></button>
          </div>
        )}
        {warehouseErr && (
          <div className="bg-red-50 text-red-600 px-3 py-2 rounded-xl text-sm flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5"><Icon icon="mdi:alert-circle-outline" />{warehouseErr}</span>
            <button onClick={() => setWarehouseErr('')} className="text-red-600/70 hover:text-red-600"><Icon icon="mdi:close" /></button>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-md overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center text-ink-soft">{t('prod.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-ink-soft">{t('prod.empty')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-soft">
                  <th className="px-4 py-3 font-semibold">{t('prod.name')}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t('prod.weight')}</th>
                  <th className="px-4 py-3 font-semibold">{t('prod.packaging')}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t('prod.unitsPerPackage')}</th>
                  <th className="px-4 py-3 font-semibold">{t('prod.category')}</th>
                  <th className="px-4 py-3 font-semibold">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageItems.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-ink/[0.015]">
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3 text-right font-mono">{p.weight} kg</td>
                    <td className="px-4 py-3 text-ink-soft">{p.packaging || '—'}</td>
                    <td className="px-4 py-3 text-right font-mono">{p.unitsPerPackage ?? '—'}</td>
                    <td className="px-4 py-3">{p.category ? <span className="text-xs bg-accent/10 text-accent rounded-full px-2 py-0.5">{p.category}</span> : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button onClick={() => openEdit(p)} className="text-primary hover:underline text-xs font-medium flex items-center gap-1"><Icon icon="mdi:pencil-outline" />{t('common.edit')}</button>
                        <button onClick={() => deleteProduct.mutate(p.id)} className="text-red-500 hover:underline text-xs font-medium flex items-center gap-1"><Icon icon="mdi:trash-can-outline" />{t('common.delete')}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!isLoading && filtered.length > 0 && (
            <Pagination
              page={paged.page}
              totalPages={paged.totalPages}
              total={paged.total}
              from={paged.from}
              to={paged.to}
              pageSize={paged.pageSize}
              onPage={paged.setPage}
              onPageSize={paged.setPageSize}
            />
          )}
        </div>
      </div>

      {/* Create / edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) closeForm() }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
            <h3 className="text-lg font-bold mb-4">{form.id ? t('prod.editTitle') : t('prod.createTitle')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-ink-soft mb-1">{t('prod.name')}</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">{t('prod.weight')}</label>
                <input type="number" step="0.001" min="0" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} className="w-full px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">{t('prod.unitsPerPackage')}</label>
                <input type="number" step="1" min="0" value={form.unitsPerPackage} onChange={(e) => setForm({ ...form, unitsPerPackage: e.target.value })} className="w-full px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">{t('prod.packaging')}</label>
                <input value={form.packaging} onChange={(e) => setForm({ ...form, packaging: e.target.value })} placeholder="caja, saco, bolsa..." className="w-full px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">{t('prod.category')}</label>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={closeForm} className="px-4 py-2 border border-line rounded-xl text-ink-soft hover:bg-ink/[0.03]">{t('common.cancel')}</button>
              <button onClick={() => saveProduct.mutate()} disabled={!form.name.trim() || saveProduct.isPending} className="px-4 py-2 bg-primary text-white rounded-xl font-medium hover:bg-[#1840bd] disabled:opacity-50">
                {form.id ? t('common.update') : t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowImport(false) }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
            <h3 className="text-lg font-bold mb-1">{t('prod.importTitle')}</h3>
            <p className="text-xs text-ink-soft mb-3">{t('prod.importHint')}</p>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={8}
              placeholder={'Arroz, 1, saco, 25, Granos\nAceite, 0.9, botella, 12, Líquidos'}
              className="w-full px-3 py-2 border border-line rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowImport(false)} className="px-4 py-2 border border-line rounded-xl text-ink-soft hover:bg-ink/[0.03]">{t('common.cancel')}</button>
              <button onClick={() => importProducts.mutate()} disabled={!csv.trim() || importProducts.isPending} className="px-4 py-2 bg-primary text-white rounded-xl font-medium hover:bg-[#1840bd] disabled:opacity-50">
                {importProducts.isPending ? '...' : t('prod.importBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
