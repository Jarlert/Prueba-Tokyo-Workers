import os
import httpx
from dotenv import load_dotenv

load_dotenv()

EVOLUTION_API_URL = os.getenv("EVOLUTION_API_URL")
EVOLUTION_API_KEY = os.getenv("EVOLUTION_API_KEY")
INSTANCE_NAME = os.getenv("INSTANCE_NAME") # El nombre de tu instancia en Evolution API

def formatear_numero(numero: str) -> str:
    """Deja el número como lo espera Evolution API: solo dígitos, con código de país.

    Los JID de grupo (...@g.us) se devuelven intactos.

    El frontend guarda los números extranjeros con un '+' delante
    (ver normalizarTelefono en config.js), y ese '+' es la señal de que el
    número YA trae su código de país: se le quitan los símbolos y se envía tal
    cual. Todo lo demás se sigue tratando como venezolano en formato legado
    (0XXXXXXXXXX), que es como están guardados los clientes históricos.
    """
    numero = (numero or "").strip()

    if "@g.us" in numero:
        return numero

    # Número internacional explícito: respetarlo sin anteponer nada
    if numero.startswith("+"):
        return "".join(c for c in numero if c.isdigit())

    solo_digitos = "".join(c for c in numero if c.isdigit())
    if not solo_digitos:
        return solo_digitos

    if solo_digitos.startswith("58"):
        return solo_digitos
    if solo_digitos.startswith("0"):
        # Formato venezolano legado: 0412... -> 58412...
        return "58" + solo_digitos.lstrip("0")

    # Escrito sin el 0 y sin el 58 (ej. 412...)
    return "58" + solo_digitos


async def enviar_whatsapp(numero: str, mensaje: str):
    numero = formatear_numero(numero)


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