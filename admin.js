// =====================================================================
// 🍣 TOKIO SUSHI - PANEL DE ADMINISTRACIÓN AVANZADO (admin.js) 🍣
// Lógica exclusiva, limpia y blindada.
// =====================================================================

// --- URLs DE CONEXIÓN CON FASTAPI (REEMPLAZANDO n8n) ---
const API_VALIDAR_ACCESO = "https://prueba-tokyo-workers-production.up.railway.app/api/usuarios/validar-acceso";
const ADMIN_URL_MENU = "https://prueba-tokyo-workers-production.up.railway.app/api/menu/";
const ADMIN_URL_GUARDAR_CAT = "https://prueba-tokyo-workers-production.up.railway.app/api/menu/guardar-categoria";
const ADMIN_URL_GUARDAR_PROD = "https://prueba-tokyo-workers-production.up.railway.app/api/menu/guardar-producto";
const ADMIN_URL_GUARDAR_COMBO = "https://prueba-tokyo-workers-production.up.railway.app/api/menu/guardar-combo";
const ADMIN_URL_ELIMINAR = "https://prueba-tokyo-workers-production.up.railway.app/api/menu/eliminar-item";

const URL_OBTENER_USUARIOS_ADMIN = "https://prueba-tokyo-workers-production.up.railway.app/api/usuarios/";
const ADMIN_URL_GUARDAR_USUARIO = "https://prueba-tokyo-workers-production.up.railway.app/api/usuarios/guardar";
const ADMIN_URL_ELIMINAR_USUARIO = "https://prueba-tokyo-workers-production.up.railway.app/api/usuarios/eliminar";

const URL_OBTENER_MOTORIZADOS = "https://prueba-tokyo-workers-production.up.railway.app/api/motorizados/";
const ADMIN_URL_GUARDAR_MOT = "https://prueba-tokyo-workers-production.up.railway.app/api/motorizados/guardar";
const ADMIN_URL_ELIMINAR_MOT = "https://prueba-tokyo-workers-production.up.railway.app/api/motorizados/eliminar";

const URL_OBTENER_MSJ = "https://prueba-tokyo-workers-production.up.railway.app/api/mensajes/";
const URL_GUARDAR_MSJ = "https://prueba-tokyo-workers-production.up.railway.app/api/mensajes/guardar";

const URL_OBTENER_HORARIOS = "https://prueba-tokyo-workers-production.up.railway.app/api/horarios/";
const URL_GUARDAR_HORARIOS = "https://prueba-tokyo-workers-production.up.railway.app/api/horarios/guardar";

// --- MEMORIA DEL ADMINISTRADOR ---
let adminCategorias = [];
let adminProductos = [];
let adminCombos = [];
let USUARIOS_SISTEMA = [];
let MOTORIZADOS_SISTEMA = [];
let adminToken = ""; // 🛡️ LLAVE MAESTRA OCULTA PARA OPERACIONES CRÍTICAS

// ==========================================
// 1. LÓGICA DE SEGURIDAD Y DESBLOQUEO
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const inputPin = document.getElementById('input-pin-admin');
    if (inputPin) inputPin.focus();
});

async function desbloquearAdmin() {
    const userIngresado = document.getElementById('input-user-admin').value.trim();
    const pinIngresado = document.getElementById('input-pin-admin').value.trim();
    const errorMsg = document.getElementById('error-pin-admin');
    const boton = document.getElementById('btn-desbloquear-admin');
    
    // Verificamos que no deje las cajas vacías
    if (!userIngresado || !pinIngresado) {
        lanzarErrorBloqueo(errorMsg, boton, "Debes ingresar usuario y PIN.");
        return;
    }
    
    errorMsg.classList.add('hidden');
    boton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verificando...';
    boton.disabled = true;

    try {
        const response = await fetch(API_VALIDAR_ACCESO, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // AHORA ENVIAMOS EL USUARIO AL BACKEND
            body: JSON.stringify({ tipo: 'login_admin', username: userIngresado, pin: pinIngresado })
        });

        const data = await response.json();

        if (data.success && data.usuario) {
            adminToken = data.token;
            localStorage.setItem('tokioAuthToken', data.token);
            localStorage.setItem('usuarioActivo', JSON.stringify(data.usuario));

            document.getElementById('pantalla-bloqueo-admin').style.opacity = '0';
            setTimeout(() => { document.getElementById('pantalla-bloqueo-admin').classList.add('hidden'); }, 300);
            
            cargarDatosAdmin();
            cargarMensajesWP();
            cargarHorarios();
        } else {
            lanzarErrorBloqueo(errorMsg, boton, "Usuario/PIN incorrecto o sin privilegios.");
        }
    } catch (error) {
        lanzarErrorBloqueo(errorMsg, boton, "Error de conexión con el servidor.");
    }
}

