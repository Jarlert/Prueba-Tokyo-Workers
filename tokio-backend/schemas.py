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

class LoginRequest(BaseModel):
    tipo: str
    username: str
    pin: str

class NotificacionEdicion(BaseModel):
    telefono: str
    cliente: str
    pedido_detallado: str
    total_orden: float
    texto_bolivares: str = ""
    id_visual: str = ""

class NotificacionCobro(BaseModel):
    telefono: str
    cliente: str
    pedido_detallado: str
    total_orden: float
    metodo_pago: str
    total_bs: str = ""
    id_visual: str = ""

class NotificacionAprobado(BaseModel):
    telefono: str
    cliente: str
    tiempo_estimado: str
    id_visual: str = ""

class NotificacionDespacho(BaseModel):
    telefono: str
    cliente: str
    tipo_entrega: str
    id_visual: str = ""
    direccion: str = ""

class UsuarioGuardar(BaseModel):
    id: Optional[int] = None
    nombre: str
    username: str
    pin: Optional[str] = None
    rol: str

class MotorizadoGuardar(BaseModel):
    id: Optional[int] = None
    nombre: str

class HorarioDia(BaseModel):
    dia_semana: int
    activo: bool
    hora_apertura: str
    hora_cierre: str

class HorariosGuardar(BaseModel):
    horarios: List[HorarioDia]

class CategoriaGuardar(BaseModel):
    id: Optional[int] = None
    nombre: str
    imagen: Optional[str] = ""

class ProductoGuardar(BaseModel):
    id: Optional[int] = None
    nombre: str
    categoria: str
    precio: float
    imagen: Optional[str] = ""
    descripcion: Optional[str] = ""
    disponible: bool = True
    agotado: bool = False
    disponible_desde: Optional[str] = None
    disponible_hasta: Optional[str] = None
    dias_disponibles: Optional[str] = None

class ComboGuardar(BaseModel):
    id: Optional[int] = None
    nombre: str
    categoria: Optional[str] = None
    precio: float
    imagen: Optional[str] = ""
    descripcion: Optional[str] = ""
    items: list = []
    disponible: bool = True
    promo_cantidad_minima: Optional[int] = None
    promo_producto_id: Optional[int] = None
    promo_producto_cantidad: Optional[int] = None
    disponible_desde: Optional[str] = None
    disponible_hasta: Optional[str] = None
    dias_disponibles: Optional[str] = None

class AnuncioGuardar(BaseModel):
    id: Optional[int] = None
    imagen: str
    titulo: Optional[str] = ""
    texto: Optional[str] = ""
    activo: bool = True
    orden: Optional[int] = 0
    producto_ref: Optional[str] = None

class ItemEliminar(BaseModel):
    id: int
    tipo: str