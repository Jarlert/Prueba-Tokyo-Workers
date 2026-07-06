// =================================================================
// --- LÓGICA EXCLUSIVA DEL PANEL DE ESTADÍSTICAS ---
// =================================================================

const API_ESTADISTICAS_PEDIDOS = "prueba-tokyo-workers-production.up.railway.app/api/pedidos/";
let datosEstadisticas = [];
let tasaEstadisticas = 1;
let graficoTorta = null;
let pedidosFiltradosActuales = []; 

let filtroActivo = 'hoy'; 

// 🟢 LÓGICA: Calculadora de IDs Diarios
function preprocesarIDsVisuales(pedidos) {
    const ordenados = [...pedidos].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const contadores = {};

    ordenados.forEach(p => {
        if (p.timestamp) {
            // Cortamos por la 'T' y también por el espacio ' ' para asegurar que solo quede la fecha
            const fecha = p.timestamp.split('T')[0].split(' ')[0]; 
            
            if (!contadores[fecha]) contadores[fecha] = 1;
            else contadores[fecha]++;
            
            p.id_visual = contadores[fecha];
        } else {
            p.id_visual = p.id_pedido || 'S/N';
        }
    });
}

async function iniciarPantallaEstadisticas() {
    if (!document.getElementById('graficoPagos')) return;

    tasaEstadisticas = parseFloat(localStorage.getItem('tasaBCV')) || 1;
    
    try {
        const res = await fetch(API_ESTADISTICAS_PEDIDOS + "?_t=" + new Date().getTime());
        const data = await res.json();
        datosEstadisticas = Array.isArray(data) ? data : [];
        
        preprocesarIDsVisuales(datosEstadisticas); 
        aplicarFiltroEstadisticas('hoy');
        arrancarPusherEstadisticas(); 
    } catch(e) {
        console.error("Error descargando pedidos para estadísticas:", e);
    }
}

function arrancarPusherEstadisticas() {
    if (typeof Pusher !== 'undefined') {
        const pusher = new Pusher('88089dcd4800848c78dd', {
            cluster: 'us2'
        });
        
        const channel = pusher.subscribe('canal-cocina');
        channel.bind('actualizar-tablero', async function(data) {
            try {
                const res = await fetch(API_ESTADISTICAS_PEDIDOS + "?_t=" + new Date().getTime());
                const freshData = await res.json();
                datosEstadisticas = Array.isArray(freshData) ? freshData : [];
                
                preprocesarIDsVisuales(datosEstadisticas); 
                aplicarFiltroEstadisticas(filtroActivo, true);
            } catch (error) {
                console.error("Error al actualizar estadísticas vía Pusher:", error);
            }
        });
    }
}

// -----------------------------------------------------------------
// CONTROLADORES DE LA INTERFAZ
// -----------------------------------------------------------------
function cambiarFiltroActivo(botonClickeado, rangoFiltro) {
    const botones = document.querySelectorAll('.btn-filtro');
    botones.forEach(btn => {
        btn.classList.remove('bg-indigo-600', 'text-white');
        btn.classList.add('text-slate-400', 'hover:bg-slate-800');
    });
    
    if (botonClickeado) {
        botonClickeado.classList.remove('text-slate-400', 'hover:bg-slate-800');
        botonClickeado.classList.add('bg-indigo-600', 'text-white');
    }
    
    if (rangoFiltro !== 'custom') document.getElementById('fechaCustom').value = '';
    
    aplicarFiltroEstadisticas(rangoFiltro);
}

function apagarBotonesFiltro() {
    const botones = document.querySelectorAll('.btn-filtro');
    botones.forEach(btn => {
        btn.classList.remove('bg-indigo-600', 'text-white');
        btn.classList.add('text-slate-400', 'hover:bg-slate-800');
    });
}

