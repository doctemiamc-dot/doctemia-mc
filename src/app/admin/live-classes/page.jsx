'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { getCachedCategories, getCachedPagoUnicoCourses } from '@/lib/catalogCache';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import {
  DAYS_OF_WEEK_ES,
  addDaysToDateStr,
  computeOccurrenceLiveStatus,
  formatEndTimeHHMM,
  formatTimeHHMM,
  getTodayBoliviaStr,
  getWeekDays,
  getWeekStartMonday,
  isExceptionPast,
  isSchedulePast,
} from '@/lib/scheduleUtils';
import Swal from 'sweetalert2';
import { toast, Toaster } from 'react-hot-toast';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  Plus,
  Repeat,
  RotateCcw,
  Trash2,
  User,
  Video,
  XCircle,
  CalendarClock,
  Loader2,
  Search,
  Copy,
  Check,
  Radio,
  LayoutList,
  CalendarDays,
  X,
  ExternalLink,
  Save,
  AlertTriangle,
  CheckSquare,
  Square,
  Presentation,
  FileText,
} from 'lucide-react';
import LiveClassResourceModal, {
  LiveClassResourcesFields,
  createEmptyResourceDraft,
  hasResourceDraftContent,
  saveLiveClassResources,
} from '@/components/live-classes/LiveClassResourceModal';

const DURATION_PRESETS = ['45', '60', '90', '120'];

function formatShortDateBadge(dateStr, todayStr) {
  if (!dateStr) return 'Sin fecha';
  const clean = String(dateStr).slice(0, 10);
  const [y, m, d] = clean.split('-').map(Number);
  if (!y || !m || !d) return clean;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const shortDay = DAYS_OF_WEEK_ES.find((item) => item.value === dow)?.short || '';
  const ddmm = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  if (clean === todayStr) return `Hoy · ${ddmm}`;
  return `${shortDay} ${ddmm}`;
}

