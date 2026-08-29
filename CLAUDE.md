# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tokio Sushi is an order-management system for a sushi restaurant: a customer-facing ordering site, a kitchen operations dashboard, an admin panel, and a stats dashboard, backed by a FastAPI + PostgreSQL API. There is no build system anywhere in this repo — the frontend is plain HTML/CSS/JS loaded via `<script>` tags and CDN links, and the backend is a standard FastAPI app run with uvicorn.

## Repo layout

- **Root** — four independent static pages, each with its own HTML + JS file, plus one shared script (no bundler, no module system — everything is globals loaded via `<script>` tags):
  - `index.html` / `app.js` — kitchen/operations dashboard (order board, status changes, WhatsApp notifications, motorizados/rate management). Requires login (`usuarios` table).
  - `menu.html` / `menu.js` — customer-facing ordering flow (client login by phone, catalog browsing, combo customization, cart, checkout).
  - `admin.html` / `admin.js` — admin panel (CRUD for categories/products/combos/announcements, users, motorizados, WhatsApp message templates, business hours).
  - `estadisticas.html` / `estadisticas.js` — analytics/stats dashboard (Chart.js) + client search.
  - `config.js` — **shared** helpers used by several pages: `authHeaders()` (reads the JWT from `localStorage.tokioAuthToken`), `escapeHtml()`, and `construirHtmlModalPedido()`. Load it before the page's own JS. New cross-page helpers belong here.
  - `Codigo original funcional` — a legacy single-file (no extension, it's HTML) snapshot of an earlier working version of the ops dashboard, kept as a reference, not wired into the app.
- **`tokio-backend/`** — FastAPI backend.
  - `main.py` — app entrypoint; `Base.metadata.create_all`, then `ejecutar_migraciones(engine)`, CORS from env, mounts all routers.
  - `database.py` — SQLAlchemy engine/session setup, reads `DATABASE_URL` from `.env`.
  - `models.py` — all SQLAlchemy models in one file.
  - `schemas.py` — all Pydantic request/response schemas in one file.
  - `auth.py` — bcrypt PIN hashing + JWT issue/verify, and the `requiere_staff` / `requiere_admin` dependencies.
  - `rate_limit.py` — `limitador(max_intentos, ventana_seg)` dependency factory.
  - `migrations.py` — additive, idempotent schema migrations run on every startup.
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
- All frontend API base URLs are **hardcoded absolute URLs** to the Railway host, repeated in every JS file (~38 occurrences). There's no env-based config, so changing backend environments means editing every JS file.

## Architecture notes

**Auth is enforced server-side.** Staff log in via `routers/usuarios.py` (`validar-acceso`), which verifies a bcrypt-hashed PIN and returns a JWT (12h expiry, `HS256`, `JWT_SECRET_KEY`). Every staff/admin endpoint declares `Depends(requiere_staff)` or `Depends(requiere_admin)`; the frontend attaches the token via `authHeaders()` from `config.js`. Two legacy details to know: PINs still stored in plaintext are accepted once and rehashed on next login (`verificar_pin`), and a hardcoded `Bearer TokioSushi_App_2026_X` string still appears in a few older frontend calls — that one is decorative and validates nothing. Customer-facing endpoints (`/api/clientes/verificar`, `/registrar`, `/api/menu`, order creation) are intentionally public, protected only by rate limiting.

**Rate limiting is in-memory and per-process** (`rate_limit.py`) — it does not persist across restarts/deploys and would not be shared if the backend ever scaled to more than one instance.

**Migrations are additive and idempotent** (`migrations.py`), run on every startup, and never drop or rewrite existing data. Adding a column means adding an `if "col" not in columnas_x:` block there plus the field on the model. Abandoned columns are left orphaned rather than dropped (e.g. `productos.piezas`, removed from the code but still present in production).

**Order pricing is recomputed server-side** (`routers/pedidos.py: crear_pedido`) — it never trusts the client's submitted price, it looks up each cart item by ID in the DB and recalculates the total (falling back to the client-sent price only if the DB row was deleted mid-order). Cart item IDs follow the convention `p_<producto.id>` for products and `c_<combo.id>` for combos; this prefix is parsed via `item.id.split("_")` — if you add new item types, this parsing needs updating everywhere it appears (`pedidos.py`, and the equivalent tagging logic in `app.js`/`menu.js`).

**`Cliente.telefono` is the primary key** — there is no surrogate id, and `Pedido.telefono` joins to it by string equality. Any change to how phone numbers are stored or formatted will orphan existing clients and their order history. Treat the stored format as a migration concern, not a display detail.

**Phone numbers and WhatsApp delivery**: `services/evolution_api.py: enviar_whatsapp` normalizes the number before calling the gateway. Numbers stored with a leading `+` are treated as already-international and are sent as-is (minus the `+`); everything else is treated as Venezuelan legacy format (`0XXXXXXXXXX` → `58XXXXXXXXXX`). Group JIDs (`...@g.us`) bypass normalization entirely. The frontend builds the stored string via `normalizarTelefono()` in `config.js`: Venezuela stays in the legacy `0XXXXXXXXXX` form for backward compatibility with existing rows, every other country is stored as `+<dial><national>`.

**Realtime updates via Pusher**: order-board changes are pushed on channel `canal-cocina`, event `actualizar-tablero` (and `nuevo_pedido` for new orders), triggered from `routers/pedidos.py` after every mutation. `app.js` and `estadisticas.js` subscribe to this channel to refresh their views. The backend reads Pusher credentials from env vars; the frontend key is public/client-side by design.

**WhatsApp messaging is template-driven**: message bodies live in the `mensajes_whatsapp` table, keyed by event id (`recepcion`, `modificado`, `cobro_zelle`, `cobro_efectivo`, `cobro_pago_movil`, `aprobado`, `final_delivery`, `final_pickup`, `aviso_grupo_delivery`). Routers do placeholder substitution (`[CLIENTE]`, `[PEDIDO]`, `[PEDIDO_DETALLADO]`, `[TOTAL_USD]`, `[TOTAL_BS]`, `[TIEMPO_ESTIMADO]`, `[DIRECCION]`) and fall back to a hardcoded Spanish message if no template row exists. Templates are edited from `admin.js`.

**The `[PEDIDO]` placeholder is a per-day counter, not the DB id.** `obtener_id_diario()` translates a DB id into "nth order of that day", and customers only ever see that number. It takes its input from an `id_visual` field the *frontend* must send in the notification payload — if a payload omits it (or its schema lacks the field), the placeholder silently renders as an empty string and the customer gets "pedido #" with no number. When adding a notification endpoint, add `id_visual` to its schema **and** to the caller in `app.js`.

**BCV exchange rate is a single mutable row**, not a history: `TasaManual` holds one record, refreshed once per day from `ve.dolarapi.com` (`routers/bcv.py`) or overwritten manually from the admin/ops UI. Every order snapshots the rate at creation time into `Pedido.tasa_bcv`, so historical orders keep their original rate even if the central rate later changes.

**Image uploads** go straight from the browser to imgbb (API key hardcoded client-side) — the backend only ever stores the resulting URL string, never image bytes. Both `app.js` (payment proofs) and `admin.js` (menu images) resize to max 700px and re-encode as JPEG 80% in a canvas before uploading. `menu.html` opens a `preconnect` to `i.ibb.co`, preloads the announcement image at `fetchpriority=high`, and drops category thumbnails to `fetchpriority=low` so the popup image wins the race.

### Menu domain rules

**Three separate availability flags, easy to confuse:**
- `disponible=false` — not sold on its own, but **still selectable inside combos** (rolls, lumpias that only exist as combo components). `menuData` keeps these; only the browsing views filter them out.
- `agotado=true` — out of stock today; excluded from browsing **and** from combo options. If a combo's *fixed* component is `agotado`, the customer sees an explanatory notice instead of the block.
- `disponible_desde` / `disponible_hasta` (`"HH:MM"`) and `dias_disponibles` (CSV `"0,1,2"`, 0=Monday) — scheduled availability for time-limited promos. Enforced **client-side** in `menu.js` via `obtenerFechaHoraCaracas()`, which pins the comparison to `America/Caracas` regardless of the visitor's device timezone. Ranges that cross midnight are handled.

**Combo groups** live as JSON in `Combo.items_json`, and each group has a `tipo`:
- `producto` — a fixed included item.
- `categoria` — "choose your X" from a category.
- `piezas_alternativas` — the piece-counting builder, with a `modo` that changes everything:
  - `excluyente` — pick exactly one style, each with its own target (Tempura 12pz **or** Frío 10pz).
  - `compartido` — rows act as navigation tabs toward a single shared target (Combo Mega, 76pz).
  - `todas` — every tab has its own target and all must be completed; finished tabs get a green check.
  Legacy combos may still carry `compartido: true` instead of `modo`; `menu.js` falls back accordingly.

**Quantity-based promos**: `Combo.promo_cantidad_minima` / `promo_producto_id` / `promo_producto_cantidad`. The cart auto-inserts a $0, non-editable gift line that scales every N combos. It travels to the backend as an ordinary product line, so the server-side price recalculation needs no special case.

**Announcements** (`routers/anuncios.py`, `Anuncio` model): full-screen popups shown when the customer opens the menu, dismissible before ordering, several supported in `orden` sequence. `producto_ref` (`"p_<id>"` / `"c_<id>"`) optionally wires a "Pedir ahora" button that jumps to the item and opens its combo customizer.

## Known issues

- **`esta_abierto_ahora()` in `routers/horarios.py` uses a naked `datetime.now()`**, i.e. the server's local time, while the frontend's scheduled-availability check explicitly uses `America/Caracas`. On a UTC host this shifts the ordering window ~4 hours earlier than intended. Verify `TZ=America/Caracas` is set on Railway, or switch the function to an explicit zone.
- `services/evolution_api.py: enviar_whatsapp` contains a second, unreachable `async with httpx.AsyncClient(timeout=15.0)` block after the function already returns — dead code, and the timeout it was meant to add never applies.
