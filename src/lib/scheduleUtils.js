import { APP_TIMEZONE, getBoliviaDateParts } from '@/lib/accountExpiration';

export const DAYS_OF_WEEK_ES = [
  { value: 1, short: 'Lun', label: 'Lunes' },
  { value: 2, short: 'Mar', label: 'Martes' },
  { value: 3, short: 'Mié', label: 'Miércoles' },
  { value: 4, short: 'Jue', label: 'Jueves' },
  { value: 5, short: 'Vie', label: 'Viernes' },
  { value: 6, short: 'Sáb', label: 'Sábado' },
  { value: 0, short: 'Dom', label: 'Domingo' },
];

/**
 * Obtiene la fecha YYYY-MM-DD actual en Hora de Bolivia (America/La_Paz).
 * @returns {string}
 */
export function getTodayBoliviaStr() {
  return getBoliviaDateParts(new Date()).dateStr;
}

/**
 * Dado cualquier YYYY-MM-DD, devuelve el lunes (YYYY-MM-DD) de esa semana.
 * @param {string} [dateStr]
 * @returns {string}
 */
export function getWeekStartMonday(dateStr) {
  const baseStr = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : getTodayBoliviaStr();
  const [y, m, d] = baseStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Dom..6=Sáb
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diffToMonday);
  return dt.toISOString().split('T')[0];
}

/**
 * Suma `days` días a una fecha YYYY-MM-DD.
 * @param {string} dateStr
 * @param {number} days
 * @returns {string}
 */
export function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().split('T')[0];
}

/**
 * Devuelve los 7 días de la semana (Lunes a Domingo) a partir de `weekStartMonday`.
 * @param {string} weekStartMonday
 * @returns {Array<{ date: string, dayOfWeek: number, label: string, shortLabel: string, displayDate: string }>}
 */
