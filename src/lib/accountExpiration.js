/**
 * Utilidades compartidas para calcular, formatear y validar la vigencia de cuentas en Hora de Bolivia (America/La_Paz, UTC-4).
 */

export const APP_TIMEZONE = 'America/La_Paz';
const BOLIVIA_OFFSET = '-04:00';

/**
 * Extrae partes de fecha/hora en zona horaria de Bolivia (YYYY, MM, DD, HH, mm).
 * Funciona igual tanto en el navegador como en servidores en UTC (Vercel).
 * @param {any} input
 * @returns {{ year: string, month: string, day: string, hour: string, minute: string, dateStr: string, timeStr: string } | null}
 */
export function getBoliviaDateParts(input) {
  const ms = parseExpirationMs(input);
  if (ms === null) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));

  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour,
    minute: map.minute,
    dateStr: `${map.year}-${map.month}-${map.day}`,
    timeStr: `${hour}:${map.minute}`,
  };
}

/**
 * Convierte una fecha (YYYY-MM-DD) y hora (HH:mm) en Hora de Bolivia a ISO UTC preciso.
 * @param {string} dateStrYYYYMMDD
 * @param {string} [timeStrHHMM='23:59']
 * @returns {string}
 */
export function boliviaDateTimeToIso(dateStrYYYYMMDD, timeStrHHMM = '23:59') {
  const cleanTime = /^\d{2}:\d{2}$/.test(timeStrHHMM) ? timeStrHHMM : '23:59';
  const secondsPart = cleanTime === '23:59' ? '59.999' : '00.000';
  const d = new Date(`${dateStrYYYYMMDD}T${cleanTime}:${secondsPart}${BOLIVIA_OFFSET}`);
  return d.toISOString();
}

/**
 * Suma `months` meses calendario a una fecha YYYY-MM-DD evitando desbordamientos de fin de mes.
 * @param {string} dateStrYYYYMMDD
 * @param {number} months
 * @returns {string} YYYY-MM-DD
 */
