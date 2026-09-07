// =============================================================================
// MENÚ DE TRABAJADORES  (menu_trabajadores.html)
//
// Esta pantalla reutiliza menu.js entero: el catálogo, el carrito, y sobre todo
// toda la personalización de combos (piezas, estilos, variantes, promociones).
// Aquí solo se reemplaza lo que cambia cuando quien arma el pedido no es el
// cliente sino la caja:
//
//   · la sesión es la del personal (JWT), no la del cliente por teléfono
//   · no hay pasos de login/registro ni popups de anuncios
//   · el horario del local no bloquea (el backend deja pasar al personal)
//   · el cierre pide los datos del cliente en vez de sacarlos de su cuenta
//   · hay buscador, y un renglón escrito a mano para admins
//
// Este archivo se carga DESPUÉS de menu.js a propósito: al declarar una función
// con el mismo nombre, la de aquí es la que queda. Si tocas una de las funciones
// listadas en "REEMPLAZOS" dentro de menu.js, revisa también su gemela de aquí.
// =============================================================================

// API_BASE viene de config.js, que se carga antes que este archivo.
const URL_BUSCAR_CLIENTES_TRAB = API_BASE + "/api/clientes/buscar";
const URL_CREAR_PEDIDO_TRAB = API_BASE + "/api/pedidos/";

let usuarioActivoTrabajador = null;
let contadorLineaManual = 0;
let _ultimoTelefonoBuscadoTrab = null;


// --- Sesión del personal -----------------------------------------------------

function esAdminTrabajador() {
    const rol = (usuarioActivoTrabajador && usuarioActivoTrabajador.rol || '').toLowerCase();
    return rol === 'admin' || rol === 'superadmin';
}

// La flecha de la cabecera retrocede un paso dentro del pedido. Para salir al
// tablero esta el boton "Tablero", que es lo que se espera de cada uno.
function retrocederPaso() {
    const activo = document.querySelector('.step.active');
    const paso = activo ? parseInt(String(activo.id).replace('step-', ''), 10) : 1;

    // Desde el cierre se vuelve a la lista de categorias, igual que hace el
    // boton "Anadir mas platos" del propio carrito.
    if (paso === 2 || paso === 3) goToStep(1);
    // En los pasos 1 y 4 no hay a donde volver: ahi la flecha esta oculta.
}

function volverAlTablero() {
    window.location.href = 'index.html';
}

function pintarBadgeUsuario() {
    const badge = document.getElementById('badge-usuario');
    if (!badge || !usuarioActivoTrabajador) return;

    let colorRol = 'bg-slate-500/10 text-slate-300 border-slate-500/20';
    if (usuarioActivoTrabajador.rol === 'superadmin') colorRol = 'bg-red-500/10 text-red-400 border-red-500/20';
    if (usuarioActivoTrabajador.rol === 'admin') colorRol = 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';

    badge.innerHTML = `
        <span class="text-[10px] uppercase text-slate-500 font-bold">Op:</span>
        <span class="text-xs font-bold text-white truncate max-w-[120px]">${escapeHtml(usuarioActivoTrabajador.nombre || '')}</span>
        <span class="text-[9px] uppercase font-mono font-bold px-1.5 py-0.5 rounded border ${colorRol} shrink-0">${escapeHtml(usuarioActivoTrabajador.rol || '')}</span>
    `;
}


// --- REEMPLAZOS de menu.js ---------------------------------------------------

// El personal no ve el popup de promociones; cargarMenuDesdeDB lo dispara solo,
// así que lo anulamos aquí en vez de tocar menu.js.
async function cargarYMostrarAnuncios() { /* intencionalmente vacío */ }

window.onload = async function() {
    const sesion = localStorage.getItem('usuarioActivo');
    const token = localStorage.getItem('tokioAuthToken');

    // Sin sesión de personal esta pantalla no tiene nada que hacer: al tablero,
    // que es donde se inicia sesión.
    if (!sesion || !token) {
        window.location.replace('index.html');
        return;
    }

    try {
        usuarioActivoTrabajador = JSON.parse(sesion);
    } catch (e) {
        window.location.replace('index.html');
        return;
    }

    pintarBadgeUsuario();

    // El renglón a mano deja escribir un precio libre, así que solo para admins.
    if (esAdminTrabajador()) {
        document.getElementById('bloque-linea-manual').classList.remove('hidden');
    }

    history.replaceState({ step: 1 }, "Categorías");
    await cargarMenuDesdeDB();
    goToStep(1, false);
};

