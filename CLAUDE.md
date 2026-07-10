# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tokio Sushi is an order-management system for a sushi restaurant: a customer-facing ordering site, a kitchen operations dashboard, an admin panel, and a stats dashboard, backed by a FastAPI + PostgreSQL API. There is no build system anywhere in this repo — the frontend is plain HTML/CSS/JS loaded via `<script>` tags and CDN links, and the backend is a standard FastAPI app run with uvicorn.

## Repo layout

- **Root** — four independent static pages, each with its own HTML + JS file, no shared module system (globals + `<script>` tags, no bundler):
  - `index.html` / `app.js` — kitchen/operations dashboard (order board, status changes, WhatsApp notifications, motorizados/rate management). Requires login (`usuarios` table).
  - `menu.html` / `menu.js` — customer-facing ordering flow (catalog browsing, cart, checkout, client registration).
  - `admin.html` / `admin.js` — admin panel (CRUD for categories/products/combos, users, motorizados, WhatsApp message templates).
  - `estadisticas.html` / `estadisticas.js` — analytics/stats dashboard (Chart.js).
  - `Codigo original funcional` — a legacy single-file (no extension, it's HTML) snapshot of an earlier working version of the ops dashboard, kept as a reference, not wired into the app.
- **`tokio-backend/`** — FastAPI backend.
  - `main.py` — app entrypoint; creates tables via `Base.metadata.create_all`, registers CORS (currently `allow_origins=["*"]`), mounts all routers.
  - `database.py` — SQLAlchemy engine/session setup, reads `DATABASE_URL` from `.env`.
  - `models.py` — all SQLAlchemy models in one file (`Pedido`, `Cliente`, `Categoria`, `Producto`, `Combo`, `Motorizado`, `Usuario`, `MensajeWhatsapp`, `TasaManual`).
  - `schemas.py` — all Pydantic request/response schemas in one file.
  - `routers/` — one router per domain, each with its own `/api/<domain>` prefix: `pedidos.py`, `clientes.py`, `menu.py`, `usuarios.py`, `motorizados.py`, `mensajes.py`, `bcv.py`.
  - `services/evolution_api.py` — wraps the Evolution API (self-hosted WhatsApp gateway) `sendText` endpoint.
  - `services/dolar_api.py` — fetches the official BCV USD/VES rate from `ve.dolarapi.com` (currently unused directly — `bcv.py` inlines the same call).

## Running locally

Backend (from `tokio-backend/`):
```
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```
Requires a `.env` file in `tokio-backend/` with `DATABASE_URL`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `INSTANCE_NAME`. `DATABASE_URL` points at a Postgres instance (Railway in production); tables are created automatically on startup, there are no Alembic migrations.

Note: `requirements.txt` was saved as UTF-16 and reads as space-interleaved garbage with plain `cat`/`Read` — use `Get-Content -Encoding Unicode` (PowerShell) or `iconv` if you need to inspect/edit it as text, or just append entries via `pip freeze`.

Frontend: no dev server needed — open the HTML files directly or serve the root statically. There is no `npm install`/build step.

There is no automated test suite (frontend or backend) and no linter configured.

## Architecture notes

**Deployment split**: static frontend pages (deployed separately, e.g. GitHub Pages) call a backend deployed on Railway. All frontend API base URLs are **hardcoded absolute URLs** to `https://prueba-tokyo-workers-production.up.railway.app` at the top of each JS file (`app.js`, `admin.js`, `menu.js`, `estadisticas.js`) — there's no env-based config, so changing backend environments means editing every JS file.

**Auth is not actually enforced server-side.** The frontend sends `Authorization: Bearer TokioSushi_App_2026_X` (a hardcoded static string in `app.js`) or `Bearer ${adminToken}` (in `admin.js`) on write requests, but no FastAPI dependency validates these headers anywhere in `routers/`. Real access control is just the login check in `routers/usuarios.py` (`validar-acceso`, plaintext PIN comparison against the `usuarios` table) gating the SPA's client-side view state. Don't assume the Bearer header provides any actual protection when reasoning about security.

**Realtime updates via Pusher**: order-board changes are pushed on channel `canal-cocina`, event `actualizar-tablero` (and `nuevo_pedido` for new orders), triggered from `routers/pedidos.py` after every mutation. `app.js` and `estadisticas.js` subscribe to this channel to refresh their views. Pusher app credentials are hardcoded in both the backend (`routers/pedidos.py`) and frontend (`app.js`, `estadisticas.js`) — this is a public/client key intentionally, not a secret.

**Order pricing is recomputed server-side** (`routers/pedidos.py: crear_pedido`) — it never trusts the client's submitted price, it looks up each cart item by ID in the DB and recalculates the total (falling back to the client-sent price only if the DB row was deleted mid-order). Cart item IDs follow the convention `p_<producto.id>` for products and `c_<combo.id>` for combos; this prefix is parsed via `item.id.split("_")` — if you add new item types, this parsing needs updating everywhere it appears (`pedidos.py`, and the equivalent tagging logic in `app.js`/`menu.js`).

**WhatsApp messaging is template-driven**: message bodies live in the `mensajes_whatsapp` table (`MensajeWhatsapp` model), keyed by event id (`recepcion`, `modificado`, `cobro_zelle`, `cobro_efectivo`, `cobro_pago_movil`, `aprobado`, `final_delivery`, `final_pickup`, `aviso_grupo_delivery`). Routers do placeholder substitution (`[CLIENTE]`, `[PEDIDO]`, `[PEDIDO_DETALLADO]`, `[TOTAL_USD]`, `[TOTAL_BS]`, `[TIEMPO_ESTIMADO]`, `[DIRECCION]`) and fall back to a hardcoded Spanish message if no template row exists. Templates are edited via `admin.js`'s message panel, calling `/api/mensajes/guardar`. Every notification endpoint in `pedidos.py` also computes a per-day "visual" order ID (`obtener_id_diario` / `pedidos_de_hoy` count) distinct from the DB primary key — the DB id is never shown to customers/motorizados, only this daily counter is.

**BCV exchange rate is a single mutable row**, not a history: `TasaManual` holds one record, refreshed once per day from `ve.dolarapi.com` (`routers/bcv.py`) or overwritten manually from the admin/ops UI. Every order snapshots the rate at creation time into `Pedido.tasa_bcv`, so historical orders keep their original rate even if the central rate later changes.

**Image uploads** (payment proof screenshots, menu item images) go straight from the browser to imgbb (API key hardcoded client-side in `app.js`) — the backend only ever stores the resulting imgbb URL string, it never receives image bytes.
