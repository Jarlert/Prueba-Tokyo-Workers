from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from auth import requiere_admin
import models
import schemas

router = APIRouter(
    prefix="/api/anuncios",
    tags=["Anuncios"]
)

@router.get("/")
def obtener_anuncios(db: Session = Depends(get_db)):
    anuncios = db.query(models.Anuncio).order_by(models.Anuncio.orden).all()
    return [{"id": a.id, "imagen": a.imagen, "titulo": a.titulo, "texto": a.texto, "activo": a.activo, "orden": a.orden, "producto_ref": a.producto_ref} for a in anuncios]

@router.post("/guardar")
def guardar_anuncio(datos: schemas.AnuncioGuardar, db: Session = Depends(get_db), admin: dict = Depends(requiere_admin)):
    try:
        if datos.id:
            anuncio = db.query(models.Anuncio).filter(models.Anuncio.id == datos.id).first()
            if anuncio:
                anuncio.imagen = datos.imagen
                anuncio.titulo = datos.titulo
                anuncio.texto = datos.texto
                anuncio.activo = datos.activo
                anuncio.orden = datos.orden
                anuncio.producto_ref = datos.producto_ref
        else:
            db.add(models.Anuncio(
                imagen=datos.imagen,
                titulo=datos.titulo,
                texto=datos.texto,
                activo=datos.activo,
                orden=datos.orden,
                producto_ref=datos.producto_ref
            ))

        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}

@router.post("/eliminar")
def eliminar_anuncio(datos: dict, db: Session = Depends(get_db), admin: dict = Depends(requiere_admin)):
    anuncio = db.query(models.Anuncio).filter(models.Anuncio.id == datos["id"]).first()
    if anuncio:
        db.delete(anuncio)
        db.commit()
    return {"success": True}
