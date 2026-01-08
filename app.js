// ==========================================
// 1. CONFIGURACIÓN
// ==========================================
// ¡IMPORTANTE! Reemplaza esto con tus datos reales de Supabase
const supabaseUrl = 'https://gjrbzgfsezbkhmijpbez.supabase.co'; 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqcmJ6Z2ZzZXpia2htaWpwYmV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NTI3NDYsImV4cCI6MjA4MzMyODc0Nn0.lVVd_w6RyUIfg4dSp9Efhgaea4xbi0q1OwVeTV3wctw';

// CORRECCIÓN: Usamos 'sb' para evitar conflicto con la librería global
const sb = window.supabase.createClient(supabaseUrl, supabaseKey);

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
    
    const btnLogin = document.getElementById('btn-login');
    if(btnLogin) btnLogin.addEventListener('click', loginSupabase);

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
    
    if(errorMsg) errorMsg.style.display = 'none';

    const { data, error } = await sb.auth.signInWithPassword({
        email: email,
        password: password,
    });

    if (error) {
        if(errorMsg) {
            errorMsg.classList.remove('hidden');
            errorMsg.style.display = 'block';
            errorMsg.innerText = "Error: " + error.message;
        } else {
            alert("Error de credenciales");
        }
    } else {
        checkUserRole(data.user.id);
    }
}

async function checkUserRole(uid) {
    const { data: profile, error } = await sb.from('profiles').select('*').eq('id', uid).single();

    if(error || !profile) return console.error("Error perfil", error);

    // Ocultar login y mostrar layout (Validando que existan)
    const loginScreen = document.getElementById('login-screen');
    const mainLayout = document.getElementById('main-layout');
    if(loginScreen) loginScreen.classList.add('hidden');
    if(mainLayout) mainLayout.classList.remove('hidden');
    
    // --- AQUÍ ESTABA EL ERROR: Ahora validamos que los elementos existan ---
    const initDiv = document.getElementById('user-initial');
    const nameDiv = document.getElementById('header-username');
    
    // Solo intentamos escribir si el elemento existe en el HTML
    if(initDiv && profile.nombre) initDiv.innerText = profile.nombre.charAt(0).toUpperCase();
    if(nameDiv && profile.nombre) nameDiv.innerText = profile.nombre.split(' ')[0];

    if (profile.rol === 'admin' || profile.rol === 'coordinador') {
        currentRole = 'admin';
        const adminView = document.getElementById('admin-view');
        if(adminView) {
            adminView.classList.remove('hidden');
            cargarDatosCoordinacion();
        }
    } else {
        currentRole = 'tutor';
        currentUser = profile.nombre;
        const tutorView = document.getElementById('tutor-view');
        if(tutorView) tutorView.classList.remove('hidden');
        
        const welcomeMsg = document.getElementById('tutor-welcome');
        if(welcomeMsg) welcomeMsg.innerText = `Hola, ${profile.nombre.split(' ')[0]}!`;
        
        cargarVistaTutor(uid);
    }
}

async function logout() {
    await sb.auth.signOut();
    location.reload();
}

// ==========================================
// 4. LÓGICA TUTOR
// ==========================================
async function cargarVistaTutor(uid) {
    const container = document.getElementById('okr-container');
    if(!container) return; // Validación extra
    
    container.innerHTML = '<div class="loader">Cargando...</div>';

    const { data: objetivos } = await sb.from('objetivos').select('*').eq('tutor_id', uid);
    
    if(!objetivos || objetivos.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#95A5A6;">Sin objetivos aún.</p>';
        return;
    }

    const ids = objetivos.map(o => o.id);
    const { data: krs } = await sb.from('key_results').select('*').in('objetivo_id', ids);

    container.innerHTML = '';
    
    objetivos.forEach(obj => {
        const misKrs = krs.filter(k => k.objetivo_id === obj.id);
        const badgeClass = obj.tipo === 'administrativo' ? 'admin' : 'prod';
        const colorBorder = obj.tipo === 'administrativo' ? 'var(--primary)' : 'var(--accent)';
        
        const card = document.createElement('div');
        card.className = 'card okr-card';
        card.style.borderLeftColor = colorBorder;
        
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
                            onchange="actualizarKR(${kr.id}, this.value, ${obj.id}, '${uid}')">
                    </div>
                `).join('')}
            </div>
        `;
        container.appendChild(card);
    });

    calcularTotalesDinero(objetivos);
}

async function actualizarKR(krId, nuevoValor, objetivoId, userId) {
    await sb.from('key_results').update({ valor_actual: nuevoValor }).eq('id', krId);
    
    const { data: krs } = await sb.from('key_results').select('*').eq('objetivo_id', objetivoId);
    let suma = 0;
    krs.forEach(k => { suma += (k.valor_actual / k.meta_maxima) * 100; });
    const nuevoProgreso = Math.round(suma / krs.length);

    await sb.from('objetivos').update({ progreso_total: nuevoProgreso }).eq('id', objetivoId);
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

// GPS Logic
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
    const btn = document.querySelector('.btn-primary.full-width'); // Referencia segura
    
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
    
    if(btn) {
        btn.innerText = "📸 Check-in GPS y Guardar";
        btn.disabled = false;
    }
}

