import { NextResponse } from 'next/server';
import { verifySessionUser } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  addDaysToDateStr,
  attachResourcesToOccurrences,
  buildPastArchiveOccurrences,
  expandSchedulesForWeek,
  getTodayBoliviaStr,
  getWeekStartMonday,
  isExceptionPast,
  isSchedulePast,
} from '@/lib/scheduleUtils';
import {
  cleanupManagedMaterialsForSchedules,
  fetchLiveClassResourcesAndMaterials,
} from '@/lib/liveClassResourcesServer';
import { broadcastScheduleChange } from '@/lib/scheduleBroadcast';

export async function GET(request) {
  const authResult = await verifySessionUser(request, { requirePagoUnico: true });
  if (!authResult.ok) return authResult.response;

  try {
    const { searchParams } = new URL(request.url);
    const weekStartParam = searchParams.get('weekStart');
    const courseId = searchParams.get('course_id');
    const especialidadId = searchParams.get('especialidad_id');
    const includePastArchive = searchParams.get('includePastArchive') === '1';
    const weeksParam = Number(searchParams.get('weeks') || 1);
    const weeksCount = Number.isFinite(weeksParam)
      ? Math.min(Math.max(Math.floor(weeksParam), 1), 4)
      : 1;
    const weekStart = getWeekStartMonday(weekStartParam);

    const [
      { data: rawSchedules, error: schErr },
      { data: exceptions, error: excErr },
      { resources, materialMap },
    ] = await Promise.all([
      supabaseAdmin
        .from('live_class_schedules')
        .select('*')
        .order('hora_inicio', { ascending: true }),
      supabaseAdmin
        .from('live_class_exceptions')
        .select('*')
        .order('original_date', { ascending: true }),
      fetchLiveClassResourcesAndMaterials(),
    ]);

    if (schErr) throw schErr;
    if (excErr) throw excErr;

    // Filtrar en memoria de forma combinada (AND) para soportar curso + especialidad simultáneamente
    const schedules = (rawSchedules || []).filter((sch) => {
      if (courseId && sch.course_id && sch.course_id !== courseId) return false;
      if (especialidadId && sch.especialidad_id && sch.especialidad_id !== especialidadId) return false;
      return true;
    });

    const weeks = Array.from({ length: weeksCount }, (_, index) => {
      const targetWeekStart = index === 0 ? weekStart : addDaysToDateStr(weekStart, index * 7);
      const rawOccs = expandSchedulesForWeek(schedules, exceptions || [], targetWeekStart);
      return {
        weekStart: targetWeekStart,
        occurrences: attachResourcesToOccurrences(rawOccs, resources, materialMap),
      };
    });
    const occurrences = weeks[0]?.occurrences || [];

    const pastArchive =
      includePastArchive || authResult.isAdmin
        ? buildPastArchiveOccurrences({
            schedules,
            exceptions: exceptions || [],
            resources,
            materialMap,
          })
        : undefined;

    let adminSchedules;
    if (authResult.isAdmin) {
      const countBySchedule = new Map();
      for (const r of resources || []) {
        if (!r?.schedule_id) continue;
        if (!r.recording_url && !r.slides_material_id && !r.slides_url) continue;
        countBySchedule.set(r.schedule_id, (countBySchedule.get(r.schedule_id) || 0) + 1);
      }
      adminSchedules = (schedules || []).map((sch) => {
        const resCount = countBySchedule.get(sch.id) || 0;
        return {
          ...sch,
          resource_count: resCount,
          has_resources: resCount > 0,
        };
      });
    }

    return NextResponse.json(
      {
        weekStart,
        occurrences,
        weeks,
        pastArchive,
        schedules: adminSchedules,
        exceptions: authResult.isAdmin ? exceptions || [] : undefined,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error en GET /api/schedules:', error);
    return NextResponse.json(
      { error: 'Error al consultar calendario de clases.', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const {
      titulo,
      descripcion = null,
      expositor,
      course_id = null,
      course_title = null,
      especialidad_id = null,
      especialidad_nombre = null,
      enlace,
      id_reunion = null,
      is_recurring = false,
      day_of_week = null,
      fecha_especifica = null,
      hora_inicio,
      duracion_minutos = 60,
      status = 'programada',
      vigente_desde = null,
      vigente_hasta = null,
    } = body;

    if (!titulo?.trim() || !expositor?.trim() || !enlace?.trim() || !hora_inicio) {
      return NextResponse.json(
        { error: 'Título, expositor, enlace y hora de inicio son obligatorios.' },
        { status: 400 }
      );
    }

    if (is_recurring && (day_of_week === null || day_of_week === undefined || day_of_week === '')) {
      return NextResponse.json(
        { error: 'Para clases recurrentes debes seleccionar el día de la semana.' },
        { status: 400 }
      );
    }

    if (!is_recurring && !fecha_especifica) {
      return NextResponse.json(
        { error: 'Para clases únicas debes seleccionar una fecha específica.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('live_class_schedules')
      .insert({
        titulo: titulo.trim(),
        descripcion: descripcion?.trim() || null,
        expositor: expositor.trim(),
        course_id: course_id || null,
        course_title: course_title || null,
        especialidad_id: especialidad_id || null,
        especialidad_nombre: especialidad_nombre || null,
        enlace: enlace.trim(),
        id_reunion: id_reunion?.trim() || null,
        is_recurring: Boolean(is_recurring),
        day_of_week: is_recurring ? Number(day_of_week) : null,
        fecha_especifica: !is_recurring ? fecha_especifica : null,
        hora_inicio,
        duracion_minutos: Number(duracion_minutos) || 60,
        status: ['programada', 'en_vivo', 'cancelada', 'reprogramada'].includes(status)
          ? status
          : 'programada',
        vigente_desde: vigente_desde || null,
        vigente_hasta: vigente_hasta || null,
        created_by: authResult.uid,
      })
      .select()
      .single();

    if (error) throw error;

    await broadcastScheduleChange('created');
    return NextResponse.json({ schedule: data }, { status: 201 });
  } catch (error) {
    console.error('Error en POST /api/schedules:', error);
    return NextResponse.json(
      { error: 'No se pudo programar la clase en vivo.', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json().catch(() => ({}));

    if (body.mode === 'selected') {
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((id) => typeof id === 'string' && id.trim().length > 0)
        : [];
      if (ids.length === 0) {
        return NextResponse.json(
          { error: 'Selecciona al menos una programación para eliminar.' },
          { status: 400 }
        );
      }

      const cleanupStats = await cleanupManagedMaterialsForSchedules(ids);

      const { error, count } = await supabaseAdmin
        .from('live_class_schedules')
        .delete({ count: 'exact' })
        .in('id', ids);

      if (error) throw error;

      await broadcastScheduleChange('bulk_deleted');
      return NextResponse.json(
        {
          ok: true,
          deletedSchedules: count ?? ids.length,
          deletedExceptions: 0,
          deletedFilesCount: cleanupStats?.deletedFilesCount || 0,
          deletedMaterialsCount: cleanupStats?.deletedMaterialsCount || 0,
        },
        { status: 200 }
      );
    }

    if (body.mode === 'cleanup_past') {
      const includeTodayFinished = Boolean(body.includeTodayFinished);
      const includeRecorded = Boolean(body.includeRecorded);
      const todayStr = getTodayBoliviaStr();
      const nowMs = Date.now();

      const [
        { data: rawSchedules, error: schErr },
        { data: rawExceptions, error: excErr },
        { resources: rawResources },
      ] = await Promise.all([
        supabaseAdmin
          .from('live_class_schedules')
          .select('id, is_recurring, fecha_especifica, hora_inicio, duracion_minutos, vigente_hasta'),
        supabaseAdmin
          .from('live_class_exceptions')
          .select('id, schedule_id, original_date, new_date'),
        fetchLiveClassResourcesAndMaterials(),
      ]);

      if (schErr) throw schErr;
      if (excErr) throw excErr;

      const protectedScheduleIds = new Set();
      const protectedResourceKeys = new Set();
      for (const res of rawResources || []) {
        if (!res?.recording_url && !res?.slides_material_id && !res?.slides_url) continue;
        protectedScheduleIds.add(res.schedule_id);
        const occDate = String(res.occurrence_date).slice(0, 10);
        protectedResourceKeys.add(`${res.schedule_id}__${occDate}`);
      }

      const allPastScheduleIds = (rawSchedules || [])
        .filter((sch) => isSchedulePast(sch, todayStr, nowMs, includeTodayFinished))
        .map((sch) => sch.id);

      const pastScheduleIds = includeRecorded
        ? allPastScheduleIds
        : allPastScheduleIds.filter((id) => !protectedScheduleIds.has(id));

      const protectedWithResourcesCount = allPastScheduleIds.filter((id) =>
        protectedScheduleIds.has(id)
      ).length;

      const pastScheduleIdSet = new Set(pastScheduleIds);
      const pastExceptionIds = (rawExceptions || [])
        .filter((exc) => {
          if (pastScheduleIdSet.has(exc.schedule_id)) return false;
          if (!isExceptionPast(exc, todayStr)) return false;
          if (!includeRecorded) {
            const origKey = `${exc.schedule_id}__${String(exc.original_date).slice(0, 10)}`;
            const movedKey = exc.new_date
              ? `${exc.schedule_id}__${String(exc.new_date).slice(0, 10)}`
              : '';
            if (protectedResourceKeys.has(origKey) || (movedKey && protectedResourceKeys.has(movedKey))) {
              return false;
            }
          }
          return true;
        })
        .map((exc) => exc.id);

      let deletedSchedules = 0;
      let deletedExceptions = 0;
      let deletedFilesCount = 0;
      let deletedMaterialsCount = 0;

      if (pastScheduleIds.length > 0) {
        if (includeRecorded) {
          const cleanupStats = await cleanupManagedMaterialsForSchedules(pastScheduleIds);
          deletedFilesCount = cleanupStats?.deletedFilesCount || 0;
          deletedMaterialsCount = cleanupStats?.deletedMaterialsCount || 0;
        }
        const { error: delSchErr, count } = await supabaseAdmin
          .from('live_class_schedules')
          .delete({ count: 'exact' })
          .in('id', pastScheduleIds);
        if (delSchErr) throw delSchErr;
        deletedSchedules = count ?? pastScheduleIds.length;
      }

      if (pastExceptionIds.length > 0) {
        const { error: delExcErr, count } = await supabaseAdmin
          .from('live_class_exceptions')
          .delete({ count: 'exact' })
          .in('id', pastExceptionIds);
        if (delExcErr) throw delExcErr;
        deletedExceptions = count ?? pastExceptionIds.length;
      }

      if (deletedSchedules > 0 || deletedExceptions > 0) {
        await broadcastScheduleChange('past_cleaned');
      }

      return NextResponse.json(
        {
          ok: true,
          deletedSchedules,
          deletedExceptions,
          protectedWithResourcesCount,
          deletedFilesCount,
          deletedMaterialsCount,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ error: 'Modo de eliminación no válido.' }, { status: 400 });
  } catch (error) {
    console.error('Error en DELETE /api/schedules:', error);
    return NextResponse.json(
      { error: 'No se pudieron eliminar las clases.', details: error.message },
      { status: 500 }
    );
  }
}
