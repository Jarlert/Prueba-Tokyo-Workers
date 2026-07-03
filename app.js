// =====================================================================
// Tokio Sushi - Núcleo de Operaciones y Control del Sistema (app.js)
// =====================================================================

const URL_OBTENER_MOTORIZADOS = "https://n8n-production-0c91c.up.railway.app/webhook/obtener-motorizados";
const API_OBTENER_PEDIDOS = "https://n8n-production-0c91c.up.railway.app/webhook/obtener-pedidos";
const API_ACTUALIZAR_ESTADO = "https://n8n-production-0c91c.up.railway.app/webhook/actualizar-estado";
const URL_NUEVO_PEDIDO = "https://n8n-production-0c91c.up.railway.app/webhook/Prueba-tokyo";
const URL_OBTENER_MENU = "https://n8n-production-0c91c.up.railway.app/webhook/obtener-menu";
const URL_OBTENER_USUARIOS = "https://n8n-production-0c91c.up.railway.app/webhook/obtener-usuarios";

let MOTORIZADOS_SISTEMA = []; 
let USUARIOS_SISTEMA = [];
let CATALOGO_PRODUCTOS = []; 
let inventarioProductosBase = []; 
let usuarioActivo = null;
let pedidosEnMemoria = [];
let segundosFaltantes = 15;

let carritoEdicion = []; 
let totalEdicionUSD = 0;
let resolveTiempoEstimado = null; 

// --- CARGAR CATÁLOGO DESDE LA BASE DE DATOS ---
async function cargarCatalogoDesdeDB() {
    try {
        const urlFresca = URL_OBTENER_MENU + "?t=" + new Date().getTime();
        const response = await fetch(urlFresca);
        if (!response.ok) throw new Error('Error al conectar con el servidor de menú');
        
        const rawData = await response.json();
        const data = (Array.isArray(rawData) && rawData[0].menu) ? rawData[0] : rawData;
        
        let todosLosItems = [];

        if (data && data.menu) {
            inventarioProductosBase = data.menu.productos || [];
            if (data.menu.productos) todosLosItems = todosLosItems.concat(data.menu.productos);
            if (data.menu.combos) todosLosItems = todosLosItems.concat(data.menu.combos);
        } else if (Array.isArray(data)) {
            todosLosItems = data;
            inventarioProductosBase = data; 
        }

        CATALOGO_PRODUCTOS = todosLosItems.map(item => ({
            id: item.id,
            name: item.nombre,
            price: parseFloat(item.precio)
        }));
        
        console.log("🔥 Catálogo listo para sugerencias:", CATALOGO_PRODUCTOS.length, "ítems cargados.");
        
        // Escudo para Admin (por si comparten página)
        if (document.getElementById('lista-items-combo') && document.getElementById('lista-items-combo').innerHTML === '') {
            if (typeof agregarFilaProductoCombo === 'function') agregarFilaProductoCombo(); 
        }
    } catch (error) {
        console.error("Error obteniendo el catálogo interno:", error);
    } 
}

async function cargarMotorizadosDesdeDB() {
    try {
        const response = await fetch(URL_OBTENER_MOTORIZADOS + "?t=" + new Date().getTime());
        if (!response.ok) throw new Error('Error al conectar con servidor de motorizados');
        const data = await response.json();
        MOTORIZADOS_SISTEMA = Array.isArray(data) ? data : (data.data || []);
        
        // Escudo de seguridad para el Admin
        if (document.getElementById('lista-motorizados-container') && typeof renderListaMotorizados === 'function') {
            renderListaMotorizados();
        }
    } catch (error) { console.error("Error obteniendo motorizados:", error); }
}

// --- CONTROL DE TASA (VERSIÓN DEFINITIVA Y BLINDADA) ---
async function actualizarTasaBCV() {
    const inputTasa = document.getElementById('tasaBCV');
    if (!inputTasa) return;

    const hoy = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Caracas'});
    const tasaGuardada = localStorage.getItem('tasaBCV');
    const fechaTasa = localStorage.getItem('fechaTasa');

    if (fechaTasa === hoy && tasaGuardada) {
        inputTasa.value = tasaGuardada;
        return; 
    }

    try {
        const response = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
        if (!response.ok) throw new Error('Error API BCV');
        
        const data = await response.json();
        
        if (data && data.promedio) {
            inputTasa.value = parseFloat(data.promedio).toFixed(2);
            localStorage.setItem('tasaBCV', inputTasa.value);
            localStorage.setItem('fechaTasa', hoy);
            
            inputTasa.classList.add('text-emerald-400');
            setTimeout(() => inputTasa.classList.remove('text-emerald-400'), 2000);
        }
    } catch (error) {
        console.error("Falló la conexión con DolarApi:", error);
        if (tasaGuardada) inputTasa.value = tasaGuardada;
    }
}

if (document.getElementById('tasaBCV')) {
    document.getElementById('tasaBCV').addEventListener('input', (e) => {
        const hoy = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Caracas'});
        localStorage.setItem('tasaBCV', e.target.value);
        localStorage.setItem('fechaTasa', hoy); 
    });
}

// --- ESCUCHADOR DEL CALENDARIO ---
if (document.getElementById('calendarioFiltro')) {
    document.getElementById('calendarioFiltro').addEventListener('change', () => {
        console.log("Cambiando fecha a:", document.getElementById('calendarioFiltro').value);
        pedidosEnMemoria = [];
        cargarPedidos();
    });
}

// --- SESIONES (RBAC) ---
function verificarSesion() {
    const sesionGuardada = localStorage.getItem('usuarioActivo');
    const vistaLogin = document.getElementById('vistaLogin');
    const vistaDashboard = document.getElementById('vistaDashboard');
    
    if (!vistaLogin || !vistaDashboard) return;

    if (sesionGuardada) {
        usuarioActivo = JSON.parse(sesionGuardada);
        aplicarRestriccionesRol();
        vistaLogin.classList.add('hidden');
        vistaDashboard.classList.remove('hidden');
        vistaDashboard.classList.add('flex');
        cargarPedidos();
    } else {
        usuarioActivo = null;
        clearInterval(pollingTimer);
        vistaLogin.classList.remove('hidden');
        vistaDashboard.classList.add('hidden');
        vistaDashboard.classList.remove('flex');
    }
}

const API_VALIDAR_ACCESO = "https://n8n-production-0c91c.up.railway.app/webhook/validar-acceso";

async function iniciarSesion(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();

    const usernameInput = document.getElementById('loginUsername').value.trim();
    const pinInput = document.getElementById('loginPIN').value.trim();
    const errorMsg = document.getElementById('loginError');
    const btnSubmit = document.querySelector('#formLogin button[type="submit"]');
    
    if (errorMsg) errorMsg.classList.add('hidden');
    if (!usernameInput || !pinInput) return;

    if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verificando...'; }

    try {
        // Enviamos la carta por debajo de la puerta a n8n
        const response = await fetch(API_VALIDAR_ACCESO, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer TokioSushi_App_2026_X' },
            body: JSON.stringify({ tipo: 'login_normal', username: usernameInput, pin: pinInput })
        });

        const data = await response.json();

        if (data.success && data.usuario) {
            // Guardamos al usuario PERO el PIN jamás llegó al navegador
            usuarioActivo = { username: data.usuario.username, nombre: data.usuario.nombre, rol: data.usuario.rol };
            localStorage.setItem('usuarioActivo', JSON.stringify(usuarioActivo));
            
            const formLogin = document.getElementById('formLogin');
            if (formLogin) formLogin.reset();
            
            verificarSesion();
        } else {
            if (errorMsg) { errorMsg.innerText = "Usuario o PIN incorrectos."; errorMsg.classList.remove('hidden'); }
        }
    } catch (error) {
        if (errorMsg) { errorMsg.innerText = "Error de conexión con el servidor."; errorMsg.classList.remove('hidden'); }
    } finally {
        if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = 'Ingresar <i class="fa-solid fa-arrow-right"></i>'; }
    }
}

