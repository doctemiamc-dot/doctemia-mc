# Auditoría Técnica de Rendimiento, Fluidez y UX Móvil (iPhone / iOS)

**Proyecto:** Doctemia MC (`sistema-med`)  
**Entorno reportado:** Producción en Vercel (usuarios a nivel nacional, incluyendo dispositivos iPhone/iOS)  
**Tipo de documento:** Diagnóstico técnico y auditoría de código (sin modificaciones de código)

---

## Resumen Ejecutivo

A partir de la inspección directa del código fuente y los recursos estáticos del repositorio, los dos síntomas reportados por los usuarios en producción —**alertas molestas constantes en iPhone** y **lentitud / falta de fluidez general**— tienen causas raíz concretas y reproducibles:

1. **Alertas en bucle en iPhone (iOS Safari):** Un detector de herramientas de desarrollo (`detectDevTools`) basado en `window.outerHeight - window.innerHeight > 160` se ejecuta cada `1000ms` y `1500ms` en las pantallas de clases y reproductor de video, generando falsos positivos continuos en Safari móvil. Se suman alertas `Swal.fire` en `contextmenu` (disparado al mantener presionado en pantallas táctiles) y la solicitud automática de geolocalización al abrir `/app`.
2. **Saturación de red y GPU/CPU:** El dashboard `/app` descarga automáticamente un video de fondo de **82.7 MB** (`public/videos/video1.mp4`) mientras re-renderiza sus 1,123 líneas en cada píxel de scroll y cada segundo (`currentTime`), junto con múltiples filtros `blur-3xl`/`backdrop-blur` y un selector CSS global `*` con transiciones costosas. Adicionalmente, el módulo de **Flashcards** descarga toda la colección `flashcards` por duplicado y ejecuta consultas N+1 en serie a Firestore.

---

## Parte 1: Causas de las Alertas Molestas en iPhone (iOS Safari)

### 1.1 Falso positivo en detector de DevTools en bucle infinito (Crítico)
* **Archivos afectados:**
  * `src/app/components/video/ProtectedVideoPlayer.jsx` (líneas 74–85): `setInterval(detectDevTools, 1500)`
  * `src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/page.jsx` (líneas 49–60): `setInterval(detectDevTools, 1000)`
  * `src/app/app/courses/ContenidoCursos/[courseId]/page.jsx` (líneas 50–63): `setInterval(detectDevTools, 1000)`
* **Mecanismo actual:**
  ```js
  const threshold = 160;
  if (window.outerWidth - window.innerWidth > threshold ||
      window.outerHeight - window.innerHeight > threshold) {
    showSecurityWarning(...); // Dispara Swal.fire
  }
  ```
* **Por qué falla en iPhone:** En iOS Safari, `window.outerHeight` refleja la altura física total del dispositivo/ventana (incluyendo barra de estado, Dynamic Island/notch, barra de direcciones y barra inferior del navegador), mientras que `window.innerHeight` mide el viewport web utilizable. Esta diferencia supera de forma natural los `160px` en iPhones modernos o al existir zoom/barras expandidas.
* **Impacto en UX:** Como la página del curso (`1000ms`) y `ProtectedVideoPlayer` (`1500ms`) corren intervalos paralelos, **el usuario de iPhone recibe un bucle continuo de alertas modales/toast de `Swal.fire`** cada ~1 segundo mientras intenta ver una clase.

### 1.2 Disparo accidental de `contextmenu` en pantallas táctiles
* **Archivos afectados:**
  * `src/app/components/video/ProtectedVideoPlayer.jsx` (líneas 29–33 y 69)
  * `src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/page.jsx` (líneas 37–58)
  * `src/app/app/courses/ContenidoCursos/[courseId]/page.jsx` (líneas 40–61)
* **Causa raíz:** Los listeners globales `document.addEventListener('contextmenu', ...)` no solo cancelan el evento con `e.preventDefault()`, sino que también lanzan `Swal.fire(...)`. En dispositivos táctiles (iOS/Android), apoyar el dedo brevemente sobre la pantalla al hacer scroll o pausar dispara `contextmenu`, abriendo múltiples alertas emergentes simultáneas.

### 1.3 Solicitud automática de Geolocalización (GPS) al entrar a `/app`
* **Archivo afectado:** `src/app/app/page.jsx` (líneas 483–501)
* **Causa raíz:** Al montar `UserHomePage`, se invoca inmediatamente `navigator.geolocation.getCurrentPosition(...)` únicamente para consultar la temperatura actual en `https://api.open-meteo.com/v1/forecast` con `useSWR`.
* **Impacto en iPhone:** Muestra el diálogo nativo de permisos de ubicación del sistema operativo en iOS apenas inicia sesión el estudiante.

