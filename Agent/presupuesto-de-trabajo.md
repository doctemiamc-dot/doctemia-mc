# Propuesta Técnica y Presupuesto de Trabajo — Plataforma Doctemia MC

**Cliente:** Doctemia MC  
**Dev:** Victor Hugo Saldaña Ortiz 
**Plataforma:** Sistema Web Educativo (`sistema-med` — Next.js + Firebase + Supabase)  
**Moneda:** Bolivianos (Bs.)  
**Plazo de entrega y pruebas:** **7 a 10 días** (incluyendo pruebas en iPhone, Android/Xiaomi y PC)

---

## Resumen de la Propuesta

Esta actualización prioritaria está diseñada para resolver de inmediato los problemas de rendimiento y alertas en celulares reportados por los estudiantes en producción, automatizar el control de vigencia de cuentas de usuario e incorporar la nueva base de datos en **Supabase**, el **visor integrado de materiales** y el **calendario semanal de clases**.

> **Ahorro en infraestructura para el cliente (Costo mensual adicional: Bs. 0):**
> * **Videos de clases:** Se mantienen alojados en **YouTube** mediante el reproductor protegido actual (**costo Bs. 0** en almacenamiento de video).
> * **Supabase — Plan Gratuito ($0/mes):** Suficiente para grupos trimestrales sin pagar suscripción mensual:
>   * **Base de Datos PostgreSQL (500 MB):** Guarda horarios, calendario y registros de materiales (ocupa menos del 1% del espacio).
>   * **Almacenamiento de Archivos / Storage (1 GB total, máx. 50 MB por archivo):** Capacidad aproximada para **130 a 500 PDFs/diapositivas** livianas (se recomienda subir presentaciones exportadas a PDF).
>   * **Transferencia mensual / Egress (5 GB estándar + 5 GB en caché):** Margen amplio para la descarga/lectura mensual de materiales sin costos extra.
>   * **Control anti-pausa (7 días):** El plan gratuito hiberna tras 7 días sin actividad; se incluirá un ping automático ligero para mantener la base de datos siempre activa incluso en recesos.
> * **Tráfico en Vercel:** Al comprimir el video decorativo de bienvenida de **82.7 MB a ~2 MB**, se reduce drásticamente el consumo mensual de datos.

---

## Plan Actual (Prioridad Inmediata — Plazo: 7 a 10 días)

### Etapa 1: Optimización de Velocidad, Fluidez y Solución en iPhone / Xiaomi
* **Solución definitiva de alertas repetitivas en celulares (iPhone y Xiaomi/Android):** Se corrige el detector que se activaba por cambios de barra de navegador o ventanas en móviles, **manteniendo 100% intacta** la protección contra robo de enlaces de YouTube, bloqueo de clic derecho, selección de texto y pantalla completa segura en celular.
* **Inicio más rápido (`/app`):** Compresión del video de fondo de **82.7 MB a ~2 MB** (~97% más liviano), corrección de animaciones pesadas para fluidez en móviles y retiro del popup automático de GPS al entrar.
* **Flashcards y Login más ágiles:** Optimización de consultas en flashcards, avance instantáneo al calificar tarjetas y eliminación de pausas innecesarias al iniciar sesión.

| Concepto | Monto |
| :--- | :---: |
| **Etapa 1 — Optimización y corrección móvil** | **Bs. 80** |

---

### Etapa 2: Control Automático de Vigencia y Desactivación de Usuarios (`/admin/users`)
* **Tiempo activo configurable al crear y editar usuarios:** En `/admin/users/create` y `/admin/users/edit/[userId]` se agrega un selector de vigencia del estado activo (**3 meses por defecto**, configurable a 1, 3, 6, 12 meses, fecha exacta o sin vencimiento) junto a los campos de *Acceso Pago Único* y *Estado (Activo)*.
* **Disparador automático a Inactivo al cumplirse la fecha:** Cuando el alumno cumple su fecha límite, el sistema cambia automáticamente su estado de `Activo` a `Inactivo` sin que el administrador tenga que revisar ni desactivar cuentas una por una (bloqueando el acceso al intentar iniciar sesión o navegar y mostrando la alerta de vencimiento en la tabla de `/admin/users`).

| Concepto | Monto |
| :--- | :---: |
| **Etapa 2 — Vigencia configurable y auto-desactivación** | **Bs. 60** |

---

### Etapa 3: Nueva Base de Datos en Supabase (PostgreSQL + Storage)
* Conexión segura de **Supabase PostgreSQL** y **Supabase Storage** (manteniendo Firebase intacto para usuarios, cursos, exámenes y flashcards).
* Creación de tablas relacionales (`course_materials`, `live_class_schedules`, `live_class_exceptions`) y bucket `materials` exclusivo para documentos livianos (PDFs y diapositivas).
* Rutas de servidor protegidas para que únicamente el rol `admin` pueda subir, editar o eliminar archivos y horarios, más rutina ligera de mantenimiento (*keepalive*) para evitar pausas por inactividad en el plan gratuito de Supabase.

