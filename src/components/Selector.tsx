'use client'

/**
 * Un desplegable con buscador, en vez del `<select>` del navegador.
 *
 * Los `<select>` de aquí se llenaron de listas que no son listas cortas: ochenta y dos
 * vendedores, ciento y pico municipios, ocho sucursales. En uno del navegador eso se
 * recorre a ojo, no se puede filtrar, y en Windows se pinta con la tipografía del sistema
 * — que es de donde venía la queja: no se parece a nada del resto de la aplicación.
 *
 * Éste se escribe para buscar. Y sólo enseña el buscador cuando hay bastantes opciones
 * como para que haga falta: ponerlo en un desplegable de tres cosas es una caja vacía que
 * hay que saltarse.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'

export interface Opcion {
  valor: string
  etiqueta: string
  /** Se pinta pequeño a la derecha: un conteo, un código. */
  nota?: string
}

interface Props {
  opciones: Opcion[]
  valor: string
  onCambio: (valor: string) => void
  /** La opción de «todos», la que no filtra. Vacía = no se ofrece. */
  todos?: string
  /** Lo que se lee al pasar el ratón; también sirve de nombre accesible. */
  titulo?: string
  className?: string
  /** A partir de cuántas opciones aparece el buscador. */
  desdeCuantas?: number
  /**
   * Un icono DENTRO del botón.
   *
   * Va aquí y no en un envoltorio de fuera a propósito: el menú se coloca contra el borde
   * del botón, así que con el icono fuera el botón empieza más a la derecha de lo que
   * parece la caja, y el menú salía descolocado unos pixeles. Con el icono dentro, lo que
   * se ve y lo que se mide son lo mismo.
   */
  icono?: string
}

