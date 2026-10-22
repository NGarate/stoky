# Stoky v0.1.0-alpha.4

> [!WARNING]
> **Esta versión cambia cómo se inicia sesión, y no se deshace volviendo a la
> imagen anterior.** Antes de actualizar haz la copia de seguridad que describe
> la guía: es lo único que permite volver a alpha.3. Además, para actualizar ya
> no basta con cambiar `STOKY_VERSION`: hay que sustituir `docker-compose.yml` y
> `traefik.yml`. Sigue [Cómo actualizar](#cómo-actualizar) paso a paso.

> [!CAUTION]
> Trae correcciones de seguridad que conviene instalar cuanto antes. Entre
> ellas, el Traefik de alpha.3 (`v3.7.13`) tiene avisos HIGH en Go y
> `golang.org/x/net` (denegación de servicio en HTTP/2 y TLS); esta versión
> instala `v3.7.16`, que no tiene ninguno.

Te damos la bienvenida a Stoky `v0.1.0-alpha.4`, la cuarta alpha.

La alpha.3 cambió cómo se instala Stoky. Esta cambia quién puede entrar y cómo:
un sistema de inicio de sesión nuevo, verificación en dos pasos, llaves de
acceso, sesiones que puedes ver y cerrar, y un registro que se cierra tras la
primera cuenta. Llega también con todo lo que dejó la revisión de seguridad del
12 de octubre.

> **Versión de prueba.** Conserva copias de seguridad y limita el acceso a
> personas de confianza.

## Destacado

* Verificación en dos pasos y llaves de acceso
* Tus dispositivos, a la vista y con la opción de cerrar sesión en cada uno
* El registro se cierra después de la primera cuenta
* Contraseñas: cámbiala tú, o que la restablezca quien administra el hogar
* Endurecimiento de seguridad del servidor, el proxy y las fotos de tickets
* Una release que se escanea entera antes de publicarse

### Verificación en dos pasos y llaves de acceso

En **Configuración → Seguridad y acceso** cada persona puede activar la
**verificación en dos pasos** con una app de autenticación. Al entrar, Stoky
pide la contraseña y después el código de seis cifras. Cada código sirve
**una sola vez**, aunque siga dentro de su intervalo de 30 segundos. Al
activarla recibes unos códigos de respaldo para cuando no tengas el móvil a
mano. Stoky solo guarda su huella (hash), así que nadie puede leerlos después.

Las **llaves de acceso** permiten entrar con la huella, la cara o el PIN del
dispositivo, sin escribir la contraseña. Se añaden y se quitan en el mismo
sitio, y la página de inicio de sesión ofrece **Iniciar sesión con una llave
de acceso**.

> [!NOTE]
> Las llaves de acceso necesitan https y un nombre de dominio, y solo funcionan
> en la **primera** dirección de `STOKY_URLS`. Con el bundle esa dirección es
> `DOMAIN`, así que no tienes que hacer nada.

Si alguien pierde su segundo paso, quien administra el hogar puede quitárselo
desde **Personas del hogar**.

### Tus dispositivos, y cerrar sesión en ellos

**Tus dispositivos** muestra dónde tienes la sesión iniciada. Puedes cerrar la
de los que no reconozcas, o la de todos menos el que estás usando (para eso
se pide la contraseña otra vez). Quien administra el hogar puede cerrar las
sesiones de un miembro, y se cierran solas cuando se le quita del hogar. Quien
es propietario puede cerrar las de todo el hogar a la vez.

Una sesión termina tras quince minutos sin usarse o un día después de entrar.
Si al entrar marcas **Mantener la sesión iniciada**, dura hasta noventa días
sin usarse o un año desde que entraste. Cada cuenta tiene como máximo diez
sesiones abiertas.

### El registro se cierra después de la primera cuenta

En una instalación nueva, `/register` solo deja crear la primera cuenta. A las
demás personas las añade quien administra el hogar desde **Configuración →
Personas del hogar**. Se controla con `STOKY_REGISTRATION` en `.env`:
`first-user` (por defecto), `closed` u `open`.

### Contraseñas

Cada persona puede **cambiar su propia contraseña**. Las sesiones de sus otros
dispositivos se cierran y la del que está usando sigue abierta. Stoky no envía
correos, así que no hay enlace para recuperar una contraseña olvidada: quien
administra el hogar **pone una nueva** desde **Personas del hogar**. Ahora una
contraseña no puede basarse en tu correo ni en tu nombre.

### Endurecimiento de seguridad

* **Proxy.**
  * Solo TLS 1.2 o superior, con cifrados AEAD de secreto hacia adelante.
  * Las conexiones inactivas se cierran antes.
  * Traefik ya no consulta si hay versiones nuevas.
  * Ya no se pide a los navegadores que incluyan tu dominio en la lista de
    precarga de HSTS.
* **Navegador.**
  * Las páginas quedan aisladas de otros orígenes.
  * Se niegan las funciones del navegador que Stoky no usa.
  * Tu dirección no viaja en el `Referer` hacia otros sitios.
* **Peticiones.**
  * Límites de tamaño en todas las entradas de texto y cuerpos de petición.
  * Se rechazan las peticiones de otros sitios o que no son JSON.
  * Límite de llamadas por lote.
  * Las respuestas con datos no se guardan en caché.
* **Inicio de sesión.**
  * Los dispositivos conocidos tienen su propio cupo de intentos.
  * IPv6 se limita por prefijo `/64`.
  * Los registros guardan una etiqueta de la cuenta, no el correo con el que
    se intentó entrar.
* **Fotos de tickets.**
  * Se reducen a 4000 píxeles en el lado largo.
  * Se eliminan los perfiles de color y los segmentos de aplicación.
  * El OCR tiene tiempo límite.
  * Un ticket que quedó a medias por un reinicio se marca como fallido.
* **Contenedores.**
  * Los logs rotan.
  * Valkey tiene la memoria acotada.
  * Cada servicio tiene un límite de procesos.
  * La imagen de producción ya no incluye los datos de demostración.

### Una release que se escanea entera antes de publicarse

Es la primera versión que:

* **fija la imagen de Stoky por digest** en `docker-compose.yml`. Lo que
  descargas es exactamente lo que se probó, aunque alguien mueva la etiqueta, y
  `SHA256SUMS` cubre esa línea.
* **firma la procedencia de sus archivos de instalación.** Puedes comprobar que
  los publicó este repositorio con `gh attestation verify` (ver la guía).
* **escanea PostgreSQL, Valkey y Traefik antes de crear la release.** Un aviso
  CRITICAL o HIGH con arreglo disponible en cualquiera de ellos la detiene,
  igual que uno en la propia aplicación. Por eso Traefik pasa a `v3.7.16` y
  PostgreSQL 16.15 a su reconstrucción más reciente.

## Cambios incompatibles

1. **Todo el mundo vuelve a iniciar sesión una vez.** Las sesiones pasan de un
   token firmado en el navegador a una fila en la base de datos. Las
   contraseñas se conservan, y también los cambios que un móvil tenía en cola
   sin conexión. **Vuelve a iniciar sesión en la tableta de la cocina con
   «Mantener la sesión iniciada» marcada**; si no, pedirá la contraseña cada
   quince minutos sin uso.
2. **El registro se cierra al actualizar.** Un `.env` de alpha.3 no tiene
   `STOKY_REGISTRATION`, así que se aplica `first-user`, y como ya hay cuentas,
   `/register` aparece cerrado. Si tu hogar contaba con que la gente se
   registrara sola, pon `STOKY_REGISTRATION=open` antes de arrancar.
3. **`NEXTAUTH_SECRET` pasa a llamarse `STOKY_SECRET`.** Cambia solo el nombre
   y **conserva el valor**: uno nuevo cerraría todas las sesiones y cambiaría
   las etiquetas del registro de seguridad. Mientras no lo cambies, Stoky sigue
   leyendo el nombre antiguo y avisa al arrancar. Una versión futura dejará de
   leerlo.
4. **`NEXTAUTH_URL` pasa a ser `STOKY_URLS`**, una lista de direcciones. Con el
   bundle no hay nada que hacer, porque Compose la construye desde `DOMAIN`.
   Si no usas el bundle, renómbrala y deja solo el esquema, el host y el
   puerto.
5. **Volver a alpha.3 exige restaurar la copia.** La migración
   `20261015120000_credential_accounts` mueve las contraseñas (sus hashes) a
   una tabla nueva y borra la columna de la que las lee alpha.3. Arrancada
   contra una base actualizada, alpha.3 no deja entrar a nadie.
6. **El Compose elige la imagen por digest.** Cambiar solo `STOKY_VERSION` ya no
   actualiza nada; hay que sustituir `docker-compose.yml`.
7. **Los logs anteriores se pierden al actualizar.** Todos los contenedores se
   recrean (ahora rotan sus logs) y se llevan los antiguos. Guárdalos antes si
   los necesitas.

## Cómo actualizar

Desde `v0.1.0-alpha.3`. Si vienes de una versión anterior, sigue antes las
[notas de la alpha.3](https://github.com/NGarate/stoky/releases/tag/v0.1.0-alpha.3).

1. En el directorio de la instalación, guarda los logs y haz la copia de
   seguridad que describe la
   [guía](https://github.com/NGarate/stoky/blob/v0.1.0-alpha.4/docs/INSTALL.md#backup-and-restore):

   ```bash
   docker compose logs --no-color --timestamps > logs-antes-de-alpha.4.txt
   ```

2. Descarga los archivos nuevos **en otra carpeta** y compruébalos:

   ```bash
   STOKY_RELEASE=v0.1.0-alpha.4
   mkdir ../stoky-$STOKY_RELEASE && cd ../stoky-$STOKY_RELEASE
   for asset in docker-compose.yml example.env traefik.yml install.sh SHA256SUMS; do
     curl --fail --location --proto-redir '=https' --output "$asset" \
       "https://github.com/NGarate/stoky/releases/download/${STOKY_RELEASE}/${asset}"
   done
   sha256sum -c SHA256SUMS
   ```

3. Copia los cinco a la instalación. `.env` no se toca:

   ```bash
   cp docker-compose.yml example.env traefik.yml install.sh SHA256SUMS ../tu-instalacion/
   cd ../tu-instalacion && chmod 644 traefik.yml
   ```

4. Actualiza `.env`. Con los archivos ya copiados, `bash install.sh` lo hace por
   ti: renombra el secreto conservando su valor y añade los ajustes que falten,
   sin cambiar ninguno que ya tengas. Si prefieres hacerlo a mano:

   ```diff
   - STOKY_VERSION=v0.1.0-alpha.3
   + STOKY_VERSION=v0.1.0-alpha.4
   - NEXTAUTH_SECRET=<tu valor>
   + STOKY_SECRET=<el mismo valor>
   + STOKY_REGISTRATION=first-user
   ```

5. Arranca:

   ```bash
   docker compose config --quiet
   docker compose pull
   docker compose up -d --wait --wait-timeout 180
   ```

6. Entra en cada dispositivo. En la tableta de la cocina, con **Mantener la
   sesión iniciada** marcada.

Si una migración se detiene, la guía explica cómo seguir:
[A migration stops the upgrade](https://github.com/NGarate/stoky/blob/v0.1.0-alpha.4/docs/INSTALL.md#a-migration-stops-the-upgrade).

## Instalación

Lee la [guía de instalación de esta versión](https://github.com/NGarate/stoky/blob/v0.1.0-alpha.4/docs/INSTALL.md).
En una carpeta vacía:

```bash
STOKY_RELEASE=v0.1.0-alpha.4
for asset in install.sh SHA256SUMS; do
  curl --fail --location --proto-redir '=https' --output "$asset" \
    "https://github.com/NGarate/stoky/releases/download/${STOKY_RELEASE}/${asset}"
done
grep -E '  install\.sh$' SHA256SUMS | sha256sum -c
less install.sh
bash install.sh
```

Después rellena `DOMAIN` y `ACME_EMAIL` en `.env`, revísalo y arranca con los
comandos del paso 5. **Regístrate en cuanto arranque**: la primera cuenta es la
única que se puede crear desde `/register`.

Imagen: `ghcr.io/ngarate/stoky:v0.1.0-alpha.4` (**Linux amd64**), que el
Compose de esta versión fija por digest.

## Límites conocidos

* Las fotos HEIC/HEIF del móvil todavía se rechazan.
* Solo hay imágenes para Linux amd64.
* No hay recuperación de contraseña por correo: la restablece quien administra
  el hogar.
* Las llaves de acceso solo funcionan en la primera dirección de `STOKY_URLS`.
* Siguen pendientes las comprobaciones humanas con lector de pantalla, con
  Safari en iOS y en la tableta de cocina.

Consulta [estado](https://github.com/NGarate/stoky/blob/v0.1.0-alpha.4/docs/STATUS.md)
y [seguridad](https://github.com/NGarate/stoky/blob/v0.1.0-alpha.4/SECURITY.md).
Comunica los errores en [Issues](https://github.com/NGarate/stoky/issues), sin
secretos ni tickets con datos personales, y las vulnerabilidades por el
[formulario privado](https://github.com/NGarate/stoky/security/advisories/new).

## Verificación

Se completa al preparar la versión con lo que se haya probado de verdad: la
instalación limpia, la actualización desde un `.env` de alpha.3 y lo que haga
la CI en el tag.

## Qué ha cambiado

Se genera al preparar la versión:
`bun scripts/release-notes.ts v0.1.0-alpha.3 v0.1.0-alpha.4`.

## English

**Upgrading changes how people sign in and cannot be undone by going back to
the previous image: back up first.** Replacing `STOKY_VERSION` alone no longer
upgrades; replace `docker-compose.yml` and `traefik.yml` too (steps above).

New: two-step verification with single-use authenticator codes and hashed
backup codes; passkeys (at the first address in `STOKY_URLS`); a device list
where you end sessions, and admins end a member's or the whole household's;
registration closed after the first account (`STOKY_REGISTRATION`); people
change their own password, and admins set a new one. The security review of
2026-10-12 is in this release too: TLS 1.2+ with AEAD suites only, cross-origin
isolation, request limits, per-/64 IPv6 rate limiting, receipt photos
downscaled and stripped, OCR time limits, log rotation and bounded Valkey
memory. The bundle moves to Traefik v3.7.16, clean where v3.7.13 has HIGH Go
advisories. This is the first release whose Compose file pins the application
by digest, whose installation files carry a signed provenance attestation, and
whose PostgreSQL, Valkey and Traefik images were scanned before the release
existed.

**Breaking:** everybody signs in once (sign the kitchen tablet in with *Mantener
la sesión iniciada*); registration closes on upgrade unless
`STOKY_REGISTRATION=open`; `NEXTAUTH_SECRET` becomes `STOKY_SECRET` (keep the
value; `install.sh` renames it); `NEXTAUTH_URL` becomes `STOKY_URLS` outside the
bundle; returning to alpha.3 needs the pre-upgrade backup; old container logs
are lost on upgrade.