function cerrarSesion() {
    localStorage.removeItem('usuarioActivo');
    verificarSesion();
}

function aplicarRestriccionesRol() {
    const inputTasa = document.getElementById('tasaBCV');
    const badgeUsuario = document.getElementById('badgeUsuario');
    if (!usuarioActivo || !badgeUsuario || !inputTasa) return;

    let colorRol = 'bg-slate-600/20 text-slate-300 border-slate-600/30';
    if (usuarioActivo.rol === 'superadmin') colorRol = 'bg-red-500/10 text-red-400 border-red-500/20';
    if (usuarioActivo.rol === 'admin') colorRol = 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';

    badgeUsuario.innerHTML = `
        <div class="flex items-center gap-2 overflow-hidden">
            <span class="text-[10px] text-slate-400 uppercase font-semibold shrink-0">Op:</span>
            <span class="text-xs font-bold text-white truncate max-w-[110px]" title="${usuarioActivo.nombre}">${usuarioActivo.nombre}</span>
        </div>
        <span class="text-[9px] uppercase font-mono font-bold px-1.5 py-0.5 rounded border ${colorRol} shrink-0">${usuarioActivo.rol}</span>
    `;

    if (usuarioActivo.rol === 'cajero') {
        inputTasa.disabled = true;
        inputTasa.classList.add('opacity-40', 'cursor-not-allowed');
    } else {
        inputTasa.disabled = false;
        inputTasa.classList.remove('opacity-40', 'cursor-not-allowed');
    }
}

// --- ABRIR MODAL (VERSIÓN BLINDADA) ---
async function abrirModalNuevoPedido() { 
    const contenedor = document.getElementById('contenedorArticulos');
    
    if (CATALOGO_PRODUCTOS.length === 0) {
        console.log("Memoria vacía. Descargando menú fresco para las sugerencias...");
        await cargarCatalogoDesdeDB();
    }

    if (!contenedor.innerHTML.includes('sugerencias-')) {
        contenedor.innerHTML = '';
        agregarFilaArticulo();
    }
    
    document.getElementById('modalNuevoPedido').classList.remove('hidden'); 
}
function cerrarModalNuevoPedido() { document.getElementById('modalNuevoPedido').classList.add('hidden'); }

// 1. Dibuja la fila con un menú desplegable flotante oculto
function agregarFilaArticulo() {
    const puedeEditarPrecio = usuarioActivo && (usuarioActivo.rol === 'superadmin' || usuarioActivo.rol === 'admin');
    const atributoReadonly = puedeEditarPrecio ? '' : 'readonly';
    const claseFondoPrecio = puedeEditarPrecio 
        ? 'bg-slate-900 text-white' 
        : 'bg-slate-800 text-emerald-400 cursor-not-allowed border-slate-600 font-bold';

    const div = document.createElement('div');
    div.className = "flex gap-2 articulo-fila relative"; 
    
    const idSugerencia = 'sugerencias-' + Math.random().toString(36).substr(2, 9);

    div.innerHTML = `
        <input type="number" value="1" min="1" class="w-16 bg-slate-900 p-2 rounded-lg border border-slate-700 text-white text-sm text-center item-qty" placeholder="Cant">
        
        <div class="flex-1 relative">
            <input type="text" oninput="mostrarSugerenciasPedido(this, '${idSugerencia}')" class="w-full bg-slate-900 p-2 rounded-lg border border-slate-700 text-white text-sm item-name" placeholder="Escribe para buscar plato o combo..." autocomplete="off">
            <div id="${idSugerencia}" class="hidden absolute z-50 w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-40 overflow-y-auto"></div>
        </div>
        
        <input type="number" step="0.01" min="0" class="w-24 p-2 rounded-lg border border-slate-700 text-sm text-center item-price ${claseFondoPrecio}" placeholder="Precio ($)" ${atributoReadonly}>
        
        <button type="button" onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-300 w-8 flex items-center justify-center cursor-pointer transition">
            <i class="fa-solid fa-trash"></i>
        </button>`;
        
    document.getElementById('contenedorArticulos').appendChild(div);
}

// 2. Filtra el catálogo en tiempo real
function mostrarSugerenciasPedido(inputElement, idContenedor) {
    const contenedor = document.getElementById(idContenedor);
    const texto = inputElement.value.toLowerCase().trim();
    
    if (texto.length < 1) {
        contenedor.classList.add('hidden');
        return;
    }

    const resultados = CATALOGO_PRODUCTOS.filter(p => p.name.toLowerCase().includes(texto));

    if (resultados.length > 0) {
        contenedor.innerHTML = resultados.map(p => `
            <div onclick="seleccionarSugerenciaPedido(this, '${p.name.replace(/'/g, "\\'")}', ${p.price})" class="p-2 border-b border-slate-700 hover:bg-slate-600 cursor-pointer text-sm text-white flex justify-between items-center transition">
                <span class="truncate">${p.name}</span>
                <span class="text-emerald-400 font-bold ml-2">$${p.price.toFixed(2)}</span>
            </div>
        `).join('');
        contenedor.classList.remove('hidden');
    } else {
        contenedor.innerHTML = `<div class="p-2 text-sm text-slate-400 italic">No hay coincidencias...</div>`;
        contenedor.classList.remove('hidden');
    }
}

// 3. Rellena los datos automáticamente
function seleccionarSugerenciaPedido(elementoOpcion, nombre, precio) {
    const fila = elementoOpcion.closest('.articulo-fila');
    const inputNombre = fila.querySelector('.item-name');
    const inputPrecio = fila.querySelector('.item-price');
    
    inputNombre.value = nombre;
    inputPrecio.value = precio;
    elementoOpcion.parentElement.classList.add('hidden');
}

// 4. Autocompletar el precio al seleccionar
function autoCompletarPrecio(inputNombre) {
    const nombreIngresado = inputNombre.value.trim().toLowerCase();
    const productoEncontrado = CATALOGO_PRODUCTOS.find(p => p.name.toLowerCase() === nombreIngresado);
    
    if (productoEncontrado) {
        const inputPrecio = inputNombre.nextElementSibling;
        inputPrecio.value = productoEncontrado.price;
    }
}

async function enviarNuevoPedido() {
    const btn = document.getElementById('btnEnviarNuevoPedido');
    const cliente = document.getElementById('inputCliente').value.trim();
    if(!cliente) { alert("Por favor ingresa el nombre del cliente."); return; }

    const articulos = Array.from(document.querySelectorAll('.articulo-fila')).map(f => {
        const cant = parseInt(f.querySelector('.item-qty').value) || 1;
        const nombreBase = f.querySelector('.item-name').value.trim() || 'Artículo sin nombre';
        const precioUni = parseFloat(f.querySelector('.item-price').value) || 0;
        
        return {
            qty: cant,
            name: `${nombreBase} ($${(precioUni * cant).toFixed(2)})`,
            price: precioUni
        };
    });
    
    const textoDetalladoConPrecios = articulos.map(item => `${item.qty}x ${item.name}`).join('\n');

    // 🌟 NUEVO: Calculamos el número de pedido visual del día
    const pedidosHoy = pedidosEnMemoria.filter(p => esPedidoDeLaFecha(JSON.stringify(p)));
    const proximoIdVisual = pedidosHoy.length + 1;

    const payload = {
        cliente: cliente, telefono: document.getElementById('inputTelefono').value.trim() || 'No registrado',
        tipo_entrega: document.getElementById('inputEntrega').value, metodo_pago: document.getElementById('inputPago').value,
        direccion: document.getElementById('inputDireccion').value.trim() || 'En el local', 
        articulos: articulos,
        pedido_detallado: textoDetalladoConPrecios, 
        timestamp: new Date().toISOString(), tasa_bcv: parseFloat(document.getElementById('tasaBCV').value) || 1,
        // 🌟 NUEVO: Enviamos el ID visual a n8n
        id_visual: proximoIdVisual
    };

    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';
    try {
        const res = await fetch(URL_NUEVO_PEDIDO, { 
            method: 'POST', 
            body: JSON.stringify(payload), 
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer TokioSushi_App_2026_X' // Tu candado de seguridad
            } 
        });
        if(res.ok) { 
            document.getElementById('formNuevoPedido').reset();
            document.getElementById('contenedorArticulos').innerHTML = '';
            agregarFilaArticulo();
            cerrarModalNuevoPedido(); cargarPedidos(); 
        } else alert("Error al guardar el pedido en el servidor.");
    } catch(e) { alert("Error de conexión al intentar enviar el pedido."); } 
    finally { btn.disabled = false; btn.innerHTML = 'Procesar Pedido <i class="fa-solid fa-paper-plane"></i>'; }
}

