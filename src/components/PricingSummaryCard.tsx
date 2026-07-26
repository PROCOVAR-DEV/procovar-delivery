'use client'

import { Icon } from '@iconify/react'
import { useCurrency } from '@/lib/useCurrency'

interface PricingSummaryCardProps {
  baseFee: number
  costPerKm: number
  costPerKg: number
  distanceKm?: number
  weightKg?: number
}

export default function PricingSummaryCard({
  baseFee, costPerKm, costPerKg, distanceKm = 0, weightKg = 0
}: PricingSummaryCardProps) {
  // Los montos se guardan/calculan en USD; format() los muestra en la moneda elegida
  // (USD o CUP según la tasa de cambio). Cambiar la moneda reconvierte todo.
  const { format } = useCurrency()
  const total = baseFee + distanceKm * costPerKm + weightKg * costPerKg

  return (
    <div className="bg-white rounded-2xl shadow-md p-6 border border-gray-100">
      <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Icon icon="mdi:cash-multiple" className="text-xl text-primary" /> Desglose de precio</h3>
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Tarifa base</span>
          <span className="font-medium">{format(baseFee)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Distancia ({distanceKm.toFixed(1)} km × {format(costPerKm)}/km)</span>
          <span className="font-medium">{format(distanceKm * costPerKm)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Peso ({weightKg.toFixed(1)} kg × {format(costPerKg)}/kg)</span>
          <span className="font-medium">{format(weightKg * costPerKg)}</span>
        </div>
        <div className="border-t pt-3 flex justify-between">
          <span className="font-bold text-gray-800">Total</span>
          <span className="font-bold text-primary text-lg">{format(total)}</span>
        </div>
      </div>
    </div>
  )
}