// -----------------------------------------------------------------
// LÓGICA DE FILTRADO DE DATOS
// -----------------------------------------------------------------
async function aplicarFiltroEstadisticas(tipo, esSilencioso = false) {
    if (!document.getElementById('graficoPagos')) return;

    filtroActivo = tipo;

    if (!esSilencioso) {
        try {
            const res = await fetch(API_ESTADISTICAS_PEDIDOS + "?_t=" + new Date().getTime());
            const data = await res.json();
            datosEstadisticas = Array.isArray(data) ? data : [];
            preprocesarIDsVisuales(datosEstadisticas);
        } catch(e) {
            console.error("Error al refrescar datos manualmente:", e);
        }
    }

    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    
    const pedidosFiltrados = datosEstadisticas.filter(p => {
        if (!p.timestamp) return false;
        const fechaPedido = new Date(p.timestamp);
        fechaPedido.setHours(0,0,0,0);

        if (tipo === 'hoy') return fechaPedido.getTime() === hoy.getTime();
        if (tipo === 'ayer') {
            const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
            return fechaPedido.getTime() === ayer.getTime();
        }
        if (tipo === 'semana') {
            const inicioSemana = new Date(hoy);
            inicioSemana.setDate(hoy.getDate() - hoy.getDay() + 1);
            return fechaPedido >= inicioSemana;
        }
        if (tipo === 'mes') {
            return fechaPedido.getMonth() === hoy.getMonth() && fechaPedido.getFullYear() === hoy.getFullYear();
        }
        if (tipo === 'custom') {
            const fechaSeleccionada = document.getElementById('fechaCustom').value;
            if (!fechaSeleccionada) return true;
            const partesFecha = fechaSeleccionada.split('-');
            const fCustom = new Date(partesFecha[0], partesFecha[1] - 1, partesFecha[2]);
            fCustom.setHours(0,0,0,0);
            return fechaPedido.getTime() === fCustom.getTime();
        }
        return true;
    });

    const finalizados = pedidosFiltrados.filter(p => String(p.estado || '').toLowerCase().replace(/\s+/g, '') === 'finalizado');
    pedidosFiltradosActuales = finalizados; 
    
    procesarCalculosEstadisticos(finalizados);
    renderHistorialFinalizadosEnStats(pedidosFiltrados);
}

