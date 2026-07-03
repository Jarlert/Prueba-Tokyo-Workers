from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
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

    # 2. Calcular el total del pedido en el backend
    total_dolares = 0.0
    for item in pedido.articulos:
        # Sumamos el (precio * cantidad) de cada producto
        total_dolares += (item.price * item.qty)
        
    """
    NOTA DE SEGURIDAD SENIOR: 
    Actualmente estamos confiando en el 'price' que envía el frontend. 
    Cuando migremos la tabla 'productos' a FastAPI, cambiaremos esta línea 
    para que busque el precio real en la Base de Datos usando el nombre del producto, 
    evitando que alguien manipule el precio desde el navegador. Por ahora, nos sirve para avanzar.
    """

    # 3. Guardar en la Base de Datos
    nuevo_pedido = models.Pedido(
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
        f"🍣 ¡Hola, {pedido.cliente}! Hemos recibido tu pedido en Tokio Sushi.\n\n"
        f"📍 Entrega: {pedido.tipo_entrega}\n"
        f"💵 Tasa BCV del día: {tasa_actual} Bs.\n"
        f"💰 Total a pagar: ${total_dolares:.2f} ({(total_dolares * tasa_actual):.2f} Bs.)\n"
        f"⏳ Estado actual: {pedido.estado_inicial}\n\n"
        f"Te notificaremos por aquí cuando tu pedido esté en camino."
    )
    await enviar_whatsapp(pedido.telefono, mensaje_cliente)

    return {
        "status": "success", 
        "id_pedido": nuevo_pedido.id, 
        "mensaje": "Pedido procesado con éxito"
    }