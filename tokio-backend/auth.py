import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Header

SECRET_KEY = os.getenv("JWT_SECRET_KEY")
ALGORITHM = "HS256"
EXPIRE_HOURS = 12


# --- Hash y verificación de PIN ---
def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def pin_es_hash(valor: str) -> bool:
    return bool(valor) and valor.startswith(("$2a$", "$2b$", "$2y$"))


def verificar_pin(pin_plano: str, valor_guardado: str) -> bool:
    if not valor_guardado:
        return False
    if pin_es_hash(valor_guardado):
        try:
            return bcrypt.checkpw(pin_plano.encode("utf-8"), valor_guardado.encode("utf-8"))
        except ValueError:
            return False
    # Legado: PIN aún en texto plano (se rehashea en el login si coincide)
    return pin_plano == valor_guardado


# --- JWT ---
def crear_token(username: str, rol: str) -> str:
    payload = {
        "sub": username,
        "rol": rol,
        "exp": datetime.now(timezone.utc) + timedelta(hours=EXPIRE_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _decodificar(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No autenticado")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesión expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


def requiere_staff(authorization: str = Header(default=None)) -> dict:
    return _decodificar(authorization)


def requiere_admin(authorization: str = Header(default=None)) -> dict:
    payload = _decodificar(authorization)
    if payload.get("rol", "").lower() not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Requiere privilegios de administrador")
    return payload
