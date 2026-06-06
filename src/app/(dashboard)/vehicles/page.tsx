'use client'

import { useState } from 'react'
import Navbar from '@/components/Navbar'
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
  _count: { routes: number; orders: number }
  routes?: { id: string; name: string; status: string }[]
}

interface VehicleFormData {
  name: string
  type: string
  plate: string
  capacity: string
  status: string
  notes: string
}

const defaultForm: VehicleFormData = {
  name: '',
  type: 'truck',
  plate: '',
  capacity: '1000',
  status: 'available',
  notes: '',
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
    })
    setShowModal(true)
  }

  const openCreate = () => {
    setEditingVehicle(null)
    setForm(defaultForm)
    setShowModal(true)
  }

  return (
    <div className="flex flex-col">
      <Navbar title={t('veh.title')} />
      <div className="p-6">

        <div className="flex justify-between items-center mb-6">
          <p className="text-gray-500 text-sm">{t('veh.manageHint')}</p>
          <button
            onClick={openCreate}
            className="bg-primary text-white px-5 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Icon icon="mdi:plus" className="text-lg" />
            {t('veh.add')}
          </button>
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
            {(vehicles as Vehicle[]).map((vehicle) => (
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
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {vehicleTypes.map((vt) => (
                      <option key={vt.value} value={vt.value}>{t(`veh.type.${vt.value}`)}</option>
                    ))}
                  </select>
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
    </div>
  )
}
