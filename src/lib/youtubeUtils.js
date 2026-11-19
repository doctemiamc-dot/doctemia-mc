/**
 * Extrae el ID de 11 caracteres de un video de YouTube desde URLs estándar, cortas, embed o shorts.
 * @param {string} url
 * @returns {string}
 */
export function extractYouTubeId(url = '') {
  if (!url || typeof url !== 'string') return '';
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|[?&]v=)([a-zA-Z0-9_-]{11})/
  );
  return match?.[1] || '';
}

/**
 * Elimina parámetros de playlist/Mix (`list`, `index`, `start_radio`) cuando la URL ya apunta
 * a un video específico de YouTube, evitando que `react-player` devuelva `getID() = null` e intente
 * reproducir listas Mix (`RD...`) no soportadas por la API embebida de YouTube.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function cleanYouTubeUrl(rawUrl = '') {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  const videoId = extractYouTubeId(trimmed);
  if (!videoId) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const hasPlaylistParam =
      parsed.searchParams.has('list') ||
      parsed.searchParams.has('index') ||
      parsed.searchParams.has('start_radio');

    if (!hasPlaylistParam) return trimmed;

    parsed.searchParams.delete('list');
    parsed.searchParams.delete('index');
    parsed.searchParams.delete('start_radio');
    return parsed.toString();
  } catch {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
}

/**
 * Compara dos URLs de video tolerando espacios o diferencias de parámetros (`?list=`, `?si=`)
 * mediante coincidencia por ID de YouTube como respaldo.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function matchesVideoUrl(a = '', b = '') {
  const cleanA = String(a || '').trim();
  const cleanB = String(b || '').trim();
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  const idA = extractYouTubeId(cleanA);
  const idB = extractYouTubeId(cleanB);
  return Boolean(idA && idB && idA === idB);
}
