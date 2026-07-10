'use client'

import { useState } from 'react'
import axios from 'axios'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'
import Pagination, { usePagedList } from '@/components/Pagination'
import LocationInput, { LocationValue } from '@/components/LocationInput'
import { useAppStore } from '@/store/useAppStore'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

interface Branch {
  id: string
  name: string
  externalId?: string | null
  address?: string | null
  lat: number
  lng: number
  areaKm2: number
  _count?: { members: number; origins: number }
}

interface StartPoint {
  id: string
  name: string
  address: string
  lat: number
  lng: number
}

const emptyLoc: LocationValue = { address: '', lat: null, lng: null }

export default function BranchesPage() {
  const { token, user } = useAppStore()
  const t = useT()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Branch | null>(null)
  const [name, setName] = useState('')
  const [externalId, setExternalId] = useState('')
  const [area, setArea] = useState('1')
  const [loc, setLoc] = useState<LocationValue>(emptyLoc)

  // Start points (puntos de partida) management for one branch
  const [spBranch, setSpBranch] = useState<Branch | null>(null)
  const [spName, setSpName] = useState('')
  const [spLoc, setSpLoc] = useState<LocationValue>(emptyLoc)

  const { data: startPoints = [] } = useQuery({
    queryKey: ['origins', spBranch?.id],
    queryFn: async () => {
      const res = await axios.get(`/api/origins?branchId=${spBranch!.id}`, { headers: { Authorization: `Bearer ${token}` } })
      return res.data as StartPoint[]
    },
    enabled: !!token && !!spBranch,
  })

  const addStartPoint = useMutation({
    mutationFn: async () => {
      return (await axios.post('/api/origins', { name: spName.trim(), address: spLoc.address, lat: spLoc.lat, lng: spLoc.lng, branchId: spBranch!.id }, { headers: { Authorization: `Bearer ${token}` } })).data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['origins'] })
      queryClient.invalidateQueries({ queryKey: ['branches'] })
      setSpName('')
      setSpLoc(emptyLoc)
    },
  })

  const deleteStartPoint = useMutation({
    mutationFn: async (id: string) => { await axios.delete(`/api/origins/${id}`, { headers: { Authorization: `Bearer ${token}` } }) },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['origins'] })
      queryClient.invalidateQueries({ queryKey: ['branches'] })
    },
  })

  const { data: branches = [], isLoading } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await axios.get('/api/branches', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as Branch[]
    },
    enabled: !!token && user?.role === 'admin',
  })

  const saveBranch = useMutation({
    mutationFn: async () => {
      const payload = { name, externalId: externalId.trim() || null, address: loc.address, lat: loc.lat, lng: loc.lng, areaKm2: parseFloat(area) || 1 }
      if (editing) {
        const res = await axios.patch(`/api/branches/${editing.id}`, payload, { headers: { Authorization: `Bearer ${token}` } })
        return res.data
      }
      const res = await axios.post('/api/branches', payload, { headers: { Authorization: `Bearer ${token}` } })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] })
      close()
    },
  })

  const deleteBranch = useMutation({
    mutationFn: async (id: string) => {
      await axios.delete(`/api/branches/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['branches'] }),
  })

  const close = () => {
    setShowModal(false)
    setEditing(null)
    setName('')
    setExternalId('')
    setArea('1')
    setLoc(emptyLoc)
  }

  const openCreate = () => {
    close()
    setShowModal(true)
  }

  const openEdit = (b: Branch) => {
    setEditing(b)
    setName(b.name)
    setExternalId(b.externalId || '')
    setArea(String(b.areaKm2))
    setLoc({ address: b.address || '', lat: b.lat, lng: b.lng })
    setShowModal(true)
  }

  const canSave = name.trim() !== '' && loc.lat != null && loc.lng != null

  const q = search.trim().toLowerCase()
  const filtered = branches.filter((b) =>
    !q
    || b.name.toLowerCase().includes(q)
    || (b.externalId || '').toLowerCase().includes(q)
    || (b.address || '').toLowerCase().includes(q)
  )

  const paged = usePagedList(filtered, 25)

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col">
        <Navbar title={t('br.title')} />
        <div className="p-6">
          <div className="bg-white rounded-2xl p-6 shadow-md text-red-600 text-sm">{t('br.noPermission')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <Navbar title={t('br.title')} />
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <p className="text-sm text-gray-500">{t('br.subtitle')}</p>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Icon icon="mdi:magnify" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('common.search')}
                className="pl-9 pr-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button onClick={openCreate} className="bg-primary text-white px-5 py-2 rounded-xl font-medium hover:bg-blue-700">
              {t('br.new')}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-2xl shadow-md p-12 text-center text-gray-500">{t('br.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-12 text-center text-gray-500">{t('br.empty')}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paged.pageItems.map((b) => (
              <div key={b.id} className="bg-white rounded-2xl shadow-md p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-800 truncate flex items-center gap-1">
                      <Icon icon="mdi:office-building-marker-outline" className="text-primary" />{b.name}
                    </h3>
                    <div className="mt-1">
                      {b.externalId ? (
                        <span className="text-[11px] bg-ink/[0.06] text-ink px-2 py-0.5 rounded-md font-mono font-semibold uppercase">{b.externalId}</span>
                      ) : (
                        <span className="text-[11px] text-gray-400 italic">{t('br.noCode')}</span>
                      )}
                    </div>
                    {b.address && <p className="text-xs text-gray-500 truncate mt-0.5">{b.address}</p>}
                    <p className="text-xs text-gray-400 mt-0.5 font-mono">{b.lat.toFixed(4)}, {b.lng.toFixed(4)}</p>
                  </div>
                  <span className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full shrink-0 font-mono font-semibold">{b.areaKm2} km²</span>
                </div>
                <button
                  onClick={() => setSpBranch(b)}
                  className="w-full mt-3 flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-ink/[0.03] hover:bg-primary/[0.07] transition-colors text-left"
                >
                  <span className="text-xs font-medium text-ink flex items-center gap-1.5">
                    <Icon icon="mdi:map-marker-radius-outline" className="text-primary" />{t('br.startPoints')}
                  </span>
                  <span className="text-xs font-mono text-ink-soft flex items-center gap-1">
                    {b._count?.origins ?? 0}<Icon icon="mdi:chevron-right" />
                  </span>
                </button>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-gray-500">{t('br.members', { n: b._count?.members ?? 0 })}</span>
                  <div className="flex gap-3">
                    <button onClick={() => openEdit(b)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                      <Icon icon="mdi:pencil-outline" />{t('common.edit')}
                    </button>
                    <button onClick={() => deleteBranch.mutate(b.id)} className="text-xs text-red-500 hover:underline flex items-center gap-1">
                      <Icon icon="mdi:trash-can-outline" />{t('common.delete')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {!isLoading && filtered.length > 0 && (
          <div className="bg-white rounded-2xl shadow-md overflow-hidden">
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
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) close() }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-xl shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">{editing ? t('br.editTitle') : t('br.createTitle')}</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('br.name')}</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('br.area')}</label>
                  <input type="number" step="0.1" min="0.1" value={area} onChange={(e) => setArea(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('br.code')}</label>
                <input type="text" value={externalId} onChange={(e) => setExternalId(e.target.value.toUpperCase())}
                  placeholder={t('br.codePlaceholder')}
                  className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono uppercase" />
                <p className="text-xs text-gray-400 mt-1">{t('br.codeNote')}</p>
              </div>
              <LocationInput value={loc} onChange={setLoc} label={t('br.location')} markerColor="#16a34a" />
              <div className="flex gap-2 justify-end pt-2">
                <button onClick={close} className="px-4 py-2 border rounded-xl text-gray-600 hover:bg-gray-50">{t('common.cancel')}</button>
                <button onClick={() => saveBranch.mutate()} disabled={!canSave || saveBranch.isPending}
                  className="px-4 py-2 bg-primary text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50">
                  {editing ? t('common.update') : t('common.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Start points (puntos de partida) of a branch */}
      {spBranch && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setSpBranch(null); setSpName(''); setSpLoc(emptyLoc) } }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Icon icon="mdi:map-marker-radius-outline" className="text-primary" />{t('br.startPoints')}
              </h3>
              <button onClick={() => { setSpBranch(null); setSpName(''); setSpLoc(emptyLoc) }} className="text-gray-400 hover:text-gray-600"><Icon icon="mdi:close" className="text-xl" /></button>
            </div>
            <p className="text-xs text-ink-soft mb-4">{spBranch.name} · {t('br.startPointsHint')}</p>

            {/* Existing points */}
            <div className="space-y-2 mb-5">
              {startPoints.length === 0 ? (
                <div className="text-sm text-ink-soft/70 text-center py-4 bg-ink/[0.02] rounded-xl">{t('br.noStartPoints')}</div>
              ) : (
                startPoints.map((sp) => (
                  <div key={sp.id} className="flex items-center gap-3 p-3 border border-line rounded-xl">
                    <Icon icon="mdi:map-marker-outline" className="text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{sp.name}</p>
                      <p className="text-[11px] text-ink-soft/70 truncate">{sp.address}</p>
                      <p className="text-[11px] text-ink-soft/60 font-mono">{sp.lat.toFixed(4)}, {sp.lng.toFixed(4)}</p>
                    </div>
                    <button onClick={() => deleteStartPoint.mutate(sp.id)} className="text-red-400 hover:text-red-600 shrink-0"><Icon icon="mdi:trash-can-outline" /></button>
                  </div>
                ))
              )}
            </div>

            {/* Add new point */}
            <div className="border-t border-line pt-4 space-y-3">
              <input
                value={spName}
                onChange={(e) => setSpName(e.target.value)}
                placeholder={t('br.startPointName')}
                className="w-full px-3 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <LocationInput value={spLoc} onChange={setSpLoc} label="" markerColor="#16a34a" />
              <div className="flex justify-end">
                <button
                  onClick={() => addStartPoint.mutate()}
                  disabled={!spName.trim() || spLoc.lat == null || addStartPoint.isPending}
                  className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-[#1840bd] disabled:opacity-50"
                >
                  {t('br.addStartPoint')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
