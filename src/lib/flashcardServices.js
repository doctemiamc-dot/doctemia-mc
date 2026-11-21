import { db } from './firebase';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  getCountFromServer,
  collectionGroup,
  query,
  where,
  Timestamp,
  increment,
  writeBatch,
} from 'firebase/firestore';

const FC_CACHE_PREFIX = 'doctemia_fc_cache_v1_';
const FC_CHANNEL_NAME = 'doctemia_fc_cache_v1';
const COUNTS_TTL_MS = 15 * 60 * 1000; // 15 minutos
const SUBTEMA_CARDS_TTL_MS = 10 * 60 * 1000; // 10 minutos
const SUBTEMA_PROG_TTL_MS = 3 * 60 * 1000; // 3 minutos (invalidado al guardar progreso)
const METRICS_TTL_MS = 5 * 60 * 1000; // 5 minutos (invalidado al guardar progreso)

const memoryFcCache = new Map();
const inflightFcPromises = new Map();
const pendingProgressWrites = new Set();

function clearLocalFcCachePrefix(prefix = '') {
  for (const key of Array.from(memoryFcCache.keys())) {
    if (!prefix || key.startsWith(prefix)) {
      memoryFcCache.delete(key);
    }
  }
  if (typeof window !== 'undefined') {
    try {
      const fullPrefix = FC_CACHE_PREFIX + prefix;
      for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
        const storageKey = window.sessionStorage.key(i);
        if (storageKey && storageKey.startsWith(fullPrefix)) {
          window.sessionStorage.removeItem(storageKey);
        }
      }
    } catch {
      // Ignorar errores de sessionStorage
    }
  }
}

let fcInvalidationChannel = null;
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    fcInvalidationChannel = new BroadcastChannel(FC_CHANNEL_NAME);
    fcInvalidationChannel.onmessage = (event) => {
      clearLocalFcCachePrefix(event?.data?.prefix || '');
    };
  } catch {
    fcInvalidationChannel = null;
  }
}

export function invalidateFlashcardCache(prefix = '') {
  clearLocalFcCachePrefix(prefix);
  if (fcInvalidationChannel) {
    try {
      fcInvalidationChannel.postMessage({ prefix, ts: Date.now() });
    } catch {
      // Ignorar si el canal fue cerrado
    }
  }
}

function readFcCache(key, ttlMs) {
  const now = Date.now();
  const mem = memoryFcCache.get(key);
  if (mem && now - mem.ts < ttlMs) return mem.data;

  if (typeof window !== 'undefined') {
    try {
      const raw = window.sessionStorage.getItem(FC_CACHE_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.ts === 'number' && now - parsed.ts < ttlMs) {
          memoryFcCache.set(key, parsed);
          return parsed.data;
        }
      }
    } catch {
      // Ignorar errores de sessionStorage
    }
  }
  return null;
}

function writeFcCache(key, data) {
  const entry = { ts: Date.now(), data };
  memoryFcCache.set(key, entry);
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(FC_CACHE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // Ignorar si sessionStorage está lleno
    }
  }
  return data;
}

async function withFcDedupe(key, ttlMs, forceRefresh, loaderFn) {
  if (!forceRefresh) {
    const cached = readFcCache(key, ttlMs);
    if (cached !== null) return cached;
  }

  if (inflightFcPromises.has(key)) {
    return inflightFcPromises.get(key);
  }

  const promise = (async () => {
    try {
      const data = await loaderFn();
      return writeFcCache(key, data);
    } finally {
      inflightFcPromises.delete(key);
    }
  })();

  inflightFcPromises.set(key, promise);
  return promise;
}

async function waitForPendingProgressWrites() {
  if (pendingProgressWrites.size === 0) return;
  await Promise.allSettled(Array.from(pendingProgressWrites));
}

function toIsoTimestamp(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function serializeCardProgress(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    ...data,
    nextReview: toIsoTimestamp(data.nextReview),
    lastUpdated: toIsoTimestamp(data.lastUpdated),
  };
}