export default function Selector({
  opciones,
  valor,
  onCambio,
  todos,
  titulo,
  className = '',
  desdeCuantas = 7,
  icono,
}: Props) {
  const [abierto, setAbierto] = useState(false)
  const [busca, setBusca] = useState('')
  const [montado, setMontado] = useState(false)
  const [resaltada, setResaltada] = useState(0)
  const anclaRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const cajaRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  useEffect(() => { setMontado(true) }, [])

  const conTodos: Opcion[] = todos ? [{ valor: '', etiqueta: todos }, ...opciones] : opciones
  const elegida = conTodos.find((o) => o.valor === valor)

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()

    if (!q) return conTodos
    // Se busca también en la nota: el código de la sucursal («HAB») está ahí, y es por
    // donde mucha gente la reconoce antes que por el nombre.
    return conTodos.filter((o) => `${o.etiqueta} ${o.nota ?? ''}`.toLowerCase().includes(q))
  }, [conTodos, busca])

  /**
   * El menú se pinta en `document.body`.
   *
   * Estos desplegables viven dentro de barras de filtros con `overflow` y de tablas que
   * se desplazan a lo ancho: un menú absoluto dentro se recorta contra el borde de su
   * caja. Por portal se ve entero, y la posición se calcula a partir del botón.
   */
  useEffect(() => {
    if (!abierto) return

    const colocar = () => {
      const r = anclaRef.current?.getBoundingClientRect()

      if (!r) return
      // Si no cabe debajo, se abre hacia arriba: un menú que se sale por abajo obliga a
      // desplazar la página con el desplegable abierto.
      const abajo = window.innerHeight - r.bottom
      const alto = Math.min(320, filtradas.length * 38 + 60)

      /**
       * Pegado al borde IZQUIERDO del botón, salvo que se salga por la derecha.
       *
       * El menú es más ancho que algunos botones, así que se comprueba si cabe; si no,
       * se alinea por la derecha en vez de empujarlo a un sitio cualquiera. Antes se
       * recortaba con un `min` a secas y quedaba descolocado respecto al botón.
       */
      const ancho = Math.max(r.width, 240)
      const cabe = r.left + ancho <= window.innerWidth - 8

      setPos({
        top: abajo < alto && r.top > alto ? r.top - alto - 4 : r.bottom + 4,
        left: cabe ? r.left : Math.max(8, r.right - ancho),
        width: ancho,
      })
    }

    colocar()
    window.addEventListener('resize', colocar)
    window.addEventListener('scroll', colocar, true)
    return () => {
      window.removeEventListener('resize', colocar)
      window.removeEventListener('scroll', colocar, true)
    }
  }, [abierto, filtradas.length])

  useEffect(() => {
    if (!abierto) return

    // El foco al buscador nada más abrir: se abre para escribir, no para mirar.
    cajaRef.current?.focus()

    const fuera = (e: MouseEvent) => {
      const t = e.target as Node

      if (menuRef.current?.contains(t) || anclaRef.current?.contains(t)) return
      setAbierto(false)
    }

    /**
     * Escape cierra, venga de donde venga.
     *
     * Estaba sólo en el `onKeyDown` del menú, que necesita que el foco esté dentro. Con
     * pocas opciones no se pinta el buscador, así que no hay nada dentro que tenga el
     * foco: Escape no llegaba y el desplegable se quedaba abierto tapando lo de al lado.
     */
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }

    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  const elegir = (v: string) => {
    onCambio(v)
    setAbierto(false)
    setBusca('')
  }

  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setAbierto(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setResaltada((i) => Math.min(filtradas.length - 1, i + 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setResaltada((i) => Math.max(0, i - 1)); return }
    if (e.key === 'Enter' && filtradas[resaltada]) { e.preventDefault(); elegir(filtradas[resaltada].valor) }
  }

  return (
    <>
      <button
        ref={anclaRef}
        type="button"
        title={titulo}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        onClick={() => { setAbierto((v) => !v); setBusca(''); setResaltada(0) }}
        className={`flex items-center gap-2 py-2 px-3 border rounded-xl text-sm bg-white transition-colors ${
          valor ? 'border-primary/50 text-ink font-medium' : 'border-line text-ink-soft'
        } hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30 ${className}`}
      >
        {icono && <Icon icon={icono} className="shrink-0 text-base text-ink-soft/60" />}
        <span className="truncate max-w-[190px]">{elegida?.etiqueta ?? todos ?? '—'}</span>
        {elegida?.nota && <span className="text-[11px] text-ink-soft/60 shrink-0">{elegida.nota}</span>}
        <Icon icon="mdi:chevron-down" className={`shrink-0 text-base text-ink-soft/50 transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>

      {abierto && montado && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          className="fixed z-50 bg-white border border-line rounded-xl shadow-2xl overflow-hidden"
          onKeyDown={teclado}
        >
          {conTodos.length >= desdeCuantas && (
            <div className="p-2 border-b border-line">
              <div className="relative">
                <Icon icon="mdi:magnify" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft/50 text-base" />
                <input
                  ref={cajaRef}
                  value={busca}
                  onChange={(e) => { setBusca(e.target.value); setResaltada(0) }}
                  placeholder="Buscar…"
                  className="w-full pl-8 pr-2 py-1.5 text-sm border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          )}

          <div className="max-h-[16rem] overflow-y-auto py-1">
            {filtradas.length === 0 ? (
              <p className="px-3 py-3 text-xs text-ink-soft/60 text-center">Nada que cuadre con «{busca}»</p>
            ) : (
              filtradas.map((o, i) => (
                <button
                  key={o.valor || '__todos'}
                  type="button"
                  role="option"
                  aria-selected={o.valor === valor}
                  onMouseEnter={() => setResaltada(i)}
                  onClick={() => elegir(o.valor)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    i === resaltada ? 'bg-primary/[0.07]' : ''
                  } ${o.valor === valor ? 'font-semibold text-primary' : 'text-ink'}`}
                >
                  <span className="flex-1 truncate">{o.etiqueta}</span>
                  {o.nota && <span className="text-[11px] text-ink-soft/60 shrink-0">{o.nota}</span>}
                  {o.valor === valor && <Icon icon="mdi:check" className="text-primary shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
