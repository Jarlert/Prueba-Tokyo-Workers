from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# Definimos cómo es un artículo individual
class ArticuloCarrito(BaseModel):
    name: str
    price: float
    qty: int
    note: Optional[str] = "" # Optional porque a veces no hay nota

class PedidoCreate(BaseModel):
    timestamp: datetime
    cliente: str
    telefono: str
    tipo_entrega: str
    direccion: str
    metodo_pago: str
    articulos: List[ArticuloCarrito] # Usamos la nueva clase aquí
    metadata_titular: str
    estado_inicial: str

class TasaManualCreate(BaseModel):
    tasa: float

class ClienteVerificar(BaseModel):
    telefono: str

class ClienteRegistro(BaseModel):
    telefono: str
    nombre: str
    cedula: str
    # Agrega otros campos si el formulario de registro los pide