export function getWeekDays(weekStartMonday) {
  const start = getWeekStartMonday(weekStartMonday);
  return Array.from({ length: 7 }, (_, i) => {
    const dateStr = addDaysToDateStr(start, i);
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dayOfWeek = dt.getUTCDay();
    const dayMeta = DAYS_OF_WEEK_ES.find((item) => item.value === dayOfWeek) || {
      label: '',
      short: '',
    };
    return {
      date: dateStr,
      dayOfWeek,
      label: dayMeta.label,
      shortLabel: dayMeta.short,
      displayDate: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`,
    };
  });
}

/**
 * Normaliza `hora_inicio` a HH:mm (ej. "20:00:00" -> "20:00").
 * @param {string} timeStr
 * @returns {string}
 */
export function formatTimeHHMM(timeStr = '') {
  if (!timeStr) return '00:00';
  return String(timeStr).slice(0, 5);
}

/**
 * Calcula la hora de finalización HH:mm sumando `duracionMinutos` a `horaInicio`.
 * @param {string} timeStr
 * @param {number} [duracionMinutos=60]
 * @returns {string}
 */
export function formatEndTimeHHMM(timeStr = '', duracionMinutos = 60) {
  const clean = formatTimeHHMM(timeStr);
  const [hStr, mStr] = clean.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return clean;
  const totalMin = (h * 60 + m + (Number(duracionMinutos) || 60)) % (24 * 60);
  const endH = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const endM = String(totalMin % 60).padStart(2, '0');
  return `${endH}:${endM}`;
}

/**
 * Devuelve el timestamp en ms del inicio de la clase en Hora Bolivia (-04:00).
 * @param {Object} occ
 * @returns {number}
 */
export function getOccurrenceStartMs(occ) {
  if (!occ?.occurrence_date) return NaN;
  const startTime = formatTimeHHMM(occ.hora_inicio);
  return new Date(`${occ.occurrence_date}T${startTime}:00-04:00`).getTime();
}

/**
 * Genera etiqueta amigable de cuenta regresiva para la próxima clase.
 * @param {Object} occ
 * @param {number} [nowMs=Date.now()]
 * @returns {string}
 */
export function formatCountdownEs(occ, nowMs = Date.now()) {
  const startMs = getOccurrenceStartMs(occ);
  if (!Number.isFinite(startMs)) return '';
  const diffMin = Math.round((startMs - nowMs) / 60000);
  if (diffMin <= 0) return 'Comenzando ahora';
  if (diffMin < 60) return `Inicia en ${diffMin} min`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours < 24) {
    return mins > 0 ? `Inicia en ${hours} h ${mins} min` : `Inicia en ${hours} h`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? `Mañana a las ${formatTimeHHMM(occ.hora_inicio)}` : `En ${days} días`;
}

/**
 * Calcula estado dinámico en tiempo real en Hora de Bolivia:
 * 'en_vivo' | 'programada' | 'reprogramada' | 'cancelada' | 'finalizada'
 * @param {Object} occ
 * @param {number} [nowMs=Date.now()]
 * @returns {string}
 */
export function computeOccurrenceLiveStatus(occ, nowMs = Date.now()) {
  if (occ.status === 'cancelada') return 'cancelada';

  const startTime = formatTimeHHMM(occ.hora_inicio);
  const startIso = `${occ.occurrence_date}T${startTime}:00-04:00`;
  const startMs = new Date(startIso).getTime();
  const durationMs = (Number(occ.duracion_minutos) || 60) * 60000;
  const endMs = startMs + durationMs;

  if (Number.isFinite(startMs)) {
    // Ventana en vivo: desde 10 minutos antes de iniciar hasta que finaliza
    if (nowMs >= startMs - 10 * 60000 && nowMs <= endMs) {
      return 'en_vivo';
    }
    if (nowMs > endMs) {
      return 'finalizada';
    }
  }

  return occ.status === 'reprogramada' ? 'reprogramada' : 'programada';
}

/**
 * Expande horarios únicos y recurrentes dentro de una semana [weekStart..weekEnd] aplicando excepciones.
 * @param {Array} schedules
 * @param {Array} exceptions
 * @param {string} weekStartMonday
 * @returns {Array}
 */
export function expandSchedulesForWeek(schedules = [], exceptions = [], weekStartMonday) {
  const weekDays = getWeekDays(weekStartMonday);
  const weekStart = weekDays[0].date;
  const weekEnd = weekDays[6].date;

  const exceptionMap = new Map();
  for (const exc of exceptions) {
    const origDate = String(exc.original_date).slice(0, 10);
    exceptionMap.set(`${exc.schedule_id}__${origDate}`, exc);
  }

  const occurrences = [];
  const nowMs = Date.now();

  for (const sch of schedules) {
    if (!sch.is_recurring) {
      const fecha = sch.fecha_especifica ? String(sch.fecha_especifica).slice(0, 10) : null;
      if (!fecha || fecha < weekStart || fecha > weekEnd) continue;

      const baseOcc = {
        occurrence_id: `${sch.id}__${fecha}`,
        schedule_id: sch.id,
        is_recurring: false,
        original_date: fecha,
        occurrence_date: fecha,
        titulo: sch.titulo,
        descripcion: sch.descripcion,
        expositor: sch.expositor,
        course_id: sch.course_id || null,
        course_title: sch.course_title || null,
        especialidad_id: sch.especialidad_id || null,
        especialidad_nombre: sch.especialidad_nombre || null,
        enlace: sch.enlace,
        id_reunion: sch.id_reunion || null,
        hora_inicio: formatTimeHHMM(sch.hora_inicio),
        duracion_minutos: sch.duracion_minutos || 60,
        status: sch.status || 'programada',
        motivo: null,
      };
      baseOcc.computed_status = computeOccurrenceLiveStatus(baseOcc, nowMs);
      occurrences.push(baseOcc);
      continue;
    }

    // Serie semanal recurrente: buscar el día correspondiente dentro de la semana
    const desde = sch.vigente_desde ? String(sch.vigente_desde).slice(0, 10) : null;
    const hasta = sch.vigente_hasta ? String(sch.vigente_hasta).slice(0, 10) : null;

    for (const dayObj of weekDays) {
      if (Number(sch.day_of_week) !== dayObj.dayOfWeek) continue;
      if (desde && dayObj.date < desde) continue;
      if (hasta && dayObj.date > hasta) continue;

      const exc = exceptionMap.get(`${sch.id}__${dayObj.date}`);

      if (exc?.action === 'cancelled') {
        const cancelledOcc = {
          occurrence_id: `${sch.id}__${dayObj.date}`,
          schedule_id: sch.id,
          is_recurring: true,
          original_date: dayObj.date,
          occurrence_date: dayObj.date,
          titulo: sch.titulo,
          descripcion: sch.descripcion,
          expositor: sch.expositor,
          course_id: sch.course_id || null,
          course_title: sch.course_title || null,
          especialidad_id: sch.especialidad_id || null,
          especialidad_nombre: sch.especialidad_nombre || null,
          enlace: sch.enlace,
          id_reunion: sch.id_reunion || null,
          hora_inicio: formatTimeHHMM(sch.hora_inicio),
          duracion_minutos: sch.duracion_minutos || 60,
          status: 'cancelada',
          computed_status: 'cancelada',
          motivo: exc.motivo || 'Clase cancelada para esta fecha',
        };
        occurrences.push(cancelledOcc);
        continue;
      }

      if (exc?.action === 'rescheduled') {
        const targetDate = exc.new_date ? String(exc.new_date).slice(0, 10) : dayObj.date;
        if (targetDate >= weekStart && targetDate <= weekEnd) {
          const movedOcc = {
            occurrence_id: `${sch.id}__${dayObj.date}`,
            schedule_id: sch.id,
            is_recurring: true,
            original_date: dayObj.date,
            occurrence_date: targetDate,
            titulo: sch.titulo,
            descripcion: sch.descripcion,
            expositor: sch.expositor,
            course_id: sch.course_id || null,
            course_title: sch.course_title || null,
            especialidad_id: sch.especialidad_id || null,
            especialidad_nombre: sch.especialidad_nombre || null,
            enlace: exc.new_enlace || sch.enlace,
            id_reunion: sch.id_reunion || null,
            hora_inicio: formatTimeHHMM(exc.new_hora_inicio || sch.hora_inicio),
            duracion_minutos: sch.duracion_minutos || 60,
            status: 'reprogramada',
            motivo: exc.motivo || 'Horario reprogramado',
          };
          movedOcc.computed_status = computeOccurrenceLiveStatus(movedOcc, nowMs);
          occurrences.push(movedOcc);
        }
        continue;
      }

      const regularOcc = {
        occurrence_id: `${sch.id}__${dayObj.date}`,
        schedule_id: sch.id,
        is_recurring: true,
        original_date: dayObj.date,
        occurrence_date: dayObj.date,
        titulo: sch.titulo,
        descripcion: sch.descripcion,
        expositor: sch.expositor,
        course_id: sch.course_id || null,
        course_title: sch.course_title || null,
        especialidad_id: sch.especialidad_id || null,
        especialidad_nombre: sch.especialidad_nombre || null,
        enlace: sch.enlace,
        id_reunion: sch.id_reunion || null,
        hora_inicio: formatTimeHHMM(sch.hora_inicio),
        duracion_minutos: sch.duracion_minutos || 60,
        status: sch.status === 'cancelada' ? 'cancelada' : 'programada',
        motivo: null,
      };
      regularOcc.computed_status = computeOccurrenceLiveStatus(regularOcc, nowMs);
      occurrences.push(regularOcc);
    }
  }

  // También incluir excepciones reprogramadas desde semanas vecinas que caen en esta semana
  for (const exc of exceptions) {
    if (exc.action !== 'rescheduled' || !exc.new_date) continue;
    const origDate = String(exc.original_date).slice(0, 10);
    const newDate = String(exc.new_date).slice(0, 10);
    if (origDate >= weekStart && origDate <= weekEnd) continue; // ya procesado arriba
    if (newDate < weekStart || newDate > weekEnd) continue;

    const sch = schedules.find((s) => s.id === exc.schedule_id);
    if (!sch) continue;

    const movedIntoWeekOcc = {
      occurrence_id: `${sch.id}__${origDate}`,
      schedule_id: sch.id,
      is_recurring: true,
      original_date: origDate,
      occurrence_date: newDate,
      titulo: sch.titulo,
      descripcion: sch.descripcion,
      expositor: sch.expositor,
      course_id: sch.course_id || null,
      course_title: sch.course_title || null,
      especialidad_id: sch.especialidad_id || null,
      especialidad_nombre: sch.especialidad_nombre || null,
      enlace: exc.new_enlace || sch.enlace,
      id_reunion: sch.id_reunion || null,
      hora_inicio: formatTimeHHMM(exc.new_hora_inicio || sch.hora_inicio),
      duracion_minutos: sch.duracion_minutos || 60,
      status: 'reprogramada',
      motivo: exc.motivo || 'Reprogramada de otra semana',
    };
    movedIntoWeekOcc.computed_status = computeOccurrenceLiveStatus(movedIntoWeekOcc, nowMs);
    occurrences.push(movedIntoWeekOcc);
  }

  return occurrences.sort((a, b) => {
    const cmpDate = a.occurrence_date.localeCompare(b.occurrence_date);
    if (cmpDate !== 0) return cmpDate;
    return a.hora_inicio.localeCompare(b.hora_inicio);
  });
}

/**
 * Construye enlace directo para agregar una clase a Google Calendar.
 * @param {Object} occ
 * @returns {string}
 */
export function buildGoogleCalendarUrl(occ) {
  const startTime = formatTimeHHMM(occ.hora_inicio);
  const startMs = new Date(`${occ.occurrence_date}T${startTime}:00-04:00`).getTime();
  const endMs = startMs + (Number(occ.duracion_minutos) || 60) * 60000;
  const toGCalUtc = (ms) =>
    new Date(ms).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const details = [
    occ.descripcion || '',
    `Docente: ${occ.expositor}`,
    occ.course_title ? `Curso: ${occ.course_title}` : '',
    occ.enlace ? `Enlace de clase: ${occ.enlace}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: occ.titulo,
    dates: `${toGCalUtc(startMs)}/${toGCalUtc(endMs)}`,
    details,
    location: occ.enlace || 'Doctemia MC Online',
    ctz: APP_TIMEZONE,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Genera el contenido estándar .ics compatible con Apple Calendar (iOS) / Outlook / Google.
 * @param {Object} occ
 * @returns {string}
 */
export function buildIcsContent(occ) {
  const startTime = formatTimeHHMM(occ.hora_inicio);
  const startMs = new Date(`${occ.occurrence_date}T${startTime}:00-04:00`).getTime();
  const endMs = startMs + (Number(occ.duracion_minutos) || 60) * 60000;
  const toIcsUtc = (ms) =>
    new Date(ms).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const escapeIcs = (str = '') =>
    String(str).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Doctemia MC//Calendario Clases en Vivo//ES',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${occ.occurrence_id}@doctemiamc.com`,
    `DTSTAMP:${toIcsUtc(Date.now())}`,
    `DTSTART:${toIcsUtc(startMs)}`,
    `DTEND:${toIcsUtc(endMs)}`,
    `SUMMARY:${escapeIcs(occ.titulo)}`,
    `DESCRIPTION:${escapeIcs(`Docente: ${occ.expositor}${occ.enlace ? `\\nEnlace: ${occ.enlace}` : ''}${occ.descripcion ? `\\n${occ.descripcion}` : ''}`)}`,
    `LOCATION:${escapeIcs(occ.enlace || 'Online')}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * Determina si una programación (clase única o serie recurrente con vigencia vencida) ya pasó.
 * Las series recurrentes sin `vigente_hasta` o vigentes hacia adelante nunca se consideran pasadas.
 * @param {Object} sch
 * @param {string} [todayStr]
 * @param {number} [nowMs]
 * @param {boolean} [includeTodayFinished=false]
 * @returns {boolean}
 */
export function isSchedulePast(
  sch,
  todayStr = getTodayBoliviaStr(),
  nowMs = Date.now(),
  includeTodayFinished = false
) {
  if (!sch) return false;
  if (!sch.is_recurring) {
    const fecha = sch.fecha_especifica ? String(sch.fecha_especifica).slice(0, 10) : null;
    if (!fecha) return false;
    if (fecha < todayStr) return true;
    if (includeTodayFinished && fecha === todayStr) {
      const startMs = getOccurrenceStartMs({
        occurrence_date: fecha,
        hora_inicio: sch.hora_inicio,
      });
      const endMs = startMs + (Number(sch.duracion_minutos) || 60) * 60000;
      return Number.isFinite(endMs) && endMs < nowMs;
    }
    return false;
  }

  const hasta = sch.vigente_hasta ? String(sch.vigente_hasta).slice(0, 10) : null;
  return Boolean(hasta && hasta < todayStr);
}

/**
 * Determina si una excepción puntual pertenece a fechas ya pasadas.
 * @param {Object} exc
 * @param {string} [todayStr]
 * @returns {boolean}
 */
export function isExceptionPast(exc, todayStr = getTodayBoliviaStr()) {
  if (!exc) return false;
  const orig = exc.original_date ? String(exc.original_date).slice(0, 10) : null;
  if (!orig || orig >= todayStr) return false;
  const moved = exc.new_date ? String(exc.new_date).slice(0, 10) : null;
  return !moved || moved < todayStr;
}

/**
 * Enriquecer ocurrencias con los recursos post-clase (enlace de grabación y diapositivas)
 * registrados en `live_class_resources` para `(schedule_id, occurrence_date)`.
 * @param {Array} occurrences
 * @param {Array} resources
 * @param {Map<string, Object>} [materialMap]
 * @returns {Array}
 */
export function attachResourcesToOccurrences(
  occurrences = [],
  resources = [],
  materialMap = new Map()
) {
  if (!Array.isArray(occurrences) || occurrences.length === 0) return [];

  const resourceMap = new Map();
  for (const res of resources || []) {
    if (!res?.schedule_id || !res?.occurrence_date) continue;
    const occDate = String(res.occurrence_date).slice(0, 10);
    resourceMap.set(`${res.schedule_id}__${occDate}`, res);
  }

  return occurrences.map((occ) => {
    const exactKey = `${occ.schedule_id}__${occ.occurrence_date}`;
    const origKey = occ.original_date ? `${occ.schedule_id}__${occ.original_date}` : null;
    const res = resourceMap.get(exactKey) || (origKey ? resourceMap.get(origKey) : null) || null;

    const recordingUrl = res?.recording_url || null;
    const slidesMaterialId = res?.slides_material_id || null;
    const slidesUrl = res?.slides_url || null;
    const slidesTitle = res?.slides_title || null;
    const slidesMaterial = slidesMaterialId ? materialMap.get(slidesMaterialId) || null : null;
    const hasRecording = Boolean(recordingUrl);
    const hasSlides = Boolean(slidesMaterialId || slidesUrl);

    return {
      ...occ,
      recording_url: recordingUrl,
      slides_material_id: slidesMaterialId,
      slides_url: slidesUrl,
      slides_title: slidesTitle,
      slides_material: slidesMaterial,
      notes: res?.notes || null,
      resource_updated_at: res?.updated_at || null,
      has_recording: hasRecording,
      has_slides: hasSlides,
      has_resources: hasRecording || hasSlides,
    };
  });
}

/**
 * Construye el archivo cronológico (más reciente primero) de clases pasadas:
 * incluye toda ocurrencia que tenga recursos (`live_class_resources`) sin límite de antigüedad,
 * además de clases únicas pasadas y ocurrencias recurrentes recientes posteriores a su fecha de inicio.
 * @param {Object} params
 * @returns {Array}
 */
export function buildPastArchiveOccurrences({
  schedules = [],
  exceptions = [],
  resources = [],
  materialMap = new Map(),
  todayStr = getTodayBoliviaStr(),
  nowMs = Date.now(),
  pastWeeksLookback = 6,
}) {
  const scheduleMap = new Map();
  for (const sch of schedules) {
    scheduleMap.set(sch.id, sch);
  }

  const currentWeekMonday = getWeekStartMonday(todayStr);
  const byKey = new Map();

  // 1. Escanear semana actual + semanas recientes hacia atrás para capturar clases finalizadas
  for (let w = 0; w <= pastWeeksLookback; w += 1) {
    const targetMonday = w === 0 ? currentWeekMonday : addDaysToDateStr(currentWeekMonday, -w * 7);
    const weekOccs = expandSchedulesForWeek(schedules, exceptions, targetMonday);
    for (const occ of weekOccs) {
      const sch = scheduleMap.get(occ.schedule_id);
      if (!sch) continue;

      // Para series recurrentes sin recursos explícitos, no inventar sesiones previas a su creación / vigencia
      if (occ.is_recurring) {
        const minDate = sch.vigente_desde
          ? String(sch.vigente_desde).slice(0, 10)
          : sch.created_at
            ? String(sch.created_at).slice(0, 10)
            : todayStr;
        if (occ.occurrence_date < minDate) continue;
      }

      const status = computeOccurrenceLiveStatus(occ, nowMs);
      const isPastOcc = occ.occurrence_date < todayStr || status === 'finalizada';
      if (!isPastOcc) continue;
      if (occ.status === 'cancelada') continue;

      byKey.set(`${occ.schedule_id}__${occ.occurrence_date}`, occ);
    }
  }

  // 2. Garantizar todas las clases pasadas que tengan grabación/diapositivas aunque superen `pastWeeksLookback`
  for (const res of resources || []) {
    if (!res?.schedule_id || !res?.occurrence_date) continue;
    const hasContent = Boolean(res.recording_url || res.slides_material_id || res.slides_url);
    if (!hasContent) continue;

    const sch = scheduleMap.get(res.schedule_id);
    if (!sch) continue;

    const occDate = String(res.occurrence_date).slice(0, 10);
    const key = `${sch.id}__${occDate}`;
    if (byKey.has(key)) continue;

    const matchingExc = (exceptions || []).find(
      (exc) =>
        exc.schedule_id === sch.id &&
        ((exc.new_date && String(exc.new_date).slice(0, 10) === occDate) ||
          String(exc.original_date).slice(0, 10) === occDate)
    );

    const syntheticOcc = {
      occurrence_id: `${sch.id}__${matchingExc ? String(matchingExc.original_date).slice(0, 10) : occDate}`,
      schedule_id: sch.id,
      is_recurring: Boolean(sch.is_recurring),
      original_date: matchingExc ? String(matchingExc.original_date).slice(0, 10) : occDate,
      occurrence_date: occDate,
      titulo: sch.titulo,
      descripcion: sch.descripcion,
      expositor: sch.expositor,
      course_id: sch.course_id || null,
      course_title: sch.course_title || null,
      especialidad_id: sch.especialidad_id || null,
      especialidad_nombre: sch.especialidad_nombre || null,
      enlace: matchingExc?.new_enlace || sch.enlace,
      id_reunion: sch.id_reunion || null,
      hora_inicio: formatTimeHHMM(matchingExc?.new_hora_inicio || sch.hora_inicio),
      duracion_minutos: sch.duracion_minutos || 60,
      status: matchingExc?.action === 'rescheduled' ? 'reprogramada' : sch.status || 'programada',
      motivo: matchingExc?.motivo || null,
    };
    syntheticOcc.computed_status = computeOccurrenceLiveStatus(syntheticOcc, nowMs);

    const isPastOcc = syntheticOcc.occurrence_date < todayStr || syntheticOcc.computed_status === 'finalizada';
    if (!isPastOcc) continue;

    byKey.set(key, syntheticOcc);
  }

  // 3. También garantizar clases únicas pasadas anteriores a pastWeeksLookback
  for (const sch of schedules) {
    if (sch.is_recurring || !sch.fecha_especifica) continue;
    const fecha = String(sch.fecha_especifica).slice(0, 10);
    if (fecha >= todayStr) continue;
    if (sch.status === 'cancelada') continue;
    const key = `${sch.id}__${fecha}`;
    if (byKey.has(key)) continue;

    const singleOcc = {
      occurrence_id: key,
      schedule_id: sch.id,
      is_recurring: false,
      original_date: fecha,
      occurrence_date: fecha,
      titulo: sch.titulo,
      descripcion: sch.descripcion,
      expositor: sch.expositor,
      course_id: sch.course_id || null,
      course_title: sch.course_title || null,
      especialidad_id: sch.especialidad_id || null,
      especialidad_nombre: sch.especialidad_nombre || null,
      enlace: sch.enlace,
      id_reunion: sch.id_reunion || null,
      hora_inicio: formatTimeHHMM(sch.hora_inicio),
      duracion_minutos: sch.duracion_minutos || 60,
      status: sch.status || 'programada',
      motivo: null,
    };
    singleOcc.computed_status = computeOccurrenceLiveStatus(singleOcc, nowMs);
    byKey.set(key, singleOcc);
  }

  const enriched = attachResourcesToOccurrences(Array.from(byKey.values()), resources, materialMap);
  return enriched.sort((a, b) => {
    const cmpDate = b.occurrence_date.localeCompare(a.occurrence_date);
    if (cmpDate !== 0) return cmpDate;
    return b.hora_inicio.localeCompare(a.hora_inicio);
  });
}