function lanzarErrorBloqueo(errorMsg, boton, mensaje) {
    errorMsg.innerText = mensaje;
    errorMsg.classList.remove('hidden');
    boton.innerHTML = 'Desbloquear Panel <i class="fa-solid fa-unlock-keyhole"></i>';
    boton.disabled = false;
    document.getElementById('input-pin-admin').value = ''; // Borramos el PIN por seguridad
    document.getElementById('input-pin-admin').focus();
}

// ==========================================
// 2. CARGA DE DATOS MAESTRA
// ==========================================
async function cargarDatosAdmin() {
    try {
        const res = await fetch(ADMIN_URL_MENU);
        const rawData = await res.json();
        const data = Array.isArray(rawData) ? rawData[0] : rawData;
        
        adminCategorias = data.menu ? (data.menu.categorias || []) : [];
        adminProductos = data.menu ? (data.menu.productos || []) : [];
        adminCombos = data.menu ? (data.menu.combos || []) : [];

        renderListaCategorias();
        renderListaProductos();
        renderListaCombos();
        actualizarSelectCategorias();
        actualizarSelectsCombos();

        await cargarMotorizadosDesdeDB();
        await cargarUsuariosDesdeDB();
        
        const listaItems = document.getElementById('lista-items-combo');
        if (listaItems && listaItems.innerHTML === '') agregarFilaProductoCombo();
    } catch (error) {
        console.error("Error cargando datos del admin:", error);
    }
}

// ==========================================
// 3. MENSAJES DE WHATSAPP
// ==========================================
async function cargarMensajesWP() {
    const txtRecepcion = document.getElementById('msg-recepcion');
    if(!txtRecepcion) return; 

    try {
        txtRecepcion.value = "Cargando plantillas desde la base de datos...";
        const res = await fetch(URL_OBTENER_MSJ, { headers: authHeaders() });
        const data = await res.json();
        const mensajes = Array.isArray(data) ? data : (data.data || []);
        
        mensajes.forEach(m => {
            if(m.id === 'recepcion') document.getElementById('msg-recepcion').value = m.texto;
            if(m.id === 'cobro_pago_movil') document.getElementById('msg-cobro-pago-movil').value = m.texto;
            if(m.id === 'cobro_zelle') document.getElementById('msg-cobro-zelle').value = m.texto;
            if(m.id === 'cobro_efectivo') document.getElementById('msg-cobro-efectivo').value = m.texto;
            if(m.id === 'aprobado') document.getElementById('msg-aprobado').value = m.texto;
            if(m.id === 'final_delivery') document.getElementById('msg-final-delivery').value = m.texto;
            if(m.id === 'final_pickup') document.getElementById('msg-final-pickup').value = m.texto;
            if(m.id === 'modificado') document.getElementById('msg-modificado').value = m.texto;
            if(m.id === 'aviso_grupo_delivery') document.getElementById('msg-grupo-delivery').value = m.texto;
        });
    } catch (e) { 
        if(txtRecepcion) txtRecepcion.value = "Error de conexión. Verifica n8n.";
    }
}

