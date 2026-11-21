import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';

const CACHE_PREFIX = 'doctemia_cache_v1_';
const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutos
const COURSES_TTL_MS = 3 * 60 * 1000; // 3 minutos (balance entre frescura y ahorro de lecturas)
const PENDING_REQ_TTL_MS = 5 * 60 * 1000; // 5 minutos
const CHANNEL_NAME = 'doctemia_catalog_cache_v1';

const memoryCache = new Map();
const inflightPromises = new Map();

function clearLocalCachePrefix(prefix = '') {
  for (const k of Array.from(memoryCache.keys())) {
    if (!prefix || k.startsWith(prefix)) {
      memoryCache.delete(k);
    }
  }
  if (typeof window !== 'undefined') {
    try {
      const fullPrefix = CACHE_PREFIX + prefix;
      for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
        const storageKey = window.sessionStorage.key(i);
        if (storageKey && storageKey.startsWith(fullPrefix)) {
          window.sessionStorage.removeItem(storageKey);
        }
      }
    } catch {
      // Ignorar
    }
  }
}

let invalidationChannel = null;
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    invalidationChannel = new BroadcastChannel(CHANNEL_NAME);
    invalidationChannel.onmessage = (event) => {
      clearLocalCachePrefix(event?.data?.prefix || '');
    };
  } catch {
    invalidationChannel = null;
  }
}

function readCache(key, ttlMs = DEFAULT_TTL_MS) {
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem && now - mem.ts < ttlMs) {
    return mem.data;
  }

  if (typeof window !== 'undefined') {
    try {
      const raw = window.sessionStorage.getItem(CACHE_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.ts === 'number' && now - parsed.ts < ttlMs) {
          memoryCache.set(key, parsed);
          return parsed.data;
        }
      }
    } catch {
      // Ignorar errores de sessionStorage (modo privado o cuota local)
    }
  }
  return null;
}

function writeCache(key, data) {
  const entry = { ts: Date.now(), data };
  memoryCache.set(key, entry);
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // Ignorar si sessionStorage está lleno
    }
  }
  return data;
}

async function withDedupe(key, ttlMs, forceRefresh, loaderFn) {
  if (!forceRefresh) {
    const cached = readCache(key, ttlMs);
    if (cached !== null) return cached;
  }

  if (inflightPromises.has(key)) {
    return inflightPromises.get(key);
  }

  const promise = (async () => {
    try {
      const data = await loaderFn();
      return writeCache(key, data);
    } finally {
      inflightPromises.delete(key);
    }
  })();

  inflightPromises.set(key, promise);
  return promise;
}

/**
 * Busca síncronamente las especialidades cacheadas (`0 ms`, sin lecturas a Firestore).
 */
export function peekCachedCategories() {
  return readCache('categories', DEFAULT_TTL_MS);
}

/**
 * Obtiene las especialidades (`course_categories`) con tope de seguridad y caché de sesión.
 */
export async function getCachedCategories({ forceRefresh = false } = {}) {
  return withDedupe('categories', DEFAULT_TTL_MS, forceRefresh, async () => {
    const snap = await getDocs(query(collection(db, 'course_categories'), limit(100)));
    const cats = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cats.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return cats;
  });
}

/**
 * Busca síncronamente los subtemas cacheados de una especialidad (`0 ms`, sin lecturas a Firestore).
 */
export function peekCachedSubcategories(catId) {
  if (!catId) return null;
  return readCache(`subcategories_${catId}`, DEFAULT_TTL_MS);
}

/**
 * Obtiene los subtemas (`course_categories/{catId}/subcategories`) con caché por especialidad.
 */
export async function getCachedSubcategories(catId, { forceRefresh = false } = {}) {
  if (!catId) return [];
  return withDedupe(`subcategories_${catId}`, DEFAULT_TTL_MS, forceRefresh, async () => {
    const subRef = collection(db, 'course_categories', catId, 'subcategories');
    const snap = await getDocs(query(subRef, limit(100)));
    const subs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    subs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return subs;
  });
}

/**
 * Obtiene el catálogo de `Cursos_Pago_Unico` acotado a `limit(50)` y cacheado en sesión.
 */
