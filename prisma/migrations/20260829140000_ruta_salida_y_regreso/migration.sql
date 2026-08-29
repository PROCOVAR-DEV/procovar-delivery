-- Cuándo salió la ruta y cuándo volvió: con las dos se sabe cuánto se demoró.
-- No se deduce de createdAt (se arma la noche antes) ni de updatedAt (se toca por todo).
ALTER TABLE "Route" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "Route" ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP(3);

-- Las que ya estaban en curso o completadas se quedan sin horas: inventarlas sería peor
-- que no tenerlas. A partir de aquí se marcan solas al despachar y al cerrar.
