from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from database import get_db, engine, Base
from services.evolution_api import enviar_whatsapp

# Opcional: crea las tablas si no existen (idealmente usarás migraciones con Alembic luego)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Tokio Sushi API")

@app.get("/")
def health_check():
    return {"status": "ok", "mensaje": "Backend de Tokio Sushi operativo"}

# Endpoint de prueba para verificar Evolution API
@app.post("/test-whatsapp")
async def test_whatsapp(numero: str, mensaje: str):
    resultado = await enviar_whatsapp(numero, mensaje)
    if resultado:
        return {"status": "enviado", "data": resultado}
    return {"status": "error", "mensaje": "Fallo al enviar mensaje"}