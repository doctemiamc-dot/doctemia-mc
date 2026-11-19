export const MATERIAL_BUCKET = 'materials';

export const ALLOWED_MATERIAL_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const VIDEO_EXT_REGEX = /\.(mp4|mov|avi|mkv|webm|m4v|flv|wmv|mpeg|mpg)$/i;
const ALLOWED_EXT_REGEX = /\.(pdf|ppt|pptx|doc|docx|png|jpg|jpeg|webp)$/i;

/**
 * Valida que un archivo sea documento/imagen permitido y NUNCA un video.
 * @param {string} fileName
 * @param {string} mimeType
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMaterialFile(fileName = '', mimeType = '') {
  const lowerMime = String(mimeType || '').toLowerCase();
  const cleanName = String(fileName || '').trim();

  if (lowerMime.startsWith('video/') || VIDEO_EXT_REGEX.test(cleanName)) {
    return {
      valid: false,
      error: 'No está permitido subir videos a Materiales. Los videos deben gestionarse únicamente por enlace de YouTube.',
    };
  }

  if (ALLOWED_MATERIAL_MIME_TYPES.has(lowerMime) || ALLOWED_EXT_REGEX.test(cleanName)) {
    return { valid: true };
  }

  return {
    valid: false,
    error: 'Formato no soportado. Sube PDF, presentaciones (PPT/PPTX), Word (DOC/DOCX) o imágenes (PNG/JPG/WEBP).',
  };
}

/**
 * Infiera el tipo de material ('slides' | 'summary' | 'pdf') a partir de la extensión o MIME.
 * @param {string} fileName
 * @param {string} mimeType
 * @returns {'slides' | 'summary' | 'pdf'}
 */
export function inferMaterialType(fileName = '', mimeType = '') {
  const lowerName = String(fileName || '').toLowerCase();
  const lowerMime = String(mimeType || '').toLowerCase();
  if (
    lowerName.endsWith('.ppt') ||
    lowerName.endsWith('.pptx') ||
    lowerMime.includes('presentation') ||
    lowerMime.includes('powerpoint')
  ) {
    return 'slides';
  }
  if (
    lowerName.endsWith('.doc') ||
    lowerName.endsWith('.docx') ||
    lowerMime.includes('word')
  ) {
    return 'summary';
  }
  return 'pdf';
}

/**
 * Convierte un enlace de Google Drive (/view, /open?id=, uc?id=) a su URL embebible /preview
 * para mostrarlo dentro de ProtectedDocumentViewer sin expulsar al usuario fuera de la plataforma.
 * @param {string} rawUrl
 * @returns {string}
 */
export function toDrivePreviewUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed.includes('drive.google.com') && !trimmed.includes('docs.google.com')) {
    return trimmed;
  }

  // Google Slides / Docs / Sheets
  const docsMatch = trimmed.match(/docs\.google\.com\/(presentation|document|spreadsheets)\/d\/([a-zA-Z0-9_-]+)/);
  if (docsMatch) {
    return `https://docs.google.com/${docsMatch[1]}/d/${docsMatch[2]}/preview`;
  }

  // Drive /file/d/{ID}/...
  const fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    return `https://drive.google.com/file/d/${fileMatch[1]}/preview`;
  }

  // Drive ?id={ID}
  try {
    const u = new URL(trimmed);
    const id = u.searchParams.get('id');
    if (id) {
      return `https://drive.google.com/file/d/${id}/preview`;
    }
  } catch {
    // ignore malformed URL
  }

  return trimmed;
}

/**
 * Sanitiza un nombre de archivo para usarlo como storage_path en Supabase Storage.
 * @param {string} fileName
 * @returns {string}
 */
export function sanitizeStorageFileName(fileName = 'documento.pdf') {
  return String(fileName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_');
}