### 1.4 Incompatibilidad de Fullscreen API en iPhone (Hallazgo relacionado)
* **Archivo afectado:** `src/app/components/video/ProtectedVideoPlayer.jsx` (líneas 146–173)
* **Causa raíz:** `toggleFullScreen()` llama a `containerRef.current.requestFullscreen()` (y variantes con prefijo) sobre un elemento `<div>`. iOS Safari en iPhone no soporta la Fullscreen API sobre contenedores `<div>` arbitrarios (solo nativamente sobre `<video>`), lo que impide maximizar el reproductor en iPhone.

---

## Parte 2: Causas de Lentitud y Falta de Fluidez

### A. Cuellos de Botella de Red, Almacenamiento y Firestore

#### 2.1 Video de fondo de 82.7 MB descargándose automáticamente en `/app` (Crítico)
* **Recurso afectado:** `public/videos/video1.mp4` — **82,705.83 KB (~82.7 MB)**
* **Archivo afectado:** `src/app/app/page.jsx` (líneas 580–587)
  ```jsx
  <video src="/videos/video1.mp4" autoPlay loop muted playsInline ... />
  ```
* **Impacto:**
  * En cuanto el estudiante entra al inicio (`/app`), el navegador inicia la descarga de más de 82 MB en primer plano.
  * En conexiones móviles 4G o Wi-Fi doméstico a nivel nacional, este archivo satura el ancho de banda del cliente, retrasa las consultas simultáneas a Firestore/APIs y consume tráfico innecesario en Vercel.

#### 2.2 Doble descarga completa de la colección `flashcards` y consultas N+1
* **Archivos afectados:**
  * `src/app/app/flashcards/page.jsx` (líneas 298–300, 336–352 y 375–380)
  * `src/lib/flashcardServices.js` (líneas 101–107)
* **Problemas detectados:**
  1. **Descarga total #1:** `fetchData()` ejecuta `getDocs(collection(db, 'flashcards'))` descargando todo el banco global de flashcards solo para derivar qué especialidades tienen tarjetas y contarlas por subtema.
  2. **Descarga total #2 en paralelo:** `fetchUserMetrics()` llama a `getFlashcardMetrics(user.uid)`, función que ejecuta **otra vez** `getDocs(collection(db, 'flashcards'))` para verificar existencia, además de leer toda la subcolección `users/{userId}/flashcards_progress`.
  3. **Bucle N+1 en tarjetas críticas:** En `src/app/app/flashcards/page.jsx` (líneas 340–347), por cada tarjeta crítica (`stats.criticalCards`) se hace un `await getDocs(query(collection(db, 'flashcards'), where('__name__', '==', card.id)))` secuencial, pese a haber descargado previamente toda la colección `flashcards` dos veces.
  4. **Bucle N+1 secuencial al seleccionar especialidad:** `handleSelectCategory` (líneas 376–380) recorre todos los subtemas ejecutando `await getMasteredCount(user.uid, sub.name.trim())` uno tras otro en serie (`for ... await`), bloqueando la UI tantos viajes de red como subtemas tenga la especialidad.

#### 2.3 Guardado bloqueante (sin UI optimista) en sesiones de estudio de Flashcards
* **Archivo afectado:** `src/app/app/flashcards/estudio/page.jsx` (líneas 197–224)
* **Causa raíz:** En `handleRate`, el avance hacia la siguiente tarjeta (`handleNext()`) espera a que finalice `await saveFlashcardProgress(...)` contra Firestore. En redes móviles con latencia de 300–800 ms, cada calificación se percibe trabada.

#### 2.4 Retrasos artificiales y peticiones extra en Login y Sesión
* **Espera forzada de 2 segundos tras login exitoso:** `src/app/login/page.jsx` (líneas 39–53) detiene la navegación con `await Swal.fire({ ..., timer: 2000 })` antes de ejecutar `router.replace(...)`.
* **Refresco forzado de token en cada carga:** `src/context/AuthContext.jsx` (línea 24) llama a `getIdTokenResult(fbUser, true)`. El parámetro `true` fuerza una petición de red a Firebase Auth en cada montaje del proveedor antes de liberar `loading` en `src/app/app/layout.jsx` (líneas 30–36), prolongando la pantalla `"Cargando..."`.
* **Lecturas/listeners redundantes de `users/{uid}`:** Aunque `AuthContext.jsx` mantiene un `onSnapshot` global sobre `users/{uid}`, páginas como `src/app/app/pagoUnicoCourses/page.jsx` (líneas 348–353) y `src/app/app/courses/ContenidoCursos/[courseId]/page.jsx` (líneas 92–93) vuelven a suscribirse o consultar el mismo documento.

