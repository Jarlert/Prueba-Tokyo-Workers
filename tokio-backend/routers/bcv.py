from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from pydantic import BaseModel
from datetime import datetime
import requests
import models

router = APIRouter(
    prefix="/api/bcv",
    tags=["BCV"]
)

class TasaRequest(BaseModel):
    tasa: float

@router.get("/")
def obtener_tasa(db: Session = Depends(get_db)):
    hoy = datetime.now().strftime("%Y-%m-%d")
    registro = db.query(models.TasaManual).first()
    
    # FIX: Envolvemos registro.fecha en str() para que los formatos coincidan siempre
    if registro and str(registro.fecha) == hoy:
        return {"success": True, "tasa": registro.tasa}
        
    # Si es un día nuevo, Consultamos la API
    try:
        respuesta = requests.get("https://ve.dolarapi.com/v1/dolares/oficial", timeout=5)
        datos_api = respuesta.json()
        tasa_fresca = datos_api["promedio"]
        
        if registro:
            registro.tasa = tasa_fresca
            registro.fecha = hoy
        else:
            nuevo_registro = models.TasaManual(tasa=tasa_fresca, fecha=hoy)
            db.add(nuevo_registro)
            
        db.commit()
        return {"success": True, "tasa": tasa_fresca}
        
    except Exception as e:
        print(f"Error consultando API BCV: {e}")
        return {"success": True, "tasa": registro.tasa if registro else 1.0}

@router.post("/actualizar")
def actualizar_tasa(datos: TasaRequest, db: Session = Depends(get_db)):
    hoy = datetime.now().strftime("%Y-%m-%d")
    registro = db.query(models.TasaManual).first()
    
    if not registro:
        nuevo_registro = models.TasaManual(tasa=datos.tasa, fecha=hoy)
        db.add(nuevo_registro)
    else:
        # El Admin la modificó manualmente, actualizamos el número y le ponemos fecha de HOY
        registro.tasa = datos.tasa
        registro.fecha = hoy
        
    db.commit()
    return {"success": True, "tasa": datos.tasa}