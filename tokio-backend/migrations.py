from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def ejecutar_migraciones(engine: Engine):
    """Migraciones aditivas e idempotentes: solo agregan columnas/índices que
    falten y rellenan datos derivados, nunca tocan ni borran datos existentes.
    Se corren en cada arranque; después de la primera vez son no-ops baratos.
    """
    inspector = inspect(engine)
    columnas = [c["name"] for c in inspector.get_columns("pedidos")]

    with engine.begin() as conn:
        if "fecha" not in columnas:
            print("[migracion] Agregando columna 'fecha' a pedidos...")
            conn.execute(text("ALTER TABLE pedidos ADD COLUMN fecha DATE"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pedidos_fecha ON pedidos (fecha)"))

        resultado = conn.execute(text("""
            UPDATE pedidos
            SET fecha = SUBSTRING(timestamp FROM 1 FOR 10)::date
            WHERE fecha IS NULL
              AND timestamp ~ '^\\d{4}-\\d{2}-\\d{2}'
        """))
        if resultado.rowcount:
            print(f"[migracion] Backfill 'fecha': {resultado.rowcount} pedidos actualizados.")
