'use client'

import { useState } from 'react'
import Navbar from '@/components/Navbar'
import Pagination, { usePagedList } from '@/components/Pagination'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

interface Vehicle {
  id: string
  name: string
  type: string
  plate: string | null
  capacity: number
  status: string
  notes: string | null
  costoKmUsd: number | null
  usarParaDomicilio: boolean
  _count: { routes: number; orders: number }
  routes?: { id: string; name: string; status: string }[]
}

interface TipoVehiculo {
  nombre: string
  costoKmUsd: number
}

interface VehicleFormData {
  name: string
  type: string
  plate: string
  capacity: string
  status: string
  notes: string
  costoKmUsd: string
  usarParaDomicilio: boolean
}

const defaultForm: VehicleFormData = {
  name: '',
  type: 'truck',
  plate: '',
  capacity: '1000',
  status: 'available',
  notes: '',
  costoKmUsd: '',
  usarParaDomicilio: false,
}

const vehicleTypes = [
  { value: 'truck', icon: 'mdi:truck' },
  { value: 'van', icon: 'mdi:van-utility' },
  { value: 'motorcycle', icon: 'mdi:motorbike' },
  { value: 'car', icon: 'mdi:car' },
  { value: 'bicycle', icon: 'mdi:bicycle' },
  { value: 'other', icon: 'mdi:truck-delivery' },
]

const statusColors: Record<string, string> = {
  available: 'bg-green-100 text-green-700',
  in_use: 'bg-blue-100 text-blue-700',
  maintenance: 'bg-yellow-100 text-yellow-700',
}

function getTypeIcon(type: string) {
  return vehicleTypes.find((t) => t.value === type)?.icon || 'mdi:truck-delivery'
}

