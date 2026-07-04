from sqlalchemy import Column, Integer, Float, String, Date, Boolean
from database import Base
from datetime import date

class Pedido(Base):
    __tablename__ = "pedidos"

    id = Column("id_pedido", Integer, primary_key=True, index=True) 
    
    cliente = Column(String, nullable=True)
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

class TasaManual(Base):
    __tablename__ = "tasa_manual"

    id = Column(Integer, primary_key=True, index=True)
    tasa = Column(Float, nullable=False)
    fecha = Column(Date, default=date.today, unique=True)

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
    imagen = Column(String, nullable=True)

class Combo(Base):
    __tablename__ = "combos"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    precio = Column(Float, nullable=False)
    descripcion = Column(String, nullable=True)
    imagen = Column(String, nullable=True)
    items_json = Column(String, nullable=True)
    disponible = Column(Boolean, default=True)

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