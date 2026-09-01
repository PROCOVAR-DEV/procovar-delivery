/**
 * El POST-despacho: lo que tiene que quedar en el camión.
 *
 * El camión vuelve y alguien tiene que cuadrar lo que baja. Hasta ahora eso se hacía de
 * memoria y con la hoja del pre-despacho en la mano, restando a ojo: se cargaron
 * cuarenta cajas, se entregaron treinta y una, ¿quedan nueve? Nadie lo comprobaba, y lo
 * que faltaba aparecía días después sin poder decir de qué reparto salió.
 *
 * Esta hoja es la cuenta hecha: por producto, cuánto salió, cuánto se entregó y cuánto
 * tiene que estar todavía arriba. Con su columna para marcar lo que de verdad bajó, que
 * es lo que convierte la hoja en un control y no en un informe.
 *
 * Debajo va el detalle por cliente de lo que NO se entregó, porque «faltan nueve cajas»
 * no sirve para reclamar: hace falta saber de quién eran.
 */

export interface LineaPostDespacho {
  producto: string
  /** Lo que se cargó: formatos de todas las paradas de la ruta. */
  salio: number
  /** Lo de las paradas marcadas como entregadas. */
  entregado: number
  /** Lo que tiene que seguir en el camión: lo devuelto, lo cancelado y lo que no se tocó. */
  queda: number
}

export interface ParadaPendiente {
  cliente: string
  /** `devuelto`, `cancelado`, o vacío si nadie la marcó. */
  resultado: string | null
  nota: string | null
  productos: Array<{ producto: string; formatos: number }>
}

export interface PostDespacho {
  ruta: string
  sucursal: string
  vehiculo: string
  /** Cuándo salió y cuándo volvió, si se sabe. */
  salida?: string
  regreso?: string
  entregadas: number
  devueltas: number
  canceladas: number
  sinMarcar: number
  lineas: LineaPostDespacho[]
  pendientes: ParadaPendiente[]
}