const formMensajes = document.getElementById('form-mensajes');
if(formMensajes) {
    formMensajes.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            recepcion: document.getElementById('msg-recepcion').value,
            cobro_pago_movil: document.getElementById('msg-cobro-pago-movil').value,
            cobro_zelle: document.getElementById('msg-cobro-zelle').value,
            cobro_efectivo: document.getElementById('msg-cobro-efectivo').value,
            aprobado: document.getElementById('msg-aprobado').value,
            final_delivery: document.getElementById('msg-final-delivery').value,
            final_pickup: document.getElementById('msg-final-pickup').value,
            modificado: document.getElementById('msg-modificado').value,
            aviso_grupo_delivery: document.getElementById('msg-grupo-delivery').value
        };
        try {
            await fetch(URL_GUARDAR_MSJ, { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}`}, 
                body: JSON.stringify(payload) 
            });
            alert("¡Mensajes actualizados con éxito!");
        } catch (error) { alert("Error al guardar en la base de datos."); }
    });
}

// ==========================================
// 4. GESTIÓN DE USUARIOS
// ==========================================
async function cargarUsuariosDesdeDB() {
    try {
        const response = await fetch(URL_OBTENER_USUARIOS_ADMIN, { headers: authHeaders() });
        const data = await response.json();
        USUARIOS_SISTEMA = Array.isArray(data) ? data : (data.data || []);
        renderListaUsuarios();
    } catch (error) { console.error("Error obteniendo usuarios:", error); }
}

function renderListaUsuarios() {
    const cont = document.getElementById('lista-usuarios-container');
    if(!cont) return;
    cont.innerHTML = '';
    
    if (USUARIOS_SISTEMA.length === 0) {
        cont.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">No hay usuarios registrados.</p>'; return;
    }
    
    USUARIOS_SISTEMA.forEach(u => {
        const esAdmin = (String(u.rol).toLowerCase() === 'admin' || String(u.rol).toLowerCase() === 'superadmin');
        let botones = esAdmin 
            ? `<span style="font-size: 10px; background: rgba(239,68,68,0.2); color: #f87171; padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(239,68,68,0.3); text-transform: uppercase; font-weight: bold;">Protegido 🛡️</span>`
            : `<button type="button" class="action-btn btn-edit" onclick="editarUsuario(${u.id})" title="Editar">✏️</button>
               <button type="button" class="action-btn btn-delete" onclick="eliminarUsuario(${u.id})" title="Eliminar">🗑️</button>`;

        cont.innerHTML += `
            <div class="list-item">
                <div class="item-info">
                    <p class="item-title">👤 ${u.nombre}</p>
                    <p class="item-meta">User: <span style="color:#38bdf8; font-weight:bold;">${u.username}</span> | Rol: ${u.rol}</p>
                </div>
                <div class="item-actions">${botones}</div>
            </div>`;
    });
}

if (document.getElementById('form-usuario')) {
    document.getElementById('form-usuario').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('usr-id').value;
        const pinIngresado = document.getElementById('usr-pin').value.trim();

        if (!id && !pinIngresado) {
            alert('El PIN es obligatorio al crear un usuario nuevo.');
            return;
        }

        const payload = {
            id: id ? parseInt(id) : null,
            nombre: document.getElementById('usr-nombre').value.trim(),
            username: document.getElementById('usr-username').value.trim(),
            pin: pinIngresado || null,
            rol: document.getElementById('usr-rol').value
        };
        try {
            const res = await fetch(ADMIN_URL_GUARDAR_USUARIO, { 
                method: 'POST', 
                headers:{'Content-Type':'application/json', 'Authorization': `Bearer ${adminToken}`}, 
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            
            if (!data.success) {
                alert("Error de Base de Datos: " + data.error);
                return;
            }
            
            resetFormUsr(); 
            await cargarUsuariosDesdeDB();
        } catch (error) { alert('Error de red al intentar conectar con el servidor.'); }
    });
}

function editarUsuario(id) {
    const u = USUARIOS_SISTEMA.find(x => x.id === id); if(!u) return;
    document.getElementById('usr-id').value = u.id;
    document.getElementById('usr-nombre').value = u.nombre;
    document.getElementById('usr-username').value = u.username;
    // El PIN nunca vuelve del backend (queda hasheado) — se deja vacío,
    // solo se sobreescribe si el admin escribe uno nuevo.
    const inputPin = document.getElementById('usr-pin');
    inputPin.value = '';
    inputPin.placeholder = 'Dejar en blanco para no cambiar el PIN';
    document.getElementById('usr-rol').value = u.rol;
    document.getElementById('titulo-form-usr').innerText = "Editar Usuario";
    document.getElementById('btn-save-usr').innerText = "💾 Actualizar Usuario";
    document.getElementById('btn-cancel-usr').style.display = "block";
}

function resetFormUsr() {
    document.getElementById('form-usuario').reset();
    document.getElementById('usr-id').value = "";
    document.getElementById('usr-pin').placeholder = 'Ej: 1234';
    document.getElementById('titulo-form-usr').innerText = "Crear Usuario";
    document.getElementById('btn-save-usr').innerText = "💾 Guardar Usuario";
    document.getElementById('btn-cancel-usr').style.display = "none";
}

async function eliminarUsuario(id) {
    if (!confirm(`¿Seguro que deseas ELIMINAR este usuario del sistema?`)) return;
    try {
        await fetch(ADMIN_URL_ELIMINAR_USUARIO, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` }, 
            body: JSON.stringify({ id: id }) 
        });
        await cargarUsuariosDesdeDB();
    } catch(e) { alert('Error al eliminar.'); }
}

// ==========================================
// 5. GESTIÓN DE MOTORIZADOS
// ==========================================
async function cargarMotorizadosDesdeDB() {
    try {
        const res = await fetch(URL_OBTENER_MOTORIZADOS + "?t=" + new Date().getTime(), { headers: authHeaders() });
        const data = await res.json();
        MOTORIZADOS_SISTEMA = Array.isArray(data) ? data : (data.data || []);
        renderListaMotorizados();
    } catch (error) { console.error("Error obteniendo motorizados:", error); }
}

