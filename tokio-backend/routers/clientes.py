from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
import schemas

router = APIRouter(
    prefix="/api/clientes",
    tags=["Clientes"]
)

@router.post("/verificar")
def verificar_cliente(datos: schemas.ClienteVerificar, db: Session = Depends(get_db)):
    # Buscamos en la BD si el teléfono ya existe
    cliente = db.query(models.Cliente).filter(models.Cliente.telefono == datos.telefono).first()
    
    if cliente:
        return {
            "existe": True, 
            "cliente": {
                "nombre": cliente.nombre,
                "telefono": cliente.telefono,
                "cedula": cliente.cedula,
                "direcciones_extra": cliente.direcciones_extra
            }
        }
    
    return {"existe": False}

@router.post("/registrar")
def registrar_cliente(datos: schemas.ClienteRegistro, db: Session = Depends(get_db)):
    # Verificamos por seguridad que no exista ya
    cliente_existente = db.query(models.Cliente).filter(models.Cliente.telefono == datos.telefono).first()
    if cliente_existente:
        raise HTTPException(status_code=400, detail="El cliente ya está registrado.")

    nuevo_cliente = models.Cliente(
        telefono=datos.telefono,
        nombre=datos.nombre,
        cedula=datos.cedula
    )
    
    db.add(nuevo_cliente)
    db.commit()
    
    return {"status": "success", "mensaje": "Cliente registrado exitosamente"}