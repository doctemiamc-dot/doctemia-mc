import { NextResponse } from 'next/server';
import { verifySessionUser } from '@/lib/apiAuth';
import { db as adminDb } from '@/lib/firebase-admin';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { pgPool } from '@/lib/postgres';
import { broadcastScheduleChange } from '@/lib/scheduleBroadcast';
import {
  MATERIAL_BUCKET,
  inferMaterialType,
  sanitizeStorageFileName,
  toDrivePreviewUrl,
  validateMaterialFile,
} from '@/lib/materialUtils';

/**
 * Normaliza URLs de previsualización de forma ligera sin firmar masivamente en Storage.
 */
function mapMaterialUrlsLight(row) {
  if (row.source_type === 'supabase_storage') {
    return {
      ...row,
      signed_url: null,
      proxy_url: `/api/materials/file/${row.id}`,
      preview_url: `/api/materials/file/${row.id}`,
    };
  }
  const previewUrl =
    row.source_type === 'google_drive_legacy'
      ? toDrivePreviewUrl(row.file_url)
      : row.file_url;
  return {
    ...row,
    signed_url: null,
    proxy_url: null,
    preview_url: previewUrl,
  };
}

const COURSE_ACTIVE_CACHE_TTL_MS = 60 * 1000; // 60 s en memoria del servidor
const courseActiveCache = new Map();

function getCachedCourseActive(courseId) {
  const entry = courseActiveCache.get(courseId);
  if (!entry) return null;
  if (Date.now() - entry.ts >= COURSE_ACTIVE_CACHE_TTL_MS) {
    courseActiveCache.delete(courseId);
    return null;
  }
  return entry.isActive;
}

function setCachedCourseActive(courseId, isActive) {
  if (!courseId) return;
  if (courseActiveCache.size > 300) {
    const oldestKey = courseActiveCache.keys().next().value;
    if (oldestKey) courseActiveCache.delete(oldestKey);
  }
  courseActiveCache.set(courseId, { ts: Date.now(), isActive: Boolean(isActive) });
}

/**
 * Verifica si un curso específico está activo en Firestore (1 sola lectura acotada, cacheada 60 s).
 */
async function isCourseActiveInFirestore(courseId) {
  if (!courseId || !adminDb) return true;
  const cached = getCachedCourseActive(courseId);
  if (cached !== null) return cached;

  const snap = await adminDb.collection('Cursos_Pago_Unico').doc(courseId).get();
  const isActive = snap.exists && snap.data()?.isActive !== false;
  setCachedCourseActive(courseId, isActive);
  return isActive;
}

/**
 * Filtra filas excluyendo materiales vinculados a cursos inactivos o inexistentes en Firestore.
 */
async function filterMaterialsByActiveCourses(rows = []) {
  if (!adminDb || !Array.isArray(rows) || rows.length === 0) return rows;
  const uniqueCourseIds = [...new Set(rows.map((r) => r.course_id).filter(Boolean))];
  if (uniqueCourseIds.length === 0) return rows;

  const activeSet = new Set();
  const missingIds = [];

  for (const id of uniqueCourseIds) {
    const cached = getCachedCourseActive(id);
    if (cached === true) {
      activeSet.add(id);
    } else if (cached === null) {
      missingIds.push(id);
    }
  }

  const CHUNK_SIZE = 100;
  for (let i = 0; i < missingIds.length; i += CHUNK_SIZE) {
    const chunk = missingIds.slice(i, i + CHUNK_SIZE);
    const refs = chunk.map((id) => adminDb.collection('Cursos_Pago_Unico').doc(id));
    const snaps = await adminDb.getAll(...refs, { fieldMask: ['isActive'] });
    snaps.forEach((snap) => {
      const isActive = snap.exists && snap.data()?.isActive !== false;
      setCachedCourseActive(snap.id, isActive);
      if (isActive) {
        activeSet.add(snap.id);
      }
    });
  }

  return rows.filter((row) => !row.course_id || activeSet.has(row.course_id));
}