function serializeFlashcardDoc(docSnap) {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    createdAt: toIsoTimestamp(data.createdAt),
    updatedAt: toIsoTimestamp(data.updatedAt),
  };
}

/**
 * Busca síncronamente los conteos de flashcards por especialidad cacheados (`0 ms`).
 */
export function peekCachedCategoryFlashcardCounts() {
  return readFcCache('cat_counts', COUNTS_TTL_MS);
}

/**
 * Obtiene el conteo de flashcards por especialidad usando agregación getCountFromServer
 * y lo cachea en sessionStorage (evita descargar toda la colección `flashcards`).
 */
export async function getCategoryFlashcardCounts(categories = [], { forceRefresh = false } = {}) {
  if (!Array.isArray(categories) || categories.length === 0) return {};
  return withFcDedupe('cat_counts', COUNTS_TTL_MS, forceRefresh, async () => {
    const flashcardsRef = collection(db, 'flashcards');
    const entries = await Promise.all(
      categories.map(async (cat) => {
        if (!cat?.id) return [null, 0];
        try {
          const snap = await getCountFromServer(
            query(flashcardsRef, where('especialidad', '==', cat.id))
          );
          return [cat.id, snap.data().count || 0];
        } catch {
          return [cat.id, 0];
        }
      })
    );

    const countsMap = {};
    for (const [id, count] of entries) {
      if (id) countsMap[id] = count;
    }
    return countsMap;
  });
}

/**
 * Busca síncronamente los conteos de flashcards por subtema cacheados (`0 ms`).
 */
export function peekCachedSubthemeFlashcardCounts(catId) {
  if (!catId) return null;
  return readFcCache(`sub_counts_${catId}`, COUNTS_TTL_MS);
}

/**
 * Obtiene el conteo de flashcards por subtema de una especialidad usando getCountFromServer
 * y lo cachea en sessionStorage por especialidad.
 */
export async function getSubthemeFlashcardCounts(
  catId,
  subthemes = [],
  { forceRefresh = false } = {}
) {
  if (!catId || !Array.isArray(subthemes) || subthemes.length === 0) return {};
  return withFcDedupe(`sub_counts_${catId}`, COUNTS_TTL_MS, forceRefresh, async () => {
    const flashcardsRef = collection(db, 'flashcards');
    const entries = await Promise.all(
      subthemes.map(async (sub) => {
        const cleanName = sub?.name?.trim();
        if (!cleanName) return [null, 0];
        try {
          const snap = await getCountFromServer(
            query(flashcardsRef, where('subtema', '==', cleanName))
          );
          return [cleanName, snap.data().count || 0];
        } catch {
          return [cleanName, 0];
        }
      })
    );

    const countsMap = {};
    for (const [name, count] of entries) {
      if (name) countsMap[name] = count;
    }
    return countsMap;
  });
}

/**
 * Obtiene todas las tarjetas de un subtema específico (100% de sus preguntas, sin recortar)
 * con deduplicación en vuelo y caché en sessionStorage.
 */
async function getRawFlashcardsBySubtemaCached(cleanSubtema, { forceRefresh = false } = {}) {
  if (!cleanSubtema) return [];
  return withFcDedupe(`subcards_${cleanSubtema}`, SUBTEMA_CARDS_TTL_MS, forceRefresh, async () => {
    const flashcardsRef = collection(db, 'flashcards');
    const qGlobal = query(flashcardsRef, where('subtema', '==', cleanSubtema));
    const globalSnapshot = await getDocs(qGlobal);
    return globalSnapshot.docs.map(serializeFlashcardDoc);
  });
}

/**
 * Obtiene el progreso de un usuario para un subtema específico con deduplicación y caché corta.
 */
