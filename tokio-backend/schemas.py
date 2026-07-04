from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from typing import List, Optional

# Definimos cómo es un artículo individual
class ArticuloCarrito(BaseModel):
    id: str
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
    direccion_principal: str = ""
    direcciones_extra: str = "[]"

class ClienteActualizarDirecciones(BaseModel):
    telefono: str
    direccion_principal: Optional[str] = None
    direcciones_extra: Optional[str] = None