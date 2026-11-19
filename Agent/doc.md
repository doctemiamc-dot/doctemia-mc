# Documentación Técnica de Implementación — Módulo 1 (y Preparación Base de Supabase)

**Proyecto:** Doctemia MC (`sistema-med`)  
**Plan de referencia:** [plan.md](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/Agent/plan.md)  
**Fecha de ejecución:** 2026-11-18  
**Estado:** Módulo 1 y Módulo 2 completados (Fases 1 a 7). Compilación `npm run build` exitosa (49/49 rutas).

---

## 1. Resumen Ejecutivo

Se ejecutaron el **Módulo 1 completo** (rendimiento 60 FPS, cero falsas alertas en iPhone, optimización de flashcards/login y vigencia automática de cuentas en Hora de Bolivia) y el **Módulo 2 completo** (esquema PostgreSQL en Supabase, bucket privado `materials`, carga múltiple y biblioteca de materiales, visor integrado `ProtectedDocumentViewer` sin salida a Google Drive, y calendario semanal interactivo con clases recurrentes y sincronización en tiempo real).

---

## 2. Verificación de Reglas de Oro (Invariantes Intocables)

1. **Invariante #1 — Blindaje de Video (`ProtectedVideoPlayer.jsx`):**
   * Se mantuvo intacta la capa escudo `z-30` (`onContextMenu`, `onDragStart`), `pointerEvents: 'none'` en `ReactPlayer`, `WebkitTouchCallout: 'none'`, `userSelect: 'none'`, los `playerVars` restrictivos de YouTube (`controls: 0`, `modestbranding: 1`, `rel: 0`, `showinfo: 0`, `disablekb: 1`, `fs: 0`, `iv_load_policy: 3`, `playsinline: 1`) y todos los bloqueos de atajos de escritorio (`F12`, `Ctrl+Shift+I/J/C`, `Ctrl+U`, `Ctrl+S`, `Ctrl+P`).
2. **Invariante #2 — Lógica de Imágenes de Google Drive:**
   * No se modificaron `src/lib/driveUtils.js`, `getDriveImageUrl` en `src/app/app/flashcards/estudio/page.jsx`, `convertGoogleDriveUrl` en `AdminNavbar.jsx` y `src/app/app/pagoUnicoCourses/page.jsx`, ni `next.config.js`.
3. **Alcance legacy respetado:**
   * No se modificaron `/admin/courses` ni `/app/courses`.

---

## 3. Detalle de Cambios por Fase

### Fase 1: Cero Alertas Falsas en iPhone con 100% de Protección de Video

* **Archivos modificados:**
  * `src/app/components/video/ProtectedVideoPlayer.jsx`
  * `src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/page.jsx`
* **Implementación:**
  * Se agregó detección de dispositivo móvil/táctil (`isMobileOrTablet`) evaluando User-Agent (`/iPhone|iPad|iPod|Android|Mobile/i`), iPadOS (`Macintosh` con `maxTouchPoints > 1`) y `(pointer: coarse)`.
  * En **móviles/iPhone**, se desactivó únicamente la heurística visual `outerHeight - innerHeight > 160` / `outerWidth - innerWidth > 160` que disparaba falsos positivos por la barra de navegación de Safari, y el `contextmenu` ejecuta `e.preventDefault()` de forma silenciosa (sin `Swal.fire`).
  * En **escritorio**, `detectDevTools` se mantiene activo de forma centralizada únicamente en `ProtectedVideoPlayer.jsx` (se eliminó el `setInterval` duplicado en `ContenidoCursos/[courseId]/page.jsx`) y valida `!Swal.isVisible()` antes de mostrar alertas para evitar modales apilados.
  * **Pantalla completa segura en iOS (`toggleFullScreen`):** En iOS Safari o dispositivos sin soporte nativo de `requestFullscreen` sobre `<div>`, se activa un fallback CSS (`isCssFullScreen`: `fixed inset-0 z-[9999] w-screen h-screen bg-black`) bloqueando el scroll del `body`, conservando la capa escudo `z-30` y los controles propios (`z-40`) sobre el video, y permitiendo salir con el botón de fullscreen o `Escape`.
  * **Optimización de progreso (`handleVideoProgress`):** En `ContenidoCursos/[courseId]/page.jsx`, `setVideoProgress` ahora retorna el estado previo sin generar re-render si el porcentaje redondeado no ha avanzado al menos `1%`.

