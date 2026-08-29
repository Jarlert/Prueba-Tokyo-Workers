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

    `request.client.host` no es la IP del visitante sino la del proxy de Railway,
    y en la práctica variaba entre peticiones: cada una creaba una clave nueva y
    el límite no llegaba a aplicarse nunca (se comprobó en producción con 24
    peticiones seguidas contra un límite de 20 y ninguna fue rechazada).

    Se toma la ÚLTIMA entrada de X-Forwarded-For, no la primera. La cabecera
    tiene el formato "cliente, proxy1, proxy2", y un atacante puede enviar la
    suya propia para falsear el inicio de la cadena; el proxy le añade al final
    la IP real desde la que le llegó la conexión. Con un solo proxy delante
    —que es el caso— la última entrada es la única que no se puede falsificar.
    """
    reenviadas = request.headers.get("x-forwarded-for", "")
    if reenviadas:
        candidatas = [parte.strip() for parte in reenviadas.split(",") if parte.strip()]
        if candidatas:
            return candidatas[-1]

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
