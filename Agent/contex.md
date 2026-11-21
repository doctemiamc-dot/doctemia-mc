# Contexto Técnico del Proyecto: Doctemia MC (`sistema-med`)

> Documento de referencia técnica para agentes y desarrolladores sobre la arquitectura, stack, rutas, modelos de datos y particularidades del código de **Doctemia MC**.

---

## 1. Identidad y Resumen del Proyecto

* **Nombre comercial:** Doctemia MC
* **Nombre del paquete / repositorio:** `sistema-med` (`v0.1.0`)
* **Propósito:** Plataforma educativa médica (**LMS + SaaS**) orientada a la formación médica continua y la preparación de exámenes de grado. Opera bajo un modelo de **acceso controlado por administración**, donde los estudiantes exploran la plataforma y envían solicitudes de acceso/pago que el administrador aprueba de forma centralizada.
* **Módulos principales:**
  * **Cursos de Pago Único y Cursos Regulares:** Catálogo organizado por especialidades y subtemas, con reproductor de video protegido contra copias e inspección.
  * **Clases en Vivo:** Gestión y acceso a sesiones sincrónicas.
  * **Simulacros de Examen (Banco de Preguntas):** Evaluaciones cronometradas con historial de intentos (`examAttempts`) y vista administrativa de resultados.
  * **Flashcards con Repetición Espaciada (SM-2):** Sistema de *Active Recall* mental con escala Likert de 5 puntos, soporte *Cloze Deletion* (`[palabra]`), casos clínicos, imágenes (Google Drive y web estándar), analíticas de debilidades activas y modal de *Radiografía de Tarjeta*.
  * **Gestión de Pagos/QR y Solicitudes:** Flujo de solicitudes con visualización de código QR y contacto por WhatsApp configurables desde administración.

---

## 2. Stack Tecnológico y Dependencias (`package.json`)

| Capa | Tecnología / Paquete | Versión / Detalles |
| :--- | :--- | :--- |
| **Framework** | `next` | `^16.1.6` (App Router, Turbopack configurado con `root: __dirname` en `next.config.js` y alias `@` → `src/`) |
| **UI / Frontend** | `react`, `react-dom` | `^19.2.4` |
| **Estilos** | `tailwindcss`, `@tailwindcss/postcss`, `autoprefixer` | Tailwind CSS `^4.2.2` con modo oscuro/claro (`ThemeContext`), CSS Modules y hojas CSS específicas en `src/app/styles/` |
| **Backend / BaaS (Cliente)** | `firebase` | `^11.7.1` (Authentication, Cloud Firestore, Analytics) |
| **Backend Serverless (Admin)** | `firebase-admin` | `^13.3.0` (ejecutado en Route Handlers de `src/app/api/*`) |
| **Base de Datos Relacional y Storage (Módulo 2)** | `@supabase/supabase-js`, `pg` | Supabase PostgreSQL (Pooler IPv4 `:6543` / `:5432`), Storage privado (bucket `materials`) y Realtime Broadcast (`live-schedules-sync`) |
| **Iconografía y UX** | `lucide-react`, `react-icons`, `sweetalert2`, `react-hot-toast` | Iconos vectoriales, modales interactivos y notificaciones toast |
| **Multimedia y Utilidades** | `react-player`, `qrcode.react`, `dayjs`, `react-datepicker`, `swr`, `js-cookie` | Reproducción de video (YouTube), generación de QR, manejo de fechas, fetching con SWR (ej. Open-Meteo en `/app`) y cookies |
| **Linting** | `eslint`, `eslint-config-next` | ESLint `^9` |

---

## 3. Arquitectura de Directorios (`src/`)

```text
src/
├── middleware.js                     # Control de acceso por cookies (__session, role)
├── context/
│   ├── AuthContext.jsx               # Proveedor de autenticación (useAuth) y listener de users/{uid}
│   └── ThemeContext.js               # Gestión global de tema claro/oscuro (useTheme / isDark)
├── lib/
│   ├── firebase.js                   # Inicialización Firebase Client (app, auth, db, storage, analytics)
│   ├── firebase-admin.js             # Inicialización Firebase Admin SDK (auth, db) con ignoreUndefinedProperties
│   ├── supabase.js                   # Cliente público Supabase (browser / Realtime)
│   ├── supabase-admin.js             # Cliente administrativo Supabase (service_role, solo servidor)
│   ├── postgres.js                   # Pool PostgreSQL (`pgPool`) sobre Transaction Pooler IPv4
│   ├── apiAuth.js                    # Verificador centralizado de sesión Firebase (`__session`, rol, active, vigencia, hasPagoUnicoAccess)
│   ├── accountExpiration.js          # Cálculo y validación de vigencia en Hora de Bolivia (`America/La_Paz`, UTC-4)
│   ├── materialUtils.js              # Validación de documentos (bloquea videos), MIME types y conversión `/preview` de Drive
│   ├── scheduleUtils.js              # Expansión semanal de horarios recurrentes, excepciones, Google Calendar e `.ics`
│   ├── scheduleBroadcast.js          # Emisión Broadcast por Supabase Realtime (`live-schedules-sync`)
│   ├── db.js                         # Referencias exportadas a colecciones Firestore
│   ├── spacedRepetition.js           # Motor SM-2 (calculateNextReview) con escala 1-5
│   ├── flashcardServices.js          # Persistencia atómica, métricas, `getMasteredCountsMap` y borrado en cascada
│   ├── driveUtils.js                 # Conversión de URLs de Google Drive (formatDriveUrl) — INVARIANTE INTOCABLE
│   └── fetcher.js                    # Helper fetch para SWR
├── scripts/
│   └── setAdmin.js                   # Script CLI para asignar Custom Claim { role: 'admin' }
└── app/
    ├── layout.js                     # RootLayout: envuelve la app en ThemeProvider y AuthProvider
    ├── page.js                       # Raíz (redirigida a /login por middleware)
    ├── globals.css                   # Estilos globales base
    ├── login/                        # Inicio de sesión (layout.jsx, page.jsx)
    ├── register/                     # Registro de estudiantes
    ├── marketing/                    # Página de marketing
    ├── api/                          # Endpoints serverless (Firebase Admin SDK)
    ├── admin/                        # Panel administrativo (protegido para role === 'admin')
    ├── app/                          # Portal del estudiante (protegido por sesión)
    ├── components/
    │   ├── documents/
    │   │   └── ProtectedDocumentViewer.jsx # Visor integrado (PDFs, Office, imágenes Supabase y Drive `/preview`) sin salir de la app
    │   ├── layout/
    │   │   ├── AdminNavbar.jsx       # Sidebar/Header admin con conteo agregado de solicitudes (getCountFromServer) y carga perezosa al abrir campana
    │   │   └── NavbarUser.jsx        # Sidebar/Header del estudiante (incluye Materiales)
    │   └── video/
    │       └── ProtectedVideoPlayer.jsx # Reproductor YouTube blindado contra inspección y descargas (con fallback fullscreen CSS en iOS)
    ├── hooks/
    │   ├── useDarkMode.js
    │   ├── useAuth.js                # (Archivo vacío — 0 bytes)
    │   └── useCourseAccess.js        # (Archivo vacío — 0 bytes)
    ├── styles/                       # Hojas de estilo modulares (exámenes, navbar, protección, etc.)
    └── utils/
        └── roleUtils.js              # (Archivo vacío — 0 bytes)
```

### Componentes y Capas Clave

* **`src/middleware.js`:** Intercepta `/`, `/login`, `/register`, `/app/:path*` y `/admin/:path*`.
  * Redirige `/` → `/login`.
  * Si hay cookie `__session` en `/login` o `/register`, redirige a `/admin` (si `role === 'admin'`) o `/app`.
  * Si no existe `__session` en rutas protegidas, redirige a `/login`.
  * Bloquea `/admin/:path*` si `role !== 'admin'`, enviando a `/app`.
