from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
import schemas

router = APIRouter(
    prefix="/api/clientes",
    tags=["Clientes"]
)

# Cambiamos a GET para coincidir con tu fetch de menu.js
@router.get("/verificar")
def verificar_cliente(telefono: str, db: Session = Depends(get_db)):
    cliente = db.query(models.Cliente).filter(models.Cliente.telefono == telefono).first()
    
    # El JS espera un array. Si existe, devolvemos una lista con 1 objeto.
    if cliente:
        return [{
            "nombre": cliente.nombre,
            "telefono": cliente.telefono,
            "cedula": cliente.cedula,
            "direccion_principal": cliente.direccion_principal,
            "direcciones_extra": cliente.direcciones_extra
        }]
        
    # Si no existe, devolvemos un array vacío para que el JS dispare el registro
    return []

@router.post("/registrar")
def registrar_cliente(datos: schemas.ClienteRegistro, db: Session = Depends(get_db)):
    cliente_existente = db.query(models.Cliente).filter(models.Cliente.telefono == datos.telefono).first()
    if cliente_existente:
        raise HTTPException(status_code=400, detail="El cliente ya está registrado.")

    nuevo_cliente = models.Cliente(
        telefono=datos.telefono,
        nombre=datos.nombre,
        cedula=datos.cedula,
        direccion_principal=datos.direccion_principal,
        direcciones_extra=datos.direcciones_extra
    )
    
    db.add(nuevo_cliente)
    db.commit()
    
    return {"status": "success", "mensaje": "Cliente registrado exitosamente"}

@router.post("/actualizar-direcciones-cliente")
def actualizar_direcciones(datos: schemas.ClienteActualizarDirecciones, db: Session = Depends(get_db)):
    cliente = db.query(models.Cliente).filter(models.Cliente.telefono == datos.telefono).first()
    
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    # Solo actualizamos si el frontend envió un dato nuevo
    if datos.direccion_principal is not None:
        cliente.direccion_principal = datos.direccion_principal
    if datos.direcciones_extra is not None:
        cliente.direcciones_extra = datos.direcciones_extra
        
    db.commit()
    
    return {"status": "success", "mensaje": "Direcciones actualizadas correctamente"}