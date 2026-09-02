import os

from fastapi import APIRouter, Depends, HTTPException
from datetime import date, datetime
from sqlalchemy.orm import Session
from database import get_db
import json
import pusher
import models
import schemas
from auth import requiere_staff
from routers.horarios import esta_abierto_ahora
from services.evolution_api import enviar_whatsapp

router = APIRouter(
    prefix="/api/pedidos",
    tags=["Pedidos"]
)

# Configuramos el megáfono de Pusher
pusher_client = pusher.Pusher(
  app_id=os.getenv("PUSHER_APP_ID"),
  key=os.getenv("PUSHER_KEY"),
  secret=os.getenv("PUSHER_SECRET"),
  cluster=os.getenv("PUSHER_CLUSTER"),
  ssl=True
)


def aplicar_placeholders(texto: str, placeholders: dict) -> str:
    for clave, valor in placeholders.items():
        texto = texto.replace(clave, str(valor))
    return texto


async def notificar_whatsapp(destino: str, mensaje: str, contexto: str) -> tuple[bool, str | None]:
    try:
        await enviar_whatsapp(destino, mensaje)
        return True, None
    except Exception as e:
        print(f"Error enviando WhatsApp de {contexto}: {e}")
        return False, str(e)

@router.post("/")
async def crear_pedido(pedido: schemas.PedidoCreate, db: Session = Depends(get_db)):

    if not esta_abierto_ahora(db):
        raise HTTPException(status_code=403, detail="El restaurante está cerrado en este momento. Intenta durante el horario de atención.")

    # 1. Leer la tasa central directamente de la BD (pizarra central)
    registro_tasa = db.query(models.TasaManual).first()
    tasa_actual = registro_tasa.tasa if registro_tasa else 1.0

    # Buscamos la cédula/RIF del cliente registrado para dejarla en el pedido
    cliente_db = db.query(models.Cliente).filter(models.Cliente.telefono == pedido.telefono).first()
    cedula_cliente = cliente_db.cedula if cliente_db else None

    # 2. Calcular el total de forma segura consultando la BD, y de paso
    # traer la descripcion de cada articulo para el resumen (punto 2.5)
    total_dolares = 0.0
    resumen_articulos = []
    for item in pedido.articulos:
        precio_seguro = 0.0
        descripcion_item = ""

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
                descripcion_item = producto_db.descripcion or ""

        elif tipo_item == "c":
            # Es un combo
            combo_db = db.query(models.Combo).filter(models.Combo.id == db_id).first()
            if combo_db:
                precio_seguro = combo_db.precio
                descripcion_item = combo_db.descripcion or ""

        # Sistema de respaldo: Si borraste el producto de la BD mientras el cliente compraba, usamos su precio temporal
        if precio_seguro == 0.0:
            precio_seguro = item.price

        # Sumamos la cantidad multiplicada por el precio INHACKEABLE de tu base de datos
        total_dolares += (precio_seguro * item.qty)

        # 2.5 Replicamos la lógica de n8n para armar el texto del resumen
        nota = f" (Nota: {item.note})" if item.note else ""
        desc_texto = f"\n{descripcion_item}" if descripcion_item else ""
        resumen_articulos.append(f"{item.qty}x {item.name} (${item.price:.2f}){nota}{desc_texto}")

    # Un salto de línea por artículo (y otro más para su descripción, si tiene) para que
    # tanto el tablero como el modal de edición ("Editar Pedido" en app.js parsea línea por
    # línea buscando "Nx Nombre ($precio)") puedan diferenciar cada renglón.
    texto_detallado = "\n".join(resumen_articulos)

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
        cedula=cedula_cliente,
        procesado_por="Sistema Automatizado",
        referencia_pago=None if pedido.metodo_pago in ["Efectivo", "Punto de Venta"] else "Pendiente",
        
        # Le inyectamos la tasa que acabamos de leer de la pizarra central
        tasa_bcv=tasa_actual,

        timestamp=datetime.now().isoformat(),
        fecha=date.today()
    )

    db.add(nuevo_pedido)
    db.commit()
    db.refresh(nuevo_pedido)

    # A. Calcular el ID visual (contamos cuántos pedidos hay HOY en la base de datos)
    pedidos_de_hoy = db.query(models.Pedido).filter(models.Pedido.fecha == date.today()).count()
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
            # CORRECCIÓN 2: Formateamos solo el número.
            total_bs = total_dolares * tasa_actual
            numero_bs_str = f"{total_bs:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
            mensaje_cliente = aplicar_placeholders(plantilla.texto, {
                "[CLIENTE]": pedido.cliente,
                "[PEDIDO_DETALLADO]": texto_detallado,
                "[PEDIDO]": id_visual,
                # CORRECCIÓN 1: Quitamos el "$" porque tu plantilla en la BD ya lo tiene
                "[TOTAL_USD]": f"{total_dolares:.2f}",
                "[TOTAL_BS]": numero_bs_str,
            })
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
            mensaje_cliente = aplicar_placeholders(plantilla.texto, {
                "[CLIENTE]": pedido.cliente,
                "[PEDIDO]": id_visual,
            })
        else:
            mensaje_cliente = f"🍣 ¡Hola, {pedido.cliente}! Hemos recibido tu pedido #{id_visual}. En breve calcularemos el delivery."

    # Disparamos el mensaje procesado
    await notificar_whatsapp(pedido.telefono, mensaje_cliente, "nuevo pedido")

    return {"success": True}

