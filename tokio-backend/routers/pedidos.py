import os
import re

from fastapi import APIRouter, Depends, HTTPException
from datetime import date, datetime
from sqlalchemy.orm import Session
from database import get_db
import json
import pusher
import models
import schemas
from auth import requiere_staff, staff_opcional
from routers.horarios import esta_abierto_ahora
from services.evolution_api import enviar_whatsapp
from plantillas import PLANTILLA_AVISO_MOTORIZADOS

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

# ==========================================
# NUMERACION DIARIA (separada por tipo de entrega)
# ==========================================
# Delivery y pickup llevan cuadernos distintos: cada uno arranca en 1 cada dia.
# Asi, "pedido 12" es el doceavo delivery del dia, sin que los retiros en el
# local le corran el numero.

def es_entrega_pickup(tipo_entrega) -> bool:
    texto = (tipo_entrega or "").lower()
    return "pickup" in texto or "retiro" in texto


def buscar_pedido_por_id(db: Session, db_id_str):
    try:
        return db.query(models.Pedido).filter(models.Pedido.id == int(db_id_str)).first()
    except (TypeError, ValueError):
        return None


def contar_numero_diario(db: Session, pedido_db) -> int:
    """Cuantos pedidos del MISMO tipo van ese dia hasta este (incluido)."""
    if pedido_db.fecha:
        filtro_dia = models.Pedido.fecha == pedido_db.fecha
    elif pedido_db.timestamp:
        filtro_dia = models.Pedido.timestamp.like(f"{pedido_db.timestamp[:10]}%")
    else:
        return pedido_db.id

    filas = db.query(models.Pedido.tipo_entrega).filter(
        filtro_dia,
        models.Pedido.id <= pedido_db.id,
    ).all()

    buscado = es_entrega_pickup(pedido_db.tipo_entrega)
    return sum(1 for (tipo,) in filas if es_entrega_pickup(tipo) == buscado)


# ==========================================
# EMPAQUE: cuanto ocupa el pedido
# ==========================================
# Cada plato declara en el panel cuantas bandejas y cuantas cajas de pizza
# ocupa. Se suman por pedido y salen en el aviso al grupo de motorizados, para
# que sepan con que van a cargar. Los refrescos se cuentan aparte.
CATEGORIAS_REFRESCO = ("bebida", "refresco")


def _es_refresco(categoria) -> bool:
    texto = (categoria or "").lower()
    return any(clave in texto for clave in CATEGORIAS_REFRESCO)


def calcular_empaque(db: Session, articulos) -> dict:
    """Suma bandejas, cajas de pizza y refrescos de una lista de articulos.

    Acepta objetos del schema (con .id / .qty) y tambien diccionarios crudos,
    porque el tablero manda el carrito de la edicion como JSON pelado.
    Las lineas que no son un plato real (manuales "custom_0_1", regalos de un
    producto ya borrado) simplemente no suman nada.
    """
    totales = {"bandejas": 0, "cajas_pizza": 0, "refrescos": 0}

    for art in articulos or []:
        if isinstance(art, dict):
            id_item, cantidad_cruda = art.get("id"), art.get("qty")
        else:
            id_item, cantidad_cruda = getattr(art, "id", None), getattr(art, "qty", None)

        try:
            cantidad = int(cantidad_cruda)
        except (TypeError, ValueError):
            continue
        if cantidad <= 0:
            continue

        partes = str(id_item or "").split("_")
        if len(partes) < 2 or not partes[1].isdigit():
            continue

        tipo_item, db_id = partes[0], int(partes[1])
        if tipo_item == "p":
            fila = db.query(models.Producto).filter(models.Producto.id == db_id).first()
            if fila and _es_refresco(fila.categoria):
                totales["refrescos"] += cantidad
        elif tipo_item == "c":
            fila = db.query(models.Combo).filter(models.Combo.id == db_id).first()
        else:
            continue

        if not fila:
            continue

        # 'bandejas' puede venir en NULL en filas viejas: por defecto ocupa una.
        bandejas = fila.bandejas if fila.bandejas is not None else 1
        totales["bandejas"] += bandejas * cantidad
        totales["cajas_pizza"] += (fila.cajas_pizza or 0) * cantidad

    return totales


