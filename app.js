// ==========================================
// 1. CONFIGURACIÓN
// ==========================================
// ¡IMPORTANTE! Reemplaza esto con tus datos reales de Supabase
const supabaseUrl = 'https://gjrbzgfsezbkhmijpbez.supabase.co'; 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqcmJ6Z2ZzZXpia2htaWpwYmV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NTI3NDYsImV4cCI6MjA4MzMyODc0Nn0.lVVd_w6RyUIfg4dSp9Efhgaea4xbi0q1OwVeTV3wctw';

// CORRECCIÓN: Usamos 'sb' para evitar conflicto con la librería global
const sb = window.supabase.createClient(supabaseUrl, supabaseKey);

// Coordenadas de Ejemplo (Ajustar con las reales de Google Maps)
const sedesConfig = {
    "Sede Central": { lat: 14.634915, lon: -90.506882 }, 
    "Escuela Rural 1": { lat: 14.852300, lon: -91.503000 },
    "Guastatoya Oficial": { lat: 14.855000, lon: -90.070000 }
};
const RADIO_PERMITIDO = 300; 

let currentUser = null;
let currentRole = null;
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue')) || [];

// ==========================================
// 2. INICIALIZACIÓN
// ==========================================
window.addEventListener('load', () => {
    registerServiceWorker();
    checkConnection();
    updatePendingCount();
    
    // Login
    const btnLogin = document.getElementById('btn-login');
    if(btnLogin) btnLogin.addEventListener('click', loginSupabase);

    // Sesión Activa
    sb.auth.getSession().then(({ data: { session } }) => {
        if (session) checkUserRole(session.user.id);
    });
});

window.addEventListener('online', checkConnection);
window.addEventListener('offline', checkConnection);

// ==========================================
// 3. AUTH & ROLES
// ==========================================
async function loginSupabase() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('login-error');
    
    errorMsg.style.display = 'none';

    const { data, error } = await sb.auth.signInWithPassword({
        email: email,
        password: password,
    });

    if (error) {
        errorMsg.classList.remove('hidden');
        errorMsg.style.display = 'block';
        errorMsg.innerText = "Error de credenciales";
    } else {
        checkUserRole(data.user.id);
    }
}

async function checkUserRole(uid) {
    const { data: profile, error } = await sb.from('profiles').select('*').eq('id', uid).single();

    if(error || !profile) return console.error("Sin perfil");

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-layout').classList.remove('hidden');
    
    document.getElementById('user-initial').innerText = profile.nombre.charAt(0);
    document.getElementById('header-username').innerText = profile.nombre.split(' ')[0];

    if (profile.rol === 'admin' || profile.rol === 'coordinador') {
        currentRole = 'admin';
        document.getElementById('admin-view').classList.remove('hidden');
        cargarDatosCoordinacion();
    } else {
        currentRole = 'tutor';
        currentUser = profile.nombre;
        document.getElementById('tutor-view').classList.remove('hidden');
        cargarVistaTutor(uid); // Nueva función V4
    }
}

async function logout() {
    await sb.auth.signOut();
    location.reload();
}

// ==========================================
// 4. LÓGICA TUTOR (OKRs + GPS)
// ==========================================

// A. Cargar y Renderizar OKRs
async function cargarVistaTutor(uid) {
    const container = document.getElementById('okr-container');
    container.innerHTML = '<div class="loader">Cargando objetivos...</div>';

    // Traer Padre
    const { data: objetivos } = await sb.from('objetivos').select('*').eq('tutor_id', uid);
    
    if(!objetivos || objetivos.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#95A5A6;">No tienes objetivos asignados este mes.</p>';
        return;
    }

    // Traer Hijos
    const ids = objetivos.map(o => o.id);
    const { data: krs } = await sb.from('key_results').select('*').in('objetivo_id', ids);

    container.innerHTML = '';
    
    objetivos.forEach(obj => {
        const misKrs = krs.filter(k => k.objetivo_id === obj.id);
        const badgeClass = obj.tipo === 'administrativo' ? 'admin' : 'prod';
        
        const card = document.createElement('div');
        card.className = 'card okr-card';
        card.style.borderLeftColor = obj.tipo === 'administrativo' ? 'var(--primary)' : 'var(--accent)';
        
        card.innerHTML = `
            <div class="okr-header">
                <h4>${obj.titulo}</h4>
                <span class="okr-badge ${badgeClass}">${obj.progreso_total}%</span>
            </div>
            <div class="kr-list">
                ${misKrs.map(kr => `
                    <div class="kr-item">
                        <div class="kr-info">
                            <span>${kr.descripcion}</span>
                            <small>${kr.valor_actual} / ${kr.meta_maxima}</small>
                        </div>
                        <input type="range" min="0" max="${kr.meta_maxima}" value="${kr.valor_actual}" 
                            onchange="actualizarKR(${kr.id}, this.value, ${obj.id}, ${uid})">
                    </div>
                `).join('')}
            </div>
        `;
        container.appendChild(card);
    });

    calcularTotalesDinero(objetivos);
}

