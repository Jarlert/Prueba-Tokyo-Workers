import httpx

# URL pública y gratuita para obtener exclusivamente la tasa oficial del BCV
DOLAR_API_URL = "https://ve.dolarapi.com/v1/dolares/oficial"

async def obtener_tasa_bcv_oficial():
    """
    Consulta la API externa para obtener el promedio actual del dólar oficial.
    """
    # Usamos httpx asíncrono para no bloquear tu servidor durante la petición
    async with httpx.AsyncClient() as client:
        try:
            # timeout=10.0 evita que tu backend se quede colgado si la API externa se cae
            response = await client.get(DOLAR_API_URL, timeout=10.0)
            response.raise_for_status()
            
            data = response.json()
            # La API retorna un JSON donde el valor numérico viene en la clave "promedio"
            return data.get("promedio")
            
        except Exception as e:
            print(f"Error crítico al consultar Dolar API: {e}")
            return None