function procesarCalculosEstadisticos(pedidos) {
    let totalUSD = 0;
    let totalBS = 0; 
    
    const conteoClientes = {};
    const conteoProductos = {};
    const pagos = { 'Zelle': 0, 'Pago Movil': 0, 'Efectivo': 0 };
    const nominaRepartidores = {};

    pedidos.forEach(p => {
        const monto = parseFloat(String(p.total_orden || 0).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
        const tasaHistorica = p.tasa_bcv ? parseFloat(p.tasa_bcv) : tasaEstadisticas;
        
        totalUSD += monto;
        totalBS += (monto * tasaHistorica); 
        
        let metodo = String(p.metodo_pago || 'Efectivo').toLowerCase();
        if (metodo.includes('zelle')) pagos['Zelle']++;
        else if (metodo.includes('pago') || metodo.includes('movil')) pagos['Pago Movil']++;
        else pagos['Efectivo']++;

        const cliente = p.cliente || 'Desconocido';
        if (!conteoClientes[cliente]) conteoClientes[cliente] = { gastado: 0, pedidos: 0 };
        conteoClientes[cliente].gastado += monto;
        conteoClientes[cliente].pedidos++;

        const detalle = p.pedido_detallado || '';
        const lineas = detalle.split('\n');
        lineas.forEach(linea => {
            const match = linea.trim().match(/^(\d+)[xX]\s+(.+?)(?:\s+\(\$.+\))?$/);
            if (match) {
                const cant = parseInt(match[1]);
                let nombreProd = match[2].trim();
                
                if (!nombreProd.toLowerCase().includes('servicio de delivery')) {
                    if (!conteoProductos[nombreProd]) conteoProductos[nombreProd] = 0;
                    conteoProductos[nombreProd] += cant;
                } else {
                    const repartidor = p.repartidor || p.Repartidor;
                    if (repartidor) {
                        if (!nominaRepartidores[repartidor]) nominaRepartidores[repartidor] = { viajes: 0, dineroAdeudado: 0 };
                        nominaRepartidores[repartidor].viajes++;
                        
                        const matchPrecio = linea.match(/\(\$([\d.]+)\)/);
                        if (matchPrecio && matchPrecio[1]) {
                            nominaRepartidores[repartidor].dineroAdeudado += parseFloat(matchPrecio[1]);
                        }
                    }
                }
            }
        });
    });

    dibujarWidgetsEstadisticas(pedidos.length, totalUSD, totalBS, pagos, conteoClientes, conteoProductos, nominaRepartidores);
}

function dibujarWidgetsEstadisticas(cantPedidos, totalUSD, totalBS, pagos, clientes, productos, repartidores) {
    const formatoUSD = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalUSD);
    const formatoBS = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalBS);

    document.getElementById('widgetTotalUSD').innerText = `$${formatoUSD}`;
    document.getElementById('widgetTotalBS').innerText = `Bs. ${formatoBS}`;
    document.getElementById('widgetCantPedidos').innerHTML = `<i class="fa-solid fa-receipt"></i> ${cantPedidos} pedidos finalizados`;

    if (graficoTorta) graficoTorta.destroy();
    const ctx = document.getElementById('graficoPagos').getContext('2d');
    graficoTorta = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Zelle', 'Pago Móvil', 'Efectivo'],
            datasets: [{
                data: [pagos['Zelle'], pagos['Pago Movil'], pagos['Efectivo']],
                backgroundColor: ['#6366f1', '#f59e0b', '#10b981'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: { plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 10 } } } }, maintainAspectRatio: false }
    });

    const arrayClientes = Object.keys(clientes).map(k => ({ nombre: k, ...clientes[k] })).sort((a, b) => b.gastado - a.gastado).slice(0, 5);
    document.getElementById('listaClientes').innerHTML = arrayClientes.length > 0 
        ? arrayClientes.map(c => `
            <div class="flex justify-between items-center bg-slate-800/50 p-2 rounded border border-slate-700/50">
                <span class="text-sm text-white font-medium">${c.nombre} <span class="text-[10px] text-slate-500 ml-1">(${c.pedidos} pedidos)</span></span>
                <span class="text-sm font-bold text-emerald-400">$${c.gastado.toFixed(2)}</span>
            </div>`).join('') 
        : '<p class="text-xs text-slate-500 italic">No hay datos en este rango</p>';

    const arrayProd = Object.keys(productos).map(k => ({ nombre: k, cant: productos[k] })).sort((a, b) => b.cant - a.cant).slice(0, 5);
    document.getElementById('listaProductos').innerHTML = arrayProd.length > 0 
        ? arrayProd.map(p => `
            <div class="flex justify-between items-center bg-slate-800/50 p-2 rounded border border-slate-700/50">
                <span class="text-sm text-white font-medium truncate pr-2">${p.nombre}</span>
                <span class="text-xs font-bold bg-slate-700 px-2 py-1 rounded text-orange-400">${p.cant} unid.</span>
            </div>`).join('')
        : '<p class="text-xs text-slate-500 italic">No hay datos en este rango</p>';

    const arrayRep = Object.keys(repartidores).map(k => ({ nombre: k, ...repartidores[k] })).sort((a, b) => b.viajes - a.viajes);
    document.getElementById('listaRepartidores').innerHTML = arrayRep.length > 0
        ? arrayRep.map(r => `
            <div onclick="abrirModalRepartidor('${r.nombre}', ${r.dineroAdeudado})" class="flex justify-between items-center bg-slate-800/50 p-3 rounded-lg border border-slate-700 cursor-pointer hover:border-sky-500 hover:bg-slate-800 transition">
                <div>
                    <p class="text-sm text-white font-bold">${r.nombre}</p>
                    <p class="text-[10px] text-slate-400 mt-0.5"><i class="fa-solid fa-route"></i> ${r.viajes} entregas realizadas</p>
                </div>
                <div class="text-right">
                    <span class="text-[10px] uppercase text-slate-500 font-bold block leading-none mb-1">Deuda a pagar</span>
                    <span class="text-lg font-bold text-sky-400 leading-none">$${r.dineroAdeudado.toFixed(2)}</span>
                </div>
            </div>`).join('')
        : '<p class="text-xs text-slate-500 italic">Nadie ha realizado entregas en este rango</p>';
}

