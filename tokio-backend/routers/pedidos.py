from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime
from sqlalchemy.orm import Session
from database import get_db
import json
import pusher
import models
import schemas
from services.evolution_api import enviar_whatsapp

router = APIRouter(
    prefix="/api/pedidos",
    tags=["Pedidos"]
)

import pusher

# Configuramos el megáfono de Pusher
pusher_client = pusher.Pusher(
  app_id='2172992',
  key='88089dcd4800848c78dd',
  secret='f10dabcc72505b9bb9e7',
  cluster='us2',
  ssl=True
)

@router.post("/")
async def crear_pedido(pedido: schemas.PedidoCreate, db: Session = Depends(get_db)):
    
    # 1. Leer la tasa central directamente de la BD (pizarra central)
    registro_tasa = db.query(models.TasaManual).first()
    tasa_actual = registro_tasa.tasa if registro_tasa else 1.0

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
        
        # Le inyectamos la tasa que acabamos de leer de la pizarra central
        tasa_bcv=tasa_actual,
        
        timestamp=datetime.now().isoformat()
    )
    
    db.add(nuevo_pedido)
    db.commit()
    db.refresh(nuevo_pedido)

    # A. Calcular el ID visual (contamos cuántos pedidos hay HOY en la base de datos)
    hoy_str = datetime.now().strftime("%Y-%m-%d")
    pedidos_de_hoy = db.query(models.Pedido).filter(models.Pedido.timestamp.like(f"{hoy_str}%")).count()
    id_visual = pedidos_de_hoy 

    # ==========================================
    # LÓGICA DE NOTIFICACIONES PARA PEDIDO NUEVO
    # ==========================================
    es_pickup = "pickup" in pedido.tipo_entrega.lower() or "retiro" in pedido.tipo_entrega.lower()
    
    if es_pickup:
        # Si es Pickup, saltamos el cálculo de delivery y lo pasamos directo a cobro
        nuevo_pedido.estado = "Pago Pendiente"
        db.commit()
        
        # Avisamos al tablero que hubo una actualización rápida
        try:
            pusher_client.trigger('canal-cocina', 'actualizar-tablero', {'mensaje': 'actualizacion'})
        except:
            pass
            
        metodo = pedido.metodo_pago.lower()
        if "zelle" in metodo:
            plantilla_id = "cobro_zelle"
        elif "efectivo" in metodo:
            plantilla_id = "cobro_efectivo"
        else:
            plantilla_id = "cobro_pago_movil"
            
        plantilla = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == plantilla_id).first()
        
        if plantilla:
            mensaje_cliente = plantilla.texto.replace("[CLIENTE]", pedido.cliente)
            mensaje_cliente = mensaje_cliente.replace("[PEDIDO_DETALLADO]", texto_detallado)
            mensaje_cliente = mensaje_cliente.replace("[TOTAL_USD]", f"${total_dolares:.2f}")
            
            # Cálculo exacto de bolívares para las plantillas que lo requieran
            total_bs = total_dolares * tasa_actual
            total_bs_str = f"Bs. {total_bs:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
            mensaje_cliente = mensaje_cliente.replace("[TOTAL_BS]", total_bs_str)
        else:
            mensaje_cliente = f"¡Hola {pedido.cliente}! Tu pedido #{id_visual} está listo para ser pagado. Total: ${total_dolares:.2f}"
            
    else:
        # Si es Delivery, enviamos el mensaje normal de cálculo de zona
        try:
            pusher_client.trigger('canal-cocina', 'actualizar-tablero', {'mensaje': 'nuevo_pedido'})
        except:
            pass

        plantilla = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == 'recepcion').first()
        
        if plantilla:
            mensaje_cliente = plantilla.texto.replace("[CLIENTE]", pedido.cliente).replace("[PEDIDO]", str(id_visual))
        else:
            mensaje_cliente = f"🍣 ¡Hola, {pedido.cliente}! Hemos recibido tu pedido #{id_visual}. En breve calcularemos el delivery."

    # Disparamos el mensaje procesado
    try:
        await enviar_whatsapp(pedido.telefono, mensaje_cliente)
    except Exception as e:
        print(f"Error enviando WhatsApp de nuevo pedido: {e}")
        
    return {"success": True}

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
    # --- NUEVO: Avisar al tablero que un pedido se movió ---
    try:
        pusher_client.trigger('canal-cocina', 'actualizar-tablero', {'mensaje': 'actualizacion'})
    except Exception as e:
        pass
    # -------------------------------------------------------
    return {"success": True}

@router.post("/notificar-edicion")
async def notificar_edicion_pedido(datos: schemas.NotificacionEdicion, db: Session = Depends(get_db)):
    
    # 1. Buscamos la plantilla en tu base de datos
    plantilla = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == 'modificado').first()
    
    if plantilla:
        # 2. Reemplazamos las etiquetas con los datos reales
        mensaje = plantilla.texto
        mensaje = mensaje.replace("[CLIENTE]", datos.cliente)
        mensaje = mensaje.replace("[PEDIDO_DETALLADO]", datos.pedido_detallado)
        
        # El :g quita los ceros inútiles (ej: 6.00 se vuelve 6)
        mensaje = mensaje.replace("[TOTAL_USD]", f"{datos.total_orden:g}")
        
        # Si el cliente paga en Bs, le pegamos el texto al final (ya que tu plantilla actual no tiene etiqueta [TOTAL_BS])
        if datos.texto_bolivares:
            mensaje += f"\n{datos.texto_bolivares}"
            
    else:
        # Fallback de emergencia por si alguien borra la plantilla de la BD
        mensaje = (
            f"⚠️ ¡Hola {datos.cliente}! Hemos actualizado tu orden.\n\n"
            f"{datos.pedido_detallado}\n\n"
            f"💰 Nuevo Total: ${datos.total_orden:g}{datos.texto_bolivares}"
        )
    
    # 3. Disparamos el mensaje por WhatsApp
    try:
        await enviar_whatsapp(datos.telefono, mensaje)
        return {"success": True, "mensaje": "Notificación dinámica enviada"}
    except Exception as e:
        print(f"Error enviando WhatsApp de edición: {e}")
        return {"success": False, "error": str(e)}
    