---

### B. Cuellos de Botella de Renderizado, CPU y GPU (Bajos FPS)

#### 2.5 Re-renderizado masivo de `/app` en cada evento de scroll y cada segundo
* **Archivo afectado:** `src/app/app/page.jsx` (líneas 31–291 y 519–538)
* **Causas combinadas:**
  1. **Scroll sin throttle ni aislamiento:** `window.addEventListener('scroll', handleScroll)` llama a `setScrollY(window.scrollY)` directamente en el componente raíz `UserHomePage` (1,123 líneas), forzando un re-render completo de toda la página en cada frame del scroll.
  2. **Reloj en componente raíz:** Un `setInterval` cada `1000ms` actualiza `currentTime` en `UserHomePage`, disparando otro re-render completo de toda la vista cada segundo.
  3. **Partículas inestables con `Math.random()` en render:** `AnimatedBackground` (líneas 256–269) genera 20 nodos `<div>` llamando a `Math.random()` para `top`, `left`, `animationDelay` y `animationDuration` en cada renderizado; cada segundo y cada desplazamiento de scroll reposiciona y reinicia las 20 partículas.
  4. **Sobrecarga de GPU móvil:** Coexisten hasta 5–7 orbes grandes (`w-96 h-96`, `w-80 h-80`, `w-64 h-64`, etc.) con `blur-3xl` animados, un grid CSS en movimiento (`gridMove`), tarjetas con `backdrop-blur-md`/`backdrop-blur-lg` y el video HTML5 de 82.7 MB de fondo. En GPUs de iPhone y Android esto provoca caídas severas de FPS y calentamiento.

#### 2.6 Selector CSS universal `*` con transiciones de `filter` y `backdrop-filter`
* **Archivo afectado:** `src/app/app/page.jsx` (líneas 1051–1054)
  ```css
  * {
    transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }
  ```
* **Impacto:** Fuerza al motor de renderizado del navegador a monitorear e interpolar propiedades costosas (`box-shadow`, `transform`, `filter`, `backdrop-filter`) en cada elemento del DOM durante cambios de estado, hover o scroll.

#### 2.7 Re-renderizado continuo durante la reproducción de clases (`onProgress`)
* **Archivos afectados:**
  * `src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/page.jsx` (líneas 124–131)
  * `src/app/app/courses/ContenidoCursos/[courseId]/page.jsx` (líneas 135–146)
* **Causa raíz:** `ProtectedVideoPlayer` invoca `onProgress` periódicamente (~1 vez por segundo), y el componente padre de la página del curso ejecuta `setVideoProgress(...)` sobre todo el árbol de la página (módulos, descripción y el propio reproductor).

---

## Parte 3: Matriz de Prioridades de Optimización

| Prioridad | Área / Archivo(s) | Problema Identificado | Beneficio Esperado al Corregir |
| :---: | :--- | :--- | :--- |
| **P0 (Urgente)** | `ProtectedVideoPlayer.jsx`, `ContenidoCursos/[courseId]/page.jsx` (ambos) | Falsos positivos en `detectDevTools` (`outerHeight - innerHeight > 160`) cada 1s/1.5s y `Swal.fire` en `contextmenu` | Elimina de raíz las **alertas molestas en bucle en iPhone** |
| **P0 (Urgente)** | `public/videos/video1.mp4` + `src/app/app/page.jsx` | Video de **82.7 MB** en autoPlay + `scrollY`/`currentTime` en el padre + `Math.random()` en partículas + selector `*` + exceso de `blur-3xl` | Libera la red en el arranque y devuelve **fluidez (60 FPS)** al inicio |
| **P1 (Alta)** | `src/app/app/flashcards/page.jsx`, `src/lib/flashcardServices.js`, `estudio/page.jsx` | Doble descarga de `flashcards` + bucles `for ... await` (N+1) + espera `await` al calificar | Carga rápida de métricas/subtemas y **transición instantánea entre tarjetas** |
| **P1 (Alta)** | `src/app/login/page.jsx`, `src/context/AuthContext.jsx` | Delay artificial de `2000ms` en login + `getIdTokenResult(fbUser, true)` + listeners duplicados de `users/{uid}` | Entrada más rápida al portal y menor tiempo en pantalla `"Cargando..."` |
| **P2 (Media)** | `src/app/app/page.jsx` (Geolocalización), `ContenidoCursos/[courseId]/page.jsx` (`onProgress`) | Popup nativo de GPS al entrar a `/app` + re-renders por progreso de video + Fullscreen en iOS | Mejor experiencia inicial en iOS y menor consumo de CPU durante las clases |
