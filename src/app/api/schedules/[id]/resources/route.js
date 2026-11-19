import { NextResponse } from 'next/server';
import { verifySessionUser } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  MATERIAL_BUCKET,
  inferMaterialType,
  sanitizeStorageFileName,
  validateMaterialFile,
} from '@/lib/materialUtils';
import { broadcastScheduleChange } from '@/lib/scheduleBroadcast';
import {
  deleteManagedLiveClassMaterialIfOrphaned,
  hydrateMaterialMapByIds,
  normalizeOptionalHttpUrl,
} from '@/lib/liveClassResourcesServer';

function isValidDateStr(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

async function buildEnrichedResource(row) {
  if (!row) return null;
  let slidesMaterial = null;
  if (row.slides_material_id) {
    const matMap = await hydrateMaterialMapByIds([row.slides_material_id]);
    slidesMaterial = matMap.get(row.slides_material_id) || null;
  }
  return {
    ...row,
    slides_material: slidesMaterial,
    has_recording: Boolean(row.recording_url),
    has_slides: Boolean(row.slides_material_id || row.slides_url),
  };
}

export async function GET(request, context) {
  const authResult = await verifySessionUser(request, { requirePagoUnico: true });
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const occurrenceDate = searchParams.get('occurrence_date');

    if (!isValidDateStr(occurrenceDate)) {
      return NextResponse.json(
        { error: 'Debes indicar occurrence_date en formato YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('live_class_resources')
      .select('*')
      .eq('schedule_id', id)
      .eq('occurrence_date', occurrenceDate.trim())
      .maybeSingle();

    if (error) throw error;

    const resource = await buildEnrichedResource(data);
    return NextResponse.json({ resource }, { status: 200 });
  } catch (error) {
    console.error('Error en GET /api/schedules/[id]/resources:', error);
    return NextResponse.json(
      { error: 'No se pudieron consultar los recursos de la clase.', details: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request, context) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;

    const { data: schedule, error: schErr } = await supabaseAdmin
      .from('live_class_schedules')
      .select('id, titulo, expositor, course_id, especialidad_id, especialidad_nombre')
      .eq('id', id)
      .maybeSingle();

    if (schErr) throw schErr;
    if (!schedule) {
      return NextResponse.json({ error: 'Programación de clase no encontrada.' }, { status: 404 });
    }

    const contentType = request.headers.get('content-type') || '';
    let occurrenceDate = '';
    let rawRecordingUrl = '';
    let rawSlidesUrl = '';
    let slidesTitle = '';
    let notes = '';
    let removeUploadedSlides = false;
    let slidesFile = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      occurrenceDate = String(formData.get('occurrence_date') || '').trim();
      rawRecordingUrl = String(formData.get('recording_url') || '');
      rawSlidesUrl = String(formData.get('slides_url') || '');
      slidesTitle = String(formData.get('slides_title') || '').trim();
      notes = String(formData.get('notes') || '').trim();
      removeUploadedSlides = String(formData.get('remove_uploaded_slides') || '') === 'true';
      const candidateFile = formData.get('slides_file');
      if (candidateFile && typeof candidateFile === 'object' && candidateFile.size > 0) {
        slidesFile = candidateFile;
      }
    } else {
      const body = await request.json().catch(() => ({}));
      occurrenceDate = String(body.occurrence_date || '').trim();
      rawRecordingUrl = body.recording_url ?? '';
      rawSlidesUrl = body.slides_url ?? '';
      slidesTitle = String(body.slides_title || '').trim();
      notes = String(body.notes || '').trim();
      removeUploadedSlides = Boolean(body.remove_uploaded_slides);
    }

    if (!isValidDateStr(occurrenceDate)) {
      return NextResponse.json(
        { error: 'La fecha de la sesión (occurrence_date) es obligatoria en formato YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    const recCheck = normalizeOptionalHttpUrl(rawRecordingUrl, { isRecording: true });
    if (!recCheck.ok) {
      return NextResponse.json({ error: `Enlace de grabación: ${recCheck.error}` }, { status: 400 });
    }

    const slidesLinkCheck = normalizeOptionalHttpUrl(rawSlidesUrl, { isRecording: false });
    if (!slidesLinkCheck.ok) {
      return NextResponse.json(
        { error: `Enlace de diapositivas: ${slidesLinkCheck.error}` },
        { status: 400 }
      );
    }

    const { data: existing, error: existErr } = await supabaseAdmin
      .from('live_class_resources')
      .select('*')
      .eq('schedule_id', id)
      .eq('occurrence_date', occurrenceDate)
      .maybeSingle();

    if (existErr) throw existErr;

    let nextSlidesMaterialId = existing?.slides_material_id || null;
    let materialIdToCleanup = null;
    let newlyCreatedMaterialId = null;
    let newlyUploadedPath = null;

    if (slidesFile) {
      const validation = validateMaterialFile(slidesFile.name, slidesFile.type);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      const cleanName = sanitizeStorageFileName(slidesFile.name).slice(0, 120);
      const storagePath = `live-classes/${id}/${occurrenceDate}/${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 7)}_${cleanName}`;

      const arrayBuffer = await slidesFile.arrayBuffer();
      const { error: uploadErr } = await supabaseAdmin.storage
        .from(MATERIAL_BUCKET)
        .upload(storagePath, arrayBuffer, {
          contentType: slidesFile.type || 'application/octet-stream',
          upsert: false,
        });

      if (uploadErr) throw uploadErr;
      newlyUploadedPath = storagePath;

      const resolvedTitle =
        slidesTitle || `Diapositivas: ${schedule.titulo} (${occurrenceDate})`;
      const inferredType = inferMaterialType(slidesFile.name, slidesFile.type);
      const materialType = inferredType === 'summary' ? 'slides' : inferredType;

      const { data: insertedMat, error: matInsertErr } = await supabaseAdmin
        .from('course_materials')
        .insert({
          title: resolvedTitle,
          description: `Material de clase en vivo · ${occurrenceDate}${schedule.expositor ? ` · ${schedule.expositor}` : ''}`,
          material_type: materialType === 'pdf' ? 'slides' : materialType,
          source_type: 'supabase_storage',
          storage_path: storagePath,
          file_url: null,
          file_name: slidesFile.name,
          mime_type: slidesFile.type || 'application/pdf',
          file_size: slidesFile.size || arrayBuffer.byteLength || null,
          especialidad_id: schedule.especialidad_id || null,
          especialidad_nombre: schedule.especialidad_nombre || null,
          subtema: schedule.titulo,
          course_id: schedule.course_id || null,
          video_url: recCheck.value,
          uploaded_by: authResult.uid,
          is_active: true,
        })
        .select('id')
        .single();

      if (matInsertErr) {
        await supabaseAdmin.storage.from(MATERIAL_BUCKET).remove([storagePath]);
        throw matInsertErr;
      }

      newlyCreatedMaterialId = insertedMat.id;
      if (nextSlidesMaterialId && nextSlidesMaterialId !== insertedMat.id) {
        materialIdToCleanup = nextSlidesMaterialId;
      }
      nextSlidesMaterialId = insertedMat.id;
    } else if (removeUploadedSlides && nextSlidesMaterialId) {
      materialIdToCleanup = nextSlidesMaterialId;
      nextSlidesMaterialId = null;
    } else if (nextSlidesMaterialId) {
      // Mantener título o video_url sincronizado en el material registrado en BD
      const matUpdate = { video_url: recCheck.value };
      if (slidesTitle) matUpdate.title = slidesTitle;
      await supabaseAdmin
        .from('course_materials')
        .update(matUpdate)
        .eq('id', nextSlidesMaterialId);
    }

    const nextRecordingUrl = recCheck.value;
    const nextSlidesUrl = slidesLinkCheck.value;
    const nextSlidesTitle = slidesTitle || (nextSlidesUrl || nextSlidesMaterialId ? existing?.slides_title || null : null);
    const nextNotes = notes || null;

    const hasAnyContent = Boolean(
      nextRecordingUrl || nextSlidesMaterialId || nextSlidesUrl || nextNotes
    );

    if (!hasAnyContent) {
      if (existing) {
        const { error: delErr } = await supabaseAdmin
          .from('live_class_resources')
          .delete()
          .eq('id', existing.id);
        if (delErr) throw delErr;
      }

      const cleanupStats = materialIdToCleanup
        ? await deleteManagedLiveClassMaterialIfOrphaned(materialIdToCleanup)
        : { deletedFilesCount: 0, deletedMaterialsCount: 0 };

      await broadcastScheduleChange('resource_updated');
      return NextResponse.json(
        {
          ok: true,
          resource: null,
          deletedFilesCount: cleanupStats.deletedFilesCount,
          deletedMaterialsCount: cleanupStats.deletedMaterialsCount,
        },
        { status: 200 }
      );
    }

    const { data: savedRow, error: upsertErr } = await supabaseAdmin
      .from('live_class_resources')
      .upsert(
        {
          schedule_id: id,
          occurrence_date: occurrenceDate,
          recording_url: nextRecordingUrl,
          slides_material_id: nextSlidesMaterialId,
          slides_url: nextSlidesUrl,
          slides_title: nextSlidesTitle,
          notes: nextNotes,
          updated_by: authResult.uid,
        },
        { onConflict: 'schedule_id,occurrence_date' }
      )
      .select('*')
      .single();

    if (upsertErr) {
      // Rollback del archivo/registro recién creado si falla el enlace en live_class_resources
      if (newlyCreatedMaterialId) {
        await supabaseAdmin.from('course_materials').delete().eq('id', newlyCreatedMaterialId);
      }
      if (newlyUploadedPath) {
        await supabaseAdmin.storage.from(MATERIAL_BUCKET).remove([newlyUploadedPath]);
      }
      throw upsertErr;
    }

    const cleanupStats = materialIdToCleanup
      ? await deleteManagedLiveClassMaterialIfOrphaned(materialIdToCleanup)
      : { deletedFilesCount: 0, deletedMaterialsCount: 0 };

    await broadcastScheduleChange('resource_updated');
    const enriched = await buildEnrichedResource(savedRow);
    return NextResponse.json(
      {
        ok: true,
        resource: enriched,
        deletedFilesCount: cleanupStats.deletedFilesCount,
        deletedMaterialsCount: cleanupStats.deletedMaterialsCount,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error en PUT /api/schedules/[id]/resources:', error);
    return NextResponse.json(
      { error: 'No se pudieron guardar la grabación y las diapositivas.', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request, context) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const occurrenceDate = searchParams.get('occurrence_date');

    if (!isValidDateStr(occurrenceDate)) {
      return NextResponse.json(
        { error: 'Debes indicar occurrence_date en formato YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('live_class_resources')
      .select('id, slides_material_id')
      .eq('schedule_id', id)
      .eq('occurrence_date', occurrenceDate.trim())
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const { error: delErr } = await supabaseAdmin
      .from('live_class_resources')
      .delete()
      .eq('id', existing.id);

    if (delErr) throw delErr;

    const cleanupStats = existing.slides_material_id
      ? await deleteManagedLiveClassMaterialIfOrphaned(existing.slides_material_id)
      : { deletedFilesCount: 0, deletedMaterialsCount: 0 };

    await broadcastScheduleChange('resource_updated');
    return NextResponse.json(
      {
        ok: true,
        deletedFilesCount: cleanupStats.deletedFilesCount,
        deletedMaterialsCount: cleanupStats.deletedMaterialsCount,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error en DELETE /api/schedules/[id]/resources:', error);
    return NextResponse.json(
      { error: 'No se pudieron eliminar los recursos de la clase.', details: error.message },
      { status: 500 }
    );
  }
}
