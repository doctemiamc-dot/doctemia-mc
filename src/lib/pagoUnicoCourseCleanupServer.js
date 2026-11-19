import { db as adminDb } from '@/lib/firebase-admin';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { MATERIAL_BUCKET } from '@/lib/materialUtils';
import { broadcastScheduleChange } from '@/lib/scheduleBroadcast';
import { cleanupManagedMaterialsForSchedules } from '@/lib/liveClassResourcesServer';

const SAFE_COVER_FILE_REGEX = /^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/i;

/**
 * Extrae el `storage_path` dentro del bucket `materials` cuando la portada fue subida
 * mediante `/api/course-covers/[file]`.
 * @param {string|null|undefined} imageUrl
 * @returns {string|null}
 */
export function extractManagedCoverStoragePath(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const match = imageUrl.match(/\/api\/course-covers\/([^?#]+)/);
  if (!match?.[1]) return null;

  let decoded = '';
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  if (!decoded || !SAFE_COVER_FILE_REGEX.test(decoded) || decoded.includes('..')) {
    return null;
  }

  return `covers/${decoded}`;
}

/**
 * Elimina un arreglo de rutas en Supabase Storage por lotes y verifica que no existan errores.
 * @param {string[]} paths
 * @returns {Promise<number>}
 */
async function removeStoragePathsStrict(paths = []) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (uniquePaths.length === 0) return 0;

  const CHUNK_SIZE = 100;
  for (let i = 0; i < uniquePaths.length; i += CHUNK_SIZE) {
    const chunk = uniquePaths.slice(i, i + CHUNK_SIZE);
    const { error } = await supabaseAdmin.storage.from(MATERIAL_BUCKET).remove(chunk);
    if (error) {
      throw new Error(`No se pudieron eliminar archivos en Supabase Storage: ${error.message}`);
    }
  }
  return uniquePaths.length;
}

/**
 * Elimina de forma integral un curso de `Cursos_Pago_Unico`:
 * 1) Clases en vivo vinculadas al `course_id` (incluidos archivos de diapositivas en `live-classes/`).
 * 2) Materiales y archivos del curso en Supabase Storage y `public.course_materials`.
 * 3) Portada subida mediante `/api/course-covers/` (si no está compartida con otro curso).
 * 4) Documento del curso en Firestore (`Cursos_Pago_Unico/{courseId}`).
 *
 * @param {{ courseId: string, fallbackImageUrl?: string|null }} params
 */
export async function deletePagoUnicoCourseData({ courseId, fallbackImageUrl = null }) {
  if (!courseId || typeof courseId !== 'string') {
    throw new Error('ID de curso no válido.');
  }

  // Leer portada desde Firestore antes de borrar registros
  let resolvedImageUrl = fallbackImageUrl || null;
  let courseSnap = null;
  if (adminDb) {
    courseSnap = await adminDb.collection('Cursos_Pago_Unico').doc(courseId).get();
    if (courseSnap.exists) {
      resolvedImageUrl = courseSnap.data()?.imageUrl || resolvedImageUrl;
    }
  }

  let deletedSchedulesCount = 0;
  let deletedMaterialsCount = 0;
  let deletedFilesCount = 0;
  let deletedCoverCount = 0;
  let deletedFirestoreDoc = false;

  // 1. Limpiar programaciones de clases en vivo vinculadas al curso (y sus archivos en live-classes/)
  const { data: linkedSchedules, error: schFetchErr } = await supabaseAdmin
    .from('live_class_schedules')
    .select('id')
    .eq('course_id', courseId);

  if (schFetchErr) throw schFetchErr;

  const scheduleIds = (linkedSchedules || []).map((s) => s.id).filter(Boolean);
  if (scheduleIds.length > 0) {
    const liveCleanup = await cleanupManagedMaterialsForSchedules(scheduleIds);
    deletedFilesCount += liveCleanup.deletedFilesCount;
    deletedMaterialsCount += liveCleanup.deletedMaterialsCount;

    const { error: delSchErr, count: delSchCount } = await supabaseAdmin
      .from('live_class_schedules')
      .delete({ count: 'exact' })
      .in('id', scheduleIds);

    if (delSchErr) throw delSchErr;
    deletedSchedulesCount = delSchCount ?? scheduleIds.length;

    await broadcastScheduleChange('deleted').catch(() => {});
  }

  // 2. Limpiar todos los materiales restantes del curso en course_materials + Storage
  const { data: courseMats, error: matsFetchErr } = await supabaseAdmin
    .from('course_materials')
    .select('id, source_type, storage_path')
    .eq('course_id', courseId);

  if (matsFetchErr) throw matsFetchErr;

  if (courseMats?.length) {
    const matIds = courseMats.map((m) => m.id);

    // Defensa extra: verificar si alguna sesión externa aún referenciara alguno de estos IDs
    let stillReferencedIds = new Set();
    const { data: liveRefs, error: refsErr } = await supabaseAdmin
      .from('live_class_resources')
      .select('slides_material_id')
      .in('slides_material_id', matIds);

    if (!refsErr && liveRefs?.length) {
      stillReferencedIds = new Set(liveRefs.map((r) => r.slides_material_id).filter(Boolean));
    }

    const deletableMats = courseMats.filter((m) => !stillReferencedIds.has(m.id));
    const storagePaths = deletableMats
      .filter((m) => m.source_type === 'supabase_storage' && m.storage_path)
      .map((m) => m.storage_path);

    if (storagePaths.length > 0) {
      deletedFilesCount += await removeStoragePathsStrict(storagePaths);
    }

    const deletableIds = deletableMats.map((m) => m.id);
    if (deletableIds.length > 0) {
      const { error: delMatErr, count: delMatCount } = await supabaseAdmin
        .from('course_materials')
        .delete({ count: 'exact' })
        .in('id', deletableIds);
      if (delMatErr) throw delMatErr;
      deletedMaterialsCount += delMatCount ?? deletableIds.length;
    }
  }

  // 3. Limpiar portada subida a Supabase Storage si ningún otro curso comparte la misma URL
  const coverPath = extractManagedCoverStoragePath(resolvedImageUrl);
  if (coverPath) {
    let isCoverShared = false;
    if (adminDb && resolvedImageUrl) {
      const { docs } = await adminDb
        .collection('Cursos_Pago_Unico')
        .where('imageUrl', '==', resolvedImageUrl)
        .limit(2)
        .get();
      isCoverShared = docs.some((d) => d.id !== courseId);
    }

    if (!isCoverShared) {
      deletedCoverCount = await removeStoragePathsStrict([coverPath]);
      deletedFilesCount += deletedCoverCount;
    }
  }

  // 4. Eliminar documento en Firestore (siempre al final, una vez limpio Supabase)
  if (adminDb) {
    await adminDb.collection('Cursos_Pago_Unico').doc(courseId).delete();
    deletedFirestoreDoc = true;
  }

  return {
    ok: true,
    courseId,
    deletedFirestoreDoc,
    deletedSchedulesCount,
    deletedMaterialsCount,
    deletedFilesCount,
    deletedCoverCount,
  };
}
