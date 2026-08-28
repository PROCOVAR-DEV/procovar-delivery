'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useCurrency } from '@/lib/useCurrency'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'
import axios from 'axios'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import UserMenu from '@/components/UserMenu'
import Selector from '@/components/Selector'

interface Branch {
  id: string
  name: string
  externalId?: string | null
}

// Muestra "nombre (CÓDIGO)" si la sucursal tiene código.
function branchLabel(b?: Branch | null) {
  if (!b) return ''
  return b.externalId ? `${b.name} (${b.externalId})` : b.name
}

export default function Navbar({ title }: { title: string }) {
  const { token, language, setLanguage, sucursalId, setSucursalId } = useAppStore()
  const { code, currencies, setDisplayCurrency, aviso, hayCup } = useCurrency()
  const queryClient = useQueryClient()
  /**
   * Si hay algo cargando, se dice.
   *
   * Cambiar de sucursal vuelve a pedirlo todo, y hasta que llega se sigue viendo lo de
   * antes: durante un par de segundos la pantalla enseña los números de «todas» con
   * «Camagüey» puesto arriba. Sin decir nada, eso no se lee como «está cargando» sino
   * como «el selector no hace nada».
   */
  const cargando = useIsFetching() > 0
  const t = useT()

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await axios.get('/api/branches', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as Branch[]
    },
    enabled: !!token,
  })

  /**
   * Quién ve el selector: quien puede ver MÁS DE UNA sucursal.
   *
   * Antes se decidía por `user.branchId` —«si no tiene sucursal, es admin»—, y eso lo
   * decide el navegador con lo que lleva el token. El token dura siete días y puede traer
   * una sucursal que ya no existe: entonces el servidor devuelve todas y la barra seguía
   * enseñando el nombre fijo de una sucursal muerta.
   *
   * Lo que manda es lo que el servidor deja ver. `/api/branches` devuelve exactamente
   * eso: si vienen varias, hay selector; si viene una, se enseña su nombre y ya —sin
   * "todas las sucursales", que para quien lleva una no significa nada—; y si no viene
   * ninguna, no se enseña nada en vez de un desplegable vacío.
   */
  const variasSucursales = branches.length > 1
  const unica = branches.length === 1 ? branches[0] : null

  /**
   * Y si la elegida ya no está entre las que se pueden ver, se olvida.
   *
   * Pasa al cambiar de cuenta o cuando se recrean las sucursales: el navegador guarda un
   * id que esta persona ya no puede elegir, y el selector se queda enseñando un valor que
   * no está en la lista — en blanco, y filtrando por algo que nadie ve.
   */
  useEffect(() => {
    if (!branches.length || !sucursalId) return
    if (!branches.some((b) => b.id === sucursalId)) setSucursalId(null)
  }, [branches, sucursalId, setSucursalId])

  return (
    <div className="h-16 bg-paper/80 backdrop-blur border-b border-line px-6 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-[1.4rem] font-bold text-ink tracking-tight truncate">{title}</h2>
        {/* Que se vea que hay algo en marcha. Sin esto, el rato entre pedir los datos y
            recibirlos se lee como que el filtro no funciona. */}
        {cargando && (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-soft/70">
            <Icon icon="mdi:loading" className="animate-spin text-sm" />
            actualizando…
          </span>
        )}
      </div>
      <div className="flex items-center gap-2.5">
        {branches.length > 0 && (
          <>
            {variasSucursales ? (
              <Selector
                titulo="Sucursal que se está mirando"
                icono="mdi:store-outline"
                valor={sucursalId ?? ''}
                todos={`Todas las sucursales (${branches.length})`}
                opciones={branches.map((b) => ({ valor: b.id, etiqueta: b.name, nota: b.externalId ?? undefined }))}
                onCambio={(v) => {
                  setSucursalId(v || null)
                  /**
                   * Se vuelven a pedir los datos, NO se recarga la página.
                   *
                   * Antes hacía `location.reload()`: dos segundos en blanco y volver a
                   * montarlo todo para cambiar un filtro. Invalidando las consultas,
                   * react-query las repite con la sucursal nueva y mientras tanto el
                   * indicador de al lado del título dice que está trabajando.
                   */
                  void queryClient.invalidateQueries()
                }}
              />
            ) : (
              // Una sola: se dice cuál es y no se ofrece elegir. No hay nada que elegir.
              <span className="flex items-center gap-1.5 bg-white border border-line rounded-xl px-3 py-2 text-sm text-ink shadow-sm">
                <Icon icon="mdi:store-outline" className="text-ink-soft/60 text-base" />
                <span className="max-w-[180px] truncate">{branchLabel(unica)}</span>
              </span>
            )}
          </>
        )}
        <Selector
          titulo={t('navbar.language')}
          icono="mdi:translate"
          valor={language}
          onCambio={(v) => setLanguage((v || 'es') as 'es' | 'en')}
          opciones={[
            { valor: 'es', etiqueta: 'Español', nota: 'ES' },
            { valor: 'en', etiqueta: 'English', nota: 'EN' },
          ]}
        />
        {/* USD / CUP.
            La tasa es POR SUCURSAL y la mantiene Accesos. Una sucursal sin tasa se queda
            en USD y se dice por qué al pasar el ratón: convertir con la tasa de otra
            provincia da un importe creíble que nadie cuestiona y que aparece en la caja. */}
        <div
          className={`flex items-center gap-1 bg-white border rounded-xl pl-2.5 pr-1.5 py-1 shadow-sm ${
            aviso ? 'border-amber-300' : 'border-line'
          }`}
          title={aviso ?? t('navbar.currency')}
        >
          <Icon
            icon={aviso ? 'mdi:cash-remove' : 'mdi:cash-multiple'}
            className={`text-base ${aviso ? 'text-amber-500' : 'text-ink-soft/60'}`}
          />
          {hayCup ? (
            <Selector
              titulo={aviso ?? t('navbar.currency')}
              className="!border-0 !bg-transparent !px-1 !py-0.5"
              valor={code}
              onCambio={(v) => setDisplayCurrency(v || 'USD')}
              opciones={currencies.map((c) => ({
                valor: c.code,
                etiqueta: c.code,
                nota: c.code === 'USD' ? undefined : `1 USD = ${c.rate}`,
              }))}
            />
          ) : (
            // Sin tasa no se ofrece elegir: un desplegable con una sola opción invita a
            // buscar la otra donde no está.
            <span className="text-xs font-semibold font-mono text-ink py-1 pr-0.5">USD</span>
          )}
        </div>
        {/* El avatar abre el menú de la cuenta: quién eres, ir a otra aplicación y salir.
            Antes esto era un adorno y cerrar sesión estaba abajo de la barra lateral,
            entre las pantallas, como si fuera un sitio al que ir. */}
        <UserMenu />
      </div>
    </div>
  )
}