---

### Fase 2: Fluidez (60 FPS) y Liberación de Red en `/app`

* **Archivos modificados:**
  * `public/videos/video1.mp4`
  * `src/app/app/page.jsx`
* **Implementación:**
  * **Compresión de video de fondo con FFmpeg:** Se recomprimió `public/videos/video1.mp4` (`1280x720`, H.264, `-crf 28 -preset slow`, sin pista de audio `-an`, `-movflags +faststart`), reduciendo su tamaño de **`84,690,769` bytes (~80.8 MB)** a **`666,891` bytes (~651 KB)** (~99.2% menos peso), y se añadió `preload="metadata"` en la etiqueta `<video>`.
  * **Aislamiento del reloj (`<LiveClock />`):** Se extrajo el `setInterval(..., 1000)` fuera de `UserHomePage` hacia el subcomponente independiente `LiveClock`, evitando re-renderizar toda la página cada segundo.
  * **Eliminación de re-renders por scroll y partículas determinísticas (`AnimatedBackground`):**
    * Se eliminó el estado `scrollY` de `UserHomePage` y se memorizó `AnimatedBackground` con `React.memo`.
    * Se reemplazaron las llamadas a `Math.random()` durante el render por un arreglo fijo calculado una sola vez con `useMemo` (14 partículas).
    * En móvil (`< md`) se ocultaron orbes secundarios con `blur-3xl` y se restringieron los `backdrop-blur-*` pesados en tarjetas a `md:backdrop-blur-*` para aliviar la GPU en teléfonos.
  * **Eliminación de selector universal CSS:** Se removió la regla global `* { transition-property: ... }` dentro de `<style jsx global>`.
  * **Eliminación de popup automático de GPS:** `location` inicia directamente con las coordenadas por defecto de `Cochabamba` (`-17.39, -66.16`) sin invocar `navigator.geolocation.getCurrentPosition` al montar; la geolocalización queda disponible solo si el usuario hace clic explícito en el botón de ubicación.

---

### Fase 3: Optimización de Consultas Firestore y Respuesta Instantánea en Flashcards

* **Archivos modificados:**
  * `src/lib/flashcardServices.js`
  * `src/app/app/flashcards/page.jsx`
  * `src/app/app/flashcards/estudio/page.jsx`
* **Implementación:**
  * **Lectura unificada de `flashcards`:**
    * `getFlashcardMetrics(userId, existingCardsCollection = null)` ahora acepta un `Map` o `Set` ya cargado en memoria (manteniendo retrocompatibilidad si se omite).
    * En `src/app/app/flashcards/page.jsx`, `loadDashboardData` descarga `course_categories` y `flashcards` una sola vez en paralelo (`Promise.all`), construye `cardsMap` (`cardsMapRef`) y lo pasa a `getFlashcardMetrics` y `handleRestore`.
    * `criticalQuestions` se resuelve directamente desde `cardsMap.get(card.id)`, eliminando el bucle previo de consultas `getDocs` por cada tarjeta crítica.
  * **Eliminación de bucle N+1 en `handleSelectCategory`:**
    * Se añadió `getMasteredCountsMap(userId)` en `flashcardServices.js` (1 sola consulta filtrando `isMastered == true` y agrupando por `subtemaName` en memoria) para reemplazar el bucle secuencial `for (const sub of allSubthemes) await getMasteredCount(...)`.
  * **UI Optimista en `handleRate` (`estudio/page.jsx`):**
    * Al calificar una tarjeta (`1`–`5`), el estado local (`cards`) y la transición (`setIsFlipped(false)` si `rating === 1`, o `handleNext(true)` en otro caso) se ejecutan de forma inmediata sin esperar la red; `saveFlashcardProgress(...)` corre en segundo plano mostrando `toast.error` únicamente si falla el guardado.