async function getCachedSubtemaProgressMap(userId, cleanSubtema, { forceRefresh = false } = {}) {
  if (!userId || !cleanSubtema) return {};
  return withFcDedupe(
    `subprog_${userId}_${cleanSubtema}`,
    SUBTEMA_PROG_TTL_MS,
    forceRefresh,
    async () => {
      await waitForPendingProgressWrites();
      const progressRef = collection(db, 'users', userId, 'flashcards_progress');
      const qProgress = query(progressRef, where('subtemaName', '==', cleanSubtema));
      const progressSnapshot = await getDocs(qProgress);

      const userProgressMap = {};
      progressSnapshot.forEach((docSnap) => {
        userProgressMap[docSnap.id] = serializeCardProgress(docSnap.data());
      });
      return userProgressMap;
    }
  );
}

/**
 * Precalienta en segundo plano las tarjetas y progreso de un subtema (hover/touch),
 * compartiendo la promesa en vuelo si el estudiante hace clic inmediatamente.
 */
export function prefetchSubthemeStudy(userId, subtemaName) {
  const cleanSubtema = subtemaName?.trim();
  if (!cleanSubtema) return;
  getRawFlashcardsBySubtemaCached(cleanSubtema).catch(() => {});
  if (userId) {
    getCachedSubtemaProgressMap(userId, cleanSubtema).catch(() => {});
  }
}

/**
 * Guarda o actualiza el progreso de una flashcard para un usuario específico.
 * Invalida de inmediato las cachés locales de métricas y progreso del subtema.
 */
export async function saveFlashcardProgress(
  userId,
  flashcardId,
  revisionData,
  subtemaName,
  quality,
  forceMastered = false
) {
  const cleanSubtema = subtemaName?.trim() || 'General';
  clearLocalFcCachePrefix(`metrics_${userId}`);
  clearLocalFcCachePrefix(`subprog_${userId}_${cleanSubtema}`);
  if (!subtemaName?.trim()) {
    clearLocalFcCachePrefix(`subprog_${userId}_`);
  }

  const writeOperation = (async () => {
    try {
      const progressRef = doc(db, 'users', userId, 'flashcards_progress', flashcardId);

      const esDebilidadActiva = quality <= 2;
      const isFailure = quality <= 2;

      let isMastered = forceMastered;
      if (!isMastered && quality >= 4 && (revisionData.repetitions || 0) >= 3) {
        isMastered = true;
      }

      await setDoc(
        progressRef,
        {
          ...revisionData,
          cardId: flashcardId,
          subtemaName: cleanSubtema,
          nextReview: Timestamp.fromDate(revisionData.nextReview),
          lastUpdated: Timestamp.now(),
          esDebilidadActiva,
          isMastered,
          totalVistas: increment(1),
          totalFallos: increment(isFailure ? 1 : 0),
          totalAciertos: increment(!isFailure ? 1 : 0),
        },
        { merge: true }
      );
    } catch (error) {
      console.error('Error al guardar progreso de flashcard:', error);
      throw error;
    }
  })();

  pendingProgressWrites.add(writeOperation);
  try {
    return await writeOperation;
  } finally {
    pendingProgressWrites.delete(writeOperation);
  }
}

/**
 * Elimina una flashcard y todo su progreso asociado en una transacción atómica.
 */
export async function deleteFlashcardCompleta(cardId) {
  try {
    const batch = writeBatch(db);
    const cardRef = doc(db, 'flashcards', cardId);
    batch.delete(cardRef);

    try {
      const progressQuery = query(
        collectionGroup(db, 'flashcards_progress'),
        where('cardId', '==', cardId)
      );
      const progressSnapshot = await getDocs(progressQuery);

      progressSnapshot.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
    } catch (indexError) {
      console.warn(
        'No se pudo realizar el borrado en cascada del progreso. Posible falta de índice en Firestore:',
        indexError.message
      );
    }

    await batch.commit();
    invalidateFlashcardCache();
  } catch (error) {
    console.error('Error al eliminar flashcard:', error);
    throw error;
  }
}