async function actualizarKR(krId, nuevoValor, objetivoId, userId) {
    // 1. Actualizar KR
    await sb.from('key_results').update({ valor_actual: nuevoValor }).eq('id', krId);

    // 2. Recalcular Padre
    const { data: krs } = await sb.from('key_results').select('*').eq('objetivo_id', objetivoId);
    
    let sumaPorcentajes = 0;
    krs.forEach(k => {
        sumaPorcentajes += (k.valor_actual / k.meta_maxima) * 100;
    });
    const nuevoProgreso = Math.round(sumaPorcentajes / krs.length);

    // 3. Actualizar Padre en BD
    await sb.from('objetivos').update({ progreso_total: nuevoProgreso }).eq('id', objetivoId);

    // 4. Refrescar Vista
    cargarVistaTutor(userId);
}

function calcularTotalesDinero(objetivos) {
    const adminObjs = objetivos.filter(o => o.tipo === 'administrativo');
    const prodObjs = objetivos.filter(o => o.tipo === 'productividad');

    const promAdmin = getPromedio(adminObjs);
    const promProd = getPromedio(prodObjs);

    updateBar('bar-admin', 'perc-admin', promAdmin);
    updateBar('bar-prod', 'perc-prod', promProd);
}

function getPromedio(arr) {
    if(!arr.length) return 0;
    return Math.round(arr.reduce((acc, curr) => acc + curr.progreso_total, 0) / arr.length);
}

function updateBar(barId, textId, value) {
    const bar = document.getElementById(barId);
    const text = document.getElementById(textId);
    if(bar) bar.style.width = `${value}%`;
    if(text) text.innerText = `${value}%`;
}

// B. GPS Logic (Igual que V3)
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

