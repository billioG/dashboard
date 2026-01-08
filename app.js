// ==========================================
// 1. CONFIGURACIÓN
// ==========================================
// ¡IMPORTANTE! Reemplaza esto con tus datos reales de Supabase
const supabaseUrl = 'https://gjrbzgfsezbkhmijpbez.supabase.co'; 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqcmJ6Z2ZzZXpia2htaWpwYmV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NTI3NDYsImV4cCI6MjA4MzMyODc0Nn0.lVVd_w6RyUIfg4dSp9Efhgaea4xbi0q1OwVeTV3wctw';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// Configuración de Sedes (Latitud, Longitud) - Coordenadas de ejemplo en Guatemala
const sedesConfig = {
    "Sede Central": { lat: 14.634915, lon: -90.506882 }, 
    "Escuela Rural 1": { lat: 14.852300, lon: -91.503000 },
    "Guastatoya Oficial": { lat: 14.855000, lon: -90.070000 }
};
const RADIO_PERMITIDO = 300; // Metros de tolerancia

// Estado Local
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
    
    // Verificar si ya hay sesión iniciada
    const session = supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) checkUserRole(session.user.id);
    });
});

window.addEventListener('online', checkConnection);
window.addEventListener('offline', checkConnection);

// ==========================================
// 3. AUTENTICACIÓN Y ROLES
// ==========================================
async function loginSupabase() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('login-error');
    
    errorMsg.style.display = 'none';

    const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
    });

    if (error) {
        errorMsg.innerText = error.message;
        errorMsg.style.display = 'block';
    } else {
        checkUserRole(data.user.id);
    }
}

async function checkUserRole(uid) {
    // Busca el perfil para saber si es Tutor o Coordinador
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .single();

    if(error || !profile) {
        alert("Error cargando perfil. Contacta a soporte.");
        return;
    }

    document.getElementById('login-screen').classList.add('hidden');
    
    // Enrutamiento según Rol
    if (profile.rol === 'admin' || profile.rol === 'coordinador') {
        currentRole = 'admin';
        document.getElementById('admin-dashboard').classList.remove('hidden');
        cargarDatosCoordinacion();
    } else {
        currentRole = 'tutor';
        currentUser = profile.nombre;
        document.getElementById('tutor-dashboard').classList.remove('hidden');
        document.getElementById('tutor-welcome').innerText = `Hola, ${profile.nombre}`;
    }
}

async function logout() {
    await supabase.auth.signOut();
    location.reload();
}

// ==========================================
// 4. LÓGICA DE TUTOR (Reportes y GPS)
// ==========================================

