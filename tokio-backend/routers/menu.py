from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import models
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
            "productos": [{"id": p.id, "nombre": p.nombre, "categoria": p.categoria, "precio": p.precio, "imagen": p.imagen, "descripcion": p.descripcion, "disponible": p.disponible} for p in productos],
            "combos": [{"id": cb.id, "nombre": cb.nombre, "precio": cb.precio, "imagen": cb.imagen, "descripcion": cb.descripcion, "disponible": cb.disponible, "items_json": cb.items_json} for cb in combos]
        }
    }

@router.post("/guardar-categoria")
def guardar_categoria(datos: dict, db: Session = Depends(get_db)):
    try:
        if datos.get("id"):
            cat = db.query(models.Categoria).filter(models.Categoria.id == datos["id"]).first()
            if cat:
                cat.nombre = datos["nombre"]
                cat.imagen = datos.get("imagen", "")
        else:
            nueva_cat = models.Categoria(nombre=datos["nombre"], imagen=datos.get("imagen", ""))
            db.add(nueva_cat)
            
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}

@router.post("/guardar-producto")
def guardar_producto(datos: dict, db: Session = Depends(get_db)):
    try:
        if datos.get("id"):
            prod = db.query(models.Producto).filter(models.Producto.id == datos["id"]).first()
            if prod:
                prod.nombre = datos["nombre"]
                prod.categoria = datos["categoria"]
                prod.precio = datos["precio"]
                prod.imagen = datos.get("imagen", "")
                prod.descripcion = datos.get("descripcion", "")
                prod.disponible = datos["disponible"]
        else:
            nuevo_prod = models.Producto(
                nombre=datos["nombre"],
                categoria=datos["categoria"],
                precio=datos["precio"],
                imagen=datos.get("imagen", ""),
                descripcion=datos.get("descripcion", ""),
                disponible=datos["disponible"]
            )
            db.add(nuevo_prod)
            
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}

@router.post("/guardar-combo")
def guardar_combo(datos: dict, db: Session = Depends(get_db)):
    try:
        # Convertimos la lista de items a texto JSON para guardarlo en 1 sola columna
        items_json_str = json.dumps(datos.get("items", []))
        
        if datos.get("id"):
            combo = db.query(models.Combo).filter(models.Combo.id == datos["id"]).first()
            if combo:
                combo.nombre = datos["nombre"]
                combo.precio = datos["precio"]
                combo.imagen = datos.get("imagen", "")
                combo.descripcion = datos.get("descripcion", "")
                combo.items_json = items_json_str
                combo.disponible = datos["disponible"]
        else:
            nuevo_combo = models.Combo(
                nombre=datos["nombre"],
                precio=datos["precio"],
                imagen=datos.get("imagen", ""),
                descripcion=datos.get("descripcion", ""),
                items_json=items_json_str,
                disponible=datos["disponible"]
            )
            db.add(nuevo_combo)
            
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}

@router.post("/eliminar-item")
def eliminar_item(datos: dict, db: Session = Depends(get_db)):
    try:
        item_id = datos.get("id")
        tipo = datos.get("tipo")
        
        # Identificamos qué tabla debemos tocar dependiendo del tipo
        if tipo == "categoria":
            item = db.query(models.Categoria).filter(models.Categoria.id == item_id).first()
        elif tipo == "producto":
            item = db.query(models.Producto).filter(models.Producto.id == item_id).first()
        elif tipo == "combo":
            item = db.query(models.Combo).filter(models.Combo.id == item_id).first()
        else:
            return {"success": False, "error": "Tipo desconocido"}
            
        if item:
            db.delete(item)
            db.commit()
            
        return {"success": True}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}