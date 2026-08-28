import { chromium } from 'playwright'
const TOKEN = process.env.TOKEN
const BASE = 'http://localhost:3610'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1600, height: 950 } })
await ctx.addCookies([{ name: 'qb.session_token', value: TOKEN, url: BASE }])
const page = await ctx.newPage()
const err = []
page.on('pageerror', (e) => err.push(String(e).slice(0, 150)))
await page.goto(BASE + '/dashboard/organizations', { waitUntil: 'networkidle', timeout: 60000 })
console.log('URL:', page.url())
const boton = page.locator('button', { hasText: /Nueva sucursal/i }).first()
if (await boton.count()) {
  await boton.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '/app/capturas/auth-cajon.png' })
  const caja = await page.locator('[role="dialog"]').first().boundingBox().catch(() => null)
  console.log('cuadro:', JSON.stringify(caja))
  if (caja) {
    console.log('pegado al borde derecho:', Math.abs((caja.x + caja.width) - 1600) < 12)
    console.log('alto completo:', caja.height > 800)
  }
} else {
  console.log('sin botón; texto:', (await page.locator('body').innerText()).slice(0, 200))
  await page.screenshot({ path: '/app/capturas/auth-lista.png' })
}
console.log('errores:', err.join(' | ') || 'ninguno')
await b.close()
