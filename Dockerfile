# ---- Etapa de build: compila frontend (Vite) e backend (tsc) ----
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Ferramentas para compilar módulos nativos (better-sqlite3, argon2)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev

# ---- Etapa de runtime: imaxe mínima ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

# Copiamos só o necesario; os módulos nativos xa están compilados na etapa build
# (mesma base glibc => compatibles).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "dist/server/index.js"]
