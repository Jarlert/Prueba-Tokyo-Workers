from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import models

router = APIRouter(
    prefix="/api/menu",
    tags=["Menu"]
)

# Aceptamos el parámetro 't' (timestamp) que envía tu JS para evitar el caché
@router.get("/")
def obtener_menu(t: str = None, db: Session = Depends(get_db)):
    categorias = db.query(models.Categoria).all()
    productos = db.query(models.Producto).all()
    combos = db.query(models.Combo).all()

    # Construimos el diccionario replicando la estructura de n8n
    return {
        "menu": {
            "categorias": [
                {
                    "id": c.id,
                    "nombre": c.nombre,
                    "imagen": c.imagen
                } for c in categorias
            ],
            "productos": [
                {
                    "id": p.id,
                    "nombre": p.nombre,
                    "categoria": p.categoria,
                    "precio": p.precio,
                    "descripcion": p.descripcion,
                    "disponible": p.disponible,
                    "imagen": p.imagen
                } for p in productos
            ],
            "combos": [
                {
                    "id": c.id,
                    "nombre": c.nombre,
                    "precio": c.precio,
                    "descripcion": c.descripcion,
                    "imagen": c.imagen,
                    "items_json": c.items_json,
                    "disponible": c.disponible
                } for c in combos
            ]
        }
    }