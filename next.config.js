/** @type {import('next').NextConfig} */
// `output: standalone` SOLO para la imagen de Docker (produccion futura), donde se
// arranca con `node server.js`. Bajo PM2 corremos `next start`, y ahi standalone
// provoca el warning "next start does not work with output: standalone" en cada
// arranque (ensuciando el -error.log). Por eso lo activamos solo si el build lo pide
// via BUILD_STANDALONE=1 (el Dockerfile lo setea antes de `npm run build`).
const nextConfig = {
  ...(process.env.BUILD_STANDALONE === '1' ? { output: 'standalone' } : {}),
}
module.exports = nextConfig
