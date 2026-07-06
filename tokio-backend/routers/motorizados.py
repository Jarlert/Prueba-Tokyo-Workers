from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import models
import schemas

router = APIRouter(
    prefix="/api/motorizados",
    tags=["Motorizados"]
)

@router.get("/")
def obtener_motorizados(t: str = None, db: Session = Depends(get_db)):
    motorizados = db.query(models.Motorizado).all()
    return [{"id": m.id, "nombre": m.nombre} for m in motorizados]

@router.post("/guardar")
def guardar_motorizado(datos: schemas.MotorizadoGuardar, db: Session = Depends(get_db)):
    try:
        if datos.id:
            motorizado = db.query(models.Motorizado).filter(models.Motorizado.id == datos.id).first()
            if motorizado:
                motorizado.nombre = datos.nombre
        else:
            nuevo = models.Motorizado(nombre=datos.nombre)
            db.add(nuevo)
            
        db.commit()
        return {"success": True, "msg": "Motorizado guardado exitosamente"}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}

@router.post("/eliminar")
def eliminar_motorizado(datos: dict, db: Session = Depends(get_db)):
    motorizado = db.query(models.Motorizado).filter(models.Motorizado.id == datos["id"]).first()
    if motorizado:
        db.delete(motorizado)
        db.commit()
    return {"success": True}