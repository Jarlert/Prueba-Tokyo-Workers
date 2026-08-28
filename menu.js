// ==========================================
// TOKIO SUSHI - LÓGICA DEL CLIENTE (FRONTEND)
// ==========================================

const URL_OBTENER_MENU = "https://prueba-tokyo-workers-production-76cf.up.railway.app/api/menu/";
const URL_VERIFICAR_CLIENTE = "https://prueba-tokyo-workers-production-76cf.up.railway.app/api/clientes/verificar";
const URL_REGISTRAR_CLIENTE = "https://prueba-tokyo-workers-production-76cf.up.railway.app/api/clientes/registrar";
const URL_OBTENER_HORARIOS = "https://prueba-tokyo-workers-production-76cf.up.railway.app/api/horarios/";
const URL_OBTENER_ANUNCIOS = "https://prueba-tokyo-workers-production-76cf.up.railway.app/api/anuncios/";

let menuData = { combos: [], cocina: [], sushi: [], extras: [] };
let cart = {};
let datosClienteLogueado = null;
let horariosAtencion = [];
let anunciosActivos = [];
let anuncioIndiceActual = 0;
let loteComboEnCurso = null; // { id, restantes } — unidades de un combo que aún faltan por personalizar tras escribir una cantidad mayor
let comboIdSelectorActivo = null; // combo cuyas personalizaciones se están listando para eliminar

// --- 1. ARRANQUE Y CONTROL DE ESTADOS ---
function mostrarIconosHeaderSesion(mostrar) {
    ['header-settings-btn', 'header-logout-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.toggle('hidden', !mostrar);
        btn.classList.toggle('flex', mostrar);
    });
}

window.onload = async function() {
    precargarAnuncios(); // arranca la descarga de las imágenes de anuncios de una vez, sin esperar al login
    history.replaceState({ step: 'auth' }, "Autenticación");

    const sesionCliente = localStorage.getItem('sesionCliente');
    if (sesionCliente) {
        datosClienteLogueado = JSON.parse(sesionCliente);
        document.getElementById('lbl-cliente-activo').innerText = datosClienteLogueado.nombre;
        mostrarIconosHeaderSesion(true);
        await cargarMenuDesdeDB();
        goToStep(1);
    } else {
        goToStep('auth');
    }
};

window.onpopstate = function(event) {
    if (event.state && event.state.step) {
        goToStep(event.state.step, false);
    } else {
        goToStep('auth', false);
    }
};

function goToStep(stepNumber, pushState = true) {
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    document.getElementById(`step-${stepNumber}`).classList.add('active');
    window.scrollTo(0, 0);

    const backBtn = document.getElementById('header-back-btn');
    if (stepNumber !== 'auth' && stepNumber !== 'registro' && stepNumber > 1 && stepNumber < 4) {
        backBtn.classList.remove('invisible');
    } else {
        backBtn.classList.add('invisible');
    }

    updateStickyBarVisibility(stepNumber);

    if (stepNumber === 3) {
        const banner = document.getElementById('banner-cerrado');
        if (banner) {
            if (estaAbiertoAhora()) banner.classList.add('hidden');
            else mostrarBannerCerrado();
        }
    }

    if (pushState) {
        history.pushState({ step: stepNumber }, `Paso ${stepNumber}`);
    }
}

// --- HORARIO DE ATENCIÓN: los clientes pueden ver el menú siempre, pero solo pedir dentro del horario ---
async function cargarHorariosAtencion() {
    try {
        const response = await fetch(URL_OBTENER_HORARIOS);
        if (!response.ok) throw new Error('Error al obtener horarios');
        const data = await response.json();
        horariosAtencion = Array.isArray(data) ? data : (data.data || []);
    } catch (error) {
        console.error("Error obteniendo horario de atención:", error);
    }
}

function obtenerFechaHoraCaracas() {
    const ahora = new Date();
    const fechaCaracas = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }); // "YYYY-MM-DD"
    const [anio, mes, dia] = fechaCaracas.split('-').map(Number);
    const diaSemanaJS = new Date(anio, mes - 1, dia).getDay(); // 0=domingo...6=sábado
    const diaSemana = (diaSemanaJS + 6) % 7; // 0=lunes...6=domingo (igual que el backend)
    const horaActual = ahora.toLocaleTimeString('en-GB', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit' });
    return { diaSemana, horaActual };
}

function estaAbiertoAhora() {
    if (!Array.isArray(horariosAtencion) || horariosAtencion.length === 0) return true; // sin config cargada, no bloqueamos
    const { diaSemana, horaActual } = obtenerFechaHoraCaracas();
    const hoy = horariosAtencion.find(h => h.dia_semana === diaSemana);
    if (!hoy || !hoy.activo || !hoy.hora_apertura || !hoy.hora_cierre) return false;
    return horaActual >= hoy.hora_apertura && horaActual <= hoy.hora_cierre;
}

function formatearHorarioTexto() {
    if (!Array.isArray(horariosAtencion) || horariosAtencion.length === 0) return "nuestro horario habitual";
    const nombres = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const ordenados = [...horariosAtencion].sort((a, b) => a.dia_semana - b.dia_semana);

    const grupos = [];
    ordenados.forEach(h => {
        const clave = h.activo ? `${h.hora_apertura}-${h.hora_cierre}` : 'cerrado';
        const ultimo = grupos[grupos.length - 1];
        if (ultimo && ultimo.clave === clave) {
            ultimo.diaFin = h.dia_semana;
        } else {
            grupos.push({ clave, activo: h.activo, diaInicio: h.dia_semana, diaFin: h.dia_semana, apertura: h.hora_apertura, cierre: h.hora_cierre });
        }
    });

    const texto = grupos.filter(g => g.activo).map(g => {
        const rango = g.diaInicio === g.diaFin ? nombres[g.diaInicio] : `${nombres[g.diaInicio]} a ${nombres[g.diaFin]}`;
        return `${rango} de ${g.apertura} a ${g.cierre}`;
    }).join(', ');

    return texto || "nuestro horario habitual";
}

