from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import models
import schemas

router = APIRouter(
    prefix="/api/usuarios",
    tags=["Usuarios"]
)

@router.post("/validar-acceso")
def validar_acceso(datos: schemas.LoginRequest, db: Session = Depends(get_db)):
    # Buscamos coincidencia exacta de usuario y PIN
    usuario = db.query(models.Usuario).filter(
        models.Usuario.username == datos.username,
        models.Usuario.pin == datos.pin
    ).first()

    if not usuario:
        return {"success": False}

    # Si coincide, devolvemos los datos para el localStorage (sin el PIN por seguridad)
    return {
        "success": True,
        "usuario": {
            "username": usuario.username,
            "nombre": usuario.nombre,
            "rol": usuario.rol
        }
    }