# Precio de una linea segun cuantas unidades lleva. Si el plato tiene precio por
# paquete se cobran los paquetes completos y el resto suelto: las lumpias van a
# $0,60 la suelta y $1,50 el par, asi que 5 lumpias son 2 pares + 1 suelta.
# Sin paquete configurado (0 o vacio) se cobra el precio unitario de siempre.
def precio_de_linea(precio_unitario, cantidad, precio_paquete=None, cantidad_paquete=None) -> float:
    try:
        por_paquete = float(precio_paquete or 0)
        tam_paquete = int(cantidad_paquete or 0)
    except (TypeError, ValueError):
        por_paquete, tam_paquete = 0.0, 0

    if por_paquete > 0 and tam_paquete > 1 and cantidad > 0:
        paquetes, sueltas = divmod(int(cantidad), tam_paquete)
        return paquetes * por_paquete + sueltas * float(precio_unitario)

    return float(precio_unitario) * cantidad


def _campo_articulo(articulo, nombre, por_defecto=None):
    """Lee un campo del articulo venga como objeto del schema o como dict crudo.

    Al crear el pedido los articulos llegan validados por Pydantic; al editar
    llegan como JSON pelado desde la caja.
    """
    if isinstance(articulo, dict):
        return articulo.get(nombre, por_defecto)
    return getattr(articulo, nombre, por_defecto)


def construir_resumen_pedido(db: Session, articulos) -> tuple[str, float]:
    """Arma el texto del pedido y su total leyendo los precios de la base.

    Nunca se confia en el precio que manda el navegador, salvo en tres casos:
    el plato ya no existe en la base (lo borraron mientras compraban), la linea
    es un renglon escrito a mano por el cajero ("custom_0_1"), o es el regalo de
    una promocion, que va marcado y se cobra en cero.

    Un salto de linea por articulo (y otro para su descripcion, si tiene): el
    tablero y las estadisticas leen este texto renglon por renglon buscando
    "Nx Nombre ($precio)".
    """
    total_dolares = 0.0
    resumen_articulos = []

    for item in articulos or []:
        id_item = str(_campo_articulo(item, "id", "") or "")
        nombre_item = _campo_articulo(item, "name", "") or ""
        nota_item = _campo_articulo(item, "note", "") or ""
        precio_cliente = float(_campo_articulo(item, "price", 0) or 0)
        es_regalo = bool(_campo_articulo(item, "esRegalo", False))

        try:
            cantidad = int(_campo_articulo(item, "qty", 0) or 0)
        except (TypeError, ValueError):
            continue
        if cantidad <= 0:
            continue

        precio_seguro = 0.0
        descripcion_item = ""
        precio_paquete = None
        cantidad_paquete = 0

        # Separamos el prefijo del ID real.
        # Ej: De "p_5" sacamos ["p", "5"]. De "c_1_Roles_Bebidas" sacamos ["c", "1", "Roles", "Bebidas"]
        partes_id = id_item.split("_")
        tipo_item = partes_id[0] if partes_id else ""
        db_id = int(partes_id[1]) if len(partes_id) > 1 and partes_id[1].isdigit() else 0

        if tipo_item == "p" and db_id:
            # Es un producto normal
            producto_db = db.query(models.Producto).filter(models.Producto.id == db_id).first()
            if producto_db:
                precio_seguro = producto_db.precio
                descripcion_item = producto_db.descripcion or ""
                precio_paquete = producto_db.precio_paquete
                cantidad_paquete = producto_db.cantidad_paquete

        elif tipo_item == "c" and db_id:
            # Es un combo
            combo_db = db.query(models.Combo).filter(models.Combo.id == db_id).first()
            if combo_db:
                precio_seguro = combo_db.precio
                descripcion_item = combo_db.descripcion or ""

        if es_regalo:
            # El regalo de "compra N y llevate uno" viaja como un producto normal.
            # Si le pusieramos el precio de la base dejaria de ser un regalo: el
            # carrito se lo mostro al cliente en cero y en cero debe cobrarse.
            precio_seguro = 0.0
            precio_paquete, cantidad_paquete = None, 0
        elif precio_seguro == 0.0:
            # Respaldo: el plato ya no esta en la base, o es una linea a mano.
            precio_seguro = precio_cliente

        # Sumamos la linea con el precio INHACKEABLE de tu base de datos,
        # aplicando el precio por paquete si el plato lo tiene.
        total_linea = precio_de_linea(precio_seguro, cantidad, precio_paquete, cantidad_paquete)
        total_dolares += total_linea

        # Con precio por paquete el precio unitario no explica la cuenta, asi que
        # la linea muestra lo que de verdad se cobro por ella.
        hay_paquete = total_linea != precio_seguro * cantidad
        precio_mostrado = total_linea if hay_paquete else precio_seguro
        nota = f" (Nota: {nota_item})" if nota_item else ""
        desc_texto = f"\n{descripcion_item}" if descripcion_item else ""
        resumen_articulos.append(f"{cantidad}x {nombre_item} (${precio_mostrado:.2f}){nota}{desc_texto}")

    return "\n".join(resumen_articulos), total_dolares


