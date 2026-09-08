# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tokio Sushi is an order-management system for a sushi restaurant: a customer-facing ordering site, a kitchen operations dashboard, an admin panel, and a stats dashboard, backed by a FastAPI + PostgreSQL API. There is no build system anywhere in this repo — the frontend is plain HTML/CSS/JS loaded via `<script>` tags and CDN links, and the backend is a standard FastAPI app run with uvicorn.

## Repo layout

- **Root** — five independent static pages, each with its own HTML + JS file, plus one shared script (no bundler, no module system — everything is globals loaded via `<script>` tags):
  - `index.html` / `app.js` — kitchen/operations dashboard (order board, status changes, WhatsApp notifications, motorizados/rate management). Requires login (`usuarios` table). Its "Nuevo Pedido" button no longer opens a form here — it navigates to `menu_trabajadores.html`.
  - `menu.html` / `menu.js` — customer-facing ordering flow (client login by phone, catalog browsing, combo customization, cart, checkout).
  - `admin.html` / `admin.js` — admin panel (CRUD for categories/products/combos/announcements, users, motorizados, WhatsApp message templates, business hours).
  - `estadisticas.html` / `estadisticas.js` — analytics/stats dashboard (Chart.js) + client search.
  - `menu_trabajadores.html` / `menu_trabajadores.js` — the register: the same customer menu, laid out for desktop, used by staff to take an order. Requires a staff session (`localStorage.usuarioActivo` + `tokioAuthToken`); redirects to `index.html` without one. **It loads `menu.js` wholesale and then overrides only what differs** — see the architecture note below.
  - `config.js` — **shared** helpers used by several pages: `authHeaders()` (reads the JWT from `localStorage.tokioAuthToken`), `escapeHtml()`, `ocultarSiExiste()`, and `construirHtmlModalPedido()`. It also holds the cross-page feature flag `FUNCION_MOTORIZADOS`. Load it before the page's own JS. New cross-page helpers belong here.
  - `Codigo original funcional` — a legacy single-file (no extension, it's HTML) snapshot of an earlier working version of the ops dashboard, kept as a reference, not wired into the app.
- **`tokio-backend/`** — FastAPI backend.
  - `main.py` — app entrypoint; `Base.metadata.create_all`, then `ejecutar_migraciones(engine)`, CORS from env, mounts all routers.
  - `database.py` — SQLAlchemy engine/session setup, reads `DATABASE_URL` from `.env`.
  - `models.py` — all SQLAlchemy models in one file.
  - `schemas.py` — all Pydantic request/response schemas in one file.
  - `auth.py` — bcrypt PIN hashing + JWT issue/verify, and the `requiere_staff` / `requiere_admin` / `staff_opcional` dependencies.
  - `rate_limit.py` — `limitador(max_intentos, ventana_seg)` dependency factory.
  - `migrations.py` — additive, idempotent schema migrations run on every startup.
  - `plantillas.py` — default WhatsApp message bodies, kept out of the routers so `migrations.py` can seed them into `mensajes_whatsapp` without importing a router. Currently holds `PLANTILLA_AVISO_MOTORIZADOS`.
  - `routers/` — one router per domain, each with its own `/api/<domain>` prefix: `pedidos.py`, `clientes.py`, `menu.py`, `usuarios.py`, `motorizados.py`, `mensajes.py`, `bcv.py`, `horarios.py`, `anuncios.py`.
  - `services/evolution_api.py` — wraps the Evolution API (self-hosted WhatsApp gateway) `sendText` endpoint, and owns phone-number normalization.
  - `services/dolar_api.py` — fetches the official BCV USD/VES rate from `ve.dolarapi.com` (currently unused directly — `bcv.py` inlines the same call).

## Running locally

Backend (from `tokio-backend/`):
```
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```
Requires a `.env` file in `tokio-backend/` with `DATABASE_URL`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `INSTANCE_NAME`, `JWT_SECRET_KEY`, the four `PUSHER_*` vars, and optionally `CORS_ORIGINS`.

Note: `requirements.txt` was saved as UTF-16 and reads as space-interleaved garbage with plain `cat`/`Read` — use `Get-Content -Encoding Unicode` (PowerShell) or `iconv` if you need to inspect/edit it as text, or just append entries via `pip freeze`.

Frontend: no dev server needed — open the HTML files directly or serve the root statically. There is no `npm install`/build step.

There is no automated test suite (frontend or backend) and no linter configured. Before pushing frontend changes, `node --check <file>.js` catches syntax errors; for the backend, `python -c "import ast; ast.parse(open('file.py',encoding='utf-8').read())"`.

## Deployment

- **Repo**: `github.com/Jarlert/Prueba-Tokyo-Workers`. An older copy lives at `github.com/fibraraq/Prueba-Tokyo-Workers` — it is abandoned; don't push there.
- **Frontend**: Vercel, at `https://tokio-sushi-app.vercel.app`. Auto-deploys on push to the production branch. No build step.
- **Backend**: Railway. Root Directory must be `tokio-backend/`. Auto-deploys on push to the connected branch — this webhook has failed silently before (there are two `Forzar redeploy en Railway` commits in the history that exist only to poke it), so after a backend change **verify the deploy actually landed** rather than assuming.
- To check what code is really live without sending a test order, query the deployed schema: `curl -s <backend>/openapi.json` and look for the field/endpoint you just added.
- The backend host lives in **one place**: `const API_BASE` at the top of `config.js`, which every page loads before its own JS. Each file then builds its URLs as `API_BASE + "/api/..."`. Changing hosting means editing that single line (this replaced ~45 copies of the URL). The live host is `prueba-tokyo-workers-production-baac.up.railway.app`; the older `...-76cf...` one is dead and returns 404.

## Architecture notes

**Auth is enforced server-side.** Staff log in via `routers/usuarios.py` (`validar-acceso`), which verifies a bcrypt-hashed PIN and returns a JWT (12h expiry, `HS256`, `JWT_SECRET_KEY`). Every staff/admin endpoint declares `Depends(requiere_staff)` or `Depends(requiere_admin)`; the frontend attaches the token via `authHeaders()` from `config.js`. Two legacy details to know: PINs still stored in plaintext are accepted once and rehashed on next login (`verificar_pin`), and a hardcoded `Bearer TokioSushi_App_2026_X` string still appears in a few older frontend calls — that one is decorative and validates nothing. Customer-facing endpoints (`/api/clientes/verificar`, `/registrar`, `/api/menu`, order creation) are intentionally public, protected only by rate limiting.

**Rate limiting is in-memory and per-process** (`rate_limit.py`) — it does not persist across restarts/deploys and would not be shared if the backend ever scaled to more than one instance. The visitor is identified by `_ip_cliente()`, which prefers `X-Envoy-External-Address` (Railway routes through Envoy). This matters because `request.client.host` is not the visitor and **varies between requests**, which silently disabled the limiter completely in production — 24 requests against a limit of 20 all passed. With the header it now enforces correctly for ordinary clients.

**Known gap, verified by testing: the limiter is bypassable.** Railway forwards `X-Envoy-External-Address` and `X-Forwarded-For` exactly as the caller sends them, without overwriting, so rotating a fake value on each request evades the limit entirely (24/24 passed in that test). Ordinary traffic and casual abuse are covered; a deliberate attacker is not. This matters most for `usuarios.py: validar-acceso`, where the limit is the only brake on brute-forcing staff PINs — the robust fix there is to count attempts **per username** instead of per IP, since an attacker can rotate headers but not the account they are targeting.

**Migrations are additive and idempotent** (`migrations.py`), run on every startup, and never drop or rewrite existing data. Adding a column means adding an `if "col" not in columnas_x:` block there plus the field on the model. Abandoned columns are left orphaned rather than dropped (e.g. `productos.piezas`, removed from the code but still present in production).

**Order pricing is recomputed server-side** (`routers/pedidos.py: crear_pedido`) — it never trusts the client's submitted price, it looks up each cart item by ID in the DB and recalculates the total (falling back to the client-sent price only if the DB row was deleted mid-order). Cart item IDs follow the convention `p_<producto.id>` for products and `c_<combo.id>` for combos; this prefix is parsed via `item.id.split("_")` — if you add new item types, this parsing needs updating everywhere it appears (`pedidos.py`, and the equivalent tagging logic in `app.js`/`menu.js`).

**`Cliente.telefono` is the primary key** — there is no surrogate id, and `Pedido.telefono` joins to it by string equality. Any change to how phone numbers are stored or formatted will orphan existing clients and their order history. Treat the stored format as a migration concern, not a display detail.

**Phone numbers and WhatsApp delivery**: `services/evolution_api.py: enviar_whatsapp` normalizes the number before calling the gateway. Numbers stored with a leading `+` are treated as already-international and are sent as-is (minus the `+`); everything else is treated as Venezuelan legacy format (`0XXXXXXXXXX` → `58XXXXXXXXXX`). Group JIDs (`...@g.us`) bypass normalization entirely. The frontend builds the stored string via `normalizarTelefono()` in `config.js`, and there is no country picker — the customer's own typing decides: a leading `+` means foreign and is stored as `+<dial><national>`; anything else is treated as Venezuelan and stored in the legacy `0XXXXXXXXXX` form, which is what existing rows use. `+58` is deliberately folded back into the legacy form, because storing a Venezuelan customer as `+58…` would create a second account and orphan their history. Nothing is validated for length or per-country format: bad numbers are allowed through, and the cashier fixes them from the DB when the messages don't arrive.

**Realtime updates via Pusher**: order-board changes are pushed on channel `canal-cocina`, event `actualizar-tablero` (and `nuevo_pedido` for new orders), triggered from `routers/pedidos.py` after every mutation. `app.js` and `estadisticas.js` subscribe to this channel to refresh their views. The backend reads Pusher credentials from env vars; the frontend key is public/client-side by design.

**WhatsApp messaging is template-driven**: message bodies live in the `mensajes_whatsapp` table, keyed by event id (`recepcion`, `modificado`, `cobro_zelle`, `cobro_efectivo`, `cobro_pago_movil`, `aprobado`, `final_delivery`, `final_pickup`, `aviso_grupo_delivery`). Routers do placeholder substitution (`[CLIENTE]`, `[PEDIDO]`, `[PEDIDO_DETALLADO]`, `[TOTAL_USD]`, `[TOTAL_BS]`, `[TIEMPO_ESTIMADO]`, `[DIRECCION]`) and fall back to a hardcoded Spanish message if no template row exists. Templates are edited from `admin.js`. **Zelle is no longer offered**: the `<option>` is gone from `menu.html` and `menu_trabajadores.html`, but the `cobro_zelle` template row and the `"zelle" in metodo` branches stay, because historical orders still carry that method.

**The `[PEDIDO]` placeholder is a per-day, per-delivery-type counter, not the DB id.** `contar_numero_diario()` translates a DB id into "nth **delivery** (or nth **pickup**) of that day" — the two kinds keep separate notebooks and both restart at 1 each morning, so the same number can exist twice in one day. The split is decided by `es_entrega_pickup()` (substring `pickup` or `retiro`), and **three places must agree**: that function, `mapaIdsDiarios` in `app.js: renderizarTablero`, and `preprocesarIDsVisuales` in `estadisticas.js`. `obtener_id_diario()` wraps it for the notification endpoints, and customers only ever see that number. It takes its input from an `id_visual` field the *frontend* must send in the notification payload — if a payload omits it (or its schema lacks the field), the placeholder silently renders as an empty string and the customer gets "pedido #" with no number. When adding a notification endpoint, add `id_visual` to its schema **and** to the caller in `app.js`.

**The rider-group message copies the restaurant's handwritten template.** `aviso_grupo_delivery` reproduces, emoji by emoji, the format the group has read for years: `PEDIDO N°`, `NOMBRE`, `DIRECCIÓN`, `REFRESCO`, `BANDEJAS`, `CAJAS DE PIZZA`, `PAGO`, `PRECIO DEL DELIVERY`. Three quirks are deliberate, not bugs:
- **`NOMBRE` holds the phone, not the name** — the last four digits, five spaces, then the full number (`8308     +58 416-3988308`). `formatear_nombre_motorizado()` builds it: a stored `+` means foreign and passes through untouched, an 11-digit `0…` is Venezuelan and becomes `+58 XXX-XXXXXXX`, anything else is shown raw, and a missing phone falls back to the customer's name. It is redundant on purpose.
- **Every line always prints, zeros included** (`REFRESCO: 0`), because a fixed-shape message is faster to scan on a phone than one whose lines come and go.
- **`PAGO` is derived, never typed**: cash → `COBRAR EN EFECTIVO $<total>` plus `- paga con <billete>` when the cashier filled it in; anything else → `YA PAGO (<método>)`.

Placeholders: `[PEDIDO]`, `[NOMBRE]`, `[CLIENTE]`, `[TELEFONO]`, `[DIRECCION]`, `[REFRESCOS]`, `[BANDEJAS]`, `[CAJAS_PIZZA]`, `[PAGO]`, `[PRECIO_DELIVERY]`. The template lives in the DB and is editable from `admin.js`, but `notificar-despacho` **ignores a stored template that lacks `[BANDEJAS]`** and uses `PLANTILLA_AVISO_MOTORIZADOS` instead, so an un-migrated row can never send a half-filled message. A migration installs the new text once (guarded on `[BANDEJAS]`, previous text saved to `aviso_grupo_delivery_anterior`) and never touches it again.

**Packing totals are computed server-side at order creation, not derived from the order text.** Every product and combo carries `bandejas` (default 1) and `cajas_pizza` (default 0), set per item in the admin panel — an item can carry both. `calcular_empaque()` sums them from the cart's `p_`/`c_` ids and stores `total_bandejas` / `total_cajas_pizza` / `total_refrescos` on the `Pedido`; refrescos are counted by category name containing `bebida` or `refresco`. This exists because `pedido_detallado` is a text blob and re-parsing it is lossy. **Editing an order therefore has to send `articulos` explicitly** — `guardarEdicionPedido` in `app.js` does; if the key is absent the backend leaves the stored totals alone rather than zeroing them. For that to work, `abrirModalEditarPedido` recovers a customized combo's id by matching the catalogue name against the part before `" ("` (the cart line reads `Combo Dúo (Rolls: 2x California)`); the match is used **only** for the id — price and line text stay exactly as parsed.

**`precio_delivery` and `paga_con` are captured together**, in the same modal where the cashier quotes the delivery (`pedirPrecioDelivery` in `app.js`, which resolves to `{ precio, pagaCon }`). The modal leads with a one-tap **standard price button** (`PRECIO_DELIVERY_ESTANDAR`, currently $2 — the constant drives both the button label and the value) and keeps a free "otro monto" field below it for the far addresses. The "¿con cuánto paga?" field only appears for cash orders. Both travel to `/actualizar-estado`, which accepts them like any other optional field.

**The prep-time estimate is a phrase, not a number.** The restaurant promises a range, so `pedirTiempoEstimado` resolves the full text the customer will read — `"25 a 30 minutos"`, `"30 a 45 minutos"`, or one built from hours+minutes boxes by `aplicarTiempoPersonalizado` (`"1 hora y 30 minutos"`, `"2 horas"`). `notificar-aprobado` inserts it into `[TIEMPO_ESTIMADO]` verbatim; it only appends "minutos" if a bare number arrives (old payloads), and it strips a `minutos` written straight after the placeholder in the stored template so the message never reads "25 a 30 minutos minutos".

**Rider management is switched off, not deleted.** `FUNCION_MOTORIZADOS` in `config.js` (currently `false`) hides three things: the 🛵 Motorizados tab in the admin panel, the per-order "Pagar a repartidor" button on the board, and the "Nómina de Repartidores" widget in stats. The restaurant does not keep riders on payroll, but the code, the HTML, the `motorizados` table and its endpoints are all intact — flipping the flag to `true` restores everything with no other edit, here or for another client reusing this base. It does **not** touch the WhatsApp rider-group notice, the delivery price, or the packing totals: those are in daily use.

**BCV exchange rate is a single mutable row**, not a history: `TasaManual` holds one record, refreshed once per day from `ve.dolarapi.com` (`routers/bcv.py`) or overwritten manually from the admin/ops UI. Every order snapshots the rate at creation time into `Pedido.tasa_bcv`, so historical orders keep their original rate even if the central rate later changes.

**Images are stored on imgbb but served through a resizing proxy.** `urlImagen(url, ancho)` in `config.js` rewrites every customer-facing image URL through `wsrv.nl`, which resizes and re-encodes to WebP on the fly. This exists because the stored originals are far larger than the boxes they render in (a category thumbnail of 473 KB painted into a 48px square); routing through the proxy cut the catalogue from 7.2 MB to 0.7 MB without re-uploading anything. Every such `<img>` carries `data-original` plus `onerror="imagenConRespaldo(this)"`, which falls back to the raw imgbb URL if the proxy is unreachable — heavy but never broken. Request the width the image actually renders at; the widths in `menu.js` are paired with the upload caps in `ANCHOS_SUBIDA` (`admin.js`), so raising one without the other either wastes bytes or upscales a blurry image. **Do not proxy payment-proof screenshots** — staff need to read the reference number.

**Image uploads** go straight from the browser to imgbb (API key hardcoded client-side) — the backend only ever stores the resulting URL string, never image bytes. `redimensionarImagen()` in `admin.js` caps the dimension and re-encodes to JPEG 80% in a canvas before uploading; the cap comes from `ANCHOS_SUBIDA`, keyed by what the image is for (categories 300px since they only ever show at 48px, products/combos 900px because they open in a lightbox, announcements 1000px for the full-screen popup). Both `app.js` (payment proofs) and `admin.js` (menu images) resize to max 700px and re-encode as JPEG 80% in a canvas before uploading. `menu.html` opens a `preconnect` to `i.ibb.co`, preloads the announcement image at `fetchpriority=high`, and drops category thumbnails to `fetchpriority=low` so the popup image wins the race.

**The register reuses the customer menu instead of duplicating it.** `menu_trabajadores.html` loads `config.js`, then `menu.js` *whole*, then `menu_trabajadores.js`. Because these are classic scripts sharing one global scope, a function re-declared in the third file silently replaces the one from `menu.js` — that is the override mechanism, and it is why load order in the HTML must not change. What gets replaced is listed at the top of `menu_trabajadores.js`: `window.onload`, `window.onpopstate`, `goToStep`, `renderizarCategorias`, `prepareCheckout`, `resetForm`, `sendOrder` and `cargarYMostrarAnuncios` (no-op'd so staff don't get the promo popup). Everything else — the catalogue, the cart, and all of the combo customization — is the customer code running unmodified, so **a combo fix in `menu.js` fixes both screens at once**. Two consequences worth knowing: the combo/detail/variant/pending modals in `menu_trabajadores.html` are copied verbatim from `menu.html` and must be kept in sync if their inner IDs change; and two helpers exist purely so both screens can share them — `construirTarjetaItemHtml(item)` (split out of `selectCategory`, also used by the register's search) and `renderizarResumenCarrito()` (split out of `prepareCheckout`, which now only handles the form below it).

**Nothing may render the same item card twice on one page.** The card markup hardcodes `id="qty-<itemId>"`, so a plain `getElementById` would find the hidden copy and update the wrong stepper. In the register the search results and the category view can both hold cards, so `goToStep(2)` clears the search and the search clears `#items-container`. Any new place that paints item cards has to do the same.

**Staff are not bound by business hours.** `crear_pedido` takes an optional staff token via `auth.staff_opcional` (a non-blocking `requiere_staff`: valid JWT → payload, anything else including the decorative `Bearer TokioSushi_App_2026_X` → `None`). The closed-restaurant 403 now only fires for callers without a staff token, so the register can take a phone order before opening while customers still can't. This is why `menu_trabajadores.js` posts the order with `authHeaders()` and the customer menu does not.

**Manual order lines are admin-only.** The register lets `admin`/`superadmin` add a free-text line with a typed price (the capability the old modal had). Its cart id is `custom_0_<n>`: the backend's `item.id.split("_")` reads type `custom` and db id `0`, finds no product, and falls back to the client-sent price — which is the intent. The typed name is sanitized on entry (apostrophe → `’`, `"<>\` stripped) because `renderizarResumenCarrito` interpolates names into an `onclick` with single quotes.

### Menu domain rules

**Three separate availability flags, easy to confuse:**
- `disponible=false` — not sold on its own, but **still selectable inside combos** (rolls, lumpias that only exist as combo components). `menuData` keeps these; only the browsing views filter them out.
- `agotado=true` — out of stock today; excluded from browsing **and** from combo options. If a combo's *fixed* component is `agotado`, the customer sees an explanatory notice instead of the block.
- `disponible_desde` / `disponible_hasta` (`"HH:MM"`) and `dias_disponibles` (CSV `"0,1,2"`, 0=Monday) — scheduled availability for time-limited promos. Enforced **client-side** in `menu.js` via `obtenerFechaHoraCaracas()`, which pins the comparison to `America/Caracas` regardless of the visitor's device timezone. Ranges that cross midnight are handled.

**Combo groups** live as JSON in `Combo.items_json`, and each group has a `tipo`:
- `producto` — a fixed included item.
- `categoria` — "choose your X" from a category.
- `piezas_alternativas` — **the customer picks whole rolls, never loose pieces.** Each row (a "style") declares `selecciones` (how many rolls the customer picks) and `piezas_por_seleccion` (what each pick is worth); `piezas_objetivo` stays in the JSON as the product of the two and is what the UI shows as the style's size. 12pz of one roll is `selecciones: 1, piezas_por_seleccion: 12`; a 24pz combo built from three rolls is `3 × 8`. The customer taps a card to pick it — no steppers, no piece math. With `selecciones: 1` tapping another card *replaces* the choice; with more, taps accumulate to the cap and the same roll may be picked more than once (three tandas of the same roll is a legitimate order). `elegirSaborPieza` / `quitarSaborPieza` are the only mutators, `subtotalParaAlt` counts **picks, not pieces**, and the group is complete when picks == `selecciones`.
  The `modo` still decides how multiple rows behave:
  - `excluyente` — the customer takes exactly one style (Tempura 12pz **or** Frío 10pz). Switching tabs clears the picks.
  - `todas` — every tab must be filled; finished tabs get a green check and switching tabs preserves picks.
  - `compartido` — **retired twice over.** It let one target be filled by mixing rows; a migration converted those groups to `excluyente`, backing the original JSON up in `combos.items_json_respaldo`. `menu.js` no longer renders it at all — anything still carrying it is treated as `excluyente`.
  A second migration fills `selecciones: 1` / `piezas_por_seleccion: <piezas_objetivo>` into every alternativa that lacks them, which is the literal reading of the rule for combos built before this existed. It needs no backup: deleting the two keys restores the old JSON exactly. It is guarded on `items_json NOT LIKE '%piezas_por_seleccion%'`, so it runs once.
  **A row spanning several categories is how "pick 3 rolls, any kind" is built** — not several rows. `resolverOpcionesCategorias` unions them and tags each option with `categoriaOrigen`; when a row covers 2+ categories that actually have stock, `renderSaboresPiezas` can paint a chip row (`Todos` + one per category, each showing how many picks were made inside it) that only filters what is visible — **switched off** by `const PESTANAS_CATEGORIA_COMBO = false` above `categoriasConSabores`, because the chips read as a restriction to the average customer; with it off they get one long list of every roll. Flip the flag to bring them back, nothing else changes. The pick budget belongs to the **row**, so the customer can spend it across categories. Several *rows* remain what they always were: mutually exclusive (or all-mandatory) offers, each with its own budget.
  The cart line spells out the pieces for the kitchen: `Tempura: Tiger roll (12pz)` for a single pick, `Variado: 2x Tiger roll (8pz c/u), 1x Sensei roll (8pz c/u)` for several.

**Pack pricing is per product, applied in three places that must agree.** `Producto.precio_paquete` / `cantidad_paquete` express "cheaper by the several" — lumpias are $0.60 loose but $1.50 the pair, so `cantidad_paquete: 2, precio_paquete: 1.50`. The line price is `floor(n/size)*pack + (n mod size)*unit`, so 5 lumpias are 2 pairs plus 1 loose. Both `0`/`NULL` (the default for every existing product) means the item is charged per unit exactly as before, so nothing changes for anything that does not opt in. The same arithmetic lives in `precio_de_linea()` (`routers/pedidos.py`, the authoritative one — it recomputes the total at order creation), `precioLinea()` (`menu.js`, so the customer sees the same number before sending, and it only ever applies to `p_` ids — combos, promo gifts and the cashier's manual lines are excluded), and `precioLineaEdicion()` (`app.js`, because the order-edit modal prices client-side and sends its own `total_orden`). Change the rule in one and you must change it in all three. When a pack applies, the order line records the **line total** rather than the unit price, since the unit price no longer explains the bill.

**Quantity-based promos**: `Combo.promo_cantidad_minima` / `promo_producto_id` / `promo_producto_cantidad`. The cart auto-inserts a $0, non-editable gift line that scales every N combos. It travels to the backend as an ordinary product line, so the server-side price recalculation needs no special case.

**Combo quantity is decoupled from customization.** Bumping the stepper (or typing a number) on a combo-with-options no longer opens the modal immediately — it only reserves a count in `pendientesPersonalizarCombo[comboId]` (menu.js), shown as a "🎨 Personalizar (N pendientes)" button on the item card. The customer decides when to actually walk through the piece/style pickers, one unit at a time, from that button or from the cart. `qty-<id>` always displays `totalDeseadoParaId()` = already-customized cart qty + pending, and **both totals (sticky bar and checkout) count pending combos** — for the customer they are already ordered, they just aren't configured yet. Decreasing the number consumes pending first (nothing to ask, those units don't exist as cart lines yet); only once pending hits 0 does reducing further fall back to removing real cart lines (via the multi-variant picker if there's more than one distinct customization).

**Pending combos are visible and removable from the cart; the block is at send time, not at cart entry.** `irACheckout()` used to refuse to open the checkout while any combo was unconfigured, which trapped the customer: they could not see their cart, and the only way to drop a combo they no longer wanted was to find it again in the menu and decrement it. Now the checkout always opens, `renderizarResumenCarrito()` paints a distinct amber row per pending combo (quantity steppers, ❌ to drop all its units via `eliminarPendientesCombo`, and a "Personalizar ahora" button), and the refusal lives in `sendOrder` (customer) and `enviarPedidoTrabajador` (register) — both call `idsCombosPendientes()` **before** the empty-cart check, since a pedido holding only pending combos is not empty. Anything that mutates `pendientesPersonalizarCombo` must repaint the checkout when step 3 is active, the way `ajustarPendientesCombo` and `eliminarPendientesCombo` do.

**Announcements** (`routers/anuncios.py`, `Anuncio` model): full-screen popups shown when the customer opens the menu, dismissible before ordering, several supported in `orden` sequence. `producto_ref` (`"p_<id>"` / `"c_<id>"`) optionally wires an "Ordenar esta promoción" button that jumps to the item and opens its combo customizer. **This jump is currently switched off** by `const ANUNCIOS_LLEVAN_AL_PRODUCTO = false` at the top of the announcements section in `menu.js`: neither tapping the photo nor the button navigates, and the button stays hidden. All the logic is still there — flip the flag to `true` to bring it back, nothing else needs changing. `anuncioLlevaAlProducto(anuncio)` is the single predicate the popup consults.

## Code map

The four JS files are large (menu.js ~1900 lines, app.js ~1500, admin.js ~1250) and have no module structure, so finding things means grepping. This index exists so you don't re-derive it every session — function names are stable, line numbers are not. There are also two project subagents in `.claude/agents/`: `tokio-buscador` (cheap locator, returns file:line pointers) and `tokio-revisor` (diff review against the invariants below).

**`menu.js` — customer ordering flow**
- Session/steps: `goToStep`, `procesarVerificacionTelefono`, `procesarRegistroCliente`, `cerrarSesionCliente`, `mostrarIconosHeaderSesion`
- Catalogue render: `cargarMenuDesdeDB`, `renderizarCategorias`, `selectCategory` (item cards), `abrirDetalleProducto`
- Cart: `updateQty`, `setExactQty`, `removeCartItem`, `toggleNoteField`, `updateItemNote`, `calculateTotals`, `sincronizarPromocionesCarrito`
- Combo customization: `abrirModalCombo` (builds the modal), `guardarSeleccionCombo` (writes the cart line + variant key), `cerrarModalCombo`, `pintarProgresoLoteCombo`
- Roll picker (`piezas_alternativas`): `renderSaboresPiezas`, `seleccionarEstiloPiezas`, `elegirSaborPieza`, `quitarSaborPieza`, `instruccionParaAlt`, `calcularPiezasSeleccionadas`, `subtotalParaAlt`, `grupoPiezasCompleto`, `todosLosGruposPiezasCompletos`, `resolverOpcionesCategoria(s)`
- Pending-vs-customized combos: `ajustarPendientesCombo`, `personalizarPendientesCombo`, `totalDeseadoParaId`, `actualizarUiPendienteCombo`, `abrirModalCombosPendientes`
- Variant removal picker: `abrirSelectorEliminarVariantes`, `quitarUnaUnidadVariante`, `eliminarVarianteCompleta`
- Checkout: `irACheckout` (no longer blocks), `prepareCheckout`, `renderizarResumenCarrito`, `idsCombosPendientes`, `eliminarPendientesCombo`, `sendOrder` (blocks on pending combos), `cargarSelectorDirecciones`
- Schedule/hours: `obtenerFechaHoraCaracas`, `horaEnRango`, `estaAbiertoAhora`, `itemDentroDeHorarioProgramado`
- Announcements: `precargarAnuncios`, `mostrarAnuncioEnIndice`, `irAItemDeAnuncio`
- Profile: `abrirModalEditarDatos`, `guardarTelefonoCliente`, `guardarEdicionDatos`, `renderizarDireccionesExtra`

**`app.js` — kitchen/ops dashboard**
- Board: `cargarPedidos`, `renderizarTablero` (the four columns), `abrirModalDetalle`, `esPedidoDeLaFecha`, `normalizarEstado`
- New order at the register: gone from here — the button calls `irAMenuTrabajadores`, which navigates to `menu_trabajadores.html`. `cargarCatalogoDesdeDB`/`CATALOGO_PRODUCTOS` stayed because the *edit order* modal still uses them.
- Edit order: `abrirModalEditarPedido` (parses `pedido_detallado` back), `renderizarCarritoEdicion`, `guardarEdicionPedido`
- State transitions + WhatsApp: `procesarPasoCocina`, `procesarPasoFinalizado`, `ejecutarActualizacion`, `pedirTiempoEstimado`, `pedirComprobantePago`, `cancelarPedido`
- Delivery/riders: `pedirPrecioDelivery`, `procesarPrecioDelivery`, `abrirModalRepartidor`, `guardarRepartidor` (the last two are unreachable while `FUNCION_MOTORIZADOS` is `false`)
- Session/roles: `verificarSesion`, `iniciarSesion`, `aplicarRestriccionesRol`

**`admin.js` — admin panel**
- Combo builder: `agregarFilaProductoCombo`, `agregarGrupoPiezasAlternativas`, `agregarFilaAlternativaPiezas`, `sincronizarModoPiezas`, `toggleChipCategoria`, `buscarItemCombo`, `editarCombo`, `resetFormCombo`
- Products/categories: `renderListaProductos`, `editarProducto`, `renderListaCategorias`, `editarCategoria`, the `filtrar*Admin` search boxes
- Images: `redimensionarImagen`, `manejarSeleccionImagen` (uploads straight to imgbb)
- Announcements: `cargarAnuncios`, `editarAnuncio`, `buscarItemAnuncio`
- Scheduling chips: `construirChipsDias`, `leerDiasSeleccionados`, `parsearDiasDisponibles`
- Users/riders/hours/templates: `cargarUsuariosDesdeDB`, `cargarMotorizadosDesdeDB`, `cargarHorarios`, `guardarHorarios`, `cargarMensajesWP`

**`menu_trabajadores.js` — the register** (thin layer over `menu.js`; see the reuse note above)
- Overrides of `menu.js`: `window.onload` (staff session + no announcements), `goToStep`, `renderizarCategorias` (desktop 4-per-row tiles), `prepareCheckout`, `resetForm`, `sendOrder`, `cargarYMostrarAnuncios`
- Search: `buscarEnMenuTrabajador`, `limpiarBusqueda`, `ocultarResultadosBusqueda`
- Customer lookup: `buscarClienteTrabajador`, `_estadoClienteTrab`, `_limpiarEstadoClienteTrab`
- Order: `enviarPedidoTrabajador`, `reiniciarPedidoTrabajador`, `agregarLineaManual` (admin only), `esAdminTrabajador`, `volverAlTablero`

**`estadisticas.js` — stats + client search**
- `aplicarFiltroEstadisticas`, `procesarCalculosEstadisticos` (parses `pedido_detallado`), `dibujarWidgetsEstadisticas`, `buscarClientes`, `exportarCSV`, `abrirModalDetalle`

## Known issues

- **`esta_abierto_ahora()` in `routers/horarios.py` uses a naked `datetime.now()`**, i.e. the server's local time, while the frontend's scheduled-availability check explicitly uses `America/Caracas`. On a UTC host this shifts the ordering window ~4 hours earlier than intended. Verify `TZ=America/Caracas` is set on Railway, or switch the function to an explicit zone.
- `services/evolution_api.py: enviar_whatsapp` contains a second, unreachable `async with httpx.AsyncClient(timeout=15.0)` block after the function already returns — dead code, and the timeout it was meant to add never applies.
