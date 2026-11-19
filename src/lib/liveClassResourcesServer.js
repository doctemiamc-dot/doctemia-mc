import { supabaseAdmin } from '@/lib/supabase-admin';
import { MATERIAL_BUCKET, toDrivePreviewUrl } from '@/lib/materialUtils';
import { cleanYouTubeUrl } from '@/lib/youtubeUtils';

/**
 * Normaliza y valida un enlace http/https opcional.
 * @param {string|null|undefined} rawUrl
 * @param {Object} [options]
 * @param {boolean} [options.isRecording=false]
 * @returns {{ ok: boolean, value: string|null, error?: string }}
 */
export function normalizeOptionalHttpUrl(rawUrl, { isRecording = false } = {}) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    return {
      ok: false,
      value: null,
      error: 'El enlace debe comenzar con https:// o http://',
    };
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        ok: false,
        value: null,
        error: 'Solo se permiten enlaces http:// o https://.',
      };
    }
    const finalUrl = isRecording ? cleanYouTubeUrl(parsed.toString()) : parsed.toString();
    return { ok: true, value: finalUrl };
  } catch {
    return {
      ok: false,
      value: null,
      error: 'El enlace ingresado no es una URL válida.',
    };
  }
}

/**
 * Obtiene las filas de `live_class_resources` junto con un Map de `course_materials` hidratados
 * (`signed_url`, `proxy_url`, `preview_url`) listo para renderizarse en `ProtectedDocumentViewer`.
 * @param {string[]} [scheduleIds]
 * @returns {Promise<{ resources: Array, materialMap: Map<string, Object> }>}
 */
export async function fetchLiveClassResourcesAndMaterials(scheduleIds = null) {
  let query = supabaseAdmin
    .from('live_class_resources')
    .select('*')
    .order('occurrence_date', { ascending: false });

  if (Array.isArray(scheduleIds)) {
    if (scheduleIds.length === 0) {
      return { resources: [], materialMap: new Map() };
    }
    query = query.in('schedule_id', scheduleIds);
  }

  const { data: resources, error: resErr } = await query;
  if (resErr) {
    // Tolerancia defensiva si algún entorno aún no corrió la migración 002
    if (resErr.code === '42P01' || resErr.code === 'PGRST205') {
      return { resources: [], materialMap: new Map() };
    }
    throw resErr;
  }

  const materialIds = Array.from(
    new Set((resources || []).map((r) => r.slides_material_id).filter(Boolean))
  );
  const materialMap = await hydrateMaterialMapByIds(materialIds);

  return { resources: resources || [], materialMap };
}

/**
 * Hidrata un conjunto de IDs de `course_materials` en un `Map<id, material>`.
 * @param {string[]} materialIds
 * @returns {Promise<Map<string, Object>>}
 */
export async function hydrateMaterialMapByIds(materialIds = []) {
  const materialMap = new Map();
  if (!Array.isArray(materialIds) || materialIds.length === 0) {
    return materialMap;
  }

  const { data: materials, error: matErr } = await supabaseAdmin
    .from('course_materials')
    .select('id, title, description, material_type, source_type, storage_path, file_url, file_name, mime_type, file_size, especialidad_nombre, subtema, is_active')
    .in('id', materialIds);

  if (matErr) throw matErr;
  if (!materials?.length) return materialMap;

  const storagePaths = Array.from(
    new Set(
      materials
        .filter((m) => m.source_type === 'supabase_storage' && m.storage_path)
        .map((m) => m.storage_path)
    )
  );

  const signedByPath = new Map();
  if (storagePaths.length > 0) {
    const { data: signedList } = await supabaseAdmin.storage
      .from(MATERIAL_BUCKET)
      .createSignedUrls(storagePaths, 3600);
    if (Array.isArray(signedList)) {
      for (const item of signedList) {
        if (item?.path && item?.signedUrl) {
          signedByPath.set(item.path, item.signedUrl);
        }
      }
    }
  }

  for (const m of materials) {
    const isStorage = m.source_type === 'supabase_storage';
    materialMap.set(m.id, {
      ...m,
      signed_url: isStorage && m.storage_path ? signedByPath.get(m.storage_path) || null : null,
      proxy_url: isStorage ? `/api/materials/file/${m.id}` : null,
      preview_url: isStorage
        ? `/api/materials/file/${m.id}`
        : m.source_type === 'google_drive_legacy'
          ? toDrivePreviewUrl(m.file_url)
          : m.file_url,
    });
  }

  return materialMap;
}

/**
 * Elimina de Storage (`materials`) y de `course_materials` un archivo de diapositiva
 * subido en `live-classes/...` únicamente cuando ya ninguna sesión lo referencia.
 * Verifica explícitamente errores de Supabase Storage para no dejar archivos huérfanos.
 * @param {string|null|undefined} materialId
 * @returns {Promise<{ deletedFilesCount: number, deletedMaterialsCount: number }>}
 */
