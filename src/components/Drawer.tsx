'use client'

/**
 * Un CAJÓN lateral, en vez de un cuadro flotando en el medio.
 *
 * Todo lo que se abre aquí es trabajo largo: el detalle de un pedido con su mapa y sus
 * productos, el asistente de rutas con cuatro pasos, la ficha de un vehículo. Un modal
 * centrado le da a eso el ancho de una tarjeta y el alto de la pantalla menos los
 * márgenes, así que se rellena de barras de desplazamiento y se pierde de vista la lista
 * que hay detrás.
 *
 * El cajón entra por la derecha, ocupa el alto entero y el ancho que se le pida. En el
 * móvil ocupa la pantalla completa, que es la única forma de que quepa algo.
 *
 * La cabecera y el pie se quedan fijos; lo único que se desplaza es el contenido. Es lo
 * que hacía falta en el asistente: el botón de «Generar ruta» estaba al final de todo y
 * había que recorrer la lista de pedidos entera para llegar a él.
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'

interface Props {
  abierto: boolean
  alCerrar: () => void
  titulo: string
  /** Debajo del título, pequeño: el folio, el código, de qué va esto. */
  subtitulo?: string
  /** Ancho en pantalla grande. Completo = toda la pantalla, para lo que lleva mapas. */
  ancho?: 'md' | 'lg' | 'xl' | 'completo'
  /** Botones de acción, pegados abajo y siempre a la vista. */
  pie?: React.ReactNode
  children: React.ReactNode
}

/** Cuántos cajones hay abiertos ahora mismo. Ver el bloqueo del desplazamiento abajo. */
let abiertos = 0

const ANCHOS: Record<NonNullable<Props['ancho']>, string> = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  completo: 'sm:max-w-none',
}

export default function Drawer({ abierto, alCerrar, titulo, subtitulo, ancho = 'lg', pie, children }: Props) {
  /**
   * Escape cierra, y mientras hay un cajón abierto la página de detrás no se desplaza.
   *
   * # Por qué se CUENTAN los cajones abiertos
   *
   * Antes cada cajón guardaba el `overflow` que encontró y lo devolvía al cerrarse. Con
   * dos cajones montados a la vez —el detalle del pedido y el de nuevo pedido viven los
   * dos en la misma pantalla— el segundo guardaba el `hidden` que había puesto el
   * primero, y al cerrarse lo dejaba puesto PARA SIEMPRE: la página entera se quedaba sin
   * poder bajar y no había forma de volver atrás salvo recargando.
   *
   * Con un contador, el bloqueo se quita cuando se cierra el último, y se quita del todo:
   * se borra la propiedad en vez de restaurar un valor que puede ser el de otro.
   */
  useEffect(() => {
    if (!abierto) return

    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar() }

    abiertos += 1
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', tecla)

    return () => {
      abiertos = Math.max(0, abiertos - 1)
      if (abiertos === 0) document.body.style.removeProperty('overflow')
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto, alCerrar])

  if (!abierto || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={alCerrar} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={`relative flex h-full w-full flex-col bg-white shadow-2xl ${ANCHOS[ancho]} animate-[deslizar_.18s_ease-out]`}
      >
        <div className="flex items-start gap-3 border-b border-line px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-bold text-ink">{titulo}</h3>
            {subtitulo && <p className="truncate text-xs text-ink-soft">{subtitulo}</p>}
          </div>
          <button
            type="button"
            onClick={alCerrar}
            aria-label="Cerrar"
            className="shrink-0 rounded-xl p-2 text-ink-soft hover:bg-ink/5"
          >
            <Icon icon="mdi:close" className="text-xl" />
          </button>
        </div>

        {/* `min-h-0` es lo que deja que esto se desplace en vez de estirar el cajón. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>

        {pie && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-white px-4 py-3 sm:px-6">
            {pie}
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes deslizar {
          from { transform: translateX(1.5rem); opacity: 0.6 }
          to { transform: translateX(0); opacity: 1 }
        }
      `}</style>
    </div>,
    document.body,
  )
}
