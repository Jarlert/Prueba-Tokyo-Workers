from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from rate_limit import limitador
import models
import schemas

router = APIRouter(
    prefix="/api/clientes",
    tags=["Clientes"]
)

# Endpoint público (los clientes no tienen login) — rate limit más permisivo
# solo para frenar scraping agresivo de teléfonos, no tráfico real.
rate_limit_verificar = limitador(max_intentos=20, ventana_seg=60)

# Cambiamos a GET para coincidir con tu fetch de menu.js
@router.get("/verificar")
def verificar_cliente(telefono: str, db: Session = Depends(get_db), _rl=Depends(rate_limit_verificar)):
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

@router.post("/actualizar-telefono")
def actualizar_telefono(datos: schemas.ClienteActualizarTelefono, db: Session = Depends(get_db)):
    telefono_nuevo = datos.telefono_nuevo.strip()
    if not telefono_nuevo:
        raise HTTPException(status_code=400, detail="El nuevo número no puede estar vacío.")

    cliente = db.query(models.Cliente).filter(models.Cliente.telefono == datos.telefono_actual).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    if telefono_nuevo != datos.telefono_actual:
        duplicado = db.query(models.Cliente).filter(models.Cliente.telefono == telefono_nuevo).first()
        if duplicado:
            raise HTTPException(status_code=400, detail="Ese número ya está registrado con otra cuenta.")

    cliente.telefono = telefono_nuevo
    db.commit()

    return {"status": "success", "mensaje": "Número de teléfono actualizado correctamente"}

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