function abrirModalEditarPedido(idReal, idVisual) {
    const pedido = pedidosEnMemoria.find(p => String(p.id_pedido || p['ID_Pedido'] || p.ID || 'S/ID') === String(idReal));
    if (!pedido) return;
    document.getElementById('editIdReal').value = idReal;
    document.getElementById('txtEditIdVisual').innerText = `#${idVisual}`;
    document.getElementById('editCliente').value = pedido.cliente || pedido['Cliente'] || '';
    document.getElementById('buscadorMenu').value = '';
    document.getElementById('listaSugerencias').classList.add('hidden');
    
    carritoEdicion = [];
    const textoDetallado = pedido.pedido_detallado || pedido['Pedido Detallado'] || '';
    const lineas = textoDetallado.split('\n');
    lineas.forEach(linea => {
        const match = linea.trim().match(/^(\d+)[xX]\s+(.+)$/);
        if (match) {
            const cant = parseInt(match[1]); 
            let nombreLimpio = match[2].trim();
            let precioExtraido = 0;

            const matchPrecio = nombreLimpio.match(/\(\$(\d+(?:\.\d+)?)\)$/);
            if (matchPrecio) {
                precioExtraido = parseFloat(matchPrecio[1]) / cant; 
                nombreLimpio = nombreLimpio.replace(/\s*\(\$[\d.]+\)$/, '').trim(); 
            }

            const itemCat = typeof CATALOGO_PRODUCTOS !== 'undefined' ? CATALOGO_PRODUCTOS.find(p => p.name.toLowerCase() === nombreLimpio.toLowerCase()) : null;
            const precioFinal = itemCat ? itemCat.price : (precioExtraido || 0);

            carritoEdicion.push({ id: itemCat ? itemCat.id : 'custom', name: nombreLimpio, price: precioFinal, qty: cant });
        }
    });
    if (carritoEdicion.length === 0 && textoDetallado !== '') carritoEdicion.push({ id: 'custom', name: textoDetallado, price: parseFloat(pedido.total_orden) || 0, qty: 1 });
    renderizarCarritoEdicion();
    document.getElementById('modalEditarPedido').classList.remove('hidden');
}

function renderizarCarritoEdicion() {
    const contenedor = document.getElementById('listaEdicionArticulos');
    contenedor.innerHTML = ''; totalEdicionUSD = 0;
    const tasaActual = parseFloat(document.getElementById('tasaBCV').value) || 1;

    if (carritoEdicion.length === 0) {
        contenedor.innerHTML = '<p class="text-xs text-slate-500 italic text-center py-4">El carrito está vacío. Busca un producto arriba.</p>';
        document.getElementById('txtEditTotalVisual').innerHTML = '$0.00';
        return;
    }

    carritoEdicion.forEach((item, index) => {
        const subtotal = item.price * item.qty;
        totalEdicionUSD += subtotal;
        const precioUnidadBs = (item.price * tasaActual).toFixed(2);
        const subtotalBs = (subtotal * tasaActual).toFixed(2);

        contenedor.innerHTML += `
            <div class="flex justify-between items-center bg-slate-800 p-2 rounded border border-slate-700">
                <div class="flex-1">
                    <p class="text-sm text-white font-semibold leading-tight">${item.name}</p>
                    <p class="text-xs text-slate-400 mt-0.5">$${item.price.toFixed(2)} c/u <span class="text-[10px] text-amber-400 ml-1">(Bs. ${precioUnidadBs})</span></p>
                </div>
                <div class="flex items-center gap-3">
                    <div class="flex items-center bg-slate-900 border border-slate-700 rounded-md overflow-hidden">
                        <button onclick="modificarCantEdicion(${index}, -1)" class="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-700 cursor-pointer"><i class="fa-solid fa-minus text-[10px]"></i></button>
                        <span class="text-sm text-white w-6 text-center font-bold">${item.qty}</span>
                        <button onclick="modificarCantEdicion(${index}, 1)" class="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-700 cursor-pointer"><i class="fa-solid fa-plus text-[10px]"></i></button>
                    </div>
                    <div class="flex flex-col text-right w-16">
                        <span class="text-sm font-bold text-amber-400">$${subtotal.toFixed(2)}</span>
                        <span class="text-[10px] font-bold text-amber-400">Bs. ${subtotalBs}</span>
                    </div>
                    <button onclick="eliminarItemEdicion(${index})" class="text-red-500 hover:text-red-400 p-1 cursor-pointer"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>`;
    });
    const totalEdicionBs = (totalEdicionUSD * tasaActual).toFixed(2);
    document.getElementById('txtEditTotalVisual').innerHTML = `<div class="flex flex-col text-right"><span class="text-emerald-400">$${totalEdicionUSD.toFixed(2)}</span><span class="text-xs text-amber-400 mt-0.5">Bs. ${totalEdicionBs}</span></div>`;
}

function modificarCantEdicion(index, cambio) { carritoEdicion[index].qty += cambio; if (carritoEdicion[index].qty <= 0) carritoEdicion.splice(index, 1); renderizarCarritoEdicion(); }
function eliminarItemEdicion(index) { carritoEdicion.splice(index, 1); renderizarCarritoEdicion(); }

function buscarProducto(texto) {
    const sugerenciasDiv = document.getElementById('listaSugerencias');
    if (!texto || texto.length < 2) { sugerenciasDiv.classList.add('hidden'); return; }
    const textoMinus = texto.toLowerCase();
    const resultados = typeof CATALOGO_PRODUCTOS !== 'undefined' ? CATALOGO_PRODUCTOS.filter(p => p.name.toLowerCase().includes(textoMinus)) : [];
    if (resultados.length > 0) {
        sugerenciasDiv.innerHTML = resultados.map(p => `<div onclick="agregarAlCarritoEdicion('${p.id}')" class="p-3 border-b border-slate-600 hover:bg-slate-600 cursor-pointer transition flex justify-between items-center"><span class="text-sm text-white">${p.name}</span><span class="text-xs font-bold text-emerald-400">$${p.price.toFixed(2)}</span></div>`).join('');
        sugerenciasDiv.classList.remove('hidden');
    } else { sugerenciasDiv.innerHTML = '<div class="p-3 text-sm text-slate-400 italic">No se encontraron productos</div>'; sugerenciasDiv.classList.remove('hidden'); }
}

function agregarAlCarritoEdicion(idProducto) {
    const producto = CATALOGO_PRODUCTOS.find(p => String(p.id) === String(idProducto)); 
    if (!producto) return;
    
    const existeIndex = carritoEdicion.findIndex(item => item.name === producto.name);
    if (existeIndex >= 0) {
        carritoEdicion[existeIndex].qty += 1; 
    } else {
        carritoEdicion.push({ id: producto.id, name: producto.name, price: producto.price, qty: 1 });
    }
    
    document.getElementById('buscadorMenu').value = ''; 
    document.getElementById('listaSugerencias').classList.add('hidden'); 
    renderizarCarritoEdicion();
}

function cerrarModalEditar() { document.getElementById('modalEditarPedido').classList.add('hidden'); }

