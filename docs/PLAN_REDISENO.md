# Plan de rediseño — dos pantallas de entrada

Fecha: 2026-08-09 · rama `design/ui-proposals`

Este documento es un **plan, no una implementación**. Recoge qué se construye,
en qué orden, y qué decisiones faltan.

---

## 1. Qué sobrevive de las cinco propuestas

| Propuesta | Destino |
|---|---|
| **Horizonte** | Base de la **pantalla de cocina**. El eje de tiempo responde justo a "¿qué caduca?" |
| **Estante** | Base de la **app móvil**. El indicador con muesca de mínimo responde a "¿qué falta?" |
| **Bolsillo** | No sobrevive como pantalla, pero **se rescata su control ±** (48px). Es la forma más simple de consumir o añadir sin abrir un formulario |
| **Triaje** | No sobrevive como pantalla, pero **se rescata su idea de jerarquía**: lo que necesita acción ocupa sitio, lo que está bien se pliega |
| **Consola** | **Descartada.** Exige teclado y vocabulario técnico |

Las dos pantallas comparten un único sistema de diseño (colores, tipografía,
componentes). No son dos apps: son dos puertas a los mismos datos.

---

## 2. El punto de partida real

Lo importante: **casi todo el backend ya existe**. Esto es sobre todo trabajo de
interfaz.

Ya implementado y sin UI que lo use:

| Procedimiento | Para qué |
|---|---|
| `inventory.addStock` / `consumeStock` / `adjustStock` / `transferStock` | Mover existencias |
| `inventory.getExpiringItems` / `getExpiredItems` | Pantalla de cocina |
| `shopping.generateFromLowStock` / `getAutoList` | Lista de la compra automática |
| `product.scanBarcode` / `getByBarcode` | Escaneo |
| `product.searchByName` | Búsqueda difusa con pg_trgm |

Lo que falta y bloquea todo (`ISSUES.md` UI-1): cuatro rutas enlazadas que
devuelven 404 — `/products/new`, `/inventory/add`, `/inventory/consume` y
`/settings`. El escáner ya funciona y ya redirige a `/products/new`… que no
existe.

---

## 3. Pantalla A — Móvil, "el día a día"

**Quién y cuándo:** una persona en el supermercado o de camino. De pie, una mano,
prisa, quizá mala cobertura.

**La pregunta que responde:** *¿qué tengo que comprar, y esto que tengo en la
mano es buena compra?*

### Estructura

```
┌─────────────────────────────┐
│  Compra                 ⚙   │   ← una sola pestaña visible al abrir
├─────────────────────────────┤
│  ┌───────────────────────┐  │
│  │   📷  Escanear        │  │   ← acción principal, siempre arriba
│  └───────────────────────┘  │
├─────────────────────────────┤
│  POR COMPRAR            4   │
│  ○ Leche entera      2/6 L  │   ← muesca de mínimo (de Estante)
│    ▓▓▓░░░░│░░░              │
│  ○ Café molido         0    │
│  ○ Aceite de oliva   1/2 L  │
├─────────────────────────────┤
│  YA EN EL CARRO         2   │   ← plegado (de Triaje)
│  ▸ 2 productos marcados     │
└─────────────────────────────┘
```

### Flujos

1. **Marcar comprado** — un toque en la fila. Sin confirmación, con deshacer.
2. **Escanear** → cámara → según el resultado:
   - Producto conocido → ficha con **calificación** + "Añadir al stock" / "Añadir a la lista".
   - Producto nuevo → alta con los datos de Open Food Facts ya rellenos; solo hay que confirmar.
   - Sin conexión o sin datos → se guarda el código y se resuelve luego. **Nunca un callejón sin salida.**
3. **Añadir al stock** — control ± de Bolsillo. Sin formulario.

### Decisiones de diseño

- **Una sola acción principal por pantalla.** Escanear es un botón grande, no un icono en una barra.
- **Sin jerga.** "Por comprar", no "Lista autogenerada de stock bajo".
- **El estado se dice con palabras**, no solo con color: "Quedan 2 de 6".
- **Funciona con una mano:** todo lo pulsable en la mitad inferior.

---

## 4. Pantalla B — Cocina, "en casa"

