# Radio Belesar — Mesa de son. Arquitectura y despliegue

Documento de arquitectura para la aplicación web de mesa de son del CEIP Belesar.
Stack elegido: **backend Node.js + frontend Vanilla TypeScript con Web Audio API**, alojado en
GitHub (`pablonimo/radiobelesar`) y desplegado en el VPS Ubuntu de Hostinger bajo el dominio
`radiobelesar.maizehalle.com`.

---

## 1. Decisiones de stack y por qué

El requisito crítico (latencia, sección 11 del documento funcional) vive **en el navegador**, no en el
servidor. La reproducción instantánea, el solapamiento, los fundidos, el bucle, el recorte y la forma de
onda solo se pueden lograr con la **Web Audio API**: hay que precargar cada audio como `AudioBuffer` y
dispararlo con un `AudioBufferSourceNode`. El elemento `<audio>` de HTML no ofrece esa precisión ni el
solapamiento, así que queda descartado para el disparo.

El backend, en cambio, es una capa fina: almacena y sirve los ficheros de audio, guarda la configuración y
verifica la clave compartida. Por eso elegimos un único lenguaje en toda la pila.

| Capa | Tecnología | Motivo |
|------|------------|--------|
| Frontend | TypeScript (vanilla) + Web Audio API + Canvas | Latencia mínima, sin framework pesado, bundle pequeño y previsible |
| Empaquetado frontend | Vite | Compila TS a estáticos optimizados; servidor de desarrollo rápido |
| Backend | Node.js + Fastify | Mismo lenguaje que el frontend, subida de ficheros sencilla, alto rendimiento |
| Base de datos | SQLite (`better-sqlite3`) | Un solo fichero, atómico, copia de seguridad trivial, sin servidor extra |
| Almacenamiento de audio | Carpeta persistente en disco, fuera del repo | Sobrevive a los despliegues; copia de seguridad sencilla |
| Hash de clave | `argon2` (o `bcrypt`) | Nunca se guarda la clave en texto plano |
| Sesión | Cookie firmada con HMAC (token de acceso) | Verificación de la clave en el servidor, no solo visual |
| Reverse proxy | **Traefik v3** (ya en el VPS) | HTTPS, enruta por labels de Docker, certificado automático |
| Certificado | Let's Encrypt vía Traefik (`certresolver`) | HTTPS gratuito y autorrenovable, sin pasos manuales |
| Empaquetado / proceso | **Docker** (imagen en GHCR) | Reinicio automático (`restart: unless-stopped`); aislado del resto |
| Despliegue continuo | GitHub Actions → GHCR → **Watchtower** | Push a `main` y el contenedor se actualiza solo |

> **Nota sobre Moodle.** Este diseño es para el VPS. Si más adelante se quiere mostrar dentro del Moodle
> corporativo de la Xunta, se embebe la app alojada en el VPS mediante un iframe o una herramienta externa
> LTI. No se construye como plugin nativo de Moodle.

---

## 2. Estructura del proyecto (repositorio GitHub)

```
radiobelesar/
├── README.md
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example                  # plantilla de variables (sin secretos reales)
├── vite.config.ts                # build del frontend
│
├── src/                          # FRONTEND (TypeScript)
│   ├── main.ts                   # arranque: login, carga de pads, AudioContext
│   ├── audio/
│   │   ├── engine.ts             # AudioContext, caché de AudioBuffer, disparo
│   │   ├── playback.ts           # modos: golpe, fundido, hold, bucle, recorte
│   │   └── waveform.ts           # cálculo de picos y dibujo en canvas
│   ├── ui/
│   │   ├── grid.ts               # grella de pads tipo QWERTY
│   │   ├── pad.ts                # render de un pad (color, iconos, estados)
│   │   ├── bottombar.ts          # barra inferior: onda, recorte, controles
│   │   └── keyboard.ts           # mapeo y eventos de teclado físico
│   ├── api/
│   │   └── client.ts             # llamadas al backend (fetch)
│   ├── state.ts                  # estado en memoria de pads y selección
│   └── styles.css                # paleta Radio Belesar
│
├── server/                       # BACKEND (Node.js)
│   ├── index.ts                  # arranque Fastify, rutas estáticas + API
│   ├── routes/
│   │   ├── auth.ts               # login, cambio de clave
│   │   ├── pads.ts               # CRUD de pads y configuración
│   │   └── audio.ts              # subida y servido de ficheros de audio
│   ├── db.ts                     # acceso a SQLite (esquema y consultas)
│   ├── auth.ts                   # hash argon2, verificación, token HMAC
│   └── config.ts                 # lee variables de entorno
│
├── public/                       # estáticos servidos tal cual (favicon, logo)
│
└── deploy/
    ├── deploy.sh                 # script de despliegue en el servidor
    ├── radiobelesar.service      # unidad systemd
    └── nginx.conf                # bloque de servidor Nginx
```