---

### Fase 4: Aceleración del Login y Carga Inicial de Sesión

* **Archivos modificados:**
  * `src/app/login/page.jsx`
  * `src/context/AuthContext.jsx`
  * `src/app/app/pagoUnicoCourses/page.jsx`
* **Implementación:**
  * **Redirección inmediata en Login:** Se reemplazó `await Swal.fire({ ..., timer: 2000 })` bloqueante por una notificación `toast` no bloqueante, redirigiendo de inmediato con `router.replace(...)` al confirmarse `POST /api/login`.
  * **Caché de token en `AuthContext.jsx`:** Se cambió `getIdTokenResult(fbUser, true)` a `getIdTokenResult(fbUser, false)` para aprovechar el caché válido del SDK de Firebase Auth y reducir el tiempo de carga inicial (`loading`), corrigiendo además la limpieza de `unsubFirestore` al cambiar de sesión.
  * **Reutilización del listener global de `users/{uid}`:** En `src/app/app/pagoUnicoCourses/page.jsx`, se eliminó el `onSnapshot` duplicado sobre `users/{uid}` y se leen `pagoUnicoCursosCompletados` directamente desde `user` (`AuthContext`), ajustando las dependencias del `useEffect` a `[user?.uid, user?.hasPagoUnicoAccess]`.

---

### Fase 4.B: Vigencia Configurable y Auto-Desactivación de Cuentas (`/admin/users`)

* **Archivos nuevos:**
  * `src/lib/accountExpiration.js` (`APP_TIMEZONE = 'America/La_Paz'`, `getBoliviaDateParts`, `boliviaDateTimeToIso`, `addMonthsToBoliviaDate`, `addMonthsToDate`, `parseExpirationMs`, `isAccountExpired`, `buildExpirationFields`, `formatExpirationDisplay`, `formatDateTimeBolivia`, `formatDateShortEs`, `calculateDurationDays`)
  * `src/app/api/check-expiration/route.js` (`POST /api/check-expiration`)
* **Archivos modificados:**
  * `src/app/api/create-user/route.js`
  * `src/app/api/login/route.js`
  * `src/app/api/users/route.js`
  * `src/app/api/users/update/route.js`
  * `src/app/api/toggle-active/route.js`
  * `src/context/AuthContext.jsx`
  * `src/app/login/page.jsx`
  * `src/app/admin/users/create/page.jsx`
  * `src/app/admin/users/edit/[userId]/page.jsx`
  * `src/app/admin/users/page.jsx`
