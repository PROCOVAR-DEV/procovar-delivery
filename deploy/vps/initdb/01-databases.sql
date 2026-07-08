-- Crea las dos bases de datos del sistema en la PRIMERA inicializacion del
-- volumen de Postgres (docker-entrypoint-initdb.d).
--
-- Postgres no soporta "CREATE DATABASE IF NOT EXISTS", asi que emulamos la
-- idempotencia con un bloque condicional via gen_random_uuid()/dblink-free:
-- solo creamos si no existe en pg_database.

SELECT 'CREATE DATABASE procovar_pedido'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'procovar_pedido')\gexec

SELECT 'CREATE DATABASE procovar_delivery'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'procovar_delivery')\gexec
