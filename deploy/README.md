# Despliegue

Este proyecto se despliega de **dos formas** (elige una):

## 1) LOCAL — un servidor por sucursal (Windows + PM2)
Guía: [`local/DEPLOY-LOCAL.md`](local/DEPLOY-LOCAL.md)

Cada sucursal corre su propia copia (PM2). Aislado, sin Docker.

## 2) VPS — centralizado, todas las sucursales juntas (Docker + Redis)
Guía: [`vps/DEPLOY-VPS.md`](vps/DEPLOY-VPS.md)

Orquesta los **tres** proyectos (PEDIDO, delivery, analitics) en un mismo VPS con
`docker-compose.yml`. Como el compose levanta los tres a la vez, sus rutas de build
(`./PEDIDO-pg/api`, `./procovar-delivery`, ...) son **relativas a una carpeta padre**
donde los tres repos están clonados como hermanos:

```
vps-deploy/
├── PEDIDO-pg/            (clon)
├── procovar-delivery/   (clon)
├── sucursal-analitics/  (clon)
├── docker-compose.yml   <- copiado desde <repo>/deploy/vps/
├── .env                 <- copiado desde .env.example y rellenado
├── Caddyfile
└── initdb/
```

Pasos: clona los 3 repos como hermanos, copia `deploy/vps/{docker-compose.yml,.env.example,Caddyfile,initdb}`
a la carpeta padre, `cp .env.example .env` y rellena, luego `docker compose up -d`.

> El bundle de `vps/` es **idéntico** en los tres repos (es el mismo stack). Está en cada
> repo para que viaje versionado con el código.
