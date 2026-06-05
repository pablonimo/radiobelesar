# Despregue — Radio Belesar

Adaptado ao teu servidor: **Traefik v3** como reverse proxy (entrypoint `websecure`,
certresolver `letsencrypt`), imaxe en **GHCR** e **Watchtower** para actualización automática.
É o mesmo patrón que xa usas con `coinbase-bot`.

## Onde se executa cada cousa

Cada bloque de comandos leva unha marca que indica o terminal no que se corre:

- **💻 [O TEU ORDENADOR]** — terminal aberto na carpeta do proxecto (onde está `package.json`).
- **🖥️ [SERVIDOR]** — terminal do VPS, despois de conectarte con `ssh maizehalle`.

## Fluxo xeral

```
git push (main)  ->  GitHub Actions constrúe a imaxe  ->  ghcr.io/pablonimo/radiobelesar:latest
                                                              |
                                                       Watchtower (no VPS) detecta a nova imaxe
                                                              |
                                                       actualiza o contedor radiobelesar
```

---

## 1. DNS

Isto faise no **panel web** da túa zona `maizehalle.com` (non é un comando de terminal). Engade un
rexistro **A**:

```
radiobelesar   A   <IP do VPS>
```

(o mesmo que xa fixeches para `secuencias` e `incumprimentos`).

Para coñecer a IP do servidor, podes executar:

**🖥️ [SERVIDOR]**

```bash
curl -s ifconfig.me; echo
```

---

## 2. Subir o código a GitHub

### 2.1. Crear o repositorio baleiro en GitHub (panel web)

1. Entra en <https://github.com/new>.
2. **Owner**: `pablonimo`  ·  **Repository name**: `radiobelesar`.
3. Visibilidade: a túa elección (privado vale).
4. **Importante**: NON marques "Add a README", nin ".gitignore", nin "license". O proxecto xa os
   trae e, se os engades aquí, daría conflito ao subir.
5. Preme **Create repository**.

### 2.2. Subir o código por primeira vez

**💻 [O TEU ORDENADOR]** — abre Git Bash ou PowerShell e executa, liña a liña:

```bash
cd "C:/Users/PC/Dropbox/IA/Claude_cowork_directory/Radio Belesar APP-web/Radio Belesar APP-web"
git init
git add .
git commit -m "Primeira versión: mesa de son Radio Belesar"
git branch -M main
git remote add origin https://github.com/pablonimo/radiobelesar.git
git push -u origin main
```

A primeira vez que fagas `git push`, abrirase o navegador para iniciar sesión en GitHub (o *Git
Credential Manager*, que vén con Git para Windows, garda o acceso para as seguintes veces).

> Se che pide usuario e contrasinal en lugar de abrir o navegador: o "contrasinal" xa non vale; usa
> un *Personal Access Token*. Créao en GitHub → Settings → Developer settings → Personal access
> tokens → Tokens (classic) → Generate, marcando `repo` e `write:packages`, e pégao como contrasinal.

*(Alternativa sen comandos: **GitHub Desktop** → File → Add local repository → escolle a carpeta →
Commit to main → Publish repository, co nome `radiobelesar` e owner `pablonimo`.)*

### 2.3. Comprobar que o build automático funciona (panel web)

O workflow `.github/workflows/build.yml` constrúe e publica a imaxe en cada push a `main` (usa o
`GITHUB_TOKEN`, sen segredos que configurar). Comproba:

- **GitHub → repo → Actions**: que o build remata en verde (1-2 minutos).
- **GitHub → repo → Packages**: que aparece a imaxe `radiobelesar`.

### 2.4. Facer público o paquete GHCR (panel web)

Para que Watchtower poida descargar a imaxe sen autenticación, pon o paquete como **público**:

> GitHub → repo → Packages → `radiobelesar` → Package settings → Change visibility → Public.

Se prefires mantelo privado, o servidor ten que ter feito `docker login ghcr.io` co mesmo usuario
que xa usa `coinbase-bot` (xa tes `~/.docker/config.json`).

---

## 3. Posta en marcha no servidor

Conéctate ao servidor:

**💻 [O TEU ORDENADOR]**

```bash
ssh maizehalle
```

A partir de aquí, xa estás dentro do servidor. Crea a carpeta e mais o `docker-compose.yml` cun só
bloque (non tes que copiar nada a man: este comando escribe o ficheiro enteiro):

**🖥️ [SERVIDOR]**

```bash
mkdir -p ~/radiobelesar && cat > ~/radiobelesar/docker-compose.yml <<'EOF'
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
      - radiobelesar-data:/data
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
EOF
```

Arranca o contedor:

**🖥️ [SERVIDOR]**

```bash
cd ~/radiobelesar
docker compose up -d
docker compose logs -f
```

(`docker compose logs -f` mostra o arranque en directo; sae con `Ctrl+C` cando vexas que está listo.)

Traefik (en rede `host`) detecta o contedor polo socket de Docker e xestiona o certificado TLS
automaticamente. En 1-2 minutos terás a aplicación en:

```
https://radiobelesar.maizehalle.com
```

A clave inicial é `belesar` (cámbiase desde a propia aplicación co botón **Clave**).

---

## 4. Actualizar a aplicación (cando cambies algo)

### 4.1. Publicar os cambios

**💻 [O TEU ORDENADOR]**

```bash
git add .
git commit -m "Describe aquí o cambio"
git push
```

Iso dispara o build da nova imaxe. **Watchtower** detéctaa e actualiza o contedor no servidor só:
non tes que facer nada máis.

### 4.2. (Opcional) Forzar a actualización no acto

Se non queres agardar a Watchtower:

**🖥️ [SERVIDOR]**

```bash
cd ~/radiobelesar
docker compose pull
docker compose up -d
```

---

## 5. Copia de seguridade

Os datos (audios + base de datos) viven no volume Docker `radiobelesar-data`, así que as
actualizacións nunca os borran. Para respaldalos nun único arquivo:

**🖥️ [SERVIDOR]**

```bash
docker run --rm \
  -v radiobelesar_radiobelesar-data:/data \
  -v "$HOME":/backup \
  alpine tar czf /backup/radiobelesar-$(date +%F).tar.gz -C /data .
```

Iso crea `~/radiobelesar-AAAA-MM-DD.tar.gz` no servidor. Para descargalo ao teu ordenador:

**💻 [O TEU ORDENADOR]**

```bash
scp maizehalle:~/radiobelesar-*.tar.gz .
```

> O nome do volume adoita levar o prefixo do proxecto (`radiobelesar_`). Confírmao con:
> `docker volume ls | grep radiobelesar`

---

## 6. Comprobacións útiles

**🖥️ [SERVIDOR]**

```bash
docker ps | grep radiobelesar             # estado do contedor
docker logs radiobelesar --tail 50        # logs da aplicación
docker exec radiobelesar ls -la /data     # contido persistente (audio/ e radiobelesar.db)
docker compose -f ~/radiobelesar/docker-compose.yml ps   # estado segundo compose
```
