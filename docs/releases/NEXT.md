# Stoky vNEXT

## Destacado

* Cuatro sitios fijos en la barra del móvil
* Productos y Precios, dentro de Inventario y de Compra
* Lo principal de cada pantalla, siempre en el mismo sitio

### Cuatro sitios fijos en la barra del móvil

La barra del móvil tiene siempre los mismos cuatro botones, en el mismo
orden: **Inicio**, **Compra**, **Inventario** y **Tickets**. Ya no cambia
según lo que hayas abierto antes, y desaparece «Más». Configuración y la
pantalla de cocina están en tu cuenta, el círculo de arriba a la derecha,
junto a cerrar sesión. En la tableta, la barra de la izquierda tiene los
mismos cuatro y la **Cocina**, y tu cuenta al pie. En el ordenador, la barra
de arriba pasa de ocho enlaces a esos cinco, y Configuración está en el
círculo de tu cuenta. «Panel» se llama ahora **Inicio**.

### Productos y Precios, dentro de Inventario y de Compra

Inventario tiene dos vistas, **Existencias** y **Productos**, y Compra otras
dos, **Listas** y **Precios**, una al lado de la otra bajo el título. Lo que
guardas en casa y el catálogo de lo que compras quedan en el mismo sitio, y
pasar de una vista a otra es un toque. Las direcciones no cambian: un enlace
guardado a `/products` o a `/prices` sigue llevando a donde llevaba.

### Lo principal de cada pantalla, siempre en el mismo sitio

En el móvil y en la tableta, lo que más se hace en cada pantalla es un botón
grande abajo a la derecha, junto al pulgar y siempre en el mismo punto:
**Añadir a la lista** en Compra, **Añadir existencias** en Inventario,
**Crear un producto** en Productos y **Subir un ticket** en Tickets. Si solo
tienes una lista de la compra, «Añadir a la lista» te lleva a ella; si tienes
varias o ninguna, a tus listas. En el ordenador el botón sigue arriba, junto
al título. En Compra, **Escanear** sigue arriba del todo, ahora con borde.

## Cambios incompatibles

Ninguno todavía.

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
* Siguen pendientes las comprobaciones humanas con lector de pantalla, con
  Safari en iOS y en la tableta de cocina.

Consulta [estado](https://github.com/nogcode/stoky/blob/vNEXT/docs/STATUS.md)
y [seguridad](https://github.com/nogcode/stoky/blob/vNEXT/SECURITY.md).
Comunica los errores en [Issues](https://github.com/nogcode/stoky/issues), sin
secretos ni tickets con datos personales, y las vulnerabilidades por el
[formulario privado](https://github.com/nogcode/stoky/security/advisories/new).

## Verificación

Nada todavía.

## Qué ha cambiado

## English

### Four fixed places in the phone's bar

The phone's bar always has the same four buttons in the same order:
**Home**, **Shopping**, **Inventory** and **Receipts**. It no longer changes
with what you opened before, and "More" is gone. Settings and the kitchen
screen are in your account, the circle at the top right, beside signing out.
On a tablet the bar on the left has the same four and the **Kitchen**, with
your account at its foot. On a computer the top bar goes from eight links to
those five, and Settings is in your account's circle. "Dashboard" is now
called **Home**.

### Products and Prices, inside Inventory and Shopping

Inventory has two views, **Stock** and **Products**, and Shopping two more,
**Lists** and **Prices**, side by side under the title. What you keep at home
and the catalogue of what you buy are in one place, and moving from one view
to the other is one tap. The addresses do not change: a saved link to
`/products` or `/prices` still goes where it went.

### Each screen's main action, always in the same place

On a phone and a tablet, what is done most on each screen is a large button
at the bottom right, by the thumb and always in the same spot: **Add to the
list** in Shopping, **Add stock** in Inventory, **Create a product** in
Products and **Upload a receipt** in Receipts. With one shopping list, "Add
to the list" takes you to it; with several or none, to your lists. On a
computer the button stays at the top, beside the title. In Shopping,
**Scan** stays at the very top, now outlined.

### Known limits and what was tested

No upgrade from an earlier alpha; Linux amd64 only; no password recovery by
email; passkeys only at the first `STOKY_URLS` address. The human checks with
a screen reader, Safari on iOS and the kitchen tablet are still outstanding.