export async function deleteManagedLiveClassMaterialIfOrphaned(materialId) {
  if (!materialId) {
    return { deletedFilesCount: 0, deletedMaterialsCount: 0 };
  }

  const { count, error: countErr } = await supabaseAdmin
    .from('live_class_resources')
    .select('id', { count: 'exact', head: true })
    .eq('slides_material_id', materialId);

  if (countErr) throw countErr;
  if ((count || 0) > 0) {
    return { deletedFilesCount: 0, deletedMaterialsCount: 0 };
  }

  const { data: mat, error: fetchErr } = await supabaseAdmin
    .from('course_materials')
    .select('id, source_type, storage_path')
    .eq('id', materialId)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (!mat || mat.source_type !== 'supabase_storage' || !mat.storage_path?.startsWith('live-classes/')) {
    return { deletedFilesCount: 0, deletedMaterialsCount: 0 };
  }

  const { error: rmErr } = await supabaseAdmin.storage
    .from(MATERIAL_BUCKET)
    .remove([mat.storage_path]);
  if (rmErr) {
    throw new Error(`No se pudo eliminar el archivo de Storage (${mat.storage_path}): ${rmErr.message}`);
  }

  const { error: delErr } = await supabaseAdmin
    .from('course_materials')
    .delete()
    .eq('id', materialId);
  if (delErr) {
    throw new Error(`No se pudo eliminar el registro en course_materials (${materialId}): ${delErr.message}`);
  }

  return { deletedFilesCount: 1, deletedMaterialsCount: 1 };
}

/**
 * Antes de eliminar programaciones (y su cascada en `live_class_resources`), elimina
 * sus archivos en Storage (`live-classes/...`) y registros en `course_materials` siempre que
 * no sean referenciados por otras programaciones restantes.
 * @param {string[]} scheduleIds
 * @returns {Promise<{ deletedFilesCount: number, deletedMaterialsCount: number }>}
 */
export async function cleanupManagedMaterialsForSchedules(scheduleIds = []) {
  if (!Array.isArray(scheduleIds) || scheduleIds.length === 0) {
    return { deletedFilesCount: 0, deletedMaterialsCount: 0 };
  }

  const { data: rows, error } = await supabaseAdmin
    .from('live_class_resources')
    .select('id, schedule_id, slides_material_id')
    .in('schedule_id', scheduleIds)
    .not('slides_material_id', 'is', null);

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { deletedFilesCount: 0, deletedMaterialsCount: 0 };
    }
    throw error;
  }
  if (!rows?.length) {
    return { deletedFilesCount: 0, deletedMaterialsCount: 0 };
  }

  const candidateIds = Array.from(new Set(rows.map((r) => r.slides_material_id).filter(Boolean)));
  if (candidateIds.length === 0) {
    return { deletedFilesCount: 0, deletedMaterialsCount: 0 };
  }

  // Verificar si alguna otra programación fuera de `scheduleIds` aún referencia alguno de estos materiales
  const scheduleIdSet = new Set(scheduleIds);
  const { data: allRefs, error: refsErr } = await supabaseAdmin
    .from('live_class_resources')
    .select('schedule_id, slides_material_id')
    .in('slides_material_id', candidateIds);

  if (refsErr) throw refsErr;

  const stillReferencedIds = new Set(
    (allRefs || [])
      .filter((r) => !scheduleIdSet.has(r.schedule_id))
      .map((r) => r.slides_material_id)
  );

  const deletableMaterialIds = candidateIds.filter((id) => !stillReferencedIds.has(id));
  if (deletableMaterialIds.length === 0) {
    return { deletedFilesCount: 0, deletedMaterialsCount: 0 };
  }

  const { data: mats, error: matsErr } = await supabaseAdmin
    .from('course_materials')
    .select('id, source_type, storage_path')
    .in('id', deletableMaterialIds);

  if (matsErr) throw matsErr;

  const owned = (mats || []).filter(
    (m) => m.source_type === 'supabase_storage' && m.storage_path?.startsWith('live-classes/')
  );
  if (owned.length === 0) {
    return { deletedFilesCount: 0, deletedMaterialsCount: 0 };
  }

  const paths = owned.map((m) => m.storage_path).filter(Boolean);
  if (paths.length > 0) {
    const { error: rmErr } = await supabaseAdmin.storage.from(MATERIAL_BUCKET).remove(paths);
    if (rmErr) {
      throw new Error(`No se pudieron borrar archivos de Storage: ${rmErr.message}`);
    }
  }

  const ownedIds = owned.map((m) => m.id);
  const { error: delMatErr } = await supabaseAdmin
    .from('course_materials')
    .delete()
    .in('id', ownedIds);
  if (delMatErr) {
    throw new Error(`No se pudieron eliminar registros en course_materials: ${delMatErr.message}`);
  }

  return {
    deletedFilesCount: paths.length,
    deletedMaterialsCount: ownedIds.length,
  };
}