@router.get("/")
def obtener_pedidos(
    _t: str = None,
    fecha: str = None,
    fecha_desde: str = None,
    fecha_hasta: str = None,
    db: Session = Depends(get_db),
    staff: dict = Depends(requiere_staff),
):
    query = db.query(models.Pedido)

    if fecha:
        try:
            f = datetime.strptime(fecha, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de fecha inválido (YYYY-MM-DD)")
        query = query.filter(models.Pedido.fecha == f).order_by(models.Pedido.id.asc())
    elif fecha_desde or fecha_hasta:
        try:
            if fecha_desde:
                query = query.filter(models.Pedido.fecha >= datetime.strptime(fecha_desde, "%Y-%m-%d").date())
            if fecha_hasta:
                query = query.filter(models.Pedido.fecha <= datetime.strptime(fecha_hasta, "%Y-%m-%d").date())
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de fecha inválido (YYYY-MM-DD)")
        query = query.order_by(models.Pedido.id.asc())
    else:
        # Sin filtro de fecha: tablero de cocina en vivo, solo los pedidos recientes
        query = query.order_by(models.Pedido.id.desc()).limit(150)

    pedidos = query.all()

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
def actualizar_estado(datos: dict, db: Session = Depends(get_db), staff: dict = Depends(requiere_staff)):
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

# ==========================================
# FUNCION EXTRA: Traductor de ID de Base de Datos a ID Diario
# ==========================================
def obtener_id_diario(db: Session, db_id_str: str):
    try:
        db_id = int(db_id_str)
        pedido_db = db.query(models.Pedido).filter(models.Pedido.id == db_id).first()
        if not pedido_db:
            return str(db_id_str)

        if pedido_db.fecha:
            # Cuenta cuántos pedidos hay ese día hasta llegar a este (esto da el número diario real)
            conteo = db.query(models.Pedido).filter(
                models.Pedido.fecha == pedido_db.fecha,
                models.Pedido.id <= db_id
            ).count()
            return str(conteo)
        elif pedido_db.timestamp:
            # Fallback para filas que por algún motivo no tengan 'fecha' poblada
            fecha_str = pedido_db.timestamp[:10]
            conteo = db.query(models.Pedido).filter(
                models.Pedido.timestamp.like(f"{fecha_str}%"),
                models.Pedido.id <= db_id
            ).count()
            return str(conteo)
    except Exception:
        pass
    # Si falla algo, devuelve el ID original por seguridad
    return str(db_id_str)

@router.post("/notificar-edicion")
async def notificar_edicion_pedido(datos: schemas.NotificacionEdicion, db: Session = Depends(get_db), staff: dict = Depends(requiere_staff)):
    
    id_diario = obtener_id_diario(db, getattr(datos, 'id_visual', ''))

    plantilla = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == 'modificado').first()

    if plantilla:
        mensaje = aplicar_placeholders(plantilla.texto, {
            "[CLIENTE]": datos.cliente,
            "[PEDIDO_DETALLADO]": datos.pedido_detallado,
            "[TOTAL_USD]": f"{datos.total_orden:g}",
            "[PEDIDO]": id_diario,
        })
        if datos.texto_bolivares:
            mensaje += f"\n{datos.texto_bolivares}"
    else:
        mensaje = (
            f"⚠️ ¡Hola {datos.cliente}! Hemos actualizado tu orden.\n\n"
            f"{datos.pedido_detallado}\n\n"
            f"💰 Nuevo Total: ${datos.total_orden:g}{datos.texto_bolivares}"
        )

    exito, error = await notificar_whatsapp(datos.telefono, mensaje, "edición de pedido")
    if exito:
        return {"success": True, "mensaje": "Notificación dinámica enviada"}
    return {"success": False, "error": error}


