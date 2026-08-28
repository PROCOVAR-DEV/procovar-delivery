-- La FECHA DEL PEDIDO, que no es la de copiado.
--
-- `createdAt` es cuándo el espejo trajo el pedido, y el espejo trae quince días de una
-- vez: todos quedaban con la fecha de hoy. El armador de rutas filtra por día, así que
-- pedir cualquier otro día devolvía cero pedidos aunque estuvieran ahí.
ALTER TABLE "Order" ADD COLUMN "orderDate" TIMESTAMP(3);

CREATE INDEX "Order_orderDate_idx" ON "Order"("orderDate");