export default function AdminLiveClassesCalendarPage() {
  const { isDark, isLoaded } = useTheme();
  const { firebaseAuthUser } = useAuth();
  const todayStr = useMemo(() => getTodayBoliviaStr(), []);
  const currentWeekMonday = useMemo(() => getWeekStartMonday(), []);

  const [weekStart, setWeekStart] = useState(() => getWeekStartMonday());
  const [occurrences, setOccurrences] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [pastArchive, setPastArchive] = useState([]);
  const [allCourses, setAllCourses] = useState([]);
  const [allCategories, setAllCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const weekCacheRef = useRef(new Map());

  const [activeTab, setActiveTab] = useState('agenda'); // 'agenda' | 'past' | 'series'

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam === 'agenda' || tabParam === 'past' || tabParam === 'series') {
      setActiveTab(tabParam);
    }
  }, []);
  const [desktopLayout, setDesktopLayout] = useState('list'); // 'list' | 'grid'
  const [selectedMobileDay, setSelectedMobileDay] = useState(() => getTodayBoliviaStr());
  const [detailOcc, setDetailOcc] = useState(null);
  const [resourceTargetOcc, setResourceTargetOcc] = useState(null);
  const [pastFilterMode, setPastFilterMode] = useState('all'); // 'all' | 'with_resources' | 'missing_resources'
  const [pastPage, setPastPage] = useState(1);
  const [pastPageSize, setPastPageSize] = useState(10);
  const [listScope, setListScope] = useState('all'); // 'all' | 'upcoming' | 'past' | 'recurring'
  const [searchTerm, setSearchTerm] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [tickNow, setTickNow] = useState(() => Date.now());

  // Registro rápido directo desde la cuadrícula semanal
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateForm, setQuickCreateForm] = useState({
    titulo: '',
    expositor: '',
    course_id: '',
    especialidad_id: '',
    enlace: '',
    id_reunion: '',
    is_recurring: false,
    day_of_week: '1',
    fecha_especifica: '',
    hora_inicio: '20:00',
    duracion_minutos: '60',
    descripcion: '',
  });
  const [savingQuickCreate, setSavingQuickCreate] = useState(false);

  // Selección múltiple y edición rápida inline
  const [selectedIds, setSelectedIds] = useState([]);
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [quickEditForm, setQuickEditForm] = useState(null);
  const [savingQuickEdit, setSavingQuickEdit] = useState(false);

  // Modal de limpieza de clases pasadas en BD
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [cleanupIncludeToday, setCleanupIncludeToday] = useState(true);
  const [cleanupIncludeRecorded, setCleanupIncludeRecorded] = useState(false);
  const [cleaningPast, setCleaningPast] = useState(false);

  // Modal nativo de reprogramación de fecha
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [rescheduleForm, setRescheduleForm] = useState({
    new_date: '',
    new_hora_inicio: '',
    new_enlace: '',
    motivo: '',
  });
  const [savingReschedule, setSavingReschedule] = useState(false);

  // Modal de edición directa desde Agenda / Cuadrícula / Clases Pasadas
  const [editOccTarget, setEditOccTarget] = useState(null);
  const [editOccForm, setEditOccForm] = useState(null);
  const [editOccResourceDraft, setEditOccResourceDraft] = useState(() =>
    createEmptyResourceDraft()
  );
  const [savingEditOcc, setSavingEditOcc] = useState(false);

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f9fafb' : '#1a2639',
      confirmButtonColor: '#014ba0',
      cancelButtonColor: '#6b7280',
    }),
    [isDark]
  );

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

  const loadWeek = useCallback(
    async (targetWeek, forceRefresh = true) => {
      if (forceRefresh) {
        weekCacheRef.current.clear();
      } else if (weekCacheRef.current.has(targetWeek)) {
        const cached = weekCacheRef.current.get(targetWeek);
        setOccurrences(cached.occurrences || []);
        setSchedules(cached.schedules || []);
        setExceptions(cached.exceptions || []);
        setPastArchive(cached.pastArchive || []);
        hasLoadedOnceRef.current = true;
        setLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (hasLoadedOnceRef.current) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `/api/schedules?weekStart=${encodeURIComponent(targetWeek)}&includePastArchive=1`,
          {
            headers,
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error cargando horarios');
        const payload = {
          occurrences: data.occurrences || [],
          schedules: data.schedules || [],
          exceptions: data.exceptions || [],
          pastArchive: data.pastArchive || [],
        };
        weekCacheRef.current.set(targetWeek, payload);
        setOccurrences(payload.occurrences);
        setSchedules(payload.schedules);
        setExceptions(payload.exceptions);
        setPastArchive(payload.pastArchive);
      } catch (err) {
        toast.error(err.message);
      } finally {
        hasLoadedOnceRef.current = true;
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [getAuthHeaders]
  );

  useEffect(() => {
    loadWeek(weekStart, false);
  }, [weekStart, loadWeek]);

  // Cargar cursos y especialidades desde caché de sesión para edición rápida inline
  useEffect(() => {
    const loadCatalogs = async () => {
      try {
        const [puCourses, cats] = await Promise.all([
          getCachedPagoUnicoCourses({ onlyActive: false }),
          getCachedCategories(),
        ]);
        setAllCourses(puCourses);
        setAllCategories(cats);
      } catch (err) {
        console.error('Error cargando cursos/especialidades en admin:', err);
      }
    };
    loadCatalogs();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTickNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  useEffect(() => {
    const belongs = weekDays.some((d) => d.date === selectedMobileDay);
    if (!belongs && weekDays.length > 0) {
      const todayInWeek = weekDays.find((d) => d.date === todayStr);
      const firstWithClass = weekDays.find((d) =>
        occurrences.some((o) => o.occurrence_date === d.date)
      );
      setSelectedMobileDay(todayInWeek?.date || firstWithClass?.date || weekDays[0].date);
    }
  }, [weekDays, selectedMobileDay, todayStr, occurrences]);

  const uniqueCourseOptions = useMemo(() => {
    const map = new Map();
    for (const c of allCourses) {
      if (c.id && c.title) map.set(c.id, c.title);
    }
    for (const s of schedules) {
      if (s.course_id && s.course_title && !map.has(s.course_id)) {
        map.set(s.course_id, s.course_title);
      }
    }
    return Array.from(map.entries())
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [allCourses, schedules]);

  const filteredOccurrences = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return occurrences.filter((occ) => {
      if (courseFilter && occ.course_id !== courseFilter) return false;
      if (!q) return true;
      return (
        (occ.titulo || '').toLowerCase().includes(q) ||
        (occ.expositor || '').toLowerCase().includes(q) ||
        (occ.course_title || '').toLowerCase().includes(q)
      );
    });
  }, [occurrences, searchTerm, courseFilter]);

  const filteredSchedules = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return schedules.filter((sch) => {
      if (courseFilter && sch.course_id !== courseFilter) return false;
      if (!q) return true;
      return (
        (sch.titulo || '').toLowerCase().includes(q) ||
        (sch.expositor || '').toLowerCase().includes(q) ||
        (sch.course_title || '').toLowerCase().includes(q) ||
        (sch.especialidad_nombre || '').toLowerCase().includes(q)
      );
    });
  }, [schedules, searchTerm, courseFilter]);

  // Resumen global de registros pasados en BD (protegiendo automáticamente los que tienen grabación/diapos)
  const pastSummary = useMemo(() => {
    let uniqueBeforeToday = 0;
    let uniqueTodayFinished = 0;
    let expiredSeries = 0;
    let protectedBeforeToday = 0;
    let protectedTodayFinished = 0;

    for (const sch of schedules) {
      const isBeforeToday = !sch.is_recurring
        ? Boolean(sch.fecha_especifica && String(sch.fecha_especifica).slice(0, 10) < todayStr)
        : isSchedulePast(sch, todayStr, tickNow, false);
      const isTodayFin =
        !sch.is_recurring &&
        sch.fecha_especifica &&
        String(sch.fecha_especifica).slice(0, 10) === todayStr &&
        isSchedulePast(sch, todayStr, tickNow, true);

      if (!isBeforeToday && !isTodayFin) continue;
      if (sch.has_resources) {
        if (isBeforeToday) protectedBeforeToday += 1;
        else if (isTodayFin) protectedTodayFinished += 1;
        continue;
      }

      if (!sch.is_recurring) {
        if (isBeforeToday) uniqueBeforeToday += 1;
        else if (isTodayFin) uniqueTodayFinished += 1;
      } else if (isBeforeToday) {
        expiredSeries += 1;
      }
    }

    const protectedCount = protectedBeforeToday + protectedTodayFinished;

    const pastScheduleIdSet = new Set(
      schedules
        .filter((s) => !s.has_resources && isSchedulePast(s, todayStr, tickNow, cleanupIncludeToday))
        .map((s) => s.id)
    );
    const pastExceptions = exceptions.filter(
      (exc) => !pastScheduleIdSet.has(exc.schedule_id) && isExceptionPast(exc, todayStr)
    ).length;

    const totalBeforeToday = uniqueBeforeToday + expiredSeries + pastExceptions;
    const totalIncludingToday = totalBeforeToday + uniqueTodayFinished;

    return {
      uniqueBeforeToday,
      uniqueTodayFinished,
      expiredSeries,
      pastExceptions,
      protectedCount,
      protectedBeforeToday,
      protectedTodayFinished,
      totalBeforeToday,
      totalIncludingToday,
    };
  }, [schedules, exceptions, todayStr, tickNow, cleanupIncludeToday]);

  const pastCounts = useMemo(() => {
    let withResources = 0;
    let missingResources = 0;
    const q = searchTerm.trim().toLowerCase();
    for (const occ of pastArchive) {
      if (courseFilter && occ.course_id !== courseFilter) continue;
      if (q) {
        const matches =
          (occ.titulo || '').toLowerCase().includes(q) ||
          (occ.expositor || '').toLowerCase().includes(q) ||
          (occ.course_title || '').toLowerCase().includes(q);
        if (!matches) continue;
      }
      if (occ.has_resources) withResources += 1;
      else missingResources += 1;
    }
    return { total: withResources + missingResources, withResources, missingResources };
  }, [pastArchive, searchTerm, courseFilter]);

  const filteredPastArchive = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return pastArchive.filter((occ) => {
      if (courseFilter && occ.course_id !== courseFilter) return false;
      if (pastFilterMode === 'with_resources' && !occ.has_resources) return false;
      if (pastFilterMode === 'missing_resources' && occ.has_resources) return false;
      if (!q) return true;
      return (
        (occ.titulo || '').toLowerCase().includes(q) ||
        (occ.expositor || '').toLowerCase().includes(q) ||
        (occ.course_title || '').toLowerCase().includes(q)
      );
    });
  }, [pastArchive, searchTerm, courseFilter, pastFilterMode]);

  useEffect(() => {
    setPastPage(1);
  }, [pastFilterMode, searchTerm, courseFilter, pastPageSize]);

  const pastTotalPages = Math.max(1, Math.ceil(filteredPastArchive.length / pastPageSize));
  const safePastPage = Math.min(pastPage, pastTotalPages);
  const paginatedPastArchive = useMemo(() => {
    const start = (safePastPage - 1) * pastPageSize;
    return filteredPastArchive.slice(start, start + pastPageSize);
  }, [filteredPastArchive, safePastPage, pastPageSize]);

  const openQuickCreateForDate = useCallback(
    (dateStr) => {
      const cleanDate = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : todayStr;
      const [y, m, d] = cleanDate.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      setQuickCreateForm({
        titulo: '',
        expositor: '',
        course_id: courseFilter || '',
        especialidad_id: '',
        enlace: '',
        id_reunion: '',
        is_recurring: false,
        day_of_week: String(dow),
        fecha_especifica: cleanDate,
        hora_inicio: '20:00',
        duracion_minutos: '60',
        descripcion: '',
      });
      setQuickCreateOpen(true);
    },
    [todayStr, courseFilter]
  );

  const handleSaveQuickCreate = async (e) => {
    e.preventDefault();
    if (savingQuickCreate) return;

    const selectedCourse = allCourses.find((c) => c.id === quickCreateForm.course_id);
    const selectedEsp = allCategories.find((c) => c.id === quickCreateForm.especialidad_id);

    const payload = {
      titulo: quickCreateForm.titulo.trim(),
      descripcion: quickCreateForm.descripcion.trim() || null,
      expositor: quickCreateForm.expositor.trim(),
      course_id: quickCreateForm.course_id || null,
      course_title: selectedCourse?.title || null,
      especialidad_id: quickCreateForm.especialidad_id || null,
      especialidad_nombre: selectedEsp?.name || null,
      enlace: quickCreateForm.enlace.trim(),
      id_reunion: quickCreateForm.id_reunion.trim() || null,
      is_recurring: Boolean(quickCreateForm.is_recurring),
      day_of_week: quickCreateForm.is_recurring ? Number(quickCreateForm.day_of_week) : null,
      fecha_especifica: !quickCreateForm.is_recurring ? quickCreateForm.fecha_especifica : null,
      hora_inicio: quickCreateForm.hora_inicio,
      duracion_minutos: Number(quickCreateForm.duracion_minutos) || 60,
      status: 'programada',
    };

    setSavingQuickCreate(true);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo programar la clase');

      toast.success('Clase registrada en la cuadrícula');
      setQuickCreateOpen(false);
      await loadWeek(weekStart, true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingQuickCreate(false);
    }
  };

  // Contadores de filtros rápidos para Tab "Todas las Semanas"
  const listScopeCounts = useMemo(() => {
    let upcoming = 0;
    let past = 0;
    let recurring = 0;
    for (const s of filteredSchedules) {
      if (s.is_recurring) recurring += 1;
      if (isSchedulePast(s, todayStr, tickNow, true)) past += 1;
      else upcoming += 1;
    }
    return {
      all: filteredSchedules.length,
      upcoming,
      past,
      recurring,
    };
  }, [filteredSchedules, todayStr, tickNow]);

  // Agrupación cronológica por semanas + series recurrentes para edición rápida
  const groupedWeekEditor = useMemo(() => {
    const scoped = filteredSchedules.filter((s) => {
      const past = isSchedulePast(s, todayStr, tickNow, true);
      if (listScope === 'upcoming') return !past;
      if (listScope === 'past') return past;
      if (listScope === 'recurring') return Boolean(s.is_recurring);
      return true;
    });

    const weekMap = new Map();
    const recurringList = [];

    for (const s of scoped) {
      if (s.is_recurring) {
        recurringList.push(s);
        continue;
      }
      const fecha = s.fecha_especifica ? String(s.fecha_especifica).slice(0, 10) : '';
      const wStart = fecha ? getWeekStartMonday(fecha) : 'sin-fecha';
      if (!weekMap.has(wStart)) weekMap.set(wStart, []);
      weekMap.get(wStart).push(s);
    }

    recurringList.sort((a, b) => {
      const dowA = Number(a.day_of_week) === 0 ? 7 : Number(a.day_of_week);
      const dowB = Number(b.day_of_week) === 0 ? 7 : Number(b.day_of_week);
      if (dowA !== dowB) return dowA - dowB;
      return formatTimeHHMM(a.hora_inicio).localeCompare(formatTimeHHMM(b.hora_inicio));
    });

    const buildWeekGroup = (wStart, items) => {
      const sortedItems = [...items].sort((a, b) => {
        const cmpD = String(a.fecha_especifica || '').localeCompare(String(b.fecha_especifica || ''));
        if (cmpD !== 0) return cmpD;
        return formatTimeHHMM(a.hora_inicio).localeCompare(formatTimeHHMM(b.hora_inicio));
      });
      const days = wStart !== 'sin-fecha' ? getWeekDays(wStart) : [];
      const nextMonday = addDaysToDateStr(currentWeekMonday, 7);
      const isCurrent = wStart === currentWeekMonday;
      const isNext = wStart === nextMonday;
      const isPastWeek = wStart !== 'sin-fecha' && wStart < currentWeekMonday;
      const pastIds = sortedItems
        .filter((item) => isSchedulePast(item, todayStr, tickNow, true))
        .map((item) => item.id);

      let badge = 'Semana futura';
      if (wStart === 'sin-fecha') badge = 'Sin fecha asignada';
      else if (isCurrent) badge = 'Semana actual';
      else if (isNext) badge = 'Próxima semana';
      else if (isPastWeek) badge = 'Semana pasada';

      return {
        weekStart: wStart,
        rangeLabel: days.length ? `${days[0].displayDate} – ${days[6].displayDate}` : 'Sin fecha',
        badge,
        isCurrent,
        isNext,
        isPastWeek,
        items: sortedItems,
        pastIds,
      };
    };

    const upcomingWeeks = [];
    const pastWeeks = [];

    for (const [wStart, items] of weekMap.entries()) {
      const grp = buildWeekGroup(wStart, items);
      if (grp.isPastWeek) pastWeeks.push(grp);
      else upcomingWeeks.push(grp);
    }

    upcomingWeeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    pastWeeks.sort((a, b) => b.weekStart.localeCompare(a.weekStart));

    return {
      totalScoped: scoped.length,
      scopedIds: scoped.map((s) => s.id),
      upcomingWeeks,
      pastWeeks,
      recurringList,
    };
  }, [filteredSchedules, listScope, currentWeekMonday, todayStr, tickNow]);

  const daysWithOccurrences = useMemo(() => {
    return weekDays
      .map((day) => ({
        day,
        items: filteredOccurrences.filter((o) => o.occurrence_date === day.date),
      }))
      .filter((g) => g.items.length > 0);
  }, [weekDays, filteredOccurrences]);

  const stats = useMemo(() => {
    let liveNow = 0;
    let exceptionsCount = 0;
    for (const occ of occurrences) {
      if (computeOccurrenceLiveStatus(occ, tickNow) === 'en_vivo') liveNow += 1;
      if (occ.status === 'cancelada' || occ.status === 'reprogramada') exceptionsCount += 1;
    }
    const recurringCount = schedules.filter((s) => s.is_recurring).length;
    return {
      weekTotal: occurrences.length,
      liveNow,
      recurringCount,
      exceptions: exceptionsCount,
    };
  }, [occurrences, schedules, tickNow]);

  const toggleQuickEdit = (sch) => {
    if (editingScheduleId === sch.id) {
      setEditingScheduleId(null);
      setQuickEditForm(null);
      return;
    }
    setEditingScheduleId(sch.id);
    setQuickEditForm({
      titulo: sch.titulo || '',
      descripcion: sch.descripcion || '',
      expositor: sch.expositor || '',
      course_id: sch.course_id || '',
      especialidad_id: sch.especialidad_id || '',
      enlace: sch.enlace || '',
      id_reunion: sch.id_reunion || '',
      is_recurring: Boolean(sch.is_recurring),
      day_of_week: sch.day_of_week !== null && sch.day_of_week !== undefined ? String(sch.day_of_week) : '1',
      fecha_especifica: sch.fecha_especifica ? String(sch.fecha_especifica).slice(0, 10) : todayStr,
      hora_inicio: formatTimeHHMM(sch.hora_inicio) || '20:00',
      duracion_minutos: String(sch.duracion_minutos || 60),
      status: sch.status || 'programada',
      vigente_desde: sch.vigente_desde ? String(sch.vigente_desde).slice(0, 10) : '',
      vigente_hasta: sch.vigente_hasta ? String(sch.vigente_hasta).slice(0, 10) : '',
    });
  };

  const handleSaveQuickEdit = async (e, originalSch) => {
    e.preventDefault();
    if (!editingScheduleId || !quickEditForm || savingQuickEdit) return;
    if (!quickEditForm.titulo.trim() || !quickEditForm.expositor.trim() || !quickEditForm.enlace.trim()) {
      toast.error('Título, expositor y enlace son obligatorios');
      return;
    }
    if (!quickEditForm.is_recurring && !quickEditForm.fecha_especifica) {
      toast.error('Debes elegir una fecha para clases únicas');
      return;
    }

    setSavingQuickEdit(true);
    try {
      const courseObj = allCourses.find((c) => c.id === quickEditForm.course_id);
      const espObj = allCategories.find((c) => c.id === quickEditForm.especialidad_id);

      const courseTitle = quickEditForm.course_id
        ? courseObj?.title || (originalSch.course_id === quickEditForm.course_id ? originalSch.course_title : null)
        : null;
      const espNombre = quickEditForm.especialidad_id
        ? espObj?.name || (originalSch.especialidad_id === quickEditForm.especialidad_id ? originalSch.especialidad_nombre : null)
        : null;

      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`/api/schedules/${editingScheduleId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          titulo: quickEditForm.titulo.trim(),
          descripcion: quickEditForm.descripcion.trim() || null,
          expositor: quickEditForm.expositor.trim(),
          course_id: quickEditForm.course_id || null,
          course_title: courseTitle,
          especialidad_id: quickEditForm.especialidad_id || null,
          especialidad_nombre: espNombre,
          enlace: quickEditForm.enlace.trim(),
          id_reunion: quickEditForm.id_reunion.trim() || null,
          is_recurring: Boolean(quickEditForm.is_recurring),
          day_of_week: quickEditForm.is_recurring ? Number(quickEditForm.day_of_week) : null,
          fecha_especifica: quickEditForm.is_recurring ? null : quickEditForm.fecha_especifica,
          hora_inicio: quickEditForm.hora_inicio,
          duracion_minutos: Number(quickEditForm.duracion_minutos) || 60,
          status: quickEditForm.status || 'programada',
          vigente_desde: quickEditForm.is_recurring ? quickEditForm.vigente_desde || null : null,
          vigente_hasta: quickEditForm.is_recurring ? quickEditForm.vigente_hasta || null : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo actualizar');

      toast.success('Clase actualizada al instante');
      setEditingScheduleId(null);
      setQuickEditForm(null);
      await loadWeek(weekStart);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingQuickEdit(false);
    }
  };

  const toggleSelectId = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleBulkDeleteIds = async (idsToDelete, titleText) => {
    if (!idsToDelete?.length) return;
    const confirm = await Swal.fire({
      title: titleText || `¿Eliminar ${idsToDelete.length} programaciones?`,
      text: `Se borrarán permanentemente ${idsToDelete.length} ${
        idsToDelete.length === 1 ? 'clase' : 'clases'
      } de la base de datos.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar de la BD',
      cancelButtonText: 'Cancelar',
      ...swalTheme,
      confirmButtonColor: '#dc2626',
    });
    if (!confirm.isConfirmed) return;

    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/schedules', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ mode: 'selected', ids: idsToDelete }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al eliminar');
      const filesMsg =
        (data.deletedFilesCount || 0) > 0
          ? ` y ${data.deletedFilesCount} archivo(s) borrados de Storage/BD`
          : '';
      toast.success(`${data.deletedSchedules || idsToDelete.length} clases eliminadas${filesMsg}`);
      setSelectedIds((prev) => prev.filter((id) => !idsToDelete.includes(id)));
      if (idsToDelete.includes(editingScheduleId)) {
        setEditingScheduleId(null);
        setQuickEditForm(null);
      }
      await loadWeek(weekStart);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleConfirmCleanupPast = async () => {
    if (cleaningPast) return;
    setCleaningPast(true);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/schedules', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({
          mode: 'cleanup_past',
          includeTodayFinished: cleanupIncludeToday,
          includeRecorded: cleanupIncludeRecorded,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo limpiar la base de datos');

      const total = (data.deletedSchedules || 0) + (data.deletedExceptions || 0);
      const protectedMsg =
        (data.protectedWithResourcesCount || 0) > 0
          ? ` (${data.protectedWithResourcesCount} con grabación/diapos protegidas)`
          : '';
      const filesMsg =
        (data.deletedFilesCount || 0) > 0
          ? ` y ${data.deletedFilesCount} archivo(s) borrado(s) de Storage/BD`
          : '';
      if (total === 0) {
        toast(`No había clases para limpiar${protectedMsg}.`);
      } else {
        toast.success(
          `Limpieza lista: ${data.deletedSchedules || 0} clases y ${data.deletedExceptions || 0} excepciones eliminadas${filesMsg}${protectedMsg}`
        );
      }
      setCleanupModalOpen(false);
      setCleanupIncludeRecorded(false);
      setSelectedIds([]);
      await loadWeek(weekStart);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCleaningPast(false);
    }
  };

  const openRescheduleModal = (occ) => {
    setRescheduleTarget(occ);
    setRescheduleForm({
      new_date: occ.occurrence_date || '',
      new_hora_inicio: occ.hora_inicio || '20:00',
      new_enlace: occ.enlace || '',
      motivo: occ.motivo || '',
    });
  };

  const handleSaveReschedule = async (e) => {
    e.preventDefault();
    if (!rescheduleTarget || savingReschedule) return;
    setSavingReschedule(true);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`/api/schedules/${rescheduleTarget.schedule_id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          mode: rescheduleTarget.is_recurring ? 'single_occurrence' : undefined,
          original_date: rescheduleTarget.original_date,
          action: 'rescheduled',
          ...(rescheduleTarget.is_recurring
            ? rescheduleForm
            : {
                fecha_especifica: rescheduleForm.new_date,
                hora_inicio: rescheduleForm.new_hora_inicio,
                enlace: rescheduleForm.new_enlace,
                status: 'reprogramada',
              }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo reprogramar la clase');
      toast.success('Clase reprogramada con éxito');
      setRescheduleTarget(null);
      await loadWeek(weekStart);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingReschedule(false);
    }
  };

  const openEditOccModal = (occ) => {
    const matchedSchedule = schedules.find((s) => s.id === occ.schedule_id);
    setEditOccTarget(occ);
    setEditOccResourceDraft(createEmptyResourceDraft(occ));
    setEditOccForm({
      titulo: matchedSchedule?.titulo || occ.titulo || '',
      expositor: matchedSchedule?.expositor || occ.expositor || '',
      descripcion: matchedSchedule?.descripcion ?? occ.descripcion ?? '',
      course_id: matchedSchedule?.course_id ?? occ.course_id ?? '',
      especialidad_id: matchedSchedule?.especialidad_id ?? occ.especialidad_id ?? '',
      enlace: occ.enlace || matchedSchedule?.enlace || '',
      id_reunion: matchedSchedule?.id_reunion ?? occ.id_reunion ?? '',
      fecha_especifica: occ.occurrence_date || (matchedSchedule?.fecha_especifica ? String(matchedSchedule.fecha_especifica).slice(0, 10) : todayStr),
      hora_inicio: occ.hora_inicio || formatTimeHHMM(matchedSchedule?.hora_inicio) || '20:00',
      duracion_minutos: String(matchedSchedule?.duracion_minutos || occ.duracion_minutos || 60),
      status: occ.status || matchedSchedule?.status || 'programada',
      motivo: occ.motivo || '',
    });
  };

  const handleSaveEditOcc = async (e) => {
    e.preventDefault();
    if (!editOccTarget || !editOccForm || savingEditOcc) return;

    setSavingEditOcc(true);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const targetOccDate = editOccForm.fecha_especifica || editOccTarget.occurrence_date;

      if (editOccTarget.is_recurring) {
        if (!editOccForm.fecha_especifica || !editOccForm.hora_inicio || !editOccForm.enlace.trim()) {
          throw new Error('Fecha, hora y enlace son obligatorios.');
        }
        const res = await fetch(`/api/schedules/${editOccTarget.schedule_id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            mode: 'single_occurrence',
            original_date: editOccTarget.original_date,
            action: 'rescheduled',
            new_date: editOccForm.fecha_especifica,
            new_hora_inicio: editOccForm.hora_inicio,
            new_enlace: editOccForm.enlace.trim(),
            motivo: editOccForm.motivo.trim() || null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo actualizar esta sesión');
      } else {
        if (!editOccForm.titulo.trim() || !editOccForm.expositor.trim() || !editOccForm.enlace.trim()) {
          throw new Error('Título, expositor y enlace son obligatorios.');
        }
        if (!editOccForm.fecha_especifica) {
          throw new Error('Debes indicar la fecha de la clase.');
        }
        const matchedSchedule = schedules.find((s) => s.id === editOccTarget.schedule_id);
        const courseObj = allCourses.find((c) => c.id === editOccForm.course_id);
        const espObj = allCategories.find((c) => c.id === editOccForm.especialidad_id);

        const courseTitle = editOccForm.course_id
          ? courseObj?.title ||
            (matchedSchedule?.course_id === editOccForm.course_id
              ? matchedSchedule.course_title
              : editOccTarget.course_id === editOccForm.course_id
              ? editOccTarget.course_title
              : null)
          : null;
        const espNombre = editOccForm.especialidad_id
          ? espObj?.name ||
            (matchedSchedule?.especialidad_id === editOccForm.especialidad_id
              ? matchedSchedule.especialidad_nombre
              : editOccTarget.especialidad_id === editOccForm.especialidad_id
              ? editOccTarget.especialidad_nombre
              : null)
          : null;

        const res = await fetch(`/api/schedules/${editOccTarget.schedule_id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            titulo: editOccForm.titulo.trim(),
            descripcion: editOccForm.descripcion.trim() || null,
            expositor: editOccForm.expositor.trim(),
            course_id: editOccForm.course_id || null,
            course_title: courseTitle,
            especialidad_id: editOccForm.especialidad_id || null,
            especialidad_nombre: espNombre,
            enlace: editOccForm.enlace.trim(),
            id_reunion: editOccForm.id_reunion.trim() || null,
            is_recurring: false,
            day_of_week: null,
            fecha_especifica: editOccForm.fecha_especifica,
            hora_inicio: editOccForm.hora_inicio,
            duracion_minutos: Number(editOccForm.duracion_minutos) || 60,
            status: editOccForm.status || 'programada',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo actualizar la clase');
      }

      let resMsg = null;
      if (targetOccDate && hasResourceDraftContent(editOccResourceDraft)) {
        const resSave = await saveLiveClassResources({
          scheduleId: editOccTarget.schedule_id,
          occurrenceDate: targetOccDate,
          draft: editOccResourceDraft,
          getAuthHeaders,
        });
        resMsg = resSave.message;
      }

      toast.success(
        resMsg
          ? `Clase actualizada · ${resMsg}`
          : editOccTarget.is_recurring
          ? 'Sesión puntual actualizada'
          : 'Clase actualizada con éxito'
      );
      setEditOccTarget(null);
      setEditOccForm(null);
      await loadWeek(weekStart, true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingEditOcc(false);
    }
  };

  const handleCancelOccurrence = async (occ) => {
    const confirm = await Swal.fire({
      title: '¿Cancelar esta sesión?',
      text: occ.is_recurring
        ? `Se cancelará solo la sesión del ${occ.occurrence_date} (la serie semanal se mantiene).`
        : 'Se marcará esta clase como cancelada.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, cancelar',
      cancelButtonText: 'Volver',
      ...swalTheme,
    });
    if (!confirm.isConfirmed) return;

    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`/api/schedules/${occ.schedule_id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(
          occ.is_recurring
            ? {
                mode: 'single_occurrence',
                original_date: occ.original_date,
                action: 'cancelled',
                motivo: 'Cancelada por el administrador',
              }
            : { status: 'cancelada' }
        ),
      });
      if (!res.ok) throw new Error('No se pudo cancelar');
      toast.success('Sesión cancelada');
      await loadWeek(weekStart);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRestoreOccurrence = async (occ) => {
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`/api/schedules/${occ.schedule_id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(
          occ.is_recurring
            ? { mode: 'restore_occurrence', original_date: occ.original_date }
            : { status: 'programada' }
        ),
      });
      if (!res.ok) throw new Error('No se pudo restaurar');
      toast.success('Sesión restaurada al horario normal');
      await loadWeek(weekStart);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteSchedule = async (scheduleId, title) => {
    const targetSch = schedules.find((s) => s.id === scheduleId);
    const hasAttachedFiles = Boolean(targetSch?.has_resources);
    const confirm = await Swal.fire({
      title: '¿Eliminar programación?',
      text: hasAttachedFiles
        ? `Se eliminará "${title}" de forma permanente junto con sus enlaces, registros y archivos subidos en Storage/BD.`
        : `Se eliminará "${title}" de forma permanente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      ...swalTheme,
      confirmButtonColor: '#dc2626',
    });
    if (!confirm.isConfirmed) return;

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar');
      const deletedFiles = Number(data.deletedFilesCount || 0);
      toast.success(
        deletedFiles > 0
          ? `Programación y ${deletedFiles} archivo(s) eliminados de Storage y BD`
          : 'Programación eliminada'
      );
      await loadWeek(weekStart);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleCopyLink = async (id, enlace) => {
    if (!enlace) return;
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiedId(id);
      toast.success('Enlace copiado');
      setTimeout(() => setCopiedId((p) => (p === id ? '' : p)), 1800);
    } catch {
      toast.error('No se pudo copiar');
    }
  };

  if (!isLoaded) return null;

  const surfaceClass = isDark
    ? 'bg-[#1e293b] border-white/10 text-white'
    : 'bg-white border-slate-200 text-slate-900';
  const inputClass = isDark
    ? 'bg-[#162235] border-white/15 text-white placeholder:text-slate-400 focus:border-[#24B0BA]'
    : 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-[#014ba0] focus:bg-white';

  const renderAdminActionButtons = (occ, closeModalOnAction = false) => {
    const isCancelled = occ.status === 'cancelada';
    const isRescheduled = occ.status === 'reprogramada';

    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            if (closeModalOnAction) setDetailOcc(null);
            setResourceTargetOcc(occ);
          }}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
            occ.has_resources
              ? isDark
                ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
              : isDark
              ? 'bg-[#24B0BA]/20 text-[#24B0BA] hover:bg-[#24B0BA]/30'
              : 'bg-[#014ba0]/10 text-[#014ba0] hover:bg-[#014ba0]/15'
          }`}
          title="Adjuntar link de grabación y diapositivas para esta fecha"
        >
          <Presentation className="w-3.5 h-3.5" />
          <span>{occ.has_resources ? 'Grabación / Diapos ✓' : 'Grabación / Diapos'}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (closeModalOnAction) setDetailOcc(null);
            openRescheduleModal(occ);
          }}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
            isDark
              ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
              : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
          }`}
          title="Reprogramar esta fecha"
        >
          <CalendarClock className="w-3.5 h-3.5" />
          <span>Reprogramar</span>
        </button>

        {isCancelled || isRescheduled ? (
          <button
            type="button"
            onClick={() => {
              if (closeModalOnAction) setDetailOcc(null);
              handleRestoreOccurrence(occ);
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
              isDark
                ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
            title="Restaurar horario normal"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restaurar</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (closeModalOnAction) setDetailOcc(null);
              handleCancelOccurrence(occ);
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
              isDark
                ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
            title="Cancelar solo esta sesión"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>Cancelar fecha</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => handleCopyLink(occ.occurrence_id, occ.enlace)}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
            isDark
              ? 'bg-white/10 text-slate-200 hover:bg-white/15'
              : 'bg-slate-200/70 text-slate-700 hover:bg-slate-200'
          }`}
          title="Copiar enlace Meet/Zoom"
        >
          {copiedId === occ.occurrence_id ? (
            <Check className="w-3.5 h-3.5 text-emerald-500" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          <span>Copiar</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (closeModalOnAction) setDetailOcc(null);
            openEditOccModal(occ);
          }}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
            isDark
              ? 'bg-white/10 text-blue-200 hover:bg-white/15'
              : 'bg-slate-200/70 text-slate-800 hover:bg-slate-200'
          }`}
          title="Editar datos de la clase"
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span>Editar</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (closeModalOnAction) setDetailOcc(null);
            handleDeleteSchedule(occ.schedule_id, occ.titulo);
          }}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
            isDark
              ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
              : 'bg-red-50 text-red-600 hover:bg-red-100'
          }`}
          title="Eliminar programación"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  // Fila horizontal completa para Vista Agenda (ocupa todo el ancho sin comprimirse a la izquierda)
  const renderAdminAgendaRowCard = (occ, showDateBadge = false) => {
    const liveStatus = computeOccurrenceLiveStatus(occ, tickNow);
    const isLiveNow = liveStatus === 'en_vivo';
    const isCancelled = occ.status === 'cancelada';
    const isRescheduled = occ.status === 'reprogramada';
    const isPastSession =
      liveStatus === 'finalizada' || Boolean(occ.occurrence_date && occ.occurrence_date < todayStr);
    const endTime = formatEndTimeHHMM(occ.hora_inicio, occ.duracion_minutos);

    return (
      <div
        key={`${occ.occurrence_id}__${occ.occurrence_date}`}
        className={`w-full rounded-2xl border p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 transition-colors ${
          isLiveNow
            ? isDark
              ? 'bg-emerald-950/30 border-emerald-500'
              : 'bg-emerald-50 border-emerald-400'
            : isCancelled
            ? isDark
              ? 'bg-red-950/25 border-red-800/60 opacity-80'
              : 'bg-red-50/70 border-red-200 opacity-80'
            : isDark
            ? 'bg-[#162235] border-white/10'
            : 'bg-slate-50/80 border-slate-200'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 min-w-0 flex-1">
          {/* Bloque de horario */}
          <div
            className={`shrink-0 rounded-xl px-3 py-2 border flex sm:flex-col items-center sm:items-start justify-between sm:justify-center gap-1.5 sm:min-w-[144px] ${
              isLiveNow
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : isDark
                ? 'bg-[#1e293b] border-white/10 text-white'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            {showDateBadge && (
              <span className="text-[11px] font-extrabold text-[#24B0BA] tabular-nums">
                {formatShortDateBadge(occ.occurrence_date, todayStr)}
              </span>
            )}
            <div className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-black tabular-nums">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>
                {occ.hora_inicio} – {endTime}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {isLiveNow && (
                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase">
                  <Radio className="w-3 h-3" />
                  <span>En vivo</span>
                </span>
              )}
              {isCancelled && (
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-red-500/20 text-red-500">
                  CANCELADA
                </span>
              )}
              {isPastSession && !isLiveNow && !isCancelled && (
                <span
                  className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                    isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  PASADA
                </span>
              )}
              {isRescheduled && !isCancelled && !isPastSession && (
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600">
                  REPROGRAMADA
                </span>
              )}
              {occ.is_recurring && !isLiveNow && !isCancelled && !isRescheduled && !isPastSession && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-bold ${
                    isDark ? 'text-blue-300' : 'text-blue-700'
                  }`}
                >
                  <Repeat className="w-3 h-3" />
                  <span>Semanal</span>
                </span>
              )}
            </div>
          </div>

          {/* Información principal */}
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600">
                {occ.course_title || 'Clase General'}
              </span>
              {occ.especialidad_nombre && (
                <span
                  className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md ${
                    isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-200/80 text-slate-700'
                  }`}
                >
                  {occ.especialidad_nombre}
                </span>
              )}
              {occ.has_recording && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md ${
                    isDark
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}
                >
                  <Video className="w-3 h-3" />
                  <span>Grabación</span>
                </span>
              )}
              {occ.has_slides && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md ${
                    isDark
                      ? 'bg-blue-500/20 text-blue-300'
                      : 'bg-blue-50 text-blue-700 border border-blue-200'
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  <span>Diapositivas</span>
                </span>
              )}
            </div>

            <h3 className={`font-extrabold text-sm sm:text-base leading-snug ${isCancelled ? 'line-through' : ''}`}>
              {occ.titulo}
            </h3>

            <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              <span className="inline-flex items-center gap-1.5 font-medium">
                <User className="w-3.5 h-3.5 shrink-0" />
                <span>{occ.expositor}</span>
              </span>
              {occ.motivo && (isCancelled || isRescheduled) && (
                <span className="italic opacity-85">· {occ.motivo}</span>
              )}
            </div>
          </div>
        </div>

        {/* Acciones a la derecha */}
        <div
          className={`pt-2.5 lg:pt-0 border-t lg:border-t-0 shrink-0 ${
            isDark ? 'border-white/10' : 'border-slate-200'
          }`}
        >
          {renderAdminActionButtons(occ, false)}
        </div>
      </div>
    );
  };

  // Ficha compacta para Cuadrícula (evita columnas estiradas verticalmente; toca para ver acciones)
  const renderAdminCompactGridCard = (occ) => {
    const liveStatus = computeOccurrenceLiveStatus(occ, tickNow);
    const isLiveNow = liveStatus === 'en_vivo';
    const isCancelled = occ.status === 'cancelada';
    const isRescheduled = occ.status === 'reprogramada';
    const endTime = formatEndTimeHHMM(occ.hora_inicio, occ.duracion_minutos);

    return (
      <div
        key={occ.occurrence_id}
        role="button"
        tabIndex={0}
        onClick={() => setDetailOcc(occ)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setDetailOcc(occ);
          }
        }}
        className={`rounded-xl border p-2.5 space-y-1.5 cursor-pointer transition-all hover:shadow-sm ${
          isLiveNow
            ? isDark
              ? 'bg-emerald-950/35 border-emerald-500'
              : 'bg-emerald-50 border-emerald-400'
            : isCancelled
            ? isDark
              ? 'bg-red-950/25 border-red-800/60 opacity-75'
              : 'bg-red-50/70 border-red-200 opacity-75'
            : isDark
            ? 'bg-[#162235] border-white/10 hover:border-[#24B0BA]/60'
            : 'bg-slate-50 border-slate-200 hover:border-[#014ba0]/50'
        }`}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-black text-blue-500 tabular-nums truncate">
            {occ.hora_inicio}–{endTime}
          </span>
          {isLiveNow ? (
            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-emerald-600 text-white shrink-0">
              VIVO
            </span>
          ) : isCancelled ? (
            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-500 shrink-0">
              CANCEL.
            </span>
          ) : isRescheduled ? (
            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 shrink-0">
              REPROG.
            </span>
          ) : occ.is_recurring ? (
            <Repeat className="w-3 h-3 text-blue-400 shrink-0" title="Serie semanal" />
          ) : null}
        </div>

        <h4 className={`text-xs font-extrabold leading-snug line-clamp-2 ${isCancelled ? 'line-through' : ''}`}>
          {occ.titulo}
        </h4>

        <div className="flex flex-wrap gap-1">
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 truncate max-w-full">
            {occ.course_title || 'General'}
          </span>
          {occ.especialidad_nombre && (
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded truncate max-w-full ${
                isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-200/80 text-slate-700'
              }`}
            >
              {occ.especialidad_nombre}
            </span>
          )}
        </div>

        <p className={`text-[10px] truncate ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
          {occ.expositor}
        </p>

        {(occ.has_recording || occ.has_slides) && (
          <div className="flex flex-wrap gap-1">
            {occ.has_recording && (
              <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500">
                Grabación
              </span>
            )}
            {occ.has_slides && (
              <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500">
                Diapos
              </span>
            )}
          </div>
        )}

        <div
          className={`pt-1.5 border-t flex items-center gap-1 ${
            isDark ? 'border-white/10' : 'border-slate-200'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setResourceTargetOcc(occ)}
            title="Adjuntar enlace de grabación y diapositivas"
            className={`flex-1 py-1 px-1.5 rounded-lg text-[10px] font-bold text-center cursor-pointer ${
              occ.has_resources
                ? isDark
                  ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'bg-[#014ba0] hover:bg-[#013b80] text-white'
            }`}
          >
            {occ.has_resources ? 'Grab. ✓' : 'Grab./Diap.'}
          </button>
          <button
            type="button"
            onClick={() => setDetailOcc(occ)}
            className={`py-1 px-2 rounded-lg border text-[10px] font-bold text-center cursor-pointer ${
              isDark
                ? 'border-white/15 bg-white/5 hover:bg-white/10 text-blue-200'
                : 'border-slate-300 bg-white hover:bg-slate-100 text-[#014ba0]'
            }`}
          >
            Ver
          </button>
        </div>
      </div>
    );
  };

  const renderQuickEditPanel = (sch) => {
    if (editingScheduleId !== sch.id || !quickEditForm) return null;
    return (
      <form
        onSubmit={(e) => handleSaveQuickEdit(e, sch)}
        className={`mt-3 pt-3 border-t space-y-3 ${
          isDark ? 'border-white/10' : 'border-slate-200'
        }`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-bold mb-1 opacity-80">Título de la clase *</label>
            <input
              type="text"
              required
              value={quickEditForm.titulo}
              onChange={(e) => setQuickEditForm((p) => ({ ...p, titulo: e.target.value }))}
              className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-1 opacity-80">Expositor *</label>
            <input
              type="text"
              required
              value={quickEditForm.expositor}
              onChange={(e) => setQuickEditForm((p) => ({ ...p, expositor: e.target.value }))}
              className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-1 opacity-80">Estado</label>
            <select
              value={quickEditForm.status}
              onChange={(e) => setQuickEditForm((p) => ({ ...p, status: e.target.value }))}
              style={{ colorScheme: isDark ? 'dark' : 'light' }}
              className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
            >
              <option value="programada" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>Programada</option>
              <option value="en_vivo" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>En Vivo</option>
              <option value="reprogramada" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>Reprogramada</option>
              <option value="cancelada" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>Cancelada</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold mb-1 opacity-80">Tipo</label>
            <div
              className={`grid grid-cols-2 gap-1 p-1 rounded-xl border ${
                isDark ? 'bg-[#162235] border-white/10' : 'bg-slate-100 border-slate-200'
              }`}
            >
              <button
                type="button"
                onClick={() => setQuickEditForm((p) => ({ ...p, is_recurring: false }))}
                className={`py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                  !quickEditForm.is_recurring ? 'bg-[#014ba0] text-white' : 'opacity-70'
                }`}
              >
                Fecha única
              </button>
              <button
                type="button"
                onClick={() => setQuickEditForm((p) => ({ ...p, is_recurring: true }))}
                className={`py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                  quickEditForm.is_recurring ? 'bg-[#014ba0] text-white' : 'opacity-70'
                }`}
              >
                Semanal
              </button>
            </div>
          </div>

          {!quickEditForm.is_recurring ? (
            <div>
              <label className="block text-[11px] font-bold mb-1 opacity-80">Fecha *</label>
              <input
                type="date"
                required
                value={quickEditForm.fecha_especifica}
                onChange={(e) =>
                  setQuickEditForm((p) => ({ ...p, fecha_especifica: e.target.value }))
                }
                className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                style={{ colorScheme: isDark ? 'dark' : 'light' }}
              />
            </div>
          ) : (
            <div>
              <label className="block text-[11px] font-bold mb-1 opacity-80">Día semanal *</label>
              <select
                value={quickEditForm.day_of_week}
                onChange={(e) => setQuickEditForm((p) => ({ ...p, day_of_week: e.target.value }))}
                style={{ colorScheme: isDark ? 'dark' : 'light' }}
                className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
              >
                {DAYS_OF_WEEK_ES.map((d) => (
                  <option
                    key={d.value}
                    value={String(d.value)}
                    className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}
                  >
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold mb-1 opacity-80">Hora (Bolivia) *</label>
            <input
              type="time"
              required
              value={quickEditForm.hora_inicio}
              onChange={(e) => setQuickEditForm((p) => ({ ...p, hora_inicio: e.target.value }))}
              className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
              style={{ colorScheme: isDark ? 'dark' : 'light' }}
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-1 opacity-80">Duración (min)</label>
            <div className="flex items-center gap-1">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setQuickEditForm((p) => ({ ...p, duracion_minutos: preset }))}
                  className={`px-2 py-2 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                    String(quickEditForm.duracion_minutos) === preset
                      ? 'bg-[#014ba0] border-[#014ba0] text-white'
                      : isDark
                      ? 'border-white/15 hover:bg-white/10'
                      : 'border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {preset}
                </button>
              ))}
              <input
                type="number"
                min="15"
                max="600"
                value={quickEditForm.duracion_minutos}
                onChange={(e) =>
                  setQuickEditForm((p) => ({ ...p, duracion_minutos: e.target.value }))
                }
                className={`w-16 px-2 py-2 rounded-lg border text-xs outline-none ${inputClass}`}
              />
            </div>
          </div>
        </div>

        {quickEditForm.is_recurring && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold mb-1 opacity-80">
                Vigente desde (opcional)
              </label>
              <input
                type="date"
                value={quickEditForm.vigente_desde}
                onChange={(e) =>
                  setQuickEditForm((p) => ({ ...p, vigente_desde: e.target.value }))
                }
                className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                style={{ colorScheme: isDark ? 'dark' : 'light' }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-1 opacity-80">
                Vigente hasta (opcional)
              </label>
              <input
                type="date"
                value={quickEditForm.vigente_hasta}
                onChange={(e) =>
                  setQuickEditForm((p) => ({ ...p, vigente_hasta: e.target.value }))
                }
                className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                style={{ colorScheme: isDark ? 'dark' : 'light' }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold mb-1 opacity-80">Curso</label>
            <select
              value={quickEditForm.course_id}
              onChange={(e) => setQuickEditForm((p) => ({ ...p, course_id: e.target.value }))}
              style={{ colorScheme: isDark ? 'dark' : 'light' }}
              className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
            >
              <option value="" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>
                Clase General (todos)
              </option>
              {allCourses.map((c) => (
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
            <label className="block text-[11px] font-bold mb-1 opacity-80">Especialidad</label>
            <select
              value={quickEditForm.especialidad_id}
              onChange={(e) =>
                setQuickEditForm((p) => ({ ...p, especialidad_id: e.target.value }))
              }
              style={{ colorScheme: isDark ? 'dark' : 'light' }}
              className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
            >
              <option value="" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>
                Sin especialidad
              </option>
              {allCategories.map((cat) => (
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

          <div>
            <label className="block text-[11px] font-bold mb-1 opacity-80">Enlace Zoom / Meet *</label>
            <input
              type="url"
              required
              value={quickEditForm.enlace}
              onChange={(e) => setQuickEditForm((p) => ({ ...p, enlace: e.target.value }))}
              className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-1 opacity-80">
              ID / Código (opcional)
            </label>
            <input
              type="text"
              value={quickEditForm.id_reunion}
              onChange={(e) => setQuickEditForm((p) => ({ ...p, id_reunion: e.target.value }))}
              className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-bold mb-1 opacity-80">
            Descripción / Temario (opcional)
          </label>
          <textarea
            rows={2}
            value={quickEditForm.descripcion}
            onChange={(e) => setQuickEditForm((p) => ({ ...p, descripcion: e.target.value }))}
            className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Link
            href={`/admin/live-classes/editar/${sch.id}?returnTab=series`}
            className={`inline-flex items-center gap-1 text-[11px] font-bold underline ${
              isDark ? 'text-blue-300' : 'text-[#014ba0]'
            }`}
          >
            <span>Abrir editor completo</span>
            <ExternalLink className="w-3 h-3" />
          </Link>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditingScheduleId(null);
                setQuickEditForm(null);
              }}
              className={`px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-100'
              }`}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingQuickEdit}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {savingQuickEdit ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>{savingQuickEdit ? 'Guardando...' : 'Guardar cambios'}</span>
            </button>
          </div>
        </div>
      </form>
    );
  };

  const renderScheduleQuickRow = (s) => {
    const dayName = DAYS_OF_WEEK_ES.find((d) => d.value === Number(s.day_of_week))?.label || '';
    const isPast = isSchedulePast(s, todayStr, tickNow, true);
    const isSelected = selectedIds.includes(s.id);
    const isEditing = editingScheduleId === s.id;
    const startHHMM = formatTimeHHMM(s.hora_inicio);
    const endHHMM = formatEndTimeHHMM(s.hora_inicio, s.duracion_minutos);

    return (
      <div
        key={s.id}
        className={`rounded-2xl border p-3.5 transition-colors ${
          isEditing
            ? isDark
              ? 'bg-[#162235] border-[#24B0BA]/50 ring-1 ring-[#24B0BA]/40'
              : 'bg-blue-50/40 border-[#014ba0]/40 ring-1 ring-[#014ba0]/20'
            : isPast
            ? isDark
              ? 'bg-[#162235]/60 border-white/10 opacity-85'
              : 'bg-slate-50/90 border-slate-200 opacity-90'
            : isDark
            ? 'bg-[#162235] border-white/10'
            : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Izquierda: Checkbox + Fecha/Hora + Info */}
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => toggleSelectId(s.id)}
              aria-label={`Seleccionar ${s.titulo}`}
              className="mt-0.5 shrink-0 opacity-75 hover:opacity-100 cursor-pointer"
            >
              {isSelected ? (
                <CheckSquare className="w-4 h-4 text-[#014ba0]" style={isDark ? { color: '#24B0BA' } : undefined} />
              ) : (
                <Square className="w-4 h-4 opacity-50" />
              )}
            </button>

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-0.5 rounded-md tabular-nums ${
                    s.is_recurring
                      ? isDark
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-blue-50 text-blue-700'
                      : isDark
                      ? 'bg-[#24B0BA]/20 text-[#24B0BA]'
                      : 'bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {s.is_recurring ? (
                    <>
                      <Repeat className="w-3 h-3" />
                      <span>Todos los {dayName}</span>
                    </>
                  ) : (
                    <>
                      <Calendar className="w-3 h-3" />
                      <span>{formatShortDateBadge(s.fecha_especifica, todayStr)}</span>
                    </>
                  )}
                </span>

                <span className="inline-flex items-center gap-1 text-xs font-bold tabular-nums opacity-85">
                  <Clock className="w-3 h-3" />
                  <span>
                    {startHHMM} – {endHHMM}
                  </span>
                </span>

                {isPast && (
                  <span
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                      isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {s.is_recurring ? 'Serie vencida' : 'Pasada'}
                  </span>
                )}
                {s.status === 'cancelada' && (
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-red-500/15 text-red-500">
                    Cancelada
                  </span>
                )}
                {s.status === 'reprogramada' && (
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">
                    Reprogramada
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h4 className="font-bold text-sm leading-snug">{s.titulo}</h4>
                <span className={`text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  · {s.expositor}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-600">
                  {s.course_title || 'Clase General'}
                </span>
                {s.especialidad_nombre && (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-200/70 text-slate-700'
                    }`}
                  >
                    {s.especialidad_nombre}
                  </span>
                )}
                {s.is_recurring && s.vigente_hasta && (
                  <span className="text-[10px] opacity-70">
                    Hasta {String(s.vigente_hasta).slice(0, 10)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Derecha: Acciones rápidas */}
          <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0 pl-6 lg:pl-0">
            <button
              type="button"
              onClick={() => handleCopyLink(s.id, s.enlace)}
              title="Copiar enlace"
              className={`p-2 rounded-lg text-xs font-bold cursor-pointer ${
                isDark ? 'bg-white/10 hover:bg-white/15' : 'bg-slate-100 hover:bg-slate-200'
              }`}
            >
              {copiedId === s.id ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
            <a
              href={s.enlace}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir enlace"
              className={`p-2 rounded-lg text-xs font-bold ${
                isDark
                  ? 'bg-white/10 text-blue-300 hover:bg-white/15'
                  : 'bg-slate-100 text-blue-600 hover:bg-slate-200'
              }`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button
              type="button"
              onClick={() => toggleQuickEdit(s)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                isEditing
                  ? 'bg-[#014ba0] text-white'
                  : 'bg-blue-500/15 text-blue-500 hover:bg-blue-500/25'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{isEditing ? 'Cerrar' : 'Editar rápido'}</span>
            </button>
            <Link
              href={`/admin/live-classes/nueva?duplicate=${s.id}`}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold ${
                isDark
                  ? 'bg-white/10 text-slate-200 hover:bg-white/15'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Duplicar
            </Link>
            <button
              type="button"
              onClick={() => handleDeleteSchedule(s.id, s.titulo)}
              title="Eliminar programación"
              className="p-2 rounded-lg text-xs font-bold bg-red-500/15 text-red-500 hover:bg-red-500/25 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {renderQuickEditPanel(s)}
      </div>
    );
  };

  return (
    <div
      className={`min-h-[calc(100vh-4rem)] p-3 sm:p-6 transition-colors ${
        isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
      }`}
    >
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Cabecera */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h1
              className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2.5 text-[#014ba0]"
              style={isDark ? { color: '#24B0BA' } : undefined}
            >
              <Calendar className="w-7 h-7" />
              <span>Gestión de Clases en Vivo</span>
            </h1>
            <p className={`text-xs sm:text-sm mt-0.5 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              Organiza tus semanas, edita rápido en línea o limpia clases pasadas de la base de datos.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCleanupModalOpen(true)}
              className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border font-bold text-xs sm:text-sm transition-colors cursor-pointer ${
                pastSummary.totalIncludingToday > 0
                  ? isDark
                    ? 'bg-red-950/35 border-red-500/40 text-red-300 hover:bg-red-950/55'
                    : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                  : isDark
                  ? 'border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              <span>Limpiar clases pasadas ({pastSummary.totalIncludingToday})</span>
            </button>

            <Link
              href="/admin/live-classes/nueva"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Programar Clase / Serie</span>
            </Link>
          </div>
        </header>

        {/* KPIs rápidos */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className={`p-3.5 sm:p-4 rounded-2xl border ${surfaceClass}`}>
            <p className="text-[11px] font-bold uppercase tracking-wider opacity-65">Esta semana</p>
            <p className="text-2xl sm:text-3xl font-black mt-1 tabular-nums">{stats.weekTotal}</p>
          </div>
          <div className={`p-3.5 sm:p-4 rounded-2xl border ${surfaceClass}`}>
            <p className="text-[11px] font-bold uppercase tracking-wider opacity-65">En vivo ahora</p>
            <p className="text-2xl sm:text-3xl font-black mt-1 text-emerald-500 tabular-nums">
              {stats.liveNow}
            </p>
          </div>
          <div className={`p-3.5 sm:p-4 rounded-2xl border ${surfaceClass}`}>
            <p className="text-[11px] font-bold uppercase tracking-wider opacity-65">
              Total registradas
            </p>
            <p className="text-2xl sm:text-3xl font-black mt-1 text-blue-500 tabular-nums">
              {schedules.length}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveTab('series');
              setListScope(pastSummary.totalIncludingToday > 0 ? 'past' : 'all');
            }}
            className={`p-3.5 sm:p-4 rounded-2xl border text-left cursor-pointer transition-colors ${surfaceClass} ${
              pastSummary.totalIncludingToday > 0
                ? isDark
                  ? 'hover:border-amber-400/50'
                  : 'hover:border-amber-400'
                : ''
            }`}
          >
            <p className="text-[11px] font-bold uppercase tracking-wider opacity-65">
              Pasadas en BD
            </p>
            <p className="text-2xl sm:text-3xl font-black mt-1 text-amber-500 tabular-nums">
              {pastSummary.totalIncludingToday}
            </p>
          </button>
        </div>

        {/* Barra de Filtros, Pestañas y Navegación Semanal */}
        <div className={`p-3.5 sm:p-4 rounded-2xl border space-y-3 ${surfaceClass}`}>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Tabs */}
            <div
              className={`inline-flex flex-wrap rounded-xl p-1 border self-start ${
                isDark ? 'bg-[#162235] border-white/10' : 'bg-slate-100 border-slate-200'
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveTab('agenda')}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  activeTab === 'agenda'
                    ? 'bg-[#014ba0] text-white shadow-xs'
                    : isDark
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-700 hover:text-[#014ba0]'
                }`}
              >
                Agenda Semanal ({filteredOccurrences.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('past')}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  activeTab === 'past'
                    ? 'bg-[#014ba0] text-white shadow-xs'
                    : isDark
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-700 hover:text-[#014ba0]'
                }`}
              >
                Clases Pasadas ({pastCounts.total})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('series')}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  activeTab === 'series'
                    ? 'bg-[#014ba0] text-white shadow-xs'
                    : isDark
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-700 hover:text-[#014ba0]'
                }`}
              >
                Todas las Semanas · Edición Rápida ({filteredSchedules.length})
              </button>
            </div>

            {/* Navegación de semana + Layout desktop */}
            {activeTab === 'agenda' && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setWeekStart((w) => addDaysToDateStr(w, -7))}
                    className={`p-2 rounded-xl border cursor-pointer ${
                      isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeekStart(currentWeekMonday)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold cursor-pointer"
                  >
                    <span>
                      {weekStart === currentWeekMonday ? 'Esta Semana' : 'Hoy'} ({weekDays[0]?.displayDate} –{' '}
                      {weekDays[6]?.displayDate})
                    </span>
                    {isRefreshing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeekStart((w) => addDaysToDateStr(w, 7))}
                    className={`p-2 rounded-xl border cursor-pointer ${
                      isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div
                  className={`inline-flex rounded-xl p-0.5 border ${
                    isDark ? 'bg-[#162235] border-white/10' : 'bg-slate-100 border-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setDesktopLayout('list')}
                    title="Vista Agenda"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      desktopLayout === 'list' ? 'bg-[#014ba0] text-white' : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    <LayoutList className="w-3.5 h-3.5" />
                    <span>Agenda</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDesktopLayout('grid')}
                    title="Cuadrícula semanal"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      desktopLayout === 'grid' ? 'bg-[#014ba0] text-white' : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    <CalendarDays className="w-3.5 h-3.5" />
                    <span>Cuadrícula</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Buscador + Curso */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar clase, ponente o curso..."
                className={`w-full pl-9 pr-8 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-60 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              style={{ colorScheme: isDark ? 'dark' : 'light' }}
              className={`w-full px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none cursor-pointer ${inputClass}`}
            >
              <option value="" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>
                Todos los cursos
              </option>
              {uniqueCourseOptions.map((c) => (
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
        </div>

        {/* Contenido Principal */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-7 h-7 animate-spin text-blue-500 mr-2" />
            <span className="text-sm font-semibold">Cargando programación...</span>
          </div>
        ) : activeTab === 'agenda' ? (
          desktopLayout === 'grid' ? (
            <div>
              {/* Móvil (< md): selector interactivo de 7 días + tarjetas full width */}
              <div className="md:hidden space-y-3">
                <div className="grid grid-cols-7 gap-1">
                  {weekDays.map((day) => {
                    const isSelected = day.date === selectedMobileDay;
                    const isToday = day.date === todayStr;
                    const count = filteredOccurrences.filter(
                      (o) => o.occurrence_date === day.date
                    ).length;
                    return (
                      <button
                        key={day.date}
                        type="button"
                        onClick={() => setSelectedMobileDay(day.date)}
                        className={`py-2 px-1 rounded-xl border text-center cursor-pointer flex flex-col items-center gap-0.5 transition-colors ${
                          isSelected
                            ? 'bg-[#014ba0] text-white border-[#014ba0]'
                            : isToday
                            ? isDark
                              ? 'bg-[#1e293b] border-[#24B0BA] text-[#24B0BA]'
                              : 'bg-blue-50 border-[#014ba0]/40 text-[#014ba0]'
                            : surfaceClass
                        }`}
                      >
                        <span className="text-[10px] font-bold uppercase">{day.shortLabel}</span>
                        <span className="text-xs font-extrabold">{day.displayDate.split('/')[0]}</span>
                        <span
                          className={`text-[9px] font-black px-1.5 rounded-full min-w-[16px] ${
                            count > 0
                              ? isSelected
                                ? 'bg-white text-[#014ba0]'
                                : 'bg-blue-500/20 text-blue-500'
                              : 'opacity-25'
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {(() => {
                  const dayOccs = filteredOccurrences.filter(
                    (o) => o.occurrence_date === selectedMobileDay
                  );
                  if (dayOccs.length === 0) {
                    const nextActiveDay = daysWithOccurrences[0];
                    return (
                      <div className={`p-6 rounded-2xl border text-center space-y-3 ${surfaceClass}`}>
                        <p className="text-sm font-semibold opacity-75">
                          No hay clases programadas para este día.
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => openQuickCreateForDate(selectedMobileDay)}
                            className="inline-flex items-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                          >
                            <Plus className="w-4 h-4" />
                            <span>Programar clase este día</span>
                          </button>
                          {nextActiveDay && (
                            <button
                              type="button"
                              onClick={() => setSelectedMobileDay(nextActiveDay.day.date)}
                              className="inline-flex items-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl bg-[#014ba0] text-white text-xs font-bold cursor-pointer"
                            >
                              <span>
                                Ir al {nextActiveDay.day.label} {nextActiveDay.day.displayDate} (
                                {nextActiveDay.items.length})
                              </span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-3">
                      {dayOccs.map((occ) => renderAdminAgendaRowCard(occ))}
                      <button
                        type="button"
                        onClick={() => openQuickCreateForDate(selectedMobileDay)}
                        className={`w-full min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-dashed text-xs font-bold cursor-pointer transition-colors ${
                          isDark
                            ? 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10'
                            : 'border-emerald-600/40 text-emerald-700 hover:bg-emerald-50'
                        }`}
                      >
                        <Plus className="w-4 h-4" />
                        <span>Agregar otra clase este día</span>
                      </button>
                    </div>
                  );
                })()}
              </div>

              {/* Tablet (4 cols) & Escritorio (7 cols): cuadrícula interactiva — clic en día vacío o botón '+' para registrar al instante */}
              <div className="hidden md:grid md:grid-cols-4 lg:grid-cols-7 gap-2.5">
                {weekDays.map((day) => {
                  const isToday = day.date === todayStr;
                  const dayOccs = filteredOccurrences.filter((o) => o.occurrence_date === day.date);
                  return (
                    <div
                      key={day.date}
                      className={`min-w-0 rounded-2xl border p-2.5 flex flex-col gap-2 min-h-[168px] ${surfaceClass} ${
                        isToday ? 'ring-2 ring-blue-500' : ''
                      }`}
                    >
                      <div
                        className={`flex items-center justify-between gap-1 border-b pb-1.5 ${
                          isDark ? 'border-white/10' : 'border-slate-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <p
                            className={`text-[11px] font-extrabold uppercase ${
                              isToday ? 'text-blue-500' : 'opacity-70'
                            }`}
                          >
                            {day.shortLabel}
                          </p>
                          <p className="text-sm font-black tabular-nums">{day.displayDate}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isToday ? (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-600 text-white">
                              HOY
                            </span>
                          ) : dayOccs.length > 0 ? (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${
                                isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {dayOccs.length}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => openQuickCreateForDate(day.date)}
                            title={`Programar clase el ${day.label} ${day.displayDate}`}
                            aria-label={`Programar clase el ${day.label} ${day.displayDate}`}
                            className={`p-1 rounded-lg cursor-pointer transition-colors ${
                              isDark
                                ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/30'
                                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {dayOccs.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => openQuickCreateForDate(day.date)}
                          className={`flex-1 w-full rounded-xl border border-dashed flex flex-col items-center justify-center gap-1.5 py-4 px-2 text-center cursor-pointer transition-colors group ${
                            isDark
                              ? 'border-white/15 hover:border-emerald-400/60 hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-300'
                              : 'border-slate-300 hover:border-emerald-500 hover:bg-emerald-50/70 text-slate-500 hover:text-emerald-700'
                          }`}
                        >
                          <Plus className="w-5 h-5 opacity-70 group-hover:opacity-100 transition-opacity" />
                          <span className="text-[11px] font-bold">Programar clase</span>
                        </button>
                      ) : (
                        <div className="space-y-2">
                          {dayOccs.map((occ) => renderAdminCompactGridCard(occ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Barra inferior para pasar fácilmente a la semana siguiente tras completar los registros */}
              {(() => {
                const nextWeekStart = addDaysToDateStr(weekStart, 7);
                const nextWeekDays = getWeekDays(nextWeekStart);
                return (
                  <div
                    className={`mt-3 p-3 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs ${surfaceClass}`}
                  >
                    <button
                      type="button"
                      onClick={() => setWeekStart((w) => addDaysToDateStr(w, -7))}
                      className={`w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3.5 py-2 rounded-xl border font-bold cursor-pointer transition-colors ${
                        isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Semana anterior</span>
                    </button>

                    <div className="flex flex-wrap items-center justify-center gap-2 text-center">
                      <span className="font-semibold opacity-80 tabular-nums">
                        Semana visible: {weekDays[0]?.displayDate} – {weekDays[6]?.displayDate}
                      </span>
                      {weekStart !== currentWeekMonday && (
                        <button
                          type="button"
                          onClick={() => setWeekStart(currentWeekMonday)}
                          className={`underline font-bold cursor-pointer ${
                            isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                          }`}
                        >
                          Volver a esta semana
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setWeekStart(nextWeekStart)}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[38px] px-4 py-2 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white font-bold cursor-pointer transition-colors tabular-nums"
                    >
                      <span>
                        Siguiente semana ({nextWeekDays[0]?.displayDate} – {nextWeekDays[6]?.displayDate})
                      </span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                );
              })()}
            </div>
          ) : daysWithOccurrences.length === 0 ? (
            <div className={`p-10 rounded-2xl border text-center space-y-3 ${surfaceClass}`}>
              <p className="text-base font-bold">No hay clases programadas en esta semana.</p>
              <Link
                href="/admin/live-classes/nueva"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                <Plus className="w-4 h-4" />
                <span>Programar clase ahora</span>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {daysWithOccurrences.map(({ day, items }) => {
                const isToday = day.date === todayStr;
                return (
                  <div
                    key={day.date}
                    className={`rounded-2xl border p-4 space-y-3 ${surfaceClass} ${
                      isToday ? 'ring-2 ring-blue-500' : ''
                    }`}
                  >
                    <div
                      className={`flex items-center justify-between pb-2.5 border-b ${
                        isDark ? 'border-white/10' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`font-extrabold text-sm sm:text-base ${isToday ? 'text-blue-500' : ''}`}>
                          {day.label} {day.displayDate}
                        </span>
                        {isToday && (
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-blue-600 text-white">
                            HOY
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-bold opacity-65">
                        {items.length} {items.length === 1 ? 'sesión' : 'sesiones'}
                      </span>
                    </div>

                    <div className="space-y-3 w-full">
                      {items.map((occ) => renderAdminAgendaRowCard(occ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : activeTab === 'past' ? (
          <div className="space-y-4">
            <div
              className={`p-3 sm:p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${surfaceClass}`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { key: 'all', label: `Todas (${pastCounts.total})` },
                  { key: 'with_resources', label: `Con grabación / diapos (${pastCounts.withResources})` },
                  { key: 'missing_resources', label: `Sin grabación (${pastCounts.missingResources})` },
                ].map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setPastFilterMode(chip.key)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                      pastFilterMode === chip.key
                        ? 'bg-[#014ba0] text-white'
                        : isDark
                        ? 'bg-[#162235] text-slate-300 hover:bg-white/10 border border-white/10'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <p className="text-xs opacity-70">
                Adjunta aquí el link de grabación y diapositivas; se reflejarán automáticamente en el calendario del estudiante y en Clases pasadas.
              </p>
            </div>

            {filteredPastArchive.length === 0 ? (
              <div className={`p-10 rounded-2xl border text-center space-y-2 ${surfaceClass}`}>
                <p className="text-base font-bold">No hay clases pasadas en esta categoría.</p>
                <p className="text-xs opacity-70">
                  Cuando termine una sesión en vivo o finalice su día, aparecerá aquí para subirle grabación y diapositivas.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {paginatedPastArchive.map((occ) => renderAdminAgendaRowCard(occ, true))}

                {filteredPastArchive.length > 0 && (
                  <div
                    className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs ${surfaceClass}`}
                  >
                    <div className="flex items-center gap-2 font-semibold tabular-nums">
                      <span>
                        Mostrando {(safePastPage - 1) * pastPageSize + 1}–
                        {(safePastPage - 1) * pastPageSize + paginatedPastArchive.length} de{' '}
                        {filteredPastArchive.length}
                      </span>
                      <select
                        value={pastPageSize}
                        onChange={(e) => setPastPageSize(Number(e.target.value))}
                        style={{ colorScheme: isDark ? 'dark' : 'light' }}
                        className={`px-2 py-1 rounded-lg border text-xs font-bold outline-none cursor-pointer ${inputClass}`}
                      >
                        <option value={10} className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>10 / pág.</option>
                        <option value={25} className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>25 / pág.</option>
                        <option value={50} className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>50 / pág.</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={safePastPage <= 1}
                        onClick={() => setPastPage((p) => Math.max(1, p - 1))}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border font-bold cursor-pointer disabled:opacity-40 ${
                          isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>Anterior</span>
                      </button>
                      <span className="font-bold tabular-nums">
                        Pág. {safePastPage} / {pastTotalPages}
                      </span>
                      <button
                        type="button"
                        disabled={safePastPage >= pastTotalPages}
                        onClick={() => setPastPage((p) => Math.min(pastTotalPages, p + 1))}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border font-bold cursor-pointer disabled:opacity-40 ${
                          isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        <span>Siguiente</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Barra de Filtros rápidos + Selección masiva */}
            <div
              className={`p-3 sm:p-3.5 rounded-2xl border flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${surfaceClass}`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { key: 'all', label: `Todas (${listScopeCounts.all})` },
                  { key: 'upcoming', label: `Vigentes y Próximas (${listScopeCounts.upcoming})` },
                  { key: 'past', label: `Pasadas (${listScopeCounts.past})` },
                  { key: 'recurring', label: `Series Fijas (${listScopeCounts.recurring})` },
                ].map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setListScope(chip.key)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                      listScope === chip.key
                        ? 'bg-[#014ba0] text-white'
                        : isDark
                        ? 'bg-[#162235] text-slate-300 hover:bg-white/10 border border-white/10'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {groupedWeekEditor.scopedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const allVisibleSelected = groupedWeekEditor.scopedIds.every((id) =>
                        selectedIds.includes(id)
                      );
                      if (allVisibleSelected) {
                        setSelectedIds((prev) =>
                          prev.filter((id) => !groupedWeekEditor.scopedIds.includes(id))
                        );
                      } else {
                        setSelectedIds((prev) =>
                          Array.from(new Set([...prev, ...groupedWeekEditor.scopedIds]))
                        );
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer ${
                      isDark
                        ? 'border-white/15 hover:bg-white/10 text-slate-200'
                        : 'border-slate-300 hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>
                      {groupedWeekEditor.scopedIds.every((id) => selectedIds.includes(id))
                        ? 'Deseleccionar visibles'
                        : 'Seleccionar visibles'}
                    </span>
                  </button>
                )}

                {selectedIds.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedIds([])}
                      className="text-xs font-bold underline opacity-75 hover:opacity-100 cursor-pointer"
                    >
                      Limpiar ({selectedIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleBulkDeleteIds(
                          selectedIds,
                          `¿Eliminar ${selectedIds.length} clases seleccionadas?`
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer shadow-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Eliminar seleccionadas ({selectedIds.length})</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {groupedWeekEditor.totalScoped === 0 ? (
              <div className={`p-10 rounded-2xl border text-center space-y-3 ${surfaceClass}`}>
                <p className="text-sm font-semibold opacity-75">
                  No hay clases en este filtro. Prueba cambiando la pestaña de estado o el buscador.
                </p>
                <div className="flex items-center justify-center gap-2">
                  {listScope !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setListScope('all')}
                      className="px-4 py-2 rounded-xl bg-[#014ba0] text-white text-xs font-bold cursor-pointer"
                    >
                      Ver todas
                    </button>
                  )}
                  {(searchTerm || courseFilter) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTerm('');
                        setCourseFilter('');
                      }}
                      className={`px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                        isDark ? 'border-white/15' : 'border-slate-300'
                      }`}
                    >
                      Limpiar búsqueda
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {(() => {
                  const renderWeekGroupSection = (group) => {
                    const badgeClass = group.isCurrent
                      ? 'bg-[#014ba0] text-white'
                      : group.isNext
                      ? isDark
                        ? 'bg-[#24B0BA]/20 text-[#24B0BA]'
                        : 'bg-emerald-100 text-emerald-800'
                      : group.isPastWeek
                      ? isDark
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-amber-100 text-amber-800'
                      : isDark
                      ? 'bg-white/10 text-slate-300'
                      : 'bg-slate-200 text-slate-700';

                    return (
                      <section
                        key={group.weekStart}
                        className={`rounded-2xl border p-4 space-y-3 ${surfaceClass} ${
                          group.isCurrent ? 'ring-2 ring-blue-500/70' : ''
                        }`}
                      >
                        <div
                          className={`flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b ${
                            isDark ? 'border-white/10' : 'border-slate-200'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${badgeClass}`}
                            >
                              {group.badge}
                            </span>
                            <h3 className="text-sm sm:text-base font-black tabular-nums">
                              Semana {group.rangeLabel}
                            </h3>
                            <span className="text-xs font-bold opacity-70">
                              · {group.items.length} {group.items.length === 1 ? 'clase' : 'clases'}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {group.isPastWeek ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleBulkDeleteIds(
                                    group.items.map((item) => item.id),
                                    `¿Eliminar todas las clases de la semana ${group.rangeLabel}?`
                                  )
                                }
                                className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-red-500/15 text-red-500 hover:bg-red-500/25 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Eliminar semana ({group.items.length})</span>
                              </button>
                            ) : (
                              <>
                                {group.pastIds.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleBulkDeleteIds(
                                        group.pastIds,
                                        `¿Eliminar ${group.pastIds.length} clases pasadas de esta semana?`
                                      )
                                    }
                                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-red-500/15 text-red-500 hover:bg-red-500/25 cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>Borrar pasadas ({group.pastIds.length})</span>
                                  </button>
                                )}
                                {group.weekStart !== 'sin-fecha' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setWeekStart(group.weekStart);
                                      setActiveTab('agenda');
                                    }}
                                    className={`inline-flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-lg border cursor-pointer ${
                                      isDark
                                        ? 'border-white/15 hover:bg-white/10 text-blue-300'
                                        : 'border-slate-300 hover:bg-slate-100 text-[#014ba0]'
                                    }`}
                                  >
                                    <span>Ver en Agenda</span>
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2.5">
                          {group.items.map((s) => renderScheduleQuickRow(s))}
                        </div>
                      </section>
                    );
                  };

                  return (
                    <>
                      {groupedWeekEditor.upcomingWeeks.map(renderWeekGroupSection)}

                      {groupedWeekEditor.recurringList.length > 0 && (
                        <section className={`rounded-2xl border p-4 space-y-3 ${surfaceClass}`}>
                          <div
                            className={`flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b ${
                              isDark ? 'border-white/10' : 'border-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-500">
                                <Repeat className="w-3 h-3" />
                                <span>Recurrentes</span>
                              </span>
                              <h3 className="text-sm sm:text-base font-black">
                                Series Semanales Fijas ({groupedWeekEditor.recurringList.length})
                              </h3>
                            </div>
                          </div>

                          <div className="space-y-2.5">
                            {groupedWeekEditor.recurringList.map((s) => renderScheduleQuickRow(s))}
                          </div>
                        </section>
                      )}

                      {groupedWeekEditor.pastWeeks.map(renderWeekGroupSection)}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal nativo estilizado para Reprogramar fecha */}
      {rescheduleTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reschedule-title"
          onClick={() => setRescheduleTarget(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border shadow-2xl p-5 sm:p-6 ${surfaceClass}`}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 id="reschedule-title" className="text-lg font-extrabold">
                  Reprogramar sesión
                </h2>
                <p className="text-xs opacity-75 mt-0.5">
                  {rescheduleTarget.titulo} ({rescheduleTarget.original_date})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRescheduleTarget(null)}
                className="p-1.5 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveReschedule} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Nueva fecha</label>
                  <input
                    type="date"
                    required
                    value={rescheduleForm.new_date}
                    onChange={(e) =>
                      setRescheduleForm((p) => ({ ...p, new_date: e.target.value }))
                    }
                    className={`w-full p-2.5 rounded-xl border text-xs sm:text-sm ${inputClass}`}
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Hora (Bolivia)</label>
                  <input
                    type="time"
                    required
                    value={rescheduleForm.new_hora_inicio}
                    onChange={(e) =>
                      setRescheduleForm((p) => ({ ...p, new_hora_inicio: e.target.value }))
                    }
                    className={`w-full p-2.5 rounded-xl border text-xs sm:text-sm ${inputClass}`}
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Enlace Meet / Zoom</label>
                <input
                  type="url"
                  required
                  value={rescheduleForm.new_enlace}
                  onChange={(e) =>
                    setRescheduleForm((p) => ({ ...p, new_enlace: e.target.value }))
                  }
                  className={`w-full p-2.5 rounded-xl border text-xs sm:text-sm ${inputClass}`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Motivo / Nota (opcional)</label>
                <input
                  type="text"
                  value={rescheduleForm.motivo}
                  onChange={(e) =>
                    setRescheduleForm((p) => ({ ...p, motivo: e.target.value }))
                  }
                  placeholder="Ej: Cambio de horario excepcional"
                  className={`w-full p-2.5 rounded-xl border text-xs sm:text-sm ${inputClass}`}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRescheduleTarget(null)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold border cursor-pointer ${
                    isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingReschedule}
                  className="px-5 py-2.5 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {savingReschedule ? 'Guardando...' : 'Guardar Cambio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Limpieza de Clases Pasadas en BD */}
      {cleanupModalOpen && (() => {
        const baseCleanable = cleanupIncludeToday
          ? pastSummary.totalIncludingToday
          : pastSummary.totalBeforeToday;
        const recordedCleanable = cleanupIncludeRecorded
          ? cleanupIncludeToday
            ? pastSummary.protectedCount
            : pastSummary.protectedBeforeToday
          : 0;
        const cleanupCount = baseCleanable + recordedCleanable;

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cleanup-modal-title"
            onClick={() => !cleaningPast && setCleanupModalOpen(false)}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border shadow-2xl p-5 sm:p-6 space-y-4 ${surfaceClass}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="p-2 rounded-xl bg-red-500/15 text-red-500 shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 id="cleanup-modal-title" className="text-lg font-extrabold">
                      Limpiar clases pasadas de la BD
                    </h2>
                    <p className="text-xs opacity-75 mt-0.5">
                      Libera espacio eliminando sesiones ya dictadas y registros históricos.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={cleaningPast}
                  onClick={() => setCleanupModalOpen(false)}
                  className="p-1.5 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div
                className={`rounded-2xl border p-3.5 space-y-2 text-xs sm:text-sm ${
                  isDark ? 'bg-[#162235] border-white/10' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>Clases únicas anteriores a hoy</span>
                  <strong className="tabular-nums">{pastSummary.uniqueBeforeToday}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Series semanales con vigencia vencida</span>
                  <strong className="tabular-nums">{pastSummary.expiredSeries}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Excepciones pasadas acumuladas</span>
                  <strong className="tabular-nums">{pastSummary.pastExceptions}</strong>
                </div>
                {pastSummary.protectedCount > 0 && (
                  <div className="flex items-center justify-between text-emerald-500">
                    <span>Con grabación / diapos</span>
                    <strong className="tabular-nums">{pastSummary.protectedCount}</strong>
                  </div>
                )}

                <label
                  className={`flex items-center justify-between gap-2 pt-2 border-t cursor-pointer ${
                    isDark ? 'border-white/10' : 'border-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cleanupIncludeToday}
                      onChange={(e) => setCleanupIncludeToday(e.target.checked)}
                      className="rounded accent-[#014ba0]"
                    />
                    <span>Incluir clases de hoy ya finalizadas</span>
                  </span>
                  <strong className="tabular-nums">{pastSummary.uniqueTodayFinished}</strong>
                </label>

                {pastSummary.protectedCount > 0 && (
                  <label
                    className={`flex items-center justify-between gap-2 pt-2 border-t cursor-pointer text-amber-500 ${
                      isDark ? 'border-white/10' : 'border-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={cleanupIncludeRecorded}
                        onChange={(e) => setCleanupIncludeRecorded(e.target.checked)}
                        className="rounded accent-red-600"
                      />
                      <span>
                        Incluir también clases con grabación/diapos (borrará sus archivos subidos en Storage y BD)
                      </span>
                    </span>
                    <strong className="tabular-nums shrink-0">{pastSummary.protectedCount}</strong>
                  </label>
                )}
              </div>

              <p
                className={`text-xs rounded-xl px-3 py-2 border ${
                  cleanupIncludeRecorded
                    ? isDark
                      ? 'bg-red-950/30 border-red-500/30 text-red-300'
                      : 'bg-red-50 border-red-200 text-red-800'
                    : isDark
                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                {cleanupIncludeRecorded
                  ? 'Atención: al eliminar estas clases también se borrarán permanentemente los archivos de diapositivas subidos en Supabase Storage y sus registros en BD.'
                  : 'Tus series semanales activas, clases futuras y clases con grabación o diapositivas adjuntas permanecen intactas.'}
              </p>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={cleaningPast}
                  onClick={() => setCleanupModalOpen(false)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold border cursor-pointer ${
                    isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={cleaningPast || cleanupCount === 0}
                  onClick={handleConfirmCleanupPast}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer disabled:opacity-45"
                >
                  {cleaningPast && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {cleaningPast
                      ? 'Limpiando BD...'
                      : cleanupCount === 0
                      ? 'Nada para limpiar'
                      : `Eliminar de la BD (${cleanupCount})`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal / Bottom Sheet con detalles y acciones al tocar una tarjeta en Cuadrícula */}
      {detailOcc && (() => {
        const occ = detailOcc;
        const liveStatus = computeOccurrenceLiveStatus(occ, tickNow);
        const isLiveNow = liveStatus === 'en_vivo';
        const isCancelled = occ.status === 'cancelada';
        const isRescheduled = occ.status === 'reprogramada';
        const endTime = formatEndTimeHHMM(occ.hora_inicio, occ.duracion_minutos);

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-occ-detail-title"
            onClick={() => setDetailOcc(null)}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border shadow-2xl p-5 sm:p-6 space-y-4 ${surfaceClass}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-xs font-extrabold text-blue-500 tabular-nums">
                      <Clock className="w-3.5 h-3.5" />
                      <span>
                        {occ.occurrence_date} · {occ.hora_inicio} – {endTime}
                      </span>
                    </span>
                    {isLiveNow && (
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                        EN VIVO
                      </span>
                    )}
                    {isCancelled && (
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-red-500/20 text-red-500">
                        CANCELADA
                      </span>
                    )}
                    {isRescheduled && !isCancelled && (
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600">
                        REPROGRAMADA
                      </span>
                    )}
                  </div>
                  <h2 id="admin-occ-detail-title" className="text-lg font-black leading-snug">
                    {occ.titulo}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailOcc(null)}
                  className="p-1.5 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-amber-500/15 text-amber-600">
                  {occ.course_title || 'Clase General'}
                </span>
                {occ.especialidad_nombre && (
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-md ${
                      isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {occ.especialidad_nombre}
                  </span>
                )}
              </div>

              <div className="space-y-1 text-xs sm:text-sm">
                <p className="inline-flex items-center gap-1.5 font-semibold">
                  <User className="w-4 h-4 opacity-70" />
                  <span>{occ.expositor}</span>
                </p>
                {occ.descripcion && (
                  <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                    {occ.descripcion}
                  </p>
                )}
                {occ.motivo && (isCancelled || isRescheduled) && (
                  <p className="text-xs italic text-amber-500">Nota: {occ.motivo}</p>
                )}
              </div>

              <div
                className={`pt-3 border-t space-y-3 ${
                  isDark ? 'border-white/10' : 'border-slate-200'
                }`}
              >
                <a
                  href={occ.enlace}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold"
                >
                  <Video className="w-4 h-4" />
                  <span>Abrir enlace de la clase</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                {occ.has_resources && (
                  <div
                    className={`rounded-xl border p-2.5 text-xs space-y-1 ${
                      isDark
                        ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-200'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    }`}
                  >
                    {occ.has_recording && (
                      <p className="truncate font-semibold">
                        Grabación adjunta: {occ.recording_url}
                      </p>
                    )}
                    {occ.has_slides && (
                      <p className="truncate font-semibold">
                        Diapositivas:{' '}
                        {occ.slides_material?.file_name || occ.slides_title || occ.slides_url}
                      </p>
                    )}
                  </div>
                )}

                {renderAdminActionButtons(occ, true)}
              </div>
            </div>
          </div>
        );
      })()}

      <LiveClassResourceModal
        isOpen={Boolean(resourceTargetOcc)}
        occurrence={resourceTargetOcc}
        onClose={() => setResourceTargetOcc(null)}
        onSaved={() => loadWeek(weekStart)}
        getAuthHeaders={getAuthHeaders}
        isDark={isDark}
      />

      {/* Modal de Edición Directa de Clase (Past / Agenda / Cuadrícula) */}
      {editOccTarget && editOccForm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-occ-modal-title"
          onClick={() => !savingEditOcc && setEditOccTarget(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <form
            onSubmit={handleSaveEditOcc}
            onClick={(e) => e.stopPropagation()}
            style={{ colorScheme: isDark ? 'dark' : 'light' }}
            className={`w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border shadow-2xl p-5 sm:p-6 space-y-4 ${surfaceClass}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="edit-occ-modal-title" className="text-lg font-black flex items-center gap-2">
                  <Edit3 className="w-5 h-5 text-blue-500" />
                  <span>
                    {editOccTarget.is_recurring ? 'Editar Sesión Puntual' : 'Editar Clase'}
                  </span>
                </h2>
                <p className="text-xs opacity-75 mt-0.5 tabular-nums">
                  {editOccTarget.is_recurring
                    ? `Sesión del ${editOccTarget.original_date} (serie semanal: ${editOccTarget.titulo})`
                    : `${formatShortDateBadge(editOccTarget.occurrence_date, todayStr)} · ${editOccTarget.occurrence_date}`}
                </p>
              </div>
              <button
                type="button"
                disabled={savingEditOcc}
                onClick={() => setEditOccTarget(null)}
                className="p-1.5 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editOccTarget.is_recurring ? (
              <div className="space-y-3">
                <div
                  className={`p-3 rounded-xl border text-xs leading-relaxed ${
                    isDark
                      ? 'bg-blue-950/30 border-blue-500/30 text-blue-200'
                      : 'bg-blue-50 border-blue-200 text-blue-900'
                  }`}
                >
                  Esta sesión pertenece a una <strong>serie semanal recurrente</strong>. Aquí puedes
                  modificar la fecha, hora, enlace o nota de <strong>solo esta sesión</strong>, o abrir
                  el formulario completo para editar toda la serie.
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold mb-1">Fecha de esta sesión *</label>
                    <input
                      type="date"
                      required
                      value={editOccForm.fecha_especifica}
                      onChange={(e) =>
                        setEditOccForm((p) => ({ ...p, fecha_especifica: e.target.value }))
                      }
                      style={{ colorScheme: isDark ? 'dark' : 'light' }}
                      className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Hora (Bolivia) *</label>
                    <input
                      type="time"
                      required
                      value={editOccForm.hora_inicio}
                      onChange={(e) =>
                        setEditOccForm((p) => ({ ...p, hora_inicio: e.target.value }))
                      }
                      style={{ colorScheme: isDark ? 'dark' : 'light' }}
                      className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Enlace de Meet / Zoom *</label>
                  <input
                    type="url"
                    required
                    value={editOccForm.enlace}
                    onChange={(e) => setEditOccForm((p) => ({ ...p, enlace: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Motivo / Nota (opcional)</label>
                  <input
                    type="text"
                    value={editOccForm.motivo}
                    onChange={(e) => setEditOccForm((p) => ({ ...p, motivo: e.target.value }))}
                    placeholder="Ej: Ajuste de fecha u horario de esta sesión"
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold mb-1">Título de la clase *</label>
                  <input
                    type="text"
                    required
                    value={editOccForm.titulo}
                    onChange={(e) => setEditOccForm((p) => ({ ...p, titulo: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Expositor / Docente *</label>
                  <input
                    type="text"
                    required
                    value={editOccForm.expositor}
                    onChange={(e) => setEditOccForm((p) => ({ ...p, expositor: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Estado</label>
                  <select
                    value={editOccForm.status}
                    onChange={(e) => setEditOccForm((p) => ({ ...p, status: e.target.value }))}
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  >
                    <option value="programada" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>Programada</option>
                    <option value="en_vivo" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>En Vivo</option>
                    <option value="reprogramada" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>Reprogramada</option>
                    <option value="cancelada" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>Cancelada</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Fecha *</label>
                  <input
                    type="date"
                    required
                    value={editOccForm.fecha_especifica}
                    onChange={(e) =>
                      setEditOccForm((p) => ({ ...p, fecha_especifica: e.target.value }))
                    }
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Hora de inicio *</label>
                  <input
                    type="time"
                    required
                    value={editOccForm.hora_inicio}
                    onChange={(e) => setEditOccForm((p) => ({ ...p, hora_inicio: e.target.value }))}
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Duración (min)</label>
                  <input
                    type="number"
                    min={10}
                    max={480}
                    required
                    value={editOccForm.duracion_minutos}
                    onChange={(e) =>
                      setEditOccForm((p) => ({ ...p, duracion_minutos: e.target.value }))
                    }
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">ID / Código (opcional)</label>
                  <input
                    type="text"
                    value={editOccForm.id_reunion}
                    onChange={(e) => setEditOccForm((p) => ({ ...p, id_reunion: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold mb-1">Enlace de Meet / Zoom *</label>
                  <input
                    type="url"
                    required
                    value={editOccForm.enlace}
                    onChange={(e) => setEditOccForm((p) => ({ ...p, enlace: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Curso</label>
                  <select
                    value={editOccForm.course_id}
                    onChange={(e) => setEditOccForm((p) => ({ ...p, course_id: e.target.value }))}
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  >
                    <option value="" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>
                      Clase General (sin curso)
                    </option>
                    {allCourses.map((c) => (
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
                  <label className="block text-xs font-bold mb-1">Especialidad</label>
                  <select
                    value={editOccForm.especialidad_id}
                    onChange={(e) =>
                      setEditOccForm((p) => ({ ...p, especialidad_id: e.target.value }))
                    }
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  >
                    <option value="" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>
                      Sin especialidad
                    </option>
                    {allCategories.map((cat) => (
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

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold mb-1">Temario / Notas (opcional)</label>
                  <textarea
                    rows={2}
                    value={editOccForm.descripcion}
                    onChange={(e) =>
                      setEditOccForm((p) => ({ ...p, descripcion: e.target.value }))
                    }
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  />
                </div>
              </div>
            )}

            {/* Grabación y Diapositivas / Documentos directamente en el modal de edición */}
            <div
              className={`pt-3 border-t space-y-2.5 ${
                isDark ? 'border-white/10' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs sm:text-sm font-black uppercase tracking-wide flex items-center gap-1.5">
                  <Presentation className="w-4 h-4 text-[#24B0BA]" />
                  <span>Grabación y Diapositivas / Documentos</span>
                </h3>
                <span className="text-[11px] opacity-70 tabular-nums">
                  Sesión: {editOccForm.fecha_especifica || editOccTarget.occurrence_date}
                </span>
              </div>

              <LiveClassResourcesFields
                draft={editOccResourceDraft}
                setDraft={setEditOccResourceDraft}
                titleHint={editOccForm.titulo || editOccTarget.titulo}
                isDark={isDark}
                idPrefix="edit-occ"
              />
            </div>

            <div
              className={`flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t ${
                isDark ? 'border-white/10' : 'border-slate-200'
              }`}
            >
              <Link
                href={`/admin/live-classes/editar/${editOccTarget.schedule_id}?returnTab=${activeTab}&date=${encodeURIComponent(
                  editOccForm.fecha_especifica || editOccTarget.occurrence_date || ''
                )}`}
                className={`text-xs font-bold underline text-center sm:text-left ${
                  isDark ? 'text-blue-300' : 'text-[#014ba0]'
                }`}
              >
                {editOccTarget.is_recurring
                  ? 'Editar toda la serie semanal'
                  : 'Abrir editor completo'}
              </Link>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={savingEditOcc}
                  onClick={() => setEditOccTarget(null)}
                  className={`min-h-[42px] px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                    isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEditOcc}
                  className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-60"
                >
                  {savingEditOcc ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Guardar cambios</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Registro Rápido desde la Cuadrícula Semanal */}
      {quickCreateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-create-modal-title"
          onClick={() => !savingQuickCreate && setQuickCreateOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <form
            onSubmit={handleSaveQuickCreate}
            onClick={(e) => e.stopPropagation()}
            style={{ colorScheme: isDark ? 'dark' : 'light' }}
            className={`w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border shadow-2xl p-5 sm:p-6 space-y-4 ${surfaceClass}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="quick-create-modal-title" className="text-lg font-black flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-emerald-500" />
                  <span>Programar Clase en Cuadrícula</span>
                </h2>
                <p className="text-xs opacity-75 mt-0.5 tabular-nums">
                  {quickCreateForm.fecha_especifica
                    ? `Fecha seleccionada: ${formatShortDateBadge(quickCreateForm.fecha_especifica, todayStr)} (${quickCreateForm.fecha_especifica})`
                    : 'Configura los datos de la sesión'}
                </p>
              </div>
              <button
                type="button"
                disabled={savingQuickCreate}
                onClick={() => setQuickCreateOpen(false)}
                className="p-1.5 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tipo: Clase única vs Semanal */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setQuickCreateForm((p) => ({ ...p, is_recurring: false }))}
                className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  !quickCreateForm.is_recurring
                    ? 'bg-[#014ba0] border-[#014ba0] text-white'
                    : isDark
                    ? 'border-white/15 text-slate-300'
                    : 'border-slate-300 text-slate-700'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Clase Única</span>
              </button>
              <button
                type="button"
                onClick={() => setQuickCreateForm((p) => ({ ...p, is_recurring: true }))}
                className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  quickCreateForm.is_recurring
                    ? 'bg-[#014ba0] border-[#014ba0] text-white'
                    : isDark
                    ? 'border-white/15 text-slate-300'
                    : 'border-slate-300 text-slate-700'
                }`}
              >
                <Repeat className="w-3.5 h-3.5" />
                <span>Repetir cada semana</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold mb-1">Título de la clase *</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={quickCreateForm.titulo}
                  onChange={(e) => setQuickCreateForm((p) => ({ ...p, titulo: e.target.value }))}
                  placeholder="Ej. Electrocardiograma Básico"
                  className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Expositor / Docente *</label>
                <input
                  type="text"
                  required
                  value={quickCreateForm.expositor}
                  onChange={(e) => setQuickCreateForm((p) => ({ ...p, expositor: e.target.value }))}
                  placeholder="Ej. Dr. Juan Pérez"
                  className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                />
              </div>

              {!quickCreateForm.is_recurring ? (
                <div>
                  <label className="block text-xs font-bold mb-1">Fecha *</label>
                  <input
                    type="date"
                    required
                    value={quickCreateForm.fecha_especifica}
                    onChange={(e) =>
                      setQuickCreateForm((p) => ({ ...p, fecha_especifica: e.target.value }))
                    }
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold mb-1">Día de cada semana *</label>
                  <select
                    value={quickCreateForm.day_of_week}
                    onChange={(e) =>
                      setQuickCreateForm((p) => ({ ...p, day_of_week: e.target.value }))
                    }
                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                  >
                    {DAYS_OF_WEEK_ES.map((d) => (
                      <option
                        key={d.value}
                        value={String(d.value)}
                        className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}
                      >
                        Todos los {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold mb-1">Hora de inicio *</label>
                <input
                  type="time"
                  required
                  value={quickCreateForm.hora_inicio}
                  onChange={(e) =>
                    setQuickCreateForm((p) => ({ ...p, hora_inicio: e.target.value }))
                  }
                  style={{ colorScheme: isDark ? 'dark' : 'light' }}
                  className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Duración (min)</label>
                <select
                  value={quickCreateForm.duracion_minutos}
                  onChange={(e) =>
                    setQuickCreateForm((p) => ({ ...p, duracion_minutos: e.target.value }))
                  }
                  style={{ colorScheme: isDark ? 'dark' : 'light' }}
                  className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                >
                  {DURATION_PRESETS.map((m) => (
                    <option
                      key={m}
                      value={m}
                      className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}
                    >
                      {m} minutos
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold mb-1">Enlace de Meet / Zoom *</label>
                <input
                  type="url"
                  required
                  value={quickCreateForm.enlace}
                  onChange={(e) => setQuickCreateForm((p) => ({ ...p, enlace: e.target.value }))}
                  placeholder="https://meet.google.com/..."
                  className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Curso (opcional)</label>
                <select
                  value={quickCreateForm.course_id}
                  onChange={(e) =>
                    setQuickCreateForm((p) => ({ ...p, course_id: e.target.value }))
                  }
                  style={{ colorScheme: isDark ? 'dark' : 'light' }}
                  className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                >
                  <option value="" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>
                    Clase General (sin curso)
                  </option>
                  {allCourses.map((c) => (
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
                <label className="block text-xs font-bold mb-1">Especialidad (opcional)</label>
                <select
                  value={quickCreateForm.especialidad_id}
                  onChange={(e) =>
                    setQuickCreateForm((p) => ({ ...p, especialidad_id: e.target.value }))
                  }
                  style={{ colorScheme: isDark ? 'dark' : 'light' }}
                  className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                >
                  <option value="" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-slate-900'}>
                    Sin especialidad
                  </option>
                  {allCategories.map((cat) => (
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

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold mb-1">Descripción / Notas (opcional)</label>
                <input
                  type="text"
                  value={quickCreateForm.descripcion}
                  onChange={(e) =>
                    setQuickCreateForm((p) => ({ ...p, descripcion: e.target.value }))
                  }
                  placeholder="Indicaciones breves para los estudiantes..."
                  className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${inputClass}`}
                />
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-white/10">
              <Link
                href={`/admin/live-classes/nueva?date=${encodeURIComponent(
                  quickCreateForm.fecha_especifica || todayStr
                )}`}
                className={`text-xs font-bold underline text-center sm:text-left ${
                  isDark ? 'text-blue-300' : 'text-[#014ba0]'
                }`}
              >
                Abrir formulario completo
              </Link>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={savingQuickCreate}
                  onClick={() => setQuickCreateOpen(false)}
                  className={`min-h-[42px] px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                    isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingQuickCreate}
                  className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-60"
                >
                  {savingQuickCreate ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Guardar Clase</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <Toaster position="top-right" />
    </div>
  );
}
