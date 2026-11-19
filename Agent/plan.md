# Plan de Trabajo: Optimización de Fluidez de Navegación, Respuesta Instantánea de Botones ("Ver Contenido") y Consultas a Base de Datos

**Proyecto:** Doctemia MC (`sistema-med`)  
**Contexto técnico:** [contex.md](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/Agent/contex.md)  
**Fecha:** 2026-11-19  
**Estado:** ✅ **IMPLEMENTADO Y VERIFICADO (Fases 1 a 4 — 11/11 archivos compilados con SWC)**

---

## 🎯 1. Objetivo Principal

Lograr una experiencia de navegación **instantánea y fluida (`< 16 ms` de respuesta visual al clic)** en toda la plataforma —especialmente al presionar **"Ver Contenido"** en `http://localhost:3000/app/pagoUnicoCourses`, cambiar de módulo en el sidebar o abrir sesiones de estudio en Flashcards—, **reduciendo al mínimo las consultas a Firestore y Supabase PostgreSQL** y **conservando al 100% el blindaje anti-copia de enlaces de YouTube en los videos**.

---

## 🔒 2. Invariantes Intocables de Seguridad y Base de Datos

### 2.1 Blindaje Total de Protección de Videos (Prohibido Alterar o Debilitar)
1. **[src/app/components/video/ProtectedVideoPlayer.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/components/video/ProtectedVideoPlayer.jsx) y [src/lib/youtubeUtils.js](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/lib/youtubeUtils.js) NO SE MODIFICAN (`0` cambios):**
   * Permanece intacto el escudo superpuesto que bloquea cualquier interacción directa con el iframe de YouTube (imposibilitando hacer clic en el título, logo de YouTube, *"Mirar en YouTube"* o copiar la URL del video).
   * Permanecen intactos los controles propios del reproductor (Play/Pausa, barra de progreso propia, volumen, velocidad `0.75x–2x`, pantalla completa nativa y CSS fallback en móviles iOS/Android).
   * Permanece intacta la sanitización `cleanYouTubeUrl(url)` y los parámetros `controls: 0, modestbranding: 1, rel: 0, disablekb: 1, fs: 0, iv_load_policy: 3`.