async function intentarGuardarConGPS() {
    const btn = document.querySelector('.btn-primary.full-width'); 
    const txtOriginal = btn.innerText;
    btn.innerText = "Buscando satélites...";
    btn.disabled = true;

    const sedeNombre = document.getElementById('sede-select').value;
    const asistencia = document.getElementById('asistencia').value;
    const notas = document.getElementById('notas-clase').value;
    
    if(!asistencia) { alert("Falta asistencia"); btn.innerText = txtOriginal; btn.disabled = false; return; }

    if (!navigator.geolocation) {
        finalizarGuardado(sedeNombre, asistencia, notas, 0, 0, "GPS_NO_SOPORTADO", 0);
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            const sedeReal = sedesConfig[sedeNombre];
            let estado = "PENDIENTE";
            let dist = 0;

            if (sedeReal) {
                dist = calcularDistancia(lat, lon, sedeReal.lat, sedeReal.lon);
                if (dist <= RADIO_PERMITIDO) estado = "VALIDADO ✅";
                else {
                    estado = "FUERA DE RANGO ⚠️";
                    if(!confirm(`Estás a ${Math.round(dist)}m de la sede. ¿Enviar?`)) {
                        btn.innerText = txtOriginal; btn.disabled = false; return;
                    }
                }
            } else estado = "SEDE SIN CONFIG ❓";

            finalizarGuardado(sedeNombre, asistencia, notas, lat, lon, estado, dist);
        },
        (error) => {
            if(confirm("Error GPS. ¿Guardar sin ubicación?")) finalizarGuardado(sedeNombre, asistencia, notas, 0, 0, "ERROR_GPS", 0);
            btn.innerText = txtOriginal; btn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function finalizarGuardado(sede, asistencia, notas, lat, lon, estado, dist) {
    sb.auth.getUser().then(({ data: { user } }) => {
        const reporte = {
            tutor_id: user ? user.id : null,
            tutor_nombre: currentUser,
            sede: sede,
            asistencia_porcentaje: asistencia,
            notas: notas,
            latitud: lat,
            longitud: lon,
            estado_gps: estado,
            distancia_metros: Math.round(dist),
            fecha: new Date().toISOString(),
            sincronizado: false
        };
        procesarEnvio(reporte);
    });
}

async function procesarEnvio(reporte) {
    if (navigator.onLine) {
        reporte.sincronizado = true;
        const { error } = await sb.from('bitacora_clase').insert([reporte]);
        if (!error) {
            alert("¡Misión Cumplida!");
            closeModal();
        } else {
            guardarLocal(reporte);
        }
    } else {
        guardarLocal(reporte);
    }
    const btn = document.querySelector('.btn-primary.full-width');
    btn.innerText = "Check-in y Guardar";
    btn.disabled = false;
}

// ==========================================
// 5. LÓGICA ADMIN (CRUD & OKRs)
// ==========================================
function openAdminModal() {
    document.getElementById('modal-admin').classList.remove('hidden');
    cargarSelectTutores();
}

async function crearColaborador() {
    const email = document.getElementById('new-email').value;
    const pass = document.getElementById('new-pass').value;
    const name = document.getElementById('new-name').value;
    
    const { error } = await sb.auth.signUp({ email, password: pass, options: { data: { nombre: name } } });
    if(error) alert(error.message);
    else { alert("Usuario creado"); cargarSelectTutores(); }
}

async function cargarSelectTutores() {
    const select = document.getElementById('admin-tutor-select');
    select.innerHTML = '<option>Cargando...</option>';
    const { data } = await sb.from('profiles').select('*').eq('rol', 'tutor');
    select.innerHTML = '';
    data.forEach(t => {
        let opt = document.createElement('option');
        opt.value = t.id; opt.innerText = t.nombre;
        select.appendChild(opt);
    });
}

function agregarInputKR() {
    const container = document.getElementById('kr-inputs-container');
    const div = document.createElement('div');
    div.className = 'kr-row';
    div.innerHTML = `
        <input type="text" class="kr-desc" placeholder="Nuevo Resultado Clave">
        <input type="number" class="kr-target" placeholder="Meta" style="width:70px">
    `;
    container.appendChild(div);
}

async function guardarOKRCompleto() {
    const tutorId = document.getElementById('admin-tutor-select').value;
    const tipo = document.getElementById('obj-type').value;
    const titulo = document.getElementById('obj-title').value;
    
    // Validar Inputs
    const krInputs = document.querySelectorAll('.kr-row');
    const krsData = [];
    krInputs.forEach(row => {
        const desc = row.querySelector('.kr-desc').value;
        const target = row.querySelector('.kr-target').value;
        if(desc && target) krsData.push({ descripcion: desc, meta_maxima: target });
    });

    if(!tutorId || !titulo || krsData.length === 0) return alert("Faltan datos");

    // 1. Guardar Padre
    const { data: objData, error: objError } = await sb
        .from('objetivos')
        .insert([{ tutor_id: tutorId, titulo: titulo, tipo: tipo }])
        .select()
        .single();

    if(objError) return alert("Error al guardar Objetivo");

    // 2. Guardar Hijos
    const krsConId = krsData.map(kr => ({ ...kr, objetivo_id: objData.id, valor_actual: 0 }));
    const { error: krError } = await sb.from('key_results').insert(krsConId);

    if(!krError) {
        alert("OKR Asignado con éxito");
        closeModal();
    }
}

async function cargarDatosCoordinacion() {
    const list = document.getElementById('lista-tutores');
    list.innerHTML = 'Cargando...';
    
    const { data: tutores } = await sb.from('profiles').select('*').eq('rol', 'tutor');
    const { data: reportes } = await sb.from('bitacora_clase').select('*').gte('fecha', new Date().toISOString().split('T')[0]);

    list.innerHTML = '';
    let alertas = 0;

    if(!tutores) return;

    tutores.forEach(t => {
        const rep = reportes.find(r => r.tutor_nombre === t.nombre);
        let status = '';
        
        if(rep) {
            if(rep.estado_gps.includes("VALIDADO")) status = `<span class="status-dot dot-green"></span> OK`;
            else { status = `<span class="status-dot dot-yellow"></span> GPS`; alertas++; }
        } else {
            status = `<span class="status-dot dot-red"></span> Pendiente`;
        }

        let li = document.createElement('li');
        li.className = 'tutor-row';
        li.innerHTML = `<span>${t.nombre}</span> <small>${status}</small>`;
        list.appendChild(li);
    });

    document.getElementById('total-tutors').innerText = tutores.length;
    document.getElementById('alert-count').innerText = alertas;
}

// ==========================================
// 6. UTILIDADES
// ==========================================
function checkConnection() {
    const badge = document.getElementById('connection-status');
    if(navigator.onLine) {
        if(badge) { badge.innerText = "Online"; badge.style.color = "var(--success)"; }
        if(offlineQueue.length > 0) syncData();
    } else {
        if(badge) { badge.innerText = "Offline"; badge.style.color = "var(--danger)"; }
    }
}

function guardarLocal(data) {
    data.sincronizado = false;
    offlineQueue.push(data);
    localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
    alert("Sin conexión. Guardado en dispositivo.");
    closeModal();
}

async function syncData() {
    const { data: { user } } = await sb.auth.getUser();
    for(let item of offlineQueue) {
        item.tutor_id = user.id;
        item.sincronizado = true;
        await sb.from('bitacora_clase').insert([item]);
    }
    offlineQueue = [];
    localStorage.setItem('offlineQueue', JSON.stringify([]));
    alert("Sincronización completada.");
}

function openModal(id) { document.getElementById(`modal-${id}`).classList.remove('hidden'); }
function closeModal() { document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); }
function registerServiceWorker() { if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js'); }
