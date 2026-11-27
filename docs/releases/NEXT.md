# Stoky vNEXT

## Destacado

* Productos y Precios, dentro de Inventario y de Compra

### Productos y Precios, dentro de Inventario y de Compra

Inventario tiene dos vistas, **Existencias** y **Productos**, y Compra otras
dos, **Listas** y **Precios**, una al lado de la otra bajo el título. Lo que
guardas en casa y el catálogo de lo que compras quedan en el mismo sitio, y
pasar de una vista a otra es un toque. Las direcciones no cambian: un enlace
guardado a `/products` o a `/prices` sigue llevando a donde llevaba.

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

### Products and Prices, inside Inventory and Shopping

Inventory has two views, **Stock** and **Products**, and Shopping two more,
**Lists** and **Prices**, side by side under the title. What you keep at home
and the catalogue of what you buy are in one place, and moving from one view
to the other is one tap. The addresses do not change: a saved link to
`/products` or `/prices` still goes where it went.

### Known limits and what was tested

No upgrade from an earlier alpha; Linux amd64 only; no password recovery by
email; passkeys only at the first `STOKY_URLS` address. The human checks with
a screen reader, Safari on iOS and the kitchen tablet are still outstanding.