@router.post("/")
async def crear_pedido(
    pedido: schemas.PedidoCreate,
    db: Session = Depends(get_db),
    staff: dict | None = Depends(staff_opcional),
):

    # El horario solo limita al cliente. El personal toma pedidos por teléfono
    # antes de abrir y esos tienen que poder entrar igual, así que un trabajador
    # con sesión iniciada se salta el cierre.
    if staff is None and not esta_abierto_ahora(db):
        raise HTTPException(status_code=403, detail="El restaurante está cerrado en este momento. Intenta durante el horario de atención.")

    # 1. Leer la tasa central directamente de la BD (pizarra central)
    registro_tasa = db.query(models.TasaManual).first()
    tasa_actual = registro_tasa.tasa if registro_tasa else 1.0

    # Buscamos la cédula/RIF del cliente registrado para dejarla en el pedido
    cliente_db = db.query(models.Cliente).filter(models.Cliente.telefono == pedido.telefono).first()
    cedula_cliente = cliente_db.cedula if cliente_db else None

    # 2. Calcular el total de forma segura consultando la BD y armar de paso el
    # texto del resumen. La misma funcion la usa /editar, para que un pedido
    # editado se lea y se cobre exactamente igual que uno recien hecho.
    texto_detallado, total_dolares = construir_resumen_pedido(db, pedido.articulos)

    # 2.6 Cuanto ocupa el pedido al empacarlo (para el aviso a motorizados)
    empaque = calcular_empaque(db, pedido.articulos)

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
        fecha=date.today(),

        # Lo que necesita el aviso al grupo de motorizados
        total_bandejas=empaque["bandejas"],
        total_cajas_pizza=empaque["cajas_pizza"],
        total_refrescos=empaque["refrescos"],
    )

    db.add(nuevo_pedido)
    db.commit()
    db.refresh(nuevo_pedido)

    # A. Numero que vera el cliente: el n-esimo pedido de HOY de su mismo tipo.
    # Delivery y pickup se numeran por separado, cada uno desde 1.
    id_visual = contar_numero_diario(db, nuevo_pedido)

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
    if "precio_delivery" in datos: pedido.precio_delivery = datos["precio_delivery"]
    if "paga_con" in datos: pedido.paga_con = datos["paga_con"]

    # Si la edicion nos manda el carrito, recalculamos cuanto ocupa el pedido.
    # Si no lo manda (la mayoria de las actualizaciones de estado), dejamos los
    # totales como estaban en vez de ponerlos en cero.
    if datos.get("articulos"):
        empaque = calcular_empaque(db, datos["articulos"])
        pedido.total_bandejas = empaque["bandejas"]
        pedido.total_cajas_pizza = empaque["cajas_pizza"]
        pedido.total_refrescos = empaque["refrescos"]

    db.commit()
    # --- NUEVO: Avisar al tablero que un pedido se movió ---
    try:
        pusher_client.trigger('canal-cocina', 'actualizar-tablero', {'mensaje': 'actualizacion'})
    except Exception as e:
        pass
    # -------------------------------------------------------
    return {"success": True}

