import os

from fastapi import FastAPI
from routers import bcv, pedidos, clientes, menu, usuarios, motorizados, mensajes
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from migrations import ejecutar_migraciones

# Crea las tablas en la BD si no existen
Base.metadata.create_all(bind=engine)

# Migraciones aditivas (agregan columnas/índices nuevos si faltan, no tocan datos existentes)
ejecutar_migraciones(engine)

app = FastAPI(title="Tokio Sushi API")

# --- CONFIGURACIÓN DE CORS ---
# Lista de orígenes permitidos vía env var (separados por coma). En producción
# solo debe incluir el dominio real del frontend.
CORS_ORIGINS = [
    origen.strip()
    for origen in os.getenv("CORS_ORIGINS", "https://tokio-sushi-app.vercel.app").split(",")
    if origen.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registramos el enrutador de la Tasa BCV
app.include_router(bcv.router)

@app.get("/")
def health_check():
    return {"status": "ok", "mensaje": "Backend de Tokio Sushi operativo"}

app.include_router(pedidos.router)
app.include_router(clientes.router)
app.include_router(menu.router)
app.include_router(usuarios.router)
app.include_router(motorizados.router)
app.include_router(mensajes.router)