export default function VehiclesPage() {
  const { token } = useAppStore()
  const t = useT()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null)
  const [form, setForm] = useState<VehicleFormData>(defaultForm)
  const [search, setSearch] = useState('')
  // Ayudante para estimar el costo por km a partir de lo que cobra el camionero.
  const [helperCup, setHelperCup] = useState('')
  const [helperKm, setHelperKm] = useState('')
  // Editor de tipos de vehículo (costo/km "padre" heredable).
  const [showTiposModal, setShowTiposModal] = useState(false)
  const [tiposDraft, setTiposDraft] = useState<TipoVehiculo[]>([])
  // Crear tipo nuevo inline desde el form del vehículo.
  const [creatingType, setCreatingType] = useState(false)
  const [newTipoNombre, setNewTipoNombre] = useState('')
  const [newTipoCosto, setNewTipoCosto] = useState('')

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const res = await axios.get('/api/vehicles', {
        headers: { Authorization: `Bearer ${token}` }
      })
      return res.data
    },
    enabled: !!token
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await axios.get('/api/settings', {
        headers: { Authorization: `Bearer ${token}` }
      })
      return res.data
    },
    enabled: !!token
  })

  const tipoCambio = Number(settings?.domTipoCambio) || 700
  const tiposVehiculo: TipoVehiculo[] = (settings?.tiposVehiculo as TipoVehiculo[] | undefined) || []

  const saveTiposMutation = useMutation({
    mutationFn: async (tipos: TipoVehiculo[]) => {
      const res = await axios.put('/api/settings', { tiposVehiculo: tipos }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setShowTiposModal(false)
    }
  })

  // Crea un tipo nuevo desde el form del vehículo y lo selecciona.
  const createTipoInlineMutation = useMutation({
    mutationFn: async ({ nombre, costoKmUsd }: { nombre: string; costoKmUsd: number }) => {
      const nuevos = [...tiposVehiculo, { nombre, costoKmUsd }]
      const res = await axios.put('/api/settings', { tiposVehiculo: nuevos }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      return { data: res.data, nombre, costoKmUsd }
    },
    onSuccess: ({ nombre, costoKmUsd }) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setForm((f) => ({ ...f, type: nombre, costoKmUsd: String(costoKmUsd) }))
      setCreatingType(false)
      setNewTipoNombre('')
      setNewTipoCosto('')
    }
  })

  const handleCreateTipoInline = () => {
    const nombre = newTipoNombre.trim()
    if (!nombre) return
    createTipoInlineMutation.mutate({ nombre, costoKmUsd: Number(newTipoCosto) || 0 })
  }

  // Marca directamente un vehículo como el de cálculo del domicilio (desde la tarjeta).
  const usarDomicilioMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await axios.patch(`/api/vehicles/${id}`, { usarParaDomicilio: true }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    }
  })

  const openTipos = () => {
    setTiposDraft(tiposVehiculo.map((tp) => ({ nombre: tp.nombre, costoKmUsd: tp.costoKmUsd })))
    setShowTiposModal(true)
  }

  const saveTipos = () => {
    const clean = tiposDraft
      .map((tp) => ({ nombre: tp.nombre.trim(), costoKmUsd: Number(tp.costoKmUsd) || 0 }))
      .filter((tp) => tp.nombre !== '')
    saveTiposMutation.mutate(clean)
  }

  const createMutation = useMutation({
    mutationFn: async (data: unknown) => {
      const res = await axios.post('/api/vehicles', data, {
        headers: { Authorization: `Bearer ${token}` }
      })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      setShowModal(false)
      setForm(defaultForm)
    }
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: unknown }) => {
      const res = await axios.patch(`/api/vehicles/${id}`, data, {
        headers: { Authorization: `Bearer ${token}` }
      })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      setShowModal(false)
      setEditingVehicle(null)
      setForm(defaultForm)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await axios.delete(`/api/vehicles/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    }
  })

  const markAvailableMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await axios.patch(`/api/vehicles/${id}`, { status: 'available' }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['routes'] })
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data = {
      name: form.name,
      type: form.type,
      plate: form.plate || null,
      capacity: parseFloat(form.capacity) || 1000,
      status: form.status,
      notes: form.notes || null,
      costoKmUsd: form.costoKmUsd.trim() === '' ? null : parseFloat(form.costoKmUsd),
      usarParaDomicilio: form.usarParaDomicilio,
    }
    if (editingVehicle) {
      updateMutation.mutate({ id: editingVehicle.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const handleEdit = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle)
    setForm({
      name: vehicle.name,
      type: vehicle.type,
      plate: vehicle.plate || '',
      capacity: vehicle.capacity.toString(),
      status: vehicle.status,
      notes: vehicle.notes || '',
      costoKmUsd: vehicle.costoKmUsd != null ? vehicle.costoKmUsd.toString() : '',
      usarParaDomicilio: vehicle.usarParaDomicilio ?? false,
    })
    setHelperCup('')
    setHelperKm('')
    setCreatingType(false)
    setNewTipoNombre('')
    setNewTipoCosto('')
    setShowModal(true)
  }

  const openCreate = () => {
    setEditingVehicle(null)
    setForm(defaultForm)
    setHelperCup('')
    setHelperKm('')
    setCreatingType(false)
    setNewTipoNombre('')
    setNewTipoCosto('')
    setShowModal(true)
  }

  const calcCostoKm = () => {
    const cup = parseFloat(helperCup)
    const km = parseFloat(helperKm)
    if (!cup || !km || km <= 0 || !tipoCambio) return
    // costo_km(USD) = cobroCup / (2 × km × tipoCambio)   (2× por ida y vuelta)
    const value = cup / (2 * km * tipoCambio)
    setForm((f) => ({ ...f, costoKmUsd: value.toFixed(2) }))
  }

  const q = search.trim().toLowerCase()
  const filtered = (vehicles as Vehicle[]).filter((v) =>
    !q
    || v.name.toLowerCase().includes(q)
    || (v.plate || '').toLowerCase().includes(q)
  )

  const paged = usePagedList(filtered, 25)

  return (
    <div className="flex flex-col">
      <Navbar title={t('veh.title')} />
      <div className="p-6">

        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <p className="text-gray-500 text-sm">{t('veh.manageHint')}</p>
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
            <button
              onClick={openTipos}
              className="bg-white text-gray-700 border px-4 py-2 rounded-xl font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
            >
              <Icon icon="mdi:tag-multiple-outline" className="text-lg" />
              Tipos de vehículo
            </button>
            <button
              onClick={openCreate}
              className="bg-primary text-white px-5 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <Icon icon="mdi:plus" className="text-lg" />
              {t('veh.add')}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-2xl shadow-md p-12 text-center text-gray-500">
            {t('veh.loading')}
          </div>
        ) : vehicles.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-16 text-center">
            <Icon icon="mdi:truck-outline" className="text-6xl text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">{t('veh.empty')}</p>
            <p className="text-gray-400 text-sm mt-1">{t('veh.emptyHint')}</p>
            <button
              onClick={openCreate}
              className="mt-4 bg-primary text-white px-5 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors"
            >
              {t('veh.add')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {paged.pageItems.map((vehicle) => (
              <div key={vehicle.id} className="bg-white rounded-2xl shadow-md p-5 border border-gray-100 hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                      <Icon icon={getTypeIcon(vehicle.type)} className="text-2xl text-primary" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-800">{vehicle.name}</h3>
                      {vehicle.plate && (
                        <p className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-0.5 rounded mt-0.5 inline-block">
                          {vehicle.plate}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColors[vehicle.status] || 'bg-gray-100 text-gray-600'}`}>
                    {t(`veh.status.${vehicle.status}`)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {vehicle.type && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                      <Icon icon={getTypeIcon(vehicle.type)} className="text-sm" />
                      {vehicle.type}
                    </span>
                  )}
                  {vehicle.usarParaDomicilio ? (
                    <>
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-primary/10 text-primary">
                        <Icon icon="mdi:calculator-variant-outline" className="text-sm" />
                        Cálculo domicilio
                      </span>
                      {vehicle.costoKmUsd != null && (
                        <span className="text-xs font-semibold text-gray-700">${vehicle.costoKmUsd}/km</span>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => usarDomicilioMutation.mutate(vehicle.id)}
                      disabled={usarDomicilioMutation.isPending}
                      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                    >
                      <Icon icon="mdi:calculator-variant-outline" className="text-sm" />
                      Usar para domicilio
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4 text-center">
                  <div className="bg-gray-50 rounded-xl p-2">
                    <p className="text-xs text-gray-500">{t('veh.capacity')}</p>
                    <p className="font-semibold text-sm text-gray-800">{vehicle.capacity.toLocaleString()} kg</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2">
                    <p className="text-xs text-gray-500">{t('veh.routes')}</p>
                    <p className="font-semibold text-sm text-gray-800">{vehicle._count.routes}</p>
                  </div>
                </div>

                {vehicle.status === 'in_use' && vehicle.routes && vehicle.routes[0] && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 mb-3 flex items-center gap-2">
                    <Icon icon="mdi:map-marker-path" className="text-blue-600 text-base shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-blue-500 font-medium">{t('veh.activeRoute')}</p>
                      <p className="text-sm text-blue-800 font-semibold truncate">{vehicle.routes[0].name}</p>
                    </div>
                  </div>
                )}

                <div className="text-xs text-gray-500 mb-4">
                  <span className="flex items-center gap-1">
                    <Icon icon="mdi:package-variant-closed" className="text-sm" />
                    {t('veh.ordersAssigned', { n: vehicle._count.orders })}
                  </span>
                </div>

                {vehicle.notes && (
                  <p className="text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg mb-3 line-clamp-2">{vehicle.notes}</p>
                )}

                <div className="flex flex-col gap-2 pt-2 border-t">
                  {vehicle.status === 'in_use' && (
                    <button
                      onClick={() => markAvailableMutation.mutate(vehicle.id)}
                      disabled={markAvailableMutation.isPending}
                      className="flex items-center justify-center gap-1 text-sm text-green-600 hover:bg-green-50 py-2 rounded-xl transition-colors font-medium border border-green-200 disabled:opacity-50"
                    >
                      <Icon icon="mdi:check-circle-outline" className="text-base" />
                      {t('veh.markAvailable')}
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(vehicle)}
                      className="flex-1 flex items-center justify-center gap-1 text-sm text-blue-600 hover:bg-blue-50 py-2 rounded-xl transition-colors font-medium"
                    >
                      <Icon icon="mdi:pencil-outline" className="text-base" />
                      {t('common.edit')}
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(vehicle.id)}
                      className="flex-1 flex items-center justify-center gap-1 text-sm text-red-500 hover:bg-red-50 py-2 rounded-xl transition-colors font-medium"
                    >
                      <Icon icon="mdi:trash-can-outline" className="text-base" />
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="bg-white rounded-2xl shadow-md mt-5 overflow-hidden">
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
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowModal(false); setEditingVehicle(null); setForm(defaultForm) } }}
        >
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-5 flex items-center gap-2">
              <Icon icon="mdi:truck-delivery" className="text-primary text-xl" />
              {editingVehicle ? t('veh.editTitle') : t('veh.newTitle')}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('veh.nameLabel')}</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={t('veh.namePh')}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('veh.type')}</label>
                  {(() => {
                    const isKnown = tiposVehiculo.some((tp) => tp.nombre === form.type)
                    // Si el tipo actual no está en la lista (valor heredado/legacy), lo mostramos igual.
                    const showLegacy = !creatingType && !isKnown && form.type.trim() !== ''
                    return (
                      <>
                        <select
                          value={creatingType ? '__create__' : (isKnown ? form.type : (showLegacy ? form.type : ''))}
                          onChange={(e) => {
                            const val = e.target.value
                            if (val === '__create__') {
                              setCreatingType(true)
                              return
                            }
                            setCreatingType(false)
                            const tp = tiposVehiculo.find((x) => x.nombre === val)
                            setForm((f) => ({
                              ...f,
                              type: val,
                              // Hereda el costo/km del tipo (el usuario puede editarlo luego).
                              costoKmUsd: tp && tp.costoKmUsd != null ? String(tp.costoKmUsd) : f.costoKmUsd,
                            }))
                          }}
                          className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {showLegacy && (
                            <option value={form.type}>{form.type}</option>
                          )}
                          {tiposVehiculo.length === 0 && !showLegacy && (
                            <option value="" disabled>Sin tipos configurados</option>
                          )}
                          {tiposVehiculo.map((tp) => (
                            <option key={tp.nombre} value={tp.nombre}>{tp.nombre} · ${tp.costoKmUsd}/km</option>
                          ))}
                          <option value="__create__">+ Crear tipo nuevo…</option>
                        </select>
                        {creatingType && (
                          <div className="mt-2 p-3 bg-gray-50 rounded-xl space-y-2">
                            <div className="grid grid-cols-[1fr_130px] gap-2">
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">Nombre del tipo</label>
                                <input
                                  type="text"
                                  value={newTipoNombre}
                                  onChange={(e) => setNewTipoNombre(e.target.value)}
                                  className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  placeholder="Camión"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">Costo por km (USD)</label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={newTipoCosto}
                                    onChange={(e) => setNewTipoCosto(e.target.value)}
                                    className="w-full pl-7 pr-2 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="1.65"
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={handleCreateTipoInline}
                                disabled={createTipoInlineMutation.isPending || newTipoNombre.trim() === ''}
                                className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                              >
                                {createTipoInlineMutation.isPending ? '...' : 'Crear tipo'}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setCreatingType(false); setNewTipoNombre(''); setNewTipoCosto('') }}
                                className="px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50"
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('veh.plate')}</label>
                  <input
                    type="text"
                    value={form.plate}
                    onChange={(e) => setForm({ ...form, plate: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase"
                    placeholder="ABC-1234"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('veh.capacityMax')}</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.capacity}
                    onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.status')}</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="available">{t('veh.status.available')}</option>
                    <option value="in_use">{t('veh.status.in_use')}</option>
                    <option value="maintenance">{t('veh.status.maintenance')}</option>
                  </select>
                </div>
              </div>

              {/* Configuración del cálculo del domicilio (fórmula oficial) */}
              <div className="border-t pt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Costo por km (USD)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.costoKmUsd}
                      onChange={(e) => setForm({ ...form, costoKmUsd: e.target.value })}
                      className="w-full pl-8 pr-4 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="1.65"
                    />
                  </div>
                </div>

                <details className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700">
                  <summary className="cursor-pointer font-medium select-none flex items-center gap-1">
                    <Icon icon="mdi:calculator-variant-outline" className="text-base" />
                    ¿No sabes el costo por km?
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">El camionero cobra (CUP)</label>
                        <input
                          type="number"
                          min="0"
                          value={helperCup}
                          onChange={(e) => setHelperCup(e.target.value)}
                          className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="180000"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">hasta ___ km (ida)</label>
                        <input
                          type="number"
                          min="0"
                          value={helperKm}
                          onChange={(e) => setHelperKm(e.target.value)}
                          className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="72"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={calcCostoKm}
                        className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-blue-700"
                      >
                        Calcular
                      </button>
                      {form.costoKmUsd && (
                        <span className="text-sm text-gray-600">
                          = <span className="font-semibold text-gray-800">${form.costoKmUsd}/km</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">Tipo de cambio: {tipoCambio} CUP/USD. Se divide entre 2×km (ida y vuelta).</p>
                  </div>
                </details>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.usarParaDomicilio}
                    onChange={(e) => setForm({ ...form, usarParaDomicilio: e.target.checked })}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary focus:ring-blue-500"
                  />
                  <span>
                    <span className="text-sm font-medium text-gray-700">Usar este vehículo para calcular el domicilio</span>
                    <span className="block text-xs text-gray-400">Solo un vehículo por TIPO.</span>
                  </span>
                </label>
              </div>

              <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 flex items-center gap-1">
                <Icon icon="mdi:lightbulb-on-outline" className="shrink-0" />{t('veh.feesHint')}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('veh.notes')}</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder={t('veh.notesPh')}
                />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditingVehicle(null); setForm(defaultForm) }}
                  className="px-4 py-2 border rounded-xl text-gray-600 hover:bg-gray-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-5 py-2 bg-primary text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {editingVehicle ? t('common.update') : t('veh.add')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTiposModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowTiposModal(false) }}
        >
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
              <Icon icon="mdi:tag-multiple-outline" className="text-primary text-xl" />
              Tipos de vehículo
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Define cada tipo con su costo por km por defecto. Al crear un vehículo de ese tipo se hereda el costo/km (editable por vehículo).
            </p>

            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_130px_auto] gap-2 text-xs font-medium text-gray-500 px-1">
                <span>Nombre</span>
                <span>Costo/km (USD)</span>
                <span></span>
              </div>
              {tiposDraft.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Sin tipos. Agrega el primero.</p>
              )}
              {tiposDraft.map((tp, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_130px_auto] gap-2 items-center">
                  <input
                    type="text"
                    value={tp.nombre}
                    onChange={(e) => setTiposDraft(tiposDraft.map((x, i) => i === idx ? { ...x, nombre: e.target.value } : x))}
                    className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Camión"
                  />
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tp.costoKmUsd}
                      onChange={(e) => setTiposDraft(tiposDraft.map((x, i) => i === idx ? { ...x, costoKmUsd: parseFloat(e.target.value) || 0 } : x))}
                      className="w-full pl-7 pr-2 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="1.65"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setTiposDraft(tiposDraft.filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-600 p-2"
                    title="Quitar"
                  >
                    <Icon icon="mdi:trash-can-outline" className="text-lg" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setTiposDraft([...tiposDraft, { nombre: '', costoKmUsd: 0 }])}
              className="mt-3 w-full py-2.5 border-2 border-dashed border-blue-300 text-blue-600 rounded-xl text-sm font-medium hover:bg-blue-50 flex items-center justify-center gap-1"
            >
              <Icon icon="mdi:plus" />
              Agregar tipo
            </button>

            <div className="flex gap-3 justify-end pt-5">
              <button
                type="button"
                onClick={() => setShowTiposModal(false)}
                className="px-4 py-2 border rounded-xl text-gray-600 hover:bg-gray-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={saveTipos}
                disabled={saveTiposMutation.isPending}
                className="px-5 py-2 bg-primary text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saveTiposMutation.isPending ? '...' : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