window.onpopstate = function(event) {
    const paso = (event.state && event.state.step) ? event.state.step : 1;
    goToStep(paso, false);
};

function goToStep(stepNumber, pushState = true) {
    const destino = document.getElementById(`step-${stepNumber}`);
    if (!destino) return; // esta pantalla no tiene los pasos de login del cliente

    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    destino.classList.add('active');
    window.scrollTo(0, 0);

    // El buscador solo sirve mientras se agregan artículos.
    const barra = document.getElementById('barra-busqueda');
    if (barra) barra.classList.toggle('hidden', stepNumber === 3 || stepNumber === 4);

    // La flecha de atrás solo tiene sentido si hay un paso anterior. Se usa
    // `invisible` y no `hidden` para que el título no salte de sitio.
    const btnAtras = document.getElementById('btn-atras');
    if (btnAtras) btnAtras.classList.toggle('invisible', stepNumber === 1 || stepNumber === 4);

    // Al entrar a una categoría se cierra el buscador. Si el mismo plato quedara
    // pintado en los dos sitios habría dos elementos con el mismo id, y los
    // botones de cantidad actualizarían la tarjeta escondida en vez de la visible.
    if (stepNumber === 2) limpiarBusqueda(false);

    updateStickyBarVisibility(stepNumber);

    if (pushState) history.pushState({ step: stepNumber }, `Paso ${stepNumber}`);
}

// Mosaico de categorías pensado para PC: 4 por fila en pantallas grandes (las
// columnas las pone el contenedor en el HTML) y la foto mucho más grande que en
// el menú del cliente, que las muestra en una lista de una sola columna.
function renderizarCategorias() {
    const container = document.getElementById('contenedor-categorias');
    if (!container) return;
    container.innerHTML = '';

    const iconosRespaldo = ['🍱', '🍙', '🍣', '🥤', '🍰', '🥟', '🍤', '🔥'];
    let pintadas = 0;

    Object.keys(menuData).forEach((catKey, index) => {
        const catInfo = menuData[catKey];
        // Si el catálogo no llegó a cargar, menuData todavía trae su forma inicial
        // sin `items`. Aquí se repinta también al empezar un pedido nuevo, así que
        // no puede dar por hecho que ya hay menú.
        const itemsVisibles = (catInfo && catInfo.items ? catInfo.items : [])
            .filter(i => i.disponible !== false && !i.agotado && itemDentroDeHorarioProgramado(i));
        if (itemsVisibles.length === 0) return; // categorías que solo tienen piezas de combos

        let arteVisual;
        if (catInfo.imagen && catInfo.imagen.startsWith('http')) {
            // El recuadro mide 96px (w-24); 192 cubre pantallas 2x sin pasarse del
            // ancho con el que se suben estas imágenes (ANCHOS_SUBIDA en admin.js).
            arteVisual = `<img src="${urlImagen(catInfo.imagen, 192)}" data-original="${escapeHtml(catInfo.imagen)}" onerror="imagenConRespaldo(this)" alt="${escapeHtml(catInfo.titulo)}" loading="lazy" class="w-full h-full object-cover">`;
        } else {
            arteVisual = iconosRespaldo[index % iconosRespaldo.length];
        }

        container.insertAdjacentHTML('beforeend', `
            <button type="button" onclick="selectCategory('${catKey}')" class="bg-white rounded-2xl p-5 flex flex-col items-center gap-3 shadow-sm border-2 border-transparent hover:border-emerald-400 hover:shadow-lg transition cursor-pointer text-center">
                <div class="w-24 h-24 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center text-5xl flex-shrink-0 overflow-hidden">
                    ${arteVisual}
                </div>
                <div class="min-w-0 w-full">
                    <h3 class="font-bold text-slate-800 text-base leading-tight break-words">${escapeHtml(catInfo.titulo)}</h3>
                    <p class="text-xs text-slate-400 mt-1">${itemsVisibles.length} platos</p>
                </div>
            </button>
        `);
        pintadas++;
    });

    if (pintadas === 0) {
        container.innerHTML = '<div class="col-span-full text-center text-slate-400 text-sm py-10">No hay platos disponibles ahora mismo.</div>';
    }
}

// El checkout del cliente rellena datos de su cuenta; aquí el formulario es otro
// y lo llena el trabajador, así que solo se reaprovecha el resumen del carrito.
function prepareCheckout() {
    if (!renderizarResumenCarrito()) return;
    if (!document.getElementById('step-3').classList.contains('active')) goToStep(3);
}

