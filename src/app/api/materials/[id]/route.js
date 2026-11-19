import { NextResponse } from 'next/server';
import { verifySessionUser } from '@/lib/apiAuth';
import { db as adminDb } from '@/lib/firebase-admin';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { MATERIAL_BUCKET, toDrivePreviewUrl } from '@/lib/materialUtils';
import { broadcastScheduleChange } from '@/lib/scheduleBroadcast';

export async function GET(request, context) {
  const authResult = await verifySessionUser(request, { requirePagoUnico: true });
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const { data, error } = await supabaseAdmin
      .from('course_materials')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });
    }

    if (!data.is_active && !authResult.isAdmin) {
      return NextResponse.json({ error: 'Material no disponible.' }, { status: 404 });
    }

    if (!authResult.isAdmin && data.course_id && adminDb) {
      const courseSnap = await adminDb
        .collection('Cursos_Pago_Unico')
        .doc(data.course_id)
        .get();
      if (!courseSnap.exists || courseSnap.data()?.isActive === false) {
        return NextResponse.json(
          { error: 'Este material pertenece a un curso que no está disponible.' },
          { status: 404 }
        );
      }
    }

    let signedUrl = null;
    if (data.source_type === 'supabase_storage' && data.storage_path) {
      const { data: signed } = await supabaseAdmin.storage
        .from(MATERIAL_BUCKET)
        .createSignedUrl(data.storage_path, 3600);
      signedUrl = signed?.signedUrl || null;
    }

    return NextResponse.json({
      material: {
        ...data,
        signed_url: signedUrl,
        proxy_url: data.source_type === 'supabase_storage' ? `/api/materials/file/${data.id}` : null,
        preview_url:
          data.source_type === 'supabase_storage'
            ? `/api/materials/file/${data.id}`
            : data.source_type === 'google_drive_legacy'
              ? toDrivePreviewUrl(data.file_url)
              : data.file_url,
      },
    });
  } catch (error) {
    console.error('Error en GET /api/materials/[id]:', error);
    return NextResponse.json({ error: 'Error al obtener material.' }, { status: 500 });
  }
}

export async function PATCH(request, context) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const allowedFields = [
      'title',
      'description',
      'material_type',
      'especialidad_id',
      'especialidad_nombre',
      'subtema',
      'course_id',
      'module_index',
      'video_url',
      'file_url',
      'is_active',
    ];

    const updatePayload = {};
    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        updatePayload[key] = body[key] === '' ? null : body[key];
      }
    }

    const { data, error } = await supabaseAdmin
      .from('course_materials')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ material: data }, { status: 200 });
  } catch (error) {
    console.error('Error en PATCH /api/materials/[id]:', error);
    return NextResponse.json(
      { error: 'No se pudo actualizar el material.', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request, context) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('course_materials')
      .select('id, source_type, storage_path')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });
    }

    if (existing.source_type === 'supabase_storage' && existing.storage_path) {
      const { error: storageError } = await supabaseAdmin.storage
        .from(MATERIAL_BUCKET)
        .remove([existing.storage_path]);
      if (storageError) {
        console.warn('Advertencia al borrar archivo en Storage:', storageError.message);
      }
    }

    const { error: deleteError } = await supabaseAdmin
      .from('course_materials')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    // Si este material pertenecía a una clase en vivo y dejó su registro sin otro contenido, limpiarlo
    if (existing.storage_path?.startsWith('live-classes/')) {
      const { error: orphanResErr } = await supabaseAdmin
        .from('live_class_resources')
        .delete()
        .is('slides_material_id', null)
        .is('recording_url', null)
        .is('slides_url', null)
        .is('notes', null);
      if (!orphanResErr) {
        await broadcastScheduleChange('resource_updated').catch(() => {});
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('Error en DELETE /api/materials/[id]:', error);
    return NextResponse.json(
      { error: 'No se pudo eliminar el material.', details: error.message },
      { status: 500 }
    );
  }
}