@router.post("/editar")
def editar_pedido(datos: dict, db: Session = Depends(get_db), staff: dict = Depends(requiere_staff)):
    """Reescribe los articulos de un pedido que ya existe.

    El tablero ya no tiene su propio mini-menu para editar: el lapiz abre la
    caja (menu_trabajadores.html) con el pedido cargado, y de ahi sale este
    carrito completo. El texto y el total se rehacen con construir_resumen_pedido,
    la misma que usa crear_pedido, asi que un combo editado queda descrito igual
    que uno recien tomado y el precio lo sigue poniendo la base de datos.

    El telefono NO se toca: es la clave con la que el pedido se une a su cliente,
    y cambiarlo dejaria el historial huerfano. La tasa BCV tampoco: cada pedido
    guarda la del dia en que se creo.
    """
    pedido = buscar_pedido_por_id(db, datos.get("id"))
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")

    articulos = datos.get("articulos")
    if not articulos:
        raise HTTPException(status_code=400, detail="El pedido editado llego sin articulos")

    texto_detallado, total_dolares = construir_resumen_pedido(db, articulos)
    empaque = calcular_empaque(db, articulos)

    pedido.pedido_detallado = texto_detallado
    pedido.total_orden = total_dolares
    pedido.total_bandejas = empaque["bandejas"]
    pedido.total_cajas_pizza = empaque["cajas_pizza"]
    pedido.total_refrescos = empaque["refrescos"]

    for campo in ("cliente", "direccion", "metodo_pago", "procesado_por"):
        if datos.get(campo):
            setattr(pedido, campo, datos[campo])

    # Se lee antes del commit: despues el objeto queda expirado y volver a
    # tocarlo dispararia otra consulta.
    tasa_del_pedido = pedido.tasa_bcv or 0

    db.commit()

    try:
        pusher_client.trigger('canal-cocina', 'actualizar-tablero', {'mensaje': 'edicion'})
    except Exception:
        pass

    return {
        "success": True,
        "pedido_detallado": texto_detallado,
        "total_orden": total_dolares,
        "tasa_bcv": tasa_del_pedido,
    }


# ==========================================
# FUNCION EXTRA: Traductor de ID de Base de Datos a ID Diario
# ==========================================
def obtener_id_diario(db: Session, db_id_str: str):
    try:
        pedido_db = buscar_pedido_por_id(db, db_id_str)
        if not pedido_db:
            return str(db_id_str)
        return str(contar_numero_diario(db, pedido_db))
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

    # El tablero ya manda la frase completa ("25 a 30 minutos", "1 hora y 30
    # minutos"). Solo se le agrega la unidad si viniera un numero pelado, como
    # mandaba la version vieja del modal.
    tiempo_str = (datos.tiempo_estimado or "").strip()
    if tiempo_str and not re.search(r"minuto|hora", tiempo_str, re.IGNORECASE):
        tiempo_str = f"{tiempo_str} minutos"

    if plantilla:
        # Las plantillas viejas escribian "[TIEMPO_ESTIMADO] minutos", y ahora
        # el reemplazo ya trae la unidad: se quita la de la plantilla para que
        # no salga "25 a 30 minutos minutos".
        texto = re.sub(r"\[TIEMPO_ESTIMADO\]\s*(?:minutos|minuto|mins|min)\.?", "[TIEMPO_ESTIMADO]", plantilla.texto, flags=re.IGNORECASE)
        mensaje = aplicar_placeholders(texto, {
            "[CLIENTE]": datos.cliente,
            "[PEDIDO]": id_diario,
            "[TIEMPO_ESTIMADO]": tiempo_str,
        })
    else:
        mensaje = f"¡Hola {datos.cliente}! ✅ Tu pago ha sido aprobado. Tu pedido ya está preparándose y estará listo en {tiempo_str} aproximadamente."

    exito, error = await notificar_whatsapp(datos.telefono, mensaje, "aprobación")
    if exito:
        return {"success": True, "mensaje": "Notificación de aprobación enviada"}
    return {"success": False, "error": error}


# ==========================================
# AVISO AL GRUPO DE MOTORIZADOS
# ==========================================

