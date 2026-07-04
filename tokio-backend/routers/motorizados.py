from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import models

router = APIRouter(
    prefix="/api/motorizados",
    tags=["Motorizados"]
)

# Aceptamos la 't' de timestamp que usa tu JS para limpiar caché
@router.get("/")
def obtener_motorizados(t: str = None, db: Session = Depends(get_db)):
    motorizados = db.query(models.Motorizado).all()
    # Tu frontend espera un array directo de objetos
    return [{"id": m.id, "nombre": m.nombre} for m in motorizados]