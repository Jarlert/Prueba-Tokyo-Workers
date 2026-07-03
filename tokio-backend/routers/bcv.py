from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
import schemas
from datetime import date
from services.dolar_api import obtener_tasa_bcv_oficial

router = APIRouter(
    prefix="/api/bcv",
    tags=["Tasa BCV"]
)

# Función interna unificada que usaremos aquí y en los pedidos
async def obtener_tasa_del_dia(db: Session):
    # Prioridad 1: Buscar si el admin fijó una tasa HOY en la base de datos
    tasa_hoy = db.query(models.TasaManual).filter(models.TasaManual.fecha == date.today()).first()
    
    if tasa_hoy:
        return tasa_hoy.tasa, "Manual"
    
    # Prioridad 2: Si no hay tasa manual hoy, consultamos Dolar API
    tasa_api = await obtener_tasa_bcv_oficial()
    if tasa_api:
        return tasa_api, "Dolar API"
        
    return None, None

@router.get("/actual")
async def obtener_tasa_actual(db: Session = Depends(get_db)):
    tasa, fuente = await obtener_tasa_del_dia(db)
    
    if not tasa:
        raise HTTPException(status_code=503, detail="Servicio no disponible.")
        
    return {"status": "ok", "tasa": tasa, "fuente": fuente}

@router.post("/manual")
def fijar_tasa_manual(datos: schemas.TasaManualCreate, db: Session = Depends(get_db)):
    """ Endpoint para que el Admin fije la tasa del día """
    # Buscamos si ya existe una tasa hoy para sobreescribirla
    tasa_hoy = db.query(models.TasaManual).filter(models.TasaManual.fecha == date.today()).first()
    
    if tasa_hoy:
        tasa_hoy.tasa = datos.tasa
    else:
        nueva_tasa = models.TasaManual(tasa=datos.tasa)
        db.add(nueva_tasa)
        
    db.commit()
    return {"status": "success", "mensaje": f"Tasa manual fijada en {datos.tasa} Bs. para hoy."}