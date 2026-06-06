'use client'

import Link from 'next/link'
import { Icon } from '@iconify/react'
import { useT } from '@/lib/i18n'

export default function RegisterPage() {
  const t = useT()
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-md p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 flex items-center justify-center gap-2"><Icon icon="mdi:truck-delivery" className="text-primary" /> ProCovar</h1>
          <p className="text-gray-500 mt-2">{t('register.policy')}</p>
        </div>

        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-sm">
          {t('register.disabled')}
        </div>

        <p className="text-center text-sm text-gray-500 mt-6">
          {t('register.haveAccount')}{' '}
          <Link href="/login" className="text-primary font-medium hover:underline">
            {t('login.signIn')}
          </Link>
        </p>
      </div>
    </div>
  )
}
