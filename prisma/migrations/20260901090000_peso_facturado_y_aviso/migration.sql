-- Lo que PESA la factura, y qué se le dijo ya a PEDIDO.
--
-- El peso de lo facturado no es el de lo pedido cuando el cliente cambia el pedido al ir
-- a facturar, y es el que manda: es lo que sube al camión y por lo que se cobra el
-- domicilio. `facturaAvisado` guarda lo último que se le mandó a PEDIDO para no repetirse
-- —cada escritura allí mueve el `updatedAt` con el que sincronizan las tablets—.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "pesoFacturado" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "facturaAvisado" TEXT;
