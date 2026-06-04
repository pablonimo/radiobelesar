# Radio Belesar — Mesa de son

Aplicación web tipo *soundboard* para a radio escolar do CEIP Belesar. Dispara sintonías,
separadores e efectos desde unha tableta táctil ou un teclado físico, en galego, con latencia
mínima (Web Audio API). Os sons gárdanse nun servidor central e compártense en todos os
dispositivos.

- **Frontend**: TypeScript (vanilla) + Web Audio API + Canvas.
- **Backend**: Node.js + Fastify + SQLite (`better-sqlite3`).
- **Despregue**: imaxe Docker en GHCR, enrutada por Traefik, actualizada por Watchtower.

Consulta `ARQUITECTURA.md` (deseño completo) e `DESPLEGUE.md` (pasos no servidor).

## Desenvolvemento local

```bash
npm install
npm run dev          # API en :3000 e Vite en :5173 (con proxy a /api)
```

Abre http://localhost:5173. A clave inicial é `belesar` (cámbiase desde a app).
Os datos gárdanse en `./data` (audios + `radiobelesar.db`).

## Build de produción

```bash
npm run build        # compila frontend (dist/client) e backend (dist/server)
npm start            # serve todo en http://localhost:3000
```

## Estrutura

```
src/        frontend (motor de audio + UI)
server/     backend (API + estáticos)
deploy/     docker-compose do servidor
.github/    workflow de build e push a GHCR
```
