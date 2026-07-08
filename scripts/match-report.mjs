// Reporte de matching: productos de PEDIDO vs catalogo de pesos del Data Warehouse.
// Normaliza ambos nombres (marca + volumen en ML, sin ruido de empaque/categoria) y
// reporta: matcheado con peso / matcheado sin peso (SKU con weightKg null) / sin match.
import fs from 'node:fs';

const WH_URL = process.env.WAREHOUSE_API_URL;
const WH_TOKEN = process.env.WAREHOUSE_API_TOKEN;
const PEDIDO_URL = process.env.PEDIDO_API_URL || 'http://localhost:8401';
const KEY = process.env.SERVICE_API_KEY;

// palabras de ruido: categorias y empaque (no identifican el producto)
const NOISE = new Set([
  'ALIMENTOS','ASEO','HIGIENE','HOGAR','HIGIENEHOGAR','TECNOLOGIA','BEBIDAS','CONFITERIA',
  'CERVEZA','BLISTER','CAJA','PACA','PALET','TONEL','BOTELLA','UNIDAD','UNIDADES','PAQUETE',
  'DE','X','P','U','REFRESCO', // REFRESCO se repite (categoria + nombre) -> se colapsa
]);

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// devuelve { key, volMl } normalizado
function normalize(nameRaw) {
  let s = stripAccents(String(nameRaw || '').toUpperCase());
  s = s.replace(/[.,](?=\d)/g, '.'); // 0,33 -> 0.33
  // volumen -> ML
  let volMl = null;
  let m = s.match(/(\d+(?:\.\d+)?)\s*L\b/);          // litros
  if (m) volMl = Math.round(parseFloat(m[1]) * 1000);
  if (volMl == null) { m = s.match(/(\d+)\s*ML\b/); if (m) volMl = parseInt(m[1], 10); }
  // quitar volumen del texto para no dejar numeros sueltos
  s = s.replace(/\d+(?:\.\d+)?\s*ML\b/g, ' ').replace(/\d+(?:\.\d+)?\s*L\b/g, ' ');
  // quitar conteos de empaque: 6U, 20U, 12P, 24U, etc.
  s = s.replace(/\b\d+\s*[UP]\b/g, ' ');
  // tokens: solo palabras alfabeticas, sin ruido
  const toks = s.split(/[^A-Z]+/).filter((t) => t && !NOISE.has(t) && t.length > 1);
  // dedup + orden (marca independiente del orden)
  const uniq = [...new Set(toks)].sort();
  return { key: uniq.join(' ') + (volMl != null ? ' @' + volMl : ''), toks: uniq, volMl };
}

async function main() {
  const wh = await fetch(`${WH_URL}/products/weights`, { headers: { Authorization: `Bearer ${WH_TOKEN}` } }).then((r) => r.json());
  const byKey = new Map();
  for (const p of wh) {
    const n = normalize(p.name);
    if (!byKey.has(n.key)) byKey.set(n.key, { sku: p.sku, name: p.name, weightKg: p.weightKg });
  }

  const j = await fetch(`${PEDIDO_URL}/integration/orders?onlyPending=1`, { headers: { 'x-api-key': KEY } }).then((r) => r.json());
  const counts = {};
  (j.orders || []).forEach((o) => (o.items || []).forEach((it) => {
    const nm = (it.producto || '').trim();
    if (nm) counts[nm] = (counts[nm] || 0) + 1;
  }));

  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, n]) => {
    const k = normalize(name);
    const hit = byKey.get(k.key);
    let estado;
    if (!hit) estado = 'SIN MATCH';
    else if (hit.weightKg == null) estado = 'MATCH sin peso (SKU null)';
    else estado = `MATCH  ${hit.weightKg} kg  [${hit.sku}]`;
    return { name, n, estado, wh: hit ? hit.name : '' };
  });

  const conPeso = rows.filter((r) => r.estado.startsWith('MATCH ') && !r.estado.includes('sin peso'));
  const sinPeso = rows.filter((r) => r.estado.includes('sin peso'));
  const sinMatch = rows.filter((r) => r.estado === 'SIN MATCH');

  console.log(`\nPRODUCTOS EN PEDIDO: ${rows.length} distintos\n`);
  console.log(`  con peso OK:        ${conPeso.length}`);
  console.log(`  match SIN peso:     ${sinPeso.length}  (el SKU existe pero weightKg=null en el warehouse)`);
  console.log(`  SIN match:          ${sinMatch.length}\n`);
  console.log('DETALLE (x=veces que aparece):');
  for (const r of rows) {
    console.log(`  x${String(r.n).padStart(3)}  ${r.name.padEnd(46)} -> ${r.estado}`);
    if (r.wh && r.wh) console.log(`         warehouse: ${r.wh}`);
  }
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
