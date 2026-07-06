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
    # Verificamos si el usuario y el PIN coinciden en la base de datos
    usuario = db.query(models.Usuario).filter(
        models.Usuario.username == datos.username, 
        models.Usuario.pin == datos.pin
    ).first()
    
    if usuario:
        # Si intenta entrar al admin, validamos su rol
        if datos.tipo == "login_admin" and usuario.rol.lower() not in ["admin", "superadmin"]:
            return {"success": False, "msg": "No tienes privilegios de administrador"}
        
        return {"success": True, "usuario": {"nombre": usuario.nombre, "rol": usuario.rol}}
        
    return {"success": False, "msg": "Credenciales incorrectas"}

@router.get("/")
def obtener_usuarios(db: Session = Depends(get_db)):
    usuarios = db.query(models.Usuario).all()
    return [{"id": u.id, "nombre": u.nombre, "username": u.username, "pin": u.pin, "rol": u.rol} for u in usuarios]

@router.post("/guardar")
def guardar_usuario(datos: schemas.UsuarioGuardar, db: Session = Depends(get_db)):
    try:
        if datos.id:
            usuario = db.query(models.Usuario).filter(models.Usuario.id == datos.id).first()
            if usuario:
                usuario.nombre = datos.nombre
                usuario.username = datos.username
                usuario.pin = datos.pin
                usuario.rol = datos.rol
        else:
            nuevo_usuario = models.Usuario(
                nombre=datos.nombre,
                username=datos.username,
                pin=datos.pin,
                rol=datos.rol
            )
            db.add(nuevo_usuario)
            
        db.commit()
        return {"success": True, "msg": "Usuario guardado exitosamente"}
    except Exception as e:
        db.rollback() # Cancelamos la transacción fallida por seguridad
        return {"success": False, "error": str(e)}

@router.post("/eliminar")
def eliminar_usuario(datos: dict, db: Session = Depends(get_db)):
    usuario = db.query(models.Usuario).filter(models.Usuario.id == datos["id"]).first()
    if usuario:
        db.delete(usuario)
        db.commit()
    return {"success": True}