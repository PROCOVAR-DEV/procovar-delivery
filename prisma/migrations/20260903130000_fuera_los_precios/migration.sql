-- Fuera los parámetros de precio de Settings.
--
-- Delivery ya no calcula el precio del domicilio: lo pone la APK de Entrega y llega en
-- `pedidoCosto`. Estas doce columnas eran lo que quedaba de cinco fórmulas distintas, y
-- la pantalla de Configuración que las editaba ya no existía: nadie las leía y hacían
-- creer que aquí se decide lo que se cobra.
--
-- Lo que se queda: `currency`, `cupRate` y `currencies` (en qué moneda se MUESTRAN los
-- importes) y `tiposVehiculo` (el costo de la flota, que sí es de delivery).
ALTER TABLE "Settings"
  DROP COLUMN IF EXISTS "baseFee",
  DROP COLUMN IF EXISTS "costPerKm",
  DROP COLUMN IF EXISTS "costPerKg",
  DROP COLUMN IF EXISTS "domBaseFee",
  DROP COLUMN IF EXISTS "domCostPerKm",
  DROP COLUMN IF EXISTS "domCostPerKg",
  DROP COLUMN IF EXISTS "domIncludedKm",
  DROP COLUMN IF EXISTS "domMinFee",
  DROP COLUMN IF EXISTS "domRoundTo",
  DROP COLUMN IF EXISTS "domTipoCambio",
  DROP COLUMN IF EXISTS "domFactorCapacidad",
  DROP COLUMN IF EXISTS "domConfigured";

-- Y si el pedido CUADRA porque se corrigió, o porque vino bien.
--
-- Los dos quedan en `facturaEstado = 'igual'` y se reparten igual, pero no son lo mismo:
-- uno se tomó bien y el otro se reescribió con lo facturado. Quien carga el camión tiene
-- que poder verlo. Lo pone PEDIDO; aquí llega copiado por el espejo.
ALTER TABLE "Order" ADD COLUMN "facturaCorregidoAt" TIMESTAMP(3);
