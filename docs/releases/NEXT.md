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
* Los tickets se leen mucho mejor

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
porque lo reconoció por el nombre mal leído.

### Añade a mano lo que el ticket no leyó

**Añadir línea**, al final de la revisión, añade un producto que la lectura
automática se saltó. Y un ticket que no se pudo leer ya no hay que repetirlo:
**Añadir las líneas a mano** lo abre con su foto para que escribas sus líneas
y lo termines como cualquier otro. También se llega desde la lista de
tickets.

### Corrige la tienda, la fecha y el total de un ticket

**Corregir los datos del ticket**, en la revisión, cambia la tienda, la fecha
de compra y el importe total cuando no se leyeron o se leyeron mal. La tienda
se elige o se escribe como al subirlo. Importa sobre todo: sin tienda, los
precios del ticket no se guardan. La revisión muestra ahora también el total.

### Los tickets se leen mucho mejor

La lectura automática de los tickets entiende ahora cómo imprimen las
cadenas españolas sus líneas: el nombre en una línea y el precio en la
siguiente (Costco), los productos a peso (Mercadona, Lidl, DIA), las
cantidades como «2 x 0,89» encima o debajo del producto, los descuentos y
las ofertas, y los tickets en catalán. Ya no apunta como producto nada de
lo que va después del total —el pago, el desglose del IVA—, y el total se
toma de donde el ticket coincide consigo mismo: la línea TOTAL, el pago con
tarjeta o en efectivo, el desglose del IVA y la suma de los productos.
Además, antes de leer la foto se endereza el ticket (si está inclinado o
torcido se convierte en un rectángulo), se recorta para que la mesa no se lea
como texto, se igualan la luz, las sombras y los pliegues, se gira solo
(de lado o del revés, según la forma del ticket y lo legible del texto) y se
estiran las líneas curvadas. Luego se lee de seis maneras y se queda la
lectura en la que coinciden las demás. Medido con 63 tickets reales de once
cadenas leídos a mano: los productos leídos con nombre y precio correctos
pasan del 34 % al 60 %, y el total correcto, del 13 % al 58 %. Con diez
tickets más y treinta copias suyas giradas, oscurecidas, reducidas y con
sombra, la nota (precios de los artículos, total y fecha) pasa del 32 % al
93 %, y leer un ticket tarda algo menos que antes: unos 21 segundos, con dos
lecturas a la vez. Cuántas a la vez lo decide
`OCR_WORKERS` en `.env` (2 si no se pone; cada una usa unos 120 MB de
memoria). Lo que la lectura no acierte se sigue corrigiendo en la revisión.

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
you choose the product, because it was recognised from the misread name.

### Add by hand what the receipt reading missed

**Add line**, at the end of the review, adds a product the automatic
reading skipped. And a receipt that could not be read no longer has to be
uploaded again: **Add the lines by hand** opens it with its photo so you can
type its lines and finish it like any other. The receipts list leads there
too.

### Correct a receipt's store, date and total

**Correct the receipt's details**, in the review, changes the store, the
purchase date and the total when they were not read or were misread. The
store is picked or typed as when uploading. It matters most: without a store,
the receipt's prices are not kept. The review now shows the total as well.

### Receipts are read much better

The automatic reading of receipts now understands how Spanish chains print
their lines: the name on one line and the price on the next (Costco),
weighed products (Mercadona, Lidl, DIA), quantities like "2 x 0,89" above
or below the product, discounts and offers, and receipts in Catalan.
Nothing printed after the total — the payment, the VAT breakdown — is
booked as a product any more, and the total is taken from where the
receipt agrees with itself: the TOTAL line, the card or cash payment, the
VAT breakdown and the sum of the products. The photo is also cropped to the
receipt before it is read — straightened into a rectangle when it is tilted
or skewed, cropped so the table is not read as text, its light, shadows and
folds evened out, turned the right way up (on its side or upside down, by its
shape and by how legible its text is) and its curled lines straightened —
and it is read six ways, keeping the reading the others agree with. Measured
on 63 real receipts from eleven chains, read by hand: products read with the
right name and price went from 34% to 60%, and the right total from 13% to
58%. On ten more receipts and thirty copies of them turned, darkened, shrunk
and shadowed, the score (article prices, total and date) goes from 32% to
93%, and reading a receipt takes a little less time than before: about 21
seconds, with two readings at a time. How many at a
time is `OCR_WORKERS` in `.env` (2 when unset; each takes about 120 MB of
memory). Whatever the reading gets wrong can still be corrected in the
review.
