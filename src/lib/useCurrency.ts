'use client'

import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'

export interface CurrencyDef {
  code: string
  /** Cuántas unidades de esta moneda son 1 USD. El USD es 1. */
  rate: number
}

const USD: CurrencyDef = { code: 'USD', rate: 1 }

/**
 * En qué moneda se ven los importes, y con qué tasa se convierten.
 *
 * La tasa ya NO se teclea en Configuración. Salía de ahí —un número a mano, el mismo para
 * las ocho sucursales y sin nadie que lo refrescara— y con eso un domicilio de Santiago se
 * convertía con la tasa de La Habana. Un importe así es creíble, se lee bien, nadie lo
 * cuestiona, y queda mal en la caja.
 *
 * Ahora la mantiene Accesos POR SUCURSAL, sacándola de Entrega. De ahí sale una regla que
 * parece dura y no lo es: **una sucursal sin tasa no puede ver CUP**. No se cae a la de
 * otra ni a un número por defecto. Se queda en USD y se dice por qué, que es lo que se
 * puede arreglar; un número equivocado no se arregla porque nadie sabe que lo está.
 *
 * Con «todas las sucursales» elegido tampoco hay CUP: no hay UNA tasa que valga para las
 * ocho.
 */
export function useCurrency() {
  const { token, displayCurrency, setDisplayCurrency, sucursalId } = useAppStore()

  const { data } = useQuery({
    // La sucursal entra en la clave: al cambiarla hay que volver a preguntar, porque la
    // tasa es de ella. Sin esto se seguiría convirtiendo con la de la sucursal anterior.
    queryKey: ['tasa', sucursalId],
    queryFn: async () => {
      const res = await axios.get('/api/tasa', { headers: { Authorization: `Bearer ${token}` } })
      return res.data as {
        tasa: number | null
        aviso: string | null
        motivo?: string
        sucursal?: string | null
        fresca?: boolean
      }
    },
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  })

  const cup: CurrencyDef | null = data?.tasa && data.tasa > 0 ? { code: 'CUP', rate: data.tasa } : null
  const currencies: CurrencyDef[] = cup ? [USD, cup] : [USD]

  /**
   * Si se había elegido CUP y esta sucursal no tiene tasa, se cae a USD.
   *
   * La elección se guarda en el navegador, así que al cambiar a una sucursal sin tasa
   * seguiría pidiendo CUP. Sin este respaldo se convertiría con `rate` indefinido y todos
   * los importes saldrían en cero o en NaN — que es peor que verlos en dólares.
   */
  const selected = currencies.find((c) => c.code === displayCurrency) ?? USD

  const format = (usd: number): string => {
    const value = (usd ?? 0) * selected.rate
    const fractionDigits = selected.code === 'USD' ? 2 : 0

    return `${value.toLocaleString('es-ES', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })} ${selected.code}`
  }

  return {
    code: selected.code,
    rate: selected.rate,
    currencies,
    format,
    setDisplayCurrency,
    /** Por qué no se puede ver en CUP, cuando no se puede. Para decirlo en la barra. */
    aviso: cup ? (data?.fresca === false ? data?.aviso ?? null : null) : data?.aviso ?? null,
    hayCup: !!cup,
  }
}