function mostrarBannerCerrado() {
    const banner = document.getElementById('banner-cerrado');
    if (!banner) return;
    banner.innerText = `⏰ En este momento no nos encontramos laborando. Prueba hacer tu pedido en nuestro horario laboral: ${formatearHorarioTexto()}. También puedes escribirnos por WhatsApp si deseas más información.`;
    banner.classList.remove('hidden');
    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// --- DISPONIBILIDAD PROGRAMADA POR HORARIO/DÍA (productos y combos individuales) ---
function itemDentroDeHorarioProgramado(item) {
    if (!item.disponible_desde && !item.disponible_hasta && !item.dias_disponibles) return true;
    const { diaSemana, horaActual } = obtenerFechaHoraCaracas();

    if (item.dias_disponibles) {
        const dias = String(item.dias_disponibles).split(',').map(d => parseInt(d.trim()));
        if (!dias.includes(diaSemana)) return false;
    }
    if (item.disponible_desde && item.disponible_hasta) {
        if (!(horaActual >= item.disponible_desde && horaActual <= item.disponible_hasta)) return false;
    }
    return true;
}

// --- ANUNCIOS/POPUPS DE PROMOCIONES AL ABRIR EL MENÚ ---
let promesaPrecargaAnuncios = null;

// Se llama lo antes posible (antes de terminar el login) para que las imágenes
// ya estén descargadas en caché del navegador cuando el popup deba mostrarse.
function precargarAnuncios() {
    if (promesaPrecargaAnuncios) return promesaPrecargaAnuncios;
    promesaPrecargaAnuncios = (async () => {
        try {
            const response = await fetch(URL_OBTENER_ANUNCIOS + "?t=" + new Date().getTime());
            if (!response.ok) throw new Error('Error al obtener anuncios');
            const data = await response.json();
            const anuncios = Array.isArray(data) ? data : (data.data || []);
            anunciosActivos = anuncios.filter(a => a.activo).sort((a, b) => (a.orden || 0) - (b.orden || 0));
            anunciosActivos.forEach(a => {
                if (!a.imagen) return;
                // <link rel=preload fetchpriority=high> le pide al navegador que la
                // descargue YA y le dé prioridad sobre otras imágenes de la página
                // (ej. los íconos de categoría), en vez de competir en igualdad de
                // condiciones por las conexiones disponibles.
                const link = document.createElement('link');
                link.rel = 'preload';
                link.as = 'image';
                link.href = a.imagen;
                link.setAttribute('fetchpriority', 'high');
                document.head.appendChild(link);
            });
        } catch (error) {
            console.error("Error precargando anuncios:", error);
        }
    })();
    return promesaPrecargaAnuncios;
}

async function cargarYMostrarAnuncios() {
    await precargarAnuncios();
    anuncioIndiceActual = 0;
    if (anunciosActivos.length > 0) mostrarAnuncioEnIndice(0);
}

function mostrarAnuncioEnIndice(indice) {
    const anuncio = anunciosActivos[indice];
    if (!anuncio) return;

    const imgEl = document.getElementById('anuncio-modal-imagen');
    imgEl.src = anuncio.imagen || '';
    imgEl.style.cursor = anuncio.producto_ref ? 'pointer' : 'default';

    document.getElementById('anuncio-modal-titulo').innerText = anuncio.titulo || '';
    document.getElementById('anuncio-modal-titulo').classList.toggle('hidden', !anuncio.titulo);
    document.getElementById('anuncio-modal-texto').innerText = anuncio.texto || '';
    document.getElementById('anuncio-modal-texto').classList.toggle('hidden', !anuncio.texto);

    const btnPedir = document.getElementById('anuncio-modal-btn-pedir');
    btnPedir.classList.toggle('hidden', !anuncio.producto_ref);

    const hayMas = indice < anunciosActivos.length - 1;
    const btnEntendido = document.getElementById('anuncio-modal-btn');
    btnEntendido.innerText = hayMas ? 'Siguiente ➔' : 'Entendido, ver menú';
    if (anuncio.producto_ref) {
        btnEntendido.className = 'mt-3 w-full font-bold py-3 rounded-xl transition cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-700';
    } else {
        btnEntendido.className = 'mt-3 w-full font-bold py-3 rounded-xl transition cursor-pointer bg-red-600 hover:bg-red-700 text-white';
    }

    const modal = document.getElementById('modal-anuncio');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function cerrarAnuncioActual() {
    if (anuncioIndiceActual < anunciosActivos.length - 1) {
        anuncioIndiceActual++;
        mostrarAnuncioEnIndice(anuncioIndiceActual);
        return;
    }
    const modal = document.getElementById('modal-anuncio');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function irAItemDeAnuncio() {
    const anuncio = anunciosActivos[anuncioIndiceActual];
    if (!anuncio || !anuncio.producto_ref) return;

    const modal = document.getElementById('modal-anuncio');
    modal.classList.add('hidden');
    modal.classList.remove('flex');

    const itemId = anuncio.producto_ref;
    let categoriaEncontrada = null;
    let itemEncontrado = null;
    Object.keys(menuData).forEach(catKey => {
        const encontrado = menuData[catKey].items.find(i => i.id === itemId);
        if (encontrado) { categoriaEncontrada = catKey; itemEncontrado = encontrado; }
    });

    if (!itemEncontrado) {
        alert('Este producto o combo ya no está disponible.');
        return;
    }

    selectCategory(categoriaEncontrada);

    const esComboConOpciones = itemEncontrado.opciones_combo && itemEncontrado.opciones_combo !== '' && itemEncontrado.opciones_combo !== '[]';
    if (esComboConOpciones) {
        abrirModalCombo(itemEncontrado);
    } else {
        setTimeout(() => {
            const cardEl = document.getElementById('item-card-' + itemId);
            if (!cardEl) return;
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            cardEl.classList.add('ring-4', 'ring-red-400');
            setTimeout(() => cardEl.classList.remove('ring-4', 'ring-red-400'), 2000);
        }, 100);
    }
}

// --- 2. AUTENTICACIÓN Y REGISTRO ---
async function procesarVerificacionTelefono(event) {
    event.preventDefault();
    const txtTelefono = document.getElementById('auth-phone').value.trim();
    if (!txtTelefono) return;

    const btn = document.getElementById('btn-auth-submit');
    btn.disabled = true; btn.innerText = "Verificando...";

    try {
        const response = await fetch(`${URL_VERIFICAR_CLIENTE}?telefono=${txtTelefono}`);
        if (!response.ok) throw new Error('Error de red');
        
        const resultado = await response.json();
        const listaClientes = Array.isArray(resultado) ? resultado : (resultado.data || []);

        if (listaClientes.length > 0) {
            datosClienteLogueado = listaClientes[0];
            localStorage.setItem('sesionCliente', JSON.stringify(datosClienteLogueado));
            document.getElementById('lbl-cliente-activo').innerText = datosClienteLogueado.nombre;
            mostrarIconosHeaderSesion(true);

            await cargarMenuDesdeDB();
            goToStep(1);
        } else {
            document.getElementById('reg-name').value = '';
            document.getElementById('reg-cedula').value = '';
            document.getElementById('reg-address').value = '';
            goToStep('registro');
        }
    } catch (e) {
        console.error(e);
        alert("Ocurrió un error de conexión al verificar el teléfono.");
    } finally {
        btn.disabled = false; btn.innerText = "Ingresar ➔";
    }
}

async function procesarRegistroCliente(event) {
    event.preventDefault();
    
    const payload = {
        telefono: document.getElementById('auth-phone').value.trim(),
        nombre: document.getElementById('reg-name').value.trim(),
        cedula: document.getElementById('reg-cedula').value.trim(),
        direccion_principal: document.getElementById('reg-address').value.trim(),
        direcciones_extra: '[]' 
    };

    const btn = document.getElementById('btn-reg-submit');
    btn.disabled = true; btn.innerText = "Registrando...";

    try {
        await fetch(URL_REGISTRAR_CLIENTE, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer TokioSushi_App_2026_X' // Agregada la llave de seguridad
            },
            body: JSON.stringify(payload)
        });

        datosClienteLogueado = payload;
        localStorage.setItem('sesionCliente', JSON.stringify(datosClienteLogueado));
        document.getElementById('lbl-cliente-activo').innerText = datosClienteLogueado.nombre;
        mostrarIconosHeaderSesion(true);

        await cargarMenuDesdeDB();
        goToStep(1);
    } catch(e) {
        console.error(e);
        alert("No se pudo completar el registro.");
    } finally {
        btn.disabled = false; btn.innerText = "Crear Cuenta y Ver Menú 🎉";
    }
}

function cerrarSesionCliente() {
    localStorage.removeItem('sesionCliente');
    datosClienteLogueado = null;
    document.getElementById('auth-phone').value = '';
    mostrarIconosHeaderSesion(false);
    goToStep('auth');
}

// --- 1. CARGA DINÁMICA DE LA BASE DE DATOS ---
async function cargarMenuDesdeDB() {
    cargarHorariosAtencion(); // en paralelo, no bloquea el render del catálogo
    cargarYMostrarAnuncios(); // popup de promociones, en paralelo
    try {
        const urlFresca = URL_OBTENER_MENU + "?t=" + new Date().getTime();
        const response = await fetch(urlFresca);
        
        if (!response.ok) throw new Error('Error al conectar con el servidor');
        
        const rawData = await response.json();
        const data = (Array.isArray(rawData) && rawData[0].menu) ? rawData[0] : rawData;

        menuData = {}; 

        const productosBase = data.menu ? (data.menu.productos || []) : (Array.isArray(data) ? data : []);
        const combos = data.menu ? (data.menu.combos || []) : [];
        const categoriasDeBaseDatos = data.menu ? (data.menu.categorias || []) : []; 

        const procesarItem = (prod, esCombo = false) => {
            const categoriaRaw = String(prod.categoria || (esCombo ? 'Combos' : 'Otros')).trim();
            const categoriaKey = categoriaRaw.toLowerCase().replace(/\s+/g, '_');

            if (!menuData[categoriaKey]) {
                const catInfoDB = categoriasDeBaseDatos.find(c => c.nombre.toLowerCase() === categoriaRaw.toLowerCase());
                menuData[categoriaKey] = {
                    titulo: categoriaRaw.charAt(0).toUpperCase() + categoriaRaw.slice(1),
                    imagen: catInfoDB ? catInfoDB.imagen : '', 
                    items: []
                };
            }

            const idUnico = esCombo ? 'c_' + prod.id : 'p_' + prod.id;

            menuData[categoriaKey].items.push({
                id: idUnico,
                name: prod.nombre,
                price: parseFloat(prod.precio),
                desc: prod.descripcion || "",
                image: prod.imagen || "",
                opciones_combo: esCombo ? (prod.items_json || prod.items || null) : null,
                disponible: prod.disponible !== false,
                agotado: prod.agotado === true,
                promoCantidadMinima: esCombo ? (parseInt(prod.promo_cantidad_minima) || 0) : 0,
                promoProductoId: esCombo ? (prod.promo_producto_id || null) : null,
                promoProductoCantidad: esCombo ? (parseInt(prod.promo_producto_cantidad) || 0) : 0,
                disponible_desde: prod.disponible_desde || null,
                disponible_hasta: prod.disponible_hasta || null,
                dias_disponibles: prod.dias_disponibles || null
            });
        };

        productosBase.forEach(p => procesarItem(p, false));
        combos.forEach(c => procesarItem(c, true));
        
        renderizarCategorias(); 
    } catch (error) {
        console.error("Error obteniendo el menú:", error);
    }
}

// --- 2. EL PINTOR DE BOTONES DE CATEGORÍAS ---
function renderizarCategorias() {
    const container = document.getElementById('contenedor-categorias');
    if (!container) return;
    container.innerHTML = ''; 

    const iconosRespado = ['🍱', '🍙', '🍣', '🥤', '🍰', '🥟', '🍤', '🔥']; 

    Object.keys(menuData).forEach((catKey, index) => {
        const catInfo = menuData[catKey];
        const itemsVisibles = catInfo.items.filter(i => i.disponible !== false && !i.agotado && itemDentroDeHorarioProgramado(i));
        if (itemsVisibles.length === 0) return; // categoría solo con ítems de uso interno (ej. componentes de combos)

        let arteVisual = '';
        if (catInfo.imagen && catInfo.imagen.startsWith('http')) {
            arteVisual = `<img src="${catInfo.imagen}" alt="${catInfo.titulo}" loading="lazy" fetchpriority="low" class="w-full h-full object-cover">`;
        } else {
            arteVisual = iconosRespado[index % iconosRespado.length];
        }

        const btnHtml = `
            <button type="button" onclick="selectCategory('${catKey}')" class="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-gray-100 hover:border-red-200 transition cursor-pointer text-left">
                <div class="w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 overflow-hidden">
                    ${arteVisual}
                </div>
                <div>
                    <h3 class="font-bold text-gray-800 text-lg">${catInfo.titulo}</h3>
                    <p class="text-xs text-gray-400">${itemsVisibles.length} platos disponibles</p>
                </div>
            </button>
        `;
        container.insertAdjacentHTML('beforeend', btnHtml);
    });
}

// --- 3. ACTUALIZACIÓN DEL SELECTOR DE CATEGORÍAS ---
function selectCategory(categoryKey) {
    const container = document.getElementById('items-container');
    container.innerHTML = '';
    
    document.getElementById('category-title').innerText = menuData[categoryKey].titulo;

    menuData[categoryKey].items.filter(item => item.disponible !== false && !item.agotado && itemDentroDeHorarioProgramado(item)).forEach(item => {
        let currentQty = 0;
        Object.keys(cart).forEach(key => {
            if (key === String(item.id) || key.startsWith(item.id + "_")) {
                currentQty += cart[key].qty;
            }
        });

        const esEnlace = item.image && item.image.startsWith('http');
        const vistaImagen = esEnlace 
            ? `<img src="${item.image}" alt="${item.name}" loading="lazy" class="w-20 h-20 object-cover rounded-xl flex-shrink-0 bg-gray-100 border border-gray-100 shadow-sm">`
            : `<div class="w-20 h-20 rounded-xl flex-shrink-0 bg-red-50 text-red-500 border border-red-100 flex items-center justify-center text-4xl shadow-sm">${item.image || '🍣'}</div>`;

        const itemHtml = `
            <div id="item-card-${item.id}" class="bg-white p-3 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-2 transition-all">
                <div class="flex items-center justify-between gap-3">
                    
                    <div class="flex items-center gap-3 flex-grow min-w-0 cursor-pointer" onclick="abrirDetalleProducto('${item.id}')">
                        ${vistaImagen}
                        <div class="flex-grow min-w-0 pr-1">
                            <h4 class="text-sm font-bold text-gray-800 leading-snug">${item.name}</h4>
                            <p class="text-xs text-gray-400 my-0.5 line-clamp-2">${item.desc}</p>
                            <span class="text-red-600 font-bold text-sm block mt-0.5">$${item.price.toFixed(2)}</span>
                        </div>
                    </div>
                    <div class="flex items-center space-x-1 bg-gray-100 p-1 rounded-xl flex-shrink-0 border border-gray-200">
                        <button type="button" onclick="updateQty('${item.id}', '${item.name}', ${item.price}, -1)" class="w-8 h-8 bg-white rounded-lg font-bold text-lg text-gray-700 shadow-sm select-none cursor-pointer">-</button>
                        <input type="number" id="qty-${item.id}" value="${currentQty}" min="0" onchange="setExactQty('${item.id}', '${item.name}', ${item.price}, this.value)" class="w-9 text-center font-black bg-transparent focus:outline-none text-sm text-gray-800">
                        <button type="button" onclick="updateQty('${item.id}', '${item.name}', ${item.price}, 1)" class="w-8 h-8 bg-white rounded-lg font-bold text-lg text-gray-700 shadow-sm select-none cursor-pointer">+</button>
                    </div>
                </div>
                <div class="border-t border-gray-100 pt-1">
                    <button type="button" onclick="toggleNoteField('${item.id}')" id="note-btn-${item.id}" class="text-[11px] font-medium text-gray-500 hover:text-red-600 flex items-center gap-1 cursor-pointer select-none">
                        📝 Añadir nota especial
                    </button>
                    <input type="text" id="note-input-${item.id}" oninput="updateItemNote('${item.id}', '${item.name}', ${item.price}, this.value)" class="hidden w-full mt-1.5 p-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-red-500 placeholder-gray-400" placeholder="Especificación para este plato...">
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', itemHtml);
    });
    
    goToStep(2);
}

// --- MODAL DE DETALLE DE PRODUCTO (foto grande + descripción completa) ---
function abrirDetalleProducto(itemId) {
    let encontrado = null;
    Object.values(menuData).forEach(cat => {
        const match = cat.items.find(i => i.id === itemId);
        if (match) encontrado = match;
    });
    if (!encontrado) return;

    const esEnlace = encontrado.image && encontrado.image.startsWith('http');
    document.getElementById('modal-detalle-producto-imagen-wrap').innerHTML = esEnlace
        ? `<div class="relative w-full h-full">
                <div class="absolute inset-0 flex items-center justify-center">
                    <div class="w-8 h-8 border-4 border-gray-300 border-t-red-500 rounded-full animate-spin"></div>
                </div>
                <img src="${encontrado.image}" alt="${escapeHtml(encontrado.name)}" class="relative w-full h-full object-contain opacity-0 transition-opacity duration-300" onload="this.classList.remove('opacity-0')" onerror="this.closest('.relative').innerHTML='<div class=&quot;w-full h-full flex items-center justify-center text-7xl bg-red-50 text-red-500&quot;>🍣</div>'">
           </div>`
        : `<div class="w-full h-full flex items-center justify-center text-7xl bg-red-50 text-red-500">${encontrado.image || '🍣'}</div>`;

    document.getElementById('modal-detalle-producto-nombre').innerText = encontrado.name;
    document.getElementById('modal-detalle-producto-desc').innerText = encontrado.desc || 'Sin descripción disponible.';
    document.getElementById('modal-detalle-producto-precio').innerText = `$${encontrado.price.toFixed(2)}`;

    const modal = document.getElementById('modal-detalle-producto');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function cerrarModalDetalleProducto() {
    const modal = document.getElementById('modal-detalle-producto');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// --- 4. LÓGICA DEL CARRITO ---
function toggleNoteField(id) {
    const input = document.getElementById(`note-input-${id}`);
    const btn = document.getElementById(`note-btn-${id}`);
    if (input.classList.contains('hidden')) {
        input.classList.remove('hidden'); input.focus(); btn.innerHTML = '❌ Quitar nota';
    } else {
        input.classList.add('hidden'); input.value = '';
        if (cart[id]) cart[id].note = '';
        btn.innerHTML = '📝 Añadir nota especial (ej. sin papas)';
        if (document.getElementById('step-3').classList.contains('active')) prepareCheckout();
    }
}

function updateItemNote(id, name, price, value) {
    if (!cart[id]) {
        cart[id] = { id: id, name: name, price: price, qty: 1, note: value };
        const qtyInput = document.getElementById(`qty-${id}`); if (qtyInput) qtyInput.value = 1;
        calculateTotals();
    } else {
        cart[id].note = value;
    }
    if (document.getElementById('step-3').classList.contains('active')) prepareCheckout();
}

function removeNoteFromCheckout(id) {
    if (cart[id]) {
        cart[id].note = '';
        const noteInput = document.getElementById(`note-input-${id}`); const noteBtn = document.getElementById(`note-btn-${id}`);
        if (noteInput) { noteInput.classList.add('hidden'); noteInput.value = ''; }
        if (noteBtn) noteBtn.innerHTML = '📝 Añadir nota especial (ej. sin papas)';
        prepareCheckout();
    }
}

function buscarItemEnMenuPorId(id) {
    for (let catKey in menuData) {
        const found = menuData[catKey].items.find(p => String(p.id) === String(id));
        if (found) return found;
    }
    return null;
}

function esComboConOpciones(itemOriginal) {
    try {
        if (itemOriginal && itemOriginal.opciones_combo && itemOriginal.opciones_combo !== '[]') {
            const arr = typeof itemOriginal.opciones_combo === 'string' ? JSON.parse(itemOriginal.opciones_combo) : itemOriginal.opciones_combo;
            return Array.isArray(arr) && arr.length > 0;
        }
    } catch (e) {}
    return false;
}

function totalEnCarritoParaId(id) {
    let total = 0;
    Object.keys(cart).forEach(k => { if (k === String(id) || k.startsWith(id + "_")) total += cart[k].qty; });
    return total;
}

function updateQty(id, name, price, change) {
    const itemOriginal = buscarItemEnMenuPorId(id);
    const isComboWithItems = esComboConOpciones(itemOriginal);

    if (isComboWithItems && change > 0) {
        loteComboEnCurso = null;
        abrirModalCombo(itemOriginal);
        return;
    }

    if (isComboWithItems && change < 0) {
        const keys = Object.keys(cart).filter(k => k.startsWith(id + "_"));
        if (keys.length > 1) {
            abrirSelectorEliminarVariantes(id, name);
            return;
        }
        if (keys.length === 1) {
            const lastKey = keys[0];
            cart[lastKey].qty += change;
            if (cart[lastKey].qty <= 0) delete cart[lastKey];
        }

        const element = document.getElementById(`qty-${id}`); if (element) element.value = totalEnCarritoParaId(id);
        calculateTotals();
        if (document.getElementById('step-3').classList.contains('active')) prepareCheckout();
        return;
    }

    if (!cart[id]) cart[id] = { id: id, name: name, price: price, qty: 0, note: "" };
    cart[id].qty += change;

    if (cart[id].qty <= 0) {
        delete cart[id];
        const element = document.getElementById(`qty-${id}`); if (element) element.value = 0;
    } else {
        const element = document.getElementById(`qty-${id}`); if (element) element.value = cart[id].qty;
    }
    calculateTotals();
    if (document.getElementById('step-3').classList.contains('active')) prepareCheckout();
}

function ajustarCantidadComboEscrita(id, name, itemOriginal, value) {
    let nuevoTotal = parseInt(value, 10);
    if (isNaN(nuevoTotal) || nuevoTotal < 0) nuevoTotal = 0;

    const totalActual = totalEnCarritoParaId(id);
    const delta = nuevoTotal - totalActual;

    if (delta > 0) {
        loteComboEnCurso = { id: id, restantes: delta };
        abrirModalCombo(itemOriginal);
        return;
    }

    if (delta < 0) {
        const keys = Object.keys(cart).filter(k => k.startsWith(id + "_"));
        if (keys.length > 1) {
            abrirSelectorEliminarVariantes(id, name);
            return;
        }
        if (keys.length === 1) {
            const lastKey = keys[0];
            cart[lastKey].qty += delta;
            if (cart[lastKey].qty <= 0) delete cart[lastKey];
        }
    }

    const element = document.getElementById(`qty-${id}`); if (element) element.value = totalEnCarritoParaId(id);
    calculateTotals();
    if (document.getElementById('step-3').classList.contains('active')) prepareCheckout();
}

function setExactQty(id, name, price, value) {
    const itemOriginal = buscarItemEnMenuPorId(id);
    if (esComboConOpciones(itemOriginal)) {
        ajustarCantidadComboEscrita(id, name, itemOriginal, value);
        return;
    }

    let parsedQty = parseInt(value, 10);
    if (isNaN(parsedQty) || parsedQty <= 0) {
        delete cart[id];
        const element = document.getElementById(`qty-${id}`); if (element) element.value = 0;
        const noteInput = document.getElementById(`note-input-${id}`); const noteBtn = document.getElementById(`note-btn-${id}`);
        if (noteInput) { noteInput.classList.add('hidden'); noteInput.value = ''; }
        if (noteBtn) noteBtn.innerHTML = '📝 Añadir nota especial (ej. sin papas)';
    } else {
        if (!cart[id]) cart[id] = { id: id, name: name, price: price, qty: 0, note: "" };
        cart[id].qty = parsedQty;
        const element = document.getElementById(`qty-${id}`); if (element) element.value = parsedQty;
    }
    calculateTotals();
    if (document.getElementById('step-3').classList.contains('active')) prepareCheckout();
}

// --- ELEGIR CUÁL PERSONALIZACIÓN DE UN COMBO QUITAR (cuando hay más de una distinta en el carrito) ---
function abrirSelectorEliminarVariantes(id, nombreCombo) {
    comboIdSelectorActivo = id;
    document.getElementById('eliminar-variantes-subtitulo').innerText = `Tienes varias personalizaciones de "${nombreCombo}"`;
    renderizarSelectorEliminarVariantes();

    const modal = document.getElementById('modal-eliminar-variantes');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function renderizarSelectorEliminarVariantes() {
    const cont = document.getElementById('lista-variantes-eliminar');
    if (!comboIdSelectorActivo) return;
    const keys = Object.keys(cart).filter(k => k.startsWith(comboIdSelectorActivo + "_"));

    if (keys.length === 0) {
        cerrarSelectorEliminarVariantes();
        return;
    }

    cont.innerHTML = keys.map(key => `
        <div class="flex items-center gap-2 p-2.5 bg-gray-50 rounded-xl border border-gray-200">
            <p class="text-xs text-gray-700 flex-grow leading-snug">${escapeHtml(cart[key].name)}</p>
            <div class="flex items-center gap-1.5 flex-shrink-0">
                <button type="button" onclick="quitarUnaUnidadVariante('${key}')" class="w-7 h-7 rounded-full bg-white border border-gray-300 hover:bg-gray-100 text-gray-600 font-bold text-sm cursor-pointer">−</button>
                <span class="w-5 text-center text-xs font-bold">${cart[key].qty}</span>
                <button type="button" onclick="eliminarVarianteCompleta('${key}')" title="Quitar todas" class="w-7 h-7 rounded-full bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center cursor-pointer">🗑️</button>
            </div>
        </div>
    `).join('');
}

function quitarUnaUnidadVariante(key) {
    if (!cart[key]) return;
    cart[key].qty -= 1;
    if (cart[key].qty <= 0) delete cart[key];
    sincronizarQtyTrasEdicionVariantes();
}

function eliminarVarianteCompleta(key) {
    delete cart[key];
    sincronizarQtyTrasEdicionVariantes();
}

function sincronizarQtyTrasEdicionVariantes() {
    const id = comboIdSelectorActivo;
    const element = document.getElementById(`qty-${id}`); if (element) element.value = totalEnCarritoParaId(id);
    calculateTotals();
    if (document.getElementById('step-3').classList.contains('active')) prepareCheckout();
    renderizarSelectorEliminarVariantes();
}

function cerrarSelectorEliminarVariantes() {
    const modal = document.getElementById('modal-eliminar-variantes');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    // Por si escribieron un número y cerraron sin quitar nada: el campo de cantidad
    // debe reflejar el total real del carrito, no el número que habían tecleado.
    if (comboIdSelectorActivo) {
        const element = document.getElementById(`qty-${comboIdSelectorActivo}`);
        if (element) element.value = totalEnCarritoParaId(comboIdSelectorActivo);
    }
    comboIdSelectorActivo = null;
}

function removeCartItem(id) {
    delete cart[id];
    const element = document.getElementById(`qty-${id}`); if (element) element.value = 0;
    const noteInput = document.getElementById(`note-input-${id}`); const noteBtn = document.getElementById(`note-btn-${id}`);
    if (noteInput) { noteInput.classList.add('hidden'); noteInput.value = ''; }
    if (noteBtn) noteBtn.innerHTML = '📝 Añadir nota especial (ej. sin papas)';
    calculateTotals();
    if (document.getElementById('step-3').classList.contains('active')) prepareCheckout();
}

function buscarProductoPorIdNumerico(idNumerico) {
    let encontrado = null;
    Object.values(menuData).forEach(cat => {
        const match = cat.items.find(i => i.id === 'p_' + idNumerico);
        if (match) encontrado = match;
    });
    return encontrado;
}

// --- PROMOCIONES "COMPRA N COMBOS, LLEVA M DE REGALO" ---
function sincronizarPromocionesCarrito() {
    Object.values(menuData).forEach(cat => {
        cat.items.forEach(item => {
            if (!item.id.startsWith('c_') || !item.promoCantidadMinima || !item.promoProductoId || !item.promoProductoCantidad) return;

            const promoKey = 'promo_' + item.id;
            let cantidadEnCarrito = 0;
            Object.keys(cart).forEach(k => {
                if (k === promoKey) return;
                if (cart[k].id === item.id) cantidadEnCarrito += cart[k].qty;
            });

            const veces = Math.floor(cantidadEnCarrito / item.promoCantidadMinima);
            const cantidadGratis = veces * item.promoProductoCantidad;

            if (cantidadGratis > 0) {
                const prodGratis = buscarProductoPorIdNumerico(item.promoProductoId);
                cart[promoKey] = {
                    id: 'p_' + item.promoProductoId,
                    name: `🎁 ${prodGratis ? prodGratis.name : 'Regalo'} (cortesía)`,
                    price: 0,
                    qty: cantidadGratis,
                    note: '',
                    esRegalo: true
                };
            } else {
                delete cart[promoKey];
            }
        });
    });
}

function calculateTotals() {
    sincronizarPromocionesCarrito();
    let total = 0; let count = 0;
    Object.values(cart).forEach(item => { total += item.price * item.qty; count += item.qty; });
    document.getElementById('sticky-cart-total').innerText = `$${total.toFixed(2)}`;
    
    const activeStep = document.querySelector('.step.active') ? document.querySelector('.step.active').id : 'step-1';
    if (count > 0 && activeStep !== 'step-3' && activeStep !== 'step-4' && activeStep !== 'step-auth' && activeStep !== 'step-registro') {
        document.getElementById('sticky-cart-bar').classList.remove('hidden');
    } else {
        document.getElementById('sticky-cart-bar').classList.add('hidden');
    }
}

function updateStickyBarVisibility(currentStep) {
    let count = 0; Object.values(cart).forEach(item => { count += item.qty; });
    if (count > 0 && currentStep !== 3 && currentStep !== 4 && currentStep !== 'auth' && currentStep !== 'registro') {
        document.getElementById('sticky-cart-bar').classList.remove('hidden');
    } else {
        document.getElementById('sticky-cart-bar').classList.add('hidden');
    }
}

// --- 5. CHECKOUT Y FORMULARIOS ---
function prepareCheckout() {
    const summaryContainer = document.getElementById('checkout-cart-summary');
    summaryContainer.innerHTML = '';
    
    const cartItems = Object.keys(cart);
    if (cartItems.length === 0) {
        document.getElementById('checkout-total-price').innerText = "$0.00";
        goToStep(1); return;
    }
    
    let total = 0;
    cartItems.forEach(id => {
        const item = cart[id]; const subtotal = item.price * item.qty; total += subtotal;
        
        const noteHtml = item.note ? `
            <div class="flex items-center justify-between text-xs text-amber-900 bg-amber-100/70 px-2 py-1.5 rounded-xl mt-1 font-medium border border-amber-200 gap-2 shadow-xs">
                <span class="truncate pr-1">📌 Nota: "${escapeHtml(item.note)}"</span>
                <button type="button" onclick="removeNoteFromCheckout('${id}')" class="text-red-500 hover:text-red-700 font-bold p-1 cursor-pointer select-none text-[11px] flex-shrink-0 transition">❌</button>
            </div>` : '';
        
        const controlesHtml = item.esRegalo ? `
                    <span class="flex-shrink-0 bg-emerald-100 text-emerald-700 text-xs font-bold px-3 py-2 rounded-xl">x${item.qty} gratis</span>
        ` : `
                    <div class="flex items-center space-x-1.5 bg-white border border-amber-300 p-1 rounded-xl flex-shrink-0">
                        <button type="button" onclick="updateQty('${id}', '${item.name}', ${item.price}, -1)" class="w-8 h-8 bg-amber-100 text-amber-900 rounded-lg font-bold text-md flex items-center justify-center cursor-pointer shadow-sm">-</button>
                        <input type="number" value="${item.qty}" min="0" onchange="setExactQty('${id}', '${item.name}', ${item.price}, this.value)" class="w-10 text-center font-black text-sm text-gray-800 bg-transparent focus:outline-none">
                        <button type="button" onclick="updateQty('${id}', '${item.name}', ${item.price}, 1)" class="w-8 h-8 bg-amber-100 text-amber-900 rounded-lg font-bold text-md flex items-center justify-center cursor-pointer shadow-sm">+</button>
                    </div>
                    <button type="button" onclick="removeCartItem('${id}')" class="text-red-500 hover:text-red-700 text-md p-1 cursor-pointer flex-shrink-0">❌</button>
        `;

        const summaryRowHtml = `
            <div class="py-2 border-b border-amber-200">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex-grow">
                        <p class="font-bold text-gray-800 text-sm leading-tight">${item.name}</p>
                        <p class="text-xs text-amber-900 font-medium mt-0.5">$${item.price.toFixed(2)} c/u • Subtotal: <span class="font-bold">$${subtotal.toFixed(2)}</span></p>
                    </div>
                    ${controlesHtml}
                </div>
                ${noteHtml}
            </div>`;
        summaryContainer.insertAdjacentHTML('beforeend', summaryRowHtml);
    });
    
    document.getElementById('checkout-total-price').innerText = `$${total.toFixed(2)}`;

    document.getElementById('chk-usar-mis-datos').checked = true;
    toggleFormularioDatosEnvio();
    cargarSelectorDirecciones();
    toggleAddress();

    if (!document.getElementById('step-3').classList.contains('active')) goToStep(3);
}

function toggleFormularioDatosEnvio() {
    const isChecked = document.getElementById('chk-usar-mis-datos').checked;
    const wrapperNuevosDatos = document.getElementById('wrapper-datos-destinatario');
    const inputNombre = document.getElementById('client-name');
    const inputTelefono = document.getElementById('client-phone');
    const select = document.getElementById('sel-direccion-entrega');

    if (isChecked) {
        wrapperNuevosDatos.classList.add('hidden');
        inputNombre.removeAttribute('required');
        inputTelefono.removeAttribute('required');
        
        if (select && select.options.length > 0) {
            select.selectedIndex = 0; 
        }
    } else {
        wrapperNuevosDatos.classList.remove('hidden');
        inputNombre.setAttribute('required', 'required');
        inputTelefono.setAttribute('required', 'required');
        
        inputNombre.value = datosClienteLogueado ? datosClienteLogueado.nombre : '';
        inputTelefono.value = datosClienteLogueado ? datosClienteLogueado.telefono : '';
        
        if (select) {
            select.value = "__MANUAL__";
        }
    }
    manejarSeleccionDireccion();
}

function cargarSelectorDirecciones() {
    const select = document.getElementById('sel-direccion-entrega');
    if (!select || !datosClienteLogueado) return;

    select.innerHTML = ''; 

    const dirPrincipal = datosClienteLogueado.direccion_principal || "Mi dirección registrada";

    const optPrincipal = document.createElement('option');
    optPrincipal.value = dirPrincipal;
    optPrincipal.innerText = `🏠 Principal: ${String(dirPrincipal).substring(0, 35)}...`;
    select.appendChild(optPrincipal);

    let extras = [];
    try {
        if (datosClienteLogueado.direcciones_extra) {
            extras = typeof datosClienteLogueado.direcciones_extra === 'string' 
                ? JSON.parse(datosClienteLogueado.direcciones_extra) 
                : datosClienteLogueado.direcciones_extra;
        }
    } catch(e) { extras = []; }

    if (Array.isArray(extras)) {
        extras.forEach((dir, i) => {
            if (dir && typeof dir === 'string') {
                const opt = document.createElement('option');
                opt.value = dir;
                opt.innerText = `📍 Frecuente ${i+1}: ${dir.substring(0, 35)}...`;
                select.appendChild(opt);
            }
        });
    }

    const optManual = document.createElement('option');
    optManual.value = "__MANUAL__";
    optManual.innerText = "🗺️ Usar otra dirección (Playa, trabajo, etc)...";
    select.appendChild(optManual);

    manejarSeleccionDireccion(); 
}

function manejarSeleccionDireccion() {
    const select = document.getElementById('sel-direccion-entrega');
    const wrapperManual = document.getElementById('wrapper-direccion-manual');
    const inputAddress = document.getElementById('client-address');

    if (select.value === "__MANUAL__") {
        wrapperManual.classList.remove('hidden'); inputAddress.setAttribute('required', 'required'); inputAddress.value = '';
    } else {
        wrapperManual.classList.add('hidden'); inputAddress.removeAttribute('required'); inputAddress.value = select.value;
    }
}

function toggleAddress() {
    const type = document.getElementById('delivery-type').value;
    const container = document.getElementById('address-container');
    const input = document.getElementById('client-address');
    const select = document.getElementById('sel-direccion-entrega');

    if (type === 'Pickup' || type === 'En el Local') {
        container.style.display = 'none'; input.removeAttribute('required'); select.removeAttribute('required');
    } else {
        container.style.display = 'block'; select.setAttribute('required', 'required'); manejarSeleccionDireccion();
    }
}

function resetForm() {
    cart = {}; document.getElementById('order-form').reset();
    calculateTotals(); toggleAddress(); goToStep(1); 
}

// --- 6. ENVÍO DE ORDEN AL BACKEND ---
async function sendOrder(event) {
    event.preventDefault();
    
    const itemsInCart = Object.values(cart);
    if (itemsInCart.length === 0) { alert("⚠️ Tu carrito está vacío."); goToStep(1); return; }

    if (!estaAbiertoAhora()) { mostrarBannerCerrado(); return; }

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.innerText = "Enviando Orden..."; submitBtn.disabled = true;

    const esParaMi = document.getElementById('chk-usar-mis-datos').checked;
    const nombreFinal = esParaMi ? datosClienteLogueado.nombre : document.getElementById('client-name').value.trim();
    const telefonoFinal = esParaMi ? datosClienteLogueado.telefono : document.getElementById('client-phone').value.trim();

    const tipoEntrega = document.getElementById('delivery-type').value;
    let direccionFinal = "Retiro por local";
    
    if (tipoEntrega === 'Delivery') {
        const select = document.getElementById('sel-direccion-entrega');
        if (select.value === "__MANUAL__") {
            direccionFinal = document.getElementById('client-address').value.trim();
            if (document.getElementById('chk-guardar-frecuente').checked) {
                let extras = [];
                try { extras = JSON.parse(datosClienteLogueado.direcciones_extra || '[]'); } catch(e){}
                if (!extras.includes(direccionFinal)) {
                    extras.push(direccionFinal);
                    datosClienteLogueado.direcciones_extra = JSON.stringify(extras);
                    localStorage.setItem('sesionCliente', JSON.stringify(datosClienteLogueado));
                    
                    fetch("https://prueba-tokyo-workers-production-76cf.up.railway.app/api/clientes/actualizar-direcciones-cliente", {
                        method: 'POST', 
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer TokioSushi_App_2026_X'
                        },
                        body: JSON.stringify({ telefono: datosClienteLogueado.telefono, direcciones_extra: datosClienteLogueado.direcciones_extra })
                    }).catch(err => console.error(err));
                }
            }
        } else {
            direccionFinal = select.value;
        }
    }

    const orderPayload = {
        timestamp: new Date().toISOString(),
        cliente: nombreFinal,
        telefono: telefonoFinal,
        tipo_entrega: tipoEntrega,
        direccion: direccionFinal,
        metodo_pago: document.getElementById('payment-method').value,
        articulos: itemsInCart,
        metadata_titular: datosClienteLogueado ? `Pedido por: ${datosClienteLogueado.nombre} (CI: ${datosClienteLogueado.cedula})` : "No registrado",
        estado_inicial: tipoEntrega === 'Delivery' ? 'Calculando Delivery' : 'Pago Pendiente',
        pedido_detallado: "Generado por Backend" // Validacion Pydantic FastAPI
    };

    const urlBackendPedidos = "https://prueba-tokyo-workers-production-76cf.up.railway.app/api/pedidos/"; 

    try {
        const response = await fetch(urlBackendPedidos, {
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer TokioSushi_App_2026_X'
            },
            body: JSON.stringify(orderPayload)
        });
        
        if (response.ok) {
            goToStep(4);
        } else {
            alert("Hubo un error al procesar tu pedido. Por favor intenta de nuevo.");
            console.error("Error del servidor:", await response.text());
        }
    } catch (error) {
        console.error("Error de conexión:", error); 
        alert("Fallo de conexión. Revisa tu internet e intenta de nuevo.");
    } finally {
        submitBtn.innerText = "🚀 Confirmar y Enviar Pedido"; submitBtn.disabled = false;
    }
}

// --- CONTROL EXCLUSIVO DEL MODAL DE COMBOS ---
let comboEnPersonalizacion = null;
let estadoPiezasCombo = {};

function abrirModalCombo(item) {
    comboEnPersonalizacion = item;
    document.getElementById('modal-combo-title').innerText = item.name;
    
    let gruposOpciones = [];
    try {
        gruposOpciones = typeof item.opciones_combo === 'string' 
            ? JSON.parse(item.opciones_combo || '[]') 
            : (item.opciones_combo || []);
    } catch(e) { gruposOpciones = []; }

    const container = document.getElementById('modal-combo-options-container');
    container.innerHTML = '';
    let selectIndex = 0;
    let piezasGroupIndex = 0;
    estadoPiezasCombo = {};
    const btnConfirmarCombo = document.getElementById('btn-confirmar-combo');
    if (btnConfirmarCombo) { btnConfirmarCombo.disabled = false; btnConfirmarCombo.classList.remove('opacity-40', 'cursor-not-allowed'); }

    gruposOpciones.forEach((grupo) => {
        if (grupo.tipo === 'categoria') {
            let opcionesCat = [];
            for(let key in menuData) {
                if(menuData[key].titulo.toLowerCase() === grupo.valor.toLowerCase()) {
                    opcionesCat = menuData[key].items.filter(i => !i.agotado);
                    break;
                }
            }

            if(opcionesCat.length === 0) {
                container.insertAdjacentHTML('beforeend', `<p class="text-xs text-red-500 mb-2 font-bold">⚠️ Categoría "${grupo.valor}" vacía o inactiva.</p>`);
                return;
            }

            let optionsHtml = opcionesCat.map(opt => `<option value="${opt.name}" data-desc="${escapeHtml(opt.desc || '')}" data-img="${escapeHtml(opt.image || '')}">${opt.name}</option>`).join('');
            let primeraOpcion = opcionesCat[0];
            let primeraDesc = primeraOpcion && primeraOpcion.desc ? primeraOpcion.desc : '';

            for(let i=0; i < grupo.cantidad; i++) {
                let tituloVisual = grupo.cantidad > 1 ? `Elige tu ${grupo.valor} (${i+1} de ${grupo.cantidad})` : `Elige tu ${grupo.valor}`;

                let grupoHtml = `
                    <div class="space-y-1 mb-3">
                        <label class="block text-gray-500 font-bold text-[10px] uppercase tracking-wider">${tituloVisual}</label>
                        <div class="flex items-center gap-2">
                            <div id="img-combo-${selectIndex}" class="flex-shrink-0">${construirMiniaturaComboHtml(primeraOpcion ? primeraOpcion.image : '')}</div>
                            <div class="flex-grow min-w-0">
                                <select id="select-combo-grupo-${selectIndex}" onchange="actualizarDescripcionCombo(this, 'desc-combo-${selectIndex}', 'img-combo-${selectIndex}')" class="w-full p-2.5 border border-gray-300 rounded-xl text-xs bg-gray-50 focus:outline-none focus:border-red-500 font-medium text-gray-800 shadow-sm cursor-pointer">
                                    ${optionsHtml}
                                </select>
                                <p id="desc-combo-${selectIndex}" class="text-[10px] text-gray-400 italic px-1 min-h-[15px] mt-1">${primeraDesc}</p>
                            </div>
                        </div>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', grupoHtml);
                selectIndex++;
            }
        } else if (grupo.tipo === 'producto') {
            let prodOriginal = null;
            for (let key in menuData) {
                const encontrado = menuData[key].items.find(x => x.id === 'p_' + grupo.valor);
                if (encontrado) { prodOriginal = encontrado; break; }
            }

            let prodName = grupo.nombre_producto || (prodOriginal ? prodOriginal.name : null) || (isNaN(grupo.valor) ? grupo.valor : "Producto Fijo");
            let descFija = prodOriginal ? prodOriginal.desc : "";

            if (prodOriginal && prodOriginal.agotado) {
                container.insertAdjacentHTML('beforeend', `
                    <div class="space-y-1 mb-3">
                        <div class="w-full p-3 rounded-xl text-xs bg-red-50 border border-red-200 text-red-700 font-medium leading-relaxed">
                            ⚠️ Por los momentos no tenemos <strong>${escapeHtml(prodName)}</strong> disponible, para que sea tomado en cuenta a la hora de ordenar.
                        </div>
                    </div>
                `);
                return;
            }

            let htmlDescFija = descFija ? `<p class="text-[10px] text-gray-400 italic px-1 mt-0.5">${descFija}</p>` : '';

            let fijoHtml = `
                <div class="space-y-1 mb-3">
                    <label class="block text-gray-500 font-bold text-[10px] uppercase tracking-wider">Incluido Fijo</label>
                    <div class="flex items-center gap-2">
                        ${construirMiniaturaComboHtml(prodOriginal ? prodOriginal.image : '')}
                        <div class="flex-grow min-w-0 p-2.5 border border-gray-200 rounded-xl text-xs bg-emerald-50 text-emerald-700 font-medium flex items-center justify-between shadow-sm">
                            <span class="truncate pr-2">✔️ ${prodName}</span>
                            <span class="font-black flex-shrink-0 bg-emerald-200 px-2 py-0.5 rounded">x${grupo.cantidad}</span>
                        </div>
                    </div>
                    ${htmlDescFija}
                </div>
            `;
            container.insertAdjacentHTML('beforeend', fijoHtml);
        } else if (grupo.tipo === 'piezas_alternativas') {
            const pgIndex = piezasGroupIndex++;
            const modo = grupo.modo || (grupo.compartido === true ? 'compartido' : 'excluyente');
            const alternativasResueltas = (grupo.alternativas || []).map(alt => ({
                nombre: alt.nombre,
                piezas_objetivo: alt.piezas_objetivo,
                opciones: resolverOpcionesCategorias(alt.categorias || (alt.categoria ? [alt.categoria] : []))
            })).filter(alt => alt.piezas_objetivo > 0);

            if (alternativasResueltas.length === 0) return;

            estadoPiezasCombo[pgIndex] = { alternativas: alternativasResueltas, alternativaActiva: 0, seleccion: {}, modo };

            const hayVariosEstilos = alternativasResueltas.length > 1;
            const tituloEstilos = modo === 'todas' ? 'Completa cada elección' : (modo === 'compartido' ? 'Navega por categoría' : 'Elige tu estilo');
            const selectorEstiloHtml = hayVariosEstilos ? `
                <label class="block text-gray-600 font-bold text-[10px] uppercase tracking-wider">${tituloEstilos}</label>
                <div class="flex gap-2 flex-wrap" id="estilos-piezas-${pgIndex}">${alternativasResueltas.map((alt, i) => `
                    <button type="button" onclick="seleccionarEstiloPiezas(${pgIndex}, ${i})" data-idx="${i}"
                        class="flex-1 py-2 rounded-xl text-xs font-bold border transition estilo-btn-${pgIndex} ${i === 0 ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-300'}">
                        <span class="chulo-estilo-${pgIndex}-${i}"></span>${escapeHtml(alt.nombre)}${modo === 'compartido' ? '' : ` <span class="opacity-70">(${alt.piezas_objetivo}pz)</span>`}
                    </button>
                `).join('')}</div>
            ` : '';

            const subtituloHtml = hayVariosEstilos
                ? `<span class="text-[10px] text-gray-400">${modo === 'compartido' ? 'Combina los sabores que quieras' : 'Completa esta elección antes de pasar a la siguiente'}</span>`
                : `<label class="text-gray-600 font-bold text-[10px] uppercase tracking-wider">${escapeHtml(alternativasResueltas[0].nombre)}</label>`;

            const grupoPiezasHtml = `
                <div class="space-y-2 mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    ${selectorEstiloHtml}
                    <div class="flex items-center justify-between mt-1">
                        ${subtituloHtml}
                        <span id="contador-piezas-${pgIndex}" class="text-xs font-black px-2 py-0.5 rounded-full bg-red-100 text-red-600">0 / ${alternativasResueltas[0].piezas_objetivo} pz</span>
                    </div>
                    <div id="lista-sabores-piezas-${pgIndex}" class="space-y-2 mt-2"></div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', grupoPiezasHtml);
            renderSaboresPiezas(pgIndex);
        }
    });

    document.getElementById('btn-confirmar-combo').onclick = guardarSeleccionCombo;
    document.getElementById('modal-combo').classList.remove('hidden');
    document.getElementById('modal-combo').classList.add('flex');
}

function cerrarModalCombo() {
    document.getElementById('modal-combo').classList.remove('flex');
    document.getElementById('modal-combo').classList.add('hidden');
    comboEnPersonalizacion = null;
    // Si se cancela a mitad de pedir varias unidades seguidas, se aborta el resto del lote
    // (las unidades ya confirmadas antes de cancelar se quedan en el carrito).
    loteComboEnCurso = null;
}

function construirMiniaturaComboHtml(valorImagen) {
    if (valorImagen && valorImagen.startsWith('http')) {
        return `<img src="${valorImagen}" alt="" loading="lazy" onclick="abrirLightboxImagen('${valorImagen.replace(/'/g, "\\'")}')" onerror="mostrarFallbackMiniatura(this)" class="w-14 h-14 rounded-lg object-cover border border-gray-200 bg-gray-50 flex-shrink-0 cursor-zoom-in active:opacity-70 transition">`;
    }
    return `<div class="w-14 h-14 rounded-lg border border-gray-200 bg-red-50 text-red-400 flex-shrink-0 flex items-center justify-center text-2xl">${valorImagen || '🍣'}</div>`;
}

