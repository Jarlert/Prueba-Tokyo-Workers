# Manual de Tokio Sushi

`manual.html` es la fuente del PDF que se le entrega al personal.
Es un solo archivo: el texto, los estilos y los dibujos (SVG) van todos
dentro. No usa internet ni ninguna librería, así que se abre en cualquier
navegador tal cual.

## Para ver los cambios mientras se edita

Abrir `manual.html` con doble clic. Se ve igual que el PDF, salvo los
márgenes de página.

## Para volver a generar el PDF

Desde la raíz del repo, en PowerShell:

```
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="Manual Tokio Sushi.pdf" "file:///C:/Users/Admin/Documents/GitHub/Prueba-Tokyo-Workers/manual/manual.html"
```

Sirve igual `msedge.exe` si no está Chrome.

## Cómo está armado

- Cada `<h2>` empieza en página nueva (`page-break-before` en el CSS).
- Los `.caja`, las tablas y las `figure` no se parten a la mitad.
- Las clases de aviso son `ojo` (amarillo), `truco` (verde),
  `peligro` (rojo) y `nota` (azul).
- `.btn` pinta el nombre de un botón real de la aplicación;
  `.campo` pinta algo que el usuario tiene que escribir.
- Los dibujos son SVG escritos a mano, no capturas. Si una pantalla
  cambia, hay que retocar el SVG correspondiente.

## Las capturas de pantalla

Están en `manual/img/` — son 31, numeradas en el orden en que aparecen.
Las 01–16 recorren el tablero y la caja; las 17–29 son el panel de
administración, pestaña por pestaña.

**Son fotos de la aplicación real en producción, pero con pedidos
inventados**: nunca se publica un dato de cliente de verdad, porque el manual
se imprime y circula. En el panel admin se abrieron formularios existentes
para fotografiarlos, **sin guardar nada**.

Se toman con Chrome en modo headless hablándole por su protocolo de depuración
(CDP), sin instalar ninguna librería — Node 22+ ya trae `WebSocket`. Los scripts
quedaron en el scratchpad de la sesión; si hay que rehacerlos, el procedimiento es:

1. Pedirle un token al backend con `POST /api/usuarios/validar-acceso`.
2. Lanzar Chrome con `--headless=new --remote-debugging-port=9222 --user-data-dir=<temporal>`.
3. Conectarse a `http://127.0.0.1:9222/json/list`, abrir el WebSocket de la
   pestaña y usar `Page.navigate`, `Runtime.evaluate` y `Page.captureScreenshot`.
4. Poner la sesión con `localStorage.setItem('tokioAuthToken', …)` y
   `localStorage.setItem('usuarioActivo', …)` **antes** de navegar a la página.
5. Para el tablero: pisar `window.cargarPedidos` con una función vacía, asignar
   `pedidosEnMemoria` con pedidos falsos y llamar a `renderizarTablero()`.

Detalles que costaron tiempo y conviene no volver a descubrir:

- `switchTab()` del admin lee `event.currentTarget`, así que **no** se puede
  llamar directamente: hay que pulsar el botón (`btn.click()`).
- El panel admin tiene su **propia** puerta (`desbloquearAdmin()`), aparte del
  login del tablero.
- El recorte de `Page.captureScreenshot` va en coordenadas de la **página**, no
  de la ventana: hay que sumarle `window.scrollX/scrollY` al `getBoundingClientRect()`.
- Las capturas se pasan a JPEG con el canvas del propio Chrome. Conviene
  rematarlas a 1250 px de ancho y calidad 0,75: a 300 dpi eso ya sobra para
  una figura impresa, y ahorra la mitad del peso.
- Para fotografiar una pestaña entera del admin (Mensajes WP, por ejemplo) hay
  que recortar al elemento **con `captureBeyondViewport: true`**; si no, se
  corta en el borde de la ventana.
- El panel admin **no muestra la pestaña 🛵 Motorizados**: está apagada por la
  bandera `FUNCION_MOTORIZADOS` de `config.js`. Son siete pestañas, no ocho.

Los circulitos rojos numerados **no** están quemados en la imagen: se ponen
encima con CSS (`.captura .marca`, posicionados en porcentajes), así que se
mueven editando el HTML, sin volver a capturar.
