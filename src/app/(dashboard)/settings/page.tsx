'use client'

import Navbar from '@/components/Navbar'
import { Icon } from '@iconify/react'

/**
 * Configuración se retiró.
 *
 * Tenía dos cosas y ninguna es de delivery:
 *
 *   - La tasa de cambio, que se tecleaba a mano y era la misma para las ocho sucursales.
 *     Ahora la mantiene Accesos, por sucursal, sacándola de Entrega.
 *   - El costo del domicilio, que lo pone el repartidor desde Entrega y llega a PEDIDO
 *     por su webhook. Lo que delivery calcula con esa fórmula es el reparto de la carga
 *     del camión entre los pedidos, que es una cuenta interna y no un precio que alguien
 *     cobre.
 *
 * Se deja la pantalla —y no un 404— para quien llegue por un enlace guardado: 404 manda a
 * buscar el error en la dirección, y lo que hay que saber es que esto se movió.
 */
export default function SettingsPage() {
  return (
    <div className="flex flex-col">
      <Navbar title="Configuración" />
      <div className="p-6">
        <div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center shadow-md">
          <Icon icon="mdi:cog-off-outline" className="mx-auto text-4xl text-ink-soft/40" />
          <h3 className="mt-3 font-bold text-ink">Aquí ya no hay nada que configurar</h3>
          <p className="mt-2 text-sm text-ink-soft/70">
            La <b>tasa de cambio</b> la mantiene Accesos, por sucursal, sacándola de
            Entrega. Y el <b>costo del domicilio</b> lo pone el repartidor desde Entrega.
          </p>
          <p className="mt-2 text-xs text-ink-soft/60">
            Los almacenes de cada sucursal se editan en Accesos, en la ficha de la sucursal.
          </p>
        </div>
      </div>
    </div>
  )
}