**Quién y cuándo:** cualquiera de la casa, de paso, mirando desde un metro de
distancia. Una tablet vieja colgada o apoyada. Puede que nadie la toque en días.

**La pregunta que responde:** *¿qué hay que gastar antes de que se estropee?*

### Estructura

```
┌───────────────────────────────────────────────┐
│  Cocina · Hogar Demo              jue 9 ago   │
├───────────────────────────────────────────────┤
│  GASTAR YA                                    │
│  ┌─────────────┐ ┌─────────────┐              │
│  │ Huevos      │ │ Leche       │              │
│  │ 3 días      │ │ 5 días      │   ← tarjetas grandes
│  │ Nevera      │ │ Nevera      │      legibles a 1 m
│  │ [ Gastar ]  │ │ [ Gastar ]  │              │
│  └─────────────┘ └─────────────┘              │
├───────────────────────────────────────────────┤
│  ESTA SEMANA          │  FALTA EN CASA        │
│  · Yogures   9 días   │  · Café       0       │
│  · Pan       2 días   │  · Aceite   1/2 L     │
└───────────────────────────────────────────────┘
```

### Flujos

1. **Gastar** — un botón por tarjeta. Un toque descuenta una unidad
   (`consumeStock`) y la tarjeta se actualiza. Deshacer durante 10 segundos.
2. **Nada más.** No se da de alta, no se edita, no se navega. Lo demás se hace
   desde el móvil.

### Decisiones de diseño

- **Legible a un metro:** cuerpo base 20–24px, títulos 40px+.
- **Sin scroll para lo urgente.** Lo que caduca cabe en pantalla; el resto abajo.
- **Se actualiza sola** (sondeo cada pocos minutos): nadie va a pulsar recargar.
- **Tema oscuro automático de noche** — es una pantalla encendida en una cocina.
- **Sin sesión que caduque.** Ver más abajo: hay que decidirlo.

---

## 5. La calificación de producto

Referencia: Yuka. **No se copia la marca ni el algoritmo**, se calcula uno propio
con datos abiertos y se explica.

### De dónde salen los datos

**Open Food Facts** — y el proyecto **ya tiene el servicio**
(`src/server/services/openFoodFacts.ts`), con caché en memoria y el campo
`Product.openFoodFactsData` en la base de datos para guardarlo.

Lo comprobé contra la API real (código 3017620422003, Nutella):

| Campo | Valor devuelto |
|---|---|
| `nutriscore_grade` | `e` |
| `nova_group` | `4` (ultraprocesado) |
| `additives_n` / `additives_tags` | `2` · `en:e322`, `en:e322i` |
| `nutrient_levels` | grasas alto, sal bajo, azúcares alto |
| `ecoscore_grade` | `unknown` (no siempre está) |
| `labels_tags` | de aquí sale si es ecológico |

**El servicio actual no pide ninguno de estos campos.** Solo trae nombre, marca,
categorías, imagen y macronutrientes. Hay que ampliar la lista `fields` de la
petición y el esquema Zod. Es un cambio pequeño y localizado.

### Fórmula propuesta

Siguiendo la metodología pública de Yuka, con pesos explícitos:

- **60% calidad nutricional** — del `nutriscore_grade` (A→100, E→0)
- **30% aditivos** — penalización por `additives_tags`, ponderada por riesgo
- **10% ecológico** — bonus si `labels_tags` incluye certificación bio

Resultado: 0–100, y una etiqueta en palabras: **Excelente / Bueno / Mediocre /
Malo**. La palabra manda; el color acompaña.

### Honestidad del dato

Esto importa más que la fórmula:

- **Sin datos → no se inventa un número.** "No tenemos información de este
  producto" y un enlace para contribuir a Open Food Facts.
- **No alimentario** (papel higiénico, limpieza) → **no se puntúa**. Se dice "No
  aplica". Open Food Facts no cubre estos productos; existen Open Beauty Facts y
  Open Products Facts si algún día interesa.
- **Siempre se puede ver por qué:** al tocar la nota se despliega qué la baja.
  Una nota sin explicación no ayuda a nadie a decidir.

### Legal

Open Food Facts se publica bajo **ODbL**: se puede usar comercialmente, pero
**hay que atribuir** y compartir las mejoras de la base de datos. Hace falta un
aviso visible de la fuente. La marca Yuka no se menciona en la interfaz.

