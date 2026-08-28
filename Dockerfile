FROM node:20-alpine AS base

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app
# Playwright es una herramienta de PRUEBAS: aquí sólo se instala el paquete, nunca los
# navegadores. Su script de instalación se baja ~150 MB de Chromium por su cuenta, y en la
# imagen de producción eso es tiempo de build y peso de imagen para algo que nunca se va a
# ejecutar: los navegadores viven en la imagen de Playwright, que es donde corren las
# pruebas (ver PRUEBAS.md).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json* ./
RUN npm ci

# ---- Builder ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# La imagen Docker SI usa el server standalone (CMD node server.js), asi que el build
# debe emitir output:standalone. Bajo PM2 este flag va ausente y se usa `next start`.
ENV BUILD_STANDALONE=1
RUN npm run build

# ---- Runner ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# OpenSSL 1.1 compatibility for Prisma query engine on Alpine
RUN apk add --no-cache openssl

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Install Prisma CLI globally so we can run migrations at container start
RUN npm install -g prisma@5.22.0 \
  && chown -R nextjs:nodejs /usr/local/lib/node_modules/prisma

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma: schema + generated client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run migrations then start the standalone server
CMD ["sh", "-c", "prisma migrate deploy && node server.js"]

