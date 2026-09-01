-- Lo que la FACTURA cobró por el reparto, copiado de PEDIDO.
--
-- Es la señal más fiable de que un pedido va a domicilio: sale de lo que se cobró en el
-- mostrador, no de una casilla que alguien marcó al tomar el pedido.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "facturaDomicilio" DOUBLE PRECISION;
