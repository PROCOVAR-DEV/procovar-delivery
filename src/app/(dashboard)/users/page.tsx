'use client'

import { useState } from 'react'
import axios from 'axios'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'
import { useAppStore } from '@/store/useAppStore'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

interface UserRow {
  id: string
  email: string
  name: string
  role: string
  createdAt: string
  _count?: {
    orders: number
    routes: number
    vehicles: number
  }
}

const defaultCreate = {
  name: '',
  email: '',
  password: '',
  role: 'operator',
}

export default function UsersPage() {
  const { token, user } = useAppStore()
  const t = useT()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(defaultCreate)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('operator')
  const [editPassword, setEditPassword] = useState('')

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await axios.get('/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      })
      return res.data as UserRow[]
    },
    enabled: !!token && user?.role === 'admin'
  })

  const createUser = useMutation({
    mutationFn: async (payload: typeof defaultCreate) => {
      const res = await axios.post('/api/users', payload, {
        headers: { Authorization: `Bearer ${token}` }
      })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setForm(defaultCreate)
      setShowCreate(false)
    }
  })

  const updateUser = useMutation({
    mutationFn: async (payload: { id: string; name: string; role: string; password?: string }) => {
      const res = await axios.patch(`/api/users/${payload.id}`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setEditing(null)
      setEditName('')
      setEditRole('operator')
      setEditPassword('')
    }
  })

  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      await axios.delete(`/api/users/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    }
  })

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col">
        <Navbar title={t('usr.title')} />
        <div className="p-6">
          <div className="bg-white rounded-2xl p-6 shadow-md text-red-600 text-sm">
            {t('usr.noPermission')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <Navbar title={t('usr.title')} />
      <div className="p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-700">{t('usr.admin')}</h3>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary text-white px-4 py-2 rounded-xl font-medium hover:bg-blue-700"
          >
            {t('usr.new')}
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-md overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">{t('usr.loading')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-3">{t('common.name')}</th>
                  <th className="text-left px-4 py-3">{t('usr.colEmail')}</th>
                  <th className="text-left px-4 py-3">{t('usr.colRole')}</th>
                  <th className="text-left px-4 py-3">{t('usr.colActivity')}</th>
                  <th className="text-left px-4 py-3">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr key={row.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">{row.name}</td>
                    <td className="px-4 py-3 text-gray-600">{row.email}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">{row.role}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {row._count ? t('usr.activity', { o: row._count.orders, r: row._count.routes, v: row._count.vehicles }) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button
                          onClick={() => {
                            setEditing(row)
                            setEditName(row.name)
                            setEditRole(row.role)
                            setEditPassword('')
                          }}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium flex items-center gap-1"
                        >
                          <Icon icon="mdi:pencil-outline" className="text-sm" /> {t('common.edit')}
                        </button>
                        <button
                          onClick={() => deleteUser.mutate(row.id)}
                          disabled={row.id === user.id}
                          className="text-red-600 hover:text-red-800 text-xs font-medium disabled:opacity-40 flex items-center gap-1"
                        >
                          <Icon icon="mdi:trash-can-outline" className="text-sm" /> {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false) }}
        >
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">{t('usr.createTitle')}</h3>
            <div className="space-y-3">
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t('usr.fullName')}
                className="w-full px-3 py-2 border rounded-xl"
              />
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder={t('usr.email')}
                className="w-full px-3 py-2 border rounded-xl"
              />
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={t('usr.tempPassword')}
                className="w-full px-3 py-2 border rounded-xl"
              />
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full px-3 py-2 border rounded-xl"
              >
                <option value="admin">admin</option>
                <option value="operator">operator</option>
                <option value="dispatcher">dispatcher</option>
                <option value="viewer">viewer</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-xl">{t('common.cancel')}</button>
              <button
                onClick={() => createUser.mutate(form)}
                className="px-4 py-2 bg-primary text-white rounded-xl"
                disabled={createUser.isPending || !form.name || !form.email || !form.password}
              >
                {t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(null) }}
        >
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">{t('usr.editTitle')}</h3>
            <div className="space-y-3">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t('usr.fullName')}
                className="w-full px-3 py-2 border rounded-xl"
              />
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl"
              >
                <option value="admin">admin</option>
                <option value="operator">operator</option>
                <option value="dispatcher">dispatcher</option>
                <option value="viewer">viewer</option>
              </select>
              <input
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder={t('usr.newPassword')}
                className="w-full px-3 py-2 border rounded-xl"
              />
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-xl">{t('common.cancel')}</button>
              <button
                onClick={() => {
                  updateUser.mutate({
                    id: editing.id,
                    name: editName,
                    role: editRole,
                    ...(editPassword ? { password: editPassword } : {})
                  })
                }}
                className="px-4 py-2 bg-primary text-white rounded-xl"
                disabled={updateUser.isPending || !editName}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
