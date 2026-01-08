const CACHE_NAME = '1bot-manager-v3'; // Cambié la versión para forzar actualización
const ASSETS = [
    './',                 // La raíz de la carpeta
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',    // Asegúrate de que este archivo EXISTA en la carpeta
    // Librerías externas (Deben cargarse la primera vez con internet)
    'https://unpkg.com/@supabase/supabase-js@2',
    'https://fonts.googleapis.com/icon?family=Material+Icons'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                // Intentamos cachear. Si uno falla, capturamos el error para saber cuál es.
                return cache.addAll(ASSETS).catch(err => {
                    console.error("Error al cachear archivos. Verifica que existan todos:", err);
                    throw err;
                });
            })
    );
});

self.addEventListener('activate', (e) => {
    // Limpiar cachés viejos
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        })
    );
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => {
            return response || fetch(e.request);
        })
    );
});
