// PM2 para delivery (Next.js). Arranca en el puerto 3002.
// IMPORTANTE (gotcha): Next NO siempre carga .env bajo PM2. Arranca exportando el
// .env al entorno antes de `pm2 start` (set -a; . ./.env; set +a; pm2 start ...),
// o define las envs en el bloque env de abajo. Tras arrancar: `pm2 save`.
module.exports = {
  apps: [
    {
      name: 'procovar-delivery',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3002',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/delivery-error.log',
      out_file: './logs/delivery-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      // Cola de sincronización de domicilios (procesa pedidos de a uno, suave).
      // Reemplaza el sync bulk. Lee el mismo .env que la app.
      name: 'procovar-delivery-sync',
      script: 'sync-queue.mjs',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/sync-error.log',
      out_file: './logs/sync-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
