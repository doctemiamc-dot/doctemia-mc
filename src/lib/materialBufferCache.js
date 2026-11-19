/**
 * Caché en memoria acotada (LRU) para evitar descargas repetidas al navegar entre documentos
 * del mismo curso o alternar entre el visor inline y pantalla completa.
 */

const MAX_ENTRIES = 8;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024; // 40 MB máx. en memoria del navegador
const SIGNED_URL_TTL_MS = 45 * 60 * 1000; // 45 minutos (las URLs firmadas duran 60 min)

const fileCache = new Map();
const signedUrlCache = new Map();
let totalBytes = 0;

function estimateEntrySize(entry) {
  if (!entry) return 0;
  if (entry.kind === 'pdf' && entry.bytes) return entry.bytes.byteLength || 0;
  if (entry.kind === 'image' && entry.blob) return entry.blob.size || 0;
  return 0;
}

function makeKey(userId, materialId) {
  return `${userId || 'anon'}::${materialId}`;
}

function evictIfNeeded() {
  while (
    fileCache.size > MAX_ENTRIES ||
    (totalBytes > MAX_TOTAL_BYTES && fileCache.size > 1)
  ) {
    const oldestKey = fileCache.keys().next().value;
    if (!oldestKey) break;
    const oldEntry = fileCache.get(oldestKey);
    totalBytes = Math.max(0, totalBytes - estimateEntrySize(oldEntry));
    fileCache.delete(oldestKey);
  }
}

export function getCachedMaterialPayload(userId, materialId) {
  if (!materialId) return null;
  const key = makeKey(userId, materialId);
  const entry = fileCache.get(key);
  if (!entry) return null;
  // Refrescar orden LRU
  fileCache.delete(key);
  fileCache.set(key, entry);
  return entry;
}

export function setCachedMaterialPayload(userId, materialId, entry) {
  if (!materialId || !entry) return;
  const size = estimateEntrySize(entry);
  // No cachear en memoria archivos individuales enormes (> 25 MB) para proteger RAM móvil
  if (size > 25 * 1024 * 1024) return;

  const key = makeKey(userId, materialId);
  if (fileCache.has(key)) {
    const prev = fileCache.get(key);
    totalBytes = Math.max(0, totalBytes - estimateEntrySize(prev));
    fileCache.delete(key);
  }
  fileCache.set(key, entry);
  totalBytes += size;
  evictIfNeeded();
}

export function getCachedSignedUrl(userId, materialId) {
  if (!materialId) return null;
  const key = makeKey(userId, materialId);
  const entry = signedUrlCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SIGNED_URL_TTL_MS) {
    signedUrlCache.delete(key);
    return null;
  }
  return entry.url;
}

export function setCachedSignedUrl(userId, materialId, url) {
  if (!materialId || !url) return;
  const key = makeKey(userId, materialId);
  if (signedUrlCache.size >= 30) {
    const oldestKey = signedUrlCache.keys().next().value;
    if (oldestKey) signedUrlCache.delete(oldestKey);
  }
  signedUrlCache.set(key, { url, ts: Date.now() });
}

export function clearMaterialBufferCache() {
  fileCache.clear();
  signedUrlCache.clear();
  totalBytes = 0;
}