/**
 * Busca síncronamente las métricas de flashcards cacheadas para un usuario (`0 ms`).
 */
export function peekCachedFlashcardMetrics(userId) {
  if (!userId || pendingProgressWrites.size > 0) return null;
  return readFcCache(`metrics_${userId}`, METRICS_TTL_MS);
}

async function computeFlashcardMetrics(userId, existingCardsCollection = null) {
  await waitForPendingProgressWrites();

  const hasExplicitSet =
    existingCardsCollection instanceof Map || existingCardsCollection instanceof Set;

  const progressRef = collection(db, 'users', userId, 'flashcards_progress');
  const snapshot = await getDocs(progressRef);

  const now = new Date();
  let dueToday = 0;
  const subtemaStats = {};
  const criticalCards = [];
  const masteredCountsMap = {};
  let totalLearning = 0;

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const cardId = docSnap.id;

    if (hasExplicitSet && !existingCardsCollection.has(cardId)) return;

    const sub = data.subtemaName?.trim() || 'General';

    if (data.isMastered) {
      masteredCountsMap[sub] = (masteredCountsMap[sub] || 0) + 1;
      return;
    }

    totalLearning++;

    if (data.nextReview && data.nextReview.toDate() <= now) {
      dueToday++;
    }

    if (!subtemaStats[sub]) {
      subtemaStats[sub] = { name: sub, aciertos: 0, fallos: 0, count: 0 };
    }
    subtemaStats[sub].aciertos += data.totalAciertos || 0;
    subtemaStats[sub].fallos += data.totalFallos || 0;
    subtemaStats[sub].count++;

    if (data.esDebilidadActiva) {
      criticalCards.push({
        id: cardId,
        subtema: sub,
        totalFallos: data.totalFallos || 0,
        totalAciertos: data.totalAciertos || 0,
        totalVistas: data.totalVistas || 0,
        nextReview: toIsoTimestamp(data.nextReview),
        isMastered: data.isMastered || false,
        lastUpdated: toIsoTimestamp(data.lastUpdated),
      });
    }
  });

  const performanceBySubtheme = Object.values(subtemaStats)
    .map((sub) => {
      const total = sub.aciertos + sub.fallos;
      const percentage = total > 0 ? Math.round((sub.aciertos / total) * 100) : 0;
      return { ...sub, percentage };
    })
    .sort((a, b) => a.percentage - b.percentage);

  const sortedCritical = criticalCards
    .sort((a, b) => b.totalFallos - a.totalFallos)
    .slice(0, 5);

  const criticalQuestions = {};
  let validCriticalCards = sortedCritical;

  if (sortedCritical.length > 0) {
    if (existingCardsCollection instanceof Map) {
      validCriticalCards = [];
      for (const card of sortedCritical) {
        const cardData = existingCardsCollection.get(card.id);
        if (cardData) {
          criticalQuestions[card.id] = cardData.pregunta;
          validCriticalCards.push({ ...card, pregunta: cardData.pregunta });
        }
      }
    } else {
      // Consultar únicamente las <= 5 tarjetas críticas por ID (máx. 5 lecturas en vez de toda la colección)
      const topIds = sortedCritical.map((c) => c.id);
      const flashcardsRef = collection(db, 'flashcards');
      const cardSnap = await getDocs(query(flashcardsRef, where('__name__', 'in', topIds)));
      const fetchedMap = new Map();
      cardSnap.forEach((d) => fetchedMap.set(d.id, d.data()));

      validCriticalCards = [];
      for (const card of sortedCritical) {
        const cardData = fetchedMap.get(card.id);
        if (cardData) {
          criticalQuestions[card.id] = cardData.pregunta;
          validCriticalCards.push({ ...card, pregunta: cardData.pregunta });
        }
      }
    }
  }

  return {
    dueToday,
    totalLearning,
    performanceBySubtheme,
    criticalCards: validCriticalCards,
    criticalQuestions,
    masteredCountsMap,
  };
}