// menu.js llama a resetForm desde su pantalla de "pedido enviado"; aquí el
// equivalente es empezar un pedido nuevo.
function resetForm() {
    reiniciarPedidoTrabajador();
}

// Si algo del motor del cliente intenta enviar el pedido, que use el nuestro.
function sendOrder(event) {
    return enviarPedidoTrabajador(event);
}


// --- Buscador ----------------------------------------------------------------

// Cierra el panel de resultados y devuelve las categorías, sin tocar lo escrito
// en la caja de búsqueda. Vaciar la lista es obligatorio: si quedaran tarjetas
// del mismo plato aquí y en el paso 2, habría ids repetidos en la página.
function ocultarResultadosBusqueda() {
    const panel = document.getElementById('resultados-busqueda');
    const cats = document.getElementById('vista-categorias');
    const lista = document.getElementById('lista-resultados');
    if (panel) panel.classList.add('hidden');
    if (cats) cats.classList.remove('hidden');
    if (lista) lista.innerHTML = '';
}

// Además borra lo escrito. `devolverFoco` va en false cuando la limpieza es un
// efecto secundario (entrar a una categoría, empezar un pedido nuevo) y no algo
// que el trabajador pidió.
function limpiarBusqueda(devolverFoco = true) {
    const input = document.getElementById('buscador-menu');
    if (input) input.value = '';

    const btn = document.getElementById('btn-limpiar-busqueda');
    if (btn) btn.classList.add('hidden');

    ocultarResultadosBusqueda();
    if (devolverFoco && input) input.focus();
}

function buscarEnMenuTrabajador() {
    const input = document.getElementById('buscador-menu');
    const texto = (input ? input.value : '').trim().toLowerCase();

    const panelResultados = document.getElementById('resultados-busqueda');
    const vistaCategorias = document.getElementById('vista-categorias');
    const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
    const vacio = document.getElementById('resultados-vacio');
    const lista = document.getElementById('lista-resultados');

    btnLimpiar.classList.toggle('hidden', texto.length === 0);

    // Con una sola letra saldría medio menú; a partir de dos ya filtra de verdad.
    if (texto.length < 2) {
        ocultarResultadosBusqueda();
        return;
    }

    if (!document.getElementById('step-1').classList.contains('active')) goToStep(1);

    // Mismo motivo que en goToStep: no puede haber dos tarjetas del mismo plato.
    const contenedorPaso2 = document.getElementById('items-container');
    if (contenedorPaso2) contenedorPaso2.innerHTML = '';

    const vistos = new Set();
    const encontrados = [];
    Object.keys(menuData).forEach(catKey => {
        // El buscador está visible desde que abre la pantalla, así que puede
        // usarse antes de que termine de bajar el catálogo.
        const items = (menuData[catKey] && menuData[catKey].items) || [];
        items.forEach(item => {
            if (item.disponible === false || item.agotado) return;
            if (!itemDentroDeHorarioProgramado(item)) return;
            if (vistos.has(item.id)) return;

            const nombre = String(item.name || '').toLowerCase();
            const desc = String(item.desc || '').toLowerCase();
            if (nombre.includes(texto) || desc.includes(texto)) {
                vistos.add(item.id);
                encontrados.push(item);
            }
        });
    });

    vistaCategorias.classList.add('hidden');
    panelResultados.classList.remove('hidden');
    document.getElementById('contador-resultados').innerText = encontrados.length;

    lista.innerHTML = encontrados.map(item => construirTarjetaItemHtml(item)).join('');
    vacio.classList.toggle('hidden', encontrados.length > 0);
}


// --- Búsqueda del cliente por teléfono ---------------------------------------

function _estadoClienteTrab(tipo, html) {
    const caja = document.getElementById('trab-estado-cliente');
    if (!caja) return;
    const estilos = {
        buscando: 'bg-slate-50 border-slate-200 text-slate-500',
        encontrado: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        nuevo: 'bg-amber-50 border-amber-200 text-amber-800',
        error: 'bg-red-50 border-red-200 text-red-800'
    };
    caja.className = `mt-1.5 text-xs px-2.5 py-2 rounded-lg border ${estilos[tipo] || estilos.buscando}`;
    caja.innerHTML = html;
}

// Permite volver a buscar el mismo numero tras un fallo (si no, el guard de
// "no repetir la consulta" impediria el reintento).
function _ultimoTelefonoBuscado_reintentable() {
    _ultimoTelefonoBuscadoTrab = null;
}

