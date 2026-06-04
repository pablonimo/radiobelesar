# Despregue — Radio Belesar

Adaptado ao teu servidor: **Traefik v3** como reverse proxy (entrypoint `websecure`,
certresolver `letsencrypt`), imaxe en **GHCR** e **Watchtower** para actualización automática.
É o mesmo patrón que xa usas con `coinbase-bot`.

## Fluxo xeral

```
git push (main)  ->  GitHub Actions constrúe a imaxe  ->  ghcr.io/pablonimo/radiobelesar:latest
                                                              |
                                                       Watchtower (no VPS) detecta a nova imaxe
                                                              |
                                                       actualiza o contedor radiobelesar
```

## 1. DNS

No panel da túa zona `maizehalle.com`, engade un rexistro **A**:

```
radiobelesar   A   <IP do VPS>
```

(o mesmo que xa fixeches para `secuencias` e `incumprimentos`).

## 2. Subir o código a GitHub

Esta é a parte que pode resultar menos clara. Tes dúas formas; escolle unha.

### 2.1. Crear o repositorio baleiro en GitHub

1. Entra en <https://github.com/new>.
2. **Owner**: `pablonimo`  ·  **Repository name**: `radiobelesar`.
3. Visibilidade: a túa elección (privado vale).
4. **Importante**: NON marques "Add a README", nin ".gitignore", nin "license". O proxecto xa os
   trae e, se os engades aquí, daría conflito ao subir.
5. Preme **Create repository**. Quedará baleiro, agardando o teu código.

### 2.2. Opción A — Git desde a liña de comandos (recomendada)

Necesitas ter instalado **Git**. En Windows descárgao de <https://git-scm.com>; inclúe o *Git
Credential Manager*, que xestiona o acceso a GitHub cun login no navegador a primeira vez (non tes
que crear tokens a man).

Abre un terminal (Git Bash ou PowerShell) **na carpeta do proxecto** (onde está `package.json`) e
executa, unha liña tras outra:

```bash
# Sitúate na carpeta do proxecto (axusta a ruta se fai falla):
cd "C:/Users/PC/Dropbox/IA/Claude_cowork_directory/Radio Belesar APP-web/Radio Belesar APP-web"

git init                       # inicia o control de versións nesta carpeta
git add .                      # engade todos os ficheiros (o .gitignore xa exclúe node_modules, .env, data/…)
git commit -m "Primeira versión: mesa de son Radio Belesar"
git branch -M main             # nomea a rama principal como "main"
git remote add origin https://github.com/pablonimo/radiobelesar.git
git push -u origin main        # sube o código
```

A primeira vez que fagas `git push`, abrirase o navegador para iniciar sesión en GitHub. Despois, o
acceso queda gardado e xa non to volverá pedir.

> Se che pide nome de usuario e contrasinal en lugar de abrir o navegador: o "contrasinal" xa non
> vale; hai que usar un *Personal Access Token*. Créao en GitHub → Settings → Developer settings →
> Personal access tokens → Tokens (classic) → Generate, marcando os permisos `repo` e
> `write:packages`, e pégao cando cho pida como contrasinal.

### 2.3. Opción B — GitHub Desktop (interface gráfica, sen comandos)

1. Instala **GitHub Desktop** de <https://desktop.github.com> e inicia sesión coa túa conta.
2. *File → Add local repository* → escolle a carpeta do proxecto. Se ofrece "create a repository",
   acéptao.
3. Escribe un resumo (p. ex. "Primeira versión") abaixo á esquerda e preme **Commit to main**.
4. Preme **Publish repository**, co nome `radiobelesar` e owner `pablonimo`. Listo.

### 2.4. Comprobar que o build automático funciona

En canto subas o código, o workflow `.github/workflows/build.yml` constrúe e publica a imaxe en cada
push a `main` (usa o `GITHUB_TOKEN`, non fai falla configurar segredos). Comproba:

- **GitHub → repo → Actions**: que o primeiro build remata en verde (tarda 1-2 minutos).
- **GitHub → repo → Packages**: que aparece a imaxe `radiobelesar`.

### 2.5. Actualizacións posteriores (cada vez que cambies algo)

Desde a liña de comandos:

```bash
git add .
git commit -m "Describe aquí o cambio"
git push
```

Ou, en GitHub Desktop: escribe o resumo → **Commit to main** → **Push origin**.

Cada `push` a `main` dispara de novo o build da imaxe e, no servidor, **Watchtower** actualiza o
contedor automaticamente. Non tes que tocar nada máis.

### Visibilidade do paquete GHCR

Para que Watchtower poida descargar a imaxe sen autenticación, o máis sinxelo é poñer o paquete
como **público**:

> GitHub → repo → Packages → `radiobelesar` → Package settings → Change visibility → Public.

Se prefires mantelo privado, asegúrate de que o servidor ten `docker login ghcr.io` feito co mesmo
usuario que xa usa `coinbase-bot` (xa tes `~/.docker/config.json`).

## 3. Posta en marcha no servidor

```bash
ssh maizehalle

mkdir -p ~/radiobelesar
# copia o ficheiro deploy/docker-compose.yml do repo a ~/radiobelesar/docker-compose.yml
#   (por exemplo con scp, ou cópiao a man co contido do repo)

cd ~/radiobelesar
docker compose up -d
docker compose logs -f      # comproba que arranca (Ctrl+C para saír)
```

Traefik (que está en rede `host`) detecta o contedor polo socket de Docker e xestiona o
certificado TLS automaticamente. En 1-2 minutos terás:

```
https://radiobelesar.maizehalle.com
```

A clave inicial é `belesar` (cámbiase desde a propia aplicación co botón **Clave**).

## 4. Actualizacións

Non tes que facer nada manual: ao publicar unha nova imaxe (push a `main`), **Watchtower**
actualiza o contedor só. Se queres forzar unha actualización inmediata:

```bash
cd ~/radiobelesar
docker compose pull && docker compose up -d
```

Os datos (audios + base de datos) viven no volume `radiobelesar-data`, así que as actualizacións
**nunca** os borran.

## 5. Copia de seguridade

```bash
# Respaldar o volume de datos nun único arquivo
docker run --rm -v radiobelesar_radiobelesar-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/radiobelesar-$(date +%F).tar.gz -C /data .
```

Restaurar = descomprimir o `.tar.gz` dentro do volume (parando antes o contedor).

> Nota: o nome real do volume adoita levar o prefixo do proxecto (`radiobelesar_`). Comproba co
> comando `docker volume ls | grep radiobelesar`.

## 6. Comprobacións útiles

```bash
docker ps | grep radiobelesar             # estado do contedor
docker logs radiobelesar --tail 50        # logs
docker exec radiobelesar ls -la /data     # contido persistente (audio/ e radiobelesar.db)
```
