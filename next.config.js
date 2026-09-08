/**
 * La marca de esta version. Se calcula UNA vez, al evaluar este fichero durante el
 * build, y viaja a dos sitios: al `buildId` de Next y —via `env`— incrustada como
 * literal tanto en el JavaScript del navegador como en /api/version.
 *
 * Eso es exactamente lo que hace falta para avisar de versiones viejas: una pestaña
 * abierta desde ayer lleva DENTRO de su JavaScript la marca de ayer, mientras que
 * /api/version, que corre en el contenedor nuevo, devuelve la de hoy. Si no coinciden,
 * esa pestaña esta usando codigo viejo.
 *
 * El Dockerfile puede pasar BUILD_ID (el commit, por ejemplo) para que la marca diga
 * algo; si no, la hora del build vale igual: lo unico que se le pide es cambiar en cada
 * despliegue y no cambiar dentro del mismo.
 */
const VERSION_APP = process.env.BUILD_ID || String(Date.now())

/** @type {import('next').NextConfig} */
// `output: standalone` SOLO para la imagen de Docker (produccion futura), donde se
// arranca con `node server.js`. Bajo PM2 corremos `next start`, y ahi standalone
// provoca el warning "next start does not work with output: standalone" en cada
// arranque (ensuciando el -error.log). Por eso lo activamos solo si el build lo pide
// via BUILD_STANDALONE=1 (el Dockerfile lo setea antes de `npm run build`).
const nextConfig = {
  ...(process.env.BUILD_STANDALONE === '1' ? { output: 'standalone' } : {}),

  generateBuildId: () => VERSION_APP,
  env: { VERSION_APP },

  /**
   * El HTML NO se guarda en caché. Los ficheros con hash en el nombre, para siempre.
   *
   * Estas pantallas se prerenderizan, así que su HTML es un fichero estático y tanto el
   * navegador como Cloudflare —que va delante— se lo quedaban. El HTML viejo apunta a los
   * `chunks` viejos por su nombre con hash, así que después de un despliegue la gente
   * seguía viendo la versión anterior: filtros que ya existen sin aparecer, arreglos que
   * no llegan. Y la única salida era Ctrl+Shift+R, que nadie tiene por qué saberse.
   *
   * Los ficheros de `/_next/static/` sí se cachean a lo bestia, y es correcto: llevan el
   * hash del contenido en el nombre, así que uno nuevo es una URL nueva. Lo que no puede
   * cachearse es el documento que dice CUÁLES son los de ahora.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}
module.exports = nextConfig