2. **Protecciones de página en [src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/page.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/pagoUnicoCourses/ContenidoCursos/%5BcourseId%5D/page.jsx#L59-L110) intactas:**
   * Se mantienen al 100% los listeners de bloqueo de inspección (`F12`, `Ctrl+Shift+I`, `Ctrl+Shift+C`, `Ctrl+U`), bloqueo de clic derecho (`contextmenu`), bloqueo de selección de texto (`selectstart`) y arrastre (`dragstart`).
   * `ProtectedVideoPlayer` se mantiene con importación directa para que el reproductor protegido monte al instante sin alterar su ciclo de vida.

### 2.2 Optimización Estricta de Consultas a Base de Datos (Firestore + Supabase)
1. **Cero re-lecturas de Firestore al abrir un curso desde `/app/pagoUnicoCourses`:**
   * Como `/app/pagoUnicoCourses` ya descargó los cursos activos mediante `getCachedPagoUnicoCourses({ onlyActive: true })` (`limit(50)`), abrir `/app/pagoUnicoCourses/ContenidoCursos/[courseId]` debe hidratar el curso directamente desde `catalogCache` (**`0 lecturas` a Firestore**).
   * Solo si un estudiante entra por URL directa con la caché vacía se ejecutará `1 getDoc` puntual a `Cursos_Pago_Unico/{courseId}` y se guardará en caché.
2. **Caché de materiales por curso (`course_id`) en cliente y servidor:**
   * En el cliente (`src/lib/catalogCache.js`): cachear la respuesta de `/api/materials?course_id=...` en memoria y `sessionStorage` (TTL `3 minutos`, deduplicando peticiones en vuelo) para que entrar, volver al catálogo y reabrir un curso consuma **`0` peticiones repetidas a Supabase y Firestore**.
   * En el servidor (`src/app/api/materials/route.js`): cachear en memoria por `60 segundos` la verificación `isCourseActiveInFirestore(courseId)` para evitar una lectura a Firestore en cada consulta de materiales del mismo curso.
3. **Respeto absoluto a las reglas de proyecto:**
   * No usar clases `dark:` de Tailwind (usar exclusivamente `isDark` de `useTheme` y `colorScheme: isDark ? 'dark' : 'light'` en `<select>`/`<option>`).
   * No ejecutar `npm run build` mientras el servidor de desarrollo (`localhost:3000`) esté activo (verificar con `next/dist/build/swc`, `npx impeccable detect --json` y pruebas HTTP contra `localhost:3000`).

---

## 🔍 3. Diagnóstico de Cuellos de Botella Detectados

| # | Ubicación | Problema Actual | Impacto en Usuario y BD | Solución Planificada |
| :- | :--- | :--- | :--- | :--- |
| **1** | [src/app/app/pagoUnicoCourses/page.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/pagoUnicoCourses/page.jsx#L433-L440) ([#L530-L537](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/pagoUnicoCourses/page.jsx#L530-L537), [#L673-L675](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/pagoUnicoCourses/page.jsx#L673-L675)) | El botón **"Ver Contenido"** es un `<button onClick={() => router.push(...)}>` sin `<Link>` (no hace prefetch de la ruta) y sin estado `openingCourseId`. | El usuario presiona el botón y no ocurre ningún cambio visual mientras Next.js descarga el chunk de la vista del curso, provocando múltiples clics e incertidumbre. | Convertir en `<Link prefetch={true}>` con estado inmediato `openingCourseId` (spinner + texto `"Abriendo curso..."`) y pre-calentamiento de materiales al pasar el cursor/tocar la tarjeta. |
| **2** | [src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/page.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/pagoUnicoCourses/ContenidoCursos/%5BcourseId%5D/page.jsx#L139-L161) ([#L275](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/pagoUnicoCourses/ContenidoCursos/%5BcourseId%5D/page.jsx#L275)) | Ignora el curso ya guardado en `catalogCache` y bloquea toda la pantalla en `"Cargando..."` esperando `Promise.all([getDoc(courseDocRef), fetch('/api/materials?course_id=...')])`. | **+1 lectura redundante a Firestore** en cada clic y **600–1500 ms de pantalla en blanco** esperando a Supabase antes de mostrar el título, los módulos y el video. | Hidratación síncrona en **`0 ms`** con `peekCachedPagoUnicoCourseById(courseId)` (`0 lecturas` a Firestore) y carga desacoplada de materiales con `getCachedCourseMaterials(courseId)` sin bloquear el reproductor de video. |
| **3** | [src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/page.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/pagoUnicoCourses/ContenidoCursos/%5BcourseId%5D/page.jsx#L11)<br>[src/app/app/materiales/page.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/materiales/page.jsx#L7) | Importan `ProtectedDocumentViewer` (y con él `PdfCanvasReader`) de forma estática en el bundle inicial de la página. | Mayor peso de JavaScript a descargar y compilar antes de abrir el curso, aunque la primera clase sea un video. | Cargar `ProtectedDocumentViewer` con `next/dynamic(..., { ssr: false })` (igual que en `clases-en-vivo/page.jsx`), dejando `ProtectedVideoPlayer` intacto. |
| **4** | [src/app/api/materials/route.js](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/api/materials/route.js#L42-L70) ([#L112-L114](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/api/materials/route.js#L112-L114)) | `isCourseActiveInFirestore(courseId)` y `filterMaterialsByActiveCourses` consultan Firestore en cada llamada HTTP sin caché corta en el servidor. | Lecturas repetidas a `Cursos_Pago_Unico/{courseId}` en el backend y mayor latencia en `/api/materials`. | Añadir caché en memoria del servidor (`TTL = 60 s`) por `courseId` para validar `isActive` con `0 lecturas` en peticiones consecutivas. |
| **5** | [src/app/app/pagoUnicoCourses/page.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/pagoUnicoCourses/page.jsx#L645-L671) | El botón **"Marcar Completado"** espera `await updateDoc(...)` en Firestore sin actualización optimista ni estado de carga por tarjeta. | El botón tarda en cambiar de estado tras el clic. | Estado optimista inmediato en UI + `togglingCourseId` por tarjeta (`0 lecturas` adicionales). |
| **6** | [src/app/app/flashcards/page.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/flashcards/page.jsx#L440-L442) ([#L855-L888](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/flashcards/page.jsx#L855-L888)) | Las tarjetas de subtemas usan `<div onClick={() => startStudy(sub.name)}>` con `router.push` sin prefetch ni indicador de carga al pulsar **"Estudiar"**. | Al tocar un subtema no hay feedback visual hasta que termina de montar `/app/flashcards/estudio`. | Añadir `router.prefetch('/app/flashcards/estudio')` al montar y estado `openingSubtheme` con spinner `"Abriendo..."` en la tarjeta seleccionada. |
| **7** | [src/app/components/layout/NavbarUser.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/components/layout/NavbarUser.jsx#L257-L291)<br>[src/app/components/layout/AdminNavbar.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/components/layout/AdminNavbar.jsx#L312-L315) | Los enlaces de los sidebars no muestran estado activo optimista (`pendingHref`) al hacer clic ni cierran automáticamente el drawer en móvil. | En móvil el sidebar queda tapando la pantalla tras pulsar un enlace y en desktop no se percibe transición inmediata hasta que carga la ruta destino. | Añadir `pendingHref` con resaltado inmediato + spinner sutil en el ítem pulsado, cierre automático en móvil (`if (isMobile) setIsSidebarOpen(false)`) y esqueletos `loading.jsx` en `/app` y `/admin`. |

---

## 🛠️ 4. Plan de Implementación por Fases

### Fase 1: Caché de Curso por ID y Materiales por Curso (`0 Lecturas Redundantes`)
* **Archivos a intervenir:**
  * [src/lib/catalogCache.js](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/lib/catalogCache.js)
  * [src/app/api/materials/route.js](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/api/materials/route.js)
* **Acciones:**
  1. En `src/lib/catalogCache.js`:
     * Agregar `peekCachedPagoUnicoCourseById(courseId)`: busca de forma **síncrona (`0 ms`)** el curso dentro de las listas cacheadas (`pu_courses_active` / `pu_courses_all`) o en la entrada individual `pu_course_${courseId}` en `memoryCache` / `sessionStorage`.
     * Agregar `getCachedPagoUnicoCourseById(courseId, { forceRefresh = false })`: si `peekCachedPagoUnicoCourseById(courseId)` existe y no se fuerza refresco, lo retorna de inmediato con **`0 lecturas` a Firestore**. Solo si no está en caché ejecuta `getDoc(doc(db, 'Cursos_Pago_Unico', courseId))` (1 lectura puntual) y lo guarda en `pu_course_${courseId}` (`TTL = 3 min`).
     * Agregar `getCachedCourseMaterials(courseId, getTokenFn, { forceRefresh = false })`: usa `withDedupe('course_materials_' + courseId, COURSES_TTL_MS, ...)` para cachear en memoria y `sessionStorage` los materiales adjuntos del curso consultados en `/api/materials?course_id=${courseId}`. Cuando el admin crea/edita/elimina materiales o se llama a `invalidateCatalogCache()`, esta caché se limpia automáticamente via `BroadcastChannel`.
  2. En `src/app/api/materials/route.js`:
     * Agregar un `Map` en memoria del servidor (`courseActiveCache`, `TTL = 60_000 ms`) utilizado por `isCourseActiveInFirestore(courseId)` y `filterMaterialsByActiveCourses(rows)`, más invalidación al modificar materiales, evitando golpear Firestore repetidamente por el mismo `course_id`.

### Fase 2: Respuesta Instantánea en `/app/pagoUnicoCourses` ("Ver Contenido" y "Marcar Completado")
* **Archivo a intervenir:**
  * [src/app/app/pagoUnicoCourses/page.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/pagoUnicoCourses/page.jsx)
* **Acciones:**
  1. **Botón "Ver Contenido" con `<Link>`, Prefetch y Feedback Inmediato (`openingCourseId`):**
     * Reemplazar el `<button onClick={() => onViewContent(course.id)}>` en `CourseCard` (tanto en modo `list` como en modo `grid`) por `<Link href={`/app/pagoUnicoCourses/ContenidoCursos/${course.id}`} prefetch={true}>`.
     * Al hacer clic en **"Ver Contenido"**, activar `setOpeningCourseId(course.id)` para que el botón cambie en `< 16 ms` a estado ocupado (`Loader2` girando + texto **"Abriendo curso..."** + `pointer-events-none opacity-90`), confirmando visualmente al estudiante que su clic fue recibido.
     * Al hacer `onMouseEnter` o `onFocus` sobre el botón **"Ver Contenido"**, disparar en segundo plano `getCachedCourseMaterials(course.id)` para que los materiales ya estén en caché cuando termine la transición de ruta.
  2. **Botón "Marcar Completado" Optimista (`togglingCourseId`):**
     * Añadir estado `optimisticCompleted` y `togglingCourseId` para que el check de **"Completado"** cambie al instante del clic sin esperar el round-trip de `updateDoc` a Firestore, mostrando un indicador sutil mientras sincroniza y revirtiendo solo si ocurre un error.

### Fase 3: Apertura Instantánea en `/app/pagoUnicoCourses/ContenidoCursos/[courseId]` (Sin Tocar `ProtectedVideoPlayer`)
* **Archivos a intervenir:**
  * [src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/page.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/pagoUnicoCourses/ContenidoCursos/%5BcourseId%5D/page.jsx)
  * [src/app/app/materiales/page.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/materiales/page.jsx)
* **Acciones:**
  1. **Hidratación síncrona del curso desde `catalogCache`:**
     * Inicializar `courseDetails` con `() => peekCachedPagoUnicoCourseById(courseId)` y `loading` con `() => !peekCachedPagoUnicoCourseById(courseId)`.
     * Cuando el alumno viene de `/app/pagoUnicoCourses`, el curso ya está en memoria: **no aparece la pantalla de bloqueo `"Cargando..."`** y se renderizan en el primer frame el título del curso, la lista de módulos y el reproductor `<ProtectedVideoPlayer />` del primer video.
  2. **Carga desacoplada de materiales adjuntos con caché:**
     * En lugar de bloquear el renderizado del curso con `Promise.all([getDoc, fetchMaterials])`, cargar los materiales con `getCachedCourseMaterials(courseId, () => firebaseAuthUser?.getIdToken?.())`. Si ya fueron pre-cargados en el hover/clic del catálogo, están disponibles en `0 ms`; si aún están cargando, el video y los módulos ya son interactivos y se muestra un indicador ligero *"Sincronizando materiales adjuntos..."* en la barra lateral del temario.
  3. **Carga diferida (`next/dynamic`) únicamente para `ProtectedDocumentViewer`:**
     * Cambiar la importación estática de `ProtectedDocumentViewer` a `dynamic(() => import('@/app/components/documents/ProtectedDocumentViewer'), { ssr: false })` en `ContenidoCursos/[courseId]/page.jsx` y `src/app/app/materiales/page.jsx`.
     * **Invariante verificado:** `ProtectedVideoPlayer` y todas las medidas de seguridad de página (`keydown`, `contextmenu`, `selectstart`, `dragstart`, `cleanYouTubeUrl`) permanecen **exactamente iguales**.
  4. **Botón "Volver al Catálogo" instantáneo:**
     * Convertir el `<button onClick={() => router.push('/app/pagoUnicoCourses')}>` en `<Link href="/app/pagoUnicoCourses" prefetch={true}>` para retorno inmediato desde caché (`0 lecturas`).

### Fase 4: Fluidez Global de Navegación (Sidebars, Flashcards y Esqueletos `loading.jsx`)
* **Archivos a intervenir / crear:**
  * [src/app/components/layout/NavbarUser.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/components/layout/NavbarUser.jsx)
  * [src/app/components/layout/AdminNavbar.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/components/layout/AdminNavbar.jsx)
  * [src/app/app/flashcards/page.jsx](file:///C:/Users/ASUS%20ROG%20STRRIX%2017/OneDrive/Escritorio/Sitemas/sistema-med/src/app/app/flashcards/page.jsx)
  * `src/app/app/loading.jsx` *(nuevo)*
  * `src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/loading.jsx` *(nuevo)*
  * `src/app/admin/loading.jsx` *(nuevo)*
* **Acciones:**
  1. **Resaltado optimista (`pendingHref`) y cierre en móvil en `NavbarUser.jsx` y `AdminNavbar.jsx`:**
     * Al hacer clic en cualquier enlace del sidebar o perfil, registrar `setPendingHref(item.href)` (limpiándolo automáticamente cuando `pathname` cambia) para que el botón seleccionado se ilumine en `< 16 ms` y muestre un indicador sutil de transición.
     * En dispositivos móviles (`isMobile`), cerrar automáticamente el drawer lateral al pulsar cualquier enlace de navegación.
  2. **Feedback inmediato al abrir un subtema en `/app/flashcards/page.jsx`:**
     * Ejecutar `router.prefetch('/app/flashcards/estudio')` al montar el dashboard de Flashcards.
     * Añadir estado `openingSubtheme` en `startStudy(sub.name)` para que la tarjeta del subtema pulsado muestre al instante un spinner `Loader2` con el badge **"Abriendo..."**, evitando clics duplicados.
  3. **Esqueletos `loading.jsx` de transición instantánea en App Router:**
     * Crear `src/app/app/loading.jsx`, `src/app/app/pagoUnicoCourses/ContenidoCursos/[courseId]/loading.jsx` y `src/app/admin/loading.jsx` adaptados a `isDark` (`useTheme`), garantizando que cualquier cambio de ruta por primera vez muestre retroalimentación visual inmediata.

---

## ✅ 5. Protocolo de Verificación y Criterios de Aceptación

1. **Verificación de Blindaje de Videos (Cero Regresión):**
   * Confirmar con `git diff src/app/components/video/ProtectedVideoPlayer.jsx src/lib/youtubeUtils.js` que ambos archivos tienen **`0` líneas modificadas**.
   * Confirmar que en `ContenidoCursos/[courseId]/page.jsx` siguen activos los bloqueos de `F12`, `Ctrl+Shift+I/C`, `Ctrl+U`, `contextmenu`, `selectstart`, `dragstart` y `<ProtectedVideoPlayer url={cleanYouTubeUrl(activeEntry.video.url)} />`.
2. **Verificación de Optimización de Consultas a BD:**
   * Abrir un curso desde `/app/pagoUnicoCourses`: **`0` lecturas adicionales a Firestore** (hidratado desde `catalogCache`).
   * Volver al catálogo y reabrir el mismo curso: **`0` lecturas a Firestore y `0` llamadas repetidas a `/api/materials`**.
   * En `/api/materials?course_id=...`: `isCourseActiveInFirestore` servido desde caché en memoria (`TTL 60 s`) en llamadas sucesivas.
3. **Verificación Técnica en Servidor Activo (`localhost:3000`):**
   * Compilación limpia mediante `next/dist/build/swc` en el 100% de los archivos creados/editados *(sin ejecutar `npm run build` para no corromper `.next` en vivo)*.
   * `0` ocurrencias del prefijo `dark:` de Tailwind en todos los archivos intervenidos.
   * Auditoría `npx impeccable detect --json` devolviendo `[]`.
   * Sonda HTTP `200` en `http://localhost:3000/app/pagoUnicoCourses`, `/app/flashcards`, `/app/materiales` y `/admin`.