@router.post("/notificar-cobro")
async def notificar_cobro_pedido(datos: schemas.NotificacionCobro, db: Session = Depends(get_db)):
    
    # 1. Determinamos qué plantilla usar según el método de pago
    metodo_lower = datos.metodo_pago.lower()
    if "movil" in metodo_lower or "móvil" in metodo_lower:
        plantilla_id = "cobro_pago_movil"
    elif "zelle" in metodo_lower:
        plantilla_id = "cobro_zelle"
    else:
        plantilla_id = "cobro_efectivo"

    # 2. Buscamos la plantilla exacta
    plantilla = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == plantilla_id).first()
    
    if plantilla:
        # 3. Reemplazamos las etiquetas
        mensaje = plantilla.texto
        mensaje = mensaje.replace("[CLIENTE]", datos.cliente)
        mensaje = mensaje.replace("[PEDIDO_DETALLADO]", datos.pedido_detallado)
        mensaje = mensaje.replace("[TOTAL_USD]", f"{datos.total_orden:g}")
        mensaje = mensaje.replace("[TOTAL_BS]", datos.total_bs)
    else:
        # Fallback de emergencia
        mensaje = f"Hola {datos.cliente}, tu pedido está listo. Total: ${datos.total_orden:g}."
    
    # 4. Disparamos el WhatsApp
    try:
        await enviar_whatsapp(datos.telefono, mensaje)
        return {"success": True, "mensaje": f"Cobro enviado usando plantilla: {plantilla_id}"}
    except Exception as e:
        print(f"Error enviando WhatsApp de cobro: {e}")
        return {"success": False, "error": str(e)}
    
@router.post("/notificar-aprobado")
async def notificar_aprobado_pedido(datos: schemas.NotificacionAprobado, db: Session = Depends(get_db)):
    # Buscamos tu plantilla en la BD
    plantilla = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == 'aprobado').first()
    
    if plantilla:
        mensaje = plantilla.texto
        mensaje = mensaje.replace("[CLIENTE]", datos.cliente)
        
        # Le agregamos la palabra "minutos" si el cajero solo escribió el número
        tiempo_str = datos.tiempo_estimado if "minuto" in datos.tiempo_estimado.lower() else f"{datos.tiempo_estimado} minutos"
        mensaje = mensaje.replace("[TIEMPO_ESTIMADO]", tiempo_str)
    else:
        # Fallback de seguridad
        mensaje = f"¡Hola {datos.cliente}! ✅ Tu pago ha sido aprobado. Tu pedido ya está preparándose y estará listo en {datos.tiempo_estimado} minutos aproximadamente."
    
    try:
        await enviar_whatsapp(datos.telefono, mensaje)
        return {"success": True, "mensaje": "Notificación de aprobación enviada"}
    except Exception as e:
        print(f"Error enviando WhatsApp de aprobación: {e}")
        return {"success": False, "error": str(e)}
    
@router.post("/notificar-despacho")
async def notificar_despacho_pedido(datos: schemas.NotificacionDespacho, db: Session = Depends(get_db)):
    
    # --- 1. MENSAJE AL CLIENTE ---
    if "delivery" in datos.tipo_entrega.lower():
        plantilla_id = "final_delivery"
    else:
        plantilla_id = "final_pickup"
        
    plantilla_cliente = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == plantilla_id).first()
    
    if plantilla_cliente:
        mensaje_cliente = plantilla_cliente.texto.replace("[CLIENTE]", datos.cliente)
    else:
        mensaje_cliente = f"¡Hola {datos.cliente}! Tu pedido ({datos.tipo_entrega}) está listo y despachado."
        
    try:
        await enviar_whatsapp(datos.telefono, mensaje_cliente)
    except Exception as e:
        print(f"Error enviando WhatsApp de despacho al cliente: {e}")

    # --- 2. MENSAJE AL GRUPO DE MOTORIZADOS (Solo si es Delivery) ---
    if "delivery" in datos.tipo_entrega.lower():
        plantilla_grupo = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == 'aviso_grupo_delivery').first()
        
        if plantilla_grupo:
            mensaje_grupo = plantilla_grupo.texto
            mensaje_grupo = mensaje_grupo.replace("[PEDIDO]", datos.id_visual)
            mensaje_grupo = mensaje_grupo.replace("[CLIENTE]", datos.cliente)
            mensaje_grupo = mensaje_grupo.replace("[DIRECCION]", datos.direccion)
        else:
            # Fallback de emergencia
            mensaje_grupo = f"🛵 *NUEVO PEDIDO LISTO*\n\nEl pedido #{datos.id_visual} a nombre de {datos.cliente} en {datos.direccion} está listo para ser entregado."
            
        # Reemplaza esto con el ID real de tu grupo de WhatsApp en Evolution API / GREEN API
        ID_GRUPO_WHATSAPP = "120363403360852542@g.us"
        
        try:
            await enviar_whatsapp(ID_GRUPO_WHATSAPP, mensaje_grupo)
        except Exception as e:
            print(f"Error enviando WhatsApp al grupo de motorizados: {e}")

    return {"success": True, "mensaje": "Notificaciones procesadas"}