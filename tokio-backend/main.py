from fastapi import FastAPI
from routers import bcv, pedidos, clientes, menu, usuarios, motorizados, mensajes
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from services.evolution_api import enviar_whatsapp # Mantenemos tu función de WhatsApp

# Crea las tablas en la BD si no existen
Base.metadata.create_all(bind=engine)

# ESTA ES LA LÍNEA QUE UVICORN NO ENCUENTRA:
app = FastAPI(title="Tokio Sushi API")

# --- CONFIGURACIÓN DE CORS ---
# En producción, aquí pondremos la URL exacta de tu GitHub Pages.
# Por ahora, con "*" permitimos que funcione desde tu entorno local.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registramos el enrutador de la Tasa BCV
app.include_router(bcv.router)

@app.get("/")
def health_check():
    return {"status": "ok", "mensaje": "Backend de Tokio Sushi operativo"}

# Mantenemos tu endpoint de prueba por si necesitas validar la conexión a Render más adelante
@app.post("/test-whatsapp")
async def test_whatsapp(numero: str, mensaje: str):
    resultado = await enviar_whatsapp(numero, mensaje)
    if resultado:
        return {"status": "enviado", "data": resultado}
    return {"status": "error", "mensaje": "Fallo al enviar mensaje"}
app.include_router(pedidos.router) 
app.include_router(clientes.router)
app.include_router(menu.router)
app.include_router(usuarios.router)
app.include_router(motorizados.router)
app.include_router(mensajes.router)