* **`src/context/AuthContext.jsx` (`AuthProvider`, `useAuth`):**
  * Escucha `onAuthStateChanged(auth)` y consulta `getIdTokenResult(fbUser, false)` (aprovechando caché para carga rápida).
  * Determina el rol mediante `tokenResult.claims.role` o el fallback `NEXT_PUBLIC_ADMIN_EMAIL` (por defecto `'admin@admin.com'`).
  * Se suscribe en tiempo real (`onSnapshot`) a `users/{uid}` (con limpieza correcta de listener); si el documento no existe en Firestore, lo crea automáticamente con valores iniciales.
  * Para cuentas no-admin, valida `active !== false` y `isAccountExpired(docData)` (con timer automático si vence en < 24h), disparando `POST /api/check-expiration`, cierre de sesión y redirección a `/login?expired=1`.
  * Expone `{ user, role, loading, signOut, refreshUserData, firebaseAuthUser }`, donde `signOut()` invoca `POST /api/logout` y `fbSignOut(auth)`.
* **`src/context/ThemeContext.js` (`ThemeProvider`, `useTheme`):**
  * Gestiona `isDark`, `toggleTheme`, `setTheme` e `isLoaded` sincronizando `localStorage` (`theme`) y `prefers-color-scheme`, aplicando la clase `dark` sobre `document.documentElement`.
* **`src/lib/spacedRepetition.js` (`calculateNextReview`):**
  * Algoritmo SuperMemo-2 con escala de **1 a 5**:
    * `1` (Olvido): `interval = 0`, `repetitions = 0`, `easiness -= 0.2`.
    * `2` (Difícil): `interval = 1`, `repetitions = 0`, `easiness -= 0.15`.
    * `3` (Normal): `1` día → `6` días → `round(prevInterval * easiness)`.
    * `4` (Fácil): escala `* 1.3`, `easiness += 0.1`.
    * `5` (Perfecto): escala `* 1.5`, `easiness += 0.15`.
    * Mínimo de facilidad fijado en `1.3`.
* **`src/lib/flashcardServices.js`:**
  * `saveFlashcardProgress`: Guarda en `users/{userId}/flashcards_progress/{flashcardId}` usando `setDoc(..., { merge: true })` y contadores atómicos `increment()` (`totalVistas`, `totalFallos`, `totalAciertos`). Marca `esDebilidadActiva` si `quality <= 2` y `isMastered` si `forceMastered` o `quality >= 4 && repetitions >= 3`.
  * `deleteFlashcardCompleta`: Usa `writeBatch` para borrar la tarjeta en `flashcards/{cardId}` y purgar todos los registros asociados en `collectionGroup(db, 'flashcards_progress')` donde `cardId == cardId` (con fallback `try/catch` si falta índice).
  * `getFlashcardMetrics`, `getDueFlashcards`, `getAllFlashcardsBySubtema`, `getWeakFlashcards`, `restoreMasteredFlashcards`, `getMasteredCount`.
* **`src/lib/driveUtils.js` (`formatDriveUrl`):**
  * Convierte enlaces compartidos de Google Drive (`/file/d/[ID]/view` o `/d/[ID]`) a `https://drive.google.com/uc?export=view&id=[ID]`, dejando intactas las URLs que ya usan `uc?`, `thumbnail?` o dominios externos.
* **`src/app/components/layout/AdminNavbar.jsx`:**
  * Barra lateral y superior del panel admin. Reemplazó los `onSnapshot` globales por `getCountFromServer` sobre `solicitudes` y `pagoUnico_solicitudes` al montar (`~2` lecturas agregadas) y carga perezosa (`limit(15)`) al abrir el panel de notificaciones, con botón de refresco manual.
* **`src/app/components/layout/NavbarUser.jsx`:**
  * Navegación del portal estudiantil hacia Inicio, Cursos (`/app/pagoUnicoCourses`), Tarjetas de Estudio, Exámenes, Clases en Vivo y Perfil (con enlaces de Cursos Premium comentados en el menú actual).
* **`src/app/components/video/ProtectedVideoPlayer.jsx`:**
  * Envuelve `react-player/youtube` con bloqueo de menú contextual (`contextmenu` silencioso en móvil, alerta en desktop), atajos (`F12`, `Ctrl+Shift+I/J/C`, `Ctrl+U`, `Ctrl+S`, `Ctrl+P`), capa escudo `z-30`, `pointerEvents: 'none'`, `-webkit-touch-callout: none`, detección de DevTools solo en escritorio (evitando falsos positivos en iPhone/iPad) y modo fullscreen CSS seguro (`fixed inset-0 z-[9999]`) para iOS Safari.

---

## 4. Mapa de Rutas (App Router)

### 4.1 Rutas Públicas y Autenticación
* `/login` — Inicio de sesión (Firebase Auth + creación de cookie vía `/api/login`).
* `/register` — Registro de nuevos estudiantes.
* `/marketing` — Vista informativa / marketing.

### 4.2 Panel Administrativo (`/admin`)
* `/admin` — Dashboard administrativo principal.
* `/admin/users`, `/admin/users/create`, `/admin/users/edit/[userId]` — CRUD de usuarios, activación/desactivación y gestión de suscripciones.
* `/admin/courses`, `/admin/courses/new`, `/admin/courses/edit/[id]`, `/admin/courses/preview/[id]` — Gestión de cursos regulares/premium (`CourseForm.jsx`).
* `/admin/Cursos_Pago_Unico`, `/admin/Cursos_Pago_Unico/new`, `/admin/Cursos_Pago_Unico/edit/[id]`, `/admin/Cursos_Pago_Unico/preview/[id]` — Gestión de cursos de pago único (`CourseForm.jsx`).
* `/admin/Cursos_Pago_Unico/categoria` — Gestión jerárquica de **Especialidades** (`course_categories`) y **Subtemas / Identificadores** (`subcategories`).
* `/admin/materiales` — Biblioteca y carga múltiple (Drag & Drop) de PDFs, diapositivas, resúmenes o enlaces hacia Supabase Storage (`course_materials`), vinculable a especialidad, subtema, curso y video.
* `/admin/flashcards`, `/admin/flashcards/new`, `/admin/flashcards/edit/[id]` — Administración de flashcards: búsqueda multitérmino, filtro por especialidad, soporte Cloze `[palabra]`, previsualización en vivo y borrado masivo en modo selección con confirmación de seguridad.
* `/admin/bank-preguntas`, `/admin/bank-preguntas/nueva`, `/admin/bank-preguntas/editar/[id]`, `/admin/bank-preguntas/resultados/[examId]` — Banco de exámenes y visualización de resultados por examen.
* `/admin/live-classes`, `/admin/live-classes/nueva`, `/admin/live-classes/editar/[id]` — Tablero semanal (Lunes–Domingo) y gestión de clases en vivo únicas o series semanales recurrentes (`ScheduleForm.jsx`), con reprogramación/cancelación de ocurrencias puntuales en Supabase.
* `/admin/solicitudes` — Aprobación/rechazo de solicitudes de cursos (`solicitudes`) y de acceso a exámenes (`examenTest_solicitudes`).
* `/admin/solicitudes-pago-unico` — Aprobación/rechazo de solicitudes de acceso pago único (`pagoUnico_solicitudes`, habilita `hasPagoUnicoAccess: true`).
* `/admin/qr-gestion` — Configuración del código QR de pago e información de contacto (`pags/infoContacto`).
* `/admin/profile` — Perfil del administrador.

