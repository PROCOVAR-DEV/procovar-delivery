-- Cuándo se trajo por última vez el catálogo de Ventra. El espejo mira esto para no
-- preguntarle al almacén en cada ciclo: cambia poco y se llega por VPN.
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "catalogoTraidoAt" TIMESTAMP(3);
