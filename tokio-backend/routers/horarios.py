from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
import schemas
from auth import requiere_admin
from database import get_db

router = APIRouter(
    prefix="/api/horarios",
    tags=["Horarios"]
)

DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]


def esta_abierto_ahora(db: Session) -> bool:
    ahora = datetime.now()
    registro = db.query(models.HorarioAtencion).filter(
        models.HorarioAtencion.dia_semana == ahora.weekday()
    ).first()

    if not registro or not registro.activo or not registro.hora_apertura or not registro.hora_cierre:
        return False

    hora_actual = ahora.strftime("%H:%M")
    return registro.hora_apertura <= hora_actual <= registro.hora_cierre


@router.get("/")
def obtener_horarios(db: Session = Depends(get_db)):
    horarios = db.query(models.HorarioAtencion).order_by(models.HorarioAtencion.dia_semana).all()
    return [
        {
            "dia_semana": h.dia_semana,
            "dia_nombre": DIAS_SEMANA[h.dia_semana],
            "activo": h.activo,
            "hora_apertura": h.hora_apertura,
            "hora_cierre": h.hora_cierre,
        }
        for h in horarios
    ]


@router.post("/guardar")
def guardar_horarios(datos: schemas.HorariosGuardar, db: Session = Depends(get_db), admin: dict = Depends(requiere_admin)):
    for dia in datos.horarios:
        registro = db.query(models.HorarioAtencion).filter(
            models.HorarioAtencion.dia_semana == dia.dia_semana
        ).first()
        if registro:
            registro.activo = dia.activo
            registro.hora_apertura = dia.hora_apertura
            registro.hora_cierre = dia.hora_cierre
        else:
            db.add(models.HorarioAtencion(
                dia_semana=dia.dia_semana,
                activo=dia.activo,
                hora_apertura=dia.hora_apertura,
                hora_cierre=dia.hora_cierre,
            ))
    db.commit()
    return {"success": True}
