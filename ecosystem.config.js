// PM2 para delivery (Next.js). Arranca en el puerto 3002.
// Las variables de entorno se leen de procovar-delivery/.env (Next las carga solo).
// El worker sync-pedidos.mjs también lee ese .env.
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
  ],
};