const escapar = (t: string) =>
  (t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

export function htmlPostDespacho(d: PostDespacho): string {
  /**
   * Sólo salen los productos que QUEDAN.
   *
   * Un producto entregado entero no hay que contarlo al bajar: si sale en la hoja, se
   * cuenta igual, y lo que hace es alargarla y esconder las tres líneas que importan.
   */
  const conResto = d.lineas.filter((l) => l.queda > 0.0001)
  const filas = conResto
    .map(
      (l) => `<tr>
        <td>${escapar(l.producto)}</td>
        <td class="n">${l.salio}</td>
        <td class="n">${l.entregado}</td>
        <td class="n destaca">${l.queda}</td>
        <td class="v"></td>
      </tr>`,
    )
    .join('')

  const paradas = d.pendientes
    .map(
      (p) => `<div class="parada">
        <p class="cli">${escapar(p.cliente)} <span class="et et-${p.resultado ?? 'sin'}">${
          p.resultado === 'devuelto' ? 'Devuelto'
            : p.resultado === 'cancelado' ? 'Cancelado'
              : 'Sin marcar'
        }</span></p>
        ${p.nota ? `<p class="nota">${escapar(p.nota)}</p>` : ''}
        <p class="prods">${p.productos.map((x) => `${escapar(x.producto)} × ${x.formatos}`).join(' · ') || '—'}</p>
      </div>`,
    )
    .join('')

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Post-despacho</title>
<style>
  * { box-sizing: border-box }
  body { font: 13px/1.4 system-ui, sans-serif; margin: 24px; color: #111 }
  h1 { font-size: 20px; margin: 0 0 2px }
  h2 { font-size: 14px; margin: 22px 0 8px; text-transform: uppercase; letter-spacing: .04em; color: #444 }
  .cab { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 14px }
  .cab p { margin: 2px 0; color: #444 }
  table { width: 100%; border-collapse: collapse }
  th, td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left }
  th { background: #f4f4f4; font-size: 11px; text-transform: uppercase; letter-spacing: .04em }
  .n { text-align: right; font-variant-numeric: tabular-nums }
  /* Lo que queda es la columna por la que se lee esta hoja: se ve desde lejos. */
  .destaca { font-weight: 700 }
  .v { width: 78px }
  tfoot td { font-weight: 700; border-top: 2px solid #333 }
  .resumen { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0 4px }
  .resumen span { border: 1px solid #ddd; border-radius: 999px; padding: 3px 10px; font-size: 12px }
  .parada { border-bottom: 1px solid #eee; padding: 6px 0 }
  .cli { margin: 0; font-weight: 600 }
  .nota { margin: 2px 0 0; color: #666; font-size: 12px; font-style: italic }
  .prods { margin: 2px 0 0; color: #333; font-size: 12px }
  .et { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; border-radius: 999px; padding: 2px 7px; margin-left: 6px }
  .et-devuelto { background: #fde8e8; color: #8a1c1c }
  .et-cancelado { background: #f1f1f1; color: #444 }
  .et-sin { background: #fff4d6; color: #7a5600 }
  .vacio { color: #666; font-style: italic }
  .firma { margin-top: 30px; display: flex; gap: 40px; color: #444 }
  .firma div { flex: 1; border-top: 1px solid #999; padding-top: 4px; font-size: 11px }
  .acciones { position: fixed; right: 16px; bottom: 16px; display: flex; gap: 8px }
  .acciones button {
    font: 500 13px system-ui, sans-serif; padding: 8px 14px; border-radius: 8px;
    border: 1px solid #bbb; background: #fff; cursor: pointer;
  }
  .acciones button:first-child { background: #0b3d5c; color: #fff; border-color: #0b3d5c }
  @media print { body { margin: 12mm } .acciones { display: none } }
</style></head>
<body>
  <div class="cab">
    <div>
      <h1>Post-despacho</h1>
      <p>${escapar(d.ruta)} · ${escapar(d.sucursal)}${d.vehiculo ? ` · ${escapar(d.vehiculo)}` : ''}</p>
      ${d.salida ? `<p>Salió ${escapar(d.salida)}${d.regreso ? ` · volvió ${escapar(d.regreso)}` : ''}</p>` : ''}
    </div>
    <div>
      <p>${new Date().toLocaleString('es')}</p>
    </div>
  </div>

  <div class="resumen">
    <span>${d.entregadas} entregada(s)</span>
    <span>${d.devueltas} devuelta(s)</span>
    <span>${d.canceladas} cancelada(s)</span>
    ${d.sinMarcar ? `<span>${d.sinMarcar} sin marcar</span>` : ''}
  </div>

  <h2>Tiene que quedar en el camión</h2>
  ${
    conResto.length === 0
      ? '<p class="vacio">Nada: se entregó todo lo que salió.</p>'
      : `<table>
    <thead><tr><th>Producto</th><th class="n">Salió</th><th class="n">Entregado</th><th class="n">Queda</th><th>Bajó</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr>
      <td>Total</td>
      <td class="n">${conResto.reduce((t, l) => t + l.salio, 0)}</td>
      <td class="n">${conResto.reduce((t, l) => t + l.entregado, 0)}</td>
      <td class="n">${conResto.reduce((t, l) => t + l.queda, 0)}</td>
      <td></td>
    </tr></tfoot>
  </table>`
  }

  <h2>De quién es lo que vuelve</h2>
  ${
    d.pendientes.length === 0
      ? '<p class="vacio">Todas las paradas se entregaron.</p>'
      : paradas
  }

  <div class="firma"><div>Entregó (chofer)</div><div>Recibió en almacén</div></div>

  <div class="acciones">
    <button onclick="window.print()">Imprimir</button>
    <button onclick="window.close()">Cerrar</button>
  </div>
</body></html>`
}

/**
 * Abre la hoja para MIRARLA. No lanza el diálogo de impresión.
 *
 * Igual que el pre-despacho: la hoja se revisa antes de imprimirla, y con el diálogo
 * abierto de golpe hay que cancelarlo para poder leer lo que se iba a imprimir.
 */
export function imprimirPostDespacho(d: PostDespacho): void {
  const v = window.open('', '_blank', 'width=900,height=700')

  if (!v) return
  v.document.write(htmlPostDespacho(d))
  v.document.close()
  v.focus()
}
