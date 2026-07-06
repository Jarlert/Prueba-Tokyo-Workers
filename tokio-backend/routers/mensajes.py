from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import models

router = APIRouter(
    prefix="/api/mensajes",
    tags=["Mensajes WhatsApp"]
)

@router.get("/")
def obtener_mensajes(db: Session = Depends(get_db)):
    mensajes = db.query(models.MensajeWhatsapp).all()
    # Retornamos la data como una lista simple para el JS
    return [{"id": m.id, "texto": m.texto} for m in mensajes]

@router.post("/guardar")
def guardar_mensajes(datos: dict, db: Session = Depends(get_db)):
    # El frontend manda un diccionario con las claves (recepcion, aprobado, etc.)
    for clave, texto in datos.items():
        mensaje = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == clave).first()
        if mensaje:
            mensaje.texto = texto  # Si existe, lo actualiza
        else:
            nuevo_mensaje = models.MensajeWhatsapp(id=clave, texto=texto) # Si no, lo crea
            db.add(nuevo_mensaje)
    
    db.commit()
    return {"success": True, "msg": "Plantillas actualizadas correctamente"}