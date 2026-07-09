'use client'

import { useEffect, useRef } from 'react'
import type { Map, Marker, Polyline } from 'leaflet'

interface Stop {
  id: string
  lat: number
  lng: number
  label: string
  /** Formatted price the client pays (already in selected currency). Shown in the popup. */
  priceLabel?: string
  status?: string
  stopType?: 'start' | 'end' | 'waypoint'
  tripLeg?: 'outbound' | 'return'
  isOrigin?: boolean
}

interface MapComponentProps {
  stops: Stop[]
  onStopClick?: (id: string) => void
  selectable?: boolean
  selectedPoint?: { lat: number; lng: number } | null
  onMapClick?: (point: { lat: number; lng: number }) => void
  /** Map height (CSS value). Use '100%' to fill a flex parent. Default '400px'. */
  height?: string
  /** Initial center when there are no stops/selected point (e.g. user's branch). */
  defaultCenter?: { lat: number; lng: number } | null
  defaultZoom?: number
}

type MapLayer = Marker | Polyline

export default function MapComponent({ stops, onStopClick, selectable = false, selectedPoint = null, onMapClick, height = '400px', defaultCenter = null, defaultZoom = 11 }: MapComponentProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<Map | null>(null)
  const markersRef = useRef<MapLayer[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const initMap = async () => {
      const L = (await import('leaflet')).default

      // Fix leaflet default icon issue with webpack
      const iconPrototype = L.Icon.Default.prototype as L.Icon.Default & { _getIconUrl?: unknown }
      delete iconPrototype._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
      })

      if (!mapInstanceRef.current && mapRef.current) {
        // Centro por defecto: Camagüey, Cuba (no São Paulo). Se usa solo cuando no hay
        // stops ni defaultCenter (p.ej. mapa vacío al crear una sucursal/punto).
        const initCenter: [number, number] = defaultCenter
          ? [defaultCenter.lat, defaultCenter.lng]
          : [21.3809, -77.9169]
        mapInstanceRef.current = L.map(mapRef.current, { attributionControl: false }).setView(initCenter, defaultZoom)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
        }).addTo(mapInstanceRef.current)
      }

      // Clear existing markers
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      if (!mapInstanceRef.current) return

      // Separate stops into groups
      const originStop = stops.find((s) => s.isOrigin)
      const outboundStops = stops.filter((s) => !s.isOrigin && s.tripLeg === 'outbound')
      const returnStops = stops.filter((s) => !s.isOrigin && s.tripLeg === 'return')
      const legacyStops = stops.filter((s) => !s.isOrigin && !s.tripLeg)

      // Track numbering per leg
      let outboundIdx = 0
      let returnIdx = 0

      // Add markers
      stops.forEach((stop) => {
        let color: string
        let letter: string

        if (stop.isOrigin) {
          color = '#16a34a'
          letter = '★'
        } else if (stop.tripLeg === 'return') {
          color = '#f97316'
          returnIdx++
          letter = String(returnIdx)
        } else if (stop.tripLeg === 'outbound') {
          color = '#2563eb'
          outboundIdx++
          letter = String(outboundIdx)
        } else {
          // legacy: use stopType or index
          const isStart = stop.stopType === 'start'
          const isEnd = stop.stopType === 'end'
          color = isStart ? '#16a34a' : isEnd ? '#dc2626' : '#2563eb'
          const idx = stops.indexOf(stop)
          letter = isStart ? 'A' : isEnd ? 'B' : String(idx + 1)
        }

        const pinIcon = L.divIcon({
          html: `<div style="background:${color};color:white;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);font-size:12px;font-weight:bold;line-height:1;">${letter}</span></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 30],
          popupAnchor: [0, -32],
          className: '',
        })

        const priceHtml = stop.priceLabel
          ? `<br/><span style="display:inline-block;margin-top:4px;font-weight:700;color:#16a34a;">${stop.priceLabel}</span>`
          : ''
        const marker = L.marker([stop.lat, stop.lng], { icon: pinIcon })
          .addTo(mapInstanceRef.current!)
          .bindPopup(`<b>${stop.label}</b>${priceHtml}`)

        if (onStopClick) {
          marker.on('click', () => onStopClick(stop.id))
        }

        markersRef.current.push(marker)
      })

      if (selectable && selectedPoint) {
        const selIcon = L.divIcon({
          html: `<div style="background:#f59e0b;color:white;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);font-size:14px;line-height:1;">★</span></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 30],
          popupAnchor: [0, -32],
          className: '',
        })
        const selectedMarker = L.marker([selectedPoint.lat, selectedPoint.lng], { icon: selIcon })
          .addTo(mapInstanceRef.current)
          .bindPopup(`<b>${selectedPoint.lat.toFixed(5)}, ${selectedPoint.lng.toFixed(5)}</b>`)
        markersRef.current.push(selectedMarker)
      }

      // Helper: draw OSRM route or fallback straight line; returns the drawn polyline
      const drawRouteLine = async (
        waypoints: Array<{ lat: number; lng: number }>,
        color: string,
        dashed = false
      ): Promise<Polyline | null> => {
        if (waypoints.length < 2) return null
        const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(';')
        const dashOpts = dashed ? { dashArray: '8 10' } : {}
        try {
          const res = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`
          )
          const json = await res.json()
          if (json.routes?.[0]) {
            const geojsonCoords: [number, number][] = json.routes[0].geometry.coordinates.map(
              ([lng, lat]: [number, number]) => [lat, lng]
            )
            const polyline = L.polyline(geojsonCoords, { color, weight: 4, opacity: 0.85, ...dashOpts })
              .addTo(mapInstanceRef.current!)
            markersRef.current.push(polyline)
            return polyline
          }
        } catch { /* ignore */ }
        // fallback straight line
        const latlngs = waypoints.map((w) => [w.lat, w.lng] as [number, number])
        const polyline = L.polyline(latlngs, { color, weight: 3, opacity: 0.7, ...dashOpts })
          .addTo(mapInstanceRef.current!)
        markersRef.current.push(polyline)
        return polyline
      }

      const drawnPolylines: Polyline[] = []

      if (outboundStops.length > 0 || returnStops.length > 0) {
        // Multi-leg mode
        if (outboundStops.length > 0) {
          const waypoints = originStop
            ? [{ lat: originStop.lat, lng: originStop.lng }, ...outboundStops]
            : outboundStops
          const pl = await drawRouteLine(waypoints, '#2563EB')
          if (pl) drawnPolylines.push(pl)

          // Return leg: dashed line from the last stop back to the depot.
          if (originStop) {
            const last = outboundStops[outboundStops.length - 1]
            const pl2 = await drawRouteLine(
              [{ lat: last.lat, lng: last.lng }, { lat: originStop.lat, lng: originStop.lng }],
              '#f97316',
              true
            )
            if (pl2) drawnPolylines.push(pl2)
          }
        }
        if (returnStops.length > 0) {
          const waypoints = originStop
            ? [{ lat: originStop.lat, lng: originStop.lng }, ...returnStops]
            : returnStops
          const pl = await drawRouteLine(waypoints, '#f97316')
          if (pl) drawnPolylines.push(pl)
        }

        if (drawnPolylines.length > 0) {
          let bounds = drawnPolylines[0].getBounds()
          for (let i = 1; i < drawnPolylines.length; i++) {
            bounds = bounds.extend(drawnPolylines[i].getBounds())
          }
          if (originStop) bounds = bounds.extend([originStop.lat, originStop.lng])
          mapInstanceRef.current!.fitBounds(bounds, { padding: [40, 40] })
        } else if (originStop) {
          mapInstanceRef.current!.setView([originStop.lat, originStop.lng], 13)
        }
      } else if (legacyStops.length > 1) {
        // Legacy single-leg mode
        const pl = await drawRouteLine(legacyStops, '#2563EB')
        if (pl) mapInstanceRef.current!.fitBounds(pl.getBounds(), { padding: [40, 40] })
      } else if (stops.length === 1) {
        mapInstanceRef.current.setView([stops[0].lat, stops[0].lng], 13)
      } else if (selectedPoint) {
        mapInstanceRef.current.setView([selectedPoint.lat, selectedPoint.lng], 13)
      } else if (defaultCenter) {
        mapInstanceRef.current.setView([defaultCenter.lat, defaultCenter.lng], defaultZoom)
      }

      mapInstanceRef.current.off('click')
      if (selectable && onMapClick) {
        mapInstanceRef.current.on('click', (event: { latlng: { lat: number; lng: number } }) => {
          onMapClick({ lat: event.latlng.lat, lng: event.latlng.lng })
        })
      }
    }

    initMap()
  }, [stops, onStopClick, selectable, selectedPoint, onMapClick, defaultCenter, defaultZoom])

  return (
    <div className="relative" style={{ height }}>
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/leaflet.min.css"
      />
      <div
        ref={mapRef}
        style={{ height: '100%', minHeight: '240px', width: '100%', borderRadius: '12px', zIndex: 0 }}
      />
    </div>
  )
}

