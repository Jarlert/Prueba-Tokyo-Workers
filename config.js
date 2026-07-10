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

// Arma el HTML del modal de detalle de pedido (usado en app.js y estadisticas.js)
// escapando todo dato que pueda venir de un cliente (nombre, dirección, notas, etc.)
// antes de inyectarlo en el DOM.
function construirHtmlModalPedido({ cliente, tel, operador, entrega, dir, arts, pago, ref, monto, tasaHistorica, imagenPago }) {
    const pagoLower = String(pago || '').toLowerCase();

    let seccionVES = '';
    if (pagoLower.includes('pago') || pagoLower.includes('movil')) {
        const totalBsFormateado = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(monto * tasaHistorica);
        seccionVES = `<div class="bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg mt-2 text-amber-300 text-xs text-center font-bold">Total en Bolívares: Bs. ${totalBsFormateado} (Tasa: ${tasaHistorica.toFixed(2)} Bs/$)</div>`;
    }

    const refHtml = ref ? `<p class="text-xs text-amber-400 mt-1 font-mono bg-slate-900 border border-slate-700 px-2 py-1 rounded inline-block">Ref: ${escapeHtml(ref)}</p>` : '';

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

    return `<div class="space-y-3.5"><div class="flex justify-between"><div><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Cliente</span><p class="font-bold text-white text-base">${escapeHtml(cliente)}</p><p class="text-xs text-slate-400 mt-0.5"><i class="fa-solid fa-phone"></i> ${escapeHtml(tel)}</p></div><div class="text-right"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider block">Comandado por</span><p class="text-xs text-white bg-slate-900 border border-slate-700 px-2 py-1 rounded mt-1 font-semibold">${escapeHtml(operador)}</p></div></div><div class="border-t border-slate-700/50 pt-2.5"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Método de Distribución</span><p class="text-white text-xs mt-0.5 font-medium">${escapeHtml(entrega)}</p><p class="text-xs text-slate-400 mt-1 bg-slate-900/40 p-2 rounded border border-slate-700/30 italic">${escapeHtml(dir)}</p></div><div class="border-t border-slate-700/50 pt-2.5"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Productos</span><div class="text-xs bg-slate-900/40 p-2.5 rounded border border-slate-700/30 whitespace-pre-line max-h-32 overflow-y-auto text-slate-300 font-mono">${escapeHtml(arts)}</div></div><div class="border-t border-slate-700/50 pt-2.5 flex justify-between items-center"><div><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Forma de Pago</span><p class="text-white text-xs font-semibold">${escapeHtml(pago)}</p>${refHtml}</div><div class="text-right"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Total</span><p class="text-emerald-400 font-bold text-lg">$${monto.toFixed(2)}</p></div></div>${seccionVES}${btnImg}</div>`;
}
