from sqlalchemy import Column, Integer, Float, String, Date
from database import Base
from datetime import date

class Pedido(Base):
    __tablename__ = "pedidos"

    id = Column(Integer, primary_key=True, index=True) 
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

    id = Column(Integer, primary_key=True, index=True)
    telefono = Column(String, unique=True, index=True, nullable=False)
    nombre = Column(String, nullable=False)
    cedula = Column(String, nullable=True)
    # Guardaremos las direcciones extra como un texto JSON (string)
    direcciones_extra = Column(String, default="[]")