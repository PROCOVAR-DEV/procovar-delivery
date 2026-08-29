/**
 * El pre-despacho, en papel.
 *
 * El almacén no mira una pantalla: alguien baja con una hoja y va sacando. Por eso se
 * imprime, y por eso lleva los totales grandes al final — es lo que se comprueba cuando
 * el camión ya está cargado.
 *
 * Se abre en una ventana aparte en vez de imprimir la página: la de detrás lleva mapas,
 * barras laterales y un cajón por encima, y sale un desastre de tres hojas.
 */

export interface LineaPreDespacho {
  producto: string
  formatos: number
  unidades: number
  pesoKg: number
}

export interface PreDespacho {
  sucursal: string
  vehiculo: string
  /** El día de los pedidos, `YYYY-MM-DD`, si se filtró por uno. */
  dia?: string
  pedidos: number
  pesoKg: number
  lineas: LineaPreDespacho[]
}

const escapar = (t: string) =>
  t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

export function htmlPreDespacho(d: PreDespacho): string {
  const filas = d.lineas
    .map(
      (l) => `<tr>
        <td>${escapar(l.producto)}</td>
        <td class="n">${l.formatos}</td>
        <td class="n">${l.unidades}</td>
        <td class="n">${l.pesoKg ? l.pesoKg.toFixed(1) : '—'}</td>
        <td class="v"></td>
      </tr>`,
    )
    .join('')

  const totalFormatos = d.lineas.reduce((t, l) => t + l.formatos, 0)
  const totalUnidades = d.lineas.reduce((t, l) => t + l.unidades, 0)

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Pre-despacho</title>
<style>
  * { box-sizing: border-box }
  body { font: 13px/1.4 system-ui, sans-serif; margin: 24px; color: #111 }
  h1 { font-size: 20px; margin: 0 0 2px }
  .cab { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 14px }
  .cab p { margin: 2px 0; color: #444 }
  table { width: 100%; border-collapse: collapse }
  th, td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left }
  th { background: #f4f4f4; font-size: 11px; text-transform: uppercase; letter-spacing: .04em }
  .n { text-align: right; font-variant-numeric: tabular-nums }
  /* La columna de la palomita: quien saca la mercancía va marcando. */
  .v { width: 70px }
  tfoot td { font-weight: 700; border-top: 2px solid #333 }
  .firma { margin-top: 34px; display: flex; gap: 40px; color: #444 }
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
      <h1>Pre-despacho</h1>
      <p>${escapar(d.sucursal)}${d.vehiculo ? ` · ${escapar(d.vehiculo)}` : ''}</p>
      ${d.dia ? `<p>Pedidos del ${escapar(d.dia)}</p>` : ''}
    </div>
    <div>
      <p>${d.pedidos} pedido(s)</p>
      <p>${d.pesoKg.toFixed(1)} kg</p>
      <p>${new Date().toLocaleString('es')}</p>
    </div>
  </div>

  <table>
    <thead><tr><th>Producto</th><th class="n">Empaques</th><th class="n">Unidades</th><th class="n">kg</th><th>Sacado</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr><td>Total</td><td class="n">${totalFormatos}</td><td class="n">${totalUnidades}</td><td class="n">${d.pesoKg.toFixed(1)}</td><td></td></tr></tfoot>
  </table>

  <div class="firma"><div>Sacó del almacén</div><div>Recibió (chofer)</div></div>

  <!--
    El botón de imprimir va DENTRO de la vista previa y no se imprime.

    Antes se abría el diálogo de impresión de golpe: no había forma de mirar la hoja
    antes —comprobar que están todos los productos y que las cantidades cuadran— sin
    cancelar el diálogo primero.
  -->
  <div class="acciones">
    <button onclick="window.print()">Imprimir</button>
    <button onclick="window.close()">Cerrar</button>
  </div>
</body></html>`
}

/**
 * Abre la hoja en una ventana aparte, PARA MIRARLA.
 *
 * No lanza el diálogo de impresión: la hoja se revisa antes —que estén todos los
 * productos, que las cantidades cuadren— y se imprime desde el botón de la propia vista.
 * Lanzarlo de golpe obligaba a cancelar el diálogo para poder leer lo que se iba a
 * imprimir.
 */
export function imprimirPreDespacho(d: PreDespacho): void {
  const v = window.open('', '_blank', 'width=900,height=700')

  if (!v) return
  v.document.write(htmlPreDespacho(d))
  v.document.close()
  v.focus()
}
