from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def ejecutar_migraciones(engine: Engine):
    """Migraciones aditivas e idempotentes: solo agregan columnas/índices que
    falten y rellenan datos derivados, nunca tocan ni borran datos existentes.
    Se corren en cada arranque; después de la primera vez son no-ops baratos.
    """
    inspector = inspect(engine)
    columnas_pedidos = [c["name"] for c in inspector.get_columns("pedidos")]
    columnas_productos = [c["name"] for c in inspector.get_columns("productos")]

    with engine.begin() as conn:
        if "fecha" not in columnas_pedidos:
            print("[migracion] Agregando columna 'fecha' a pedidos...")
            conn.execute(text("ALTER TABLE pedidos ADD COLUMN fecha DATE"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pedidos_fecha ON pedidos (fecha)"))

        if "agotado" not in columnas_productos:
            print("[migracion] Agregando columna 'agotado' a productos...")
            conn.execute(text("ALTER TABLE productos ADD COLUMN agotado BOOLEAN DEFAULT FALSE"))

        if "piezas" not in columnas_productos:
            print("[migracion] Agregando columna 'piezas' a productos...")
            conn.execute(text("ALTER TABLE productos ADD COLUMN piezas INTEGER DEFAULT 1"))

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
