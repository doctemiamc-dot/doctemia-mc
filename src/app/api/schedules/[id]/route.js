import { NextResponse } from 'next/server';
import { verifySessionUser } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { cleanupManagedMaterialsForSchedules } from '@/lib/liveClassResourcesServer';
import { broadcastScheduleChange } from '@/lib/scheduleBroadcast';

export async function GET(request, context) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const { data, error } = await supabaseAdmin
      .from('live_class_schedules')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Clase no encontrada.' }, { status: 404 });
    }
    return NextResponse.json({ schedule: data }, { status: 200 });
  } catch (error) {
    console.error('Error en GET /api/schedules/[id]:', error);
    return NextResponse.json({ error: 'Error al cargar la clase.' }, { status: 500 });
  }
}

export async function PATCH(request, context) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const { data: existingSchedule } = await supabaseAdmin
      .from('live_class_schedules')
      .select('id, is_recurring, fecha_especifica')
      .eq('id', id)
      .maybeSingle();

    if (!existingSchedule) {
      return NextResponse.json({ error: 'Clase no encontrada.' }, { status: 404 });
    }

    // Helper para mantener vinculados grabación/diapositivas si cambia la fecha de la sesión
    const syncResourceDateIfMoved = async (fromDate, toDate) => {
      const cleanFrom = fromDate ? String(fromDate).slice(0, 10) : null;
      const cleanTo = toDate ? String(toDate).slice(0, 10) : null;
      if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) return;
      const [{ data: oldRes }, { data: targetRes }] = await Promise.all([
        supabaseAdmin
          .from('live_class_resources')
          .select('id')
          .eq('schedule_id', id)
          .eq('occurrence_date', cleanFrom)
          .maybeSingle(),
        supabaseAdmin
          .from('live_class_resources')
          .select('id')
          .eq('schedule_id', id)
          .eq('occurrence_date', cleanTo)
          .maybeSingle(),
      ]);
      if (oldRes && !targetRes) {
        await supabaseAdmin
          .from('live_class_resources')
          .update({ occurrence_date: cleanTo })
          .eq('id', oldRes.id);
      }
    };

    // Modo 1: Excepción para una ocurrencia puntual de una serie semanal recurrente
    if (body.mode === 'single_occurrence') {
      const {
        original_date,
        action,
        new_date = null,
        new_hora_inicio = null,
        new_enlace = null,
        motivo = null,
      } = body;

      if (!original_date || !['cancelled', 'rescheduled'].includes(action)) {
        return NextResponse.json(
          { error: 'Se requiere original_date y action (cancelled o rescheduled).' },
          { status: 400 }
        );
      }

      const resolvedNewDate = action === 'rescheduled' ? (new_date || original_date) : null;

      const { data: excData, error: excError } = await supabaseAdmin
        .from('live_class_exceptions')
        .upsert(
          {
            schedule_id: id,
            original_date,
            action,
            new_date: resolvedNewDate,
            new_hora_inicio: action === 'rescheduled' ? new_hora_inicio || null : null,
            new_enlace: action === 'rescheduled' ? new_enlace || null : null,
            motivo: motivo || null,
          },
          { onConflict: 'schedule_id,original_date' }
        )
        .select()
        .single();

      if (excError) throw excError;

      if (action === 'rescheduled' && resolvedNewDate) {
        await syncResourceDateIfMoved(original_date, resolvedNewDate);
      }

      await broadcastScheduleChange('occurrence_updated');
      return NextResponse.json({ exception: excData }, { status: 200 });
    }

    // Modo 2: Restaurar una ocurrencia que había sido cancelada/movida
    if (body.mode === 'restore_occurrence' && body.original_date) {
      const { error: delExcErr } = await supabaseAdmin
        .from('live_class_exceptions')
        .delete()
        .eq('schedule_id', id)
        .eq('original_date', body.original_date);

      if (delExcErr) throw delExcErr;

      await broadcastScheduleChange('occurrence_restored');
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // Modo 3: Edición completa de la clase / serie recurrente
    const allowedFields = [
      'titulo',
      'descripcion',
      'expositor',
      'course_id',
      'course_title',
      'especialidad_id',
      'especialidad_nombre',
      'enlace',
      'id_reunion',
      'is_recurring',
      'day_of_week',
      'fecha_especifica',
      'hora_inicio',
      'duracion_minutos',
      'status',
      'vigente_desde',
      'vigente_hasta',
    ];

    const updatePayload = {};
    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        updatePayload[key] = body[key] === '' ? null : body[key];
      }
    }

    if (updatePayload.is_recurring === true) {
      updatePayload.fecha_especifica = null;
      if (updatePayload.day_of_week !== undefined && updatePayload.day_of_week !== null) {
        updatePayload.day_of_week = Number(updatePayload.day_of_week);
      }
    } else if (updatePayload.is_recurring === false) {
      updatePayload.day_of_week = null;
    }

    if (updatePayload.duracion_minutos !== undefined && updatePayload.duracion_minutos !== null) {
      updatePayload.duracion_minutos = Number(updatePayload.duracion_minutos) || 60;
    }

    const { data, error } = await supabaseAdmin
      .from('live_class_schedules')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    if (!existingSchedule.is_recurring && !data.is_recurring) {
      await syncResourceDateIfMoved(existingSchedule.fecha_especifica, data.fecha_especifica);
    }

    await broadcastScheduleChange('updated');
    return NextResponse.json({ schedule: data }, { status: 200 });
  } catch (error) {
    console.error('Error en PATCH /api/schedules/[id]:', error);
    return NextResponse.json(
      { error: 'No se pudo actualizar la clase.', details: error.message },
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
    const originalDate = searchParams.get('original_date');

    if (originalDate) {
      const { error: excDelErr } = await supabaseAdmin
        .from('live_class_exceptions')
        .delete()
        .eq('schedule_id', id)
        .eq('original_date', originalDate);

      if (excDelErr) throw excDelErr;
      await broadcastScheduleChange('exception_deleted');
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const cleanupStats = await cleanupManagedMaterialsForSchedules([id]);

    const { error } = await supabaseAdmin
      .from('live_class_schedules')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await broadcastScheduleChange('deleted');
    return NextResponse.json(
      {
        ok: true,
        deletedFilesCount: cleanupStats?.deletedFilesCount || 0,
        deletedMaterialsCount: cleanupStats?.deletedMaterialsCount || 0,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error en DELETE /api/schedules/[id]:', error);
    return NextResponse.json(
      { error: 'No se pudo eliminar la clase.', details: error.message },
      { status: 500 }
    );
  }
}