function _limpiarEstadoClienteTrab() {
    const caja = document.getElementById('trab-estado-cliente');
    if (caja) { caja.className = 'hidden'; caja.innerHTML = ''; }
    _ultimoTelefonoBuscadoTrab = null;
}

async function buscarClienteTrabajador() {
    const inputTel = document.getElementById('trab-telefono');
    const telefono = normalizarTelefono(inputTel.value);

    if (!telefono) { _limpiarEstadoClienteTrab(); return; }

    // Dejamos a la vista el número ya normalizado, que es el que se guardará.
    inputTel.value = telefono;

    // El onblur salta cada vez que sale del campo: no repetimos la consulta si
    // el número no cambió desde la última búsqueda.
    if (telefono === _ultimoTelefonoBuscadoTrab) return;
    _ultimoTelefonoBuscadoTrab = telefono;

    _estadoClienteTrab('buscando', '<i class="fa-solid fa-spinner fa-spin"></i> Buscando cliente...');

    try {
        const res = await fetch(`${URL_BUSCAR_CLIENTES_TRAB}?q=${encodeURIComponent(telefono)}`, { headers: authHeaders() });

        // Un 401 no es "no encontre al cliente": es que la sesion del trabajador
        // vencio. Decirlo claro evita pensar que el cliente no esta registrado.
        // No cerramos sesion solos porque se perderia el pedido a medio armar.
        if (sesionCaducada(res)) {
            _ultimoTelefonoBuscado_reintentable();
            _estadoClienteTrab('error',
                '<i class="fa-solid fa-lock"></i> <b>Tu sesión venció.</b> No se puede buscar al cliente. ' +
                'Termina este pedido a mano o <a href="index.html" class="underline font-bold">inicia sesión otra vez</a> ' +
                '(perderías lo que llevas en el carrito).');
            return;
        }

        if (!res.ok) throw new Error('Respuesta ' + res.status);

        const resultados = await res.json();
        // `buscar` hace LIKE, así que exigimos la coincidencia exacta del teléfono.
        const cliente = (Array.isArray(resultados) ? resultados : []).find(c => c.telefono === telefono);

        if (!cliente) {
            _estadoClienteTrab('nuevo',
                '<i class="fa-solid fa-user-plus"></i> <b>Cliente nuevo.</b> Este número no está registrado — pídele los datos y llénalos abajo.');
            return;
        }

        document.getElementById('trab-cliente').value = cliente.nombre || '';

        const inputDireccion = document.getElementById('trab-direccion');
        let notaDireccion = '';
        if (cliente.direccion_principal && !inputDireccion.value.trim()) {
            inputDireccion.value = cliente.direccion_principal;
            notaDireccion = ' Se cargó su dirección guardada.';
        }

        const detalles = [];
        if (cliente.cedula) detalles.push(escapeHtml(cliente.cedula));
        if (cliente.total_pedidos) detalles.push(`${cliente.total_pedidos} pedido${cliente.total_pedidos === 1 ? '' : 's'}`);

        _estadoClienteTrab('encontrado',
            `<i class="fa-solid fa-user-check"></i> <b>${escapeHtml(cliente.nombre || 'Cliente')}</b>` +
            (detalles.length ? ` <span class="opacity-70">· ${detalles.join(' · ')}</span>` : '') +
            notaDireccion);

    } catch (e) {
        console.error('Error buscando cliente:', e);
        // No bloqueamos el pedido: el trabajador puede llenar los datos a mano.
        _ultimoTelefonoBuscadoTrab = null; // permitimos reintentar
        _estadoClienteTrab('error',
            '<i class="fa-solid fa-triangle-exclamation"></i> No se pudo consultar la base de datos. Llena los datos a mano y continúa.');
    }
}


// --- Renglón escrito a mano (solo admin) -------------------------------------