export async function getCachedPagoUnicoCourses({ onlyActive = false, forceRefresh = false } = {}) {
  const key = onlyActive ? 'pu_courses_active' : 'pu_courses_all';
  return withDedupe(key, COURSES_TTL_MS, forceRefresh, async () => {
    const baseRef = collection(db, 'Cursos_Pago_Unico');
    const q = onlyActive
      ? query(baseRef, where('isActive', '==', true), limit(50))
      : query(baseRef, limit(50));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    return list;
  });
}

/**
 * Busca síncronamente un curso en caché (`0 ms`, sin lecturas a Firestore).
 */
export function peekCachedPagoUnicoCourseById(courseId) {
  if (!courseId) return null;
  const direct = readCache(`pu_course_${courseId}`, COURSES_TTL_MS);
  if (direct) return direct;

  for (const listKey of ['pu_courses_active', 'pu_courses_all']) {
    const list = readCache(listKey, COURSES_TTL_MS);
    if (Array.isArray(list)) {
      const found = list.find((c) => c?.id === courseId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Obtiene un curso por ID reutilizando la caché de catálogo antes de consultar Firestore.
 */
export async function getCachedPagoUnicoCourseById(courseId, { forceRefresh = false } = {}) {
  if (!courseId) return null;
  if (!forceRefresh) {
    const cached = peekCachedPagoUnicoCourseById(courseId);
    if (cached) return cached;
  }

  return withDedupe(`pu_course_${courseId}`, COURSES_TTL_MS, forceRefresh, async () => {
    const snap = await getDoc(doc(db, 'Cursos_Pago_Unico', courseId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  });
}

/**
 * Busca síncronamente los materiales de un curso ya cacheados en memoria o sesión.
 */
export function peekCachedCourseMaterials(courseId) {
  if (!courseId) return null;
  return readCache(`course_materials_${courseId}`, COURSES_TTL_MS);
}

/**
 * Obtiene y cachea los materiales de un curso (`/api/materials?course_id=...`) deduplicando peticiones.
 */
export async function getCachedCourseMaterials(courseId, getTokenFn, { forceRefresh = false } = {}) {
  if (!courseId) return [];
  return withDedupe(`course_materials_${courseId}`, COURSES_TTL_MS, forceRefresh, async () => {
    const headers = {};
    if (typeof getTokenFn === 'function') {
      try {
        const token = await getTokenFn();
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch {
        // La cookie __session también autentica la petición en el servidor
      }
    }
    const res = await fetch(`/api/materials?course_id=${encodeURIComponent(courseId)}`, {
      headers,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    return Array.isArray(data?.materials) ? data.materials : [];
  });
}

/**
 * Obtiene la información de contacto y QR (`pags/infoContacto`) cacheada en sesión.
 */
export async function getCachedContactInfo({ forceRefresh = false } = {}) {
  return withDedupe('contact_info', DEFAULT_TTL_MS, forceRefresh, async () => {
    const snap = await getDoc(doc(db, 'pags', 'infoContacto'));
    const defaults = { qrUrl: '', adminPhone: '', businessName: 'DOCTEMIA MC' };
    if (!snap.exists()) return defaults;
    return { ...defaults, ...snap.data() };
  });
}

/**
 * Verifica si un estudiante ya tiene una solicitud pendiente en `pagoUnico_solicitudes` (1 lectura máx., cacheada).
 */
export async function getCachedPendingAccessRequest(userId, { forceRefresh = false } = {}) {
  if (!userId) return false;
  return withDedupe(`pending_req_${userId}`, PENDING_REQ_TTL_MS, forceRefresh, async () => {
    const q = query(
      collection(db, 'pagoUnico_solicitudes'),
      where('userId', '==', userId),
      where('status', '==', 'pendiente'),
      limit(1)
    );
    const snap = await getDocs(q);
    return !snap.empty;
  });
}

export function setCachedPendingAccessRequest(userId, hasPending = true) {
  if (!userId) return;
  writeCache(`pending_req_${userId}`, Boolean(hasPending));
}

export function invalidateCatalogCache(prefix = '') {
  clearLocalCachePrefix(prefix);
  if (invalidationChannel) {
    try {
      invalidationChannel.postMessage({ prefix, ts: Date.now() });
    } catch {
      // Ignorar si el canal fue cerrado
    }
  }
}
