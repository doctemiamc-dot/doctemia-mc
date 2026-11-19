'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getCachedCategories, getCachedPagoUnicoCourses } from '@/lib/catalogCache';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { DAYS_OF_WEEK_ES } from '@/lib/scheduleUtils';
import Swal from 'sweetalert2';
import { Calendar, Repeat, Clock, Loader2, ArrowLeft, ExternalLink, Presentation } from 'lucide-react';
import {
  LiveClassResourcesFields,
  createEmptyResourceDraft,
  hasResourceDraftContent,
  saveLiveClassResources,
} from '@/components/live-classes/LiveClassResourceModal';

const DURATION_PRESETS = ['45', '60', '90', '120'];

function ScheduleFormInner({ scheduleId = null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const duplicateId = !scheduleId ? searchParams.get('duplicate') : null;
  const dateParam = searchParams.get('date');
  const prefillDate = !scheduleId ? dateParam : null;
  const queryOccDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : '';
  const returnTabParam = searchParams.get('returnTab');
  const backHref = ['agenda', 'past', 'series'].includes(returnTabParam)
    ? `/admin/live-classes?tab=${returnTabParam}`
    : '/admin/live-classes';
  const sourceIdToLoad = scheduleId || duplicateId;

  const { isDark, isLoaded } = useTheme();
  const { firebaseAuthUser, loading: authLoading } = useAuth();

  const [courses, setCourses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resourceDraft, setResourceDraft] = useState(() => createEmptyResourceDraft());
  const [loadedMeta, setLoadedMeta] = useState({
    course_id: '',
    course_title: null,
    especialidad_id: '',
    especialidad_nombre: null,
  });
  const loadedKeyRef = useRef('');

  const getAuthHeaders = useCallback(
    async (extra = {}) => {
      const headers = { ...extra };
      if (firebaseAuthUser) {
        const token = await firebaseAuthUser.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      return headers;
    },
    [firebaseAuthUser]
  );

  const initialDayOfWeek = useMemo(() => {
    if (prefillDate && /^\d{4}-\d{2}-\d{2}$/.test(prefillDate)) {
      const [y, m, d] = prefillDate.split('-').map(Number);
      return String(new Date(Date.UTC(y, m - 1, d)).getUTCDay());
    }
    return '2';
  }, [prefillDate]);

  const [form, setForm] = useState({
    titulo: '',
    descripcion: '',
    expositor: '',
    course_id: '',
    especialidad_id: '',
    enlace: '',
    id_reunion: '',
    is_recurring: false,
    day_of_week: initialDayOfWeek,
    fecha_especifica:
      prefillDate && /^\d{4}-\d{2}-\d{2}$/.test(prefillDate) ? prefillDate : '',
    hora_inicio: '20:00',
    duracion_minutos: '60',
    status: 'programada',
    vigente_desde: '',
    vigente_hasta: '',
  });

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f9fafb' : '#1a2639',
      confirmButtonColor: '#014ba0',
      cancelButtonColor: '#6b7280',
    }),
    [isDark]
  );
  const swalThemeRef = useRef(swalTheme);
  useEffect(() => {
    swalThemeRef.current = swalTheme;
  }, [swalTheme]);

  useEffect(() => {
    if (authLoading) return;
    if (sourceIdToLoad && !firebaseAuthUser) return;

    const loadKey = `${sourceIdToLoad || 'new'}__${firebaseAuthUser?.uid || 'anon'}`;
    if (loadedKeyRef.current === loadKey) return;

    let cancelled = false;
    const loadData = async () => {
      setLoading(true);
      try {
        const [puCourses, cats] = await Promise.all([
          getCachedPagoUnicoCourses({ onlyActive: false }),
          getCachedCategories(),
        ]);
        if (cancelled) return;

        setCourses(puCourses);
        setCategories(cats);

        if (sourceIdToLoad) {
          const headers = {};
          if (firebaseAuthUser) {
            const token = await firebaseAuthUser.getIdToken();
            if (token) headers.Authorization = `Bearer ${token}`;
          }
          const res = await fetch(`/api/schedules/${sourceIdToLoad}`, { headers });
          const data = await res.json();
          if (cancelled) return;
          if (!res.ok || !data.schedule) {
            throw new Error(data.error || 'Clase no encontrada');
          }
          const s = data.schedule;
          const specificDate =
            !duplicateId && s.fecha_especifica ? String(s.fecha_especifica).slice(0, 10) : '';
          setLoadedMeta({
            course_id: s.course_id || '',
            course_title: s.course_title || null,
            especialidad_id: s.especialidad_id || '',
            especialidad_nombre: s.especialidad_nombre || null,
          });
          setForm({
            titulo: duplicateId ? `${s.titulo || ''} (Copia)` : s.titulo || '',
            descripcion: s.descripcion || '',
            expositor: s.expositor || '',
            course_id: s.course_id || '',
            especialidad_id: s.especialidad_id || '',
            enlace: s.enlace || '',
            id_reunion: s.id_reunion || '',
            is_recurring: Boolean(s.is_recurring),
            day_of_week:
              s.day_of_week !== null && s.day_of_week !== undefined ? String(s.day_of_week) : '2',
            fecha_especifica: specificDate,
            hora_inicio: s.hora_inicio ? String(s.hora_inicio).slice(0, 5) : '20:00',
            duracion_minutos: String(s.duracion_minutos || 60),
            status: duplicateId ? 'programada' : s.status || 'programada',
            vigente_desde: s.vigente_desde ? String(s.vigente_desde).slice(0, 10) : '',
            vigente_hasta: s.vigente_hasta ? String(s.vigente_hasta).slice(0, 10) : '',
          });

          const resDate = !s.is_recurring ? specificDate : queryOccDate;
          if (scheduleId && resDate) {
            const resFetch = await fetch(
              `/api/schedules/${scheduleId}/resources?occurrence_date=${encodeURIComponent(resDate)}`,
              { headers }
            );
            const resData = await resFetch.json().catch(() => ({}));
            if (!cancelled && resFetch.ok && resData.resource) {
              setResourceDraft(createEmptyResourceDraft(resData.resource));
            }
          }
        }
        loadedKeyRef.current = loadKey;
      } catch (err) {
        if (!cancelled) {
          Swal.fire({ title: 'Error', text: err.message, icon: 'error', ...swalThemeRef.current }).then(() => {
            if (scheduleId) router.push(backHref);
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadData();
    return () => {
      cancelled = true;
    };
  }, [authLoading, sourceIdToLoad, scheduleId, duplicateId, queryOccDate, firebaseAuthUser, router, backHref]);

  const resourceTargetDate = !form.is_recurring
    ? form.fecha_especifica
    : scheduleId
    ? queryOccDate
    : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    const selectedCourse = courses.find((c) => c.id === form.course_id);
    const selectedEsp = categories.find((c) => c.id === form.especialidad_id);

    const payload = {
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || null,
      expositor: form.expositor.trim(),
      course_id: form.course_id || null,
      course_title:
        selectedCourse?.title ||
        (form.course_id && form.course_id === loadedMeta.course_id ? loadedMeta.course_title : null),
      especialidad_id: form.especialidad_id || null,
      especialidad_nombre:
        selectedEsp?.name ||
        (form.especialidad_id && form.especialidad_id === loadedMeta.especialidad_id
          ? loadedMeta.especialidad_nombre
          : null),
      enlace: form.enlace.trim(),
      id_reunion: form.id_reunion.trim() || null,
      is_recurring: form.is_recurring,
      day_of_week: form.is_recurring ? Number(form.day_of_week) : null,
      fecha_especifica: !form.is_recurring ? form.fecha_especifica : null,
      hora_inicio: form.hora_inicio,
      duracion_minutos: Number(form.duracion_minutos) || 60,
      status: form.status,
      vigente_desde: form.is_recurring && form.vigente_desde ? form.vigente_desde : null,
      vigente_hasta: form.is_recurring && form.vigente_hasta ? form.vigente_hasta : null,
    };

    setSubmitting(true);
    try {
      const url = scheduleId ? `/api/schedules/${scheduleId}` : '/api/schedules';
      const method = scheduleId ? 'PATCH' : 'POST';

      const headers = { 'Content-Type': 'application/json' };
      if (firebaseAuthUser) {
        const token = await firebaseAuthUser.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar la clase');

      const savedScheduleId = scheduleId || data.schedule?.id;
      if (savedScheduleId && resourceTargetDate && hasResourceDraftContent(resourceDraft)) {
        await saveLiveClassResources({
          scheduleId: savedScheduleId,
          occurrenceDate: resourceTargetDate,
          draft: resourceDraft,
          getAuthHeaders,
        });
      }

      await Swal.fire({
        title: scheduleId ? 'Clase actualizada' : 'Clase programada',
        text: 'El calendario semanal de los estudiantes ya está actualizado en tiempo real.',
        icon: 'success',
        ...swalThemeRef.current,
      });
      router.push(backHref);
    } catch (err) {
      Swal.fire({ title: 'Error', text: err.message, icon: 'error', ...swalThemeRef.current });
    } finally {
      setSubmitting(false);
    }
  };

  if (!isLoaded || loading) {
    return (
      <div
        className={`min-h-[calc(100vh-4rem)] flex items-center justify-center ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <Loader2 className="w-7 h-7 animate-spin mr-3 text-blue-500" />
        <span>Cargando formulario de clase en vivo...</span>
      </div>
    );
  }

  const cardClass = isDark
    ? 'bg-[#1e293b] border-white/10 text-slate-100'
    : 'bg-white border-[#2E4A70]/15 text-[#1a2639]';
  const inputClass = isDark
    ? 'bg-[#162235] border-white/15 text-white placeholder-slate-400 focus:border-[#24B0BA]'
    : 'bg-white border-[#2E4A70]/25 text-[#1a2639] placeholder-slate-400 focus:border-[#014ba0]';

  return (
    <div className={`min-h-[calc(100vh-4rem)] p-3 sm:p-6 md:p-8 ${isDark ? 'bg-[#1a2639]' : 'bg-[#FFF9F0]'}`}>
      <div className="max-w-3xl mx-auto space-y-4">
        <Link
          href={backHref}
          className={`inline-flex items-center gap-2 text-xs sm:text-sm font-bold ${
            isDark ? 'text-blue-300 hover:text-white' : 'text-[#014ba0] hover:underline'
          }`}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver al calendario</span>
        </Link>

        <div className={`p-5 sm:p-8 rounded-2xl border shadow-sm ${cardClass}`}>
          <h1 className="text-xl sm:text-2xl font-black text-[#014ba0] mb-1" style={isDark ? { color: '#24B0BA' } : undefined}>
            {scheduleId ? 'Editar Clase en Vivo' : 'Programar Clase en Vivo'}
          </h1>
          <p className={`text-xs sm:text-sm mb-6 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
            Configura clases únicas o series semanales fijas vinculadas a Cursos de Pago Único.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Tipo de programación */}
            <div
              className={`p-4 rounded-xl border ${
                isDark ? 'bg-[#162235] border-white/10' : 'bg-blue-50/60 border-blue-200'
              }`}
            >
              <span className="block text-xs font-extrabold uppercase tracking-wider mb-3 opacity-80">
                Tipo de Programación
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, is_recurring: false }))}
                  className={`p-3 rounded-xl border text-left flex items-center gap-3 transition cursor-pointer ${
                    !form.is_recurring
                      ? 'bg-[#014ba0] text-white border-[#014ba0] shadow-xs'
                      : isDark
                      ? 'bg-[#1e293b] border-white/15 text-slate-300'
                      : 'bg-white border-slate-300 text-slate-700'
                  }`}
                >
                  <Calendar className="w-5 h-5 shrink-0" />
                  <div>
                    <p className="font-bold text-sm">Clase Única</p>
                    <p className="text-[11px] opacity-80">Una fecha específica</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, is_recurring: true }))}
                  className={`p-3 rounded-xl border text-left flex items-center gap-3 transition cursor-pointer ${
                    form.is_recurring
                      ? 'bg-[#014ba0] text-white border-[#014ba0] shadow-xs'
                      : isDark
                      ? 'bg-[#1e293b] border-white/15 text-slate-300'
                      : 'bg-white border-slate-300 text-slate-700'
                  }`}
                >
                  <Repeat className="w-5 h-5 shrink-0" />
                  <div>
                    <p className="font-bold text-sm">Clase Semanal Recurrente</p>
                    <p className="text-[11px] opacity-80">Se repite cada semana</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Datos principales */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs sm:text-sm font-bold mb-1">
                  Título / Tema de la Clase *
                </label>
                <input
                  type="text"
                  required
                  value={form.titulo}
                  onChange={(e) => setForm((p) => ({ ...p, titulo: e.target.value }))}
                  placeholder="Ej: Repaso de Cardiología - Síndrome Coronario"
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-bold mb-1">
                  Docente / Expositor *
                </label>
                <input
                  type="text"
                  required
                  value={form.expositor}
                  onChange={(e) => setForm((p) => ({ ...p, expositor: e.target.value }))}
                  placeholder="Ej: Dr. Pablo Aparicio"
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-bold mb-1">Estado</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                  style={{ colorScheme: isDark ? 'dark' : 'light' }}
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                >
                  <option value="programada" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>Programada</option>
                  <option value="en_vivo" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>En Vivo</option>
                  <option value="reprogramada" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>Reprogramada</option>
                  <option value="cancelada" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>Cancelada</option>
                </select>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-bold mb-1">
                  Curso Asociado (Cursos Pago Único)
                </label>
                <select
                  value={form.course_id}
                  onChange={(e) => setForm((p) => ({ ...p, course_id: e.target.value }))}
                  style={{ colorScheme: isDark ? 'dark' : 'light' }}
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                >
                  <option value="" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>
                    -- Clase Abierta / Todos los Cursos --
                  </option>
                  {courses.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}
                    >
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-bold mb-1">
                  Especialidad (Opcional)
                </label>
                <select
                  value={form.especialidad_id}
                  onChange={(e) => setForm((p) => ({ ...p, especialidad_id: e.target.value }))}
                  style={{ colorScheme: isDark ? 'dark' : 'light' }}
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                >
                  <option value="" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>
                    -- General / Todas --
                  </option>
                  {categories.map((cat) => (
                    <option
                      key={cat.id}
                      value={cat.id}
                      className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}
                    >
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Horario */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {form.is_recurring ? (
                <div>
                  <label className="block text-xs sm:text-sm font-bold mb-1">Día de la Semana *</label>
                  <select
                    value={form.day_of_week}
                    onChange={(e) => setForm((p) => ({ ...p, day_of_week: e.target.value }))}
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                    className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                  >
                    {DAYS_OF_WEEK_ES.map((d) => (
                      <option
                        key={d.value}
                        value={d.value}
                        className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}
                      >
                        Todos los {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs sm:text-sm font-bold mb-1">Fecha *</label>
                  <input
                    type="date"
                    required={!form.is_recurring}
                    value={form.fecha_especifica}
                    onChange={(e) => setForm((p) => ({ ...p, fecha_especifica: e.target.value }))}
                    className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs sm:text-sm font-bold mb-1 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Hora Inicio (Bolivia) *
                </label>
                <input
                  type="time"
                  required
                  value={form.hora_inicio}
                  onChange={(e) => setForm((p) => ({ ...p, hora_inicio: e.target.value }))}
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                  style={{ colorScheme: isDark ? 'dark' : 'light' }}
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-bold mb-1">Duración (min) *</label>
                <input
                  type="number"
                  min={10}
                  max={480}
                  required
                  value={form.duracion_minutos}
                  onChange={(e) => setForm((p) => ({ ...p, duracion_minutos: e.target.value }))}
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                />
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {DURATION_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, duracion_minutos: preset }))}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-bold cursor-pointer ${
                        String(form.duracion_minutos) === preset
                          ? 'bg-[#014ba0] text-white'
                          : isDark
                          ? 'bg-white/10 text-slate-300'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {preset}m
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {form.is_recurring && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1 opacity-80">
                    Vigente desde (opcional)
                  </label>
                  <input
                    type="date"
                    value={form.vigente_desde}
                    onChange={(e) => setForm((p) => ({ ...p, vigente_desde: e.target.value }))}
                    className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1 opacity-80">
                    Vigente hasta (opcional)
                  </label>
                  <input
                    type="date"
                    value={form.vigente_hasta}
                    onChange={(e) => setForm((p) => ({ ...p, vigente_hasta: e.target.value }))}
                    className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                  />
                </div>
              </div>
            )}

            {/* Enlace Meet / Zoom */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs sm:text-sm font-bold">
                    Enlace de Meet / Zoom *
                  </label>
                  {form.enlace?.startsWith('http') && (
                    <a
                      href={form.enlace}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-500 hover:underline"
                    >
                      <span>Probar enlace</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <input
                  type="url"
                  required
                  value={form.enlace}
                  onChange={(e) => setForm((p) => ({ ...p, enlace: e.target.value }))}
                  placeholder="https://meet.google.com/... o https://zoom.us/j/..."
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-bold mb-1">
                  ID / Código (opcional)
                </label>
                <input
                  type="text"
                  value={form.id_reunion}
                  onChange={(e) => setForm((p) => ({ ...p, id_reunion: e.target.value }))}
                  placeholder="Ej: 834 1920 441"
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs sm:text-sm font-bold mb-1">
                Temario / Indicaciones (visible al estudiante)
              </label>
              <textarea
                rows={3}
                value={form.descripcion}
                onChange={(e) => setForm((p) => ({ ...p, descripcion: e.target.value }))}
                placeholder="Temario o indicaciones previas para los alumnos..."
                className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
              />
            </div>

            {resourceTargetDate && (
              <div
                className={`pt-4 border-t space-y-3 ${
                  isDark ? 'border-white/10' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xs sm:text-sm font-black uppercase tracking-wide flex items-center gap-1.5">
                    <Presentation className="w-4 h-4 text-[#24B0BA]" />
                    <span>Grabación y Diapositivas / Documentos</span>
                  </h2>
                  <span className="text-[11px] opacity-70 tabular-nums">
                    Sesión: {resourceTargetDate}
                  </span>
                </div>
                <LiveClassResourcesFields
                  draft={resourceDraft}
                  setDraft={setResourceDraft}
                  titleHint={form.titulo}
                  isDark={isDark}
                  inputClass={inputClass}
                  idPrefix="schedule-form"
                />
              </div>
            )}

            <div
              className={`flex justify-between pt-4 border-t ${
                isDark ? 'border-white/10' : 'border-slate-200'
              }`}
            >
              <button
                type="button"
                onClick={() => router.push(backHref)}
                className={`px-5 py-2.5 rounded-xl border text-sm font-bold transition cursor-pointer ${
                  isDark
                    ? 'border-white/15 hover:bg-white/10 text-slate-200'
                    : 'border-slate-300 hover:bg-slate-100 text-slate-700'
                }`}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2.5 rounded-xl bg-[#014ba0] hover:bg-[#013b80] disabled:opacity-50 text-white text-sm font-bold transition cursor-pointer"
              >
                {submitting ? 'Guardando...' : scheduleId ? 'Actualizar Clase' : 'Publicar Clase'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ScheduleForm({ scheduleId = null }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
        </div>
      }
    >
      <ScheduleFormInner scheduleId={scheduleId} />
    </Suspense>
  );
}
