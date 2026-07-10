import time
from collections import defaultdict

from fastapi import HTTPException, Request

# Nota: contador en memoria de un solo proceso. No persiste entre reinicios/deploys
# y no se comparte entre instancias si en el futuro se escala horizontalmente.
_intentos: dict[str, list[float]] = defaultdict(list)


def limitador(max_intentos: int, ventana_seg: int):
    def _dep(request: Request):
        ip = request.client.host if request.client else "desconocido"
        clave = f"{request.url.path}:{ip}"
        ahora = time.time()
        ventana = _intentos[clave]
        ventana[:] = [t for t in ventana if ahora - t < ventana_seg]
        if len(ventana) >= max_intentos:
            raise HTTPException(status_code=429, detail="Demasiados intentos, espera un momento.")
        ventana.append(ahora)

    return _dep
