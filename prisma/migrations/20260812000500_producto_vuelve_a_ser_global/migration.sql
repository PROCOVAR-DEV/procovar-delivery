-- Deshacer la sucursal en los productos.
--
-- La añadí por leer mal una frase. Los productos vienen del ALMACÉN DE DATOS y
-- son los mismos para toda la empresa: no pertenecen a ninguna sucursal.
--
-- La columna estuvo puesta unos minutos y nadie llegó a asignar ninguna, así que
-- quitarla no pierde nada.
DROP INDEX IF EXISTS "Product_branchId_idx";
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_branchId_fkey";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "branchId";