| Concepto | Monto |
| :--- | :---: |
| **Etapa 3 — Estructura de BD en Supabase** | **Bs. 50** |

---

### Etapa 4: Biblioteca de Materiales, Carga Fácil en Admin y Visor Integrado
* **Visor integrado dentro de la plataforma:** PDFs y diapositivas se abren dentro de Doctemia MC (optimizado para iPhone, Android y PC), **sin enviar al alumno a Google Drive** y sin botones visibles de descarga directa *(compatible tanto con archivos nuevos en Supabase como con enlaces antiguos de Drive; sin marca de agua por alumno)*.
* **Materiales junto a cada clase:** Acceso directo a diapositivas y resúmenes al lado de los videos en **Cursos de Pago Único**, más biblioteca filtrable por Especialidad, Tema y Curso.
* **Carga múltiple desde Admin:** Subida rápida de uno o varios archivos eligiendo especialidad, tema y curso.

| Concepto | Monto |
| :--- | :---: |
| **Etapa 4 — Materiales y Visor Integrado** | **Bs. 110** |

---

### Etapa 5: Calendario Semanal Interactivo y Clases Recurrentes
* **Calendario semanal del alumno (en *Clases en Vivo*):** Vista Lunes–Domingo adaptada a celular y PC, con tema, docente, hora, estado, filtro por Curso/Especialidad y botón **"Entrar a la clase"** (+ botón opcional **"Agregar a mi calendario"** para Google Calendar / iPhone).
* **Clases que se repiten y edición instantánea (Admin):** Programación desde `/admin/live-classes` de clases únicas o **semanales fijas** (ej. todos los martes 20:00), con edición, movimiento o cancelación en un clic.

| Concepto | Monto |
| :--- | :---: |
| **Etapa 5 — Calendario Semanal y Clases Recurrentes** | **Bs. 80** |

---

## Resumen de Inversión y Modalidad de Pago

| Etapa | Alcance | Monto |
| :---: | :--- | :---: |
| **Etapa 1** | Optimización, fluidez y fin de alertas molestas en iPhone / Xiaomi | **Bs. 80** |
| **Etapa 2** | Vigencia configurable (3 meses por defecto) y auto-desactivación de usuarios | **Bs. 60** |
| **Etapa 3** | Base de datos PostgreSQL + Storage en Supabase | **Bs. 50** |
| **Etapa 4** | Biblioteca de materiales, carga múltiple Admin y visor integrado | **Bs. 110** |
| **Etapa 5** | Calendario semanal del alumno y clases recurrentes | **Bs. 80** |
| **TOTAL** | **Plazo de entrega y pruebas: 7 a 10 días** | **Bs. 380** |

### Forma de Pago (2 Pagos)
* **Primer pago — 50% (Bs. 190):** Al inicio y aprobación del trabajo.
* **Segundo pago — 50% (Bs. 190):** A la entrega final del sistema y verificación de pruebas en PC, Android/Xiaomi y iPhone.

---

## Condiciones del Plan Actual
1. Aplica exclusivamente sobre **Cursos de Pago Único**, **Gestión de Usuarios (`/admin/users`)**, **Flashcards**, **Inicio** y **Clases en Vivo** (no incluye modificaciones en módulos inactivos o heredados).
2. Los videos de las clases siguen alojados en **YouTube** dentro del reproductor protegido actual.
3. No incluye marcas de agua personalizadas por alumno sobre PDFs/diapositivas.
4. Para la **Etapa 3** se utilizará una cuenta gratuita de **Supabase** creada a nombre del propietario del sistema.

---

## Roadmap Futuro (Módulos Posteriores — A cotizar por separado)

Una vez estabilizada y entregada esta primera actualización, quedan mapeados los siguientes módulos solicitados para una segunda etapa de crecimiento:

1. **Automatización y Administración Avanzada:**
   * Avisos y recordatorios automáticos previos al vencimiento de cuentas.
   * Subida de comprobante de pago dentro de la solicitud del alumno.
   * Tabla completa de usuarios con exportación a **Excel (`.xlsx`)**.
   * Módulo de reserva de mentorías.
   * Nuevo rol **Docente** y registro de clases por docente.
2. **Captación de Alumnos y Conversión:**
   * Página de inicio pública (landing page), sección de testimonios de exalumnos y página informativa del curso de internado.
   * Simulacro diagnóstico gratuito para captar prospectos.
   * Sistema de códigos de referido y cupones de descuento.
3. **Canales Directos y Analítica:**
   * Botón flotante/directo de WhatsApp (`whatsapp.com`) con mensajes pre-armados según el curso/interés.
   * Integración de **Google Analytics** para medir cantidad de visitas, páginas vistas y ubicación geográfica de origen.