**Carpetas que NO van en el repositorio** (se crean en el servidor y se ignoran en `.gitignore`):

```
/var/lib/radiobelesar/
├── audio/                        # ficheros de audio subidos (uno por pad)
└── radiobelesar.db               # base de datos SQLite (config + hash de clave)
```

Mantener los datos fuera del repo es lo que permite que un `git pull` + build no borre nunca los sonidos.

---

## 3. Modelo de datos (SQLite)

```sql
-- Cada fila es una tecla de la mesa. Si sound_file es NULL, el pad está vacío.
CREATE TABLE pads (
  key          TEXT PRIMARY KEY,   -- "1".."0", "Q".."P", "A".."Ñ", "Z"..",", "SPACE"
  sound_file   TEXT,               -- nombre del fichero en /audio (NULL = vacío)
  display_name TEXT,               -- nombre mostrado en el pad
  original_name TEXT,              -- nombre original del fichero subido
  mime         TEXT,
  duration     REAL,               -- segundos
  volume       REAL DEFAULT 1.0,   -- 0.0 .. 1.0
  mode         TEXT DEFAULT 'golpe', -- 'golpe' | 'fundido'
  hold         INTEGER DEFAULT 0,  -- 0/1  "só mentres se preme"
  loop         INTEGER DEFAULT 0,  -- 0/1  bucle
  trim_start   REAL,               -- segundos, NULL = sin recorte
  trim_end     REAL,               -- segundos, NULL = sin recorte
  color        TEXT,               -- acento: 'verde' | 'mostaza' | 'terracota'
  peaks        TEXT,               -- JSON con los picos de la onda (precalculados)
  updated_at   INTEGER             -- epoch ms
);

-- Una sola fila con la configuración global.
CREATE TABLE meta (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,     -- argon2, nunca texto plano
  version       INTEGER DEFAULT 1
);
```

El conjunto es **único y global**: no hay perfiles ni cuentas. La clave compartida vive en `meta`.

---

## 4. API del backend