function mostrarFallbackMiniatura(imgEl) {
    const div = document.createElement('div');
    div.className = 'w-14 h-14 rounded-lg border border-gray-200 bg-red-50 text-red-400 flex-shrink-0 flex items-center justify-center text-2xl';
    div.textContent = '🍣';
    imgEl.replaceWith(div);
}

function abrirLightboxImagen(url) {
    if (!url) return;
    document.getElementById('lightbox-imagen-img').src = url;
    const modal = document.getElementById('modal-lightbox-imagen');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function cerrarLightboxImagen() {
    const modal = document.getElementById('modal-lightbox-imagen');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.getElementById('lightbox-imagen-img').src = '';
}

// --- GRUPOS DE COMBO "ELIGE ESTILO + COMBINA SABORES POR PIEZAS" ---
function resolverOpcionesCategoria(nombreCategoria) {
    for (let key in menuData) {
        if (menuData[key].titulo.toLowerCase() === (nombreCategoria || '').toLowerCase()) {
            return menuData[key].items.filter(i => !i.agotado);
        }
    }
    return [];
}

function resolverOpcionesCategorias(nombresCategorias) {
    const vistos = new Set();
    const resultado = [];
    (nombresCategorias || []).forEach(nombre => {
        resolverOpcionesCategoria(nombre).forEach(item => {
            if (!vistos.has(item.id)) {
                vistos.add(item.id);
                resultado.push(item);
            }
        });
    });
    return resultado;
}

function seleccionarEstiloPiezas(pgIndex, altIndex) {
    const estado = estadoPiezasCombo[pgIndex];
    if (!estado) return;
    estado.alternativaActiva = altIndex;
    if (estado.modo === 'excluyente') estado.seleccion = {};
    renderSaboresPiezas(pgIndex);
}

function subtotalParaAlt(estado, alt) {
    let total = 0;
    alt.opciones.forEach(item => { total += estado.seleccion[item.id] || 0; });
    return total;
}

function renderSaboresPiezas(pgIndex) {
    const estado = estadoPiezasCombo[pgIndex];
    if (!estado) return;
    const alt = estado.alternativas[estado.alternativaActiva];

    document.querySelectorAll(`.estilo-btn-${pgIndex}`).forEach(btn => {
        const idx = parseInt(btn.dataset.idx);
        const activo = idx === estado.alternativaActiva;
        const altBtn = estado.alternativas[idx];
        const completo = estado.modo === 'todas' && subtotalParaAlt(estado, altBtn) === altBtn.piezas_objetivo;
        let clases = `flex-1 py-2 rounded-xl text-xs font-bold border transition estilo-btn-${pgIndex} `;
        if (activo) clases += 'bg-red-600 text-white border-red-600';
        else if (completo) clases += 'bg-emerald-50 text-emerald-700 border-emerald-300';
        else clases += 'bg-white text-gray-600 border-gray-300';
        btn.className = clases;
        const chulo = btn.querySelector(`.chulo-estilo-${pgIndex}-${idx}`);
        if (chulo) chulo.textContent = (completo && !activo) ? '✓ ' : '';
    });

    const contenedor = document.getElementById(`lista-sabores-piezas-${pgIndex}`);
    if (!contenedor) return;

    if (alt.opciones.length === 0) {
        contenedor.innerHTML = `<p class="text-xs text-red-500 font-bold px-1">⚠️ No hay sabores disponibles para "${escapeHtml(alt.nombre)}" en este momento.</p>`;
    } else {
        contenedor.innerHTML = alt.opciones.map(item => {
            const cantActual = estado.seleccion[item.id] || 0;
            return `
            <div class="flex items-center gap-2 p-2 bg-white rounded-lg border border-gray-200">
                ${construirMiniaturaComboHtml(item.image)}
                <div class="flex-grow min-w-0">
                    <p class="text-xs font-bold text-gray-800 truncate">${escapeHtml(item.name)}</p>
                    ${item.desc ? `<p class="text-[10px] text-gray-400 italic leading-snug mt-0.5">${escapeHtml(item.desc)}</p>` : ''}
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                    <button type="button" onclick="ajustarCantidadPiezas(${pgIndex}, '${item.id}', -1)" class="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm cursor-pointer">−</button>
                    <input type="number" id="cant-pieza-${pgIndex}-${item.id}" value="${cantActual}" min="0" onchange="escribirCantidadPieza(${pgIndex}, '${item.id}', this.value)" class="w-10 text-center text-xs font-bold border border-gray-200 rounded-md py-0.5 focus:outline-none focus:border-red-500">
                    <button type="button" onclick="ajustarCantidadPiezas(${pgIndex}, '${item.id}', 1)" class="btn-mas-pieza-${pgIndex} w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">+</button>
                </div>
            </div>
        `;
        }).join('');
    }

    actualizarContadorPiezas(pgIndex);
}

function ajustarCantidadPiezas(pgIndex, itemId, delta) {
    const estado = estadoPiezasCombo[pgIndex];
    if (!estado) return;

    if (delta > 0) {
        const { total, objetivo } = calcularPiezasSeleccionadas(estado);
        if (total >= objetivo) return;
    }

    const actual = estado.seleccion[itemId] || 0;
    const nuevo = Math.max(0, actual + delta);
    if (nuevo === 0) delete estado.seleccion[itemId];
    else estado.seleccion[itemId] = nuevo;

    const input = document.getElementById(`cant-pieza-${pgIndex}-${itemId}`);
    if (input) input.value = nuevo;

    actualizarContadorPiezas(pgIndex);
}

function escribirCantidadPieza(pgIndex, itemId, valor) {
    const estado = estadoPiezasCombo[pgIndex];
    if (!estado) return;

    let nuevo = parseInt(valor, 10);
    if (isNaN(nuevo) || nuevo < 0) nuevo = 0;

    const actual = estado.seleccion[itemId] || 0;
    const { total, objetivo } = calcularPiezasSeleccionadas(estado);
    const maximoPermitido = Math.max(0, objetivo - (total - actual));
    if (nuevo > maximoPermitido) nuevo = maximoPermitido;

    if (nuevo === 0) delete estado.seleccion[itemId];
    else estado.seleccion[itemId] = nuevo;

    const input = document.getElementById(`cant-pieza-${pgIndex}-${itemId}`);
    if (input) input.value = nuevo;

    actualizarContadorPiezas(pgIndex);
}

function calcularPiezasSeleccionadas(estado) {
    if (estado.modo === 'compartido') {
        const objetivo = estado.alternativas[0].piezas_objetivo;
        let total = 0;
        Object.keys(estado.seleccion).forEach(itemId => { total += estado.seleccion[itemId]; });
        return { total, objetivo };
    }
    // 'excluyente' y 'todas' muestran/limitan el avance de la pestaña activa
    const alt = estado.alternativas[estado.alternativaActiva];
    return { total: subtotalParaAlt(estado, alt), objetivo: alt.piezas_objetivo };
}

function actualizarContadorPiezas(pgIndex) {
    const estado = estadoPiezasCombo[pgIndex];
    if (!estado) return;
    const { total, objetivo } = calcularPiezasSeleccionadas(estado);

    const badge = document.getElementById(`contador-piezas-${pgIndex}`);
    if (badge) {
        badge.innerText = `${total} / ${objetivo} pz`;
        badge.className = `text-xs font-black px-2 py-0.5 rounded-full ${total === objetivo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`;
    }

    document.querySelectorAll(`.btn-mas-pieza-${pgIndex}`).forEach(btn => { btn.disabled = total >= objetivo; });

    actualizarEstadoBotonConfirmar();
}

function grupoPiezasCompleto(estado) {
    if (estado.modo === 'todas') {
        return estado.alternativas.every(alt => subtotalParaAlt(estado, alt) === alt.piezas_objetivo);
    }
    const { total, objetivo } = calcularPiezasSeleccionadas(estado);
    return total === objetivo;
}

function todosLosGruposPiezasCompletos() {
    return Object.values(estadoPiezasCombo).every(grupoPiezasCompleto);
}

function actualizarEstadoBotonConfirmar() {
    const btn = document.getElementById('btn-confirmar-combo');
    if (!btn) return;
    const listo = todosLosGruposPiezasCompletos();
    btn.disabled = !listo;
    btn.classList.toggle('opacity-40', !listo);
    btn.classList.toggle('cursor-not-allowed', !listo);
}

function actualizarDescripcionCombo(selectElement, idParrafo, idImgWrap) {
    const opcionSeleccionada = selectElement.options[selectElement.selectedIndex];
    const descripcion = opcionSeleccionada.getAttribute('data-desc');
    const parrafo = document.getElementById(idParrafo);

    if (parrafo) {
        parrafo.innerText = descripcion || '';
    }

    if (idImgWrap) {
        const imgWrap = document.getElementById(idImgWrap);
        if (imgWrap) imgWrap.innerHTML = construirMiniaturaComboHtml(opcionSeleccionada.getAttribute('data-img'));
    }
}

function guardarSeleccionCombo() {
    if (!comboEnPersonalizacion) return;

    if (!todosLosGruposPiezasCompletos()) {
        alert('⚠️ Completa la cantidad exacta de piezas antes de continuar.');
        return;
    }

    let elecciones = [];
    let clavesVariante = [];
    let selects = document.querySelectorAll('[id^="select-combo-grupo-"]');

    selects.forEach(select => {
        elecciones.push(select.value);
        clavesVariante.push(select.value);
    });

    Object.keys(estadoPiezasCombo).forEach(pgIndex => {
        const estado = estadoPiezasCombo[pgIndex];
        const todasLasOpciones = estado.alternativas.flatMap(a => a.opciones);
        const formatearDetalles = (itemIds) => itemIds.map(itemId => {
            const item = todasLasOpciones.find(o => o.id === itemId);
            const cant = estado.seleccion[itemId];
            clavesVariante.push(`${itemId}x${cant}`);
            return `${cant}x ${item ? item.name : itemId}`;
        }).join(', ');

        if (estado.modo === 'todas') {
            estado.alternativas.forEach(alt => {
                const idsDeEstaAlt = alt.opciones.map(o => o.id).filter(id => estado.seleccion[id] > 0);
                if (idsDeEstaAlt.length > 0) elecciones.push(`${alt.nombre}: ${formatearDetalles(idsDeEstaAlt)}`);
            });
        } else {
            const idsSeleccionados = Object.keys(estado.seleccion);
            if (idsSeleccionados.length > 0) {
                const texto = formatearDetalles(idsSeleccionados);
                elecciones.push(estado.modo === 'compartido' ? texto : `${estado.alternativas[estado.alternativaActiva].nombre}: ${texto}`);
            }
        }
    });

    let descripcionVariante = elecciones.length > 0 ? elecciones.join(' | ') : '';
    let stringClave = clavesVariante.length > 0 ? clavesVariante.join('_').replace(/[^a-zA-Z0-9]/g, '') : 'fijo';
    let variantKey = comboEnPersonalizacion.id + "_" + stringClave;

    let cartName = elecciones.length > 0 ? `${comboEnPersonalizacion.name} (${descripcionVariante})` : comboEnPersonalizacion.name;

    if (!cart[variantKey]) {
        cart[variantKey] = {
            id: comboEnPersonalizacion.id,
            name: cartName,
            price: comboEnPersonalizacion.price,
            qty: 1,
            note: "" 
        };
    } else {
        cart[variantKey].qty += 1;
    }

    let totalQty = 0;
    Object.keys(cart).forEach(k => {
        if (k === String(comboEnPersonalizacion.id) || k.startsWith(comboEnPersonalizacion.id + "_")) {
            totalQty += cart[k].qty;
        }
    });

    const inputQty = document.getElementById(`qty-${comboEnPersonalizacion.id}`);
    if (inputQty) inputQty.value = totalQty;

    calculateTotals();
    if (document.getElementById('step-3').classList.contains('active')) prepareCheckout();

    // Si el cliente escribió una cantidad mayor (ej. 3) y todavía faltan unidades por
    // personalizar de ese lote, reabrimos el modal para la siguiente en vez de cerrar.
    if (loteComboEnCurso && loteComboEnCurso.id === comboEnPersonalizacion.id && loteComboEnCurso.restantes > 1) {
        loteComboEnCurso.restantes -= 1;
        abrirModalCombo(comboEnPersonalizacion);
        return;
    }

    loteComboEnCurso = null;
    cerrarModalCombo();
}

// ==========================================
// GESTIÓN DE DIRECCIONES Y PERFIL
// ==========================================

function abrirModalEditarDatos() {
    if (!datosClienteLogueado) return;

    document.getElementById('lbl-cliente-activo').innerText = datosClienteLogueado.nombre;
    document.getElementById('edit-telefono').value = datosClienteLogueado.telefono || '';
    document.getElementById('edit-dir-principal').value = datosClienteLogueado.direccion_principal || '';
    renderizarDireccionesExtra();

    document.getElementById('modal-editar-datos').classList.remove('hidden');
    document.getElementById('modal-editar-datos').classList.add('flex');
}

async function guardarTelefonoCliente() {
    const btn = document.getElementById('btn-guardar-telefono');
    const nuevoTelefono = document.getElementById('edit-telefono').value.trim();
    if (!nuevoTelefono) { alert('Ingresa un número de teléfono.'); return; }
    if (nuevoTelefono === datosClienteLogueado.telefono) return;

    btn.disabled = true; btn.innerText = '...';

    try {
        const response = await fetch("https://prueba-tokyo-workers-production-76cf.up.railway.app/api/clientes/actualizar-telefono", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer TokioSushi_App_2026_X'
            },
            body: JSON.stringify({ telefono_actual: datosClienteLogueado.telefono, telefono_nuevo: nuevoTelefono })
        });
        const data = await response.json();

        if (!response.ok) {
            alert(data.detail || 'No se pudo actualizar el número.');
            return;
        }

        datosClienteLogueado.telefono = nuevoTelefono;
        localStorage.setItem('sesionCliente', JSON.stringify(datosClienteLogueado));
        alert('✅ Número actualizado correctamente.');
    } catch (e) {
        console.error("Error al actualizar teléfono:", e);
        alert('Error de conexión al actualizar el número.');
    } finally {
        btn.disabled = false; btn.innerText = 'Actualizar';
    }
}

