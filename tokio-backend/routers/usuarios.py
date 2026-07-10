from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from auth import crear_token, hash_pin, pin_es_hash, requiere_admin, verificar_pin
from rate_limit import limitador
import models
import schemas

router = APIRouter(
    prefix="/api/usuarios",
    tags=["Usuarios"]
)

rate_limit_login = limitador(max_intentos=8, ventana_seg=60)

@router.post("/validar-acceso")
def validar_acceso(datos: schemas.LoginRequest, db: Session = Depends(get_db), _rl=Depends(rate_limit_login)):
    usuario = db.query(models.Usuario).filter(models.Usuario.username == datos.username).first()

    if not usuario or not verificar_pin(datos.pin, usuario.pin):
        return {"success": False, "msg": "Credenciales incorrectas"}

    # Si intenta entrar al admin, validamos su rol
    if datos.tipo == "login_admin" and usuario.rol.lower() not in ["admin", "superadmin"]:
        return {"success": False, "msg": "No tienes privilegios de administrador"}

    # Migración perezosa: si el PIN aún vive en texto plano, lo rehasheamos ahora que lo validamos
    if not pin_es_hash(usuario.pin):
        usuario.pin = hash_pin(datos.pin)
        db.commit()

    token = crear_token(usuario.username, usuario.rol)
    return {
        "success": True,
        "token": token,
        "usuario": {"nombre": usuario.nombre, "rol": usuario.rol, "username": usuario.username}
    }

@router.get("/")
def obtener_usuarios(db: Session = Depends(get_db), admin: dict = Depends(requiere_admin)):
    usuarios = db.query(models.Usuario).all()
    return [{"id": u.id, "nombre": u.nombre, "username": u.username, "rol": u.rol} for u in usuarios]

@router.post("/guardar")
def guardar_usuario(datos: schemas.UsuarioGuardar, db: Session = Depends(get_db), admin: dict = Depends(requiere_admin)):
    try:
        if datos.id:
            usuario = db.query(models.Usuario).filter(models.Usuario.id == datos.id).first()
            if usuario:
                usuario.nombre = datos.nombre
                usuario.username = datos.username
                usuario.rol = datos.rol
                # Solo tocamos el PIN si mandaron uno nuevo (dejarlo vacío = no cambiarlo)
                if datos.pin:
                    usuario.pin = hash_pin(datos.pin)
        else:
            if not datos.pin:
                return {"success": False, "error": "El PIN es obligatorio al crear un usuario"}
            nuevo_usuario = models.Usuario(
                nombre=datos.nombre,
                username=datos.username,
                pin=hash_pin(datos.pin),
                rol=datos.rol
            )
            db.add(nuevo_usuario)

        db.commit()
        return {"success": True, "msg": "Usuario guardado exitosamente"}
    except Exception as e:
        db.rollback() # Cancelamos la transacción fallida por seguridad
        return {"success": False, "error": str(e)}

@router.post("/eliminar")
def eliminar_usuario(datos: dict, db: Session = Depends(get_db), admin: dict = Depends(requiere_admin)):
    usuario = db.query(models.Usuario).filter(models.Usuario.id == datos["id"]).first()
    if usuario:
        db.delete(usuario)
        db.commit()
    return {"success": True}