Todas las rutas que **modifican** el conjunto exigen un token de acceso válido (cookie firmada que el
servidor emite tras verificar la clave). La reproducción y visualización solo requieren haber pasado la
pantalla de acceso.

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/api/login` | — | Recibe la clave, la verifica contra el hash, emite cookie de sesión |
| `POST` | `/api/password` | sesión | Cambia la clave (exige la actual); reescribe el hash |
| `GET`  | `/api/pads` | sesión | Devuelve el conjunto completo: config de cada pad + URLs de audio |
| `GET`  | `/api/audio/:file` | sesión | Sirve el fichero de audio (con `Range` y caché para la precarga) |
| `POST` | `/api/pads/:key/sound` | sesión | Sube/asigna un audio a un pad (multipart). Guarda fichero + metadatos |
| `PUT`  | `/api/pads/:key` | sesión | Actualiza configuración (volumen, modo, hold, loop, recorte, color, nombre) |
| `DELETE` | `/api/pads/:key/sound` | sesión | Vacía el pad: borra fichero y configuración |
| `GET`  | `/api/backup` | sesión | (Futuro) Descarga un ZIP con audios + base de datos |

Notas de implementación:

- **Subida**: `@fastify/multipart`, con `client_max_body_size` de Nginx y límite de Fastify a ~25 MB
  (margen sobre los 15–20 MB del documento). Validar el tipo MIME (MP3, WAV, OGG, M4A, AAC, WEBM).
- **Servido de audio**: cabeceras `Cache-Control` y soporte de `Range` para que el navegador pueda
  precargar de forma eficiente.
- **Forma de onda**: los picos se calculan una vez (al subir, en el cliente con un `OfflineAudioContext`
  o en el servidor) y se guardan en `pads.peaks`. Así no se recalculan en cada apertura.

---

## 5. Diseño de la latencia (lo más importante)

Esto es lo que hace que la app se sienta como una mesa de son física. Reglas de oro:

1. **Precarga total al abrir.** Tras el login, `GET /api/pads` trae la configuración; el motor descarga
   cada audio como `ArrayBuffer` y lo decodifica con `decodeAudioData` en un **`AudioBuffer`** que queda
   en una caché en memoria (`Map<key, AudioBuffer>`). Cada pad muestra su estado: *procesando / listo /
   sen onda*.

2. **Disparo directo.** Al pulsar una tecla o tocar un pad, el camino es mínimo y siempre el mismo:

   ```ts
   const src = ctx.createBufferSource();
   src.buffer = cache.get(key);              // ya está en memoria
   const gain = ctx.createGain();
   gain.gain.value = pad.volume;
   src.connect(gain).connect(ctx.destination);
   const offset = pad.trimStart ?? 0;
   const dur = pad.trimEnd ? pad.trimEnd - offset : undefined;
   src.loop = pad.loop;                      // con recorte: loopStart/loopEnd
   src.start(0, offset, dur);                // suena al instante
   ```

   No hay descarga ni búsqueda en el momento del disparo: solo iniciar un buffer ya disponible.

3. **Nada pesado en el camino del disparo.** El cálculo de la onda, el guardado de configuración en el
   servidor y cualquier proceso costoso se ejecutan de forma asíncrona (`requestIdleCallback`, promesas)
   y **nunca** bloquean `start()`. La prioridad absoluta al pulsar es que suene.

4. **Solapamiento sin coste.** Cada disparo crea su propio `AudioBufferSourceNode` (son de un solo uso),
   así que pulsar varias teclas seguidas o a la vez no acumula retardo ni corta sonidos previos.

5. **Política de autoplay del navegador.** El `AudioContext` arranca suspendido hasta que hay un gesto del
   usuario. Se hace `ctx.resume()` en el primer toque/tecla (por ejemplo, al entrar con la clave), de modo
   que el motor ya está activo antes del primer disparo real.

6. **Modos de reprodución** (sección 5.1) se implementan sobre el `GainNode`:
   - *Golpe*: volumen directo, sin rampa.
   - *Fundido*: `gain.linearRampToValueAtTime` al entrar y al salir.
   - *Só mentres se preme (hold)*: `start()` en `keydown`/`pointerdown`, `stop()` en `keyup`/`pointerup`.
   - *Bucle*: `src.loop = true`; con recorte se usan `loopStart`/`loopEnd`.

---

## 6. Identidad visual y disposición

- **Paleta** (variables CSS): fondo crema; tres acentos — verde azulado, amarillo mostaza, terracota —
  repartidos entre los pads por categoría/color.
- **Grella QWERTY**: cuatro filas alfanuméricas (`1-0`, `Q-P`, `A-Ñ`, `Z-,`) más la barra espaciadora en
  su propia fila ancha.
- **Estados del pad**: vacío (indicador "subir son"), con son (color + nombre), iconos de fundido / hold /
  bucle, borde resaltado para el seleccionado, y halo para el que está sonando.
- **Barra inferior**: forma de onda interactiva con sombra de progreso, tiempos, asas de recorte y los
  controles (play/stop, volumen, modo, hold, bucle, sustituir, eliminar).

---

## 7. Acceso y seguridad

- Clave **compartida única**, sin cuentas. Se pide al abrir la app.
- La clave se guarda **hasheada** (argon2) en `meta.password_hash`; nunca en texto plano.
- `POST /api/login` verifica la clave en el servidor y emite una **cookie firmada** (HMAC con un secreto
  del servidor). Las mutaciones comprueban esa cookie en el servidor, de modo que nadie puede alterar el
  conjunto saltándose la pantalla visual.
- Cambio de clave desde dentro: exige la clave actual, recalcula el hash, y la nueva vale para todos.
- HTTPS obligatorio (Let's Encrypt). La cookie se marca `Secure`, `HttpOnly`, `SameSite=Strict`.

---

## 8. Despliegue en el VPS (Docker + Traefik + GHCR + Watchtower)

El servidor **no usa Nginx ni systemd**: tiene **Traefik v3** como reverse proxy (entrypoints
`web`/`websecure`, redirección 80→443 global y certresolver `letsencrypt` por HTTP-challenge) y
enruta los servicios por **labels de Docker**. El patrón de despliegue ya en uso (visto en
`coinbase-bot`) es **GitHub → imagen en GHCR → Watchtower actualiza el contenedor solo**. Radio
Belesar sigue ese mismo patrón.

```
git push (main) → GitHub Actions construye la imagen → ghcr.io/pablonimo/radiobelesar:latest
                                                              ↓
                                          Watchtower (en el VPS) detecta la nueva imagen
                                                              ↓
                                              actualiza el contenedor radiobelesar