@router.post("/notificar-cobro")
async def notificar_cobro_pedido(datos: schemas.NotificacionCobro, db: Session = Depends(get_db), staff: dict = Depends(requiere_staff)):
    
    id_diario = obtener_id_diario(db, getattr(datos, 'id_visual', ''))
    
    metodo_lower = datos.metodo_pago.lower()
    if "movil" in metodo_lower or "móvil" in metodo_lower:
        plantilla_id = "cobro_pago_movil"
    elif "zelle" in metodo_lower:
        plantilla_id = "cobro_zelle"
    else:
        plantilla_id = "cobro_efectivo"

    plantilla = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == plantilla_id).first()

    if plantilla:
        mensaje = aplicar_placeholders(plantilla.texto, {
            "[CLIENTE]": datos.cliente,
            "[PEDIDO_DETALLADO]": datos.pedido_detallado,
            "[TOTAL_USD]": f"{datos.total_orden:g}",
            "[TOTAL_BS]": datos.total_bs,
            "[PEDIDO]": id_diario,
        })
    else:
        mensaje = f"Hola {datos.cliente}, tu pedido está listo. Total: ${datos.total_orden:g}."

    exito, error = await notificar_whatsapp(datos.telefono, mensaje, "cobro")
    if exito:
        return {"success": True, "mensaje": f"Cobro enviado usando plantilla: {plantilla_id}"}
    return {"success": False, "error": error}


@router.post("/notificar-aprobado")
async def notificar_aprobado_pedido(datos: schemas.NotificacionAprobado, db: Session = Depends(get_db), staff: dict = Depends(requiere_staff)):
    
    id_diario = obtener_id_diario(db, getattr(datos, 'id_visual', ''))
    
    plantilla = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == 'aprobado').first()

    if plantilla:
        tiempo_str = datos.tiempo_estimado if "minuto" in datos.tiempo_estimado.lower() else f"{datos.tiempo_estimado} minutos"
        mensaje = aplicar_placeholders(plantilla.texto, {
            "[CLIENTE]": datos.cliente,
            "[PEDIDO]": id_diario,
            "[TIEMPO_ESTIMADO]": tiempo_str,
        })
    else:
        mensaje = f"¡Hola {datos.cliente}! ✅ Tu pago ha sido aprobado. Tu pedido ya está preparándose y estará listo en {datos.tiempo_estimado} minutos aproximadamente."

    exito, error = await notificar_whatsapp(datos.telefono, mensaje, "aprobación")
    if exito:
        return {"success": True, "mensaje": "Notificación de aprobación enviada"}
    return {"success": False, "error": error}


@router.post("/notificar-despacho")
async def notificar_despacho_pedido(datos: schemas.NotificacionDespacho, db: Session = Depends(get_db), staff: dict = Depends(requiere_staff)):
    
    id_diario = obtener_id_diario(db, getattr(datos, 'id_visual', ''))
    
    # --- 1. MENSAJE AL CLIENTE ---
    if "delivery" in datos.tipo_entrega.lower():
        plantilla_id = "final_delivery"
    else:
        plantilla_id = "final_pickup"
        
    plantilla_cliente = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == plantilla_id).first()

    if plantilla_cliente:
        mensaje_cliente = aplicar_placeholders(plantilla_cliente.texto, {
            "[CLIENTE]": datos.cliente,
            "[PEDIDO]": id_diario,
        })
    else:
        mensaje_cliente = f"¡Hola {datos.cliente}! Tu pedido ({datos.tipo_entrega}) está listo y despachado."

    await notificar_whatsapp(datos.telefono, mensaje_cliente, "despacho al cliente")

    # --- 2. MENSAJE AL GRUPO DE MOTORIZADOS (Solo si es Delivery) ---
    if "delivery" in datos.tipo_entrega.lower():
        plantilla_grupo = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == 'aviso_grupo_delivery').first()

        if plantilla_grupo:
            mensaje_grupo = aplicar_placeholders(plantilla_grupo.texto, {
                "[PEDIDO]": id_diario,
                "[CLIENTE]": datos.cliente,
                "[DIRECCION]": datos.direccion,
            })
        else:
            mensaje_grupo = f"🛵 *NUEVO PEDIDO LISTO*\n\nEl pedido #{id_diario} a nombre de {datos.cliente} en {datos.direccion} está listo para ser entregado."

        ID_GRUPO_WHATSAPP = "120363409549131175@g.us"
        await notificar_whatsapp(ID_GRUPO_WHATSAPP, mensaje_grupo, "aviso al grupo de motorizados")

    return {"success": True, "mensaje": "Notificaciones procesadas"}
