# Radio Belesar — Mesa de son

Aplicación web tipo *soundboard* para a radio escolar do CEIP Belesar. Dispara sintonías,
separadores e efectos desde unha tableta táctil ou un teclado físico, en galego, con latencia
mínima (Web Audio API). Os sons gárdanse nun servidor central e compártense en todos os
dispositivos.

- **Frontend**: TypeScript (vanilla) + Web Audio API + Canvas.
- **Backend**: Node.js + Fastify + SQLite (`better-sqlite3`).
- **Despregue**: imaxe Docker en GHCR, enrutada por Traefik, actualizada por Watchtower.

## Funcionalidades destacadas

- **Bancos de sons (1–4)**: cada programa pode ter o seu propio tablero. A fila de
  números é común a todos os bancos. Cámbiase coas pestanas ou con F1–F4.
- **Conta atrás nos pads activos**: cada pad que soa mostra o tempo restante e unha
  barra de progreso; nos últimos 5 segundos avisa en cor terracota.
- **Pánico con fundido**: o botón "Parar todo" funde todas as voces (1,2 s);
  premelo outra vez durante o fundido corta en seco.
- **PWA con caché offline**: a app e os audios quedan cacheados por un service
  worker, de modo que a mesa segue funcionando aínda que caia a rede.

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
