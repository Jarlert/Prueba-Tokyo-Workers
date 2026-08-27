from sqlalchemy import Column, Integer, Float, String, Date, Boolean
from database import Base
from datetime import date

class Pedido(Base):
    __tablename__ = "pedidos"

    id = Column("id_pedido", Integer, primary_key=True, index=True)

    cliente = Column(String, nullable=True)
    timestamp = Column(String, nullable=True)
    fecha = Column(Date, nullable=True, index=True)
    telefono = Column(String, nullable=True)
    tipo_entrega = Column(String, nullable=True)
    direccion = Column(String, nullable=True)
    metodo_pago = Column(String, nullable=True)
    pedido_detallado = Column(String, nullable=True) 
    total_orden = Column(Float)
    estado = Column(String)
    procesado_por = Column(String, nullable=True)
    referencia_pago = Column(String, nullable=True)
    imagen_pago = Column(String, nullable=True)
    repartidor = Column(String, nullable=True)
    tasa_bcv = Column(Float, nullable=True)

class HorarioAtencion(Base):
    __tablename__ = "horarios_atencion"
    id = Column(Integer, primary_key=True, index=True)
    dia_semana = Column(Integer, unique=True, nullable=False, index=True)  # 0=lunes ... 6=domingo
    activo = Column(Boolean, default=True)
    hora_apertura = Column(String, nullable=True)  # formato "HH:MM"
    hora_cierre = Column(String, nullable=True)    # formato "HH:MM"

class TasaManual(Base):
    __tablename__ = "tasa_manual"
    id = Column(Integer, primary_key=True, index=True)
    tasa = Column(Float)
    fecha = Column(String)

class Cliente(Base):
    __tablename__ = "clientes"

    telefono = Column(String, primary_key=True, index=True, nullable=False)
    
    nombre = Column(String, nullable=False)
    cedula = Column(String, nullable=True)
    direccion_principal = Column(String, nullable=True)
    direcciones_extra = Column(String, default="[]")

class Categoria(Base):
    __tablename__ = "categorias"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    imagen = Column(String, nullable=True)

class Producto(Base):
    __tablename__ = "productos"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    categoria = Column(String, nullable=False)
    precio = Column(Float, nullable=False)
    descripcion = Column(String, nullable=True)
    disponible = Column(Boolean, default=True)
    agotado = Column(Boolean, default=False)
    imagen = Column(String, nullable=True)
    disponible_desde = Column(String, nullable=True)  # "HH:MM", junto con disponible_hasta limita el horario diario
    disponible_hasta = Column(String, nullable=True)  # "HH:MM"
    dias_disponibles = Column(String, nullable=True)  # CSV "0,1,2" (0=lunes...6=domingo); NULL/"" = todos los días

class Combo(Base):
    __tablename__ = "combos"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    categoria = Column(String, nullable=True)
    precio = Column(Float, nullable=False)
    descripcion = Column(String, nullable=True)
    imagen = Column(String, nullable=True)
    items_json = Column(String, nullable=True)
    disponible = Column(Boolean, default=True)
    promo_cantidad_minima = Column(Integer, nullable=True)
    promo_producto_id = Column(Integer, nullable=True)
    promo_producto_cantidad = Column(Integer, nullable=True)
    disponible_desde = Column(String, nullable=True)  # "HH:MM"
    disponible_hasta = Column(String, nullable=True)  # "HH:MM"
    dias_disponibles = Column(String, nullable=True)  # CSV "0,1,2" (0=lunes...6=domingo); NULL/"" = todos los días

class Anuncio(Base):
    __tablename__ = "anuncios"
    id = Column(Integer, primary_key=True, index=True)
    imagen = Column(String, nullable=False)
    titulo = Column(String, nullable=True)
    texto = Column(String, nullable=True)
    activo = Column(Boolean, default=True)
    orden = Column(Integer, default=0)
    producto_ref = Column(String, nullable=True)  # "p_<id>" o "c_<id>"; NULL = anuncio solo informativo

class Motorizado(Base):
    __tablename__ = "motorizados"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)

class Usuario(Base):
    __tablename__ = "usuarios"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    pin = Column(String, nullable=False)
    nombre = Column(String, nullable=False)
    rol = Column(String, nullable=False)

class MensajeWhatsapp(Base):
    __tablename__ = "mensajes_whatsapp"
    
    # En tu base de datos, el 'id' es el nombre del evento (ej. 'recepcion')
    id = Column(String, primary_key=True, index=True)
    texto = Column(String)