/**
 * Obtiene métricas generales de progreso para el Dashboard en UNA SOLA lectura de `flashcards_progress`
 * (con caché en sesión e invalidación automática al estudiar o restaurar tarjetas).
 */
export async function getFlashcardMetrics(
  userId,
  existingCardsCollection = null,
  { forceRefresh = false } = {}
) {
  const emptyMetrics = {
    dueToday: 0,
    totalLearning: 0,
    performanceBySubtheme: [],
    criticalCards: [],
    criticalQuestions: {},
    masteredCountsMap: {},
  };
  if (!userId) return emptyMetrics;

  try {
    if (existingCardsCollection !== null) {
      return await computeFlashcardMetrics(userId, existingCardsCollection);
    }

    return await withFcDedupe(`metrics_${userId}`, METRICS_TTL_MS, forceRefresh, () =>
      computeFlashcardMetrics(userId, null)
    );
  } catch (error) {
    console.error('Error al obtener métricas:', error);
    return emptyMetrics;
  }
}

function buildDueFlashcardsList(allFlashcards, userProgressMap) {
  const now = new Date();
  now.setHours(23, 59, 59, 999);

  const dueFlashcards = allFlashcards.filter((card) => {
    const progress = userProgressMap[card.id];
    if (progress?.isMastered) return false;
    if (!progress) return true;
    const nextReviewDate = progress.nextReview?.toDate
      ? progress.nextReview.toDate()
      : new Date(progress.nextReview);
    return nextReviewDate <= now;
  });

  return dueFlashcards.map((card) => ({
    ...card,
    userProgress: userProgressMap[card.id] || null,
  }));
}

/**
 * Obtiene síncronamente las tarjetas pendientes de un subtema si tanto las tarjetas como
 * el progreso del subtema ya fueron precalentados/cacheados (`0 ms`, `0` lecturas).
 */
export function peekDueFlashcards(userId, subtemaName) {
  const cleanSubtema = subtemaName?.trim();
  if (!userId || !cleanSubtema || pendingProgressWrites.size > 0) return null;

  const allFlashcards = readFcCache(`subcards_${cleanSubtema}`, SUBTEMA_CARDS_TTL_MS);
  const userProgressMap = readFcCache(`subprog_${userId}_${cleanSubtema}`, SUBTEMA_PROG_TTL_MS);
  if (allFlashcards === null || userProgressMap === null) return null;

  return buildDueFlashcardsList(allFlashcards, userProgressMap);
}

/**
 * Obtiene las tarjetas de un subtema que el usuario debe estudiar hoy.
 * Mantiene el 100% de las preguntas del subtema y filtra el progreso solo de ese subtema.
 */
export async function getDueFlashcards(userId, subtemaName) {
  try {
    const cleanSubtema = subtemaName?.trim();
    const [allFlashcards, userProgressMap] = await Promise.all([
      getRawFlashcardsBySubtemaCached(cleanSubtema),
      getCachedSubtemaProgressMap(userId, cleanSubtema),
    ]);

    return buildDueFlashcardsList(allFlashcards, userProgressMap);
  } catch (error) {
    console.error('Error al obtener tarjetas pendientes:', error);
    throw error;
  }
}

/**
 * Obtiene TODAS las flashcards de un subtema para el Modo Estudio Intensivo (excluye dominadas).
 * Mantiene el 100% de las preguntas del subtema y filtra el progreso solo de ese subtema.
 */
export async function getAllFlashcardsBySubtema(userId, subtemaName) {
  try {
    const cleanSubtema = subtemaName?.trim();
    const [allFlashcards, userProgressMap] = await Promise.all([
      getRawFlashcardsBySubtemaCached(cleanSubtema),
      getCachedSubtemaProgressMap(userId, cleanSubtema),
    ]);

    return allFlashcards
      .filter((card) => !userProgressMap[card.id]?.isMastered)
      .map((card) => ({
        ...card,
        userProgress: userProgressMap[card.id] || null,
      }));
  } catch (error) {
    console.error('Error al obtener todas las tarjetas:', error);
    throw error;
  }
}