function renderListaMotorizados() {
    const cont = document.getElementById('lista-motorizados-container');
    if(!cont) return;
    cont.innerHTML = '';
    
    if (MOTORIZADOS_SISTEMA.length === 0) {
        cont.innerHTML = '<p class="text-sm text-slate-500 italic">No hay motorizados registrados.</p>'; return;
    }
    
    MOTORIZADOS_SISTEMA.forEach(m => {
        cont.innerHTML += `
            <div class="list-item">
                <div class="item-info"><p class="item-title">🏍️ ${m.nombre}</p></div>
                <div class="item-actions">
                    <button class="action-btn btn-edit" onclick="editarMotorizado(${m.id})" title="Editar">✏️</button>
                    <button class="action-btn btn-delete" onclick="eliminarMotorizado(${m.id})" title="Eliminar">🗑️</button>
                </div>
            </div>`;
    });
}

if (document.getElementById('form-motorizado')) {
    document.getElementById('form-motorizado').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('mot-id').value;
        const payload = { id: id ? parseInt(id) : null, nombre: document.getElementById('mot-nombre').value.trim() };
        try {
            const res = await fetch(ADMIN_URL_GUARDAR_MOT, { 
                method: 'POST', 
                headers:{'Content-Type':'application/json', 'Authorization': `Bearer ${adminToken}`}, 
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            
            if (!data.success) {
                alert("Error de Base de Datos: " + data.error);
                return;
            }
            
            resetFormMot(); 
            await cargarMotorizadosDesdeDB();
        } catch (error) { alert('Error de red al intentar conectar con el servidor.'); }
    });
}

function editarMotorizado(id) {
    const m = MOTORIZADOS_SISTEMA.find(x => x.id === id); if(!m) return;
    document.getElementById('mot-id').value = m.id; 
    document.getElementById('mot-nombre').value = m.nombre;
    document.getElementById('titulo-form-mot').innerText = "Editar Motorizado";
    document.getElementById('btn-save-mot').innerText = "💾 Actualizar";
    document.getElementById('btn-cancel-mot').style.display = "block";
}

function resetFormMot() {
    document.getElementById('form-motorizado').reset(); 
    document.getElementById('mot-id').value = "";
    document.getElementById('titulo-form-mot').innerText = "Registrar Motorizado";
    document.getElementById('btn-save-mot').innerText = "💾 Guardar Chofer";
    document.getElementById('btn-cancel-mot').style.display = "none";
}