```

Los pasos completos están en **`DESPLEGUE.md`**. Resumen:

1. **DNS**: registro `A` `radiobelesar` → IP del VPS (igual que `secuencias`/`incumprimentos`).
2. **Repo + CI**: `.github/workflows/build.yml` construye y publica la imagen en GHCR en cada push
   a `main` (con el `GITHUB_TOKEN`, sin secretos extra). El paquete GHCR se pone **público** para
   que Watchtower pueda descargarlo.
3. **Servidor**: se copia `deploy/docker-compose.yml` a `~/radiobelesar/docker-compose.yml` y se
   ejecuta `docker compose up -d`. Traefik (en red `host`) descubre el contenedor por el socket de
   Docker y gestiona el TLS automáticamente.

`deploy/docker-compose.yml` (labels que copian el patrón de `secuencias`):

```yaml
services:
  radiobelesar:
    image: ghcr.io/pablonimo/radiobelesar:latest
    container_name: radiobelesar
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATA_DIR=/data
    volumes:
      - radiobelesar-data:/data           # audios + sqlite, persistente
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.radiobelesar.entrypoints=websecure"
      - "traefik.http.routers.radiobelesar.rule=Host(`radiobelesar.maizehalle.com`)"
      - "traefik.http.routers.radiobelesar.tls=true"
      - "traefik.http.routers.radiobelesar.tls.certresolver=letsencrypt"
      - "traefik.http.services.radiobelesar.loadbalancer.server.port=3000"
      - "com.centurylinklabs.watchtower.enable=true"
volumes:
  radiobelesar-data:
```

> No se publican puertos al host (no hay `ports:`): Traefik alcanza el contenedor por su IP de red
> Docker en el puerto interno 3000, exactamente como `secuencias` e `incumprimentos`.

### 8.1. Actualizaciones

Automáticas vía Watchtower al publicar una nueva imagen. Forzado manual:
`cd ~/radiobelesar && docker compose pull && docker compose up -d`.

### 8.2. Persistencia y copia de seguridad

Los datos viven en el volumen Docker `radiobelesar-data` (montado en `/data`), así que las
actualizaciones de imagen nunca los borran. Copia de seguridad:

```bash
docker run --rm -v radiobelesar_radiobelesar-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/radiobelesar-$(date +%F).tar.gz -C /data .
```

---

## 9. Cobertura de los requisitos funcionales

| Requisito | Cómo se cubre |
|-----------|---------------|
| Latencia inmediata (§11) | Precarga en `AudioBuffer` + disparo directo con `AudioBufferSourceNode` |
| Solapamiento de sonidos (§5) | Un `BufferSource` nuevo por disparo |
| Alternancia / parar todo (§5) | Registro de nodos activos; `stop()` individual y global (botón pánico) |
| Modos golpe/fundido/hold/bucle (§5.1) | `GainNode` + rampas + eventos de tecla + `loop`/`loopStart` |
| Recorte (§7.2) | `trim_start`/`trim_end` en disparo y en bucle; asas sobre la onda |
| Forma de onda (§7.1) | Picos precalculados en `peaks`, dibujo en Canvas, sombra de progreso |
| Persistencia central (§6, §10) | SQLite + carpeta de audio en volumen persistente |
| Multidispositivo, misma URL (§13) | Web servida por HTTPS, misma config para todos |
| Clave compartida + hash + verificación servidor (§9) | argon2 + cookie HMAC + auth en mutaciones |
| Servicio continuo / reinicio (§13) | Docker `restart: unless-stopped` |
| HTTPS (§13) | Let's Encrypt automático vía Traefik (`certresolver`) |
| Copia de seguridad (§10) | `tar` del volumen Docker `radiobelesar-data` |
| Tolerancia a errores (§12) | El audio se reproduce aunque falle la onda; mensajes claros de error de red |

---

## 10. Funcionalidades futuras (fuera del alcance inicial)

Ya previstas en el diseño para añadir sin reescribir: exportar/importar el conjunto en un fichero
(`/api/backup` y su inverso), ajuste fino del recorte por décimas, roles (solo reproducir vs. modificar),
organización por programa/categorías, y sonidos fijos predefinidos servidos con el sistema.

---

## 11. Próximos pasos sugeridos

1. Crear el repositorio `pablonimo/radiobelesar` y subir el esqueleto (`package.json`, `tsconfig`,
   estructura de carpetas).
2. Implementar el backend mínimo (login, pads, subida/servido de audio) con SQLite.
3. Implementar el motor de audio (precarga, disparo, modos) y la grella de pads.
4. Añadir barra inferior (onda, recorte, controles).
5. Crear el repo, dejar que GitHub Actions publique la imagen en GHCR, y desplegar en el VPS con
   `docker compose up -d` (Traefik + Watchtower, ver `DESPLEGUE.md`).
6. Pruebas en tableta táctil + teclado físico, midiendo la latencia real.
