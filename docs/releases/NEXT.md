# Stoky vNEXT

> [!WARNING]
> **La base de datos y los tickets pasan de volúmenes de Docker a `data/`, en
> la carpeta de la instalación.** Con el `docker-compose.yml` de esta versión,
> una instalación anterior no encuentra sus datos: `docker compose up` se para
> con `bind source path does not exist` hasta que `install.sh` crea `data/`, y
> entonces arranca vacía. Sus volúmenes siguen intactos. Instala esta versión
> en una carpeta nueva.

## Destacado

* La carpeta de la instalación lo guarda todo

### La carpeta de la instalación lo guarda todo

La base de datos y las fotos de los tickets ya no viven en volúmenes de
Docker, lejos de la instalación: están en `data/`, junto a
`docker-compose.yml`, y las copias de seguridad de la guía se guardan en
`backups/`, en la misma carpeta. Esa carpeta es la instalación: para llevarla
a otro disco o a otro equipo se para y se copia entera, y
`docker compose down -v` ya no puede borrar la base de datos. `install.sh`
crea los directorios con el dueño que necesita cada contenedor y, si no lo
ejecutas como root, lo pide con `sudo`. Ningún otro usuario del equipo puede
leerlos. La caché sigue en un volumen de Docker: no guarda nada que haga falta
copiar.

## Cambios incompatibles

1. **La base de datos y los tickets se leen de `data/`, no de volúmenes.** Con
   el `docker-compose.yml` de esta versión, una instalación anterior no
   arranca hasta que existen `data/postgres` y `data/uploads`, y entonces
   arranca vacía. Sus volúmenes, `stoky-release_postgres_data` y
   `stoky-release_uploads`, siguen ahí sin tocar hasta que los borres.

## Cómo actualizar

No hay camino de actualización mientras Stoky sea alpha: instala esta versión
en una carpeta nueva, como dice [Instalación](#instalación).

## Instalación

Lee la [guía de instalación de esta versión](https://github.com/nogcode/stoky/blob/vNEXT/docs/INSTALL.md).
En una carpeta vacía:

```bash
STOKY_RELEASE=vNEXT
for asset in install.sh SHA256SUMS; do
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location \
    --output "$asset" \
    "https://github.com/nogcode/stoky/releases/download/${STOKY_RELEASE}/${asset}"
done
grep -E '  install\.sh$' SHA256SUMS | sha256sum -c
less install.sh
bash install.sh
```

Después rellena `DOMAIN` en `.env`, revísalo y arranca:

```bash
docker compose config --quiet
docker compose pull
docker compose up -d --wait --wait-timeout 180
```

Pon tu proxy con TLS delante del puerto 3000 y nómbralo en
`STOKY_TRUSTED_PROXIES` («Your proxy», en la guía). **Regístrate en cuanto
arranque**: la primera cuenta es la única que se puede crear desde
`/register`, y pone nombre al hogar.

Imagen: `ghcr.io/nogcode/stoky:vNEXT` (**Linux amd64**), que el Compose de
esta versión fija por digest.

## Límites conocidos

* No se puede actualizar desde una alpha anterior.
* Solo hay imágenes para Linux amd64.
* No hay recuperación de contraseña por correo: la restablece quien administra
  el hogar.
* Las llaves de acceso solo funcionan en la primera dirección de `STOKY_URLS`.
* Los dueños de `data/` son los que ve Docker ejecutado como root. Con Docker
  sin root, con `userns-remap` o con SELinux activo no se ha probado.
* Siguen pendientes las comprobaciones humanas con lector de pantalla, con
  Safari en iOS y en la tableta de cocina.

Consulta [estado](https://github.com/nogcode/stoky/blob/vNEXT/docs/STATUS.md)
y [seguridad](https://github.com/nogcode/stoky/blob/vNEXT/SECURITY.md).
Comunica los errores en [Issues](https://github.com/nogcode/stoky/issues), sin
secretos ni tickets con datos personales, y las vulnerabilidades por el
[formulario privado](https://github.com/nogcode/stoky/security/advisories/new).

## Verificación

La carpeta de la instalación se probó desde cero, con la imagen publicada de
`v0.2.0-alpha.1` (la aplicación no cambia en esto) y en un proyecto de Compose
aparte: `install.sh` sin root, con `sudo` rechazado, los dos comandos que
imprime ejecutados como root y una segunda ejecución que no cambió nada; los
tres contenedores sanos; un ticket subido que apareció en `data/uploads`; una
copia hecha con los comandos de la guía y restaurada en otra carpeta, con la
foto idéntica byte a byte; la carpeta parada, copiada como root a otro sitio y
arrancada allí con sus datos; y `docker compose down -v`, que solo borró el
volumen de la caché.

## Qué ha cambiado

## English

> [!WARNING]
> **The database and the receipts move from Docker volumes to `data/`, in
> the installation's folder.** Under this release's `docker-compose.yml` an
> earlier installation does not find its data: `docker compose up` stops
> with `bind source path does not exist` until `install.sh` creates `data/`,
> and then it starts empty. Its volumes stay untouched. Install this release
> in a new folder.

### The installation's folder holds everything

The database and the receipts' photographs no longer live in Docker volumes,
away from the installation: they are in `data/`, beside `docker-compose.yml`,
and the guide's backups go to `backups/`, in the same folder. That folder is
the installation: to move it to another disk or host, stop it and copy it
whole, and `docker compose down -v` can no longer delete the database.
`install.sh` creates the directories with the owner each container needs and,
when not run as root, asks for it with `sudo`. No other user of the machine
can read them. The cache stays in a Docker volume: nothing in it needs
copying.

### Breaking changes

* **The database and the receipts are read from `data/`, not from volumes.**
  Under this release's `docker-compose.yml` an earlier installation does not
  start until `data/postgres` and `data/uploads` exist, and then starts
  empty. Its volumes, `stoky-release_postgres_data` and
  `stoky-release_uploads`, stay untouched until you delete them. While Stoky
  is an alpha there is no upgrade path: install this release in a new folder.

### Known limits and what was tested

No upgrade from an earlier alpha; Linux amd64 only; no password recovery by
email; passkeys only at the first `STOKY_URLS` address; `data/`'s owners are
those Docker run as root sees, and rootless Docker, `userns-remap` or an
enforcing SELinux is not tested. The human checks with a screen reader, Safari on iOS and the kitchen
tablet are still outstanding. The installation folder was tested from
scratch with `v0.2.0-alpha.1`'s published image in a separate Compose
project: `install.sh` without root, three healthy containers, an uploaded
receipt in `data/uploads`, a backup restored into another folder with the
photograph byte for byte, the folder moved and started again, and
`down -v` removing only the cache's volume.
