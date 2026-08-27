'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Icon } from '@iconify/react'

/**
 * Avisos emergentes, en una esquina y no dentro del formulario.
 *
 * # Por qué no dentro
 *
 * El error de crear una ruta se pintaba arriba del modal, y en un formulario de cuatro
 * pasos eso queda fuera de la pantalla en cuanto se ha bajado un poco: se pulsa Crear, no
 * pasa nada visible, y se vuelve a pulsar. El aviso tiene que salir donde se esté
 * mirando, no donde empieza el formulario.
 *
 * # Por qué propio y no una librería
 *
 * Son treinta líneas. Traer una dependencia para esto añade peso y una versión más que
 * mantener, y lo que hace falta —aparecer, esperar, irse— no tiene matices.
 */

type Tipo = 'ok' | 'error' | 'aviso'

interface Aviso {
  id: number
  tipo: Tipo
  texto: string
}

const Ctx = createContext<(texto: string, tipo?: Tipo) => void>(() => {})

/** Lánzalo desde cualquier sitio: `const avisar = useAvisos()`. */
export function useAvisos() {
  return useContext(Ctx)
}

const ESTILO: Record<Tipo, { fondo: string; icono: string }> = {
  ok: { fondo: 'bg-green-600', icono: 'mdi:check-circle-outline' },
  error: { fondo: 'bg-red-600', icono: 'mdi:alert-circle-outline' },
  aviso: { fondo: 'bg-amber-500', icono: 'mdi:information-outline' },
}

export function ProveedorDeAvisos({ children }: { children: React.ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])

  const avisar = useCallback((texto: string, tipo: Tipo = 'error') => {
    // La marca de tiempo como id: dos avisos en el mismo milisegundo no pasan, y evita
    // llevar un contador en estado sólo para esto.
    setAvisos((a) => [...a, { id: Date.now() + Math.random(), tipo, texto }])
  }, [])

  return (
    <Ctx.Provider value={avisar}>
      {children}
      {/*
        Encima del modal (z-index alto) y en la esquina superior derecha: los modales de
        esta aplicación ocupan el centro, así que ahí abajo el aviso quedaría tapado.
      */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {avisos.map((a) => (
          <Burbuja key={a.id} aviso={a} alCerrar={() => setAvisos((x) => x.filter((y) => y.id !== a.id))} />
        ))}
      </div>
    </Ctx.Provider>
  )
}

function Burbuja({ aviso, alCerrar }: { aviso: Aviso; alCerrar: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Un fotograma de retraso para que la transición de entrada se vea: si se pinta ya
    // en su sitio, aparece de golpe.
    const entrar = requestAnimationFrame(() => setVisible(true))
    // Los errores duran más: un "guardado" se entiende de reojo, pero un motivo hay que
    // leerlo, y a veces es largo.
    const ms = aviso.tipo === 'error' ? 7000 : 3500
    const salir = setTimeout(() => setVisible(false), ms)
    const quitar = setTimeout(alCerrar, ms + 300)

    return () => {
      cancelAnimationFrame(entrar)
      clearTimeout(salir)
      clearTimeout(quitar)
    }
  }, [aviso.tipo, alCerrar])

  const e = ESTILO[aviso.tipo]

  return (
    <div
      role="status"
      className={`pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl px-4 py-3 text-sm text-white shadow-lg transition-all duration-300 ${e.fondo} ${
        visible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
      }`}
    >
      <Icon icon={e.icono} className="mt-0.5 shrink-0 text-lg" aria-hidden />
      <span className="flex-1">{aviso.texto}</span>
      <button
        type="button"
        onClick={alCerrar}
        className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
        aria-label="Cerrar aviso"
      >
        <Icon icon="mdi:close" />
      </button>
    </div>
  )
}
