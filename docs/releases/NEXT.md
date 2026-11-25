# Stoky vNEXT

> [!NOTE]
> `v0.2.0-alpha.0` se etiquetó el 25 de noviembre de 2026 pero no llegó a
> publicarse: su compilación en la CI falló al subir la imagen, antes de que
> existiera ningún fichero de la versión. Esta es aquella versión con esa
> corrección. La lista de cambios de abajo cuenta desde aquella etiqueta; la
> de todo lo que cambió desde `v0.1.0-alpha.4` está en sus
> [notas](https://github.com/nogcode/stoky/blob/vNEXT/docs/releases/v0.2.0-alpha.0.md).

> [!CAUTION]
> **El paquete ya no incluye Traefik ni pide certificados.** Stoky atiende
> por HTTP en el puerto 3000 de tu servidor y el TLS lo pone tu proxy inverso:
> Traefik, Caddy, nginx o `tailscale serve`. La guía de instalación tiene un
> ejemplo de cada uno en «Your proxy». Antes de actualizar, pon un proxy con
> TLS delante del puerto 3000 y dile a Stoky cuál es con
> `STOKY_TRUSTED_PROXIES` en `.env`; `ACME_EMAIL` ya no se usa. Arranca con
> `docker compose up -d --wait --remove-orphans`, que elimina el contenedor
> del Traefik anterior. El volumen `stoky-release_letsencrypt` se puede
> borrar después. `scripts/smoke-proxy.sh --live TU_DOMINIO`, desde otra red,
> comprueba que tu proxy quedó bien puesto.
>
> Trae correcciones de seguridad que conviene instalar cuanto antes. Stoky
> ya solo cree las cabeceras `X-Forwarded-For` y `X-Forwarded-Proto` de los
> proxies indicados en `STOKY_TRUSTED_PROXIES`, y de ninguno hasta que lo
> definas. Antes, quien llegara a la aplicación sin pasar por el proxy podía
> elegir con una cabecera la dirección por la que se le contaban los intentos
> de inicio de sesión. Valkey pasa a `8.1.12`, con `zlib` y `musl`
> corregidos. PostgreSQL pasa a una imagen propia
> (`ghcr.io/nogcode/stoky/postgres`): la oficial con las correcciones que
> Alpine ya publicó, sin los 19 avisos HIGH de `krb5` y `libxslt` que tiene
> la oficial, ni el de `libxml2` (CVE-2026-86144). Arranca como el usuario `postgres` y ya no incluye `gosu`, que
> solo se usaba al arrancar como root y arrastraba 26 avisos CRITICAL y HIGH
> de Go. El Traefik de alpha.4 (`v3.7.16`), con un aviso HIGH en
> `go-jose` y dos en `golang.org/x/net`, desaparece con el paquete nuevo.
>
> PostgreSQL pasa de la versión 16 a la 18, que no abre los datos de la 16:
> una instalación anterior arranca con la base de datos vacía.

## Destacado

* Marca, categoría y unidad te sugieren lo que ya usas
* Al subir un ticket, elige la tienda o escribe una nueva
* Siempre sabes cuánto queda de cada lote
* La barra del móvil muestra dónde estás
* Tu cuenta y cerrar sesión, a un toque
* Escanea el producto donde lo eliges
* Los tickets se leen mucho mejor
* Encuadra el ticket al hacerle la foto
* Vuelve a leer las líneas de un artículo, o elimínalo

### Marca, categoría y unidad te sugieren lo que ya usas

Al crear o editar un producto, los campos **Marca**, **Categoría** y
**Unidad** muestran al tocarlos lo que tu hogar ya ha usado, primero lo más
habitual, y se filtran mientras escribes. Si lo que buscas no está, escríbelo
sin más: se guarda tal cual y aparecerá como sugerencia la próxima vez. Así es
más difícil acabar con la misma marca escrita de tres formas.

### Al subir un ticket, elige la tienda o escribe una nueva

El campo **Tienda del ticket** muestra las tiendas de tu hogar y se filtra
mientras escribes. Si la tienda no está, escribe su nombre: Stoky avisa de
que la añadirá y la crea al subir el ticket. No hace falta pasar antes por
**Configuración → Tiendas**, y puede hacerlo cualquiera que suba tickets, no
solo quien administra el hogar. Si el nombre ya existe con otras mayúsculas,
el ticket se guarda en esa tienda en vez de crear otra.

### Siempre sabes cuánto queda de cada lote

Cuando usas algo sin decir de qué paquete, Stoky lo descuenta del que caduca
antes, en el sitio que elegiste o en cualquiera si no elegiste ninguno. Lo
mismo al corregir el recuento a la baja y al mover cosas de sitio. Así cada
lote sabe lo que le queda, y la cocina y la ficha del producto ya no muestran
«Cantidad sin confirmar».

### La barra del móvil muestra dónde estás

En el móvil y la tableta, los tres botones de la barra son las tres últimas
pantallas que has usado en ese dispositivo. La que tienes abierta siempre
está en la barra, marcada; al abrir otra, ocupa el sitio de la que llevas
más tiempo sin usar y las demás no se mueven. **Más** tiene el resto.
**Escanear** ya no está en la barra: sigue en Productos, Inventario y Compra.

### Tu cuenta y cerrar sesión, a un toque

En el ordenador, el círculo con tus iniciales arriba a la derecha abre tu
cuenta: con qué nombre y correo estás dentro, **Seguridad y acceso** y
**Cerrar sesión**. En el móvil y la tableta está lo mismo al principio de
**Más**. Ya no hace falta bajar hasta el final de Configuración para salir.

### Escanea el producto donde lo eliges

Al añadir o gastar stock, o al añadir algo a una lista de la compra, el
botón **Escanear** junto a la búsqueda abre la
cámara y elige el producto por su código de barras, sin salir de la
pantalla. Al revisar un ticket, cada línea tiene también **Escanear**: si el
paquete está a mano, su código dice qué producto es mejor que el texto del
ticket. Si la cámara no lo lee, puedes escribir el código. Si ningún
producto tiene ese código, Stoky te ofrece buscarlo en Open Food Facts,
crearlo con el código ya puesto o decir a qué producto pertenece y
guardárselo. Si tienes varias cámaras, puedes elegir cuál usar y se
recuerda. Un lector de códigos USB o Bluetooth también vale: escribe el
código en la búsqueda y el producto queda elegido.

El **modo escaneo**, en Añadir stock y Apuntar consumo, guarda cada
producto en cuanto lo escaneas, con la cantidad que pongas (1 si la dejas vacía),
y vuelve a abrir la cámara para el siguiente: una bolsa de la compra se
guarda escaneando.

Al crear o editar un producto, el campo **Código de barras** tiene también
**Escanear**: la cámara lo rellena con el código que lee.

### «Volver» te lleva a donde estabas

Las pantallas a las que se llega desde varios sitios (añadir o gastar stock,
subir un ticket, los precios de un producto, su historial, el escáner…)
vuelven ahora a la pantalla desde la que entraste, y el enlace dice cuál:
**Volver al panel**, **Volver al producto**, **Volver a la lista**. Antes
volvían siempre al mismo sitio. **Cancelar** en esos formularios hace lo
mismo, y la lista a la que vuelves sigue donde la dejaste.

### Las fotos HEIC del móvil ya se pueden subir

Al subir un ticket ya puedes elegir las fotos HEIC, el formato en que
guardan las fotos la cámara del iPhone y muchos Android, y que antes ni
siquiera aparecían para elegir. Stoky las convierte a JPEG al recibirlas y
el ticket se lee igual que cualquier otra foto. En algunos navegadores la
vista previa de una foto HEIC no se muestra, pero la subida funciona.

### Revisa el ticket con su foto delante

Al revisar un ticket, **Ver la foto del ticket** despliega la foto que
subiste, para comprobar un precio mal leído o un producto que se saltó la
lectura automática sin buscar el papel. La ven quienes pueden revisar
tickets; la cuenta de cocina no, porque la foto muestra lo que imprime el
ticket, como la tarjeta o la tarjeta de cliente.

### Corrige lo que se leyó mal en un ticket

Cada línea del ticket tiene ahora **Corregir**: cambia el nombre, el
importe o la cantidad cuando la lectura automática se equivoca, también en
una línea ya confirmada. Si cambias el nombre de una línea que Stoky había
reconocido sola, vuelve a quedar pendiente para que elijas el producto,
porque lo reconoció por el nombre mal leído. Si el ticket imprime cuántos
artículos se compraron (en Costco, «TOTAL ARTS»), la revisión avisa cuando
las líneas leídas no suman eso, para que busques la que falta o sobra.

### Añade a mano lo que el ticket no leyó

**Añadir línea**, al final de la revisión, añade un producto que la lectura
automática se saltó. Y un ticket que no se pudo leer ya no hay que repetirlo:
**Añadir las líneas a mano** lo abre con su foto para que escribas sus líneas
y lo termines como cualquier otro. También se llega desde la lista de
tickets.

### Encuadra el ticket al hacerle la foto

Al elegir o hacer la foto de un ticket, Stoky la muestra con un recuadro de
cuatro esquinas. Llévalas a las esquinas del papel y pulsa **Enviar
ticket**: Stoky lee el ticket que encuadraste, enderezado, sin la mesa de
alrededor. Si no mueves las esquinas, busca el ticket en la foto como hasta
ahora. Para afinar, amplía la foto con los botones de lupa o con dos dedos,
aquí y al elegir las líneas de un artículo. La foto se guarda entera, así
que el recuadro se puede corregir después: en la revisión, **Ver la foto del
ticket** la muestra con el recuadro con que se leyó, y **Corregir el recorte
del ticket** lo deja mover; al pulsar **Volver a leer el ticket** se lee
otra vez con el nuevo recuadro. Eso sustituye sus líneas, y se pierden las
correcciones, los productos elegidos y las líneas añadidas a mano; ya
aplicado al inventario no se puede. Las fotos HEIC que el navegador no sabe
mostrar se envían sin recuadro. Mientras se lee, su revisión lo dice y
muestra las líneas en cuanto termina.

### Vuelve a leer las líneas de un artículo, o elimínalo

Al **Corregir** un artículo del ticket, **Elegir las líneas en el ticket**
abre la foto con un recuadro: tócala para llevarlo a las líneas de ese
artículo, ajusta las esquinas para que entren su nombre, su precio y sus
descuentos, y pulsa **Leer estas líneas**. Stoky lee solo esas líneas y
rellena con ello el producto, el importe y la cantidad; revísalos y guarda la
corrección. Si el artículo no es tal (una línea del pago, un total leído como
producto), **Eliminar artículo** lo quita del ticket, y **Deshacer** lo
devuelve.

### Corrige la tienda, la fecha y el total de un ticket

**Corregir los datos del ticket**, en la revisión, cambia la tienda, la fecha
de compra y el importe total cuando no se leyeron o se leyeron mal. La tienda
se elige o se escribe como al subirlo. Importa sobre todo: sin tienda, los
precios del ticket no se guardan. La revisión muestra ahora también el total.

### Los tickets se leen mucho mejor

La lectura automática de los tickets entiende ahora cómo imprimen las
cadenas españolas sus líneas: el nombre en una línea y el precio en la
siguiente (Costco), los productos a peso (Mercadona, Lidl, DIA, Costco), las
cantidades como «2 x 0,89» encima o debajo del producto, los descuentos y
las ofertas, y los tickets en catalán. Ya no apunta como producto nada de
lo que va después del total —el pago, el desglose del IVA—, y el total se
toma de donde el ticket coincide consigo mismo: la línea TOTAL, el pago con
tarjeta o en efectivo, el desglose del IVA y la suma de los productos.
Además, antes de leer la foto se endereza el ticket (si está inclinado o
torcido se convierte en un rectángulo), se recorta para que la mesa no se lea
como texto (también la que queda junto a un ticket inclinado o curvado), se igualan la luz, las sombras y los pliegues, se gira solo
(de lado o del revés, según la forma del ticket y lo legible del texto) y se
estiran las líneas curvadas. Luego se lee de seis maneras y se queda la
lectura en la que coinciden las demás. Medido con 63 tickets reales de once
cadenas leídos a mano: los productos leídos con nombre y precio correctos
pasan del 34 % al 60 %, y el total correcto, del 13 % al 58 %. Con diez
tickets más y treinta copias suyas giradas, oscurecidas, reducidas y con
sombra, la nota (precios de los artículos, total y fecha) pasa del 32 % al
93 %, y leer un ticket tarda menos que antes: unos 16 segundos, con tres
lecturas a la vez. Cuántas a la vez lo decide
`OCR_WORKERS` en `.env` (3 si no se pone; cada una usa unos 120 MB de
memoria). El contenedor de la aplicación pasa por eso de 1 GiB a 2 GiB de
memoria en `docker-compose.yml`. El precio que se guarda de cada producto es el que
pagaste: un descuento impreso debajo de un producto se le resta. Lo que la
lectura no acierte se sigue corrigiendo en la revisión.

### Sin conexión, lo último que viste sigue ahí aunque recargues

Si recargabas la página mientras algo terminaba de cargar, la copia que la
app guarda para usarla sin conexión quedaba dañada y se tiraba entera en la
siguiente visita: sin señal, la lista de la compra o el inventario salían
vacíos. Ahora solo se guarda lo que ya ha llegado, y una copia antigua dañada
se descarta sin más.

### Al registrarte, pones nombre al hogar

El formulario de registro pide ahora el nombre del hogar y no deja seguir sin
él: quien se registra crea el hogar y lo administra. Antes se podía dejar en
blanco, y la cuenta quedaba sin hogar hasta crear uno después.

### Quitar a alguien del hogar borra su cuenta

En **Configuración → Personas del hogar**, quitar a alguien borra ahora su
cuenta y cierra sus sesiones en todos sus dispositivos: ya no puede entrar.
Antes la cuenta se quedaba sin hogar y sin nada que hacer con ella. Lo que
hizo en el hogar, como los movimientos de stock y los tickets que subió, se
queda. Si fue un error, añádela otra vez con el mismo correo: será una cuenta
nueva. Nadie puede quitarse a sí mismo: tu propia fila ya no lo ofrece.

### Cambia el nombre del hogar

Quien es propietario o administra el hogar puede cambiarle el nombre en
**Configuración → Hogar**. Hasta ahora el nombre que se ponía al registrarse
no se podía cambiar después.

### Pon nombre a la pestaña del navegador y a la app instalada

En **Configuración → Hogar** hay dos nombres más. El de la **pestaña** sale
detrás del título de cada página; vacío, la pestaña sigue diciendo «Stoky».
El de la **app instalada** es el que lleva el icono en el móvil; vacío, la app
se llama como el hogar. Los dos son públicos: el de la pestaña se ve también
en la página para iniciar sesión, y el de la app lo puede leer cualquiera que
llegue a la dirección de Stoky, así que si lo dejas vacío, también el nombre
del hogar. Una app ya instalada recoge el nombre nuevo cuando el navegador lo
vuelve a leer: Chrome, cuando le toca; en iPhone y iPad, al volver a
instalarla.

## Cambios incompatibles

1. **Esta versión se instala desde cero.** PostgreSQL pasa de la 16 a la 18,
   que no abre los datos de la 16, y el esquema parte de una única migración
   base que no se aplica sobre una base de alpha.4. Mientras Stoky sea alpha
   no se mantiene un camino de actualización.
2. **El paquete ya no incluye Traefik.** `traefik.yml` y `ACME_EMAIL`
   desaparecen; el TLS lo pone tu proxy, y Stoky solo cree sus cabeceras si
   lo nombras en `STOKY_TRUSTED_PROXIES` (aviso de arriba).
3. **Una instalación es un hogar, y `STOKY_REGISTRATION=open` ya no se
   acepta.** Con ese valor Stoky no arranca y lo dice en
   `docker compose logs app`; los valores son `first-user`, el de siempre por
   defecto, y `closed`.
4. **Una cuenta sin hogar ya no puede crear uno.** El hogar lo crea quien se
   registra; a los demás los añade quien lo administra.
5. **`NEXTAUTH_SECRET` y `NEXTAUTH_URL` ya no se leen.** Solo valen
   `STOKY_SECRET` y `STOKY_URLS`, los nombres que ya escribía el `install.sh`
   de alpha.4.
6. **El proyecto y sus imágenes cambian de dirección.** El repositorio pasa
   de `NGarate/stoky` a `nogcode/stoky`, y las imágenes de
   `ghcr.io/ngarate/stoky` a `ghcr.io/nogcode/stoky` (la aplicación) y
   `ghcr.io/nogcode/stoky/postgres`. El Compose de esta versión ya las nombra;
   como se instala desde cero, una instalación anterior no cambia y sigue
   descargando las suyas de la dirección antigua. La procedencia de esta
   versión se comprueba con `nogcode/stoky` en `--repo` y
   `--signer-workflow`; la de alpha.4 y anteriores, con `NGarate/stoky` y
   `--owner NGarate` en lugar de `--repo` (SECURITY.md).

## Cómo actualizar

No hay actualización desde `v0.1.0-alpha.4`: instala esta versión en una
carpeta nueva, como dice [Instalación](#instalación), y regístrate otra vez.
Lo que había en la instalación anterior no pasa a la nueva. Si quieres
conservarlo, guarda antes la copia de seguridad que describe la
[guía de alpha.4](https://github.com/nogcode/stoky/blob/v0.1.0-alpha.4/docs/INSTALL.md#backup-and-restore);
solo se puede restaurar en alpha.4.

Para retirar la instalación anterior, en su carpeta:

```bash
docker compose down
```

Sus volúmenes siguen ahí hasta que los borres con `docker volume rm`.

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

Imagen: `ghcr.io/nogcode/stoky:vNEXT` (**Linux amd64**), que el
Compose de esta versión fija por digest.

## Límites conocidos

* No se puede actualizar desde una alpha anterior.
* Solo hay imágenes para Linux amd64.
* No hay recuperación de contraseña por correo: la restablece quien administra
  el hogar.
* Las llaves de acceso solo funcionan en la primera dirección de `STOKY_URLS`.
* Siguen pendientes las comprobaciones humanas con lector de pantalla, con
  Safari en iOS y en la tableta de cocina. Que el iPhone muestre el nombre de
  la app instalada tampoco se ha comprobado en un dispositivo.

Consulta [estado](https://github.com/nogcode/stoky/blob/vNEXT/docs/STATUS.md)
y [seguridad](https://github.com/nogcode/stoky/blob/vNEXT/SECURITY.md).
Comunica los errores en [Issues](https://github.com/nogcode/stoky/issues), sin
secretos ni tickets con datos personales, y las vulnerabilidades por el
[formulario privado](https://github.com/nogcode/stoky/security/advisories/new).

## Verificación

No se probó actualizar desde alpha.4, porque no hay camino. Tampoco el proxy
ni el TLS de ninguna instalación real, que ahora son del operador:
`scripts/smoke-proxy.sh --live TU_DOMINIO` comprueba el tuyo.

Antes del tag pasó completa la CI de `master`: lint, tipos y contraste; las
pruebas unitarias, de componentes y de integración; la suite de navegador; y
la compilación de la imagen con su escaneo. La CI del tag arranca la imagen
publicada con el Compose publicado, en volúmenes nuevos, antes de
etiquetarla, y escanea las imágenes de PostgreSQL y Valkey que el Compose
nombra.

## Qué ha cambiado

<!-- cambios:inicio v0.1.0-alpha.4 -->

### 🚨 Cambios incompatibles

* refactor(auth)!: stop reading NEXTAUTH_SECRET and NEXTAUTH_URL ([`87ffdc1`](https://github.com/nogcode/stoky/commit/87ffdc1de87f17cdf863274391234b35eb4bdc98))
* build(db)!: start the schema from one baseline migration ([`bb97d57`](https://github.com/nogcode/stoky/commit/bb97d579fdb2d757146fa5a470ff4b97d5872329))
* feat(receipts)!: read Spanish supermarket receipts much better in [#19](https://github.com/nogcode/stoky/pull/19) ([`4dcfa76`](https://github.com/nogcode/stoky/commit/4dcfa76f911db2cdec4ae87dab8c448459e1216b))
* feat(docker)!: run PostgreSQL 18 ([`d90a6aa`](https://github.com/nogcode/stoky/commit/d90a6aa9592b8fa2d55905c377704e49f0acfe76))
* feat(docker)!: leave TLS and the proxy to the operator in [#23](https://github.com/nogcode/stoky/pull/23) ([`a005065`](https://github.com/nogcode/stoky/commit/a0050654870110711d8b471920ff978b1aab4ce1))
* feat(auth)!: refuse STOKY_REGISTRATION=open, one household per installation ([`3034941`](https://github.com/nogcode/stoky/commit/303494159d117f3b1d3dc555a67c2773e087d2c6))
* feat(household)!: stop creating a household from an account without one ([`24cb706`](https://github.com/nogcode/stoky/commit/24cb70646c23a6d3126e3d4b3f0b23121d04d764))
* build(docker)!: install from nogcode/stoky and its ghcr.io/nogcode images ([`854c438`](https://github.com/nogcode/stoky/commit/854c438595c82fb929edad3dc51978f175c0e1cd))

### 🔒 Seguridad

* fix(pwa): stop another open tab writing a signed-out account's reads back ([`f6f431b`](https://github.com/nogcode/stoky/commit/f6f431b5c3b3c26d50907280eba8252196befef6))
* fix(auth): keep the device cookie's value out of the passkey sign-in answer ([`8c46848`](https://github.com/nogcode/stoky/commit/8c46848fc5106ee112412948ac829745e3b514ea))
* fix(household): judge an admin's role at the write, not when the request began ([`8a9d4d3`](https://github.com/nogcode/stoky/commit/8a9d4d3e37599a731afb7e38a7337058634562d8))
* build(docker): update the bundle's Valkey to 8.1.11 ([`08fd254`](https://github.com/nogcode/stoky/commit/08fd25418e6cd6613d2434ed74411c39d9fd2884))
* fix(docker): start the bundle's PostgreSQL as its own user, with no capability ([`cecbc28`](https://github.com/nogcode/stoky/commit/cecbc28b145e5282a98ff4be1f162be9bbf1ea0b))
* fix(docker): move the bundle's Traefik to v3.7.17 ([`26a9490`](https://github.com/nogcode/stoky/commit/26a949081a3709b7114b01874127ffbc82eb5ac0))
* fix(docker): run our PostgreSQL image, without the official one's 19 HIGH findings ([`c60f5dc`](https://github.com/nogcode/stoky/commit/c60f5dc702ce4b6a60563daf79e8fe237468de25))
* build(deps): update next to 16.4.6, which fixes seven moderate advisories ([`2e69c9c`](https://github.com/nogcode/stoky/commit/2e69c9c3da4f200dbb4db13247e70c297fe557fe))
* build(docker): take the PostgreSQL build with libxml2 fixed ([`5b0bf06`](https://github.com/nogcode/stoky/commit/5b0bf06bbe23db8b1dbd6710977d588fe0ea4266))

### 🚀 Novedades

* feat(ui): add a text field that suggests what already exists ([`0794282`](https://github.com/nogcode/stoky/commit/0794282f61f6b323b79d9695f999c51ffe8e2e12))
* feat(products): suggest the brands, categories and units already used ([`21034d5`](https://github.com/nogcode/stoky/commit/21034d5814ac477c8c75a4e861cd6a026a51a8e5))
* feat(receipts): pick the receipt's store or type a new one ([`cfd8b4e`](https://github.com/nogcode/stoky/commit/cfd8b4ed802d2c3abe0c8b77f26f9c6ca3168ac2))
* feat(inventory): keep what is left of each batch, so every withdrawal names one ([`4c3e43c`](https://github.com/nogcode/stoky/commit/4c3e43c79ba2a93e46ee53bb243f33b648981a0c))
* feat(ui): fill the phone's bar with the screens last used ([`404cb76`](https://github.com/nogcode/stoky/commit/404cb7650f0cb99c678e16df39fb15bbf91da355))
* feat(auth): put the account and signing out in the main navigation ([`2747d4f`](https://github.com/nogcode/stoky/commit/2747d4f05d3275e402c44a61ede41079aa59502f))
* feat(products): let the scanner choose and remember the camera ([`7da32de`](https://github.com/nogcode/stoky/commit/7da32deab57a3266702b5d72cf6b412c432dcdd1))
* feat(inventory): find a product by its barcode in the product picker ([`cc15252`](https://github.com/nogcode/stoky/commit/cc15252ab074c6233465f250d97515fa3e8af37c))
* feat(inventory): scan a product from the stock screens' picker ([`bcd3198`](https://github.com/nogcode/stoky/commit/bcd3198dd32e7395847ddecba1497795a3a918ff))
* feat(receipts): scan the packet to match a receipt line ([`3e27ff8`](https://github.com/nogcode/stoky/commit/3e27ff8e5e5affdf37e7f6f8d67ee8d077875b80))
* feat(inventory): add a scan mode that saves each scanned product ([`0d33c35`](https://github.com/nogcode/stoky/commit/0d33c3517961c52cc07fa8ad83a2c972d5128032))
* feat(products): scan the barcode when creating or editing a product ([`0256255`](https://github.com/nogcode/stoky/commit/0256255fd62655d201cc36302bdd15462a0b776d))
* feat(receipts): accept HEIC receipt photos ([`819c7a5`](https://github.com/nogcode/stoky/commit/819c7a5a87adbb8b5a420fd7c07639458cdadcee))
* feat(receipts): show the receipt photo while reviewing it ([`9ad65aa`](https://github.com/nogcode/stoky/commit/9ad65aa5dab0580d41a2deaedc49970d69626172))
* feat(receipts): correct a receipt line OCR misread ([`9088878`](https://github.com/nogcode/stoky/commit/9088878eec439506cc0a1034d5213f1b5b92dfb2))
* feat(receipts): type in the lines a receipt reading missed ([`619dfc9`](https://github.com/nogcode/stoky/commit/619dfc97d5203bd4d1efc23c5a4dbb0be6350bfa))
* feat(receipts): correct a receipt's store, date and total ([`7652285`](https://github.com/nogcode/stoky/commit/76522857b17ba2f2c213af6c7c174494fce73eb5))
* feat(auth): require the household's name to register ([`8652a51`](https://github.com/nogcode/stoky/commit/8652a51a49cfe75eaf24ddb5c48d8a7f4a66135a))
* feat(household): delete a removed member's account ([`9cd5d10`](https://github.com/nogcode/stoky/commit/9cd5d1049ccecee34e9d16c373995cf9962b1bda))
* feat(household): let an admin rename the household ([`b733fe8`](https://github.com/nogcode/stoky/commit/b733fe8fa1e59552878c63cac72f25327fd3c6c9))
* feat(household): name the browser tab and the installed app ([`0623771`](https://github.com/nogcode/stoky/commit/0623771c73b47c7185e5fa0bf84fe6e4743bb4b4))

### 🌟 Mejoras

* perf(inventory): add up stock in one grouped query, rounded the overview's way ([`c43bbf7`](https://github.com/nogcode/stoky/commit/c43bbf7da5e9aab1666a4b22ad7c3805057d73ac))
* perf(inventory): read only the ledgers that can hold an expiring batch ([`8836ced`](https://github.com/nogcode/stoky/commit/8836cedd2ed36e622d6520636d581400fcf849fa))

### 🐛 Correcciones

* fix: validate requests with zod 4, whose array check cannot exhaust memory ([`47a0ab3`](https://github.com/nogcode/stoky/commit/47a0ab30857d7725dd36c0cbfcb1d2157231ee1b))
* fix(pwa): keep the offline changes another open tab made ([`a3813f1`](https://github.com/nogcode/stoky/commit/a3813f1e60877511ed7b1d8a01e4ab2f84f85d63))
* fix(pwa): say when an offline change could not be kept on the device ([`fe936d1`](https://github.com/nogcode/stoky/commit/fe936d1f1444726eeb9118a6b7206a1270b4e348))
* fix(shopping): stop adding list amounts in a unit the product is not counted in ([`fcc28cd`](https://github.com/nogcode/stoky/commit/fcc28cd87e9971205b5822958d659aca53147e4c))
* fix(pwa): back off when the server gives no readable answer ([`064f2a1`](https://github.com/nogcode/stoky/commit/064f2a1118a90ff13ad91ded750174044bef5ec5))
* fix(docker): stop install.sh writing a new database password when Docker will not answer ([`48507ec`](https://github.com/nogcode/stoky/commit/48507ecb83a36ae0647457fe5925afa952132e67))
* fix(pwa): open the installed app and the kitchen without a signal ([`911ecb5`](https://github.com/nogcode/stoky/commit/911ecb5925c94938e4d1b9c0a01284193e63b55a))
* fix(pwa): clear the "no room for more changes" banner once there is room ([`4d84a65`](https://github.com/nogcode/stoky/commit/4d84a6592d68f643ce14a11b2f46f8739c89df95))
* fix(receipts): show each applied line its own price, not the first one of its product ([`d641e0d`](https://github.com/nogcode/stoky/commit/d641e0d784381f46fb14f06f282eda942a4ffa98))
* fix(pwa): keep a retried offline edit from undoing a later one ([`9ea1217`](https://github.com/nogcode/stoky/commit/9ea1217565c1651ad2340070086bf107155f3dd6))
* fix(receipts): fold accents with one list, so a receipt matches what the search finds ([`c49ac64`](https://github.com/nogcode/stoky/commit/c49ac64c94ae8f2728e89d27edae089a4ef8e33e))
* fix(auth): leave a sign-in in progress alone when the session asked for was already gone ([`b6ebdf2`](https://github.com/nogcode/stoky/commit/b6ebdf2fe22da3a8947a9791cab21bbb92aa634b))
* fix(household): keep in the export which batch each consumption drew from ([`a796af0`](https://github.com/nogcode/stoky/commit/a796af0b879912db3c7b3c0118f25b5b7e4f7fa9))
* fix(products): lead a product's page back to the screen that opened it ([`1524518`](https://github.com/nogcode/stoky/commit/1524518d0ed1721378bc575bca43d0d13ca30c3e))
* fix(products): draw the catalogue's row actions as buttons ([`0917551`](https://github.com/nogcode/stoky/commit/0917551098b26279cf8e0031788bc77c6ed5063d))
* fix(ui): send every way back to the screen it came from ([`bb8f67a`](https://github.com/nogcode/stoky/commit/bb8f67a40e46852ef862ffc80367f51039b22f4b))
* fix(pwa): keep only answered queries in the offline cache ([`f559830`](https://github.com/nogcode/stoky/commit/f55983037a8a64ba6c44e582303abf5d7d3a7df0))
* fix(docker): start the bundle's PostgreSQL as postgres, without gosu ([`4df104c`](https://github.com/nogcode/stoky/commit/4df104c4c230e040cd73c860c1f3fd998beadef0))
* fix(products): stop a barcode lookup waiting on the cache while Valkey is down ([`2ed907a`](https://github.com/nogcode/stoky/commit/2ed907a22f2270eeb67498094299ff973f1dc9b0))

### 📦 Dependencias e imágenes

* build(deps-dev): take happy-dom 21.0.4 for the import-alias advisory ([`55631eb`](https://github.com/nogcode/stoky/commit/55631eb33827ab9d7c87e88a7a770b00d1b3c075))
* build(deps-dev): take fast-uri 3.1.9 for the scheme and host advisories ([`e219d8b`](https://github.com/nogcode/stoky/commit/e219d8b4c9165f6c3eeec8478c57c6582e272968))
* build(docker): run on Bun 1.4.4 for its security fixes ([`63c9633`](https://github.com/nogcode/stoky/commit/63c9633332f6849b271977f8a33d337939735374))
* build(deps): take React 19.3.1 ([`93d892a`](https://github.com/nogcode/stoky/commit/93d892a0674ffcc7a5d67cd2b4a418836025032e))
* build(deps): take tRPC 11.19.0 ([`d2c0cf2`](https://github.com/nogcode/stoky/commit/d2c0cf23a8683afc06fc74a7e631702090f29454))
* build(deps): take next-intl 4.14.9 ([`b03ba11`](https://github.com/nogcode/stoky/commit/b03ba11e5602907f56c8821e53d8ac687e12ba3e))
* build(deps): take @radix-ui/react-dialog 1.3.1 ([`fd32360`](https://github.com/nogcode/stoky/commit/fd32360cce4fe018291fd92ec35be3d557e598a4))
* build(deps): take @radix-ui/react-slot 1.5.0 ([`614f7cb`](https://github.com/nogcode/stoky/commit/614f7cb2e738b5271b49be8e77c47d0f2db9c7f3))
* build(deps): take @radix-ui/react-toast 1.3.1 ([`97526fe`](https://github.com/nogcode/stoky/commit/97526fe6c964288681bf3ff51152cc417cd62ffd))
* build(deps): take tailwind-merge 3.7.0 ([`c621390`](https://github.com/nogcode/stoky/commit/c621390646ae745b3ea3afc682bf3dad2c819047))
* build(deps): take TanStack Query 5.104.5 ([`e4fffeb`](https://github.com/nogcode/stoky/commit/e4fffeb9cfa9209cb3c4475bfba2714193ca8ef8))
* build(deps): take zustand 5.0.16 ([`f725d17`](https://github.com/nogcode/stoky/commit/f725d17e9f73c68cffbe168b8e26a8957dce66b5))
* build(deps): take Better Auth 1.7.12 ([`3de6cff`](https://github.com/nogcode/stoky/commit/3de6cffbe20d90552e6ae52b18f4e7293f45956f))
* build(deps-dev): take axe-core 4.14.0 ([`105d820`](https://github.com/nogcode/stoky/commit/105d820bdbf75a960426813bbd9b9192c9cd3b63))
* build(deps-dev): take @testing-library/dom 10.4.2 ([`7a81fd1`](https://github.com/nogcode/stoky/commit/7a81fd125a692c4f6cbceb9e57950b286ad6e603))
* build(deps-dev): take @testing-library/user-event 14.6.8 ([`ef6a4c1`](https://github.com/nogcode/stoky/commit/ef6a4c1d84afb6db24c5319a7eae3a12b17b82f0))
* build(deps-dev): take postcss 8.5.31 ([`99037d8`](https://github.com/nogcode/stoky/commit/99037d83cccde4f292e44af0f74379ae6d4f38a3))
* build(deps-dev): take @types/bun 1.4.3 ([`41918a8`](https://github.com/nogcode/stoky/commit/41918a82a05f5cab4f405a76217dd2f015fa1f29))
* build(deps-dev): take @types/node 22.20.5 ([`c958d94`](https://github.com/nogcode/stoky/commit/c958d94168a0140dc6095c72d101d4f32aaf897c))
* build(deps-dev): take react-doctor 0.9.18 ([`23cfdc0`](https://github.com/nogcode/stoky/commit/23cfdc0ec7a7e73131026cf442e3752dd367c200))
* build(deps-dev): take Playwright 1.64.1, with the image its browsers come from ([`ab10fc5`](https://github.com/nogcode/stoky/commit/ab10fc53aa4db7da91a95f83795ef22b006155d6))
* build(deps-dev): take oxlint 1.89 ([`4ea255d`](https://github.com/nogcode/stoky/commit/4ea255dba8c5fedb4b0910ed34b505fcc8945dfa))
* build(deps-dev): take @types/node 26 ([`c9eed91`](https://github.com/nogcode/stoky/commit/c9eed91ef48a1158e6d33835a7274d88e94b270a))
* build(deps): take lucide-react 1.61 ([`73763b2`](https://github.com/nogcode/stoky/commit/73763b2c2dcf0e0f09582e14c62b281acac16699))
* build(deps): take Recharts 3 ([`f6cf611`](https://github.com/nogcode/stoky/commit/f6cf611a4c55630b4ae26b984124bd6aa6109b73))
* build(deps): take react-dropzone 20 ([`a69a1d5`](https://github.com/nogcode/stoky/commit/a69a1d50fe8867ed647124e27bce7fa8506686bb))
* build(deps-dev): type-check with TypeScript 7 ([`aab2cbb`](https://github.com/nogcode/stoky/commit/aab2cbb7068ee003c3d1b5d52ee5e717e1ec4e3c))
* build(deps): take Prisma 7, through the pg driver adapter ([`4f14173`](https://github.com/nogcode/stoky/commit/4f141737341cb773b58b035ebfd98fcd63336b1c))
* build(docker): keep the release Compose file to its configuration ([`2b65f0f`](https://github.com/nogcode/stoky/commit/2b65f0ffed8f7b705258df8fad78b93d1aa5095b))
* build(docker): shorten the release example.env ([`4f918ed`](https://github.com/nogcode/stoky/commit/4f918ed66e462595ec1004069e9260f46c469052))
* build(deps): update next to 16.4.3 ([`e722d12`](https://github.com/nogcode/stoky/commit/e722d12e8e78dbb402f68ca80cdfbb0590a9bc1b))
* build(deps-dev): update @types/bun to 1.4.4 ([`310d67d`](https://github.com/nogcode/stoky/commit/310d67dd96003d0979d8115d55d63489a0572958))
* build(deps): update argon2 to 0.44.0, not 0.45 ([`a060801`](https://github.com/nogcode/stoky/commit/a06080131373f38c418e13571576976e4d4d8f6d))
* build(docker): take the rebuilt postgres:16.15-alpine in the bundle ([`4ceb9ca`](https://github.com/nogcode/stoky/commit/4ceb9caa3b5a50f0abf90d0aba642b1ba5ac5ea4))
* build(docker): start development and CI PostgreSQL as its own user ([`54adbcf`](https://github.com/nogcode/stoky/commit/54adbcf88870607111974b042538f780b1921d87))
* build(deps): add knip to find unused files, exports and dependencies ([`025b88f`](https://github.com/nogcode/stoky/commit/025b88f67dd50ce12edcfed3b5517b1638783eea))
* build(deps): drop postcss ([`fe6ffb4`](https://github.com/nogcode/stoky/commit/fe6ffb4433baa5a46d3fbed363649cf1802699a8))

### 📚 Documentación

* docs: make the advisory form the only reporting channel while issues are closed ([`4aa124f`](https://github.com/nogcode/stoky/commit/4aa124f50678037f68e73089e0effc6bab8028be))
* docs(auth): name the Better Auth version the code runs on, 1.7.12 ([`2decfba`](https://github.com/nogcode/stoky/commit/2decfba3c510b5cf4533560a863a09951d5d9fc7))
* docs: retire REDESIGN_PLAN.md, keeping the decisions it holds ([`2458b89`](https://github.com/nogcode/stoky/commit/2458b890d9dc3c99f48fbed55c0c6515ea5df86a))
* docs: send security reports and issues to nogcode/stoky ([`7a7a074`](https://github.com/nogcode/stoky/commit/7a7a0747333d13e33a0cbadbdf01d528550a733f))

Los cambios internos (CI, pruebas, refactorizaciones, documentación del proyecto) no se listan; están en la comparación completa.

**Changelog completo**: https://github.com/nogcode/stoky/compare/v0.1.0-alpha.4...vNEXT
<!-- cambios:fin -->

## English

> [!NOTE]
> `v0.2.0-alpha.0` was tagged on 2026-11-25 but never published: its CI run
> failed pushing the image, before any of the version's files existed. This
> is that version with the fix. The change list above counts from that tag;
> everything that changed since `v0.1.0-alpha.4` is in its
> [notes](https://github.com/nogcode/stoky/blob/vNEXT/docs/releases/v0.2.0-alpha.0.md).

> [!CAUTION]
> **The bundle no longer includes Traefik or requests certificates.** Stoky
> answers plain HTTP on port 3000 of your server, and TLS is your reverse
> proxy's: Traefik, Caddy, nginx or `tailscale serve`. The installation
> guide has an example of each under "Your proxy". Before upgrading, put a
> proxy with TLS in front of port 3000 and tell Stoky which it is with
> `STOKY_TRUSTED_PROXIES` in `.env`; `ACME_EMAIL` is no longer used. Start
> with `docker compose up -d --wait --remove-orphans`, which removes the
> previous Traefik container. The `stoky-release_letsencrypt` volume can be
> deleted afterwards. `scripts/smoke-proxy.sh --live YOUR_DOMAIN`, run from
> another network, checks that your proxy is set up right.
>
> Carries security fixes worth installing soon. Stoky now believes
> `X-Forwarded-For` and `X-Forwarded-Proto` only from the proxies listed in
> `STOKY_TRUSTED_PROXIES`, and from none until you set it. Before, anyone
> who reached the application without going through the proxy could choose,
> with one header, the address their sign-in attempts were counted by.
> Valkey moves to `8.1.12`, with `zlib` and `musl` fixed. PostgreSQL moves
> to our own image (`ghcr.io/nogcode/stoky/postgres`): the official one with
> the fixes Alpine has already shipped, without the official one's 19 HIGH
> advisories in `krb5` and `libxslt`, nor the one in `libxml2`
> (CVE-2026-86144). It starts as the `postgres` user and
> no longer carries `gosu`, used only by a root start, with its 26 CRITICAL
> and HIGH Go advisories. alpha.4's Traefik (`v3.7.16`), with a
> HIGH advisory in `go-jose` and two in `golang.org/x/net`, goes with the
> new bundle.
>
> PostgreSQL moves from 16 to 18, which cannot open 16's data: an earlier
> installation starts with an empty database.

### Brand, category and unit suggest what you already use

Creating or editing a product, the **Brand**, **Category** and **Unit**
fields show what your household has already used, most common first, and
narrow as you type. Anything not on the list is simply typed in, kept as
written, and suggested from then on.

### Pick the receipt's store, or type a new one

The **Receipt's store** field lists your household's stores and narrows as
you type. If the store is not there, type its name: Stoky says it will add
it, and creates it when the receipt is uploaded. Anyone who can upload
receipts can do this, not only the household's administrators. A name that
already exists in other capitals files the receipt under that store.

### Always know what is left of each batch

Use something up without saying which pack, and Stoky takes it from the one
that expires first, on the shelf you chose or anywhere if you chose none.
Recounting down and moving things work the same way. Every batch knows what
it has left, so the kitchen and the product page no longer say "Quantity
unconfirmed".

### The phone's bar shows where you are

On a phone or tablet, the bar's three buttons are the last three screens
you used on that device. The one you are on is always there, marked;
opening another puts it in place of the one you used longest ago, and the
others stay where they are. **More** has the rest. **Scan** has left the
bar: it is still on Products, Inventory and Shopping.

### Your account and signing out, one tap away

On a desktop, the circle with your initials at the top right opens your
account: the name and address you are signed in with, **Security and
access** and **Sign out**. On a phone or tablet the same is at the top of
**More**. Signing out no longer means scrolling to the end of Settings.

### Scan the product where you choose it

Adding or using up stock, or adding to a shopping list, the **Scan**
button beside the search opens the
camera and chooses the product by its barcode, without leaving the screen.
Reviewing a receipt, each line has **Scan** too: with the packet at hand,
its code says which product it is better than the receipt's text does.
If the camera will not read it, type the code. If no product has that code,
Stoky offers to look it up in Open Food Facts, to create it with the code
already on it, or to save it onto a product you choose. With more than one
camera you can pick which, and it is remembered. A USB or Bluetooth barcode
reader works too: it types the code into the search and the product is
chosen.

**Scan mode**, on Add stock and Record use, saves each product as soon as
it is scanned, with the quantity given (1 if left empty), and opens the
camera again for the next: a bag of shopping is put away scan by scan.

Creating or editing a product, the **Barcode** field has **Scan** too: the
camera fills it in with the code it reads.

### "Back" takes you where you were

Screens reached from more than one place (adding or using stock, uploading
a receipt, a product's prices, its history, the scanner…) now go back to the
screen you came from, and the link says which: **Back to the dashboard**,
**Back to the product**, **Back to the list**. They used to go to the same
place every time. **Cancel** on those forms does the same, and the list you
return to is still where you left it.

### Phone HEIC photos can be uploaded

Uploading a receipt now takes HEIC photos, the format the iPhone camera and
many Android phones save in, which used to be left out of the picker
altogether. Stoky converts them to JPEG on arrival and the receipt is read
like any other photo. Some browsers cannot show a HEIC photo's preview, but
the upload works.

### Review a receipt with its photo in front of you

When reviewing a receipt, **See the receipt photo** opens the photo you
uploaded, so a misread price or a line the automatic reading skipped can be
checked without finding the paper. Anyone who can review receipts sees it;
the kitchen account does not, because the photo shows what the receipt
prints, such as the card or the loyalty card.

### Correct what was misread on a receipt

Each receipt line now has **Correct**: change the name, the amount or the
quantity when the automatic reading gets it wrong, on a confirmed line too.
Renaming a line Stoky had recognised on its own sends it back to pending so
you choose the product, because it was recognised from the misread name. If
the receipt prints how many items were bought (at Costco, "TOTAL ARTS"), the
review warns when the lines read do not add up to it, so you look for the
one missing or extra.

### Add by hand what the receipt reading missed

**Add line**, at the end of the review, adds a product the automatic
reading skipped. And a receipt that could not be read no longer has to be
uploaded again: **Add the lines by hand** opens it with its photo so you can
type its lines and finish it like any other. The receipts list leads there
too.

### Frame the receipt when you photograph it

When you choose or take a receipt's photo, Stoky shows it with a
four-cornered frame. Move the corners to the paper's corners and press
**Send receipt**: Stoky reads the receipt you framed, straightened, without
the table around it. If you leave the corners alone, it finds the receipt in
the photo as before. To be precise, enlarge the photo with the magnifier
buttons or two fingers, here and when picking an item's lines. The photo is
kept whole, so the frame can be corrected later: in the review, **See the
receipt photo** shows it with the frame it was read with, **Correct the
receipt's crop** lets you move it, and **Read the receipt again** reads it
once more with the new frame. That replaces its lines, losing corrections,
chosen products and lines added by hand; once applied to the inventory it
cannot be done. HEIC photos the browser cannot show are sent without a
frame. While it is read, its review says so and shows the lines as soon as
it finishes.

### Read an item's lines again, or delete it

When you **Correct** a receipt item, **Pick the lines on the receipt** opens
the photo with a frame: tap it to carry the frame to that item's lines,
adjust the corners so its name, price and discounts are inside, and press
**Read these lines**. Stoky reads only those lines and fills in the product,
amount and quantity from them; check them and save the correction. If the
item is not one (a payment line, a total read as a product), **Delete item**
takes it off the receipt, and **Undo** brings it back.

### Correct a receipt's store, date and total

**Correct the receipt's details**, in the review, changes the store, the
purchase date and the total when they were not read or were misread. The
store is picked or typed as when uploading. It matters most: without a store,
the receipt's prices are not kept. The review now shows the total as well.

### Receipts are read much better

The automatic reading of receipts now understands how Spanish chains print
their lines: the name on one line and the price on the next (Costco),
weighed products (Mercadona, Lidl, DIA, Costco), quantities like "2 x 0,89" above
or below the product, discounts and offers, and receipts in Catalan.
Nothing printed after the total — the payment, the VAT breakdown — is
booked as a product any more, and the total is taken from where the
receipt agrees with itself: the TOTAL line, the card or cash payment, the
VAT breakdown and the sum of the products. The photo is also cropped to the
receipt before it is read — straightened into a rectangle when it is tilted
or skewed, cropped so the table is not read as text (nor what the crop
holds beside a leaning or curved ticket), its light, shadows and folds
evened out, turned the right way up (on its side or upside down, by its
shape and by how legible its text is) and its curled lines straightened —
and it is read six ways, keeping the reading the others agree with. Measured
on 63 real receipts from eleven chains, read by hand: products read with the
right name and price went from 34% to 60%, and the right total from 13% to
58%. On ten more receipts and thirty copies of them turned, darkened, shrunk
and shadowed, the score (article prices, total and date) goes from 32% to
93%, and reading a receipt takes less time than before: about 16 seconds,
with three readings at a time. How many at a
time is `OCR_WORKERS` in `.env` (3 when unset; each takes about 120 MB of
memory). For that, the application container's memory goes from 1 GiB to
2 GiB in `docker-compose.yml`. The price kept for each product is what you
paid: a discount printed under a product is taken off it. Whatever the
reading gets wrong can still be corrected in the review.

### What you last saw stays there offline, even after a reload

Reloading a page while something was still loading damaged the copy the app
keeps for use offline, and the next visit threw the whole copy away: with no
signal, the shopping list or the inventory came up empty. Now only what has
already arrived is kept, and an old damaged copy is simply discarded.

### Registering names the household

The registration form now asks for the household's name and does not go on
without it: whoever registers creates the household and runs it. Before, it
could be left blank, and the account had no household until one was created
afterwards.

### Removing somebody from the household deletes their account

In **Configuración → Personas del hogar**, removing somebody now deletes
their account and signs them out on every device: they can no longer sign
in. Before, the account was left with no household and nothing to do with
it. What they did in the household, such as stock movements and the receipts
they uploaded, stays. If it was a mistake, add them again with the same
email address: it will be a new account. Nobody can remove themselves: your
own row no longer offers it.

### Rename the household

Whoever owns or runs the household can rename it in
**Configuración → Hogar**. Until now the name given at registration could not
be changed afterwards.

### Name the browser tab and the installed app

**Configuración → Hogar** has two more names. The **tab**'s follows each
page's title; left empty, the tab still says "Stoky". The **installed app**'s
is the one under its icon on the phone; left empty, the app takes the
household's name. Both are public: the tab's shows on the sign-in page too,
and anyone who reaches Stoky's address can read the app's, so if you leave it
empty, the household's name as well. An app already installed picks up a new
name when the browser reads it again: Chrome on its own schedule, iPhone and
iPad only when it is installed again.

### Breaking changes

* **This release is installed from scratch.** PostgreSQL goes from 16 to 18,
  which does not open 16's data, and the schema starts from a single baseline
  migration that does not apply over an alpha.4 database. While Stoky is an
  alpha no upgrade path is kept: install it in a new directory (Instalación,
  above) and register again.
* **The bundle no longer includes Traefik.** `traefik.yml` and `ACME_EMAIL`
  are gone; TLS is your proxy's, and Stoky believes its headers only when
  `STOKY_TRUSTED_PROXIES` names it.
* **An installation is one household, and `STOKY_REGISTRATION=open` is no
  longer accepted.** With it, Stoky does not start and says why in
  `docker compose logs app`; the values are `first-user`, the default as
  before, and `closed`.
* **An account without a household can no longer create one.** Whoever
  registers creates the household; an administrator adds everybody else.
* **`NEXTAUTH_SECRET` and `NEXTAUTH_URL` are no longer read**, only
  `STOKY_SECRET` and `STOKY_URLS`.
* **The project and its images have a new address.** The repository moves
  from `NGarate/stoky` to `nogcode/stoky`, and the images from
  `ghcr.io/ngarate/stoky` to `ghcr.io/nogcode/stoky` (the application) and
  `ghcr.io/nogcode/stoky/postgres`. This release's Compose file already names
  them; since it is installed from scratch, an earlier installation does not
  change and keeps pulling its own images from the old address. This
  release's provenance is checked with `nogcode/stoky` in `--repo` and
  `--signer-workflow`; alpha.4's and earlier ones', with `NGarate/stoky` and
  `--owner NGarate` in place of `--repo` (SECURITY.md).

### Known limits and what was tested

No upgrade from an earlier alpha; Linux amd64 only; no password recovery by
email; passkeys only at the first `STOKY_URLS` address. The human checks with
a screen reader, Safari on iOS and the kitchen tablet are still outstanding,
and so is seeing the installed app's name on an iPhone. `master`'s CI passed
whole before the tag; no real installation's proxy or TLS was tested.