function guardarEdicionPedido() {
    const idReal = document.getElementById('editIdReal').value; 
    const nuevoCliente = document.getElementById('editCliente').value.trim();
    const pedidoIndex = pedidosEnMemoria.findIndex(p => String(p.id_pedido || p['ID_Pedido'] || p.ID || 'S/ID') === String(idReal));
    
    if(pedidoIndex === -1) return;
    
    const pedidoAnterior = pedidosEnMemoria[pedidoIndex]; 
    const nuevoDetalle = carritoEdicion.map(item => `${item.qty}x ${item.name} ($${(item.price * item.qty).toFixed(2)})`).join('\n');

    // CAPTURAMOS LA TASA DE LA PANTALLA
    const tasaActual = parseFloat(document.getElementById('tasaBCV').value) || 1;

    pedidosEnMemoria[pedidoIndex].cliente = nuevoCliente; 
    pedidosEnMemoria[pedidoIndex].pedido_detallado = nuevoDetalle; 
    pedidosEnMemoria[pedidoIndex].total_orden = totalEdicionUSD;
    pedidosEnMemoria[pedidoIndex].tasa_bcv = tasaActual; // Actualizamos memoria
    
    cerrarModalEditar();

    const payloadBD = {
        id: idReal, estado: pedidoAnterior.estado || 'Pago Pendiente', cliente: nuevoCliente, pedido_detallado: nuevoDetalle, total_orden: totalEdicionUSD,   
        telefono: pedidoAnterior.telefono || '', tipo_entrega: pedidoAnterior.tipo_entrega || '', procesado_por: usuarioActivo ? `${usuarioActivo.nombre} (${usuarioActivo.rol})` : "No registrado",
        referencia_pago: pedidoAnterior.referencia_pago || pedidoAnterior.Referencia_pago || "", imagen_pago: pedidoAnterior.imagen_pago || pedidoAnterior.Imagen_pago || "",
        tasa_bcv: tasaActual // ENVIAMOS LA TASA A LA BASE DE DATOS
    };
    fetch(API_ACTUALIZAR_ESTADO, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer TokioSushi_App_2026_X' }, body: JSON.stringify(payloadBD) }).catch(e => console.error("Error BD:", e));

    const metodoPago = String(pedidoAnterior.metodo_pago || pedidoAnterior['Método de pago'] || pedidoAnterior.Metodo_pago || '').toLowerCase();
    const esPagoMovil = metodoPago.includes('pago') || metodoPago.includes('movil') || metodoPago.includes('móvil');
    
    let textoAdicionalBs = "";
    if (esPagoMovil) {
        const totalBs = (totalEdicionUSD * tasaActual).toFixed(2);
        textoAdicionalBs = `\nEquivalente en Bolívares: *Bs. ${totalBs}*`;
    }

    const payloadNotificacion = {
        telefono: pedidoAnterior.telefono || '',
        cliente: nuevoCliente,
        pedido_detallado: nuevoDetalle,
        total_orden: totalEdicionUSD,
        texto_bolivares: textoAdicionalBs 
    };
    
    fetch("https://n8n-production-0c91c.up.railway.app/webhook/notificar-edicion", { 
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer TokioSushi_App_2026_X' }, body: JSON.stringify(payloadNotificacion) 
    }).catch(e => console.error("Error enviando WhatsApp:", e));
}

// --- CANCELAR PEDIDO ---
function cancelarPedido(idPedido) {
    if (!confirm("¿Estás seguro de que deseas eliminar este pedido sin pagar? Desaparecerá del tablero.")) return;
    const pedido = pedidosEnMemoria.find(p => String(p.id_pedido || p['ID_Pedido'] || p.ID || 'S/ID') === String(idPedido)); if (!pedido) return;
    const index = pedidosEnMemoria.findIndex(p => String(p.id_pedido || p['ID_Pedido'] || p.ID) === String(idPedido));
    if (index !== -1) { pedidosEnMemoria[index].estado = 'Cancelado'; renderizarTablero(); }
    const operadorFirma = usuarioActivo ? `${usuarioActivo.nombre} (${usuarioActivo.rol})` : "No registrado";
    const payload = {
        id: idPedido, estado: 'Cancelado', telefono: pedido.telefono || '', cliente: pedido.cliente || '', tipo_entrega: pedido.tipo_entrega || '', 
        procesado_por: operadorFirma, referencia_pago: pedido.referencia_pago || "", imagen_pago: pedido.imagen_pago || "",
        pedido_detallado: pedido.pedido_detallado || "", total_orden: parseFloat(pedido.total_orden || pedido['Total Orden']) || 0, tiempo_estimado: ""
    };
    fetch(API_ACTUALIZAR_ESTADO, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer TokioSushi_App_2026_X' }, body: JSON.stringify(payload) }).catch(e => console.error(e));
}

// --- COMPROBANTES Y TIEMPO ---
if (document.getElementById('inputImagenPago')) {
    document.getElementById('inputImagenPago').addEventListener('change', function(event) {
        const file = event.target.files[0]; const preview = document.getElementById('previewComprobante');
        if (file) { const reader = new FileReader(); reader.onload = function(e) { preview.src = e.target.result; preview.classList.remove('hidden'); }; reader.readAsDataURL(file); } 
        else { preview.src = ""; preview.classList.add('hidden'); }
    });
}

function pedirComprobantePago(metodoPago) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modalComprobante'); const contenedorRef = document.getElementById('contenedorReferencia');
        const inputRef = document.getElementById('inputReferencia'); const inputImg = document.getElementById('inputImagenPago');
        const preview = document.getElementById('previewComprobante'); const txtMetodo = document.getElementById('txtMetodoPagoModal');

        inputRef.value = ''; inputImg.value = ''; preview.src = ''; preview.classList.add('hidden');
        const metodoLimpio = metodoPago || "Desconocido"; txtMetodo.innerText = `Método de pago del cliente: ${metodoLimpio}`;
        if (metodoLimpio.toLowerCase().includes('efectivo')) contenedorRef.classList.add('hidden'); else contenedorRef.classList.remove('hidden');
        modal.classList.remove('hidden');

        document.getElementById('btnAceptarComprobante').onclick = () => {
            if (!contenedorRef.classList.contains('hidden') && inputRef.value.trim() === '') { alert("Por favor, ingresa el número de referencia."); return; }
            modal.classList.add('hidden'); resolve({ referencia: inputRef.value, imagen: (inputImg.files.length > 0) ? preview.src : "" }); 
        };
        document.getElementById('btnCancelarComprobante').onclick = () => { modal.classList.add('hidden'); resolve(null); };
    });
}

function pedirTiempoEstimado() {
    return new Promise((resolve) => {
        resolveTiempoEstimado = resolve;
        document.getElementById('inputTiempoPersonalizado').value = '';
        document.getElementById('modalTiempoEstimado').classList.remove('hidden');
    });
}
function seleccionarTiempo(minutos) {
    if (!minutos || minutos.trim() === '') { alert('Por favor ingresa un tiempo válido.'); return; }
    document.getElementById('modalTiempoEstimado').classList.add('hidden');
    if (resolveTiempoEstimado) resolveTiempoEstimado(minutos);
}
function cancelarTiempoEstimado() {
    document.getElementById('modalTiempoEstimado').classList.add('hidden');
    if (resolveTiempoEstimado) resolveTiempoEstimado(null);
}

// --- FLUJO DE ESTADOS ---
async function procesarPasoCocina(idPedido) {
    const pedido = pedidosEnMemoria.find(p => String(p.id_pedido || p['ID_Pedido'] || p.ID || 'S/ID') === String(idPedido)); if (!pedido) return;
    const metodoPago = pedido.metodo_pago || pedido['Método de pago'] || pedido.Metodo_pago || '';
    const telefono = pedido.telefono || pedido['Teléfono'] || ''; const cliente = pedido.cliente || pedido['Cliente'] || '';
    const tipoEntrega = pedido.tipo_entrega || pedido['Tipo de entrega'] || pedido.Tipo_entrega || '';

    const datosPago = await pedirComprobantePago(metodoPago); if (!datosPago) return; 
    const tiempoEstimado = await pedirTiempoEstimado(); if (!tiempoEstimado) return; 

    ejecutarActualizacion(idPedido, 'En Cocina', telefono, cliente, tipoEntrega, datosPago, tiempoEstimado);
}

