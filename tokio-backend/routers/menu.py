from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from auth import requiere_admin
import models
import schemas
import json

router = APIRouter(
    prefix="/api/menu",
    tags=["Menu"]
)

@router.get("/")
def obtener_menu(db: Session = Depends(get_db)):
    # Extraemos todo de la base de datos
    categorias = db.query(models.Categoria).all()
    productos = db.query(models.Producto).all()
    combos = db.query(models.Combo).all()

    # Lo empaquetamos exactamente como tu admin.js y app.js lo esperan
    return {
        "menu": {
            "categorias": [{"id": c.id, "nombre": c.nombre, "imagen": c.imagen} for c in categorias],
            "productos": [{"id": p.id, "nombre": p.nombre, "categoria": p.categoria, "precio": p.precio, "imagen": p.imagen, "descripcion": p.descripcion, "disponible": p.disponible, "agotado": p.agotado} for p in productos],
            "combos": [{"id": cb.id, "nombre": cb.nombre, "precio": cb.precio, "imagen": cb.imagen, "descripcion": cb.descripcion, "disponible": cb.disponible, "items_json": cb.items_json, "promo_cantidad_minima": cb.promo_cantidad_minima, "promo_producto_id": cb.promo_producto_id, "promo_producto_cantidad": cb.promo_producto_cantidad} for cb in combos]
        }
    }

@router.post("/guardar-categoria")
def guardar_categoria(datos: schemas.CategoriaGuardar, db: Session = Depends(get_db), admin: dict = Depends(requiere_admin)):
    try:
        if datos.id:
            cat = db.query(models.Categoria).filter(models.Categoria.id == datos.id).first()
            if cat:
                cat.nombre = datos.nombre
                cat.imagen = datos.imagen
        else:
            nueva_cat = models.Categoria(nombre=datos.nombre, imagen=datos.imagen)
            db.add(nueva_cat)

        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}

@router.post("/guardar-producto")
def guardar_producto(datos: schemas.ProductoGuardar, db: Session = Depends(get_db), admin: dict = Depends(requiere_admin)):
    try:
        if datos.id:
            prod = db.query(models.Producto).filter(models.Producto.id == datos.id).first()
            if prod:
                prod.nombre = datos.nombre
                prod.categoria = datos.categoria
                prod.precio = datos.precio
                prod.imagen = datos.imagen
                prod.descripcion = datos.descripcion
                prod.disponible = datos.disponible
                prod.agotado = datos.agotado
        else:
            nuevo_prod = models.Producto(
                nombre=datos.nombre,
                categoria=datos.categoria,
                precio=datos.precio,
                imagen=datos.imagen,
                descripcion=datos.descripcion,
                disponible=datos.disponible,
                agotado=datos.agotado
            )
            db.add(nuevo_prod)

        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}

@router.post("/guardar-combo")
def guardar_combo(datos: schemas.ComboGuardar, db: Session = Depends(get_db), admin: dict = Depends(requiere_admin)):
    try:
        # Convertimos la lista de items a texto JSON para guardarlo en 1 sola columna
        items_json_str = json.dumps(datos.items)

        if datos.id:
            combo = db.query(models.Combo).filter(models.Combo.id == datos.id).first()
            if combo:
                combo.nombre = datos.nombre
                combo.precio = datos.precio
                combo.imagen = datos.imagen
                combo.descripcion = datos.descripcion
                combo.items_json = items_json_str
                combo.disponible = datos.disponible
                combo.promo_cantidad_minima = datos.promo_cantidad_minima
                combo.promo_producto_id = datos.promo_producto_id
                combo.promo_producto_cantidad = datos.promo_producto_cantidad
        else:
            nuevo_combo = models.Combo(
                nombre=datos.nombre,
                precio=datos.precio,
                imagen=datos.imagen,
                descripcion=datos.descripcion,
                items_json=items_json_str,
                disponible=datos.disponible,
                promo_cantidad_minima=datos.promo_cantidad_minima,
                promo_producto_id=datos.promo_producto_id,
                promo_producto_cantidad=datos.promo_producto_cantidad
            )
            db.add(nuevo_combo)

        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}

@router.post("/eliminar-item")
def eliminar_item(datos: schemas.ItemEliminar, db: Session = Depends(get_db), admin: dict = Depends(requiere_admin)):
    try:
        # Identificamos qué tabla debemos tocar dependiendo del tipo
        if datos.tipo == "categoria":
            item = db.query(models.Categoria).filter(models.Categoria.id == datos.id).first()
        elif datos.tipo == "producto":
            item = db.query(models.Producto).filter(models.Producto.id == datos.id).first()
        elif datos.tipo == "combo":
            item = db.query(models.Combo).filter(models.Combo.id == datos.id).first()
        else:
            return {"success": False, "error": "Tipo desconocido"}

        if item:
            db.delete(item)
            db.commit()

        return {"success": True}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}