// Cálculo de distancia (Fórmula Haversine)
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Lógica de Guardado Inteligente
async function intentarGuardarConGPS() {
    const btn = document.querySelector('.btn-save');
    const textoOriginal = btn.innerText;
    btn.innerText = "📍 Validando ubicación...";
    btn.disabled = true;

    // Obtener datos del formulario
    const sedeNombre = document.getElementById('sede-select').value;
    const asistencia = document.getElementById('asistencia').value;
    const notas = document.getElementById('notas-clase').value;
    
    // Validar campos
    if(!asistencia) {
        alert("Por favor ingresa la asistencia");
        btn.innerText = textoOriginal;
        btn.disabled = false;
        return;
    }

    // Intentar obtener GPS
    if (!navigator.geolocation) {
        finalizarGuardado(sedeNombre, asistencia, notas, 0, 0, "GPS_NO_SOPORTADO", 0);
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const latTutor = position.coords.latitude;
            const lonTutor = position.coords.longitude;
            const sedeReal = sedesConfig[sedeNombre];
            
            let estadoValidacion = "PENDIENTE";
            let distancia = 0;

            // Validar Geocerca
            if (sedeReal) {
                distancia = calcularDistancia(latTutor, lonTutor, sedeReal.lat, sedeReal.lon);
                if (distancia <= RADIO_PERMITIDO) {
                    estadoValidacion = "VALIDADO ✅";
                } else {
                    estadoValidacion = "FUERA DE RANGO ⚠️";
                    if(!confirm(`Estás a ${Math.round(distancia)}m de la sede. ¿Enviar de todos modos?`)) {
                        btn.innerText = textoOriginal;
                        btn.disabled = false;
                        return;
                    }
                }
            } else {
                estadoValidacion = "SEDE SIN CONFIG ❓";
            }

            finalizarGuardado(sedeNombre, asistencia, notas, latTutor, lonTutor, estadoValidacion, distancia);
        },
        (error) => {
            // Si falla GPS, permitimos guardar pero marcamos como alerta
            if(confirm("No pudimos obtener tu GPS. ¿Guardar de todos modos? (Se marcará revisión manual)")) {
                finalizarGuardado(sedeNombre, asistencia, notas, 0, 0, "ERROR_GPS", 0);
            }
            btn.innerText = textoOriginal;
            btn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function finalizarGuardado(sede, asistencia, notas, lat, lon, estadoGps, distancia) {
    const reporte = {
        tutor_id: (supabase.auth.getUser()).id, // Se llenará con el ID real
        tutor_nombre: currentUser,
        sede: sede,
        asistencia_porcentaje: asistencia,
        notas: notas,
        latitud: lat,
        longitud: lon,
        estado_gps: estadoGps,
        distancia_metros: Math.round(distancia),
        fecha: new Date().toISOString(),
        sincronizado: false
    };

    procesarEnvio(reporte);
}

async function procesarEnvio(reporte) {
    if (navigator.onLine) {
        // Obtener ID de usuario actual para la RLS
        const { data: { user } } = await supabase.auth.getUser();
        reporte.tutor_id = user.id;
        reporte.sincronizado = true;

        const { error } = await supabase.from('bitacora_clase').insert([reporte]);
        
        if (!error) {
            alert(`¡Reporte enviado! Estado: ${reporte.estado_gps}`);
            closeModal();
            document.getElementById('asistencia').value = '';
            document.getElementById('notas-clase').value = '';
        } else {
            console.error(error);
            alert("Error al subir. Guardando localmente.");
            guardarLocal(reporte);
        }
    } else {
        guardarLocal(reporte);
    }
    
    // Restaurar botón
    const btn = document.querySelector('.btn-save');
    btn.innerText = "📸 Check-in y Guardar";
    btn.disabled = false;
}

// ==========================================
// 5. LÓGICA DE COORDINADOR (Dashboard)
// ==========================================
async function cargarDatosCoordinacion() {
    const lista = document.getElementById('lista-tutores');
    lista.innerHTML = '<p style="text-align:center">Cargando...</p>';

    // 1. Obtener Tutores
    const { data: tutores } = await supabase.from('profiles').select('*').eq('rol', 'tutor');

    // 2. Obtener Reportes de HOY
    const hoy = new Date().toISOString().split('T')[0];
    const { data: reportes } = await supabase
        .from('bitacora_clase')
        .select('*')
        .gte('fecha', hoy);

    lista.innerHTML = '';
    let alertasHoy = 0;
    let reportesOk = 0;

    if(!tutores) return;

    tutores.forEach(tutor => {
        const reporte = reportes.find(r => r.tutor_nombre === tutor.nombre);
        const li = document.createElement('li');
        
        if (reporte) {
            if(reporte.estado_gps.includes("VALIDADO")) {
                li.className = 'tutor-row OK';
                li.innerHTML = `
                    <div><strong>${tutor.nombre}</strong><br><small>${reporte.sede}</small></div>
                    <span class="badge green">OK ✅</span>`;
                reportesOk++;
            } else {
                li.className = 'tutor-row ALERT';
                li.innerHTML = `
                    <div><strong>${tutor.nombre}</strong><br><small>${reporte.sede}</small></div>
                    <span class="badge yellow">GPS ${reporte.distancia_metros}m ⚠️</span>`;
                alertasHoy++;
            }
        } else {
            li.className = 'tutor-row ALERT';
            li.innerHTML = `
                <div><strong>${tutor.nombre}</strong><br><small>Sin actividad</small></div>
                <span class="badge red">Pendiente 🔴</span>`;
        }
        lista.appendChild(li);
    });

    // Actualizar KPIs visuales
    document.getElementById('alert-count').innerText = alertasHoy;
    const total = tutores.length;
    const porcentaje = total > 0 ? Math.round((reportesOk / total) * 100) : 0;
    document.getElementById('okr-progress').innerText = `${porcentaje}%`;
}

// ==========================================
// 6. UTILIDADES OFFLINE
// ==========================================
function checkConnection() {
    const status = document.getElementById('connection-status');
    const syncArea = document.getElementById('sync-area');
    
    if(navigator.onLine) {
        if(status) { status.innerText = "Online"; status.className = "status-online"; }
        if(offlineQueue.length > 0 && syncArea) syncArea.classList.remove('hidden');
    } else {
        if(status) { status.innerText = "Offline"; status.className = "status-offline"; }
    }
}

function guardarLocal(data) {
    data.sincronizado = false;
    offlineQueue.push(data);
    localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
    alert("Sin internet. Guardado en el teléfono. Sincroniza cuando tengas señal.");
    closeModal();
    updatePendingCount();
}

async function syncData() {
    if(offlineQueue.length === 0) return;
    
    const { data: { user } } = await supabase.auth.getUser();
    
    // Subir cola
    for (let item of offlineQueue) {
        item.tutor_id = user.id; // Asegurar ID
        item.sincronizado = true;
        await supabase.from('bitacora_clase').insert([item]);
    }

    offlineQueue = [];
    localStorage.setItem('offlineQueue', JSON.stringify([]));
    updatePendingCount();
    document.getElementById('sync-area').classList.add('hidden');
    alert("Sincronización completada");
}

function updatePendingCount() {
    const el = document.getElementById('pending-count');
    if(el) el.innerText = offlineQueue.length;
}

// Modales
function openModal(type) {
    if(type === 'clase') document.getElementById('modal-clase').classList.remove('hidden');
}
function closeModal() {
    document.querySelector('.modal:not(.hidden)').classList.add('hidden');
}

// Service Worker
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js');
    }
}
