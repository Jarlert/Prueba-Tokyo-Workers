import os
import httpx
from dotenv import load_dotenv

load_dotenv()

EVOLUTION_API_URL = os.getenv("EVOLUTION_API_URL")
EVOLUTION_API_KEY = os.getenv("EVOLUTION_API_KEY")
INSTANCE_NAME = os.getenv("INSTANCE_NAME") # El nombre de tu instancia en Evolution API

async def enviar_whatsapp(numero: str, mensaje: str):
    numero = numero.strip()
    if numero.startswith("0"):
        # Le quitamos el 0 inicial y le ponemos el 58
        numero = "58" + numero[1:]
    elif not numero.startswith("58"):
        # Si alguien lo escribió sin el 0 y sin el 58 (ej. 412...)
        numero = "58" + numero
    url = f"{EVOLUTION_API_URL}/message/sendText/{INSTANCE_NAME}"
    
    headers = {
        "apikey": EVOLUTION_API_KEY,
        "Content-Type": "application/json"
    }
    
    payload = {
        "number": numero,
        "text": mensaje
    }

    # Usamos AsyncClient para no bloquear el servidor
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            print(f"Error al enviar WhatsApp: {e}")
            return None
    
    # Le damos 15 segundos de paciencia por si el servidor está lento
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()
        
        except httpx.HTTPStatusError as e:
            # Captura errores de formato (Ej. error 400, 401, 404)
            print(f"Error de estado al enviar WhatsApp: {e}")
            return None
            
        except httpx.RequestError as e:
            # NUEVO: Captura errores de red, servidor caído o Timeouts
            print(f"Error de conexión/timeout con Evolution API: {e}")
            return None