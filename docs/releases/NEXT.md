# Stoky: próxima versión

> [!CAUTION]
> Trae correcciones de seguridad que conviene instalar cuanto antes. El
> Traefik de alpha.4 (`v3.7.16`) tiene un aviso HIGH en `go-jose` y dos en
> `golang.org/x/net`; esta versión instala `v3.7.17`, que no tiene ninguno.
> Valkey pasa a `8.1.11`, con `zlib` y `musl` corregidos.

## Destacado

* Marca, categoría y unidad te sugieren lo que ya usas
* Al subir un ticket, elige la tienda o escribe una nueva
* Siempre sabes cuánto queda de cada lote
* La barra del móvil muestra dónde estás
* Tu cuenta y cerrar sesión, a un toque
* Escanea el producto donde lo eliges

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

## English

> [!CAUTION]
> Carries security fixes worth installing soon. alpha.4's Traefik
> (`v3.7.16`) has a HIGH advisory in `go-jose` and two in
> `golang.org/x/net`; this release installs `v3.7.17`, which has none.
> Valkey moves to `8.1.11`, with `zlib` and `musl` fixed.

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
