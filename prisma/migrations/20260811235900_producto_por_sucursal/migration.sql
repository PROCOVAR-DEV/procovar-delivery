-- Los productos pasan a tener sucursal, como ya la tenían los vehículos.
--
-- No estaba, y no era una decisión: era un hueco. Sin ella el catálogo era de
-- todos y cada sucursal veía los productos de las demás.
--
-- Los que ya existen se quedan con `NULL` = de todas las sucursales, que es lo
-- que han sido hasta ahora. Ponerles una a ciegas sería inventarse a quién
-- pertenecen; así siguen viéndose como hasta hoy y se les asigna cuando alguien
-- lo decida.
ALTER TABLE "Product" ADD COLUMN "branchId" TEXT;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Product_branchId_idx" ON "Product"("branchId");