function procesarPasoFinalizado(idPedido) {
    const pedido = pedidosEnMemoria.find(p => String(p.id_pedido || p['ID_Pedido'] || p.ID || 'S/ID') === String(idPedido)); if (!pedido) return;
    const telefono = pedido.telefono || pedido['Teléfono'] || ''; const cliente = pedido.cliente || pedido['Cliente'] || '';
    const tipoEntrega = pedido.tipo_entrega || pedido['Tipo de entrega'] || pedido.Tipo_entrega || '';
    ejecutarActualizacion(idPedido, 'Finalizado', telefono, cliente, tipoEntrega, null, "");
}

function ejecutarActualizacion(id, estado, telefono, cliente, tipoEntrega, datosPago, tiempoEstimado = "") {
    const operadorFirma = usuarioActivo ? `${usuarioActivo.nombre} (${usuarioActivo.rol})` : "No registrado";
    const index = pedidosEnMemoria.findIndex(p => String(p.id_pedido || p['ID_Pedido'] || p.ID) === String(id));
    if (index === -1) return; const pedidoViejo = pedidosEnMemoria[index];

    const refGuardada = pedidoViejo.referencia_pago || pedidoViejo['Referencia_pago'] || pedidoViejo.Referencia_pago || "";
    const imgGuardada = pedidoViejo.imagen_pago || pedidoViejo['Imagen_pago'] || pedidoViejo['Imagen Pago'] || "";
    const nuevaRef = datosPago ? datosPago.referencia : refGuardada; const nuevaImg = datosPago ? datosPago.imagen : imgGuardada;
    
    // CAPTURAMOS LA TASA DE LA PANTALLA
    const tasaActual = parseFloat(document.getElementById('tasaBCV').value) || 1;

    pedidosEnMemoria[index].estado = estado; pedidosEnMemoria[index].procesado_por = operadorFirma;
    pedidosEnMemoria[index].referencia_pago = nuevaRef; pedidosEnMemoria[index].imagen_pago = nuevaImg;
    pedidosEnMemoria[index].tasa_bcv = tasaActual; // Actualizamos memoria
    renderizarTablero();

    const direccionGuardada = pedidoViejo.direccion || pedidoViejo.Direccion || "Dirección no especificada";

    const payload = {
        id: id, estado: estado, telefono: telefono, cliente: cliente, tipo_entrega: tipoEntrega, procesado_por: operadorFirma,
        referencia_pago: nuevaRef, imagen_pago: nuevaImg, pedido_detallado: pedidoViejo.pedido_detallado || pedidoViejo['Pedido Detallado'] || "",
        total_orden: parseFloat(pedidoViejo.total_orden || pedidoViejo['Total Orden']) || 0, tiempo_estimado: tiempoEstimado,
        direccion: direccionGuardada,
        tasa_bcv: tasaActual // ENVIAMOS LA TASA A LA BASE DE DATOS
    };
    fetch(API_ACTUALIZAR_ESTADO, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer TokioSushi_App_2026_X' }, body: JSON.stringify(payload) }).catch(e => console.error(e));
}

// --- FECHAS Y RENDERIZADO ---
function esPedidoDeLaFecha(filaTexto) {
    if (!filaTexto) return false;
    
    let pedidoObj;
    try { pedidoObj = JSON.parse(filaTexto); } 
    catch(e) { return false; }

    const inputFecha = document.getElementById('calendarioFiltro') ? document.getElementById('calendarioFiltro').value : '';
    const fechaDeseada = inputFecha || new Date().toLocaleDateString('en-CA', {timeZone: 'America/Caracas'}); 

    const fechaRaw = pedidoObj.timestamp || pedidoObj['Timestamp'];
    if (!fechaRaw) return true;

    try {
        const d = new Date(fechaRaw);
        const fechaLocal = d.toLocaleDateString('en-CA', {timeZone: 'America/Caracas'});
        return fechaLocal === fechaDeseada;
    } catch(e) {
        return true;
    }
}

function normalizarEstado(estadoRaw) { return (!estadoRaw) ? '' : estadoRaw.replace(/[\s\uFEFF\xA0]+/g, '').toLowerCase(); }

async function cargarPedidos() {
    try {
        const fechaCalendario = document.getElementById('calendarioFiltro') ? document.getElementById('calendarioFiltro').value : '';
        let urlFetch = API_OBTENER_PEDIDOS + '?_t=' + new Date().getTime();
        if (fechaCalendario) urlFetch += '&fecha=' + fechaCalendario;
        
        const response = await fetch(urlFetch); 
        if (!response.ok) throw new Error('Error API');
        
        const datos = await response.json(); 
        pedidosEnMemoria = Array.isArray(datos) ? datos : [];
        
        const inputTasa = document.getElementById('tasaBCV');
        const hoy = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Caracas'});

        if (fechaCalendario && fechaCalendario !== hoy) {
            const pedidoConTasa = pedidosEnMemoria.find(p => p.tasa_bcv && parseFloat(p.tasa_bcv) > 0);
            if (pedidoConTasa && inputTasa) {
                inputTasa.value = parseFloat(pedidoConTasa.tasa_bcv).toFixed(2);
                inputTasa.classList.add('text-amber-400'); 
            } else if (inputTasa) {
                inputTasa.value = "";
                inputTasa.classList.add('text-amber-400');
            }
        } else {
            actualizarTasaBCV();
            if (inputTasa) inputTasa.classList.remove('text-amber-400');
        }

        renderizarTablero(); 
    } catch (error) { 
        console.error(error); 
    }
}

function formatearMoneda(valor) {
    return new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);
}