function agregarLineaManual() {
    if (!esAdminTrabajador()) return; // el bloque está oculto, pero por si acaso

    const inputNombre = document.getElementById('manual-nombre');
    const inputPrecio = document.getElementById('manual-precio');
    const inputCantidad = document.getElementById('manual-cantidad');

    const nombre = inputNombre.value.trim();
    const precio = parseFloat(inputPrecio.value);
    const cantidad = parseInt(inputCantidad.value) || 1;

    if (!nombre) { alert('Escribe qué se está cobrando.'); inputNombre.focus(); return; }
    if (isNaN(precio) || precio < 0) { alert('Escribe un precio válido.'); inputPrecio.focus(); return; }

    // El resumen del carrito mete el nombre dentro de un onclick con comillas
    // simples, así que un apóstrofo dejaría los botones de +/- sin funcionar.
    // Cambiamos el apóstrofo por el tipográfico (se lee igual) y quitamos lo demás.
    const nombreLimpio = nombre.replace(/'/g, '’').replace(/["<>\\]/g, '').trim();
    if (!nombreLimpio) { alert('Escribe un nombre válido.'); inputNombre.focus(); return; }

    // El backend parte el id por "_" y espera un número en el segundo trozo; con
    // "custom_0_..." lee 0, no encuentra producto y respeta el precio que mandamos
    // (que es justo lo que queremos en una línea escrita a mano).
    contadorLineaManual++;
    const id = `custom_0_${contadorLineaManual}`;

    cart[id] = { id: id, name: nombreLimpio, price: precio, qty: cantidad, note: '' };

    inputNombre.value = '';
    inputPrecio.value = '';
    inputCantidad.value = 1;

    calculateTotals();
    renderizarResumenCarrito();
    inputNombre.focus();
}


// --- Envío del pedido --------------------------------------------------------

async function enviarPedidoTrabajador(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();

    // Si quedaron combos elegidos pero sin personalizar, no se puede enviar: la
    // cocina recibiría un combo sin saber qué piezas lleva. Va antes que el aviso
    // de carrito vacío porque un pedido con solo pendientes no está vacío.
    const idsPendientes = idsCombosPendientes();
    if (idsPendientes.length > 0) {
        abrirModalCombosPendientes(idsPendientes);
        return;
    }

    const articulos = Object.values(cart);
    if (articulos.length === 0) {
        alert('El pedido está vacío. Agrega al menos un plato.');
        goToStep(1);
        return;
    }

    const nombreCliente = document.getElementById('trab-cliente').value.trim();
    if (!nombreCliente) {
        alert('Falta el nombre del cliente.');
        document.getElementById('trab-cliente').focus();
        return;
    }

    const tipoEntrega = document.getElementById('trab-entrega').value;
    const direccion = document.getElementById('trab-direccion').value.trim();
    const telefono = normalizarTelefono(document.getElementById('trab-telefono').value) || 'No registrado';
    const operador = usuarioActivoTrabajador
        ? `${usuarioActivoTrabajador.nombre} (${usuarioActivoTrabajador.rol})`
        : 'No registrado';

    const payload = {
        timestamp: new Date().toISOString(),
        cliente: nombreCliente,
        telefono: telefono,
        tipo_entrega: tipoEntrega,
        direccion: direccion || 'Retiro por local',
        metodo_pago: document.getElementById('trab-pago').value,
        articulos: articulos,
        estado_inicial: tipoEntrega === 'Delivery' ? 'Calculando Delivery' : 'Pago Pendiente',
        pedido_detallado: "Generado por Backend", // el backend arma el texto real
        metadata_titular: `Pedido registrado en caja por ${operador}`
    };

    const btn = document.getElementById('btn-enviar-pedido');
    const htmlOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

    try {
        // authHeaders() manda el token del personal: es lo que hace que el backend
        // permita registrar el pedido aunque el local esté cerrado.
        const res = await fetch(URL_CREAR_PEDIDO_TRAB, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            goToStep(4);
        } else {
            const detalle = await res.text();
            console.error('Respuesta del servidor:', detalle);
            alert('El servidor rechazó el pedido. Revisa los datos e intenta de nuevo.');
        }
    } catch (e) {
        console.error('Error de conexión:', e);
        alert('Fallo de conexión al enviar el pedido. Revisa el internet e intenta de nuevo.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = htmlOriginal;
    }
}

function reiniciarPedidoTrabajador() {
    cart = {};
    pendientesPersonalizarCombo = {};

    document.getElementById('order-form').reset();
    _limpiarEstadoClienteTrab();
    limpiarBusqueda(false);

    const contenedorPaso2 = document.getElementById('items-container');
    if (contenedorPaso2) contenedorPaso2.innerHTML = '';

    calculateTotals();
    renderizarCategorias();
    goToStep(1);
}


// Escape cierra el buscador sin tener que llegar al botón de la X.
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    const buscador = document.getElementById('buscador-menu');
    if (buscador && document.activeElement === buscador && buscador.value) {
        limpiarBusqueda();
    }
});