---

## 6. Facilidad de uso — reglas que se aplican a las dos pantallas

1. **Cada pantalla, una tarea.** Si hay dos acciones principales, son dos pantallas.
2. **Nada de vocabulario de sistema.** "Se ha agotado", no "stock 0". "Guardado",
   no "mutación correcta".
3. **Deshacer en vez de confirmar.** Preguntar "¿seguro?" cansa; deshacer perdona.
4. **Errores que dicen qué hacer.** "No hay cámara disponible. Escribe el código
   a mano" con el campo ya puesto.
5. **Nunca una pantalla vacía y muda.** Vacío = invitación con un botón.
6. **Todo funciona con el dedo.** Objetivos de 48px, sin menús desplegables
   anidados, sin gestos que haya que descubrir.

---

## 7. Accesibilidad

Se mantiene el nivel ya alcanzado en las propuestas: **WCAG AAA de contraste**,
verificado por `pnpm check:contrast` (140 comprobaciones). Se amplía a:

- Objetivos táctiles de 48px (AAA pide 44).
- Estado nunca solo por color: palabra + posición o icono.
- Pantalla de cocina: tamaño base mayor y prueba real a un metro de distancia.
- Foco visible siempre; navegable por teclado (importante para tablets con
  teclado o conmutadores).
- Pendiente y no hecho aún: pasada con axe y prueba con lector de pantalla.

---

## 8. Fases

Cada fase deja la app en un estado usable y verificable.

### Fase 0 — Cerrar las rutas muertas (bloquea todo)
Crear `/products/new`, `/inventory/add`, `/inventory/consume`, `/settings`.
Ahora mismo el escáner ya redirige a una de ellas y da 404.
*Listo cuando:* los cuatro test `test.fixme` de `e2e/critical-paths.spec.ts`
pasan sin `fixme`, y la Jornada 1 de `SMOKE_JOURNEYS.md` se completa.

### Fase 1 — Sistema de diseño único
Fusionar los tokens de Estante y Horizonte en uno solo, llevarlo a `globals.css`
y arreglar de paso el fallo actual: `button.tsx` e `input.tsx` usan trece tokens
que no existen, por eso el botón de login se ve sin estilo.
*Listo cuando:* `check:contrast` sigue en verde y ningún componente usa un token
inexistente.

### Fase 2 — Pantalla móvil
Lista de la compra + marcar comprado + control ± + escanear.
*Listo cuando:* se puede hacer una compra entera desde el móvil sin teclear.

### Fase 3 — Pantalla de cocina
Caducidades + gastar en un toque + datos útiles.
*Listo cuando:* funciona una semana en una tablet sin que nadie la toque salvo
para gastar.

### Fase 4 — Calificación
Ampliar campos de Open Food Facts, calcular la nota, mostrarla en la ficha y tras
escanear.
*Listo cuando:* un producto sin datos y uno no alimentario se comportan bien, no
solo el caso feliz.

### Transversal
Limitación de intentos de login (`ISSUES.md` CRITICAL-4) sigue abierta y es lo
único crítico de seguridad pendiente antes de exponer nada a internet.

---

## 9. Decisiones que hacen falta antes de empezar

1. **¿Cómo se elige la pantalla?** Propongo: al entrar, se pregunta una vez y se
   recuerda por dispositivo, con un cambio en ajustes. Alternativa: rutas
   separadas `/movil` y `/cocina`.
2. **Sesión de la pantalla de cocina.** Una tablet siempre abierta es una sesión
   que nunca caduca, en un dispositivo compartido. Propongo un modo cocina de
   solo lectura + gastar, que no permita ver ajustes ni datos de la cuenta.
   Hay que decidirlo conscientemente.
3. **¿La calificación entra en el MVP** o se deja para después de que las dos
   pantallas estén asentadas? Es la parte más vistosa y la que menos resuelve el
   problema original (saber qué hay en casa).
4. **¿PWA instalable?** Para el móvil cambia bastante la sensación de uso. No
   está hecho y no es trivial.
5. **Offline.** ¿Hasta dónde? En un supermercado con mala cobertura, marcar
   comprado debería funcionar sin red. Eso implica cola local y sincronización.