function renderizarTablero() {
    const colCalculando = document.getElementById('columnaCalculandoDelivery');
    const colPagoPendiente = document.getElementById('columnaPagoPendiente');
    const colEnCocina = document.getElementById('columnaEnCocina');
    const colFinalizado = document.getElementById('columnaFinalizado');

    if (!colPagoPendiente || !colEnCocina || !colFinalizado) return;
    
    if (colCalculando) colCalculando.innerHTML = '';
    colPagoPendiente.innerHTML = ''; colEnCocina.innerHTML = ''; colFinalizado.innerHTML = '';

    let conteoCalculando = 0, conteoPago = 0, conteoCocina = 0, conteoFinalizado = 0;
    let totalVentasDia = 0; 
    const inputTasa = document.getElementById('tasaBCV');
    const tasaActual = inputTasa ? (parseFloat(inputTasa.value) || 1) : 1;

    const pedidosHoy = pedidosEnMemoria.filter(p => esPedidoDeLaFecha(JSON.stringify(p)));
    pedidosHoy.sort((a, b) => parseInt(String(a.id_pedido || a.ID || 0).replace(/\D/g,'')) - parseInt(String(b.id_pedido || b.ID || 0).replace(/\D/g,'')));
    const mapaIdsDiarios = {};
    pedidosHoy.forEach((p, index) => {
        const id = p.id_pedido || p['ID_Pedido'] || p.ID || 'S/ID';
        mapaIdsDiarios[id] = index + 1; 
    });

    pedidosEnMemoria.forEach(pedido => {
        if (!esPedidoDeLaFecha(JSON.stringify(pedido))) return;

        const idReal = pedido.id_pedido || pedido['ID_Pedido'] || pedido.ID || 'S/ID';
        const idVisual = mapaIdsDiarios[idReal] || idReal;

        const cliente = pedido.cliente || 'Desconocido';
        const telefonoRaw = pedido.telefono || '';
        const metodoPago = String(pedido.metodo_pago || '').replace(/'/g, "\\'");
        const esPagoMovil = metodoPago.toLowerCase().includes('pago') || metodoPago.toLowerCase().includes('movil');
        const monto = parseFloat(String(pedido.total_orden || pedido.monto || 0).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
        
        const montoFormateado = formatearMoneda(monto);
        const montoBsFormateado = formatearMoneda(monto * tasaActual);

        let htmlMonto = `<span class="text-xs font-bold text-slate-300">$${montoFormateado}</span>`;
        if (esPagoMovil) htmlMonto = `<div class="flex flex-col"><span class="text-xs font-bold text-slate-300">$${montoFormateado}</span><span class="text-[10px] font-bold text-amber-400">Bs. ${montoBsFormateado}</span></div>`;
        
        let hora = '--:--';
        const fechaRaw = pedido.timestamp || pedido['Timestamp'];
        if (fechaRaw) {
            // Buscamos los números directamente, ignorando el formato nativo de fecha
            const match = String(fechaRaw).match(/(\d{1,2}):(\d{2})/);
            
            if (match) {
                let h = parseInt(match[1], 10);
                const m = match[2];

                // Forzamos la resta de 4 horas
                h = h - 4;
                if (h < 0) h = h + 24; 

                const ampm = (h >= 12 && h < 24) ? 'PM' : 'AM';
                h = h % 12 || 12; 
                
                hora = `${h}:${m} ${ampm}`;
            }
        }
        
        const art = pedido.pedido_detallado || 'Detalle no disponible'; 
        const estadoLimpio = normalizarEstado(String(pedido.estado || ''));

        let btnWhatsApp = '';
        const telLimpio = String(telefonoRaw).replace(/\D/g, ''); 
        if (telLimpio.length >= 10) {
            let telWA = telLimpio;
            if (telWA.startsWith('0')) telWA = '58' + telWA.substring(1);
            else if (!telWA.startsWith('58')) telWA = '58' + telWA;
            const esMovil = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
            const urlWA = esMovil ? `https://wa.me/${telWA}` : `https://web.whatsapp.com/send?phone=${telWA}`;
            btnWhatsApp = `<a href="${urlWA}" target="_blank" onclick="event.stopPropagation()" class="text-slate-400 hover:text-emerald-400 transition cursor-pointer ml-1" title="Abrir chat en WhatsApp"><i class="fa-brands fa-whatsapp"></i></a>`;
        }
        
        if (estadoLimpio === 'calculandodelivery') {
            conteoCalculando++;
            colCalculando.innerHTML += `
                <div class="bg-slate-700/40 p-4 rounded-lg border border-purple-500/10 hover:border-purple-500/30 transition duration-150 space-y-3">
                    <div class="flex justify-between items-start">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded border border-purple-400/20">#${idVisual}</span>
                            
                            <button onclick="abrirModalDetalle('${idReal}')" class="text-slate-400 hover:text-white transition cursor-pointer" title="Ver Detalles"><i class="fa-solid fa-file-lines"></i></button>
                            
                            <button onclick="abrirModalEditarPedido('${idReal}', '${idVisual}')" class="text-slate-400 hover:text-amber-400 transition cursor-pointer" title="Editar Pedido"><i class="fa-solid fa-pen"></i></button>
                            
                            <button onclick="cancelarPedido('${idReal}')" class="text-slate-400 hover:text-red-500 transition cursor-pointer" title="Cancelar Pedido"><i class="fa-solid fa-trash"></i></button>
                            
                            ${btnWhatsApp}
                        </div>
                        <span class="text-[10px] text-slate-400 font-medium"><i class="fa-regular fa-clock"></i> ${hora}</span>
                    </div>
                    <div><h4 class="font-bold text-white text-sm truncate">${cliente}</h4><p class="text-xs text-slate-400 mt-1 line-clamp-2">${art}</p></div>
                    <div class="flex justify-between items-center pt-2 border-t border-slate-600/50">
                        ${htmlMonto}
                        <button onclick="procesarPrecioDelivery('${idReal}')" class="bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold px-3 py-1.5 rounded-md transition flex items-center gap-1 cursor-pointer">Poner precio delivery <i class="fa-solid fa-motorcycle"></i></button>
                    </div>
                </div>`;
        } else if (estadoLimpio === 'pagopendiente') {
            conteoPago++;
            colPagoPendiente.innerHTML += `
                <div class="bg-slate-700/40 p-4 rounded-lg border border-yellow-500/10 hover:border-yellow-500/30 transition duration-150 space-y-3">
                    <div class="flex justify-between items-start">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded border border-yellow-400/20">#${idVisual}</span>
                            
                            <button onclick="abrirModalDetalle('${idReal}')" class="text-slate-400 hover:text-white transition cursor-pointer" title="Ver Detalles"><i class="fa-solid fa-file-lines"></i></button>
                            
                            <button onclick="abrirModalEditarPedido('${idReal}', '${idVisual}')" class="text-slate-400 hover:text-amber-400 transition cursor-pointer" title="Editar Pedido"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="cancelarPedido('${idReal}')" class="text-slate-400 hover:text-red-500 transition cursor-pointer" title="Cancelar Pedido"><i class="fa-solid fa-trash"></i></button>
                            ${btnWhatsApp}
                        </div>
                        <span class="text-[10px] text-slate-400 font-medium"><i class="fa-regular fa-clock"></i> ${hora}</span>
                    </div>
                    <div><h4 class="font-bold text-white text-sm truncate">${cliente}</h4><p class="text-xs text-slate-400 mt-1 line-clamp-2">${art}</p></div>
                    <div class="flex justify-between items-center pt-2 border-t border-slate-600/50">
                        ${htmlMonto}
                        <button onclick="procesarPasoCocina('${idReal}')" class="bg-yellow-500 hover:bg-yellow-400 text-slate-950 text-xs font-bold px-3 py-1.5 rounded-md transition flex items-center gap-1 cursor-pointer">Aceptar <i class="fa-solid fa-arrow-right"></i></button>
                    </div>
                </div>`;
        } else if (estadoLimpio === 'encocina') {
            conteoCocina++;
            colEnCocina.innerHTML += `
                <div class="bg-slate-700/40 p-4 rounded-lg border border-sky-500/10 hover:border-sky-500/30 transition duration-150 space-y-3">
                    <div class="flex justify-between items-start">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-sky-400 bg-sky-400/10 px-2 py-0.5 rounded border border-sky-400/20">#${idVisual}</span>
                            <button onclick="abrirModalDetalle('${idReal}')" class="text-slate-400 hover:text-white transition cursor-pointer"><i class="fa-solid fa-file-lines"></i></button>
                            ${btnWhatsApp}
                        </div>
                        <span class="text-[10px] text-slate-400 font-medium"><i class="fa-regular fa-clock"></i> ${hora}</span>
                    </div>
                    <div><h4 class="font-bold text-white text-sm truncate">${cliente}</h4><p class="text-xs text-slate-400 mt-1 line-clamp-2">${art}</p></div>
                    <div class="flex justify-between items-center pt-2 border-t border-slate-600/50">
                        ${htmlMonto}
                        <button onclick="procesarPasoFinalizado('${idReal}')" class="bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-3 py-1.5 rounded-md transition flex items-center gap-1 cursor-pointer">Despachar <i class="fa-solid fa-check"></i></button>
                    </div>
                </div>`;
        } else if (estadoLimpio === 'finalizado') {
            conteoFinalizado++; totalVentasDia += monto; 
            
            const esDelivery = String(pedido.tipo_entrega || '').toLowerCase().includes('delivery');
            const repartidorAsignado = pedido.repartidor || pedido.Repartidor || '';
            let btnMoto = '';
            
            if (esDelivery) {
                const colorMoto = repartidorAsignado !== '' ? 'text-emerald-400' : 'text-slate-400 hover:text-emerald-400';
                const tituloMoto = repartidorAsignado !== '' ? `Pagado a: ${repartidorAsignado}` : 'Marcar pago de delivery';
                btnMoto = `<button onclick="abrirModalRepartidor('${idReal}', event)" class="${colorMoto} transition cursor-pointer ml-2" title="${tituloMoto}"><i class="fa-solid fa-motorcycle"></i></button>`;
            }

            let htmlMontoFinalizado = `<span class="text-sm font-bold text-emerald-400">$${montoFormateado}</span>`;
            if (esPagoMovil) htmlMontoFinalizado = `<div class="flex flex-col text-right"><span class="text-sm font-bold text-emerald-400">$${montoFormateado}</span><span class="text-[10px] font-bold text-amber-400">Bs. ${montoBsFormateado}</span></div>`;
            
            let htmlReferencia = '';
            if (esPagoMovil) {
                const ref = pedido.referencia_pago || pedido.Referencia_pago || pedido['Referencia_pago'] || '';
                if (ref && ref !== 'Sin comprobante') {
                    htmlReferencia = `<div class="mt-2 pt-2 border-t border-slate-700/50 text-[10px] text-slate-400 flex items-center justify-between"><span class="font-semibold text-amber-400">Ref: ${ref}</span><span class="text-emerald-400/70"><i class="fa-solid fa-check-double"></i></span></div>`;
                } else {
                    htmlReferencia = `<div class="mt-2 pt-2 border-t border-slate-700/50 text-[10px] text-slate-500 italic flex items-center gap-1"><i class="fa-solid fa-triangle-exclamation"></i> Sin referencia</div>`;
                }
            }

            colFinalizado.innerHTML += `
                <div onclick="abrirModalDetalle('${idReal}')" class="bg-slate-700/20 hover:bg-slate-700/50 p-3 rounded-lg border border-emerald-500/10 hover:border-emerald-500/30 transition cursor-pointer mb-2 flex flex-col">
                    <div class="flex justify-between items-start w-full">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-semibold text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded border border-emerald-400/20">#${idVisual}</span>
                            ${btnWhatsApp}
                            ${btnMoto}
                        </div>
                        <span class="text-[10px] text-slate-400 font-medium whitespace-nowrap"><i class="fa-regular fa-clock"></i> ${hora}</span>
                    </div>
                    <div class="flex justify-between items-end mt-2 w-full">
                        <span class="text-[11px] text-slate-400 underline decoration-slate-600 underline-offset-2 hover:text-white transition">Ver Recibo</span>
                        ${htmlMontoFinalizado}
                    </div>
                    ${htmlReferencia}
                </div>`;
        }
    });

    if (document.getElementById('cantCalculandoDelivery')) {
        document.getElementById('cantCalculandoDelivery').innerText = conteoCalculando;
    }
    document.getElementById('cantPagoPendiente').innerText = conteoPago; 
    document.getElementById('cantEnCocina').innerText = conteoCocina; 
    document.getElementById('cantFinalizado').innerText = conteoFinalizado;

    const totalVentasFormateado = formatearMoneda(totalVentasDia);
    const totalVentasBsFormateado = formatearMoneda(totalVentasDia * tasaActual);
    if (document.getElementById('totalDiaBottom')) document.getElementById('totalDiaBottom').innerHTML = `<div class="flex flex-col text-right leading-tight"><span class="text-lg font-bold text-emerald-400">$${totalVentasFormateado}</span><span class="text-[10px] font-bold text-amber-400">Bs. ${totalVentasBsFormateado}</span></div>`;
}

// --- VER RECIBOS ---
function verComprobanteDeMemoria(idReal) {
    const pedido = pedidosEnMemoria.find(p => String(p.id_pedido || p['ID_Pedido'] || p.ID || 'S/ID') === String(idReal)); if (!pedido) return;
    const imgData = pedido.imagen_pago || pedido.Imagen_pago || '';
    if (imgData.startsWith('http')) window.open(imgData, '_blank');
    else if (imgData.length > 50) {
        const w = window.open('', '_blank');
        w.document.write(`<html><head><title>Comprobante #${idReal}</title></head><body style="margin:0; background:#0f172a; display:flex; justify-content:center; align-items:center; min-height:100vh;"><img src="${imgData}" style="max-width:100%; max-height:100vh; border-radius:8px;"/></body></html>`);
        w.document.close();
    }
}

function abrirModalDetalle(idPedido) {
    const pedido = pedidosEnMemoria.find(p => String(p.id_pedido || p['ID_Pedido'] || p.ID || 'S/ID') === String(idPedido)); if (!pedido) return;
    const idReal = pedido.id_pedido || pedido['ID_Pedido'] || 'S/ID'; const idVisual = String(idReal).split('-').pop();
    const cliente = pedido.cliente || 'Registrado'; const tel = pedido.telefono || 'No registrado';
    const entrega = pedido.tipo_entrega || 'No definido'; const dir = pedido.direccion || 'No especificada';
    const pago = pedido.metodo_pago || 'No especificado'; const arts = pedido.pedido_detallado || '';
    const img = pedido.imagen_pago || ''; const ref = pedido.referencia_pago || '';
    const monto = parseFloat(String(pedido.total_orden || 0).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
    const operador = pedido.procesado_por || 'Sin registro';

    document.getElementById('modalID').innerText = `ID Base de datos: #${idVisual}`;
    let seccionVES = '';
    if (pago.toLowerCase().includes('pago') || pago.toLowerCase().includes('movil')) {
        const inputTasa = document.getElementById('tasaBCV');
        const t = inputTasa ? (parseFloat(inputTasa.value) || 1.0) : 1.0;
        seccionVES = `<div class="bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg mt-2 text-amber-300 text-xs text-center font-bold">Total en Bolívares: Bs. ${(monto * t).toFixed(2)} (Tasa: ${t.toFixed(2)} Bs/$)</div>`;
    }
    let refHtml = ref ? `<p class="text-xs text-amber-400 mt-1 font-mono bg-slate-900 border border-slate-700 px-2 py-1 rounded inline-block">Ref: ${ref}</p>` : '';
    
    let btnImg = '';
    if (pedido.imagen_pago && String(pedido.imagen_pago).trim() !== '' && String(pedido.imagen_pago) !== 'undefined') {
        btnImg = `
            <div class="mt-4 pt-4 border-t border-slate-700/50 flex flex-col items-center justify-center w-full">
                <span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-2">Comprobante Adjunto</span>
                <a href="${pedido.imagen_pago}" target="_blank" class="block border border-slate-600 rounded-lg overflow-hidden hover:border-emerald-500 transition shadow-lg max-w-[220px] w-full">
                    <img src="${pedido.imagen_pago}" class="w-full h-auto object-contain rounded-lg bg-slate-900" alt="Comprobante de Pago">
                </a>
                <span class="text-[10px] text-slate-500 mt-1 italic"><i class="fa-solid fa-magnifying-glass-plus"></i> Clic en la imagen para ampliar</span>
            </div>
        `;
    }

    document.getElementById('modalCuerpo').innerHTML = `<div class="space-y-3.5"><div class="flex justify-between"><div><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Cliente</span><p class="font-bold text-white text-base">${cliente}</p><p class="text-xs text-slate-400 mt-0.5"><i class="fa-solid fa-phone"></i> ${tel}</p></div><div class="text-right"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider block">Comandado por</span><p class="text-xs text-white bg-slate-900 border border-slate-700 px-2 py-1 rounded mt-1 font-semibold">${operador}</p></div></div><div class="border-t border-slate-700/50 pt-2.5"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Método de Distribución</span><p class="text-white text-xs mt-0.5 font-medium">${entrega}</p><p class="text-xs text-slate-400 mt-1 bg-slate-900/40 p-2 rounded border border-slate-700/30 italic">${dir}</p></div><div class="border-t border-slate-700/50 pt-2.5"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Productos</span><div class="text-xs bg-slate-900/40 p-2.5 rounded border border-slate-700/30 whitespace-pre-line max-h-32 overflow-y-auto text-slate-300 font-mono">${arts}</div></div><div class="border-t border-slate-700/50 pt-2.5 flex justify-between items-center"><div><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Forma de Pago</span><p class="text-white text-xs font-semibold">${pago}</p>${refHtml}</div><div class="text-right"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Total</span><p class="text-emerald-400 font-bold text-lg">$${monto.toFixed(2)}</p></div></div>${seccionVES}${btnImg}</div>`;
    document.getElementById('modalDetalle').classList.remove('hidden');
}
function cerrarModal() { document.getElementById('modalDetalle').classList.add('hidden'); }

// --- SISTEMA DE TIEMPO REAL (PUSHER) ---
// Pusher permite ver si estamos en desarrollo para mostrar errores en la consola
Pusher.logToConsole = false; 

const pusher = new Pusher('88089dcd4800848c78dd', {
    cluster: 'us2'
});

// Nos suscribimos al mismo canal que configuramos en n8n
const channel = pusher.subscribe('canal-cocina');

// Escuchamos el evento exacto
channel.bind('actualizar-tablero', function(data) {
    console.log("¡Señal de Pusher recibida! Actualizando tablero...");
    
    // Al recibir el aviso, ejecutamos la carga de pedidos inmediatamente
    cargarPedidos();
});

// ==========================================
// ARRANQUE PRINCIPAL (PANTALLA DE OPERACIONES)
// ==========================================
async function inicializarTablero() {
    const calendario = document.getElementById('calendarioFiltro');
    if (calendario && !calendario.value) {
        calendario.value = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Caracas'});
    }
    
    await cargarMotorizadosDesdeDB();
    await cargarCatalogoDesdeDB(); 
    verificarSesion();
    actualizarTasaBCV();
}

if (document.getElementById('vistaLogin')) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializarTablero);
    } else {
        inicializarTablero();
    }
}