async function eliminarMotorizado(id) {
    if (!confirm(`¿Seguro que deseas eliminar este motorizado?`)) return;
    try {
        await fetch(ADMIN_URL_ELIMINAR_MOT, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` }, 
            body: JSON.stringify({ id: id }) 
        });
        await cargarMotorizadosDesdeDB();
    } catch(e) { alert('Error al eliminar.'); }
}

// ==========================================
// GESTIÓN DEL HORARIO DE ATENCIÓN
// ==========================================
async function cargarHorarios() {
    try {
        const res = await fetch(URL_OBTENER_HORARIOS, { headers: authHeaders() });
        const data = await res.json();
        const horarios = Array.isArray(data) ? data : (data.data || []);
        horarios.forEach(h => {
            const chk = document.getElementById(`hor-activo-${h.dia_semana}`);
            const inicio = document.getElementById(`hor-inicio-${h.dia_semana}`);
            const fin = document.getElementById(`hor-fin-${h.dia_semana}`);
            if (!chk || !inicio || !fin) return;
            chk.checked = h.activo;
            inicio.value = h.hora_apertura || '';
            fin.value = h.hora_cierre || '';
            inicio.disabled = !h.activo;
            fin.disabled = !h.activo;
        });
    } catch (error) { console.error("Error obteniendo horarios:", error); }
}

function toggleHorarioDia(dia) {
    const activo = document.getElementById(`hor-activo-${dia}`).checked;
    document.getElementById(`hor-inicio-${dia}`).disabled = !activo;
    document.getElementById(`hor-fin-${dia}`).disabled = !activo;
}

async function guardarHorarios() {
    const btn = document.getElementById('btn-save-horarios');
    const horarios = [];
    for (let dia = 0; dia <= 6; dia++) {
        const activo = document.getElementById(`hor-activo-${dia}`).checked;
        const inicio = document.getElementById(`hor-inicio-${dia}`).value;
        const fin = document.getElementById(`hor-fin-${dia}`).value;
        if (activo && (!inicio || !fin)) {
            alert('Falta la hora de apertura o cierre en un día marcado como abierto.');
            return;
        }
        horarios.push({ dia_semana: dia, activo, hora_apertura: inicio || '00:00', hora_cierre: fin || '00:00' });
    }

    btn.disabled = true; btn.innerText = "Guardando...";
    try {
        const res = await fetch(URL_GUARDAR_HORARIOS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
            body: JSON.stringify({ horarios })
        });
        const data = await res.json();
        if (data.success) {
            alert("✅ Horario de atención actualizado.");
        } else {
            alert("Error al guardar: " + (data.detail || data.error || "desconocido"));
        }
    } catch (error) {
        alert('Error de red al guardar el horario.');
    } finally {
        btn.disabled = false; btn.innerText = "💾 Guardar Horario";
    }
}

// ==========================================
// 6. GESTIÓN DEL MENÚ (CAT, PROD, COMBOS)
// ==========================================
function renderListaCategorias(lista = adminCategorias) {
    const cont = document.getElementById('lista-categorias-container');
    if(!cont) return;
    cont.innerHTML = '';
    if (lista.length === 0) { cont.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">No se encontraron categorías.</p>'; return; }

    lista.forEach(cat => {
        cont.innerHTML += `
            <div class="list-item">
                <div class="item-info"><p class="item-title">${cat.nombre}</p></div>
                <div class="item-actions">
                    <button class="action-btn btn-edit" onclick="editarCategoria(${cat.id})" title="Editar">✏️</button>
                    <button class="action-btn btn-delete" onclick="eliminarItem(${cat.id}, 'categoria')" title="Eliminar">🗑️</button>
                </div>
            </div>`;
    });
}

function filtrarCategoriasAdmin() {
    const textoBuscado = document.getElementById('buscador-categorias-admin').value.toLowerCase();
    const resultados = adminCategorias.filter(c => c.nombre.toLowerCase().includes(textoBuscado));
    renderListaCategorias(resultados);
}

if (document.getElementById('form-categoria')) {
    document.getElementById('form-categoria').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('cat-id').value;
        const payload = { id: id ? parseInt(id) : null, nombre: document.getElementById('cat-nombre').value.trim(), imagen: document.getElementById('cat-imagen').value.trim() };
        try {
            await fetch(ADMIN_URL_GUARDAR_CAT, { 
                method: 'POST', 
                headers:{'Content-Type':'application/json', 'Authorization': `Bearer ${adminToken}`}, 
                body: JSON.stringify(payload)
            });
            resetFormCat(); cargarDatosAdmin();
        } catch (error) { alert('Error al guardar la categoría.'); }
    });
}

function editarCategoria(id) {
    const cat = adminCategorias.find(c => c.id === id); if(!cat) return;
    document.getElementById('cat-id').value = cat.id; document.getElementById('cat-nombre').value = cat.nombre; document.getElementById('cat-imagen').value = cat.imagen || '';
    document.getElementById('titulo-form-cat').innerText = "Editar Categoría"; document.getElementById('btn-save-cat').innerText = "💾 Actualizar Categoría"; document.getElementById('btn-cancel-cat').style.display = "block";
}

function resetFormCat() {
    document.getElementById('form-categoria').reset(); document.getElementById('cat-id').value = "";
    if (document.getElementById('cat-imagen')) document.getElementById('cat-imagen').value = "";
    document.getElementById('titulo-form-cat').innerText = "Crear Categoría"; document.getElementById('btn-save-cat').innerText = "💾 Guardar Categoría"; document.getElementById('btn-cancel-cat').style.display = "none";
    if(document.getElementById('buscador-categorias-admin')) document.getElementById('buscador-categorias-admin').value = '';
}

function renderListaProductos(lista = adminProductos) {
    const cont = document.getElementById('lista-productos-container');
    if(!cont) return;
    cont.innerHTML = '';
    if (lista.length === 0) { cont.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">No se encontraron productos.</p>'; return; }

    lista.forEach(p => {
        const opacityClass = p.disponible ? '' : 'deshabilitado';
        cont.innerHTML += `
            <div class="list-item ${opacityClass}">
                <div class="item-info">
                    <p class="item-title">${p.nombre} <span style="color:#10b981">$${p.precio}</span></p>
                    <p class="item-meta">Cat: ${p.categoria} | Disp: ${p.disponible ? 'Sí' : 'No'}</p>
                </div>
                <div class="item-actions">
                    <button class="action-btn btn-edit" onclick="editarProducto(${p.id})" title="Editar">✏️</button>
                    <button class="action-btn btn-delete" onclick="eliminarItem(${p.id}, 'producto')" title="Eliminar">🗑️</button>
                </div>
            </div>`;
    });
}

function filtrarProductosAdmin() {
    const textoBuscado = document.getElementById('buscador-productos-admin').value.toLowerCase();
    const resultados = adminProductos.filter(p => p.nombre.toLowerCase().includes(textoBuscado));
    renderListaProductos(resultados);
}

function actualizarSelectCategorias() {
    const select = document.getElementById('prod-categoria');
    if(!select) return;
    select.innerHTML = '<option value="">-- Selecciona Categoría --</option>';
    adminCategorias.forEach(cat => { select.innerHTML += `<option value="${cat.nombre}">${cat.nombre}</option>`; });
}

function obtenerEmojiPlato() {
    const emojis = ['🍱', '🍙', '🍣', '🥤', '🍰', '🥟', '🍤', '🔥', '🍜', '🥢'];
    return emojis[Math.floor(Math.random() * emojis.length)];
}

if (document.getElementById('form-producto')) {
    document.getElementById('form-producto').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('prod-id').value;
        let imgFinalProd = document.getElementById('prod-imagen').value.trim();
        if (imgFinalProd === '') imgFinalProd = obtenerEmojiPlato();
        const payload = {
            id: id ? parseInt(id) : null, nombre: document.getElementById('prod-nombre').value.trim(), categoria: document.getElementById('prod-categoria').value,
            precio: parseFloat(document.getElementById('prod-precio').value), imagen: imgFinalProd, descripcion: document.getElementById('prod-descripcion').value.trim(), disponible: document.getElementById('prod-disponible').checked
        };
        try {
            await fetch(ADMIN_URL_GUARDAR_PROD, { 
                method: 'POST', 
                headers:{'Content-Type':'application/json', 'Authorization': `Bearer ${adminToken}`}, 
                body: JSON.stringify(payload)
            });
            resetFormProd(); cargarDatosAdmin();
        } catch (error) { alert('Error al guardar el producto.'); }
    });
}

function editarProducto(id) {
    const p = adminProductos.find(x => x.id === id); if(!p) return;
    document.getElementById('prod-id').value = p.id; document.getElementById('prod-nombre').value = p.nombre; document.getElementById('prod-categoria').value = p.categoria;
    document.getElementById('prod-precio').value = p.precio; document.getElementById('prod-imagen').value = p.imagen || ''; document.getElementById('prod-descripcion').value = p.descripcion; document.getElementById('prod-disponible').checked = p.disponible;
    document.getElementById('titulo-form-prod').innerText = "Editar Producto"; document.getElementById('btn-save-prod').innerText = "💾 Actualizar Producto"; document.getElementById('btn-cancel-prod').style.display = "block";
}

function resetFormProd() {
    document.getElementById('form-producto').reset(); document.getElementById('prod-id').value = "";
    if (document.getElementById('prod-imagen')) document.getElementById('prod-imagen').value = "";
    document.getElementById('titulo-form-prod').innerText = "Crear Producto"; document.getElementById('btn-save-prod').innerText = "💾 Guardar Producto"; document.getElementById('btn-cancel-prod').style.display = "none";
}

function renderListaCombos(lista = adminCombos) {
    const cont = document.getElementById('lista-combos-container');
    if(!cont) return;
    cont.innerHTML = '';
    if (lista.length === 0) { cont.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">No se encontraron combos.</p>'; return; }

    lista.forEach(c => {
        const opacityClass = c.disponible ? '' : 'deshabilitado';
        cont.innerHTML += `
            <div class="list-item ${opacityClass}">
                <div class="item-info">
                    <p class="item-title">${c.nombre} <span style="color:#10b981">$${c.precio}</span></p>
                    <p class="item-meta">Disp: ${c.disponible ? 'Sí' : 'No'}</p>
                </div>
                <div class="item-actions">
                    <button class="action-btn btn-edit" onclick="editarCombo(${c.id})" title="Editar">✏️</button>
                    <button class="action-btn btn-delete" onclick="eliminarItem(${c.id}, 'combo')" title="Eliminar">🗑️</button>
                </div>
            </div>`;
    });
}

function filtrarCombosAdmin() {
    const textoBuscado = document.getElementById('buscador-combos-admin').value.toLowerCase();
    const resultados = adminCombos.filter(c => c.nombre.toLowerCase().includes(textoBuscado));
    renderListaCombos(resultados);
}

function actualizarSelectsCombos() {
    let datalist = document.getElementById('lista-productos-combo');
    if (!datalist) { datalist = document.createElement('datalist'); datalist.id = 'lista-productos-combo'; document.body.appendChild(datalist); }
    datalist.innerHTML = adminProductos.map(p => `<option value="${p.nombre} ($${p.precio})"></option>`).join('');
}

function agregarFilaProductoCombo(valorSeleccionado = "", qty = 1) {
    const contenedor = document.getElementById('lista-items-combo');
    const fila = document.createElement('div');
    fila.className = 'fila-item-combo'; fila.style.display = 'flex'; fila.style.gap = '10px'; fila.style.marginBottom = '10px';

    let nombreLegible = "";
    if (valorSeleccionado.startsWith('CAT_')) { nombreLegible = "📁 Categoría: " + valorSeleccionado.replace('CAT_', ''); } 
    else if (valorSeleccionado.startsWith('PROD_')) {
        const pId = parseInt(valorSeleccionado.replace('PROD_', ''));
        const p = adminProductos.find(x => x.id === pId);
        if (p) nombreLegible = "🍣 Producto: " + p.nombre;
    }

    const idCaja = 'sug-combo-' + Math.random().toString(36).substr(2, 9);
    fila.innerHTML = `
        <div style="flex: 2; position: relative;">
            <input type="text" onfocus="buscarItemCombo(this, '${idCaja}')" oninput="buscarItemCombo(this, '${idCaja}')" value="${nombreLegible}" placeholder="🔍 Buscar categoría o producto..." autocomplete="off" class="item-visible" style="width: 100%; padding: 0.75rem; background-color: #0f172a; border: 1px solid #334155; color: white; border-radius: 6px; outline: none;">
            <input type="hidden" class="item-referencia" value="${valorSeleccionado}">
            <div id="${idCaja}" class="caja-sugerencias hidden" style="display: none; position: absolute; z-index: 50; width: 100%; margin-top: 4px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; max-height: 250px; overflow-y: auto; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5);"></div>
        </div>
        <input type="number" class="item-cantidad" min="1" value="${qty}" required style="flex: 1; padding: 0.75rem; background-color: #0f172a; border: 1px solid #334155; color: white; border-radius: 6px;" placeholder="Cant.">
        <button type="button" onclick="this.parentElement.remove()" style="background: #e11d48; color: white; border: none; border-radius: 4px; padding: 0 15px; cursor: pointer; font-weight: bold;">X</button>
    `;
    contenedor.appendChild(fila);
}

function buscarItemCombo(inputElement, idCaja) {
    const contenedor = document.getElementById(idCaja); const hiddenInput = inputElement.nextElementSibling; const texto = inputElement.value.toLowerCase().trim();
    hiddenInput.value = "";
    const catFiltradas = adminCategorias.filter(c => c.nombre.toLowerCase().includes(texto) || texto === '');
    const prodFiltrados = adminProductos.filter(p => p.nombre.toLowerCase().includes(texto) || texto === '');

    let html = '';
    if (catFiltradas.length > 0) {
        html += '<div style="padding: 8px 10px; font-size: 11px; color: #94a3b8; font-weight: bold; background: #0f172a; text-transform: uppercase;">👉 Que el cliente elija (Categorías)</div>';
        catFiltradas.forEach(c => { html += `<div onclick="seleccionarSugerenciaCombo(this, '${idCaja}', 'CAT_${c.nombre}', '📁 Categoría: ${c.nombre}')" style="padding: 10px; cursor: pointer; font-size: 13px; color: white; border-bottom: 1px solid #334155; transition: background 0.2s;" onmouseover="this.style.background='#334155'" onmouseout="this.style.background='transparent'">📁 ${c.nombre}</div>`; });
    }
    if (prodFiltrados.length > 0) {
        html += '<div style="padding: 8px 10px; font-size: 11px; color: #94a3b8; font-weight: bold; background: #0f172a; text-transform: uppercase;">👉 Incluido Fijo (Productos)</div>';
        prodFiltrados.forEach(p => { html += `<div onclick="seleccionarSugerenciaCombo(this, '${idCaja}', 'PROD_${p.id}', '🍣 Producto: ${p.nombre}')" style="padding: 10px 20px 10px 10px; cursor: pointer; font-size: 13px; color: white; border-bottom: 1px solid #334155; transition: background 0.2s; display: flex; justify-content: space-between; align-items: center;" onmouseover="this.style.background='#334155'" onmouseout="this.style.background='transparent'"><span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 10px;">🍣 ${p.nombre}</span><span style="color:#10b981; font-weight: bold; flex-shrink: 0;">$${p.precio.toFixed(2)}</span></div>`; });
    }
    if (html === '') html = '<div style="padding: 10px; font-size: 13px; color: #94a3b8; font-style: italic;">No hay coincidencias...</div>';

    document.querySelectorAll('.caja-sugerencias').forEach(caja => caja.style.display = 'none');
    contenedor.innerHTML = html; contenedor.style.display = 'block';
}

function seleccionarSugerenciaCombo(elemento, idCaja, valorReal, textoLegible) {
    const contenedor = document.getElementById(idCaja); const hiddenInput = contenedor.previousElementSibling; const visibleInput = hiddenInput.previousElementSibling;
    hiddenInput.value = valorReal; visibleInput.value = textoLegible; contenedor.style.display = 'none';
}

document.addEventListener('click', function(e) {
    if (!e.target.classList.contains('item-visible')) document.querySelectorAll('.caja-sugerencias').forEach(caja => caja.style.display = 'none');
});

const btnAddCombo = document.getElementById('btn-add-item');
if (btnAddCombo) btnAddCombo.onclick = function() { agregarFilaProductoCombo(); };

const formCombo = document.getElementById('form-combo');
if (formCombo) {
    formCombo.onsubmit = async function(e) {
        e.preventDefault();
        const id = document.getElementById('combo-id').value;
        const itemsSeleccionados = [];
        let faltaHacerClic = false;

        document.querySelectorAll('.fila-item-combo').forEach(fila => {
            const ref = fila.querySelector('.item-referencia').value; const qty = parseInt(fila.querySelector('.item-cantidad').value); const visibleText = fila.querySelector('.item-visible').value.trim();
            if (visibleText !== "" && ref === "") faltaHacerClic = true;
            else if (ref && qty > 0) {
                if (ref.startsWith('CAT_')) itemsSeleccionados.push({ tipo: 'categoria', valor: ref.replace('CAT_', ''), cantidad: qty });
                else if (ref.startsWith('PROD_')) {
                    const pId = parseInt(ref.replace('PROD_', ''));
                    const pEncontrado = adminProductos.find(x => x.id === pId);
                    const nombreReal = pEncontrado ? pEncontrado.nombre : 'Producto Fijo';
                    itemsSeleccionados.push({ tipo: 'producto', valor: pId, nombre_producto: nombreReal, cantidad: qty });
                }
            }
        });

        if (faltaHacerClic) { alert('⚠️ Importante: Debes HACER CLIC en una de las opciones flotantes.'); return; }
        if (itemsSeleccionados.length === 0) { alert('Añade al menos 1 elemento válido al combo.'); return; }

        let imgFinalCombo = document.getElementById('combo-imagen').value.trim();
        if (imgFinalCombo === '' && typeof obtenerEmojiPlato === 'function') imgFinalCombo = obtenerEmojiPlato();

        const payload = {
            id: id ? parseInt(id) : null, nombre: document.getElementById('combo-nombre').value.trim(), precio: parseFloat(document.getElementById('combo-precio').value),
            imagen: imgFinalCombo, descripcion: document.getElementById('combo-descripcion').value.trim(), items: itemsSeleccionados, disponible: document.getElementById('combo-disponible').checked
        };
        
        try {
            await fetch(ADMIN_URL_GUARDAR_COMBO, { 
                method: 'POST', 
                headers:{'Content-Type':'application/json', 'Authorization': `Bearer ${adminToken}`}, 
                body: JSON.stringify(payload)
            });
            resetFormCombo(); cargarDatosAdmin();
        } catch (error) { alert('Error al guardar el combo.'); }
    };
}

function editarCombo(id) {
    const c = adminCombos.find(x => x.id === id); if(!c) return;
    document.getElementById('combo-id').value = c.id; document.getElementById('combo-nombre').value = c.nombre; document.getElementById('combo-precio').value = c.precio;
    document.getElementById('combo-imagen').value = c.imagen || ''; document.getElementById('combo-descripcion').value = c.descripcion || ''; document.getElementById('combo-disponible').checked = c.disponible;
    
    document.getElementById('lista-items-combo').innerHTML = '';
    let parsedItems = [];
    try { parsedItems = typeof c.items_json === 'string' ? JSON.parse(c.items_json) : c.items_json; } catch(e){}
    
    if (parsedItems && parsedItems.length > 0) {
        parsedItems.forEach(item => {
            if (item.tipo) { const valorSelect = item.tipo === 'categoria' ? 'CAT_' + item.valor : 'PROD_' + item.valor; agregarFilaProductoCombo(valorSelect, item.cantidad); }
        });
    } else agregarFilaProductoCombo(); 

    document.getElementById('titulo-form-combo').innerText = "Editar Combo"; document.getElementById('btn-save-combo').innerText = "🍱 Actualizar Combo"; document.getElementById('btn-cancel-combo').style.display = "block";
}

function resetFormCombo() {
    document.getElementById('form-combo').reset(); document.getElementById('combo-id').value = ""; document.getElementById('lista-items-combo').innerHTML = '';
    agregarFilaProductoCombo(); document.getElementById('titulo-form-combo').innerText = "Crear Combo"; document.getElementById('btn-save-combo').innerText = "🍱 Guardar Combo"; document.getElementById('btn-cancel-combo').style.display = "none";
    if(document.getElementById('buscador-combos-admin')) document.getElementById('buscador-combos-admin').value = '';
}

async function eliminarItem(id, tipo) {
    if (!confirm(`¿Seguro que deseas eliminar este ${tipo}? Esta acción no se puede deshacer.`)) return;
    try {
        await fetch(ADMIN_URL_ELIMINAR, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
            body: JSON.stringify({ id: id, tipo: tipo })
        });
        cargarDatosAdmin();
    } catch(e) { alert('Error al intentar eliminar el elemento.'); }
}