export function addMonthsToBoliviaDate(dateStrYYYYMMDD, months) {
  const [y, m, d] = dateStrYYYYMMDD.split('-').map(Number);
  const temp = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDayOfTargetMonth = new Date(Date.UTC(temp.getUTCFullYear(), temp.getUTCMonth() + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, lastDayOfTargetMonth);
  const yy = temp.getUTCFullYear();
  const mm = String(temp.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Suma `months` meses calendario a un Date (compatibilidad).
 * @param {Date} baseDate
 * @param {number} months
 * @returns {Date}
 */
export function addMonthsToDate(baseDate, months) {
  const parts = getBoliviaDateParts(baseDate);
  if (!parts) return new Date(baseDate.getTime());
  const targetDateStr = addMonthsToBoliviaDate(parts.dateStr, months);
  return new Date(boliviaDateTimeToIso(targetDateStr, '23:59'));
}

/**
 * Convierte distintos formatos de Firestore/ISO/YYYY-MM-DD a milisegundos UTC.
 * Retorna null si no hay fecha de vencimiento configurada.
 * @param {any} activeUntil
 * @returns {number|null}
 */
export function parseExpirationMs(activeUntil) {
  if (!activeUntil) return null;

  if (typeof activeUntil?.toDate === 'function') {
    const ms = activeUntil.toDate().getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof activeUntil?.seconds === 'number') {
    return activeUntil.seconds * 1000;
  }

  if (activeUntil instanceof Date) {
    const ms = activeUntil.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof activeUntil === 'number') {
    return Number.isFinite(activeUntil) ? activeUntil : null;
  }

  if (typeof activeUntil === 'string') {
    const trimmed = activeUntil.trim();
    if (!trimmed || trimmed === '-' || trimmed === 'unlimited') return null;

    // Si es solo fecha YYYY-MM-DD, expira al finalizar ese día en Hora de Bolivia (23:59:59.999-04:00)
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const ms = new Date(`${trimmed}T23:59:59.999${BOLIVIA_OFFSET}`).getTime();
      return Number.isFinite(ms) ? ms : null;
    }

    const ms = new Date(trimmed).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  return null;
}

/**
 * Determina si una cuenta tiene fecha de vencimiento configurada y ya expiró.
 * Las cuentas sin `activeUntil` (legacy o sin vencimiento) nunca se consideran vencidas.
 * @param {Object} userData
 * @param {number} [nowMs=Date.now()]
 * @returns {boolean}
 */
export function isAccountExpired(userData, nowMs = Date.now()) {
  if (!userData) return false;
  if (userData.role === 'admin' || userData.rol === 'admin') return false;
  const expiresAtMs = parseExpirationMs(userData.activeUntil);
  if (expiresAtMs === null) return false;
  return nowMs >= expiresAtMs;
}

/**
 * Construye los campos `activeDurationMonths`, `activeFrom` y `activeUntil` en Hora de Bolivia.
 * Todos los plazos vencen a las 23:59:59 (Hora Bolivia) del día límite salvo que se indique `exactTime`.
 * @param {Object} params
 * @returns {{ activeDurationMonths: number|null, activeFrom: string|null, activeUntil: string|null }}
 */
export function buildExpirationFields({
  durationType = 'months',
  activeDurationMonths = 3,
  exactDate = '',
  exactTime = '23:59',
  baseDate = new Date(),
} = {}) {
  if (durationType === 'unlimited') {
    return {
      activeDurationMonths: null,
      activeFrom: baseDate.toISOString(),
      activeUntil: null,
    };
  }

  if (durationType === 'exact' && exactDate) {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(exactDate)
      ? boliviaDateTimeToIso(exactDate, exactTime)
      : new Date(exactDate).toISOString();
    return {
      activeDurationMonths: null,
      activeFrom: baseDate.toISOString(),
      activeUntil: iso,
    };
  }

  const months = Math.max(1, Number(activeDurationMonths) || 3);
  const startParts = getBoliviaDateParts(baseDate);
  const targetDateStr = addMonthsToBoliviaDate(startParts.dateStr, months);
  return {
    activeDurationMonths: months,
    activeFrom: baseDate.toISOString(),
    activeUntil: boliviaDateTimeToIso(targetDateStr, '23:59'),
  };
}

/**
 * Formatea `activeUntil` a DD/MM/AAAA en Hora de Bolivia para mostrar en interfaz administrativa.
 * @param {any} activeUntil
 * @returns {string}
 */
export function formatExpirationDisplay(activeUntil) {
  const parts = getBoliviaDateParts(activeUntil);
  if (!parts) return 'Sin vencimiento';
  return `${parts.day}/${parts.month}/${parts.year}`;
}

/**
 * Formatea fecha y hora exacta en Hora de Bolivia (ej. "18/11/2026 23:59").
 * @param {any} dateInput
 * @returns {string}
 */
export function formatDateTimeBolivia(dateInput) {
  const parts = getBoliviaDateParts(dateInput);
  if (!parts) return 'Sin vencimiento';
  return `${parts.day}/${parts.month}/${parts.year} ${parts.timeStr}`;
}

/**
 * Formatea una fecha a texto legible en español en Hora de Bolivia (ej. "18 nov 2026").
 * @param {any} dateInput
 * @returns {string}
 */
export function formatDateShortEs(dateInput) {
  const ms = parseExpirationMs(dateInput);
  if (ms === null) return 'Sin fecha';
  return new Date(ms).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: APP_TIMEZONE,
  });
}

/**
 * Calcula los días calendario entre dos fechas en Hora de Bolivia (mínimo 0).
 * @param {any} startInput
 * @param {any} endInput
 * @returns {number|null}
 */
export function calculateDurationDays(startInput, endInput) {
  const startParts = getBoliviaDateParts(startInput);
  const endParts = getBoliviaDateParts(endInput);
  if (!startParts || !endParts) return null;
  const startDayMs = Date.parse(`${startParts.dateStr}T00:00:00Z`);
  const endDayMs = Date.parse(`${endParts.dateStr}T00:00:00Z`);
  const diff = Math.round((endDayMs - startDayMs) / 86400000);
  return Math.max(0, diff);
}