function obtenerEmojiPlato() {
    const emojis = ['🍱', '🍙', '🍣', '🥤', '🍰', '🥟', '🍤', '🔥', '🍜', '🥢'];
    return emojis[Math.floor(Math.random() * emojis.length)];
}

function pedirPrecioDelivery(cliente) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modalPrecioDelivery');
        const inputPrecio = document.getElementById('inputPrecioDelivery');
        const txtCliente = document.getElementById('txtClienteDelivery');
        
        txtCliente.innerText = `Cliente: ${cliente}`;
        inputPrecio.value = '';
        
        modal.classList.remove('hidden');
        modal.classList.add('flex'); 
        inputPrecio.focus();
        
        document.getElementById('btnAceptarDelivery').onclick = () => {
            const valor = inputPrecio.value.trim();
            if (valor === '') { alert("Por favor ingresa un monto."); return; }
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            resolve(valor);
        };
        
        document.getElementById('btnCancelarDelivery').onclick = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            resolve(null);
        };
    });
}

async function procesarPrecioDelivery(idPedido) {
    const pedido = pedidosEnMemoria.find(p => String(p.id_pedido || p['ID_Pedido'] || p.ID || 'S/ID') === String(idPedido));
    if (!pedido) return;

    const precioDel = await pedirPrecioDelivery(pedido.cliente);
    if (precioDel === null) return; 
    
    const costoDelivery = parseFloat(precioDel.replace(',', '.'));
    if (isNaN(costoDelivery)) {
        alert("Monto inválido.");
        return;
    }

    const nuevoTotal = parseFloat(pedido.total_orden) + costoDelivery;
    const nuevoDetalle = pedido.pedido_detallado + `\n1x Servicio de Delivery ($${costoDelivery})`;
    const operadorFirma = usuarioActivo ? `${usuarioActivo.nombre} (${usuarioActivo.rol})` : "No registrado";
    
    // CAPTURAMOS LA TASA DE LA PANTALLA
    const tasaActual = parseFloat(document.getElementById('tasaBCV').value) || 1;

    const index = pedidosEnMemoria.findIndex(p => String(p.id_pedido || p['ID_Pedido'] || p.ID) === String(idPedido));
    pedidosEnMemoria[index].estado = 'Pago Pendiente';
    pedidosEnMemoria[index].total_orden = nuevoTotal;
    pedidosEnMemoria[index].pedido_detallado = nuevoDetalle;
    pedidosEnMemoria[index].tasa_bcv = tasaActual; // Actualizamos memoria
    renderizarTablero();

    const payload = {
        id: idPedido, 
        estado: 'Pago Pendiente', 
        cliente: pedido.cliente, 
        pedido_detallado: nuevoDetalle, 
        total_orden: nuevoTotal,   
        telefono: pedido.telefono || '', 
        tipo_entrega: pedido.tipo_entrega || '', 
        metodo_pago: pedido.metodo_pago || pedido['Método de pago'] || pedido.Metodo_pago || '',
        procesado_por: operadorFirma,
        referencia_pago: pedido.referencia_pago || "", 
        imagen_pago: "Sin comprobante",
        es_cotizacion_delivery: true,
        tasa_bcv: tasaActual // ENVIAMOS LA TASA A LA BASE DE DATOS
    };
    
    fetch(API_ACTUALIZAR_ESTADO, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer TokioSushi_App_2026_X' }, 
        body: JSON.stringify(payload) 
    }).catch(e => console.error("Error BD:", e));
}

