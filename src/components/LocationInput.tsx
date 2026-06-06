'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { forwardGeocode, reverseGeocode, parseCoordInput, formatCoords } from '@/lib/geocode'
import { useT } from '@/lib/i18n'
import { Icon } from '@iconify/react'

const MapComponent = dynamic(() => import('@/components/MapComponent'), { ssr: false })

export interface LocationValue {
  address: string
  lat: number | null
  lng: number | null
}

interface LocationInputProps {
  value: LocationValue
  onChange: (value: LocationValue) => void
  label?: string
  placeholder?: string
  /** Hex color for the single map marker. */
  markerColor?: string
}

/**
 * Single text field that stays in sync with a map. Three ways to set a location:
 *  - type an address  -> debounced forward geocode -> map marker moves
 *  - type "lat, lng"  -> parsed instantly -> map marker moves
 *  - click the map    -> reverse geocode -> address text fills in
 * Editing one side always updates the other.
 */
export default function LocationInput({
  value,
  onChange,
  label,
  placeholder,
}: LocationInputProps) {
  const t = useT()
  const labelText = label ?? t('loc.label')
  const placeholderText = placeholder ?? t('loc.placeholder')
  const [status, setStatus] = useState<'idle' | 'searching' | 'ok' | 'notfound'>(
    value.lat != null && value.lng != null ? 'ok' : 'idle'
  )
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks the last text we resolved so map-click reverse-geocode doesn't retrigger forward geocode.
  const lastResolvedText = useRef<string>(value.address)

  // Debounced forward geocode / coord parse when the user types.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const text = value.address
    if (!text || text === lastResolvedText.current) return

    // Instant path: typed coordinates.
    const coords = parseCoordInput(text)
    if (coords) {
      lastResolvedText.current = text
      setStatus('ok')
      if (coords.lat !== value.lat || coords.lng !== value.lng) {
        onChange({ address: text, lat: coords.lat, lng: coords.lng })
      }
      return
    }

    if (text.trim().length < 4) {
      setStatus('idle')
      return
    }

    setStatus('searching')
    debounceRef.current = setTimeout(async () => {
      const found = await forwardGeocode(text)
      lastResolvedText.current = text
      if (found) {
        setStatus('ok')
        onChange({ address: text, lat: found.lat, lng: found.lng })
      } else {
        setStatus('notfound')
      }
    }, 700)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.address])

  const handleMapClick = async (point: { lat: number; lng: number }) => {
    setStatus('searching')
    // Set coords immediately; fill address after reverse geocode resolves.
    const addr = await reverseGeocode(point.lat, point.lng)
    lastResolvedText.current = addr
    setStatus('ok')
    onChange({ address: addr, lat: point.lat, lng: point.lng })
  }

  const selectedPoint =
    value.lat != null && value.lng != null ? { lat: value.lat, lng: value.lng } : null

  return (
    <div>
      {labelText && <label className="block text-sm font-medium text-gray-700 mb-1">{labelText}</label>}
      <input
        type="text"
        value={value.address}
        onChange={(e) => onChange({ ...value, address: e.target.value })}
        placeholder={placeholderText}
        className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
      />
      <div className="min-h-[1.25rem] mt-1">
        {status === 'searching' && <p className="text-xs text-gray-400 italic">{t('loc.searching')}</p>}
        {status === 'ok' && selectedPoint && (
          <p className="text-xs text-green-600 flex items-center gap-1"><Icon icon="mdi:check-circle" />{formatCoords(selectedPoint.lat, selectedPoint.lng)}</p>
        )}
        {status === 'notfound' && (
          <p className="text-xs text-red-500">{t('loc.notfound')}</p>
        )}
      </div>
      <div className="rounded-xl overflow-hidden border mt-1">
        <MapComponent
          stops={
            selectedPoint
              ? [{ id: 'loc', lat: selectedPoint.lat, lng: selectedPoint.lng, label: value.address || 'Ubicación', stopType: 'end' as const }]
              : []
          }
          selectable
          selectedPoint={selectedPoint}
          onMapClick={handleMapClick}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1">{t('loc.help')}</p>
    </div>
  )
}
