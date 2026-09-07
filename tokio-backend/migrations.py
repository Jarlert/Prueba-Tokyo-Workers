import json

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from plantillas import PLANTILLA_AVISO_MOTORIZADOS


def ejecutar_migraciones(engine: Engine):
    """Migraciones aditivas e idempotentes: solo agregan columnas/índices que
    falten y rellenan datos derivados, nunca tocan ni borran datos existentes.
    Se corren en cada arranque; después de la primera vez son no-ops baratos.
    """
    inspector = inspect(engine)
    columnas_pedidos = [c["name"] for c in inspector.get_columns("pedidos")]
    columnas_productos = [c["name"] for c in inspector.get_columns("productos")]
    columnas_combos = [c["name"] for c in inspector.get_columns("combos")]

    with engine.begin() as conn:
        if "fecha" not in columnas_pedidos:
            print("[migracion] Agregando columna 'fecha' a pedidos...")
            conn.execute(text("ALTER TABLE pedidos ADD COLUMN fecha DATE"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pedidos_fecha ON pedidos (fecha)"))

        if "agotado" not in columnas_productos:
            print("[migracion] Agregando columna 'agotado' a productos...")
            conn.execute(text("ALTER TABLE productos ADD COLUMN agotado BOOLEAN DEFAULT FALSE"))

        if "promo_cantidad_minima" not in columnas_combos:
            print("[migracion] Agregando columnas de promoción por cantidad a combos...")
            conn.execute(text("ALTER TABLE combos ADD COLUMN promo_cantidad_minima INTEGER"))
            conn.execute(text("ALTER TABLE combos ADD COLUMN promo_producto_id INTEGER"))
            conn.execute(text("ALTER TABLE combos ADD COLUMN promo_producto_cantidad INTEGER"))

        if "categoria" not in columnas_combos:
            print("[migracion] Agregando columna 'categoria' a combos...")
            conn.execute(text("ALTER TABLE combos ADD COLUMN categoria VARCHAR"))

        if "disponible_desde" not in columnas_productos:
            print("[migracion] Agregando columnas de disponibilidad programada a productos...")
            conn.execute(text("ALTER TABLE productos ADD COLUMN disponible_desde VARCHAR"))
            conn.execute(text("ALTER TABLE productos ADD COLUMN disponible_hasta VARCHAR"))
            conn.execute(text("ALTER TABLE productos ADD COLUMN dias_disponibles VARCHAR"))

        if "disponible_desde" not in columnas_combos:
            print("[migracion] Agregando columnas de disponibilidad programada a combos...")
            conn.execute(text("ALTER TABLE combos ADD COLUMN disponible_desde VARCHAR"))
            conn.execute(text("ALTER TABLE combos ADD COLUMN disponible_hasta VARCHAR"))
            conn.execute(text("ALTER TABLE combos ADD COLUMN dias_disponibles VARCHAR"))

        columnas_anuncios = [c["name"] for c in inspector.get_columns("anuncios")]
        if "producto_ref" not in columnas_anuncios:
            print("[migracion] Agregando columna 'producto_ref' a anuncios...")
            conn.execute(text("ALTER TABLE anuncios ADD COLUMN producto_ref VARCHAR"))

        # 'clientes.email' se dejó de pedir en el registro; la columna queda huérfana en
        # las bases que ya la tienen (no se borra nada) y no se vuelve a crear.

        if "cedula" not in columnas_pedidos:
            print("[migracion] Agregando columna 'cedula' a pedidos...")
            conn.execute(text("ALTER TABLE pedidos ADD COLUMN cedula VARCHAR"))

        resultado = conn.execute(text("""
            UPDATE pedidos
            SET fecha = SUBSTRING(timestamp FROM 1 FOR 10)::date
            WHERE fecha IS NULL
              AND timestamp ~ '^\\d{4}-\\d{2}-\\d{2}'
        """))
        if resultado.rowcount:
            print(f"[migracion] Backfill 'fecha': {resultado.rowcount} pedidos actualizados.")

        conteo_horarios = conn.execute(text("SELECT COUNT(*) FROM horarios_atencion")).scalar()
        if conteo_horarios == 0:
            print("[migracion] Sembrando horario de atención por defecto (todos los días 11:00-21:00)...")
            for dia in range(7):
                conn.execute(
                    text("""
                        INSERT INTO horarios_atencion (dia_semana, activo, hora_apertura, hora_cierre)
                        VALUES (:dia, true, '11:00', '21:00')
                    """),
                    {"dia": dia}
                )


        # --- Retirar el modo "piezas compartidas" de los combos ---------------
        # Ese modo dejaba al cliente mezclar libremente sabores de varias
        # categorias hasta un total unico (ej. 76 piezas variadas). En el local
        # no se vende asi: un combo de X piezas es X piezas de UN roll concreto.
        # Se convierten a "excluyente", que es justo eso: se elige una fila y se
        # completan sus piezas.
        #
        # El objetivo compartido lo marcaba siempre la primera fila, asi que se
        # le copia a todas. Antes de tocar nada, el JSON original se guarda en
        # items_json_respaldo, de modo que el cambio es reversible.
        if "items_json_respaldo" not in columnas_combos:
            print("[migracion] Agregando columna 'items_json_respaldo' a combos...")
            conn.execute(text("ALTER TABLE combos ADD COLUMN items_json_respaldo TEXT"))

        filas = conn.execute(text("""
            SELECT id, items_json FROM combos
            WHERE items_json IS NOT NULL
              AND items_json LIKE '%compartido%'
              AND items_json_respaldo IS NULL
        """)).fetchall()

        convertidos = 0
        for fila in filas:
            try:
                grupos = json.loads(fila.items_json)
            except (ValueError, TypeError):
                continue
            if not isinstance(grupos, list):
                continue

            cambio = False
            for grupo in grupos:
                if not isinstance(grupo, dict) or grupo.get("tipo") != "piezas_alternativas":
                    continue
                if grupo.get("modo") != "compartido" and grupo.get("compartido") is not True:
                    continue

                alternativas = grupo.get("alternativas") or []
                objetivo = alternativas[0].get("piezas_objetivo") if alternativas else None
                if not objetivo:
                    # Sin un objetivo del que partir preferimos no inventar nada.
                    continue

                for alt in alternativas:
                    alt["piezas_objetivo"] = objetivo
                grupo["modo"] = "excluyente"
                grupo.pop("compartido", None)
                cambio = True

            if not cambio:
                continue

            conn.execute(
                text("UPDATE combos SET items_json_respaldo = :orig, items_json = :nuevo WHERE id = :id"),
                {"orig": fila.items_json, "nuevo": json.dumps(grupos, ensure_ascii=False), "id": fila.id},
            )
            convertidos += 1

        if convertidos:
            print(f"[migracion] Combos con 'piezas compartidas' convertidos a 'excluyente': {convertidos}.")


        # --- Empaque y datos del aviso a motorizados --------------------------
        # bandejas/cajas_pizza dicen cuanto ocupa cada plato al empacarlo; se
        # suman por pedido para decirle al motorizado cuantas manos necesita.
        # Los que ya existen arrancan en 1 bandeja y 0 cajas, y el restaurante
        # los va ajustando desde el panel segun la realidad de cada plato.
        for tabla, columnas in (("productos", columnas_productos), ("combos", columnas_combos)):
            if "bandejas" not in columnas:
                print(f"[migracion] Agregando 'bandejas' y 'cajas_pizza' a {tabla}...")
                conn.execute(text(f"ALTER TABLE {tabla} ADD COLUMN bandejas INTEGER DEFAULT 1"))
                conn.execute(text(f"ALTER TABLE {tabla} ADD COLUMN cajas_pizza INTEGER DEFAULT 0"))
                conn.execute(text(f"UPDATE {tabla} SET bandejas = 1 WHERE bandejas IS NULL"))
                conn.execute(text(f"UPDATE {tabla} SET cajas_pizza = 0 WHERE cajas_pizza IS NULL"))

        if "precio_delivery" not in columnas_pedidos:
            print("[migracion] Agregando datos de despacho a pedidos...")
            conn.execute(text("ALTER TABLE pedidos ADD COLUMN precio_delivery DOUBLE PRECISION"))
            conn.execute(text("ALTER TABLE pedidos ADD COLUMN paga_con VARCHAR"))
            conn.execute(text("ALTER TABLE pedidos ADD COLUMN total_bandejas INTEGER"))
            conn.execute(text("ALTER TABLE pedidos ADD COLUMN total_cajas_pizza INTEGER"))
            conn.execute(text("ALTER TABLE pedidos ADD COLUMN total_refrescos INTEGER"))


        # --- Plantilla nueva del aviso al grupo de motorizados ---------------
        # El grupo llevaba anos recibiendo el aviso escrito a mano con un
        # formato fijo. Lo copiamos tal cual (con emojis) para que no tengan
        # que reaprender a leerlo. Solo se siembra si la plantilla guardada
        # todavia es la vieja: en cuanto el restaurante la edite desde el
        # panel, esta migracion deja de tocarla.
        fila_aviso = conn.execute(
            text("SELECT texto FROM mensajes_whatsapp WHERE id = 'aviso_grupo_delivery'")
        ).fetchone()
        texto_guardado = fila_aviso[0] if fila_aviso else None

        if texto_guardado is None:
            print("[migracion] Sembrando la plantilla del aviso a motorizados...")
            conn.execute(
                text("INSERT INTO mensajes_whatsapp (id, texto) VALUES ('aviso_grupo_delivery', :t)"),
                {"t": PLANTILLA_AVISO_MOTORIZADOS},
            )
        elif "[BANDEJAS]" not in texto_guardado:
            print("[migracion] Actualizando la plantilla del aviso a motorizados...")
            # Guardamos la anterior por si quieren volver a ella.
            respaldo = conn.execute(
                text("SELECT texto FROM mensajes_whatsapp WHERE id = 'aviso_grupo_delivery_anterior'")
            ).fetchone()
            if respaldo is None:
                conn.execute(
                    text("INSERT INTO mensajes_whatsapp (id, texto) VALUES ('aviso_grupo_delivery_anterior', :t)"),
                    {"t": texto_guardado},
                )
            conn.execute(
                text("UPDATE mensajes_whatsapp SET texto = :t WHERE id = 'aviso_grupo_delivery'"),
                {"t": PLANTILLA_AVISO_MOTORIZADOS},
            )
