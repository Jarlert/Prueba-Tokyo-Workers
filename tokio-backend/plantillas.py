# -*- coding: utf-8 -*-
"""Textos por defecto de los mensajes de WhatsApp.

Viven aquí (y no dentro de un router) para que las migraciones puedan
sembrarlos en la tabla `mensajes_whatsapp` sin importar rutas ni base de datos.
Una vez sembrados, el restaurante los edita desde el panel de administración y
esta copia solo sirve de respaldo si la fila llegara a faltar.
"""

# Aviso al grupo de motorizados. Copia el formato que el restaurante escribía a
# mano desde siempre, con emojis para que se lea de un vistazo en el teléfono.
# Los corchetes los rellena routers/pedidos.py al despachar el pedido.
PLANTILLA_AVISO_MOTORIZADOS = (
    "🛵 *PEDIDO N° [PEDIDO]*\n"
    "\n"
    "👤 *NOMBRE:* [NOMBRE]\n"
    "\n"
    "📍 *DIRECCIÓN:* [DIRECCION]\n"
    "\n"
    "🥤 *REFRESCO:* [REFRESCOS]\n"
    "\n"
    "🍱 *BANDEJAS:* [BANDEJAS]\n"
    "\n"
    "📦 *CAJAS DE PIZZA:* [CAJAS_PIZZA]\n"
    "\n"
    "💵 *PAGO:* [PAGO]\n"
    "\n"
    "🏍️ *PRECIO DEL DELIVERY:* [PRECIO_DELIVERY]"
)