* **Implementación y compatibilidad con producción:**
  * **Precisión de Zona Horaria (`America/La_Paz`, UTC-4):**
    * Todos los cálculos de días calendario y vencimientos se resuelven en **Hora de Bolivia (`-04:00`)** usando `Intl.DateTimeFormat` (`getBoliviaDateParts`, `boliviaDateTimeToIso`), evitando desfases cuando el servidor de producción (Vercel) corre en UTC o en horarios nocturnos.
    * Por defecto, cualquier vigencia (`1`, `3`, `6`, `12` meses o fecha exacta) vence a las **`23:59:59` (Hora Bolivia)** del día límite y se almacena en Firestore como ISO-8601 UTC (`activeFrom`, `activeUntil`).
  * **Seguridad para cuentas legacy en producción:** `isAccountExpired(userData)` retorna `false` si `activeUntil` es `null` o no existe, evitando desactivar cuentas antiguas creadas antes de esta actualización. Las cuentas con rol `'admin'` tampoco caducan.
  * **Creación de usuarios (`/admin/users/create` y `POST /api/create-user`):**
    * Selector de **Vigencia de Cuenta Activa** con valor por defecto **3 meses** (`1 mes`, `3 meses`, `6 meses`, `12 meses`, `Fecha exacta`, `Sin vencimiento`), mostrando el rango exacto (`Del [fecha] al [fecha] ([N] días)`).
    * Guarda `activeDurationMonths`, `activeFrom`, `activeUntil`, `expiredAt: null` y `deactivatedReason: null` en Firestore. También aplica el valor por defecto de 3 meses a registros nuevos desde `/register`.
  * **Edición y renovación (`/admin/users/edit/[userId]` y `POST /api/users/update`):**
    * **Layout UX equilibrado (5 + 5 campos + tarjeta a ancho completo):** Se movió `Profesión / Cargo` a la Columna 2 para equilibrar ambos bloques (5 campos por columna, sin espacios vacíos) y se ubicó la tarjeta **Vigencia de la Cuenta** en `md:col-span-2` con diseño horizontal de 2 columnas (izquierda: resumen de rango/vencimiento/días; derecha: botones de duración + fecha y hora exacta).
    * **Adaptabilidad 100% Modo Claro y Oscuro (`isDark`):** Alto contraste en badges, tarjetas de resumen, botones de duración (`1 mes`, `3 meses (Defecto)`, `6 meses`, `12 meses`, `Sin vencimiento`) y `colorScheme` adaptado en todos los inputs `<input type="date">` y `<input type="time">`.
    * **Selector de Fecha Exacta + Hora de corte (Hora Bolivia):** Permite ajustar tanto la fecha límite como la hora de corte (`23:59` por defecto, o cualquier hora específica para cortes precisos o pruebas en vivo).
    * **Activación inteligente:** si la cuenta está en `Inactivo`, muestra aviso de que la vigencia comenzará al activarla; al cambiar `Estado (Activo)` de `Inactivo` → `Activo`, toma la fecha de hoy (`activeFrom`), asigna **3 meses por defecto** y muestra el aviso con el rango exacto (*"del [inicio] al [fin] · [X] días"*) preguntando si desea personalizar el plazo.
    * Muestra el rango actual de vigencia (`Del ... al ...`, vencimiento exacto en Hora Bolivia, total de días y días restantes) y actualiza `activeUntil` en tiempo real.
    * Si se reactiva (`Inactivo` → `Activo`) una cuenta vencida (tanto en edición como en `POST /api/toggle-active`), se renueva automáticamente su `activeUntil` (+3 meses o según `activeDurationMonths`) y se limpian `expiredAt` y `deactivatedReason`.
    * `POST /api/users/update` ahora actualiza la contraseña en Firebase Auth (`adminAuth.updateUser`) cuando se ingresa una nueva contraseña (`>= 6` caracteres), sin almacenarla en Firestore.
  * **Disparadores automáticos de expiración:**
    1. **En Login (`POST /api/login`):** Si `isAccountExpired(userData)` es verdadero, actualiza `{ active: false, expiredAt, deactivatedReason: 'expired' }` en Firestore y responde HTTP `403`.
    2. **En Sesión Activa (`AuthContext.jsx` + `POST /api/check-expiration`):** Si el usuario no-admin tiene `active === false` o `activeUntil` vencido (incluyendo temporizador automático si vence dentro de las siguientes 24 h), ejecuta `/api/check-expiration`, limpia cookies (`__session`, `role`), cierra sesión en Firebase Auth y redirige a `/login?expired=1` (donde `login/page.jsx` muestra el aviso correspondiente).
    3. **En Panel Admin (`GET /api/users` y `/admin/users`):** Al listar usuarios, detecta cuentas con `active === true` y `activeUntil` vencido, las desactiva en lote (`db.batch()` en bloques de hasta 450), muestra banner de aviso en `/admin/users` y agrega la columna **Vigencia**. Se redujo el polling de `/admin/users` de `5s` (`5000 ms`) a `30s` (`30000 ms`) con `revalidateOnFocus: true`.

---

## 4. Configuración Base de Supabase (Infraestructura Lista para Módulo 2)

Durante la preparación previa al Módulo 2 también se dejó configurada y verificada la conexión de Supabase en entorno IPv4:
* **Dependencias instaladas (`package.json`):** `@supabase/supabase-js`, `pg`.
* **Variables configuradas en `.env`:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (Transaction pooler `:6543`) y `DIRECT_URL` (Session pooler `:5432`).
* **Clientes creados:** `src/lib/supabase.js`, `src/lib/supabase-admin.js`, `src/lib/postgres.js`.
* **Nota pendiente de seguridad:** Vaciar o eliminar `Agent/chat.md` una vez rotada o respaldada la contraseña/llave secreta de Supabase que contiene en texto plano.