### 4.3 Portal del Estudiante (`/app`)
* `/app` — Dashboard del estudiante con video de fondo (`/videos/video1.mp4`), clima local vía Open-Meteo (`https://api.open-meteo.com/v1/forecast` con `useSWR`) y accesos rápidos.
* `/app/courses` y `/app/courses/ContenidoCursos/[courseId]` — Catálogo y contenido de cursos regulares.
* `/app/cursosPagados` — Listado de cursos adquiridos por el usuario.
* `/app/pagoUnicoCourses` y `/app/pagoUnicoCourses/ContenidoCursos/[courseId]` — Catálogo y reproductor de cursos de pago único con visor integrado `ProtectedDocumentViewer` para materiales de Supabase y enlaces legacy de Drive.
* `/app/materiales` — Biblioteca filtrable por Especialidad → Tema → Curso → Formato con lectura integrada en `ProtectedDocumentViewer`.
* `/app/clases-en-vivo` — Calendario semanal interactivo (Lunes–Domingo, Hora Bolivia) con filtro por Curso y Especialidad, sincronización en tiempo real vía Supabase Realtime, estado en vivo y exportación a Google Calendar / `.ics` (iOS).
* `/app/examen-test` y `/app/examen-test/examen` — Listado de simulacros, historial de intentos y ejecución cronometrada de exámenes.
* `/app/flashcards` y `/app/flashcards/estudio` — Dashboard de flashcards (controlado por pantalla de acceso denegado/solicitud si corresponde), métricas SM-2, modal `CardRadiographyModal.jsx` (*Radiografía de Tarjeta*) y reproductor 3D en modos **Estándar**, **Intensivo** y **Refuerzo** con *Active Recall* mental y atajos globales (`ESPACIO`, `ENTER`, `←`, `→`, `1`–`5`).
* `/app/profile` — Perfil del estudiante.

### 4.4 Endpoints API (`/api/*` — Firebase Admin SDK)
* `POST /api/login` — Verifica `token` con `adminAuth.verifyIdToken(token, true)`. Si el correo coincide con `NEXT_PUBLIC_ADMIN_EMAIL` (o fallback `'admin@admin.com'`) asigna rol `'admin'`; de lo contrario valida `users/{uid}`, exige `userData.active === true` y verifica vigencia (`isAccountExpired`: si venció, actualiza `active: false`, `expiredAt`, `deactivatedReason: 'expired'` y responde `403`). Emite cookies `__session` y `role`.
* `POST /api/logout` — Expira inmediatamente (`maxAge: 0`) las cookies `__session` y `role`.
* `POST /api/check-expiration` — Valida vigencia de la sesión activa; si venció, desactiva la cuenta en Firestore y expira cookies.
* `GET /api/users` — Soporta `?paginated=1` con múltiples modos eficientes: `action=page` (paginación por cursor `afterId` y bloques `pagesToFetch` + conteos `.count().get()`), `action=search` (escaneo acotado en lotes de `200`, tope `1200`), `action=stats` (3 lecturas agregadas para el dashboard `/admin`), `action=single&userId=...` (1 lectura para edición) y manejo de cuota con HTTP `429` (`code: 'resource-exhausted'`). Mantiene modo heredado sin `?paginated=1` y auto-desactiva en lote usuarios con `activeUntil` vencido.
* `POST /api/create-user` — Crea usuario en Firebase Auth y guarda documento inicial en `users/{uid}` con vigencia configurable (por defecto **3 meses** desde activación en Hora Bolivia: `activeFrom`, `activeUntil`, `activeDurationMonths`).
* `DELETE /api/delete-user` — Elimina uno (`userId`) o múltiples usuarios (`userIds`) tanto de Firebase Auth como de `users/{id}`.
* `POST /api/users/update` — Actualiza campos del documento `users/{userId}` en Firestore y, si se envía `password` (`>= 6` chars), la actualiza en Firebase Auth (`adminAuth.updateUser`).
* `POST /api/toggle-active` — Alterna `active` en `users/{userId}`; si reactiva una cuenta vencida o sin vigencia inicializada, asigna vigencia por defecto de 3 meses desde hoy.
* `POST /api/update-subscription` — Calcula `fechaVencimiento` (+30 días × `cantidadMeses`) y actualiza `fechaSuscripcion`, `fechaVencimiento` e `isPremium`.
* `POST /api/clear-subscription` — Restablece `fechaSuscripcion: '-'`, `fechaVencimiento: '-'` e `isPremium: false`.
* `GET/POST /api/materials`, `GET/PATCH/DELETE /api/materials/[id]`, `GET /api/materials/file/[id]` — Gestión paginada, detección de origen, URLs firmadas, streaming inline protegido y borrado garantizado de archivo en Storage (`materials`).
* `GET/POST /api/schedules`, `GET/PATCH/DELETE /api/schedules/[id]`, `GET/POST/DELETE /api/schedules/[id]/resources` — Calendario semanal, series recurrentes, excepciones puntuales y recursos post-clase (grabación por URL + diapositiva subida/externa) con limpieza en Supabase Storage.
* `DELETE /api/pago-unico-courses/[id]`, `POST /api/course-covers`, `GET /api/course-covers/[file]` — Eliminación completa de cursos Pago Único (Firestore + `course_materials` + `live_class_schedules` + archivos/portadas en Storage) y gestión de portadas opcionales en Storage.

---

## 5. Modelo de Datos en Firestore

* **`users` (`users/{uid}`):** Perfil del usuario, rol (`role` / `rol`), estado (`active` / `isActive`), vigencia configurable (`activeFrom`, `activeUntil`, `activeDurationMonths`, `expiredAt`, `deactivatedReason`), accesos (`cursosPagados`, `pagoUnicoCursosCompletados`, `hasExamenTestAccess`, `hasPagoUnicoAccess`, `isPremium`, `fechaSuscripcion`, `fechaVencimiento`, `subscription`).
  * **Subcolección `users/{userId}/flashcards_progress/{cardId}`:** Estado SM-2 y métricas por tarjeta (`easiness`, `interval`, `repetitions`, `nextReview`, `lastUpdated`, `cardId`, `subtemaName`, `esDebilidadActiva`, `isMastered`, `totalVistas`, `totalFallos`, `totalAciertos`).
* **`courses`:** Cursos por suscripción / regulares y su estructura de contenido.
* **`Cursos_Pago_Unico`:** Cursos de la modalidad de pago único.
* **`course_categories`:** Especialidades médicas.
  * **Subcolección `course_categories/{catId}/subcategories`:** Subtemas / Identificadores de estudio usados en cursos y flashcards.
* **`flashcards`:** Banco global de tarjetas (`pregunta`, `respuesta`, `explicacion`, `tipo`, `especialidad`, `especialidadNombre`, `subtema`, `driveUrl`, `tags`, `createdAt`).
* **`exams`:** Exámenes configurados desde `/admin/bank-preguntas` (`src/lib/db.js` mantiene además la referencia `questionBank`).
* **`examAttempts`:** Intentos y resultados de exámenes realizados por los estudiantes.
* **`clasesEnVivo`:** Sesiones programadas desde `/admin/live-classes` (`src/lib/db.js` mantiene además la referencia `liveClasses`).
* **`solicitudes`:** Solicitudes de inscripción a cursos individuales.
* **`examenTest_solicitudes`:** Solicitudes de acceso al módulo de exámenes.
* **`pagoUnico_solicitudes`:** Solicitudes de acceso a cursos de pago único / flashcards (`status: 'pendiente'`, `type: 'pago_unico_access'`).
* **`pags/infoContacto`:** Documento de configuración con `qrUrl` y datos de contacto del administrador para pagos.

### 5.1 Modelo de Datos en Supabase (PostgreSQL + Storage — Módulo 2)
* **Migraciones:** [001_module2_schema.sql](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/supabase/migrations/001_module2_schema.sql), [002_live_class_resources.sql](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/supabase/migrations/002_live_class_resources.sql), [003_course_materials_indexes.sql](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/supabase/migrations/003_course_materials_indexes.sql).
* **Bucket privado Storage:** `materials` (documentos/diapositivas hasta 50 MB y portadas de cursos; videos prohibidos).
* **Tablas (con RLS habilitado; acceso vía Next.js API Routes + `supabaseAdmin`):**
  * **`course_materials`:** `id`, `title`, `description`, `material_type` (`slides` | `summary` | `pdf`), `source_type` (`supabase_storage` | `google_drive_legacy` | `external_url`), `storage_path`, `file_url`, `file_name`, `mime_type`, `file_size`, `especialidad_id`, `especialidad_nombre`, `subtema`, `course_id`, `module_index`, `video_url`, `uploaded_by`, `is_active`, `created_at`, `updated_at`.
  * **`live_class_schedules`:** `id`, `titulo`, `descripcion`, `expositor`, `course_id`, `course_title`, `especialidad_id`, `especialidad_nombre`, `enlace`, `id_reunion`, `is_recurring`, `day_of_week` (`0..6`), `fecha_especifica`, `hora_inicio`, `duracion_minutos`, `status`, `vigente_desde`, `vigente_hasta`, `created_by`, `created_at`, `updated_at`.
  * **`live_class_exceptions`:** `id`, `schedule_id` (FK `ON DELETE CASCADE`), `original_date`, `action` (`cancelled` | `rescheduled`), `new_date`, `new_hora_inicio`, `new_enlace`, `motivo`, `created_at`.
  * **`live_class_resources`:** `id`, `schedule_id` (FK `ON DELETE CASCADE`), `occurrence_date`, `recording_url` (solo enlace), `slides_material_id` (FK `ON DELETE SET NULL` a `course_materials`), `slides_url`, `slides_title`, `notes`, `updated_by`, `created_at`, `updated_at` (`UNIQUE(schedule_id, occurrence_date)`).

