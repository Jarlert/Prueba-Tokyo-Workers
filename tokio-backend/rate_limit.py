import time
from collections import defaultdict

from fastapi import HTTPException, Request

# Nota: contador en memoria de un solo proceso. No persiste entre reinicios/deploys
# y no se comparte entre instancias si en el futuro se escala horizontalmente.
_intentos: dict[str, list[float]] = defaultdict(list)

# Cada IP que toca un endpoint limitado crea su propia clave "ruta:ip", y antes
# esas claves no se borraban nunca: solo se vaciaba su lista de marcas de tiempo.
# En un endpoint público como /api/clientes/verificar eso significa una entrada
# permanente por visitante hasta el siguiente reinicio. Se barren cada tanto.
_INTERVALO_BARRIDO_SEG = 300
_VIDA_MAXIMA_CLAVE_SEG = 3600  # holgado: la ventana más larga en uso es de 60 s
_proximo_barrido = 0.0


def _barrer_claves_vencidas(ahora: float) -> None:
    global _proximo_barrido
    if ahora < _proximo_barrido:
        return
    _proximo_barrido = ahora + _INTERVALO_BARRIDO_SEG

    # marcas[-1] es la más reciente porque siempre se agregan en orden
    vencidas = [
        clave for clave, marcas in _intentos.items()
        if not marcas or ahora - marcas[-1] > _VIDA_MAXIMA_CLAVE_SEG
    ]
    for clave in vencidas:
        del _intentos[clave]


def _ip_cliente(request: Request) -> str:
    """IP real del visitante, teniendo en cuenta que corremos detrás de un proxy.

    `request.client.host` no sirve: no es la IP del visitante sino la del salto
    interno de Railway, y varía entre peticiones. Cada una generaba una clave
    distinta y el límite nunca llegaba a aplicarse (comprobado en producción:
    24 peticiones seguidas contra un límite de 20, ningún 429).

    El orden de preferencia importa por seguridad:

    1. `X-Envoy-External-Address`. Railway enruta con Envoy, que la fija con la
       IP real desde la que entró la conexión y sobrescribe cualquier valor que
       mande el cliente. Es la única que no se puede falsificar.
    2. Primera entrada de `X-Forwarded-For`, solo como respaldo. Se comprobó que
       Railway deja pasar esta cabecera tal cual la envíe el cliente, así que
       por sí sola es falsificable y no debe usarse mientras exista la anterior.
    3. `request.client.host`, último recurso.
    """
    envoy = request.headers.get("x-envoy-external-address", "").strip()
    if envoy:
        return envoy

    reenviadas = request.headers.get("x-forwarded-for", "")
    if reenviadas:
        candidatas = [parte.strip() for parte in reenviadas.split(",") if parte.strip()]
        if candidatas:
            return candidatas[0]

    return request.client.host if request.client else "desconocido"


def limitador(max_intentos: int, ventana_seg: int):
    def _dep(request: Request):
        ip = _ip_cliente(request)
        clave = f"{request.url.path}:{ip}"
        ahora = time.time()
        _barrer_claves_vencidas(ahora)
        ventana = _intentos[clave]
        ventana[:] = [t for t in ventana if ahora - t < ventana_seg]
        if len(ventana) >= max_intentos:
            raise HTTPException(status_code=429, detail="Demasiados intentos, espera un momento.")
        ventana.append(ahora)

    return _dep
