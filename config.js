// =====================================================================
// Tokio Sushi - utilidades compartidas por las 4 páginas del frontend
// =====================================================================

// Headers de autenticación para llamadas de staff logueado (index.html, admin.html, estadisticas.html)
function authHeaders() {
    const token = localStorage.getItem('tokioAuthToken');
    return token
        ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        : { 'Content-Type': 'application/json' };
}

function escapeHtml(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// =====================================================================
// Teléfonos: selector de país y normalización
// =====================================================================
// OJO: el teléfono es la CLAVE PRIMARIA de la tabla `clientes` y es lo que
// une cada pedido con su cliente, así que el formato guardado no se puede
// cambiar para los venezolanos ya registrados. Por eso:
//   - Venezuela  -> se sigue guardando en el formato legado 0XXXXXXXXXX
//   - resto      -> se guarda como +<código de país><número nacional>
// Ese '+' es justamente la señal que usa el backend
// (services/evolution_api.py) para saber que un número ya viene en formato
// internacional y NO anteponerle el 58 de Venezuela.

const PAISES_TELEFONO = [
    { dial: '58',  nombre: 'Venezuela',       bandera: '🇻🇪', ejemplo: '04121234567' },
    { dial: '1',   nombre: 'EE.UU. / Canadá', bandera: '🇺🇸', ejemplo: '3055551234' },
    { dial: '57',  nombre: 'Colombia',        bandera: '🇨🇴', ejemplo: '3001234567' },
    { dial: '34',  nombre: 'España',          bandera: '🇪🇸', ejemplo: '612345678' },
    { dial: '56',  nombre: 'Chile',           bandera: '🇨🇱', ejemplo: '912345678' },
    { dial: '51',  nombre: 'Perú',            bandera: '🇵🇪', ejemplo: '912345678' },
    { dial: '54',  nombre: 'Argentina',       bandera: '🇦🇷', ejemplo: '1123456789' },
    { dial: '55',  nombre: 'Brasil',          bandera: '🇧🇷', ejemplo: '11987654321' },
    { dial: '52',  nombre: 'México',          bandera: '🇲🇽', ejemplo: '5512345678' },
    { dial: '507', nombre: 'Panamá',          bandera: '🇵🇦', ejemplo: '61234567' },
    { dial: '593', nombre: 'Ecuador',         bandera: '🇪🇨', ejemplo: '991234567' },
    { dial: '598', nombre: 'Uruguay',         bandera: '🇺🇾', ejemplo: '91234567' },
    { dial: '39',  nombre: 'Italia',          bandera: '🇮🇹', ejemplo: '3123456789' },
    { dial: '351', nombre: 'Portugal',        bandera: '🇵🇹', ejemplo: '912345678' },
    { dial: '',    nombre: 'Otro país',       bandera: '🌎', ejemplo: '+49 30 1234567' },
];

// Convierte lo que el cliente escribió en el formato exacto que se guarda
// en la BD. Es idempotente: volver a pasarle su propia salida no la altera.
function normalizarTelefono(dial, valorCrudo) {
    let digitos = String(valorCrudo || '').replace(/\D/g, '');
    if (!digitos) return '';

    // "Otro país": el cliente escribe el código de país él mismo
    if (!dial) return '+' + digitos.replace(/^0+/, '');

    // Los ceros van PRIMERO: cubre tanto el troncal nacional (0412..., 07...)
    // como el prefijo internacional 00 (0034... debe quedar en 34..., no en
    // 3434... al volver a anteponerle el código más abajo).
    digitos = digitos.replace(/^0+/, '');
    if (!digitos) return '';

    // Si pegó el número con su código de país delante, lo quitamos para no
    // duplicarlo. El mínimo de 6 dígitos restantes evita comerse parte de un
    // número corto que casualmente empiece igual que su propio código.
    if (digitos.startsWith(dial) && digitos.length - dial.length >= 6) {
        digitos = digitos.slice(dial.length);
    }

    return dial === '58' ? '0' + digitos : '+' + dial + digitos;
}

// Deduce qué país corresponde a un número ya guardado, para preseleccionarlo
// al editarlo. Sin '+' delante solo puede ser el formato legado venezolano.
function detectarPaisDeTelefono(telefono) {
    const texto = String(telefono || '').trim();
    if (!texto.startsWith('+')) return '58';

    const digitos = texto.replace(/\D/g, '');
    const calces = PAISES_TELEFONO
        .filter(p => p.dial && digitos.startsWith(p.dial))
        .sort((a, b) => b.dial.length - a.dial.length); // +507 debe ganarle a +50

    return calces.length ? calces[0].dial : '';
}

// Llena un <select> de países y mantiene el placeholder del input en sintonía
// con el país elegido. Devuelve el <select> por comodidad.
function montarSelectorPais(idSelect, idInput, dialInicial) {
    const select = document.getElementById(idSelect);
    const input = document.getElementById(idInput);
    if (!select || !input) return null;

    select.innerHTML = PAISES_TELEFONO.map(p =>
        `<option value="${p.dial}">${p.bandera} ${escapeHtml(p.nombre)}${p.dial ? ' (+' + p.dial + ')' : ''}</option>`
    ).join('');

    const sincronizarPlaceholder = () => {
        const pais = PAISES_TELEFONO.find(p => p.dial === select.value) || PAISES_TELEFONO[0];
        input.placeholder = 'Ej. ' + pais.ejemplo;
    };

    select.value = dialInicial !== undefined && dialInicial !== null ? dialInicial : '58';
    select.onchange = sincronizarPlaceholder; // asignación, no addEventListener: se puede re-montar sin acumular listeners
    sincronizarPlaceholder();

    return select;
}

// Lee el par (selector de país + input) y devuelve el teléfono ya normalizado.
function leerTelefonoDeFormulario(idSelect, idInput) {
    const select = document.getElementById(idSelect);
    const input = document.getElementById(idInput);
    if (!input) return '';
    return normalizarTelefono(select ? select.value : '58', input.value);
}

// Arma el HTML del modal de detalle de pedido (usado en app.js y estadisticas.js)
// escapando todo dato que pueda venir de un cliente (nombre, dirección, notas, etc.)
// antes de inyectarlo en el DOM.
function construirHtmlModalPedido({ cliente, tel, cedula, operador, entrega, dir, arts, pago, ref, monto, tasaHistorica, imagenPago }) {
    const pagoLower = String(pago || '').toLowerCase();

    let seccionVES = '';
    if (pagoLower.includes('pago') || pagoLower.includes('movil')) {
        const totalBsFormateado = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(monto * tasaHistorica);
        seccionVES = `<div class="bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg mt-2 text-amber-300 text-xs text-center font-bold">Total en Bolívares: Bs. ${totalBsFormateado} (Tasa: ${tasaHistorica.toFixed(2)} Bs/$)</div>`;
    }

    const refHtml = ref ? `<p class="text-xs text-amber-400 mt-1 font-mono bg-slate-900 border border-slate-700 px-2 py-1 rounded inline-block">Ref: ${escapeHtml(ref)}</p>` : '';

    const cedulaHtml = cedula ? `<p class="text-xs text-slate-400 mt-0.5"><i class="fa-solid fa-id-card"></i> ${escapeHtml(cedula)}</p>` : '';

    let btnImg = '';
    const imagenSegura = String(imagenPago || '').trim();
    if (imagenSegura.startsWith('http')) {
        const imagenEscapada = escapeHtml(imagenSegura);
        btnImg = `
            <div class="mt-4 pt-4 border-t border-slate-700/50 flex flex-col items-center justify-center w-full">
                <span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-2">Comprobante Adjunto</span>
                <a href="${imagenEscapada}" target="_blank" class="block border border-slate-600 rounded-lg overflow-hidden hover:border-emerald-500 transition shadow-lg max-w-[220px] w-full">
                    <img src="${imagenEscapada}" class="w-full h-auto object-contain rounded-lg bg-slate-900" alt="Comprobante de Pago" onerror="this.style.display='none'">
                </a>
                <span class="text-[10px] text-slate-500 mt-1 italic"><i class="fa-solid fa-magnifying-glass-plus"></i> Clic en la imagen para ampliar</span>
            </div>
        `;
    }

    return `<div class="space-y-3.5"><div class="flex justify-between"><div><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Cliente</span><p class="font-bold text-white text-base">${escapeHtml(cliente)}</p><p class="text-xs text-slate-400 mt-0.5"><i class="fa-solid fa-phone"></i> ${escapeHtml(tel)}</p>${cedulaHtml}</div><div class="text-right"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider block">Comandado por</span><p class="text-xs text-white bg-slate-900 border border-slate-700 px-2 py-1 rounded mt-1 font-semibold">${escapeHtml(operador)}</p></div></div><div class="border-t border-slate-700/50 pt-2.5"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Método de Distribución</span><p class="text-white text-xs mt-0.5 font-medium">${escapeHtml(entrega)}</p><p class="text-xs text-slate-400 mt-1 bg-slate-900/40 p-2 rounded border border-slate-700/30 italic">${escapeHtml(dir)}</p></div><div class="border-t border-slate-700/50 pt-2.5"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Productos</span><div class="text-xs bg-slate-900/40 p-2.5 rounded border border-slate-700/30 whitespace-pre-line max-h-32 overflow-y-auto text-slate-300 font-mono">${escapeHtml(arts)}</div></div><div class="border-t border-slate-700/50 pt-2.5 flex justify-between items-center"><div><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Forma de Pago</span><p class="text-white text-xs font-semibold">${escapeHtml(pago)}</p>${refHtml}</div><div class="text-right"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Total</span><p class="text-emerald-400 font-bold text-lg">$${monto.toFixed(2)}</p></div></div>${seccionVES}${btnImg}</div>`;
}