def formatear_nombre_motorizado(telefono, cliente) -> str:
    """El grupo lee "8308     +58 416-3988308": los ultimos cuatro digitos y
    despues el numero completo. Es redundante a proposito; es como lo vienen
    escribiendo a mano desde siempre y no queremos que tengan que reaprender.
    """
    crudo = (telefono or "").strip()
    digitos = "".join(c for c in crudo if c.isdigit())
    if not digitos:
        return cliente or "Sin telefono"

    if crudo.startswith("+"):
        # Numero extranjero: ya viene en formato internacional, se deja igual.
        legible = crudo
    elif len(digitos) == 11 and digitos.startswith("0"):
        # Formato venezolano guardado: 04163988308 -> +58 416-3988308
        legible = f"+58 {digitos[1:4]}-{digitos[4:]}"
    else:
        legible = crudo

    return f"{digitos[-4:]}     {legible}"


def _texto_pago(pedido_db) -> str:
    """Si ya pago no hay nada que cobrar; si es efectivo, cuanto y con que
    billete pensaba pagar, para que el motorizado salga con el vuelto."""
    metodo = (getattr(pedido_db, "metodo_pago", "") or "").strip()

    if "efectivo" not in metodo.lower():
        return f"YA PAGO ({metodo})" if metodo else "YA PAGO"

    total = getattr(pedido_db, "total_orden", None)
    texto = "COBRAR EN EFECTIVO"
    if total is not None:
        texto += f" ${total:.2f}"

    paga_con = (getattr(pedido_db, "paga_con", "") or "").strip()
    if paga_con:
        texto += f" - paga con {paga_con}"
    return texto


def _numero_corto(valor) -> str:
    """2.0 -> "2", 2.5 -> "2.5" (asi lo escriben ellos: "2$")."""
    try:
        return f"{float(valor):g}"
    except (TypeError, ValueError):
        return str(valor)


def datos_aviso_motorizados(pedido_db, datos, id_diario) -> dict:
    """Arma los reemplazos de la plantilla del grupo. Si el pedido no aparece
    en la base de datos igual mandamos el aviso con lo que trae la peticion,
    porque quedarnos callados es peor que un dato incompleto."""
    telefono = getattr(pedido_db, "telefono", None) or datos.telefono
    direccion = (getattr(pedido_db, "direccion", None) or datos.direccion or "").strip()

    precio_delivery = getattr(pedido_db, "precio_delivery", None)
    texto_delivery = f"{_numero_corto(precio_delivery)}$" if precio_delivery is not None else "-"

    return {
        "[PEDIDO]": id_diario,
        "[NOMBRE]": formatear_nombre_motorizado(telefono, datos.cliente),
        "[CLIENTE]": datos.cliente,
        "[TELEFONO]": telefono or "",
        "[DIRECCION]": direccion or "Sin direccion",
        "[REFRESCOS]": getattr(pedido_db, "total_refrescos", None) or 0,
        "[BANDEJAS]": getattr(pedido_db, "total_bandejas", None) or 0,
        "[CAJAS_PIZZA]": getattr(pedido_db, "total_cajas_pizza", None) or 0,
        "[PAGO]": _texto_pago(pedido_db),
        "[PRECIO_DELIVERY]": texto_delivery,
    }


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
        pedido_db = buscar_pedido_por_id(db, getattr(datos, 'id_visual', ''))
        reemplazos = datos_aviso_motorizados(pedido_db, datos, id_diario)

        plantilla_grupo = db.query(models.MensajeWhatsapp).filter(models.MensajeWhatsapp.id == 'aviso_grupo_delivery').first()

        # Si la plantilla guardada todavía es la vieja (no menciona las
        # bandejas) usamos la nueva de fábrica, para que el grupo nunca reciba
        # un aviso a medias mientras el panel no se haya actualizado.
        texto_plantilla = (plantilla_grupo.texto if plantilla_grupo else "") or ""
        if "[BANDEJAS]" not in texto_plantilla:
            texto_plantilla = PLANTILLA_AVISO_MOTORIZADOS

        mensaje_grupo = aplicar_placeholders(texto_plantilla, reemplazos)

        ID_GRUPO_WHATSAPP = "120363403360852542@g.us"
        await notificar_whatsapp(ID_GRUPO_WHATSAPP, mensaje_grupo, "aviso al grupo de motorizados")

    return {"success": True, "mensaje": "Notificaciones procesadas"}