// ==========================================
// 5. LÓGICA ADMIN
// ==========================================
function openAdminModal() {
    const modal = document.getElementById('modal-admin');
    if(modal) {
        modal.classList.remove('hidden');
        cargarSelectTutores();
    }
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
    if(!select) return;
    
    select.innerHTML = '<option>Cargando...</option>';
    const { data } = await sb.from('profiles').select('*').eq('rol', 'tutor');
    select.innerHTML = '';
    
    if(data) {
        data.forEach(t => {
            let opt = document.createElement('option');
            opt.value = t.id; opt.innerText = t.nombre;
            select.appendChild(opt);
        });
    }
}

function agregarInputKR() {
    const container = document.getElementById('kr-inputs-container');
    const div = document.createElement('div');
    div.className = 'kr-row';
    div.innerHTML = `<input type="text" class="kr-desc" placeholder="Nuevo KR"><input type="number" class="kr-target" placeholder="Meta" style="width:70px">`;
    container.appendChild(div);
}

async function guardarOKRCompleto() {
    const tid = document.getElementById('admin-tutor-select').value;
    const tipo = document.getElementById('obj-type').value;
    const titulo = document.getElementById('obj-title').value;
    
    const krInputs = document.querySelectorAll('.kr-row');
    const krsData = [];
    krInputs.forEach(row => {
        const d = row.querySelector('.kr-desc').value;
        const t = row.querySelector('.kr-target').value;
        if(d && t) krsData.push({ descripcion: d, meta_maxima: t });
    });

    if(!tid || !titulo || krsData.length===0) return alert("Faltan datos");

    const { data: objData, error } = await sb.from('objetivos').insert([{ tutor_id: tid, titulo, tipo }]).select().single();
    
    if(error) return alert("Error: " + error.message);

    const krsConId = krsData.map(kr => ({ ...kr, objetivo_id: objData.id, valor_actual: 0 }));
    await sb.from('key_results').insert(krsConId);
    alert("Asignado"); closeModal();
}

async function cargarDatosCoordinacion() {
    const list = document.getElementById('lista-tutores');
    if(!list) return;
    list.innerHTML = 'Cargando...';
    
    const { data: tutores } = await sb.from('profiles').select('*').eq('rol', 'tutor');
    const { data: reportes } = await sb.from('bitacora_clase').select('*').gte('fecha', new Date().toISOString().split('T')[0]);

    list.innerHTML = '';
    let alertas = 0;
    let oks = 0;

    if(!tutores) return;

    tutores.forEach(t => {
        const rep = reportes.find(r => r.tutor_nombre === t.nombre);
        let status = '';
        if(rep) {
            if(rep.estado_gps.includes("VALIDADO")) { status = `<span class="status-dot dot-green"></span> OK`; oks++; }
            else { status = `<span class="status-dot dot-yellow"></span> GPS`; alertas++; }
        } else {
            status = `<span class="status-dot dot-red"></span> Pendiente`;
        }
        let li = document.createElement('li');
        li.className = 'tutor-row';
        li.innerHTML = `<span>${t.nombre}</span> <small>${status}</small>`;
        list.appendChild(li);
    });

    if(document.getElementById('total-tutors')) document.getElementById('total-tutors').innerText = tutores.length;
    if(document.getElementById('alert-count')) document.getElementById('alert-count').innerText = alertas;
    
    const perc = tutores.length > 0 ? Math.round((oks/tutores.length)*100) : 0;
    if(document.getElementById('global-okr')) document.getElementById('global-okr').innerText = `${perc}%`;
}

// ==========================================
// 6. UTILIDADES
// ==========================================
function checkConnection() {
    const badge = document.getElementById('connection-status');
    const syncArea = document.getElementById('sync-area');
    if(navigator.onLine) {
        if(badge) { badge.innerText = "Online"; badge.style.color = "var(--success)"; }
        if(offlineQueue.length > 0 && syncArea) syncArea.classList.remove('hidden');
    } else {
        if(badge) { badge.innerText = "Offline"; badge.style.color = "var(--danger)"; }
    }
}

function guardarLocal(data) {
    data.sincronizado = false;
    offlineQueue.push(data);
    localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
    alert("Guardado offline.");
    closeModal();
    updatePendingCount();
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
    updatePendingCount();
    document.getElementById('sync-area').classList.add('hidden');
    alert("Sincronizado");
}

function updatePendingCount() {
    const el = document.getElementById('pending-count');
    if(el) el.innerText = offlineQueue.length;
}

function openModal(id) { 
    const m = document.getElementById(`modal-${id}`);
    if(m) m.classList.remove('hidden'); 
}
function closeModal() { document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); }
function registerServiceWorker() { if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js'); }