/**
 * Obtiene todas las tarjetas marcadas como debilidad activa para el usuario.
 */
export async function getWeakFlashcards(userId) {
  try {
    await waitForPendingProgressWrites();
    const progressRef = collection(db, 'users', userId, 'flashcards_progress');
    const q = query(
      progressRef,
      where('esDebilidadActiva', '==', true),
      where('isMastered', '==', false)
    );
    const progressSnapshot = await getDocs(q);

    if (progressSnapshot.empty) return [];

    const userProgressMap = {};
    const cardIds = [];
    progressSnapshot.forEach((docSnap) => {
      userProgressMap[docSnap.id] = serializeCardProgress(docSnap.data());
      cardIds.push(docSnap.id);
    });

    const flashcardsRef = collection(db, 'flashcards');
    const allFlashcards = [];

    for (let i = 0; i < cardIds.length; i += 10) {
      const batchIds = cardIds.slice(i, i + 10);
      const qCards = query(flashcardsRef, where('__name__', 'in', batchIds));
      const cardSnap = await getDocs(qCards);
      cardSnap.forEach((docSnap) => {
        allFlashcards.push({
          ...serializeFlashcardDoc(docSnap),
          userProgress: userProgressMap[docSnap.id],
        });
      });
    }

    return allFlashcards;
  } catch (error) {
    console.error('Error al obtener tarjetas débiles:', error);
    throw error;
  }
}

/**
 * Restaura todas las tarjetas dominadas de un subtema específico.
 */
export async function restoreMasteredFlashcards(userId, subtemaName) {
  try {
    await waitForPendingProgressWrites();
    const cleanSubtema = subtemaName?.trim() || 'General';
    const progressRef = collection(db, 'users', userId, 'flashcards_progress');
    const q = query(
      progressRef,
      where('subtemaName', '==', cleanSubtema),
      where('isMastered', '==', true)
    );
    const snapshot = await getDocs(q);

    const batch = writeBatch(db);
    snapshot.forEach((docSnap) => {
      batch.update(docSnap.ref, { isMastered: false, esDebilidadActiva: false });
    });

    await batch.commit();
    clearLocalFcCachePrefix(`metrics_${userId}`);
    clearLocalFcCachePrefix(`subprog_${userId}_${cleanSubtema}`);
  } catch (error) {
    console.error('Error restaurando tarjetas:', error);
    throw error;
  }
}

/**
 * Obtiene el conteo de tarjetas dominadas por subtema.
 */
export async function getMasteredCount(userId, subtemaName) {
  try {
    await waitForPendingProgressWrites();
    const progressRef = collection(db, 'users', userId, 'flashcards_progress');
    const q = query(
      progressRef,
      where('subtemaName', '==', subtemaName),
      where('isMastered', '==', true)
    );
    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error) {
    console.error('Error al obtener conteo de dominadas:', error);
    return 0;
  }
}

/**
 * Obtiene en una sola consulta el mapa { [subtemaName]: cantidadDominadas } del usuario.
 */
export async function getMasteredCountsMap(userId) {
  try {
    await waitForPendingProgressWrites();
    const progressRef = collection(db, 'users', userId, 'flashcards_progress');
    const q = query(progressRef, where('isMastered', '==', true));
    const snapshot = await getDocs(q);
    const counts = {};
    snapshot.forEach((docSnap) => {
      const subName = docSnap.data()?.subtemaName?.trim();
      if (subName) {
        counts[subName] = (counts[subName] || 0) + 1;
      }
    });
    return counts;
  } catch (error) {
    console.error('Error al obtener mapa de dominadas:', error);
    return {};
  }
}