function cerrarModalEditarDatos() {
    document.getElementById('modal-editar-datos').classList.remove('flex');
    document.getElementById('modal-editar-datos').classList.add('hidden');
}

function renderizarDireccionesExtra() {
    const contenedor = document.getElementById('lista-direcciones-extra');
    contenedor.innerHTML = '';
    
    let extras = [];
    try {
        if (datosClienteLogueado.direcciones_extra) {
            extras = typeof datosClienteLogueado.direcciones_extra === 'string' 
                ? JSON.parse(datosClienteLogueado.direcciones_extra) 
                : datosClienteLogueado.direcciones_extra;
        }
    } catch(e) { extras = []; }

    if (!Array.isArray(extras) || extras.length === 0) {
        contenedor.innerHTML = '<p class="text-xs text-gray-400 italic bg-gray-50 p-3 rounded-lg border border-dashed border-gray-200">No tienes direcciones adicionales guardadas aún.</p>';
        return;
    }

    extras.forEach((dir, index) => {
        if (!dir) return;
        const div = document.createElement('div');
        div.className = "flex items-center justify-between bg-white p-2.5 rounded-xl border border-gray-200 gap-3 shadow-sm";
        div.innerHTML = `
            <p class="text-[13px] text-gray-700 line-clamp-2 flex-grow font-medium leading-snug">${escapeHtml(dir)}</p>
            <button type="button" onclick="eliminarDireccionExtra(${index})" class="w-8 h-8 flex items-center justify-center bg-red-50 text-red-500 hover:bg-red-500 hover:text-white rounded-lg text-sm transition flex-shrink-0 cursor-pointer" title="Eliminar">🗑️</button>
        `;
        contenedor.appendChild(div);
    });
}