---

## 5. Resultados de Verificación

* **Pruebas unitarias (`src/lib/accountExpiration.js`):**
  * `legacyExpired: false` (cuentas sin `activeUntil` no se ven afectadas).
  * `pastExpired: true`, `futureExpired: false`, `adminExpired: false`.
  * `defaultMonths: 3`, `unlimited: { activeDurationMonths: null, activeUntil: null }`, `exactDisplay: '15/05/2027'`.
  * Precisión en Hora de Bolivia (`UTC-4`): activación nocturna `17/11/2026 22:30` Bolivia (+3 meses) → `17/02/2027 23:59` Bolivia (`2027-02-18T03:59:59.999Z`, `92 días`); corte exacto a las `00:45` Bolivia (`expiredAt0044: false`, `expiredAt0045: true`).
* **Prueba funcional en vivo:**
  * Validada en entorno local con corte automático en tiempo real al cumplirse fecha/hora límite (cierre de sesión automático, desactivación en Firestore y bloqueo en login).
* **Verificación de video (`ffprobe` + tamaño):**
  * `public/videos/video1.mp4`: `h264`, `1280x720`, `19.000000s`, `666,891` bytes (desde `84,690,769` bytes).
* **Verificación de conexión Supabase (desde red IPv4):**
  * PostgreSQL Pooler `:6543` (`PG_6543_OK`), Pooler `:5432` (`PG_5432_OK`) y `@supabase/supabase-js` (`SUPABASE_JS_OK`).
* **Compilación de producción (`npm run build`):**
  * Exit code `0` (`Next.js 16.2.1 Turbopack`, `✓ Compiled successfully in 5.9s`, `45/45` páginas generadas, incluyendo `/api/check-expiration`).


---

## 6. Módulo 2: Biblioteca de Materiales, Visor Integrado y Calendario Semanal

### Fase 5 (Módulo 2.A): Esquema Supabase, Bucket `materials` y API Segura

* **Migración ejecutada en Supabase PostgreSQL:** [001_module2_schema.sql](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/supabase/migrations/001_module2_schema.sql)
  * Tablas creadas con índices, triggers `updated_at` y RLS habilitado:
    1. `public.course_materials`
    2. `public.live_class_schedules`
    3. `public.live_class_exceptions` (con `ON DELETE CASCADE` y `UNIQUE (schedule_id, original_date)`)
  * **Storage:** Bucket privado `materials` creado con límite de 50 MB por archivo y `allowedMimeTypes` restringido exclusivamente a documentos e imágenes (`pdf`, `ppt`, `pptx`, `doc`, `docx`, `png`, `jpg`, `webp`).
* **Capa de autenticación y utilidades:**
  * `src/lib/apiAuth.js`: `verifySessionUser` centraliza la verificación de cookie `__session` / `Bearer` con Firebase Admin, validando cuenta `active === true`, vigencia (`!isAccountExpired`), `hasPagoUnicoAccess` y rol `admin`.
  * `src/lib/materialUtils.js`: `validateMaterialFile` (bloquea explícitamente videos `video/*` y `.mp4/.mov/.avi/.mkv/.webm`), `inferMaterialType`, `toDrivePreviewUrl`, `sanitizeStorageFileName`.
  * `src/lib/scheduleUtils.js`: `expandSchedulesForWeek`, `computeOccurrenceLiveStatus`, `getWeekDays`, `buildGoogleCalendarUrl`, `buildIcsContent` (en Hora de Bolivia `America/La_Paz`).
  * `src/lib/scheduleBroadcast.js`: `broadcastScheduleChange` vía Supabase Realtime Broadcast (`live-schedules-sync`).