async function getInactiveCourseIds() {
  if (!adminDb) return [];
  const snap = await adminDb
    .collection('Cursos_Pago_Unico')
    .where('isActive', '==', false)
    .select()
    .get();
  return snap.docs.map((d) => d.id);
}

const ORIGIN_EXPR = `
  CASE
    WHEN cm.storage_path LIKE 'live-classes/%' OR lc.schedule_id IS NOT NULL THEN 'live_class'
    WHEN cm.course_id IS NOT NULL THEN 'course'
    ELSE 'library'
  END
`;

export async function GET(request) {
  const authResult = await verifySessionUser(request, { requirePagoUnico: true });
  if (!authResult.ok) return authResult.response;

  try {
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get('course_id');
    const especialidadId = searchParams.get('especialidad_id');
    const subtema = searchParams.get('subtema');
    const materialType = searchParams.get('material_type');
    const sourceType = searchParams.get('source_type');
    const origin = searchParams.get('origin'); // 'all' | 'courses' | 'live_classes' | 'library'
    const isActiveParam = searchParams.get('is_active'); // 'true' | 'false'
    const videoUrl = searchParams.get('video_url');
    const search = searchParams.get('search')?.trim();
    const sortParam = searchParams.get('sort') || 'newest';
    const includeInactive = authResult.isAdmin && searchParams.get('include_inactive') === 'true';

    const pageParam = searchParams.get('page');
    const isPaginated = pageParam !== null;

    // Si filtran un curso puntual y no se permiten inactivos, validar solo 1 doc y cortar temprano si está oculto
    if (!includeInactive && courseId) {
      const courseIsActive = await isCourseActiveInFirestore(courseId);
      if (!courseIsActive) {
        if (isPaginated) {
          return NextResponse.json(
            {
              materials: [],
              pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1 },
              counts: { all: 0, courses: 0, live_classes: 0, library: 0, hidden: 0 },
            },
            { status: 200 }
          );
        }
        return NextResponse.json({ materials: [] }, { status: 200 });
      }
    }

    const conditions = [];
    const params = [];
    const addParam = (val) => {
      params.push(val);
      return `$${params.length}`;
    };

    if (!includeInactive) {
      conditions.push('cm.is_active = true');
      // En modo paginado global necesitamos excluir cursos inactivos en SQL para que COUNT y OFFSET sean exactos;
      // en modo no paginado global (!courseId), filterMaterialsByActiveCourses filtra en una sola lectura batch.
      if (isPaginated && !courseId) {
        const inactiveCourseIds = await getInactiveCourseIds();
        if (inactiveCourseIds.length > 0) {
          const pInactive = addParam(inactiveCourseIds);
          conditions.push(`(cm.course_id IS NULL OR NOT (cm.course_id = ANY(${pInactive}::text[])))`);
        }
      }
    } else if (isActiveParam === 'true') {
      conditions.push('cm.is_active = true');
    } else if (isActiveParam === 'false') {
      conditions.push('cm.is_active = false');
    }

    if (courseId) conditions.push(`cm.course_id = ${addParam(courseId)}`);
    if (especialidadId) conditions.push(`cm.especialidad_id = ${addParam(especialidadId)}`);
    if (subtema) conditions.push(`cm.subtema = ${addParam(subtema)}`);
    if (materialType) conditions.push(`cm.material_type = ${addParam(materialType)}`);
    if (sourceType) conditions.push(`cm.source_type = ${addParam(sourceType)}`);
    if (videoUrl) conditions.push(`cm.video_url = ${addParam(videoUrl)}`);

    if (origin === 'live_classes') {
      conditions.push(`(cm.storage_path LIKE 'live-classes/%' OR lc.schedule_id IS NOT NULL)`);
    } else if (origin === 'courses') {
      conditions.push(
        `cm.course_id IS NOT NULL AND (cm.storage_path IS NULL OR cm.storage_path NOT LIKE 'live-classes/%') AND lc.schedule_id IS NULL`
      );
    } else if (origin === 'library') {
      conditions.push(
        `cm.course_id IS NULL AND (cm.storage_path IS NULL OR cm.storage_path NOT LIKE 'live-classes/%') AND lc.schedule_id IS NULL`
      );
    }

    if (search) {
      const p = addParam(`%${search}%`);
      conditions.push(
        `(cm.title ILIKE ${p} OR COALESCE(cm.description, '') ILIKE ${p} OR COALESCE(cm.subtema, '') ILIKE ${p} OR COALESCE(cm.especialidad_nombre, '') ILIKE ${p} OR COALESCE(cm.file_name, '') ILIKE ${p} OR COALESCE(lc.live_class_title, '') ILIKE ${p})`
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy =
      sortParam === 'oldest'
        ? 'cm.created_at ASC'
        : sortParam === 'title_asc'
          ? 'LOWER(cm.title) ASC, cm.created_at DESC'
          : sortParam === 'largest'
            ? 'cm.file_size DESC NULLS LAST, cm.created_at DESC'
            : 'cm.created_at DESC';

    const joinSql = `
      LEFT JOIN LATERAL (
        SELECT
          r.schedule_id,
          r.occurrence_date::text AS occurrence_date,
          r.recording_url AS recording_url,
          s.titulo AS live_class_title,
          s.expositor AS live_class_expositor
        FROM public.live_class_resources r
        LEFT JOIN public.live_class_schedules s ON s.id = r.schedule_id
        WHERE r.slides_material_id = cm.id
        ORDER BY r.occurrence_date DESC
        LIMIT 1
      ) lc ON true
    `;

    const splitLiveClassRow = (row) => {
      const {
        lc_schedule_id,
        lc_occurrence_date,
        lc_recording_url,
        lc_title,
        lc_expositor,
        ...rest
      } = row;

      return {
        row: rest,
        live_class_info: lc_schedule_id
          ? {
              schedule_id: lc_schedule_id,
              occurrence_date: lc_occurrence_date,
              recording_url: lc_recording_url || null,
              titulo: lc_title,
              expositor: lc_expositor,
            }
          : null,
      };
    };

    // Modo paginado en servidor para panel admin escalable (evita traer miles de filas o pre-firmar todo Storage)
    if (isPaginated) {
      const page = Math.max(1, Number.parseInt(pageParam, 10) || 1);
      const rawPageSize = Number.parseInt(searchParams.get('pageSize') || '24', 10) || 24;
      const pageSize = Math.min(Math.max(rawPageSize, 1), 100);
      const offset = (page - 1) * pageSize;

      const dataParams = [...params, pageSize, offset];
      const limitPlaceholder = `$${params.length + 1}`;
      const offsetPlaceholder = `$${params.length + 2}`;

      const dataSql = `
        SELECT
          cm.*,
          ${ORIGIN_EXPR} AS origin_type,
          lc.schedule_id AS lc_schedule_id,
          lc.occurrence_date AS lc_occurrence_date,
          lc.recording_url AS lc_recording_url,
          lc.live_class_title AS lc_title,
          lc.live_class_expositor AS lc_expositor
        FROM public.course_materials cm
        ${joinSql}
        ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `;

      const countSql = `
        SELECT COUNT(*)::int AS total
        FROM public.course_materials cm
        ${joinSql}
        ${whereClause}
      `;

      const globalScopeWhere = includeInactive ? '' : 'WHERE cm.is_active = true';
      const summaryCountsSql = `
        SELECT
          COUNT(*)::int AS total_all,
          COUNT(*) FILTER (
            WHERE cm.storage_path LIKE 'live-classes/%' OR lc.schedule_id IS NOT NULL
          )::int AS live_classes,
          COUNT(*) FILTER (
            WHERE cm.course_id IS NOT NULL
              AND (cm.storage_path IS NULL OR cm.storage_path NOT LIKE 'live-classes/%')
              AND lc.schedule_id IS NULL
          )::int AS courses,
          COUNT(*) FILTER (
            WHERE cm.course_id IS NULL
              AND (cm.storage_path IS NULL OR cm.storage_path NOT LIKE 'live-classes/%')
              AND lc.schedule_id IS NULL
          )::int AS library,
          COUNT(*) FILTER (WHERE cm.is_active = false)::int AS hidden
        FROM public.course_materials cm
        ${joinSql}
        ${globalScopeWhere}
      `;

      const [dataRes, countRes, countsRes] = await Promise.all([
        pgPool.query(dataSql, dataParams),
        pgPool.query(countSql, params),
        pgPool.query(summaryCountsSql),
      ]);

      const total = countRes.rows[0]?.total || 0;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const cRow = countsRes.rows[0] || {};

      const materials = dataRes.rows.map((r) => {
        const { row, live_class_info } = splitLiveClassRow(r);
        return {
          ...mapMaterialUrlsLight(row),
          live_class_info,
        };
      });

      return NextResponse.json(
        {
          materials,
          pagination: {
            page,
            pageSize,
            total,
            totalPages,
          },
          counts: {
            all: cRow.total_all || 0,
            courses: cRow.courses || 0,
            live_classes: cRow.live_classes || 0,
            library: cRow.library || 0,
            hidden: cRow.hidden || 0,
          },
        },
        { status: 200 }
      );
    }

    // Modo compatible heredado (para listas acotadas de cursos / biblioteca estudiante) con origen de clase en vivo
    const studentSql = `
      SELECT
        cm.*,
        ${ORIGIN_EXPR} AS origin_type,
        lc.schedule_id AS lc_schedule_id,
        lc.occurrence_date AS lc_occurrence_date,
        lc.recording_url AS lc_recording_url,
        lc.live_class_title AS lc_title,
        lc.live_class_expositor AS lc_expositor
      FROM public.course_materials cm
      ${joinSql}
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT 500
    `;

    const studentRes = await pgPool.query(studentSql, params);
    const liveInfoById = new Map();
    const baseRows = studentRes.rows.map((r) => {
      const { row, live_class_info } = splitLiveClassRow(r);
      liveInfoById.set(row.id, live_class_info);
      return row;
    });

    const visibleRows =
      includeInactive || courseId
        ? baseRows
        : await filterMaterialsByActiveCourses(baseRows);
    const enriched = visibleRows.map((row) => ({
      ...mapMaterialUrlsLight(row),
      live_class_info: liveInfoById.get(row.id) || null,
    }));
    return NextResponse.json({ materials: enriched }, { status: 200 });
  } catch (error) {
    console.error('Error en GET /api/materials:', error);
    return NextResponse.json(
      { error: 'Error al consultar materiales.', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const contentType = request.headers.get('content-type') || '';

    // Caso 1: Subida de uno o varios archivos hacia Supabase Storage (multipart/form-data)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const files = formData.getAll('files').filter((f) => f && typeof f === 'object' && f.size > 0);

      if (files.length === 0) {
        return NextResponse.json({ error: 'Debes adjuntar al menos un archivo.' }, { status: 400 });
      }

      const baseTitle = String(formData.get('title') || '').trim();
      const description = String(formData.get('description') || '').trim() || null;
      const requestedType = String(formData.get('material_type') || '').trim();
      let itemsMeta = [];
      const rawItemsMeta = formData.get('items_meta');
      if (typeof rawItemsMeta === 'string' && rawItemsMeta.trim()) {
        try {
          const parsed = JSON.parse(rawItemsMeta);
          if (Array.isArray(parsed)) itemsMeta = parsed;
        } catch {
          itemsMeta = [];
        }
      }
      const especialidadId = String(formData.get('especialidad_id') || '').trim() || null;
      const especialidadNombre = String(formData.get('especialidad_nombre') || '').trim() || null;
      const subtema = String(formData.get('subtema') || '').trim() || null;
      const courseId = String(formData.get('course_id') || '').trim() || null;
      const moduleIndexRaw = formData.get('module_index');
      const moduleIndex =
        moduleIndexRaw !== null && String(moduleIndexRaw).trim() !== ''
          ? Number(moduleIndexRaw)
          : null;
      const videoUrl = String(formData.get('video_url') || '').trim() || null;

      // Validar todos los archivos primero (rechazar videos y formatos no permitidos)
      for (const file of files) {
        const validation = validateMaterialFile(file.name, file.type);
        if (!validation.valid) {
          return NextResponse.json({ error: `${file.name}: ${validation.error}` }, { status: 400 });
        }
      }

      const uploadedPaths = [];
      const rowsToInsert = new Array(files.length);

      try {
        const folder = [especialidadId || 'general', courseId || 'sin-curso'].join('/');
        const UPLOAD_CONCURRENCY = 3;

        for (let start = 0; start < files.length; start += UPLOAD_CONCURRENCY) {
          const batchIndices = [];
          for (let i = start; i < Math.min(files.length, start + UPLOAD_CONCURRENCY); i++) {
            batchIndices.push(i);
          }

          await Promise.all(
            batchIndices.map(async (idx) => {
              const file = files[idx];
              const meta = itemsMeta[idx] && typeof itemsMeta[idx] === 'object' ? itemsMeta[idx] : {};
              const cleanName = sanitizeStorageFileName(file.name);
              const storagePath = `${folder}/${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 8)}_${cleanName}`;

              const arrayBuffer = await file.arrayBuffer();
              const { error: uploadError } = await supabaseAdmin.storage
                .from(MATERIAL_BUCKET)
                .upload(storagePath, arrayBuffer, {
                  contentType: file.type || 'application/octet-stream',
                  upsert: false,
                });

              if (uploadError) throw uploadError;
              uploadedPaths.push(storagePath);

              const defaultTitle = file.name.replace(/\.[^/.]+$/, '');
              const metaTitle = typeof meta.title === 'string' ? meta.title.trim() : '';
              const finalTitle =
                metaTitle ||
                (files.length === 1 && baseTitle
                  ? baseTitle
                  : baseTitle
                    ? `${baseTitle} - ${defaultTitle}`
                    : defaultTitle);

              const metaType = typeof meta.material_type === 'string' ? meta.material_type.trim() : '';
              const materialType = ['slides', 'summary', 'pdf'].includes(metaType)
                ? metaType
                : ['slides', 'summary', 'pdf'].includes(requestedType)
                  ? requestedType
                  : inferMaterialType(file.name, file.type);

              rowsToInsert[idx] = {
                title: finalTitle,
                description,
                material_type: materialType,
                source_type: 'supabase_storage',
                storage_path: storagePath,
                file_url: null,
                file_name: file.name,
                mime_type: file.type || 'application/pdf',
                file_size: file.size,
                especialidad_id: especialidadId,
                especialidad_nombre: especialidadNombre,
                subtema,
                course_id: courseId,
                module_index: Number.isFinite(moduleIndex) ? moduleIndex : null,
                video_url: videoUrl,
                uploaded_by: authResult.uid,
                is_active: true,
              };
            })
          );
        }

        const { data: insertedRows, error: insertError } = await supabaseAdmin
          .from('course_materials')
          .insert(rowsToInsert)
          .select();

        if (insertError) throw insertError;

        const enriched = (insertedRows || []).map(mapMaterialUrlsLight);
        return NextResponse.json({ materials: enriched }, { status: 201 });
      } catch (innerErr) {
        // Rollback de archivos subidos si falla la inserción en BD o algún lote
        if (uploadedPaths.length > 0) {
          await supabaseAdmin.storage.from(MATERIAL_BUCKET).remove(uploadedPaths).catch(() => null);
        }
        throw innerErr;
      }
    }

    // Caso 2: Registro mediante enlace externo o Google Drive legacy (JSON)
    const body = await request.json();
    const {
      title,
      description = null,
      material_type = 'pdf',
      source_type = 'google_drive_legacy',
      file_url,
      especialidad_id = null,
      especialidad_nombre = null,
      subtema = null,
      course_id = null,
      module_index = null,
      video_url = null,
    } = body;

    if (!title?.trim() || !file_url?.trim()) {
      return NextResponse.json(
        { error: 'Título y enlace del material son obligatorios.' },
        { status: 400 }
      );
    }

    const { data: inserted, error } = await supabaseAdmin
      .from('course_materials')
      .insert({
        title: title.trim(),
        description: description?.trim() || null,
        material_type: ['slides', 'summary', 'pdf'].includes(material_type) ? material_type : 'pdf',
        source_type: ['google_drive_legacy', 'external_url'].includes(source_type)
          ? source_type
          : 'google_drive_legacy',
        storage_path: null,
        file_url: file_url.trim(),
        file_name: null,
        mime_type: null,
        file_size: null,
        especialidad_id: especialidad_id || null,
        especialidad_nombre: especialidad_nombre || null,
        subtema: subtema || null,
        course_id: course_id || null,
        module_index: module_index !== null && module_index !== '' ? Number(module_index) : null,
        video_url: video_url || null,
        uploaded_by: authResult.uid,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    const enriched = [mapMaterialUrlsLight(inserted)];
    return NextResponse.json({ material: enriched[0], materials: enriched }, { status: 201 });
  } catch (error) {
    console.error('Error en POST /api/materials:', error);
    return NextResponse.json(
      { error: 'No se pudo guardar el material.', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids)
      ? Array.from(
          new Set(body.ids.filter((id) => typeof id === 'string' && id.trim().length > 0))
        )
      : [];

    if (ids.length === 0) {
      return NextResponse.json(
        { error: 'Selecciona al menos un material para eliminar.' },
        { status: 400 }
      );
    }

    const { data: existingRows, error: fetchErr } = await supabaseAdmin
      .from('course_materials')
      .select('id, source_type, storage_path')
      .in('id', ids);

    if (fetchErr) throw fetchErr;
    if (!existingRows?.length) {
      return NextResponse.json({ ok: true, deletedCount: 0, deletedFilesCount: 0 }, { status: 200 });
    }

    const storagePaths = Array.from(
      new Set(
        existingRows
          .filter((r) => r.source_type === 'supabase_storage' && r.storage_path)
          .map((r) => r.storage_path)
      )
    );

    const CHUNK_SIZE = 100;
    for (let i = 0; i < storagePaths.length; i += CHUNK_SIZE) {
      const chunk = storagePaths.slice(i, i + CHUNK_SIZE);
      const { error: rmErr } = await supabaseAdmin.storage.from(MATERIAL_BUCKET).remove(chunk);
      if (rmErr) {
        throw new Error(`No se pudieron borrar archivos del Storage: ${rmErr.message}`);
      }
    }

    const targetIds = existingRows.map((r) => r.id);
    const { error: delErr, count } = await supabaseAdmin
      .from('course_materials')
      .delete({ count: 'exact' })
      .in('id', targetIds);

    if (delErr) throw delErr;

    const touchedLiveClass = existingRows.some((r) =>
      r.storage_path?.startsWith('live-classes/')
    );
    if (touchedLiveClass) {
      const { error: orphanErr } = await supabaseAdmin
        .from('live_class_resources')
        .delete()
        .is('slides_material_id', null)
        .is('recording_url', null)
        .is('slides_url', null)
        .is('notes', null);
      if (!orphanErr) {
        await broadcastScheduleChange('resource_updated').catch(() => {});
      }
    }

    return NextResponse.json(
      {
        ok: true,
        deletedCount: count ?? targetIds.length,
        deletedFilesCount: storagePaths.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error en DELETE /api/materials:', error);
    return NextResponse.json(
      { error: 'No se pudieron eliminar los materiales seleccionados.', details: error.message },
      { status: 500 }
    );
  }
}
