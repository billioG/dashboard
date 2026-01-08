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
    
    // Botón Login
    const btnLogin = document.getElementById('btn-login');
    if(btnLogin) btnLogin.addEventListener('click', loginSupabase);

    // Verificar sesión
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
        errorMsg.style.display = 'block'; // Force show
        errorMsg.innerText = "Error: Verifica tu correo o contraseña";
    } else {
        checkUserRole(data.user.id);
    }
}

async function checkUserRole(uid) {
    const { data: profile, error } = await sb.from('profiles').select('*').eq('id', uid).single();

    if(error || !profile) return console.error(error);

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-layout').classList.remove('hidden'); // Mostrar Layout
    
    // Actualizar datos de sidebar
    document.getElementById('sidebar-username').innerText = profile.nombre;

    if (profile.rol === 'admin' || profile.rol === 'coordinador') {
        currentRole = 'admin';
        document.getElementById('admin-view').classList.remove('hidden');
        cargarDatosCoordinacion();
    } else {
        currentRole = 'tutor';
        currentUser = profile.nombre;
        document.getElementById('tutor-view').classList.remove('hidden');
        document.getElementById('tutor-welcome').innerText = `Hola, ${profile.nombre.split(' ')[0]}!`;
        calcularBonosReales(uid);
    }
}

async function logout() {
    await sb.auth.signOut();
    location.reload();
}

// ==========================================
// 4. LÓGICA TUTOR (Bonos y GPS)
// ==========================================
async function calcularBonosReales(userId) {
    const { data: okrs } = await sb.from('user_okrs').select('*').eq('tutor_id', userId);

    if (!okrs || okrs.length === 0) return;

    const adminOkrs = okrs.filter(o => o.tipo === 'administrativo');
    const prodOkrs = okrs.filter(o => o.tipo === 'productividad');

    const promAdmin = calcularPromedio(adminOkrs);
    const promProd = calcularPromedio(prodOkrs);
    
    // Promedio total para la barra lateral
    const totalGlobal = Math.round((promAdmin + promProd) / 2);

    // Actualizar UI - Tarjetas
    updateBar('bar-admin', 'perc-admin', promAdmin);
    updateBar('bar-prod', 'perc-prod', promProd);
    
    // Actualizar Sidebar
    document.getElementById('global-progress').style.width = `${totalGlobal}%`;
    document.getElementById('global-perc').innerText = `${totalGlobal}/100%`;
}

function updateBar(barId, textId, value) {
    const bar = document.getElementById(barId);
    const text = document.getElementById(textId);
    if(bar) bar.style.width = `${value}%`;
    if(text) text.innerText = `${value}%`;
}

function calcularPromedio(lista) {
    if (lista.length === 0) return 0;
    const suma = lista.reduce((acc, curr) => acc + curr.progreso_actual, 0);
    return Math.round(suma / lista.length);
}

// GPS y Guardado
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
    const btn = document.querySelector('.btn-primary.full-width'); // Botón del modal
    const txtOriginal = btn.innerText;
    btn.innerText = "Buscando ubicación...";
    btn.disabled = true;

    const sedeNombre = document.getElementById('sede-select').value;
    const asistencia = document.getElementById('asistencia').value;
    const notas = document.getElementById('notas-clase').value;
    
    if(!asistencia) {
        alert("Falta asistencia");
        btn.innerText = txtOriginal;
        btn.disabled = false;
        return;
    }

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
        
        if (navigator.onLine) {
            reporte.sincronizado = true;
            sb.from('bitacora_clase').insert([reporte]).then(({ error }) => {
                if (!error) {
                    alert("¡Misión Cumplida! Reporte enviado.");
                    closeModal();
                } else {
                    guardarLocal(reporte);
                }
            });
        } else {
            guardarLocal(reporte);
        }
        
        // Reset UI
        document.querySelector('.btn-primary.full-width').innerText = "CONFIRMAR MISIÓN";
        document.querySelector('.btn-primary.full-width').disabled = false;
    });
}

// ==========================================
// 5. ADMIN
// ==========================================
function openAdminModal() {
    document.getElementById('modal-admin').classList.remove('hidden');
    cargarSelectTutores();
}

async function crearColaborador() {
    // Misma lógica anterior...
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

async function guardarOKR() {
    // Misma lógica anterior...
    const tid = document.getElementById('admin-tutor-select').value;
    const type = document.getElementById('okr-type').value;
    const desc = document.getElementById('okr-desc').value;
    const prog = document.getElementById('okr-progress').value;

    await sb.from('user_okrs').insert([{ tutor_id: tid, tipo: type, descripcion: desc, progreso_actual: prog }]);
    alert("OKR Guardado");
    cargarOkrsTutor();
}

async function cargarOkrsTutor() {
    const tid = document.getElementById('admin-tutor-select').value;
    const list = document.getElementById('current-okrs-list');
    list.innerHTML = '...';
    const { data } = await sb.from('user_okrs').select('*').eq('tutor_id', tid);
    list.innerHTML = '';
    data.forEach(o => {
        let li = document.createElement('li');
        li.innerText = `${o.descripcion}: ${o.progreso_actual}%`;
        list.appendChild(li);
    });
}

async function cargarDatosCoordinacion() {
    const list = document.getElementById('lista-tutores');
    list.innerHTML = 'Cargando...';
    
    const { data: tutores } = await sb.from('profiles').select('*').eq('rol', 'tutor');
    const { data: reportes } = await sb.from('bitacora_clase').select('*').gte('fecha', new Date().toISOString().split('T')[0]);

    list.innerHTML = '';
    let alertas = 0;
    let oks = 0;

    tutores.forEach(t => {
        const rep = reportes.find(r => r.tutor_nombre === t.nombre);
        let statusHtml = '';
        
        if(rep) {
            if(rep.estado_gps.includes("VALIDADO")) {
                statusHtml = `<span style="color:var(--success); font-weight:bold;">Reporte OK</span>`;
                oks++;
            } else {
                statusHtml = `<span style="color:var(--warning); font-weight:bold;">Alerta GPS</span>`;
                alertas++;
            }
        } else {
            statusHtml = `<span style="color:var(--danger); font-weight:bold;">Sin Reporte</span>`;
            alertas++;
        }

        let li = document.createElement('li');
        li.innerHTML = `<span>${t.nombre}</span> ${statusHtml}`;
        list.appendChild(li);
    });

    document.getElementById('alert-count').innerText = alertas;
    const perc = tutores.length > 0 ? Math.round((oks/tutores.length)*100) : 0;
    document.getElementById('okr-progress').innerText = `${perc}%`;
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