* **Endpoints implementados:**
  * `src/app/api/materials/route.js` (`GET` con URLs firmadas/proxy, `POST` multipart múltiple a Storage o JSON Drive/URL).
  * `src/app/api/materials/[id]/route.js` (`GET`, `PATCH`, `DELETE` con borrado en Storage).
  * `src/app/api/materials/file/[id]/route.js` (`GET` stream inline protegido previa validación de sesión Firebase).
  * `src/app/api/schedules/route.js` (`GET` semanal expandido con filtros, `POST` clase única o serie semanal).
  * `src/app/api/schedules/[id]/route.js` (`GET`, `PATCH` edición completa / excepción puntual / restauración, `DELETE`).

### Fase 6 (Módulo 2.B): Visor Integrado y Biblioteca de Materiales

* **Visor integrado (`src/app/components/documents/ProtectedDocumentViewer.jsx`):**
  * Modal a pantalla completa (`100dvh`) sin marca de agua y sin botones externos de descarga directa.
  * Soporta documentos privados de Supabase Storage (PDF nativo con `#toolbar=0&navpanes=0` en escritorio y modo compatible en iOS Safari, Office `.ppt/.pptx/.doc/.docx`, e imágenes con zoom) y enlaces legacy de Google Drive (`/file/d/{ID}/preview` con escudo discreto superior derecho sobre el botón externo de Drive).
* **Panel Admin y Formularios:**
  * `src/app/admin/materiales/page.jsx`: biblioteca completa con Drag & Drop múltiple, vinculación a Especialidad / Subtema / Curso Pago Único / Video opcional, buscador, vista previa, edición y eliminación.
  * `src/app/admin/Cursos_Pago_Unico/CourseForm.jsx`: subida directa de PDFs/diapositivas a Supabase Storage tanto a nivel general del curso como adjunto a cada video, manteniendo intactos `summaryDriveLink` y `video.driveLink`.
  * `src/app/components/layout/AdminNavbar.jsx`: enlace agregado a **Materiales** (`/admin/materiales`).
* **Portal del Estudiante:**
  * `src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/page.jsx`: muestra materiales de Supabase y enlaces legacy de Drive junto al video activo y en recursos generales, abriendo todos dentro de `ProtectedDocumentViewer` sin `<a target="_blank">`.
  * `src/app/app/materiales/page.jsx` + enlace **Materiales** en `NavbarUser.jsx`: biblioteca filtrable por Especialidad → Tema → Curso → Formato y búsqueda de texto.

### Fase 7 (Módulo 2.C): Calendario Semanal Interactivo y Clases Recurrentes

* **Panel Admin (`src/app/admin/live-classes`):**
  * `ScheduleForm.jsx`, `nueva/page.jsx`, `editar/[id]/page.jsx`: creación y edición de **Clases Únicas** o **Series Semanales Recurrentes** vinculadas a `Cursos_Pago_Unico` y `course_categories`.
  * `src/app/admin/live-classes/page.jsx`: tablero semanal (Lunes a Domingo) con navegación entre semanas y acciones rápidas por ocurrencia (Mover/Reprogramar fecha, Cancelar solo esa sesión, Restaurar, Editar serie completa o Eliminar).
* **Portal del Estudiante (`src/app/app/clases-en-vivo/page.jsx`):**
  * Grilla semanal responsiva (7 días en escritorio, selector de día con indicadores en móvil/iPhone), filtro superior por Curso y Especialidad, estado en vivo (`En vivo ahora`, `Programada`, `Reprogramada`, `Cancelada`, `Finalizada`), sincronización instantánea vía Supabase Realtime Broadcast (`live-schedules-sync`), botón **"Entrar a la clase"** y exportación a **Google Calendar** e **iOS (`.ics`)**.

### Verificación Final del Módulo 2
* **Migración y Storage en Supabase:** tablas `course_materials`, `live_class_schedules`, `live_class_exceptions` y bucket privado `materials` creados y verificados en producción Supabase.
* **Pruebas de `materialUtils.js`:** rechazo de `.mp4`/`.mov` (`valid: false`), aceptación de PDF/PPTX e inferencia de tipo (`slides`), conversión `/view` → `/preview` en Drive.
* **Compilación de producción (`npm run build`):** exitosa (`exit code 0`, `✓ Compiled successfully in 14.1s`, `49/49` rutas generadas sin errores).