function renderHistorialFinalizadosEnStats(pedidosList) {
    const contenedor = document.getElementById('historial-finalizados-container');
    if (!contenedor) return;

    const finalizados = pedidosList.filter(p => String(p.estado || '').toLowerCase().replace(/\s+/g, '') === 'finalizado');

    if (finalizados.length === 0) {
        contenedor.innerHTML = '<p class="text-slate-400 text-sm italic">No hay pedidos finalizados en el periodo seleccionado.</p>';
        return;
    }

    finalizados.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    contenedor.innerHTML = '';
    
    finalizados.forEach(pedido => {
        const idReal = pedido.id_pedido || pedido.ID || 'S/ID';
        const idVisual = pedido.id_visual || idReal; 
        const cliente = pedido.cliente || 'Desconocido';
        const monto = parseFloat(String(pedido.total_orden || pedido.monto || 0).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
        const metodo = pedido.metodo_pago || 'N/A';
        
        let fechaHora = '--:--';
        if (pedido.timestamp) {
            try {
                const d = new Date(pedido.timestamp);
                const fechaStr = d.toLocaleDateString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric' });
                const horaStr = d.toLocaleTimeString('en-US', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit' });
                fechaHora = `${fechaStr} • ${horaStr}`;
            } catch(e){}
        }

        let linkRecibo = '';
        if (pedido.imagen_pago && String(pedido.imagen_pago).trim() !== '' && String(pedido.imagen_pago) !== 'undefined') {
            linkRecibo = `<a href="${pedido.imagen_pago}" target="_blank" onclick="event.stopPropagation()" class="text-[11px] text-sky-400 font-semibold underline decoration-sky-600/50 underline-offset-2 hover:text-sky-300 transition mt-1 block"><i class="fa-regular fa-image"></i> Ver Recibo</a>`;
        }

        const esDelivery = String(pedido.tipo_entrega || '').toLowerCase().includes('delivery');
        const iconoMoto = esDelivery ? `<i class="fa-solid fa-motorcycle text-emerald-400 text-xs ml-2" title="Delivery"></i>` : '';

        contenedor.innerHTML += `
            <div onclick="abrirModalDetalle('${idReal}')" class="bg-slate-900 border border-slate-700 rounded-lg p-3 flex justify-between items-center transition hover:border-emerald-400 cursor-pointer">
                <div class="flex items-center gap-3">
                    <span class="bg-emerald-400/10 text-emerald-400 px-2 py-1 rounded text-xs font-bold border border-emerald-400/20">#${idVisual}</span>
                    <div>
                        <p class="text-slate-100 m-0 text-sm font-bold">${cliente} ${iconoMoto}</p>
                        <p class="text-slate-400 m-0 text-[11px] mt-0.5"><i class="fa-regular fa-calendar-days"></i> ${fechaHora} • Pago: ${metodo}</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-emerald-400 m-0 text-base font-bold">$${monto.toFixed(2)}</p>
                    ${linkRecibo}
                </div>
            </div>
        `;
    });
}

function abrirModalRepartidor(nombre, deudaTotal) {
    document.getElementById('modal-nombre-repartidor').innerText = nombre;
    document.getElementById('modal-total-repartidor').innerText = `$${deudaTotal.toFixed(2)}`;
    
    const listaContenedor = document.getElementById('modal-lista-pedidos');
    listaContenedor.innerHTML = '';

    const pedidosChofer = pedidosFiltradosActuales.filter(p => p.repartidor === nombre || p.Repartidor === nombre);

    if (pedidosChofer.length === 0) {
        listaContenedor.innerHTML = '<p class="text-center text-slate-500 my-8 italic">No se encontraron detalles de pedidos para este rango de fecha.</p>';
    } else {
        pedidosChofer.forEach(p => {
            const idReal = p.id_pedido || p.ID || 'S/ID';
            const idVisual = p.id_visual || idReal;
            const cliente = p.cliente || 'Desconocido';
            const detalleRaw = p.pedido_detallado || 'Sin detalles';
            
            const detalleHTML = detalleRaw
                .replace(/\n/g, '<br>')
                .replace(/Servicio de Delivery/g, '<span class="text-sky-400 font-bold">Servicio de Delivery</span>');

            let hora = '--:--';
            if (p.timestamp && p.timestamp.includes('T')) {
                hora = new Date(p.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            }

            listaContenedor.innerHTML += `
                <div class="mb-3 bg-slate-950 p-4 rounded-lg border border-slate-700">
                    <div class="flex justify-between items-center mb-3 border-b border-slate-800 pb-2">
                        <span class="text-xs font-bold bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded border border-emerald-500/20">Orden #${idVisual}</span>
                        <span class="text-xs text-slate-400"><i class="fa-regular fa-clock"></i> ${hora}</span>
                    </div>
                    <p class="text-sm font-bold text-white mb-2 flex items-center gap-2">
                        <i class="fa-solid fa-user text-slate-500"></i> ${cliente}
                    </p>
                    <div class="text-xs text-slate-300 font-mono bg-slate-900 p-2 rounded">
                        ${detalleHTML}
                    </div>
                </div>
            `;
        });
    }

    const modal = document.getElementById('modal-repartidor');
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        document.getElementById('modal-repartidor-content').classList.remove('scale-95');
    }, 10);
}

function cerrarModalRepartidor() {
    const modal = document.getElementById('modal-repartidor');
    modal.classList.add('opacity-0');
    document.getElementById('modal-repartidor-content').classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

function abrirModalDetalle(idPedido) {
    const pedido = pedidosFiltradosActuales.find(p => String(p.id_pedido || p.ID || 'S/ID') === String(idPedido)); 
    if (!pedido) return;
    
    const idReal = pedido.id_pedido || pedido.ID || 'S/ID'; 
    const idVisual = pedido.id_visual || idReal;
    const cliente = pedido.cliente || 'Registrado'; 
    const tel = pedido.telefono || 'No registrado';
    const entrega = pedido.tipo_entrega || 'No definido'; 
    const dir = pedido.direccion || 'No especificada';
    const pago = pedido.metodo_pago || 'No especificado'; 
    const arts = pedido.pedido_detallado || '';
    const img = pedido.imagen_pago || ''; 
    const ref = pedido.referencia_pago || '';
    const monto = parseFloat(String(pedido.total_orden || 0).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
    const operador = pedido.procesado_por || 'Sin registro';

    document.getElementById('modalID').innerText = `Pedido #${idVisual} (Ref DB: #${idReal})`;
    
    const tasaHistorica = pedido.tasa_bcv ? parseFloat(pedido.tasa_bcv) : tasaEstadisticas;

    let seccionVES = '';
    if (pago.toLowerCase().includes('pago') || pago.toLowerCase().includes('movil')) {
        const totalBsFormateado = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(monto * tasaHistorica);
        seccionVES = `<div class="bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg mt-2 text-amber-300 text-xs text-center font-bold">Total en Bolívares: Bs. ${totalBsFormateado} (Tasa: ${tasaHistorica.toFixed(2)} Bs/$)</div>`;
    }
    
    let refHtml = ref ? `<p class="text-xs text-amber-400 mt-1 font-mono bg-slate-900 border border-slate-700 px-2 py-1 rounded inline-block">Ref: ${ref}</p>` : '';
    
    let btnImg = '';
    if (img && String(img).trim() !== '' && String(img) !== 'undefined') {
        btnImg = `
            <div class="mt-4 pt-4 border-t border-slate-700/50 flex flex-col items-center justify-center w-full">
                <span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-2">Comprobante Adjunto</span>
                <a href="${img}" target="_blank" class="block border border-slate-600 rounded-lg overflow-hidden hover:border-emerald-500 transition shadow-lg max-w-[220px] w-full">
                    <img src="${img}" class="w-full h-auto object-contain rounded-lg bg-slate-900" alt="Comprobante de Pago">
                </a>
                <span class="text-[10px] text-slate-500 mt-1 italic"><i class="fa-solid fa-magnifying-glass-plus"></i> Clic en la imagen para ampliar</span>
            </div>
        `;
    }

    document.getElementById('modalCuerpo').innerHTML = `<div class="space-y-3.5"><div class="flex justify-between"><div><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Cliente</span><p class="font-bold text-white text-base">${cliente}</p><p class="text-xs text-slate-400 mt-0.5"><i class="fa-solid fa-phone"></i> ${tel}</p></div><div class="text-right"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider block">Comandado por</span><p class="text-xs text-white bg-slate-900 border border-slate-700 px-2 py-1 rounded mt-1 font-semibold">${operador}</p></div></div><div class="border-t border-slate-700/50 pt-2.5"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Método de Distribución</span><p class="text-white text-xs mt-0.5 font-medium">${entrega}</p><p class="text-xs text-slate-400 mt-1 bg-slate-900/40 p-2 rounded border border-slate-700/30 italic">${dir}</p></div><div class="border-t border-slate-700/50 pt-2.5"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Productos</span><div class="text-xs bg-slate-900/40 p-2.5 rounded border border-slate-700/30 whitespace-pre-line max-h-32 overflow-y-auto text-slate-300 font-mono">${arts}</div></div><div class="border-t border-slate-700/50 pt-2.5 flex justify-between items-center"><div><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Forma de Pago</span><p class="text-white text-xs font-semibold">${pago}</p>${refHtml}</div><div class="text-right"><span class="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Total</span><p class="text-emerald-400 font-bold text-lg">$${monto.toFixed(2)}</p></div></div>${seccionVES}${btnImg}</div>`;
    document.getElementById('modalDetalle').classList.remove('hidden');
}

function cerrarModalDetalle() { 
    document.getElementById('modalDetalle').classList.add('hidden'); 
}

// =================================================================
// 7. EXPORTACIÓN A EXCEL / GOOGLE SHEETS (CSV)
// =================================================================
function exportarCSV() {
    if (!pedidosFiltradosActuales || pedidosFiltradosActuales.length === 0) {
        alert("No hay datos para exportar en el rango de fechas seleccionado.");
        return;
    }

    let csvContent = "Nro. Diario;ID Base Datos;Fecha;Hora;Cliente;Telefono;Metodo de Pago;Referencia;Total USD;Total Bolivares;Tipo de Entrega;Motorizado;Detalle del Pedido\n";

    pedidosFiltradosActuales.forEach(p => {
        const idReal = p.id_pedido || p.ID || 'S/ID';
        const idVisual = p.id_visual || idReal;
        
        let fecha = '', hora = '';
        if (p.timestamp) {
            try {
                const d = new Date(p.timestamp);
                fecha = d.toLocaleDateString('es-VE');
                hora = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            } catch(e){}
        }

        const cliente = `"${(p.cliente || 'Desconocido').replace(/"/g, '""')}"`;
        const tel = p.telefono || 'N/A';
        const metodo = p.metodo_pago || 'N/A';
        const ref = p.referencia_pago || '';
        
        const totalUSD = parseFloat(p.total_orden || 0).toFixed(2);
        const tasa = p.tasa_bcv ? parseFloat(p.tasa_bcv) : tasaEstadisticas;
        const totalVES = (totalUSD * tasa).toFixed(2);
        
        const tipo = p.tipo_entrega || 'N/A';
        const repartidor = p.repartidor || 'N/A';
        
        const detalle = `"${(p.pedido_detallado || '').replace(/"/g, '""').replace(/\n/g, ' | ')}"`;

        const fila = [idVisual, idReal, fecha, hora, cliente, tel, metodo, ref, totalUSD, totalVES, tipo, repartidor, detalle];
        csvContent += fila.join(";") + "\n";
    });

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    link.setAttribute("href", url);
    link.setAttribute("download", `Reporte_TokioSushi_${filtroActivo}_${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// =================================================================
// EVENTOS AL CARGAR LA PÁGINA
// =================================================================
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('graficoPagos')) {
        iniciarPantallaEstadisticas();
    }
});