---

## 6. Variables de Entorno (`.env`)

Definidas en el archivo `.env` del proyecto:
* **Cliente (`NEXT_PUBLIC_*`):**
  * `NEXT_PUBLIC_FIREBASE_API_KEY`
  * `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
  * `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
  * `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
  * `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
  * `NEXT_PUBLIC_FIREBASE_APP_ID`
  * `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`
  * *(Opcional)* `NEXT_PUBLIC_ADMIN_EMAIL` (usada en `AuthContext.jsx` y `api/login/route.js` con fallback `'admin@admin.com'`)
* **Servidor (Firebase Admin SDK):**
  * `FIREBASE_PROJECT_ID`
  * `FIREBASE_CLIENT_EMAIL`
  * `FIREBASE_PRIVATE_KEY`
* **Supabase (PostgreSQL Pooler IPv4 + Storage + Realtime):**
  * `NEXT_PUBLIC_SUPABASE_URL`
  * `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  * `SUPABASE_SERVICE_ROLE_KEY` (solo servidor)
  * `DATABASE_URL` (Transaction Pooler `:6543`, compatible IPv4)
  * `DIRECT_URL` (Session Pooler `:5432`, compatible IPv4)

---

## 7. Notas Técnicas y Particularidades del Código

1. **Archivos vacíos (`0 bytes`):** Los archivos `src/app/hooks/useAuth.js`, `src/app/hooks/useCourseAccess.js`, `src/app/utils/roleUtils.js`, `src/lib/courses.js`, `src/lib/users.js`, `src/app/styles/globals.css` y `src/app/styles/themes.css` están actualmente vacíos. **Regla:** importar siempre `useAuth` desde `@/context/AuthContext` y `useTheme` desde `@/context/ThemeContext`.
2. **Dualidad de nombres de campos en `users`:**
   * Los endpoints `/api/login`, `/api/create-user` y `/api/toggle-active` operan con `active` y `rol`.
   * El proveedor `AuthContext.jsx` (cuando autocrea un perfil faltante) y las lecturas de claims usan `isActive` y `role`. Tener en cuenta ambos campos al consultar o actualizar usuarios.
3. **Referencias duplicadas / legacy en `src/lib/db.js`:** `db.js` exporta `liveClassesCollectionRef` (`liveClasses`) y `questionBankCollectionRef` (`questionBank`), mientras que las páginas activas de administración y usuario consultan directamente las colecciones `clasesEnVivo` y `exams`.
4. **Índice `collectionGroup` en Firestore:** El borrado en cascada `deleteFlashcardCompleta` en `src/lib/flashcardServices.js` ejecuta una consulta `collectionGroup(db, 'flashcards_progress')` filtrando por `cardId`. Requiere un índice `COLLECTION_GROUP_ASC` para `flashcards_progress.cardId` en Firestore; si no existe, el `try/catch` captura el error y elimina al menos el documento principal en `flashcards`.
5. **Script `src/scripts/setAdmin.js`:** Referencia `../lib/firebase-adminsdk.json` (archivo de credenciales local no incluido en el repositorio) para asignar el custom claim `{ role: 'admin' }` a `"admin@admin.com"`.
6. **Documentación adicional existente (`docs/`):**
   * `docs/doc.md`: Visión general y seguridad de `ProtectedVideoPlayer`.
   * `docs/docsFase1.md`: Gestión de especialidades/identificadores y validación de imágenes.
   * `docs/docsFase2.md`: Motor SM-2 inicial y reproductor 3D.
   * `docs/DocsFase4.md`: Módulo de Flashcards Premium v2.5 (escala 5 puntos, Active Recall mental, Radiografía de Tarjeta y borrado masivo protegido).

   * `Agent/doc.md`: Registro técnico detallado de lo implementado en Módulo 1 y Módulo 2.

---

## 8. Estado Actual de la Sesión y Handoff para la Próxima IA (2026-11-18)

> **Importante:** El proyecto está **en producción a nivel nacional**. Mantener intactos los dos invariantes críticos: (1) blindaje de `ProtectedVideoPlayer.jsx` para YouTube y (2) lógica de imágenes de Google Drive (`driveUtils.js`, `getDriveImageUrl`, `convertGoogleDriveUrl`, `next.config.js`).

### Lo ya completado y verificado
1. **Conexión Supabase (IPv4 + Producción):** `@supabase/supabase-js` y `pg` instalados; tablas (`course_materials`, `live_class_schedules`, `live_class_exceptions`) y bucket privado `materials` creados en Supabase.
2. **Módulo 1 completo (Fases 1 a 4.B):**
   * `ProtectedVideoPlayer.jsx` y `ContenidoCursos/[courseId]` sin alertas falsas en iPhone y con fullscreen CSS seguro.
   * `/app` optimizado (`video1.mp4` comprimido de 80.8 MB a ~651 KB, `LiveClock` aislado, sin re-renders por scroll ni GPS automático).
   * Flashcards optimizadas (lectura única, `getMasteredCountsMap`, UI optimista en `estudio`).
   * Login rápido y vigencia configurable por usuario en **Hora de Bolivia (`America/La_Paz`, UTC-4)** con auto-desactivación verificada en vivo (`login`, `AuthContext` + `/api/check-expiration`, `/api/users` y UI de edición 5+5 campos adaptable a claro/oscuro).
3. **Módulo 2 implementado (Fases 5 a 7) — Compila limpio (`npm run build` 49/49 rutas), pendiente de pulido UX antes de cerrar el módulo:**
   * APIs `/api/materials/*`, `/api/schedules/*`, `ProtectedDocumentViewer.jsx`, `/admin/materiales`, `/app/materiales`, `/admin/live-classes/*` y calendario semanal `/app/clases-en-vivo`.

### Pendientes Inmediatos para la Siguiente Sesión (Módulo 2 — Pulido UX)
1. **Mejorar `/admin/Cursos_Pago_Unico/new` y `edit/[id]` (`src/app/admin/Cursos_Pago_Unico/CourseForm.jsx`):**
   * **Mantener** todos los campos actuales de enlaces (`imageUrl`, `summaryDriveLink`, `video.driveLink`), ya que son válidos y siguen en uso.
   * **Agregar carga por Drag & Drop de imagen de portada del curso** (por ejemplo subiéndola a Supabase Storage o bucket público/proxy) como alternativa fácil junto al input actual de `imageUrl`.
   * **Agregar editor de nombre/título personalizado y tipo (`pdf` | `slides` | `summary`) para cada PDF o diapositiva subida** (tanto en materiales generales del curso como en materiales por cada video), tanto cuando están en cola (`stagedCourseFiles` al crear en `/new`) como al subir/editar en cursos existentes. Hoy `CourseForm.jsx` toma automáticamente el nombre del archivo sin dejar al admin renombrarlo ni elegir si es diapositiva/resumen/PDF desde ese formulario.
2. **Pruebas funcionales integrales del Módulo 2 en navegador real (Desktop + iPhone):**
   * Verificar flujo completo en `/admin/Cursos_Pago_Unico/new`, `/admin/materiales`, `/app/materiales`, `/app/pagoUnicoCourses/ContenidoCursos/[courseId]` (apertura de PDFs/diapositivas/Drive en `ProtectedDocumentViewer`) y calendario semanal en `/admin/live-classes` ↔ `/app/clases-en-vivo`.
3. **Seguridad y despliegue:**
   * Limpiar/vaciar `Agent/chat.md` (contiene contraseña de BD y `sb_secret_...` en texto plano) y verificar que las 5 variables de Supabase estén cargadas en el entorno de producción (Vercel).

---

## 9. Handoff Actualizado de Sesión (2026-11-18 — Pulido UX, Limpieza Storage y Blindaje de Cuota Firestore)

> **Estado crítico al cerrar esta sesión:** El proyecto Firebase (plan gratuito **Spark**) alcanzó el límite diario de lecturas (`Error: 8 RESOURCE_EXHAUSTED: Quota exceeded.`). La cuota se reinicia automáticamente a la **medianoche PT (`04:00 a.m.` hora Bolivia `UTC-4`)**, o de inmediato si se migra a plan **Blaze**. Mientras tanto, **no ejecutar scripts o pruebas de lectura masiva contra Firestore**.

### 9.1 Cambios Completados y Verificados Recientemente

1. **Clases en Vivo — Grabaciones por enlace y Diapositivas (`002_live_class_resources.sql`):**
   * Grabaciones almacenadas únicamente como URL (`recording_url`) para no saturar BD/Storage; diapositivas con subida a Supabase Storage (`course_materials`) y/o enlace externo (`slides_url`).
   * Pestaña **"Clases pasadas"** integrada en `/admin/live-classes` y `/app/clases-en-vivo`, respaldada por `/api/schedules/[id]/resources` con limpieza garantizada de archivos y registros al eliminar recursos o clases.

2. **Cursos de Pago Único — Borrado Integral, Portada Opcional y Rediseño Admin/Alumno:**
   * `DELETE /api/pago-unico-courses/[id]` + manejo en `src/app/admin/Cursos_Pago_Unico/page.jsx`: al eliminar un curso se purgan su documento en Firestore, materiales (`course_materials`), horarios (`live_class_schedules`) y archivos/portada en Supabase Storage.
   * Endpoints `/api/course-covers` y `/api/course-covers/[file]` para portadas opcionales. Si un curso no tiene portada, tanto `/admin/Cursos_Pago_Unico` como `/app/pagoUnicoCourses` muestran tarjeta limpia sin espacio negro ni peticiones 404 a `/placeholder.png`.
   * Corregido contraste de `<select>` y `<option>` en modo claro/oscuro (`colorScheme` + clases explícitas) y rediseño visual de filtros/tarjetas/tabla en `/admin/Cursos_Pago_Unico`.

3. **Biblioteca de Materiales Escalable (`003_course_materials_indexes.sql`):**
   * Paginación servidor en `/api/materials` y `src/app/admin/materiales/page.jsx`, detección de origen (curso, módulo/video, clase en vivo o biblioteca), borrado múltiple y barra de filtros responsiva (2 filas en móvil sin desbordamiento horizontal).

4. **Contraste de Tarjetas en `/admin/solicitudes-pago-unico`:**
   * Corregida legibilidad de texto e iconos en modo claro (`#1a2639` / `#2E4A70` sobre blanco).

5. **Eliminación Total de Consultas Masivas, Sondeos y `onSnapshot` de Colecciones en Admin y Catálogo:**
   * **Auditoría confirmada:** `0` instancias de `refreshInterval` y `0` listeners `onSnapshot` sobre colecciones en `src/` (solo queda el listener de documento único `users/{uid}` en `src/context/AuthContext.jsx`).
   * **`src/app/admin/flashcards/page.jsx`:** Reemplazado `onSnapshot(collection(db, 'flashcards'))` por paginación por cursor (`25 | 50` por página), `getCountFromServer`, caché de páginas (`pageCacheRef`), paginador con **atajos numéricos + elipsis + salto `Ir a pág.`**, búsqueda global debounced (`450 ms` desde 2+ chars) o **Buscar en BD** con escaneo en lotes (`200`, tope `1200`) y caché por filtro (`searchPoolCacheRef`, encuentra registros fuera de la pág. 1 como el #40 sin reconsultar por tecla), cargas perezosas de subtemas y borrado local optimista.
   * **`src/app/api/users/route.js` + `src/app/admin/users/page.jsx` + `src/app/admin/page.jsx` + `src/app/admin/users/edit/[userId]/page.jsx` + `src/app/api/toggle-active/route.js`:** Eliminado `refreshInterval: 30000` y descargas completas de `users`. `/admin` usa `action=stats` (`3` lecturas agregadas); `/admin/users/edit/[userId]` usa `action=single` (`1` lectura); `/admin/users` usa `action=page` / `action=search` con filtro por estado, buscador debounced con caché, paginador numérico + `Ir a pág.`, tarjetas en móvil (`lg:hidden`), actualización local optimista y banner HTTP `429` ante cuota agotada.
   * **`src/app/components/layout/AdminNavbar.jsx`:** Reemplazados los 2 `onSnapshot` globales de cada página `/admin/*` por `getCountFromServer` (`~2` lecturas) y carga perezosa (`limit(15)`) al abrir la campana.
   * **`src/app/admin/bank-preguntas/page.jsx`:** Reemplazado `onSnapshot(collection(db, 'exams'))` por paginación por cursor (`25 | 50`), filtro por estado, búsqueda con caché, paginador numérico + `Ir a pág.`, actualizaciones locales optimistas y diseño responsivo sin `dark:`.
   * **`src/app/admin/solicitudes-pago-unico/page.jsx`:** Reemplazado `onSnapshot` por paginación por cursor (`24 | 48`), buscador con caché, paginador numérico y borrado local optimista al aprobar/rechazar.
   * **`src/app/admin/solicitudes/page.jsx`:** Corregido bug que reconsultaba ambas colecciones al cambiar `isDark`; ahora usa cargas acotadas (`limit(150)`), botón `Actualizar`, buscador y paginador numérico.
   * **`src/app/admin/Cursos_Pago_Unico/page.jsx`, `CourseForm.jsx` y `src/app/app/pagoUnicoCourses/page.jsx`:** Reemplazados sus `onSnapshot` por `getDocs` puntual al montar (con actualización local optimista al publicar/ocultar/eliminar en admin).

### 9.2 Reglas de Implementación y Puntos Pendientes para el Siguiente Chat

* **Convenciones de código ya establecidas (respetar siempre):**
  1. **Tema claro/oscuro:** Este proyecto usa `ThemeContext` (`isDark`). **No usar** clases `dark:` de Tailwind en nuevas vistas/componentes; estilizar condicionalmente vía `isDark` y aplicar `style={{ colorScheme: isDark ? 'dark' : 'light' }}` + clases explícitas en `<select>` y `<option>`.
  2. **Verificación segura con dev server activo:** Si `npm run dev` está corriendo, **no** ejecutar `npm run build` sobre `.next` (corrompe chunks del servidor en vivo); verificar JSX/JS con `next/dist/build/swc`, ausencia de `\bdark:`, `impeccable detect --json` y peticiones HTTP SSR a `localhost:3000`.
* **Pendientes para seguir puliendo el sistema:**
  1. **Optimizar lecturas del Portal del Estudiante (`/app/*`):** Auditar y acotar `src/app/app/flashcards/page.jsx` (actualmente hace `getDocs(collection(db, 'flashcards'))` completo al montar el dashboard del alumno), `/app/courses` y `/app/examen-test` para que la concurrencia estudiantil consuma el mínimo posible de lecturas Firestore (p. ej. agregaciones `getCountFromServer`, caché en `sessionStorage` / SWR sin revalidación agresiva o consultas acotadas por subtema).
  2. **Migración / Despliegue pendiente:** Subir y redesplegar en producción (Vercel) estos cambios lo antes posible, ya que mientras siga el build anterior desplegado, los clientes conectados seguirán abriendo listeners `onSnapshot`.
  3. **Pruebas funcionales en navegador real tras reinicio de cuota (04:00 a.m. UTC-4 o plan Blaze):** Validar en vivo `/admin/flashcards` (búsqueda de registro #40 + salto de página), `/admin/users`, `/admin/bank-preguntas`, `/admin/solicitudes`, `/admin/solicitudes-pago-unico`, campana de `AdminNavbar`, `/admin/materiales`, `/admin/Cursos_Pago_Unico` y `/app/pagoUnicoCourses`.
  4. **Seguridad:** Vaciar o rotar credenciales expuestas en `Agent/chat.md` y confirmar variables en producción.

---

## 10. Handoff Actualizado de Sesión (2026-11-19 — Materiales, Cursos sin Video, Caché, Perfiles/Usuarios y Modo Oscuro "Midnight Clinical")

> Esta sección complementa la Sección 9 respetando las reglas de ahorro de cuota Firestore y estilizado condicional mediante `ThemeContext` (`isDark`, sin prefijos `dark:` en vistas cliente).

### 10.1 Cambios Completados y Verificados en esta Sesión

1. **Biblioteca de Materiales Estudiantil (`/app/materiales`, `/api/materials` y visor de curso):**
   * Actualizados `src/app/app/materiales/page.jsx`, `src/app/api/materials/route.js`, `src/app/api/materials/file/[id]/route.js` y `src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/page.jsx` para mostrar metadatos de procedencia (curso, módulo, video o clase en vivo), filtros combinados y bloquear en estudiantes el acceso a materiales cuyos cursos estén inactivos en Firestore (`isCourseActiveInFirestore` y validación sobre `Cursos_Pago_Unico`).

2. **Cursos de Pago Único sin Video (Solo PDFs, Diapositivas y/o Resúmenes):**
   * Creado el helper compartido `src/lib/courseCurriculum.js` (`countValidCourseVideos`, `buildCourseCurriculum`) para construir el currículo unificado de videos y documentos por módulo o recursos generales del curso (reubicando automáticamente materiales si se eliminan videos).
   * Integrado en `src/app/admin/Cursos_Pago_Unico/CourseForm.jsx`, `src/app/admin/Cursos_Pago_Unico/page.jsx`, `src/app/admin/Cursos_Pago_Unico/preview/[id]/page.jsx`, `src/app/app/pagoUnicoCourses/page.jsx` y `src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/page.jsx`.

3. **Optimización de BD, Storage y Caché sin Sobrecargas:**
   * **`src/lib/materialBufferCache.js` + `src/app/components/documents/ProtectedDocumentViewer.jsx`:** Caché LRU acotada en memoria de navegador (`MAX_ENTRIES = 8`, `MAX_TOTAL_BYTES = 40 MB`, omite archivos individuales `> 25 MB`) y caché de URLs firmadas (`SIGNED_URL_TTL_MS = 45 min`) para evitar re-descargas al navegar entre documentos o alternar visor inline/pantalla completa.
   * **`src/app/api/materials/route.js` + `src/app/api/materials/file/[id]/route.js`:** Respuestas ligeras al listar materiales (`mapMaterialUrlsLight`, sin firma masiva en Storage); la firma bajo demanda (`?mode=signed_url`) o streaming protegido ocurre únicamente al abrir el archivo.
   * **`src/lib/catalogCache.js`:** TTL del catálogo de cursos (`COURSES_TTL_MS`) ajustado a **3 minutos** (`3 * 60 * 1000` ms) sobre consultas acotadas (`limit(50)`), con deduplicación en vuelo (`inflightPromises`), respaldo en `sessionStorage` y sincronización entre pestañas con `BroadcastChannel('doctemia_catalog_cache_v1')` (`invalidateCatalogCache`), reflejando activaciones/desactivaciones en admin sin polling ni sobrecarga en Firestore.

4. **Rediseño de Perfil del Estudiante (`/app/profile`) y Alta de Usuarios (`/admin/users/create`):**
   * **`src/app/app/profile/page.jsx`:** Tarjeta resumen superior apilada por encima del formulario de edición (sin slot de foto de perfil), mostrando estado de cuenta, plan (`activeDurationMonths`), periodo activo (`activeFrom`/`activeUntil`), vencimiento exacto en Hora Bolivia (`formatDateTimeBolivia`), días restantes con barra de progreso y pestañas separadas para datos personales y cambio de contraseña; eliminadas llamadas redundantes a `refreshUserData`.
   * **`src/app/admin/users/create/page.jsx`:** Rediseño adaptable claro/oscuro con `ThemeContext`, enlace superior `"Volver a Usuarios"`, guía de campos obligatorios (`REQUIRED_FIELDS`), selector interactivo de vigencia (`VALIDITY_OPTIONS`: `1`, `3`, `6`, `12` meses, fecha exacta o sin vencimiento en Hora Bolivia) y toggle de visibilidad de contraseña.

5. **Rediseño del Modo Oscuro ("Midnight Clinical") — Modo Claro Intacto:**
   * **Respaldo de reversión:** Documentado el estado anterior y la guía para revertir (manual o `git checkout`) en `Agent/DarkRever.md`.
   * **Jerarquía de 4 niveles solo en oscuro (`html.dark` / `isDark`):**
     * **Canvas / lienzo base (`--dm-canvas`):** `#060A13`
     * **Chrome — Sidebar y Header (`--dm-chrome`):** `#121E34` con borde (`rgba(148, 163, 184, 0.22)` / `0.24`), sombra direccional (`8px 0 32px rgba(0, 0, 0, 0.55)` en sidebar, `0 4px 24px rgba(0, 0, 0, 0.50)` en header) y filo sutil cian (`rgba(56, 214, 224, 0.10)` / `0.08`) para separar nítidamente la navegación del fondo.
     * **Tarjetas principales (`--dm-surface`):** `#152238`; **superficies internas / `.bg-slate-900` (`--dm-surface-inset`):** `#0A111F`; **elementos elevados / hovers (`--dm-surface-elevated`):** `#1C2C47`.
   * **Archivos modificados en este rediseño:** `src/app/globals.css`, `src/app/layout.js` (`themeColor` oscuro `#121E34` y `body dark:bg-[#060A13]`), `src/app/admin/layout.jsx`, `src/app/components/layout/NavbarUser.jsx`, `src/app/components/layout/AdminNavbar.jsx` y `src/app/app/page.jsx`.

### 10.2 Verificación de Cierre (2026-11-19)

* **Compilación JSX (`next/dist/build/swc`) y prefijos `dark:`:** `src/app/layout.js`, `src/app/admin/layout.jsx`, `src/app/components/layout/NavbarUser.jsx`, `src/app/components/layout/AdminNavbar.jsx` y `src/app/app/page.jsx` compilaron sin errores (`darkMatches=0` en los 4 archivos con `ThemeContext`; `layout.js` mantiene `dark:` únicamente en `<body>`).
* **CSS y servidor local (`http://localhost:3000`):** `src/app/globals.css` validado con llaves balanceadas (`32`/`32`), chunk `/_next/static/chunks/src_app_globals_0p2ml0n.css` compilando `#060a13` y `#121e34`, y rutas `/app`, `/app/pagoUnicoCourses`, `/app/materiales`, `/app/profile`, `/admin` y `/admin/users/create` respondiendo HTTP `200`.
* **Auditoría UI (`npx impeccable detect --json`):** `[]` sobre `NavbarUser.jsx`, `AdminNavbar.jsx`, `admin/layout.jsx` y `app/page.jsx`.

### 10.3 Pendientes para Retomar

1. **Pruebas visuales e interactivas en navegador real (Desktop y móvil):** Validar el nuevo modo oscuro **Midnight Clinical** en el resto de vistas (`/app/flashcards`, `/app/examen-test`, `/app/clases-en-vivo`, `/admin/materiales`, `/admin/Cursos_Pago_Unico`), además del flujo de cursos sin video, `/app/profile`, `/admin/users/create` y la actualización de catálogo tras los `3` minutos de TTL en `catalogCache.js`.
2. **Mantener pendientes previos de `9.2`:** Auditar lecturas Firestore en `/app/flashcards/page.jsx`, `/app/courses` y `/app/examen-test`; limpiar credenciales en `Agent/chat.md`; y redesplegar en producción (Vercel).

---

## 11. Handoff de Sesión (2026-11-19 — Tarde: Protección `/app/materiales`, Buscador `/admin/users`, Avatares WebP y Fluidez de Navegación)

> Complemento directo a la Sección 10 con todo lo implementado y verificado en esta sesión (respetando `ThemeContext` con `isDark` sin `dark:` de Tailwind, ahorro de lecturas Firestore y blindaje intacto de videos en `ProtectedVideoPlayer.jsx`).

### 11.1 Cambios Implementados

1. **Protección de Acceso a Cursos Pago Único en `/app/materiales`:**
   * **`src/app/components/access/PagoUnicoAccessDenied.jsx` (nuevo):** Componente reutilizable para pantalla de acceso restringido con flujo QR, WhatsApp y envío de solicitud a `pagoUnico_solicitudes`.
   * **`src/app/app/materiales/page.jsx`, `src/app/api/materials/[id]/route.js` y `src/app/admin/solicitudes-pago-unico/page.jsx`:** Homologado el bloqueo de acceso cuando `!user.hasPagoUnicoAccess` tanto en la vista estudiantil como en la API por ID, y enlazado en la gestión administrativa de solicitudes.

2. **Buscador Multi-Página en `/admin/users` sin Sobrecargar Firestore:**
   * **`src/lib/usersSearchCache.js` (nuevo) + `src/app/api/users/route.js` + `src/app/admin/users/page.jsx`:** Solucionada la búsqueda de usuarios ubicados en páginas distintas a la visible manteniendo la paginación por pestañas (`25 | 50` por página), con escaneo acotado y caché en memoria del servidor (`90 s`) e invalidación automática al crear, editar, activar/desactivar, editar en lote o eliminar usuarios (`src/app/api/{create-user,delete-user,toggle-active,users/update,users/bulk-update}/route.js`).

3. **Avatares de Perfil Optimizados por Tema (`galloclaro` / `gallooscuro`) y Limpieza de Imagen Legada:**
   * **Assets WebP ligeros (`128×128`, transparencia preservada vía `sharp`):**
     * `public/images/galloclaro-avatar.webp` (**`6,914 B`**, reducción del `98.60%` desde `495,608 B` de `public/images/galloclaro.png`).
     * `public/images/gallooscuro-avatar.webp` (**`6,584 B`**, reducción del `99.29%` desde `924,750 B` de `public/images/gallooscuro.png`).
     * *(Los PNG originales permanecen intactos en `public/images/`).*
   * **`src/app/components/layout/NavbarProfileAvatar.jsx` (nuevo), `NavbarUser.jsx` y `AdminNavbar.jsx`:** Avatar compartido sensible a `isDark` enlazando a `/app/profile` y `/admin/profile` (con `alt=""` y `aria-label="Ir a mi perfil"` en `<Link>`, separando los botones `Cerrar sesión` fuera de `<Link>` en `AdminNavbar.jsx` y retirando `convertGoogleDriveUrl` no usado allí).
   * **`src/app/admin/profile/page.jsx` y `src/context/AuthContext.jsx`:** Interceptado el valor legado `/icons/user.jpg` (imagen del gato) y `/icons/user.png` para mostrar en la vista previa, carga inicial y botón **"Usar por Defecto"** el avatar optimizado acorde a `isDark`, actualizando también el fallback de autocreación de perfil en `AuthContext.jsx` a `/images/galloclaro-avatar.webp`.

4. **Optimización de Fluidez de Navegación, Botón "Ver Contenido" y Consultas a BD (Plan registrado en `Agent/plan.md`):**
   * **Caché de curso individual y materiales por curso (`src/lib/catalogCache.js` y `src/app/api/materials/route.js`):**
     * Agregados `peekCachedPagoUnicoCourseById`, `getCachedPagoUnicoCourseById`, `peekCachedCourseMaterials` y `getCachedCourseMaterials` (`TTL = 3 min`, deduplicando peticiones en vuelo) para reutilizar en el visor el curso ya descargado por el catálogo (`0 lecturas` extra a Firestore).
     * Agregada caché en memoria del servidor `courseActiveCache` (`TTL = 60 s`, máx. `300` entradas) en `src/app/api/materials/route.js` usada por `isCourseActiveInFirestore` y `filterMaterialsByActiveCourses`.
   * **Respuesta inmediata en `/app/pagoUnicoCourses` (`src/app/app/pagoUnicoCourses/page.jsx`):**
     * Botón **"Ver Contenido"** (Grid y Lista) convertido en `<Link prefetch={true}>` con estado inmediato `openingCourseId` (spinner + `"Abriendo curso..."`) y pre-calentamiento de materiales (`onMouseEnter` / `onFocus` / `onTouchStart`).
     * Botón **"Marcar Completado"** optimizado con estado optimista inmediato (`optimisticOverrides` + `togglingCourseId`) y reversión automática ante error.
   * **Apertura instantánea sin bloqueo en curso (`src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/page.jsx` y `src/app/app/materiales/page.jsx`):**
     * Hidratación síncrona inicial con `peekCachedPagoUnicoCourseById` y `peekCachedCourseMaterials`, cargando adjuntos en segundo plano (`"Adjuntos..."`) sin bloquear el reproductor de video.
     * **"Volver al Catálogo"** convertido en `<Link href="/app/pagoUnicoCourses" prefetch={true}>`.
     * Carga diferida (`next/dynamic`, `ssr: false`) únicamente para `ProtectedDocumentViewer`.
     * **Blindaje de video intacto:** `src/app/components/video/ProtectedVideoPlayer.jsx`, `src/lib/youtubeUtils.js` y los listeners de seguridad de página (`keydown`, `contextmenu`, `selectstart`, `dragstart`) no fueron alterados.
   * **Fluidez global en sidebars, Flashcards y transiciones:**
     * `NavbarUser.jsx` y `AdminNavbar.jsx`: estado optimista `pendingHref` con spinner al pulsar enlaces y cierre automático del drawer en móvil.
     * `src/app/app/flashcards/page.jsx`: `router.prefetch('/app/flashcards/estudio')` y feedback inmediato `openingSubtheme` (`"Abriendo..."`) en tarjetas de subtemas.
     * Esqueletos `loading.jsx` adaptados a `isDark`: `src/app/app/loading.jsx`, `src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/loading.jsx` y `src/app/admin/loading.jsx`.

### 11.2 Estado de Verificación al Cerrar la Sesión

* **Verificación estática y de compilación (aprobada tras la última edición):**
  * **Compilación SWC (`next/dist/build/swc`) + regla de tema:** Todos los archivos creados/modificados en cada bloque compilaron sin errores y con **`0` ocurrencias de `dark:`**.
  * **Resolución de imports/exports:** Los `11` archivos de la optimización de navegación pasaron sin errores de rutas ni exportaciones faltantes en `catalogCache.js`.
  * **Auditoría UI (`npx impeccable detect --json`):** Resultado `[]` en todas las vistas/componentes de interfaz modificados y en los 3 `loading.jsx` nuevos.
  * **Integridad de protección de video:** Confirmado sin modificaciones recientes en `ProtectedVideoPlayer.jsx` ni `youtubeUtils.js` (fechas de modificación `11/18/2026`).
* **Verificación HTTP en servidor local (`http://localhost:3000`):**
  * Los bloques de `/app/materiales`, `/admin/users`, avatares WebP y `/admin/profile` respondieron HTTP `200` en vivo antes de la última tanda de fluidez.
  * Tras la tanda de fluidez de navegación + esqueletos `loading.jsx`, el proceso `node.exe` del puerto `3000` (`PID 19888`) quedó bloqueado con timeout sin devolver bytes incluso en `/login` (ruta no tocada).

### 11.3 Próximos Pasos al Retomar

1. **Reiniciar `npm run dev`** en la terminal para limpiar el proceso colgado en el puerto `3000` (`PID 19888`) y probar en navegador real:
   * `/app/pagoUnicoCourses` → hover/clic en **"Ver Contenido"** (spinner `"Abriendo curso..."` + apertura inmediata del curso y verificación visual de que `ProtectedVideoPlayer` mantiene el bloqueo de enlaces de YouTube) + **"Marcar Completado"** optimista.
   * Navegación lateral en móvil/desktop (`NavbarUser` / `AdminNavbar`), `/app/flashcards` → estudio, y `/admin/profile` (sin rastro de `/icons/user.jpg`).
2. **Confirmar preferencia de texto en sidebar:** Validar con el usuario si desea conservar u ocultar `{adminName}` y el botón rojo `Cerrar sesión` al pie del sidebar en `AdminNavbar.jsx` (ya que en desktop también están en el header) o el enlace `Mi Perfil` en `NavbarUser.jsx`.
3. **Mantener pendientes previos:** Revisión en navegador del modo oscuro **Midnight Clinical**, limpieza de `Agent/chat.md` y despliegue a producción (Vercel).

---

## 12. Handoff de Sesión (2026-11-20 — Auditoría de Pendientes, Optimización Integral de Flashcards y Preparación Vercel/Supabase)

### 12.1 Revisión de Pendientes Previos (`8`, `9.2`, `10.3`)
* Al auditar el repositorio clonado (`victor30700/doctemia-mc`), se verificó que varios puntos listados en secciones anteriores ya estaban implementados en el código:
  * `CourseForm.jsx` ya cuenta con subida de portada (`coverInputRef`) y selector `material_type` por material.
  * `/app/courses/page.jsx` ya aplica `limit(50)` en `courses`/`solicitudes` y `getCachedContactInfo()`.
  * `/app/examen-test/page.jsx` ya utiliza `getCountFromServer`, paginación por cursor (`DEFAULT_PAGE_SIZE = 6`), `limit(100)` en `examAttempts` y caché de pool en `sessionStorage` (`5 min`).
  * `/app/flashcards/page.jsx` ya había reemplazado `getDocs(collection(db, 'flashcards'))` por `getCategoryFlashcardCounts` y `getSubthemeFlashcardCounts` (`getCountFromServer`).
  * `Agent/chat.md` ya no contiene credenciales expuestas (`Agent/chat.txt` temporal contiene solo las 2 claves públicas del nuevo proyecto Supabase; eliminar antes de hacer `git push`).

### 12.2 Optimizaciones y Correcciones Implementadas en Flashcards
1. **`src/lib/catalogCache.js`:**
   * Agregados `peekCachedCategories()` y `peekCachedSubcategories(catId)` para hidratación síncrona (`0 ms`) sin lecturas redundantes a Firestore.
2. **`src/lib/flashcardServices.js`:**
   * Agregada deduplicación en vuelo (`withFcDedupe`), canal entre pestañas `BroadcastChannel('doctemia_fc_cache_v1')` (`invalidateFlashcardCache`), serialización segura de fechas ISO (`toIsoTimestamp`) y control de escrituras en vuelo (`pendingProgressWrites` / `waitForPendingProgressWrites`).
   * Caché de métricas (`getFlashcardMetrics`, `peekCachedFlashcardMetrics`, `METRICS_TTL_MS = 5 min`) y progreso por subtema (`getCachedSubtemaProgressMap`, `SUBTEMA_PROG_TTL_MS = 3 min`) con invalidación automática en `saveFlashcardProgress`, `restoreMasteredFlashcards` y `deleteFlashcardCompleta`.
   * Agregados `peekDueFlashcards`, `peekCachedCategoryFlashcardCounts`, `peekCachedSubthemeFlashcardCounts` y `prefetchSubthemeStudy` para precalentamiento al pasar el cursor / tocar un subtema y apertura instantánea en `/app/flashcards/estudio`.
3. **`src/app/app/flashcards/page.jsx`:**
   * Hidratación síncrona desde caché al montar/regresar, eliminación de imports sin uso de `firestore`, protección ante `authLoading || !user` antes de evaluar `user.hasPagoUnicoAccess`, precalentamiento de ruta y datos (`prewarmSubtheme` en `onMouseEnter`/`onFocus`/`onTouchStart`), y adaptación de `AccessDeniedScreen` a `isDark` (sin prefijos `dark:`).
4. **`src/app/app/flashcards/estudio/page.jsx` y `src/app/app/flashcards/estudio/loading.jsx` (nuevo):**
   * Hidratación síncrona inicial con `peekDueFlashcards` cuando el subtema ya fue precalentado/cacheado + esqueleto `loading.jsx` adaptado a `isDark`.
   * Corregido bug en modo `review_weakness` donde `subtema` era `null` y sobrescribía `subtemaName` a `'General'` al guardar (`subtema || card.subtema || card.userProgress?.subtemaName || 'General'`).
   * Convertido `handleMarkAsMastered` (*"Ya domino esto"*) a actualización optimista tras confirmar en el modal.
5. **`src/app/admin/flashcards/new/page.jsx` y `src/app/admin/flashcards/edit/[id]/page.jsx`:**
   * Invocan `invalidateFlashcardCache()` tras crear o editar una tarjeta.

### 12.3 Verificación Técnica Ejecutada
* **Invariantes intactos (`git diff --exit-code`):** `0` cambios en `ProtectedVideoPlayer.jsx`, `youtubeUtils.js`, `driveUtils.js` y `next.config.js`.
* **SWC (`next/dist/build/swc`) + regla de tema:** `7/7` archivos compilados (`SWC=OK`, `darkMatches=0`).
* **Auditoría UI (`impeccable detect --json`):** `[]` en `flashcards/page.jsx`, `flashcards/estudio/page.jsx` y `flashcards/estudio/loading.jsx`.
* **Build de producción (`next build`, Next.js 16.2.1 Turbopack):** compilado completo con **54/54** rutas generadas (ejecutado con variables de entorno temporales en memoria para validar bundling, ya que este clon aún no posee `.env` en disco).
* **Nota ESLint:** `eslint` (`9.39.4`) reporta error preexistente de `FlatCompat` (`Converting circular structure to JSON`) en `eslint.config.mjs`.

### 12.4 Estado de Producción (GitHub + Vercel)
1. Eliminado `Agent/chat.txt` tras verificar en vivo las 5 variables del nuevo Supabase (`xjbwtxixlrqbigsptliw`, bucket `materials` y 4 tablas) y subido commit `656487c` a `victor30700/doctemia-mc` (`main`).

### 12.5 Corrección de Condición de Carrera al Iniciar Sesión (Admin y Estudiantes)
* **Causa raíz:** al iniciar sesión en `src/app/login/page.jsx`, `onAuthStateChanged` en `src/context/AuthContext.jsx` recibía `fbUser` sin restablecer `loading = true` de forma síncrona mientras resolvía `getIdTokenResult` y el primer `onSnapshot(users/{uid})`. Al navegar inmediatamente a `/admin`, `src/app/admin/layout.jsx` evaluaba `!loading && !user`, disparaba `/api/logout` (borrando `__session` y `role`) y devolvía al usuario a `/login`.
* **Cambios aplicados y verificados:**
  * `src/context/AuthContext.jsx`: establece `setLoading(true)` de forma síncrona al detectar `fbUser`, incorpora control de secuencia (`authEventSeq`) e `isMounted`, y bloquea `onIdTokenChanged` durante `signOut` (`isSigningOutRef`).
  * `src/app/admin/layout.jsx` y `src/app/app/layout.jsx`: verifican `!firebaseAuthUser` antes de limpiar sesión y añaden cancelación en el `useEffect` para evitar redirecciones/logouts tardíos.
  * `src/app/login/page.jsx`: usa `user.getIdToken()` y guarda `__doctemia_synced_id_token` antes de `POST /api/login` para evitar envíos duplicados desde `onIdTokenChanged`.
  * **Verificación:** `4/4` archivos compilados con SWC (`SWC=OK`, `darkMatches=0`), `impeccable detect --json` `[]`, y `next build` (`54/54` rutas) exitoso.
