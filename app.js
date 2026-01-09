// ==========================================
// 1. CONFIGURACIÓN
// ==========================================
// ¡IMPORTANTE! Reemplaza esto con tus datos reales de Supabase
const supabaseUrl = 'https://gjrbzgfsezbkhmijpbez.supabase.co'; 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqcmJ6Z2ZzZXpia2htaWpwYmV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NTI3NDYsImV4cCI6MjA4MzMyODc0Nn0.lVVd_w6RyUIfg4dSp9Efhgaea4xbi0q1OwVeTV3wctw';

// CORRECCIÓN: Usamos 'sb' para evitar conflicto con la librería global
const sb = window.supabase.createClient(supabaseUrl, supabaseKey);

// Configuración de Reglas
const DEADLINE_DIA = 25; // Día del mes límite
const DEADLINE_HORA = 23; // 23 horas
const DEADLINE_MIN = 59; // 59 minutos
const RADIO_GPS = 200; // Metros

// Coordenadas Sede (Ejemplo)
const SEDE_GPS = { lat: 14.634915, lon: -90.506882 }; 

let currentUser = null;
let currentRole = null;
let fraudCounter = 0; // Contador de subidas rápidas (Anti-fraude)

// ==========================================
// 1. INICIALIZACIÓN
// ==========================================
window.addEventListener('load', () => {
    // Escuchar botón login
    const btn = document.getElementById('btn-login');
    if(btn) btn.addEventListener('click', login);
    
    // Iniciar Rastreo GPS automático (El Árbitro vigila)
    iniciarRastreoGPS();
});

async function login() {
    // Simulación de Auth para demo (Integrar tu lógica Supabase aquí)
    const email = document.getElementById('email').value;
    if(email.includes('admin')) checkUserRole('admin', 'Johanna');
    else checkUserRole('tutor', 'Anahí');
}

function checkUserRole(role, name) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-layout').classList.remove('hidden');
    
    document.getElementById('header-username').innerText = name;
    document.getElementById('user-initial').innerText = name.charAt(0);

    if (role === 'admin') {
        document.getElementById('admin-view').classList.remove('hidden');
        cargarPanelArbitro();
    } else {
        document.getElementById('tutor-view').classList.remove('hidden');
        if(document.getElementById('tutor-welcome')) 
            document.getElementById('tutor-welcome').innerText = `Hola, ${name}!`;
    }
}

// ==========================================
// 2. REGLA 1: GPS "LLAVE MAESTRA"
// ==========================================
function iniciarRastreoGPS() {
    if (!navigator.geolocation) return;

    const indicador = document.getElementById('gps-indicator');
    const btnAsistencia = document.getElementById('btn-asistencia');

    navigator.geolocation.watchPosition((pos) => {
        const dist = calcularDistancia(pos.coords.latitude, pos.coords.longitude, SEDE_GPS.lat, SEDE_GPS.lon);
        
        if (dist <= RADIO_GPS) {
            // DENTRO DE LA ESCUELA -> DESBLOQUEAR
            if(indicador) {
                indicador.innerText = "En Sede ✅";
                indicador.style.color = "var(--success)";
            }
            if(btnAsistencia) {
                btnAsistencia.disabled = false;
                btnAsistencia.classList.remove('disabled');
                btnAsistencia.querySelector('span').innerText = "check_circle"; // Cambia icono
                btnAsistencia.querySelector('span:last-child').innerText = "Tomar Asistencia";
            }
        } else {
            // FUERA -> BLOQUEAR
            if(indicador) {
                indicador.innerText = "Fuera de Rango ⚠️";
                indicador.style.color = "var(--danger)";
            }
            if(btnAsistencia) {
                btnAsistencia.disabled = true;
                btnAsistencia.classList.add('disabled');
            }
        }
    }, (err) => console.error(err), { enableHighAccuracy: true });
}

function tomarAsistencia() {
    // Solo funciona si el botón está habilitado por GPS
    alert("✅ Asistencia Validada por GPS. Geolocalización guardada.");
    // Aquí iría el insert a Supabase con lat/lon
}