function eliminarDireccionExtra(index) {
    let extras = [];
    try {
        extras = typeof datosClienteLogueado.direcciones_extra === 'string' 
            ? JSON.parse(datosClienteLogueado.direcciones_extra) 
            : datosClienteLogueado.direcciones_extra;
    } catch(e) { return; }
    
    extras.splice(index, 1);
    
    datosClienteLogueado.direcciones_extra = JSON.stringify(extras);
    localStorage.setItem('sesionCliente', JSON.stringify(datosClienteLogueado));
    
    renderizarDireccionesExtra();
    cargarSelectorDirecciones(); 
}

async function guardarEdicionDatos() {
    const btn = document.getElementById('btn-guardar-datos');
    const dirPrincipalNueva = document.getElementById('edit-dir-principal').value.trim();
    
    btn.disabled = true; btn.innerText = "Guardando...";

    datosClienteLogueado.direccion_principal = dirPrincipalNueva;
    localStorage.setItem('sesionCliente', JSON.stringify(datosClienteLogueado));
    cargarSelectorDirecciones();

    try {
        await fetch("https://prueba-tokyo-workers-production-76cf.up.railway.app/api/clientes/actualizar-direcciones-cliente", {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer TokioSushi_App_2026_X'
            },
            body: JSON.stringify({ 
                telefono: datosClienteLogueado.telefono, 
                direccion_principal: datosClienteLogueado.direccion_principal,
                direcciones_extra: datosClienteLogueado.direcciones_extra 
            })
        });
    } catch(e) {
        console.error("Error al guardar en servidor:", e);
    } finally {
        btn.disabled = false; btn.innerText = "💾 Guardar Cambios";
        cerrarModalEditarDatos();
    }
}
