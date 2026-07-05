from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import json
import models
import schemas
from routers.bcv import obtener_tasa_del_dia
from services.evolution_api import enviar_whatsapp

router = APIRouter(
    prefix="/api/pedidos",
    tags=["Pedidos"]
)

@router.post("/")
async def crear_pedido(pedido: schemas.PedidoCreate, db: Session = Depends(get_db)):
    # 1. Consultar la tasa BCV al momento de la compra
    tasa_actual, fuente = await obtener_tasa_del_dia(db)
    if not tasa_actual:
        raise HTTPException(status_code=503, detail="Error de facturación: No se pudo verificar la Tasa BCV.")

# 2. Calcular el total de forma segura consultando la BD
    total_dolares = 0.0
    for item in pedido.articulos:
        precio_seguro = 0.0
        
        # Separamos el prefijo del ID real. 
        # Ej: De "p_5" sacamos ["p", "5"]. De "c_1_Roles_Bebidas" sacamos ["c", "1", "Roles", "Bebidas"]
        partes_id = item.id.split("_")
        tipo_item = partes_id[0]
        db_id = int(partes_id[1])
        
        if tipo_item == "p":
            # Es un producto normal
            producto_db = db.query(models.Producto).filter(models.Producto.id == db_id).first()
            if producto_db:
                precio_seguro = producto_db.precio
                
        elif tipo_item == "c":
            # Es un combo
            combo_db = db.query(models.Combo).filter(models.Combo.id == db_id).first()
            if combo_db:
                precio_seguro = combo_db.precio
        
        # Sistema de respaldo: Si borraste el producto de la BD mientras el cliente compraba, usamos su precio temporal
        if precio_seguro == 0.0:
            precio_seguro = item.price
            
        # Sumamos la cantidad multiplicada por el precio INHACKEABLE de tu base de datos
        total_dolares += (precio_seguro * item.qty)

    # 2.5 Replicamos la lógica de n8n para armar el texto del resumen
    resumen_articulos = []
    for item in pedido.articulos:
        nota = f" (Nota: {item.note})" if item.note else ""
        resumen_articulos.append(f"{item.qty}x {item.name} (${item.price:.2f}){nota}")
        
    # Unimos los platos con un guion o salto de línea (DBeaver suele mostrar los saltos como ese símbolo extraño de la imagen)
    texto_detallado = " - ".join(resumen_articulos)

    # 3. Guardar en la Base de Datos
    nuevo_pedido = models.Pedido(
        cliente=pedido.cliente,
        telefono=pedido.telefono,
        tipo_entrega=pedido.tipo_entrega,
        direccion=pedido.direccion,
        metodo_pago=pedido.metodo_pago,
        pedido_detallado=texto_detallado,
        total_orden=total_dolares,
        estado=pedido.estado_inicial,
        procesado_por="Sistema Automatizado", 
        referencia_pago=None if pedido.metodo_pago in ["Efectivo", "Punto de Venta"] else "Pendiente",
        tasa_bcv=tasa_actual
    )
    
    db.add(nuevo_pedido)
    db.commit()
    db.refresh(nuevo_pedido)

    # 4. Enviar notificación por WhatsApp
    mensaje_cliente = (
        f"Hola {pedido.cliente}, hemos recibido tu pedido #[PEDIDO] con éxito. 🍣 Ahora mismo nos encontramos calculando el costo del delivery para tu sector... En unos minutos te enviaremos tu total a cancelar y los métodos de pago."
    )
    await enviar_whatsapp(pedido.telefono, mensaje_cliente)

    return {
        "status": "success", 
        "id_pedido": nuevo_pedido.id, 
        "mensaje": "Pedido procesado con éxito"
    }

@router.get("/")
def obtener_pedidos(_t: str = None, fecha: str = None, db: Session = Depends(get_db)):
    # Traemos los últimos 150 pedidos de la base de datos
    pedidos = db.query(models.Pedido).order_by(models.Pedido.id.desc()).limit(150).all()
    
    lista_pedidos = []
    for p in pedidos:
        # Convertimos el modelo a diccionario de forma 100% segura
        dict_p = {**p.__dict__}
        
        # Limpiamos la basura interna que agrega SQLAlchemy
        dict_p.pop("_sa_instance_state", None) 
        
        # Le inyectamos el ID explícitamente para que el JS lo entienda
        dict_p["id_pedido"] = p.id 
        
        lista_pedidos.append(dict_p)
        
    return lista_pedidos

@router.post("/actualizar-estado")
def actualizar_estado(datos: dict, db: Session = Depends(get_db)):
    # Recibimos un diccionario genérico ('datos: dict') para que FastAPI no rechace 
    # ningún campo extraño que el frontend antiguo pudiera enviar.
    
    pedido_id = datos.get("id") or datos.get("id_pedido")
    pedido = db.query(models.Pedido).filter(models.Pedido.id == pedido_id).first()
    
    if not pedido:
        return {"success": False, "msg": "Pedido no encontrado"}

    # Actualizamos solo los campos que el frontend nos haya enviado
    if "estado" in datos: pedido.estado = datos["estado"]
    if "procesado_por" in datos: pedido.procesado_por = datos["procesado_por"]
    if "referencia_pago" in datos: pedido.referencia_pago = datos["referencia_pago"]
    if "imagen_pago" in datos: pedido.imagen_pago = datos["imagen_pago"]
    if "repartidor" in datos: pedido.repartidor = datos["repartidor"]
    if "total_orden" in datos: pedido.total_orden = datos["total_orden"]
    if "pedido_detallado" in datos: pedido.pedido_detallado = datos["pedido_detallado"]
    if "tasa_bcv" in datos: pedido.tasa_bcv = datos["tasa_bcv"]

    db.commit()
    return {"success": True}