// ==========================================
// 3. REGLA 2: JUEZ DE TIEMPO (Timestamp)
// ==========================================
function enviarInformeConReglas() {
    const ahora = new Date();
    const dia = ahora.getDate();
    const hora = ahora.getHours();
    
    // Regla Estricta
    let estado = "A TIEMPO ✅";
    
    if (dia > DEADLINE_DIA || (dia === DEADLINE_DIA && hora > DEADLINE_HORA)) {
        estado = "TARDÍO ❌ (Penalizado)";
        if(!confirm(`⚠️ ADVERTENCIA: Estás enviando fuera de fecha límite. Esto afectará tu bono Administrativo. ¿Continuar?`)) {
            return;
        }
    }

    // Simular envío
    alert(`Informe enviado. Estado: ${estado}`);
    closeModal();
    // Actualizar UI
    document.getElementById('kpi-tiempo').innerText = estado.includes("TARDÍO") ? "0%" : "100%";
    document.getElementById('kpi-tiempo').style.color = estado.includes("TARDÍO") ? "var(--danger)" : "var(--success)";
}

// ==========================================
// 4. REGLA 3: MONITOR DE ESTUDIANTES (Productividad)
// ==========================================
function verMonitorClase() {
    openModal('monitor');
    const lista = document.getElementById('lista-alumnos');
    lista.innerHTML = '';
    
    // Simulación de datos en tiempo real
    const alumnos = [
        {nombre: "Juan P.", estado: "Subido ✅"},
        {nombre: "Maria L.", estado: "Pendiente ⏳"},
        {nombre: "Carlos R.", estado: "Subido ✅"},
        {nombre: "Ana S.", estado: "Pendiente ⏳"}
    ];

    let subidos = 0;
    alumnos.forEach(a => {
        if(a.estado.includes("Subido")) subidos++;
        const li = document.createElement('li');
        li.className = 'tutor-row';
        li.innerHTML = `<span>${a.nombre}</span> <small>${a.estado}</small>`;
        lista.appendChild(li);
    });

    document.getElementById('live-uploads').innerText = subidos;
}

// ==========================================
// 5. ANTI-FRAUDE & ADMIN
// ==========================================
function abrirModoEstudiante() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('student-view').classList.remove('hidden');
}

function simularSubidaEstudiante() {
    // Simular detección de IP/Dispositivo
    fraudCounter++;
    
    // Si suben más de 2 tareas en 10 segundos desde el mismo dispositivo -> ALERTA
    if(fraudCounter >= 2) {
        console.warn("ALERTA DE FRAUDE: Múltiples cargas desde misma IP");
        // En producción, esto envía un flag a la tabla de 'alertas' en Supabase
    }

    alert("Tarea subida con éxito");
    // Resetear contador después de un tiempo (simulado)
    setTimeout(() => fraudCounter = 0, 10000);
}

function cargarPanelArbitro() {
    const lista = document.getElementById('lista-tutores');
    lista.innerHTML = `
        <li class="tutor-row">
            <div><strong>Anahí (Gua)</strong><br><small>SIREEX: Pendiente</small></div>
            <button class="btn-small" onclick="aprobarHito(this)">Aprobar Hito</button>
        </li>
        <li class="tutor-row">
            <div><strong>Jimy (Xela)</strong><br><small>SIREEX: OK</small></div>
            <span class="status-badge" style="color:green">Aprobado</span>
        </li>
    `;
}

function aprobarHito(btn) {
    if(confirm("¿Confirmas que revisaste el SIREEX y está correcto? Esto liberará el bono.")) {
        btn.parentElement.innerHTML = `<div><strong>Anahí (Gua)</strong><br><small>SIREEX: OK</small></div><span class="status-badge" style="color:green">Aprobado</span>`;
        // Aquí update a Supabase tabla hitos_admin
    }
}

// UTILS
function calcularDistancia(lat1, lon1, lat2, lon2) {
    // Fórmula Haversine simplificada
    const R = 6371e3; 
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function openModal(id) { document.getElementById(`modal-${id}`).classList.remove('hidden'); }
function closeModal() { document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); }
function logout() { location.reload(); }