// --- FUNCIONES DEL REPARTIDOR ---
let idPedidoRepartidorActual = null;

function abrirModalRepartidor(idReal, evento) {
    evento.stopPropagation(); 
    idPedidoRepartidorActual = idReal;
    
    const pedido = pedidosEnMemoria.find(p => String(p.id_pedido || p['ID_Pedido'] || p.ID || 'S/ID') === String(idReal));
    if (!pedido) return;

    document.getElementById('txtPedidoRepartidor').innerText = `Pedido para: ${pedido.cliente}`;
    const select = document.getElementById('selectRepartidor');
    select.innerHTML = '<option value="">-- Seleccionar --</option>';
    
    MOTORIZADOS_SISTEMA.forEach(m => {
        select.innerHTML += `<option value="${m.nombre}">${m.nombre}</option>`;
    });
    
    if (pedido.repartidor) select.value = pedido.repartidor;

    const modal = document.getElementById('modalAsignarRepartidor');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function cerrarModalRepartidor() {
    const modal = document.getElementById('modalAsignarRepartidor');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    idPedidoRepartidorActual = null;
}

function guardarRepartidor() {
    const select = document.getElementById('selectRepartidor');
    const nombreRepartidor = select.value;
    
    if (nombreRepartidor === "") {
        alert("Por favor selecciona un repartidor válido de la lista.");
        return;
    }

    const index = pedidosEnMemoria.findIndex(p => String(p.id_pedido || p['ID_Pedido'] || p.ID) === String(idPedidoRepartidorActual));
    if (index === -1) return;
    const pedido = pedidosEnMemoria[index];
    
    const idSeguro = idPedidoRepartidorActual;
    
    pedidosEnMemoria[index].repartidor = nombreRepartidor;
    renderizarTablero();

    const operadorFirma = usuarioActivo ? `${usuarioActivo.nombre} (${usuarioActivo.rol})` : "No registrado";
    const payload = {
        id_pedido: idSeguro,
        id: idSeguro,
        estado: pedido.estado, 
        cliente: pedido.cliente,
        pedido_detallado: pedido.pedido_detallado,
        total_orden: pedido.total_orden,
        telefono: pedido.telefono || '',
        tipo_entrega: pedido.tipo_entrega || '',
        metodo_pago: pedido.metodo_pago || '',
        procesado_por: operadorFirma,
        referencia_pago: pedido.referencia_pago || "",
        imagen_pago: pedido.imagen_pago || "",
        repartidor: nombreRepartidor,
        actualizacion_silenciosa: true 
    };

    fetch(API_ACTUALIZAR_ESTADO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer TokioSushi_App_2026_X' },
        body: JSON.stringify(payload)
    }).catch(e => console.error("Error BD:", e));
    
    cerrarModalRepartidor();
}
