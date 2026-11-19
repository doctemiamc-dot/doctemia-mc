// src/app/app/clases-en-vivo/page.jsx
'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { db } from '@/lib/firebase';
import { supabase } from '@/lib/supabase';
import {
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  getCachedCategories,
  getCachedPagoUnicoCourses,
  getCachedContactInfo,
  getCachedPendingAccessRequest,
  setCachedPendingAccessRequest,
} from '@/lib/catalogCache';
import Link from 'next/link';
import {
  LockKeyhole,
  Send,
  Hourglass,
  Clock,
  User,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Video,
  CalendarPlus,
  Download,
  Loader2,
  Radio,
  Search,
  Copy,
  Check,
  Repeat,
  LayoutList,
  CalendarDays,
  X,
  Info,
  ExternalLink,
  Presentation,
  PlayCircle,
  FileText,
} from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import Swal from 'sweetalert2';
import LiveClassRecordingModal from '@/components/live-classes/LiveClassRecordingModal';
import { toDrivePreviewUrl } from '@/lib/materialUtils';
import {
  DAYS_OF_WEEK_ES,
  addDaysToDateStr,
  buildGoogleCalendarUrl,
  buildIcsContent,
  computeOccurrenceLiveStatus,
  formatCountdownEs,
  formatEndTimeHHMM,
  getOccurrenceStartMs,
  getTodayBoliviaStr,
  getWeekDays,
  getWeekStartMonday,
} from '@/lib/scheduleUtils';

const ProtectedDocumentViewer = dynamic(
  () => import('@/app/components/documents/ProtectedDocumentViewer'),
  { ssr: false }
);

function formatArchiveDateLabel(dateStr) {
  if (!dateStr) return '';
  const clean = String(dateStr).slice(0, 10);
  const [y, m, d] = clean.split('-').map(Number);
  if (!y || !m || !d) return clean;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const shortDay = DAYS_OF_WEEK_ES.find((item) => item.value === dow)?.short || '';
  return `${shortDay} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

const NOMBRE_NEGOCIO = 'DOCTEMIA MC';

const AccessDeniedScreen = ({ user, isDark, swalTheme }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [contactInfo, setContactInfo] = useState({ qrUrl: '', adminPhone: '' });

  useEffect(() => {
    const checkRequestAndLoadInfo = async () => {
      if (user?.uid) {
        const [hasPending, info] = await Promise.all([
          getCachedPendingAccessRequest(user.uid),
          getCachedContactInfo(),
        ]);
        if (hasPending) setRequestSent(true);
        if (info) setContactInfo(info);
      }
    };
    checkRequestAndLoadInfo();
  }, [user?.uid]);

  const handleRequestAccessPopup = () => {
    Swal.fire({
      title: `<h3 class="text-xl font-bold" style="color: #014ba0">¡Solicita tu Acceso!</h3>`,
      html: `
        <div class="text-left space-y-4 p-2" style="color: ${isDark ? '#f3f4f6' : '#1a2639'};">
          <p class="text-center text-sm">Completa el pago usando el QR y luego contáctanos por WhatsApp para activación inmediata.</p>
          <div class="flex justify-center my-3">
            ${
              contactInfo.qrUrl
                ? `<img src="${contactInfo.qrUrl}" alt="Código QR de Pago" class="w-44 h-44 rounded-xl shadow-md border-2 border-[#014ba0]"/>`
                : '<p class="text-sm opacity-70">Código QR no disponible.</p>'
            }
          </div>
          <a href="https://api.whatsapp.com/send?phone=${contactInfo.adminPhone}&text=${encodeURIComponent(
            `Hola ${NOMBRE_NEGOCIO}, soy ${user.name || user.displayName}. Acabo de realizar el pago para el acceso a las clases en vivo.`
          )}" target="_blank" class="flex items-center justify-center gap-2 w-full text-white font-bold py-3 px-4 rounded-xl" style="background-color: #25D366;">
            Contactar por WhatsApp
          </a>
          <input id="swal-input-phone" class="swal2-input !w-full !mx-0" placeholder="Tu número de WhatsApp (ej: +591...)" type="tel" />
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Enviar Solicitud',
      cancelButtonText: 'Cancelar',
      ...swalTheme,
      preConfirm: () => {
        const phone = Swal.getPopup().querySelector('#swal-input-phone').value;
        if (!phone) {
          Swal.showValidationMessage('Por favor, ingresa tu número de WhatsApp');
        }
        return { phone };
      },
    }).then(async (result) => {
      if (result.isConfirmed) {
        setIsSubmitting(true);
        try {
          await addDoc(collection(db, 'pagoUnico_solicitudes'), {
            userId: user.uid,
            userName: user.name || user.displayName,
            userEmail: user.email,
            userPhone: result.value.phone,
            requestDate: serverTimestamp(),
            status: 'pendiente',
            type: 'clases_vivo_access',
          });
          setRequestSent(true);
          setCachedPendingAccessRequest(user.uid, true);
          Swal.fire({
            title: '¡Solicitud Enviada!',
            text: 'Te contactaremos pronto.',
            icon: 'success',
            ...swalTheme,
          });
        } catch (error) {
          console.error('Error al crear solicitud:', error);
          Swal.fire({
            title: 'Error',
            text: 'No se pudo enviar tu solicitud.',
            icon: 'error',
            ...swalTheme,
          });
        } finally {
          setIsSubmitting(false);
        }
      }
    });
  };

  return (
    <div
      className={`flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] text-center p-5 ${
        isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
      }`}
    >
      <div
        className={`rounded-3xl border shadow-xl p-7 sm:p-9 max-w-md w-full ${
          isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15'
        }`}
      >
        <div
          className={`w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center ${
            isDark ? 'bg-[#24B0BA]/15 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
          }`}
        >
          <LockKeyhole className="h-8 w-8" />
        </div>

        <h1 className="text-2xl font-extrabold mb-2">Acceso Restringido</h1>
        <p className={`mb-7 text-sm leading-relaxed ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
          Para acceder a las clases en vivo de DOCTEMIA MC necesitas la habilitación de tu cuenta.
        </p>

        {requestSent ? (
          <div className="flex items-center justify-center gap-2.5 p-4 rounded-xl font-bold text-sm bg-amber-500/15 text-amber-600 border border-amber-500/30">
            <Hourglass className="h-5 w-5 shrink-0" />
            <span>Tu solicitud está en revisión</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleRequestAccessPopup}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-bold text-white bg-[#014ba0] hover:bg-[#013b80] transition-colors w-full cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Procesando...</span>
              </>
            ) : (
              <>
                <span>Solicitar Acceso Ahora</span>
                <Send className="w-4 h-4" />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default function ClasesEnVivoUsuario() {
  const { user, firebaseAuthUser, loading: authLoading } = useAuth();
  const { isDark, isLoaded } = useTheme();

  const todayStr = useMemo(() => getTodayBoliviaStr(), []);
  const currentWeekMonday = useMemo(() => getWeekStartMonday(), []);

  const [weekStart, setWeekStart] = useState(() => getWeekStartMonday());
  const [selectedMobileDay, setSelectedMobileDay] = useState(() => getTodayBoliviaStr());
  const [mobileShowAllWeek, setMobileShowAllWeek] = useState(false);
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' | 'agenda' | 'past'

  const [occurrences, setOccurrences] = useState([]);
  const [nextWeekOccurrences, setNextWeekOccurrences] = useState([]);
  const [pastArchive, setPastArchive] = useState([]);
  const [pastOnlyRecorded, setPastOnlyRecorded] = useState(false);
  const [activeRecordingOcc, setActiveRecordingOcc] = useState(null);
  const [activeSlidesMaterial, setActiveSlidesMaterial] = useState(null);
  const [courses, setCourses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedEspId, setSelectedEspId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedDescIds, setExpandedDescIds] = useState({});
  const [selectedOccurrence, setSelectedOccurrence] = useState(null);
  const [copiedId, setCopiedId] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [isFetchingWeek, setIsFetchingWeek] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const fetchSeqRef = useRef(0);
  const weekCacheRef = useRef(new Map());
  const pastArchiveCacheRef = useRef(new Map());
  const [tickNow, setTickNow] = useState(() => Date.now());

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f9fafb' : '#1a2639',
      confirmButtonColor: '#014ba0',
      cancelButtonColor: '#CF8A40',
    }),
    [isDark]
  );

  // Cargar cursos y especialidades desde caché de sesión
  useEffect(() => {
    if (!user?.hasPagoUnicoAccess) return;
    const loadFilters = async () => {
      try {
        const [puCourses, cats] = await Promise.all([
          getCachedPagoUnicoCourses({ onlyActive: true }),
          getCachedCategories(),
        ]);
        setCourses(puCourses);
        setCategories(cats);
      } catch (err) {
        console.error('Error cargando filtros de clases:', err);
      }
    };
    loadFilters();
  }, [user?.hasPagoUnicoAccess]);

  const fetchWeekOccurrences = useCallback(
    async (forceRefresh = false) => {
      if (!user?.hasPagoUnicoAccess) {
        setInitialLoading(false);
        return;
      }

      const nextW = addDaysToDateStr(weekStart, 7);
      const filterPrefix = `${selectedCourseId || '*'}|${selectedEspId || '*'}`;
      const w0Key = `${filterPrefix}|${weekStart}`;
      const w1Key = `${filterPrefix}|${nextW}`;

      if (forceRefresh) {
        weekCacheRef.current.clear();
        pastArchiveCacheRef.current.clear();
      }

      const hasCachedCurrent = !forceRefresh && weekCacheRef.current.has(w0Key);
      const hasCachedNext = !forceRefresh && weekCacheRef.current.has(w1Key);
      const hasCachedArchive = !forceRefresh && pastArchiveCacheRef.current.has(filterPrefix);

      if (hasCachedCurrent) {
        setOccurrences(weekCacheRef.current.get(w0Key) || []);
      }
      if (hasCachedNext) {
        setNextWeekOccurrences(weekCacheRef.current.get(w1Key) || []);
      }
      if (hasCachedArchive) {
        setPastArchive(pastArchiveCacheRef.current.get(filterPrefix) || []);
      }

      if (hasCachedCurrent && hasCachedNext && hasCachedArchive && !forceRefresh) {
        setInitialLoading(false);
        setIsFetchingWeek(false);
        return;
      }

      if (hasLoadedOnceRef.current && !hasCachedCurrent) {
        setIsFetchingWeek(true);
      }

      const seq = ++fetchSeqRef.current;

      try {
        const params = new URLSearchParams({
          weekStart,
          weeks: '2',
          includePastArchive: '1',
        });
        if (selectedCourseId) params.set('course_id', selectedCourseId);
        if (selectedEspId) params.set('especialidad_id', selectedEspId);

        const headers = {};
        if (firebaseAuthUser) {
          const token = await firebaseAuthUser.getIdToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }

        const res = await fetch(`/api/schedules?${params.toString()}`, { headers });
        const data = await res.json();
        if (res.ok && seq === fetchSeqRef.current) {
          const week0 = data.weeks?.[0]?.occurrences ?? data.occurrences ?? [];
          const week1 = data.weeks?.[1]?.occurrences ?? [];
          const archive = data.pastArchive || [];
          weekCacheRef.current.set(w0Key, week0);
          weekCacheRef.current.set(w1Key, week1);
          pastArchiveCacheRef.current.set(filterPrefix, archive);
          setOccurrences(week0);
          setNextWeekOccurrences(week1);
          setPastArchive(archive);
        }
      } catch (err) {
        console.error('Error cargando calendario:', err);
      } finally {
        if (seq === fetchSeqRef.current) {
          hasLoadedOnceRef.current = true;
          setInitialLoading(false);
          setIsFetchingWeek(false);
        }
      }
    },
    [user?.hasPagoUnicoAccess, firebaseAuthUser, weekStart, selectedCourseId, selectedEspId]
  );

  useEffect(() => {
    if (authLoading) return;
    if (!user || !user.hasPagoUnicoAccess) {
      hasLoadedOnceRef.current = false;
      weekCacheRef.current.clear();
      setInitialLoading(false);
      return;
    }
    fetchWeekOccurrences(false);
  }, [authLoading, user?.uid, user?.hasPagoUnicoAccess, fetchWeekOccurrences]);

  // Sincronización instantánea vía Supabase Realtime
  useEffect(() => {
    if (!user?.hasPagoUnicoAccess) return;
    const channel = supabase
      .channel('live-schedules-sync')
      .on('broadcast', { event: 'schedule-updated' }, () => {
        fetchWeekOccurrences(true);
        toast.success('Horario actualizado en vivo', { duration: 2000 });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.hasPagoUnicoAccess, fetchWeekOccurrences]);

  // Refrescar estado "En vivo" cada 30 segundos y cerrar modal con Escape
  useEffect(() => {
    const timer = setInterval(() => setTickNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') setSelectedOccurrence(null);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const nextWeekStart = useMemo(() => addDaysToDateStr(weekStart, 7), [weekStart]);
  const nextWeekDays = useMemo(() => getWeekDays(nextWeekStart), [nextWeekStart]);

  useEffect(() => {
    const belongs = weekDays.some((d) => d.date === selectedMobileDay);
    if (!belongs && weekDays.length > 0) {
      const todayInWeek = weekDays.find((d) => d.date === todayStr);
      const firstDayWithClass = weekDays.find((d) =>
        occurrences.some((o) => o.occurrence_date === d.date)
      );
      setSelectedMobileDay(todayInWeek?.date || firstDayWithClass?.date || weekDays[0].date);
    }
  }, [weekDays, selectedMobileDay, todayStr, occurrences]);

  const filterBySearch = useCallback(
    (list) => {
      const q = searchTerm.trim().toLowerCase();
      if (!q) return list;
      return list.filter(
        (occ) =>
          (occ.titulo || '').toLowerCase().includes(q) ||
          (occ.expositor || '').toLowerCase().includes(q) ||
          (occ.course_title || '').toLowerCase().includes(q) ||
          (occ.especialidad_nombre || '').toLowerCase().includes(q)
      );
    },
    [searchTerm]
  );

  const filteredOccurrences = useMemo(
    () => filterBySearch(occurrences),
    [occurrences, filterBySearch]
  );

  const filteredNextWeekOccurrences = useMemo(
    () => filterBySearch(nextWeekOccurrences),
    [nextWeekOccurrences, filterBySearch]
  );

  // Detectar clase en vivo ahora o la más próxima (semana actual o siguiente)
  const spotlightOccurrence = useMemo(() => {
    const combined = [...filteredOccurrences, ...filteredNextWeekOccurrences];
    const liveNow = combined.find(
      (occ) => computeOccurrenceLiveStatus(occ, tickNow) === 'en_vivo'
    );
    if (liveNow) return { occ: liveNow, isLive: true };

    const upcoming = combined.find((occ) => {
      const status = computeOccurrenceLiveStatus(occ, tickNow);
      if (status === 'cancelada' || status === 'finalizada') return false;
      const startMs = getOccurrenceStartMs(occ);
      return Number.isFinite(startMs) && startMs >= tickNow - 10 * 60000;
    });
    if (upcoming) return { occ: upcoming, isLive: false };

    return null;
  }, [filteredOccurrences, filteredNextWeekOccurrences, tickNow]);

  const groupDaysWithClasses = useCallback(
    (days, occs) =>
      days
        .map((day) => ({
          day,
          items: occs.filter((o) => o.occurrence_date === day.date),
        }))
        .filter((group) => group.items.length > 0),
    []
  );

  const daysWithClasses = useMemo(
    () => groupDaysWithClasses(weekDays, filteredOccurrences),
    [groupDaysWithClasses, weekDays, filteredOccurrences]
  );

  const nextWeekDaysWithClasses = useMemo(
    () => groupDaysWithClasses(nextWeekDays, filteredNextWeekOccurrences),
    [groupDaysWithClasses, nextWeekDays, filteredNextWeekOccurrences]
  );

  const nextMobileDayWithClass = useMemo(() => {
    const afterSelected = daysWithClasses.find((g) => g.day.date > selectedMobileDay);
    return afterSelected || daysWithClasses[0] || null;
  }, [daysWithClasses, selectedMobileDay]);

  const getOccurrenceFlags = useCallback(
    (occ) => {
      const liveStatus = computeOccurrenceLiveStatus(occ, tickNow);
      const isLiveNow = liveStatus === 'en_vivo';
      const isCancelled = liveStatus === 'cancelada';
      const isRescheduled = liveStatus === 'reprogramada';
      const isPastDay = Boolean(occ?.occurrence_date && occ.occurrence_date < todayStr);
      const isFinished = liveStatus === 'finalizada' || (isPastDay && !isCancelled);
      return {
        liveStatus,
        isLiveNow,
        isCancelled,
        isRescheduled,
        isPastDay,
        isFinished,
        isPending: !isCancelled && !isFinished,
      };
    },
    [tickNow, todayStr]
  );

  const weekSummary = useMemo(() => {
    let pending = 0;
    let past = 0;
    let live = 0;
    for (const occ of filteredOccurrences) {
      const flags = getOccurrenceFlags(occ);
      if (flags.isCancelled) continue;
      if (flags.isFinished) {
        past += 1;
      } else {
        pending += 1;
        if (flags.isLiveNow) live += 1;
      }
    }
    return { pending, past, live };
  }, [filteredOccurrences, getOccurrenceFlags]);

  const filteredPastArchive = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return pastArchive.filter((occ) => {
      if (selectedCourseId && occ.course_id && occ.course_id !== selectedCourseId) return false;
      if (selectedEspId && occ.especialidad_id && occ.especialidad_id !== selectedEspId) return false;
      if (!q) return true;
      return (
        (occ.titulo || '').toLowerCase().includes(q) ||
        (occ.expositor || '').toLowerCase().includes(q) ||
        (occ.course_title || '').toLowerCase().includes(q) ||
        (occ.especialidad_nombre || '').toLowerCase().includes(q)
      );
    });
  }, [pastArchive, selectedCourseId, selectedEspId, searchTerm]);

  const pastArchiveWithResourcesCount = useMemo(
    () => filteredPastArchive.filter((o) => o.has_resources).length,
    [filteredPastArchive]
  );

  const visiblePastArchive = useMemo(
    () =>
      pastOnlyRecorded ? filteredPastArchive.filter((o) => o.has_resources) : filteredPastArchive,
    [filteredPastArchive, pastOnlyRecorded]
  );

  const handleOpenRecording = (occ) => {
    if (!occ?.recording_url) return;
    setSelectedOccurrence(null);
    setActiveRecordingOcc(occ);
  };

  const handleOpenSlides = (occ) => {
    if (!occ) return;
    if (occ.slides_material) {
      setSelectedOccurrence(null);
      setActiveSlidesMaterial({
        ...occ.slides_material,
        title:
          occ.slides_title ||
          occ.slides_material.title ||
          `Diapositivas: ${occ.titulo}`,
      });
      return;
    }

    const link = occ.slides_url;
    if (!link) return;

    const isDrive = link.includes('drive.google.com') || link.includes('docs.google.com');
    if (isDrive) {
      setSelectedOccurrence(null);
      setActiveSlidesMaterial({
        id: null,
        title: occ.slides_title || `Diapositivas: ${occ.titulo}`,
        material_type: 'slides',
        source_type: 'google_drive_legacy',
        file_url: link,
        preview_url: toDrivePreviewUrl(link),
        especialidad_nombre: occ.especialidad_nombre || null,
        subtema: occ.titulo,
      });
      return;
    }

    window.open(link, '_blank', 'noopener,noreferrer');
  };

  const nextMobilePendingDay = useMemo(() => {
    return (
      daysWithClasses.find(
        (g) =>
          g.day.date >= todayStr &&
          g.items.some((occ) => getOccurrenceFlags(occ).isPending)
      ) || null
    );
  }, [daysWithClasses, todayStr, getOccurrenceFlags]);

  const handleDownloadIcs = (occ) => {
    const ics = buildIcsContent(occ);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(occ.titulo || 'clase-en-vivo').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyText = async (key, text, label) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      toast.success(`${label} copiado`);
      setTimeout(() => setCopiedId((prev) => (prev === key ? '' : prev)), 1800);
    } catch {
      toast.error('No se pudo copiar');
    }
  };

  const toggleDescription = (occId) => {
    setExpandedDescIds((prev) => ({ ...prev, [occId]: !prev[occId] }));
  };

  const clearAllFilters = () => {
    setSelectedCourseId('');
    setSelectedEspId('');
    setSearchTerm('');
  };

  if (authLoading || !isLoaded || (initialLoading && user?.hasPagoUnicoAccess)) {
    return (
      <div
        className={`min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center gap-3 ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <Loader2 className={`w-8 h-8 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
        <span className="text-sm font-bold">Cargando tus clases en vivo...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className={`flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] text-center p-6 ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <p className="text-lg mb-4 font-bold">Inicia sesión para ver las clases en vivo.</p>
        <Link
          href="/login"
          className="px-7 py-3 rounded-xl font-bold text-white bg-[#014ba0] hover:bg-[#013b80]"
        >
          Iniciar Sesión
        </Link>
      </div>
    );
  }

  if (!user.hasPagoUnicoAccess) {
    return <AccessDeniedScreen user={user} isDark={isDark} swalTheme={swalTheme} />;
  }

  const cardSurface = isDark
    ? 'bg-[#1e293b] border-white/10 text-white'
    : 'bg-white border-[#2E4A70]/15 text-[#1a2639]';
  const inputSurface = isDark
    ? 'bg-[#162235] border-white/15 text-white placeholder:text-blue-200/50 focus:border-[#24B0BA]'
    : 'bg-[#FFF9F0] border-[#2E4A70]/20 text-[#1a2639] placeholder:text-[#2E4A70]/60 focus:border-[#014ba0] focus:bg-white';

  const getFriendlyDayLabel = (day) => {
    const tomorrowStr = addDaysToDateStr(todayStr, 1);
    if (day.date === todayStr) return `Hoy · ${day.label} ${day.displayDate}`;
    if (day.date === tomorrowStr) return `Mañana · ${day.label} ${day.displayDate}`;
    return `${day.label} ${day.displayDate}`;
  };

  // Ficha compacta para la cuadrícula semanal (~90px de alto; toca para ver temario/calendario/ID)
  const renderCompactCalendarCard = (occ) => {
    const { isLiveNow, isCancelled, isRescheduled, isFinished } = getOccurrenceFlags(occ);

    return (
      <div
        key={occ.occurrence_id}
        role="button"
        tabIndex={0}
        onClick={() => setSelectedOccurrence(occ)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSelectedOccurrence(occ);
          }
        }}
        className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer space-y-1.5 ${
          isLiveNow
            ? isDark
              ? 'bg-emerald-950/45 border-emerald-500 shadow-xs'
              : 'bg-emerald-50 border-emerald-500 shadow-xs'
            : isCancelled
            ? isDark
              ? 'bg-red-950/25 border-red-800/50 opacity-75'
              : 'bg-red-50/70 border-red-200 opacity-75'
            : isFinished
            ? isDark
              ? 'bg-[#162235]/55 border-white/10 opacity-70 hover:opacity-95'
              : 'bg-[#F0F2F2]/80 border-[#2E4A70]/15 opacity-75 hover:opacity-100 hover:bg-white'
            : isRescheduled
            ? isDark
              ? 'bg-amber-950/25 border-amber-500/40'
              : 'bg-amber-50/70 border-amber-300'
            : isDark
            ? 'bg-[#162235] border-white/10 hover:border-[#24B0BA]'
            : 'bg-[#FFF9F0]/90 border-[#2E4A70]/15 hover:border-[#014ba0] hover:bg-white hover:shadow-xs'
        }`}
      >
        <div className="flex items-center justify-between gap-1">
          <span
            className={`text-[11px] font-extrabold tabular-nums ${
              isLiveNow
                ? isDark
                  ? 'text-emerald-300'
                  : 'text-emerald-700'
                : isFinished
                ? isDark
                  ? 'text-slate-400'
                  : 'text-[#2E4A70]/70'
                : isDark
                ? 'text-[#24B0BA]'
                : 'text-[#014ba0]'
            }`}
          >
            {occ.hora_inicio}
          </span>
          <span
            className={`inline-flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-tight ${
              isLiveNow
                ? 'bg-emerald-600 text-white'
                : isCancelled
                ? 'bg-red-500/20 text-red-500'
                : isFinished
                ? isDark
                  ? 'bg-white/10 text-slate-300'
                  : 'bg-[#2E4A70]/12 text-[#2E4A70]'
                : isRescheduled
                ? 'bg-amber-500/20 text-amber-600'
                : isDark
                ? 'bg-[#24B0BA]/20 text-[#24B0BA]'
                : 'bg-[#014ba0]/10 text-[#014ba0]'
            }`}
          >
            {isFinished && <Check className="w-2.5 h-2.5" />}
            <span>
              {isLiveNow
                ? 'En vivo'
                : isCancelled
                ? 'Cancelada'
                : isFinished
                ? 'Pasada'
                : isRescheduled
                ? 'Reprog.'
                : 'Pendiente'}
            </span>
          </span>
        </div>

        {/* Curso y Especialidad notorios */}
        <div className="flex flex-wrap items-center gap-1">
          <span
            title={occ.course_title || 'Clase General'}
            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md truncate max-w-full ${
              occ.course_title
                ? isDark
                  ? 'bg-[#CF8A40]/25 text-amber-200 border border-[#CF8A40]/40'
                  : 'bg-[#CF8A40]/15 text-[#8a4f14] border border-[#CF8A40]/30'
                : isDark
                ? 'bg-[#24B0BA]/20 text-[#24B0BA] border border-[#24B0BA]/30'
                : 'bg-[#24B0BA]/15 text-[#0b6168] border border-[#24B0BA]/30'
            }`}
          >
            {occ.course_title || 'Clase General'}
          </span>
          {occ.especialidad_nombre && (
            <span
              title={occ.especialidad_nombre}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md truncate max-w-full ${
                isDark
                  ? 'bg-white/10 text-blue-100 border border-white/10'
                  : 'bg-[#014ba0]/10 text-[#014ba0] border border-[#014ba0]/20'
              }`}
            >
              {occ.especialidad_nombre}
            </span>
          )}
        </div>

        <h3
          className={`text-xs font-extrabold leading-snug line-clamp-2 ${
            isCancelled ? 'line-through opacity-75' : isFinished ? 'opacity-80' : ''
          }`}
        >
          {occ.titulo}
        </h3>

        <p
          className={`text-[11px] truncate font-medium ${
            isDark ? 'text-blue-200/80' : 'text-[#2E4A70]'
          }`}
        >
          {occ.expositor}
        </p>

        <div className="pt-1.5 flex flex-wrap gap-1.5 w-full">
          {!isCancelled && !isFinished && (
            <a
              href={occ.enlace}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={`flex-1 min-w-[74px] inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-extrabold text-white transition-colors ${
                isLiveNow
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-[#014ba0] hover:bg-[#013b80]'
              }`}
            >
              <span>Entrar</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          )}
          {!isCancelled && occ.has_recording && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenRecording(occ);
              }}
              className="flex-1 min-w-[78px] inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
            >
              <PlayCircle className="w-3 h-3 shrink-0" />
              <span>Grabación</span>
            </button>
          )}
          {!isCancelled && occ.has_slides && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenSlides(occ);
              }}
              className={`flex-1 min-w-[72px] inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border text-[10px] font-extrabold transition-colors cursor-pointer ${
                isDark
                  ? 'bg-[#24B0BA]/20 border-[#24B0BA]/40 text-[#24B0BA] hover:bg-[#24B0BA]/30'
                  : 'bg-[#014ba0]/10 border-[#014ba0]/25 text-[#014ba0] hover:bg-[#014ba0]/15'
              }`}
            >
              <Presentation className="w-3 h-3 shrink-0" />
              <span>Diapos</span>
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedOccurrence(occ);
            }}
            className={`${
              isFinished && (occ.has_recording || occ.has_slides)
                ? 'px-2 py-1.5'
                : 'flex-1 min-w-[74px] px-2 py-1.5'
            } inline-flex items-center justify-center gap-1 rounded-lg text-[10px] font-extrabold border transition-colors cursor-pointer ${
              isDark
                ? 'bg-white/10 border-white/20 text-blue-100 hover:bg-white/20 hover:border-[#24B0BA]'
                : 'bg-white border-[#2E4A70]/25 text-[#1a2639] hover:border-[#014ba0] hover:text-[#014ba0] shadow-2xs'
            }`}
            title="Ver detalles completos"
          >
            <Info className="w-3 h-3 shrink-0" />
            {!(isFinished && occ.has_recording && occ.has_slides) && (
              <span>
                {isCancelled
                  ? 'Ver motivo'
                  : isFinished
                  ? occ.has_resources
                    ? 'Info'
                    : 'Clase pasada · Detalles'
                  : 'Detalles'}
              </span>
            )}
          </button>
        </div>
      </div>
    );
  };

  const renderStatusPill = (flags) => {
    const { isLiveNow, isCancelled, isFinished, isRescheduled } = flags;
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
          isLiveNow
            ? 'bg-emerald-600 text-white'
            : isCancelled
            ? isDark
              ? 'bg-red-500/20 text-red-300'
              : 'bg-red-100 text-red-700'
            : isFinished
            ? isDark
              ? 'bg-white/10 text-slate-300'
              : 'bg-[#2E4A70]/12 text-[#2E4A70]'
            : isRescheduled
            ? isDark
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-amber-100 text-amber-800'
            : isDark
            ? 'bg-[#24B0BA]/20 text-[#24B0BA]'
            : 'bg-[#014ba0]/10 text-[#014ba0]'
        }`}
      >
        {isLiveNow && <Radio className="w-3 h-3" />}
        {isFinished && <Check className="w-3 h-3" />}
        <span>
          {isLiveNow
            ? 'En vivo ahora'
            : isCancelled
            ? 'Cancelada'
            : isFinished
            ? 'Clase pasada'
            : isRescheduled
            ? 'Reprogramada'
            : 'Pendiente'}
        </span>
      </span>
    );
  };

  const renderClassCard = (occ, compact = false, showDateBadge = false) => {
    const flags = getOccurrenceFlags(occ);
    const { isLiveNow, isCancelled, isFinished } = flags;
    const endTime = formatEndTimeHHMM(occ.hora_inicio, occ.duracion_minutos);
    const isDescOpen = Boolean(expandedDescIds[occ.occurrence_id]);

    return (
      <article
        key={`${occ.occurrence_id}__${occ.occurrence_date}`}
        className={`rounded-2xl border p-4 transition-all flex flex-col justify-between gap-3 ${
          isLiveNow
            ? isDark
              ? 'bg-emerald-950/35 border-emerald-500 shadow-md'
              : 'bg-emerald-50/80 border-emerald-500 shadow-md'
            : isCancelled
            ? isDark
              ? 'bg-red-950/20 border-red-800/50 opacity-80'
              : 'bg-red-50/60 border-red-200 opacity-80'
            : isFinished
            ? isDark
              ? 'bg-[#162235]/65 border-white/10 opacity-90'
              : 'bg-[#F0F2F2]/85 border-[#2E4A70]/15'
            : isDark
            ? 'bg-[#162235] border-white/10'
            : 'bg-white border-[#2E4A70]/15 shadow-xs hover:border-[#014ba0]/40'
        }`}
      >
        <div className="space-y-2.5">
          {/* Hora + Estado */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {showDateBadge && (
                <span
                  className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md tabular-nums ${
                    isDark ? 'bg-white/10 text-blue-200' : 'bg-white border border-[#2E4A70]/15 text-[#014ba0]'
                  }`}
                >
                  {formatArchiveDateLabel(occ.occurrence_date)}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-extrabold tabular-nums ${
                  isLiveNow
                    ? isDark
                      ? 'text-emerald-300'
                      : 'text-emerald-700'
                    : isFinished
                    ? isDark
                      ? 'text-slate-400'
                      : 'text-[#2E4A70]/70'
                    : isDark
                    ? 'text-[#24B0BA]'
                    : 'text-[#014ba0]'
                }`}
              >
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {occ.hora_inicio} – {endTime}
                </span>
              </span>
              <span
                className={`text-[11px] font-semibold ${
                  isDark ? 'text-blue-200/75' : 'text-[#2E4A70]'
                }`}
              >
                ({occ.duracion_minutos} min)
              </span>
              {occ.is_recurring && !compact && (
                <span
                  title="Clase semanal fija"
                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                    isDark ? 'bg-white/10 text-blue-200' : 'bg-[#F0F2F2] text-[#2E4A70]'
                  }`}
                >
                  <Repeat className="w-3 h-3" />
                  <span>Semanal</span>
                </span>
              )}
            </div>

            {renderStatusPill(flags)}
          </div>

          {/* Curso y Especialidad destacados arriba */}
          <div className="flex flex-wrap items-center gap-1.5">
            {occ.course_title ? (
              <span
                className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-lg border ${
                  isDark
                    ? 'bg-[#CF8A40]/25 text-amber-200 border-[#CF8A40]/40'
                    : 'bg-[#CF8A40]/15 text-[#8a4f14] border-[#CF8A40]/30'
                }`}
              >
                {occ.course_title}
              </span>
            ) : (
              <span
                className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-lg border ${
                  isDark
                    ? 'bg-[#24B0BA]/20 text-[#24B0BA] border-[#24B0BA]/35'
                    : 'bg-[#24B0BA]/15 text-[#0b6168] border-[#24B0BA]/30'
                }`}
              >
                Clase General
              </span>
            )}

            {occ.especialidad_nombre && (
              <span
                className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-lg border ${
                  isDark
                    ? 'bg-white/10 text-blue-100 border-white/15'
                    : 'bg-[#014ba0]/10 text-[#014ba0] border-[#014ba0]/20'
                }`}
              >
                {occ.especialidad_nombre}
              </span>
            )}

            {occ.id_reunion && !isCancelled && !isFinished && (
              <button
                type="button"
                onClick={() => handleCopyText(`id-${occ.occurrence_id}`, occ.id_reunion, 'ID de reunión')}
                className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-lg border transition-colors cursor-pointer ${
                  isDark
                    ? 'bg-white/5 border-white/15 text-blue-100 hover:bg-white/10'
                    : 'bg-[#FFF9F0] border-[#2E4A70]/20 text-[#1a2639] hover:border-[#014ba0]'
                }`}
                title="Copiar ID de reunión"
              >
                {copiedId === `id-${occ.occurrence_id}` ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3 opacity-70" />
                )}
                <span>ID: {occ.id_reunion}</span>
              </button>
            )}
          </div>

          {/* Título y Ponente */}
          <div>
            <h3
              className={`font-extrabold ${
                compact ? 'text-sm' : 'text-base sm:text-lg'
              } leading-snug break-words ${
                isCancelled ? 'line-through opacity-75' : isFinished ? 'opacity-80' : ''
              }`}
            >
              {occ.titulo}
            </h3>
            <p
              className={`text-xs sm:text-sm mt-1 flex items-center gap-1.5 font-medium ${
                isDark ? 'text-blue-200' : 'text-[#2E4A70]'
              }`}
            >
              <User className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{occ.expositor}</span>
            </p>
          </div>

          {occ.motivo && (
            <p className={`text-xs font-medium italic ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
              Nota: {occ.motivo}
            </p>
          )}

          {/* Temario / Descripción */}
          {occ.descripcion && (
            <div>
              <button
                type="button"
                onClick={() => toggleDescription(occ.occurrence_id)}
                className={`inline-flex items-center gap-1 text-xs font-bold cursor-pointer ${
                  isDark ? 'text-[#24B0BA] hover:underline' : 'text-[#014ba0] hover:underline'
                }`}
              >
                <Info className="w-3.5 h-3.5" />
                <span>{isDescOpen ? 'Ocultar temario' : 'Ver temario / indicaciones'}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${isDescOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {isDescOpen && (
                <p
                  className={`mt-2 p-2.5 rounded-xl text-xs leading-relaxed whitespace-pre-wrap border ${
                    isDark
                      ? 'bg-[#1e293b] border-white/10 text-blue-100'
                      : 'bg-[#FFF9F0] border-[#2E4A70]/15 text-[#2E4A70]'
                  }`}
                >
                  {occ.descripcion}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Botones de Acción */}
        {!isCancelled && (
          <div
            className={`pt-2.5 border-t flex flex-col gap-2 ${
              isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
            }`}
          >
            {isFinished ? (
              <div className="space-y-2">
                {(occ.has_recording || occ.has_slides) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {occ.has_recording && (
                      <button
                        type="button"
                        onClick={() => handleOpenRecording(occ)}
                        className="flex-1 min-w-[130px] inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer transition-colors"
                      >
                        <PlayCircle className="w-4 h-4 shrink-0" />
                        <span>Ver grabación</span>
                      </button>
                    )}
                    {occ.has_slides && (
                      <button
                        type="button"
                        onClick={() => handleOpenSlides(occ)}
                        className={`flex-1 min-w-[120px] inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                          isDark
                            ? 'bg-[#24B0BA]/20 border-[#24B0BA]/40 text-[#24B0BA] hover:bg-[#24B0BA]/30'
                            : 'bg-[#014ba0]/10 border-[#014ba0]/25 text-[#014ba0] hover:bg-[#014ba0]/15'
                        }`}
                      >
                        <Presentation className="w-4 h-4 shrink-0" />
                        <span>Diapositivas</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedOccurrence(occ)}
                      className={`px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                        isDark
                          ? 'border-white/15 bg-white/5 hover:bg-white/10 text-blue-100'
                          : 'border-[#2E4A70]/20 bg-white hover:bg-[#F0F2F2] text-[#1a2639]'
                      }`}
                    >
                      Detalles
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-bold ${
                        isDark ? 'text-slate-300' : 'text-[#2E4A70]'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      <span>Clase pasada · Grabación pendiente</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedOccurrence(occ)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${
                        isDark
                          ? 'border-white/15 bg-white/5 hover:bg-white/10 text-blue-100'
                          : 'border-[#2E4A70]/20 bg-white hover:bg-[#F0F2F2] text-[#1a2639]'
                      }`}
                    >
                      Ver detalles
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <a
                    href={occ.enlace}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-xl text-xs sm:text-sm font-bold text-white transition-colors ${
                      isLiveNow
                        ? 'bg-emerald-600 hover:bg-emerald-700 shadow-sm'
                        : 'bg-[#014ba0] hover:bg-[#013b80]'
                    }`}
                  >
                    <Video className="w-4 h-4 shrink-0" />
                    <span>{isLiveNow ? 'Unirse ahora' : 'Entrar a la clase'}</span>
                  </a>

                  {occ.has_slides && (
                    <button
                      type="button"
                      onClick={() => handleOpenSlides(occ)}
                      title="Abrir diapositivas"
                      className={`px-3 py-2.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0 ${
                        isDark
                          ? 'border-[#24B0BA]/40 bg-[#24B0BA]/15 text-[#24B0BA] hover:bg-[#24B0BA]/25'
                          : 'border-[#014ba0]/25 bg-[#014ba0]/10 text-[#014ba0] hover:bg-[#014ba0]/15'
                      }`}
                    >
                      <Presentation className="w-4 h-4" />
                      <span>Diapos</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleCopyText(`link-${occ.occurrence_id}`, occ.enlace, 'Enlace')}
                    title="Copiar enlace de clase"
                    aria-label="Copiar enlace de clase"
                    className={`p-2.5 rounded-xl border transition-colors cursor-pointer shrink-0 ${
                      isDark
                        ? 'border-white/15 hover:bg-white/10 text-blue-100'
                        : 'border-[#2E4A70]/20 hover:bg-[#F0F2F2] text-[#1a2639]'
                    }`}
                  >
                    {copiedId === `link-${occ.occurrence_id}` ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <a
                    href={buildGoogleCalendarUrl(occ)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border text-[11px] font-bold transition-colors ${
                      isDark
                        ? 'border-white/10 hover:bg-white/5 text-blue-200'
                        : 'border-[#2E4A70]/15 hover:bg-[#F0F2F2] text-[#2E4A70]'
                    }`}
                  >
                    <CalendarPlus className="w-3.5 h-3.5 shrink-0" />
                    <span>Google Cal</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDownloadIcs(occ)}
                    className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${
                      isDark
                        ? 'border-white/10 hover:bg-white/5 text-blue-200'
                        : 'border-[#2E4A70]/15 hover:bg-[#F0F2F2] text-[#2E4A70]'
                    }`}
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Apple (.ics)</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </article>
    );
  };

  // Fila horizontal de ancho completo para el modo Agenda y Clases Pasadas
  const renderAgendaRowCard = (occ, showDateBadge = false) => {
    const flags = getOccurrenceFlags(occ);
    const { isLiveNow, isCancelled, isFinished } = flags;
    const endTime = formatEndTimeHHMM(occ.hora_inicio, occ.duracion_minutos);
    const isDescOpen = Boolean(expandedDescIds[occ.occurrence_id]);

    return (
      <article
        key={`${occ.occurrence_id}__${occ.occurrence_date}`}
        className={`w-full rounded-2xl border p-4 sm:p-5 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
          isLiveNow
            ? isDark
              ? 'bg-emerald-950/35 border-emerald-500 shadow-md'
              : 'bg-emerald-50/80 border-emerald-500 shadow-md'
            : isCancelled
            ? isDark
              ? 'bg-red-950/20 border-red-800/50 opacity-80'
              : 'bg-red-50/60 border-red-200 opacity-80'
            : isFinished
            ? isDark
              ? 'bg-[#162235]/65 border-white/10 opacity-95'
              : 'bg-[#F0F2F2]/85 border-[#2E4A70]/15'
            : isDark
            ? 'bg-[#162235] border-white/10'
            : 'bg-[#FFF9F0]/60 border-[#2E4A70]/15 hover:bg-white hover:border-[#014ba0]/40 hover:shadow-xs'
        }`}
      >
        {/* Columna Hora + Estado */}
        <div className="lg:w-48 shrink-0 flex lg:flex-col items-center lg:items-start justify-between lg:justify-center gap-2">
          <div>
            {showDateBadge && (
              <p className="text-[11px] font-extrabold text-[#24B0BA] tabular-nums mb-0.5">
                {formatArchiveDateLabel(occ.occurrence_date)}
              </p>
            )}
            <span
              className={`inline-flex items-center gap-1.5 text-sm font-black tabular-nums ${
                isLiveNow
                  ? isDark
                    ? 'text-emerald-300'
                    : 'text-emerald-700'
                  : isFinished
                  ? isDark
                    ? 'text-slate-400'
                    : 'text-[#2E4A70]/70'
                  : isDark
                  ? 'text-[#24B0BA]'
                  : 'text-[#014ba0]'
              }`}
            >
              <Clock className="w-4 h-4 shrink-0" />
              <span>
                {occ.hora_inicio} – {endTime}
              </span>
            </span>
            <p
              className={`text-[11px] font-semibold mt-0.5 ${
                isDark ? 'text-blue-200/75' : 'text-[#2E4A70]'
              }`}
            >
              {occ.duracion_minutos} min · Hora Bolivia
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {renderStatusPill(flags)}
            {occ.is_recurring && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isDark ? 'bg-white/10 text-blue-200' : 'bg-[#F0F2F2] text-[#2E4A70]'
                }`}
              >
                <Repeat className="w-3 h-3" />
                <span>Semanal</span>
              </span>
            )}
          </div>
        </div>

        {/* Columna Central: Curso, Especialidad, Título, Ponente y Temario */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-lg border ${
                occ.course_title
                  ? isDark
                    ? 'bg-[#CF8A40]/25 text-amber-200 border-[#CF8A40]/40'
                    : 'bg-[#CF8A40]/15 text-[#8a4f14] border-[#CF8A40]/30'
                  : isDark
                  ? 'bg-[#24B0BA]/20 text-[#24B0BA] border-[#24B0BA]/35'
                  : 'bg-[#24B0BA]/15 text-[#0b6168] border-[#24B0BA]/30'
              }`}
            >
              {occ.course_title || 'Clase General'}
            </span>

            {occ.especialidad_nombre && (
              <span
                className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-lg border ${
                  isDark
                    ? 'bg-white/10 text-blue-100 border-white/15'
                    : 'bg-[#014ba0]/10 text-[#014ba0] border-[#014ba0]/20'
                }`}
              >
                {occ.especialidad_nombre}
              </span>
            )}

            {occ.id_reunion && !isCancelled && !isFinished && (
              <button
                type="button"
                onClick={() => handleCopyText(`agenda-id-${occ.occurrence_id}`, occ.id_reunion, 'ID de reunión')}
                className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-lg border transition-colors cursor-pointer ${
                  isDark
                    ? 'bg-white/5 border-white/15 text-blue-100 hover:bg-white/10'
                    : 'bg-white border-[#2E4A70]/20 text-[#1a2639] hover:border-[#014ba0]'
                }`}
              >
                {copiedId === `agenda-id-${occ.occurrence_id}` ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3 opacity-70" />
                )}
                <span>ID: {occ.id_reunion}</span>
              </button>
            )}
          </div>

          <div>
            <h3
              className={`text-base sm:text-lg font-extrabold leading-snug break-words ${
                isCancelled ? 'line-through opacity-75' : isFinished ? 'opacity-80' : ''
              }`}
            >
              {occ.titulo}
            </h3>
            <p className={`text-xs sm:text-sm mt-0.5 flex items-center gap-1.5 font-medium ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
              <User className="w-3.5 h-3.5 shrink-0" />
              <span>{occ.expositor}</span>
            </p>
          </div>

          {occ.motivo && (
            <p className={`text-xs font-medium italic ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
              Nota: {occ.motivo}
            </p>
          )}

          {occ.descripcion && (
            <div>
              <button
                type="button"
                onClick={() => toggleDescription(occ.occurrence_id)}
                className={`inline-flex items-center gap-1 text-xs font-bold cursor-pointer ${
                  isDark ? 'text-[#24B0BA] hover:underline' : 'text-[#014ba0] hover:underline'
                }`}
              >
                <Info className="w-3.5 h-3.5" />
                <span>{isDescOpen ? 'Ocultar temario' : 'Ver temario / indicaciones'}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isDescOpen ? 'rotate-180' : ''}`} />
              </button>
              {isDescOpen && (
                <p
                  className={`mt-2 p-3 rounded-xl text-xs leading-relaxed whitespace-pre-wrap border ${
                    isDark
                      ? 'bg-[#1e293b] border-white/10 text-blue-100'
                      : 'bg-white border-[#2E4A70]/15 text-[#2E4A70]'
                  }`}
                >
                  {occ.descripcion}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Columna Derecha: Acciones */}
        {!isCancelled && (
          <div className="lg:w-60 shrink-0 flex flex-col gap-2">
            {isFinished ? (
              <div className="flex flex-wrap lg:flex-col items-stretch gap-2">
                {occ.has_recording && (
                  <button
                    type="button"
                    onClick={() => handleOpenRecording(occ)}
                    className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer transition-colors"
                  >
                    <PlayCircle className="w-4 h-4 shrink-0" />
                    <span>Ver grabación</span>
                  </button>
                )}
                {occ.has_slides && (
                  <button
                    type="button"
                    onClick={() => handleOpenSlides(occ)}
                    className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                      isDark
                        ? 'bg-[#24B0BA]/20 border-[#24B0BA]/40 text-[#24B0BA] hover:bg-[#24B0BA]/30'
                        : 'bg-[#014ba0]/10 border-[#014ba0]/25 text-[#014ba0] hover:bg-[#014ba0]/15'
                    }`}
                  >
                    <Presentation className="w-4 h-4 shrink-0" />
                    <span>Diapositivas</span>
                  </button>
                )}
                {!occ.has_resources && (
                  <div
                    className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-bold ${
                      isDark
                        ? 'border-white/10 bg-white/5 text-slate-300'
                        : 'border-[#2E4A70]/15 bg-white text-[#2E4A70]'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span>Grabación pendiente</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedOccurrence(occ)}
                  className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                    isDark
                      ? 'border-white/15 hover:bg-white/10 text-blue-100'
                      : 'border-[#2E4A70]/20 bg-white hover:bg-[#F0F2F2] text-[#1a2639]'
                  }`}
                >
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  <span>Ver detalles</span>
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <a
                    href={occ.enlace}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-xl text-xs sm:text-sm font-bold text-white transition-colors ${
                      isLiveNow
                        ? 'bg-emerald-600 hover:bg-emerald-700 shadow-sm'
                        : 'bg-[#014ba0] hover:bg-[#013b80]'
                    }`}
                  >
                    <Video className="w-4 h-4 shrink-0" />
                    <span>{isLiveNow ? 'Unirse ahora' : 'Entrar'}</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => handleCopyText(`agenda-link-${occ.occurrence_id}`, occ.enlace, 'Enlace')}
                    title="Copiar enlace de clase"
                    aria-label="Copiar enlace de clase"
                    className={`p-2.5 rounded-xl border transition-colors cursor-pointer shrink-0 ${
                      isDark
                        ? 'border-white/15 hover:bg-white/10 text-blue-100'
                        : 'border-[#2E4A70]/20 bg-white hover:bg-[#F0F2F2] text-[#1a2639]'
                    }`}
                  >
                    {copiedId === `agenda-link-${occ.occurrence_id}` ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {occ.has_slides && (
                  <button
                    type="button"
                    onClick={() => handleOpenSlides(occ)}
                    className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                      isDark
                        ? 'bg-[#24B0BA]/20 border-[#24B0BA]/40 text-[#24B0BA] hover:bg-[#24B0BA]/30'
                        : 'bg-[#014ba0]/10 border-[#014ba0]/25 text-[#014ba0] hover:bg-[#014ba0]/15'
                    }`}
                  >
                    <Presentation className="w-3.5 h-3.5 shrink-0" />
                    <span>Diapositivas</span>
                  </button>
                )}

                <div className="grid grid-cols-2 gap-1.5">
                  <a
                    href={buildGoogleCalendarUrl(occ)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border text-[11px] font-bold transition-colors ${
                      isDark
                        ? 'border-white/10 hover:bg-white/5 text-blue-200'
                        : 'border-[#2E4A70]/15 bg-white hover:bg-[#F0F2F2] text-[#2E4A70]'
                    }`}
                  >
                    <CalendarPlus className="w-3.5 h-3.5 shrink-0" />
                    <span>Google</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDownloadIcs(occ)}
                    className={`inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${
                      isDark
                        ? 'border-white/10 hover:bg-white/5 text-blue-200'
                        : 'border-[#2E4A70]/15 bg-white hover:bg-[#F0F2F2] text-[#2E4A70]'
                    }`}
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>iOS (.ics)</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </article>
    );
  };

  const renderNextWeekHeader = () => (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-2xl border ${
        isDark
          ? 'bg-[#162235] border-[#24B0BA]/30 text-white'
          : 'bg-[#24B0BA]/10 border-[#24B0BA]/30 text-[#1a2639]'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
            isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#014ba0] text-white'
          }`}
        >
          Próxima Semana
        </span>
        <span className="text-xs sm:text-sm font-black tabular-nums">
          {nextWeekDays[0]?.displayDate} – {nextWeekDays[6]?.displayDate}
        </span>
        <span
          className={`text-xs font-bold ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}
        >
          · {filteredNextWeekOccurrences.length}{' '}
          {filteredNextWeekOccurrences.length === 1 ? 'clase programada' : 'clases programadas'}
        </span>
      </div>

      <span className={`text-[11px] font-semibold ${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]/80'}`}>
        Toca una clase para ver detalles o entrar
      </span>
    </div>
  );

  const renderCalendarWeekGrid = (daysList, occList, isPreview = false) => (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 lg:gap-3">
      {daysList.map((day) => {
        const isToday = day.date === todayStr;
        const isPastDay = day.date < todayStr;
        const dayOccs = occList.filter((o) => o.occurrence_date === day.date);
        return (
          <div
            key={day.date}
            className={`min-w-0 rounded-2xl border p-2.5 flex flex-col gap-2 ${
              isPreview ? 'min-h-[138px]' : 'min-h-[168px]'
            } ${cardSurface} ${
              isToday
                ? isDark
                  ? 'ring-2 ring-[#24B0BA]'
                  : 'ring-2 ring-[#014ba0]'
                : isPastDay
                ? 'opacity-75'
                : ''
            }`}
          >
            <div
              className={`flex items-center justify-between border-b pb-1.5 ${
                isDark ? 'border-white/10' : 'border-[#2E4A70]/12'
              }`}
            >
              <div>
                <p
                  className={`text-[11px] font-extrabold uppercase ${
                    isToday ? '' : isPastDay ? 'opacity-50' : 'opacity-70'
                  }`}
                  style={isToday ? { color: isDark ? '#24B0BA' : '#014ba0' } : undefined}
                >
                  {day.shortLabel}
                </p>
                <p className={`text-sm font-black tabular-nums ${isPastDay ? 'opacity-70' : ''}`}>
                  {day.displayDate}
                </p>
              </div>
              {isToday ? (
                <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-[#014ba0] text-white">
                  HOY
                </span>
              ) : isPastDay ? (
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                    isDark ? 'bg-white/10 text-slate-300' : 'bg-[#F0F2F2] text-[#2E4A70]/80'
                  }`}
                >
                  Pasado
                </span>
              ) : dayOccs.length > 0 ? (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                    isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
                  }`}
                >
                  {dayOccs.length}
                </span>
              ) : null}
            </div>

            {dayOccs.length === 0 ? (
              <p className="text-[11px] opacity-40 text-center my-auto py-4">
                {isPastDay ? 'Día pasado' : 'Sin clases'}
              </p>
            ) : (
              <div className="space-y-2">
                {dayOccs.map((occ) => renderCompactCalendarCard(occ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderAgendaDayGroups = (dayGroups) => (
    <div className="space-y-4">
      {dayGroups.map(({ day, items }) => {
        const isToday = day.date === todayStr;
        const isPastDay = day.date < todayStr;
        return (
          <div
            key={day.date}
            className={`rounded-3xl border p-5 shadow-xs ${cardSurface} ${
              isToday
                ? isDark
                  ? 'ring-2 ring-[#24B0BA]'
                  : 'ring-2 ring-[#014ba0]'
                : isPastDay
                ? 'opacity-80'
                : ''
            }`}
          >
            <div
              className={`flex items-center justify-between pb-3 mb-4 border-b ${
                isDark ? 'border-white/10' : 'border-[#2E4A70]/12'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-sm sm:text-base font-black ${
                    isToday
                      ? isDark
                        ? 'text-[#24B0BA]'
                        : 'text-[#014ba0]'
                      : isPastDay
                      ? 'opacity-70'
                      : ''
                  }`}
                >
                  {getFriendlyDayLabel(day)}
                </span>
                {isToday ? (
                  <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-[#014ba0] text-white">
                    HOY
                  </span>
                ) : isPastDay ? (
                  <span
                    className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                      isDark ? 'bg-white/10 text-slate-300' : 'bg-[#F0F2F2] text-[#2E4A70]'
                    }`}
                  >
                    Día pasado
                  </span>
                ) : (
                  <span
                    className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${
                      isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
                    }`}
                  >
                    Próximo
                  </span>
                )}
              </div>
              <span
                className={`text-xs font-bold ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}
              >
                {items.length} {items.length === 1 ? 'clase' : 'clases'}
              </span>
            </div>

            <div className="space-y-3 w-full">
              {items.map((occ) => renderAgendaRowCard(occ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderExploreMoreWeeksStrip = () => (
    <div
      className={`mt-4 px-4 py-2.5 rounded-2xl border flex flex-wrap items-center justify-between gap-2 text-xs ${
        isDark
          ? 'bg-[#162235]/80 border-white/10 text-blue-200'
          : 'bg-white/80 border-[#2E4A70]/12 text-[#2E4A70]'
      }`}
    >
      <div className="flex items-center gap-2">
        <Calendar className="w-3.5 h-3.5 opacity-70 shrink-0" />
        <span>
          Sin clases programadas para la siguiente semana ({nextWeekDays[0]?.displayDate} –{' '}
          {nextWeekDays[6]?.displayDate}).
        </span>
      </div>
      <div className="flex items-center gap-2">
        {(selectedCourseId || selectedEspId || searchTerm) && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="font-bold underline cursor-pointer"
          >
            Limpiar filtros
          </button>
        )}
        <button
          type="button"
          onClick={() => setWeekStart(nextWeekStart)}
          className={`inline-flex items-center gap-1 font-bold px-3 py-1 rounded-lg border cursor-pointer transition-colors ${
            isDark
              ? 'border-white/15 hover:bg-white/10 text-white'
              : 'border-[#2E4A70]/20 hover:bg-[#F0F2F2] text-[#014ba0]'
          }`}
        >
          <span>Siguiente semana</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <section
      className={`min-h-[calc(100vh-4rem)] transition-colors ${
        isDark ? 'bg-[#1a2639] text-[#FFF9F0]' : 'bg-[#FFF9F0] text-[#1a2639]'
      }`}
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4">
        {/* Encabezado limpio */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2.5">
              <Calendar className={`w-6 h-6 sm:w-7 sm:h-7 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
              <span>Clases en Vivo</span>
            </h1>
            <p className={`text-xs sm:text-sm font-medium mt-0.5 ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
              Calendario semanal en Hora Bolivia (UTC-4). Toca cualquier clase para ver temario y acceso.
            </p>
          </div>

          <div
            className="hidden md:inline-flex rounded-xl p-1 border self-start sm:self-auto"
            style={{
              borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(46,74,112,0.15)',
              backgroundColor: isDark ? '#1e293b' : '#ffffff',
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                viewMode === 'calendar'
                  ? 'bg-[#014ba0] text-white'
                  : isDark
                  ? 'text-blue-200 hover:text-white'
                  : 'text-[#2E4A70] hover:text-[#014ba0]'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Calendario Semanal</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('agenda')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                viewMode === 'agenda'
                  ? 'bg-[#014ba0] text-white'
                  : isDark
                  ? 'text-blue-200 hover:text-white'
                  : 'text-[#2E4A70] hover:text-[#014ba0]'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" />
              <span>Agenda</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('past')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                viewMode === 'past'
                  ? 'bg-[#014ba0] text-white'
                  : isDark
                  ? 'text-blue-200 hover:text-white'
                  : 'text-[#2E4A70] hover:text-[#014ba0]'
              }`}
            >
              <PlayCircle className="w-3.5 h-3.5" />
              <span>Clases pasadas ({filteredPastArchive.length})</span>
            </button>
          </div>
        </header>

        {/* Barra compacta contextual: En Vivo Ahora o Próxima Clase */}
        {spotlightOccurrence && (
          <div
            className={`rounded-2xl px-3.5 py-3 sm:px-5 sm:py-3.5 border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              spotlightOccurrence.isLive
                ? isDark
                  ? 'bg-emerald-950/45 border-emerald-500 text-white'
                  : 'bg-emerald-50 border-emerald-500 text-[#1a2639]'
                : isDark
                ? 'bg-[#1e293b] border-[#24B0BA]/40 text-white'
                : 'bg-white border-[#014ba0]/25 text-[#1a2639]'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                    spotlightOccurrence.isLive
                      ? 'bg-emerald-600 text-white'
                      : isDark
                      ? 'bg-[#24B0BA]/20 text-[#24B0BA]'
                      : 'bg-[#014ba0]/10 text-[#014ba0]'
                  }`}
                >
                  {spotlightOccurrence.isLive && <Radio className="w-3 h-3" />}
                  <span>
                    {spotlightOccurrence.isLive ? 'En vivo ahora' : 'Próxima clase'}
                  </span>
                </span>
                <span
                  className={`text-xs font-bold ${
                    spotlightOccurrence.isLive
                      ? isDark
                        ? 'text-emerald-300'
                        : 'text-emerald-700'
                      : isDark
                      ? 'text-blue-200'
                      : 'text-[#2E4A70]'
                  }`}
                >
                  {spotlightOccurrence.isLive
                    ? `${spotlightOccurrence.occ.hora_inicio} – ${formatEndTimeHHMM(
                        spotlightOccurrence.occ.hora_inicio,
                        spotlightOccurrence.occ.duracion_minutos
                      )}`
                    : `${formatCountdownEs(spotlightOccurrence.occ, tickNow)} · ${
                        spotlightOccurrence.occ.occurrence_date &&
                        spotlightOccurrence.occ.occurrence_date !== todayStr
                          ? `${spotlightOccurrence.occ.occurrence_date.slice(8, 10)}/${spotlightOccurrence.occ.occurrence_date.slice(5, 7)} · `
                          : ''
                      }${spotlightOccurrence.occ.hora_inicio}`}
                </span>
                <span
                  className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${
                    spotlightOccurrence.occ.course_title
                      ? isDark
                        ? 'bg-[#CF8A40]/25 text-amber-200 border-[#CF8A40]/40'
                        : 'bg-[#CF8A40]/15 text-[#8a4f14] border-[#CF8A40]/30'
                      : isDark
                      ? 'bg-[#24B0BA]/20 text-[#24B0BA] border-[#24B0BA]/30'
                      : 'bg-[#24B0BA]/15 text-[#0b6168] border-[#24B0BA]/30'
                  }`}
                >
                  {spotlightOccurrence.occ.course_title || 'Clase General'}
                </span>
                {spotlightOccurrence.occ.especialidad_nombre && (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                      isDark
                        ? 'bg-white/10 text-blue-100 border-white/15'
                        : 'bg-[#014ba0]/10 text-[#014ba0] border-[#014ba0]/20'
                    }`}
                  >
                    {spotlightOccurrence.occ.especialidad_nombre}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <h2 className="text-sm sm:text-base font-black tracking-tight truncate max-w-full">
                  {spotlightOccurrence.occ.titulo}
                </h2>
                <span className={`text-xs font-medium ${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]'}`}>
                  · {spotlightOccurrence.occ.expositor}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <a
                href={spotlightOccurrence.occ.enlace}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white transition-colors ${
                  spotlightOccurrence.isLive
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-[#014ba0] hover:bg-[#013b80]'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>{spotlightOccurrence.isLive ? 'Entrar ahora' : 'Entrar'}</span>
              </a>
              <button
                type="button"
                onClick={() => setSelectedOccurrence(spotlightOccurrence.occ)}
                className={`px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                  isDark
                    ? 'border-white/15 bg-white/5 hover:bg-white/10 text-white'
                    : 'border-[#2E4A70]/20 bg-[#FFF9F0] hover:bg-[#F0F2F2] text-[#1a2639]'
                }`}
              >
                Detalles
              </button>
            </div>
          </div>
        )}

        {/* Filtros + Navegación Semanal */}
        <div className={`p-3.5 sm:p-4 rounded-2xl border shadow-xs space-y-3 ${cardSurface}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="relative">
              <Search
                className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                  isDark ? 'text-blue-200/70' : 'text-[#2E4A70]/70'
                }`}
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar clase o docente..."
                aria-label="Buscar clase o docente"
                className={`w-full pl-9 pr-8 py-2.5 rounded-xl border text-xs sm:text-sm outline-none ${inputSurface}`}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Limpiar búsqueda"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              aria-label="Filtrar por curso"
              className={`w-full px-3 py-2.5 rounded-xl border text-xs sm:text-sm outline-none ${inputSurface}`}
            >
              <option value="">Todos los Cursos (y Generales)</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>

            <select
              value={selectedEspId}
              onChange={(e) => setSelectedEspId(e.target.value)}
              aria-label="Filtrar por especialidad"
              className={`w-full px-3 py-2.5 rounded-xl border text-xs sm:text-sm outline-none ${inputSurface}`}
            >
              <option value="">Todas las Especialidades</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>

            {/* Control de Semana */}
            <div className="flex items-center justify-between gap-1.5">
              <button
                type="button"
                onClick={() => setWeekStart((w) => addDaysToDateStr(w, -7))}
                aria-label="Semana anterior"
                title="Semana anterior"
                className={`p-2.5 rounded-xl border cursor-pointer shrink-0 transition-colors ${
                  isDark
                    ? 'border-white/15 hover:bg-white/10'
                    : 'border-[#2E4A70]/20 hover:bg-[#F0F2F2]'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setWeekStart(currentWeekMonday);
                  setSelectedMobileDay(todayStr);
                }}
                title={
                  weekStart === currentWeekMonday
                    ? 'Semana actual'
                    : 'Volver a la semana actual'
                }
                className={`flex-1 min-w-0 py-2 px-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  weekStart === currentWeekMonday
                    ? 'bg-[#014ba0] text-white'
                    : isDark
                    ? 'bg-[#24B0BA]/20 text-[#24B0BA] border border-[#24B0BA]/40 hover:bg-[#24B0BA]/30'
                    : 'bg-[#014ba0]/10 text-[#014ba0] border border-[#014ba0]/25 hover:bg-[#014ba0]/15'
                }`}
              >
                <span className="truncate tabular-nums">
                  {weekStart === currentWeekMonday ? 'Esta semana · ' : ''}
                  {weekDays[0]?.displayDate} – {weekDays[6]?.displayDate}
                </span>
                {weekStart !== currentWeekMonday && (
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-black uppercase ${
                      isDark ? 'bg-[#24B0BA] text-[#1a2639]' : 'bg-[#014ba0] text-white'
                    }`}
                  >
                    Hoy
                  </span>
                )}
                {isFetchingWeek && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 opacity-80" />}
              </button>

              <button
                type="button"
                onClick={() => setWeekStart((w) => addDaysToDateStr(w, 7))}
                aria-label="Semana siguiente"
                title="Semana siguiente"
                className={`p-2.5 rounded-xl border cursor-pointer shrink-0 transition-colors ${
                  isDark
                    ? 'border-white/15 hover:bg-white/10'
                    : 'border-[#2E4A70]/20 hover:bg-[#F0F2F2]'
                }`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {(filteredOccurrences.length > 0 || filteredNextWeekOccurrences.length > 0) && (
            <div
              className={`pt-2.5 border-t flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold ${
                isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
              }`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full ${
                    weekSummary.pending > 0
                      ? isDark
                        ? 'bg-[#24B0BA]/20 text-[#24B0BA]'
                        : 'bg-[#014ba0]/10 text-[#014ba0]'
                      : isDark
                      ? 'bg-white/10 text-blue-200/75'
                      : 'bg-[#F0F2F2] text-[#2E4A70]'
                  }`}
                >
                  <span>
                    {weekSummary.pending}{' '}
                    {weekSummary.pending === 1 ? 'pendiente esta semana' : 'pendientes esta semana'}
                  </span>
                </span>
                {weekSummary.past > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full ${
                      isDark ? 'bg-white/10 text-slate-300' : 'bg-[#F0F2F2] text-[#2E4A70]/80'
                    }`}
                  >
                    <Check className="w-3 h-3" />
                    <span>
                      {weekSummary.past} {weekSummary.past === 1 ? 'clase pasada' : 'clases pasadas'}
                    </span>
                  </span>
                )}
                {filteredNextWeekOccurrences.length > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full ${
                      isDark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    <span>
                      +{filteredNextWeekOccurrences.length} en la próxima semana
                    </span>
                  </span>
                )}
              </div>
              <span className={`text-[11px] font-medium ${isDark ? 'text-blue-200/65' : 'text-[#2E4A70]/75'}`}>
                Las clases de días anteriores se marcan como pasadas automáticamente.
              </span>
            </div>
          )}
        </div>

        {/* Contenido de Semanas (mantiene montaje suave sin recargar toda la pantalla) */}
        <div
          className={`transition-opacity duration-150 ${
            isFetchingWeek ? 'opacity-70' : 'opacity-100'
          }`}
        >
          {/* Vista Móvil (< md) */}
          <div className="md:hidden space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                className="inline-flex flex-wrap rounded-xl p-0.5 border"
                style={{
                  borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(46,74,112,0.15)',
                  backgroundColor: isDark ? '#1e293b' : '#ffffff',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (viewMode === 'past') setViewMode('calendar');
                    setMobileShowAllWeek(false);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    viewMode !== 'past' && !mobileShowAllWeek
                      ? 'bg-[#014ba0] text-white'
                      : isDark
                      ? 'text-blue-200'
                      : 'text-[#2E4A70]'
                  }`}
                >
                  Por día
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (viewMode === 'past') setViewMode('calendar');
                    setMobileShowAllWeek(true);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    viewMode !== 'past' && mobileShowAllWeek
                      ? 'bg-[#014ba0] text-white'
                      : isDark
                      ? 'text-blue-200'
                      : 'text-[#2E4A70]'
                  }`}
                >
                  Semana ({filteredOccurrences.length})
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('past')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    viewMode === 'past'
                      ? 'bg-[#014ba0] text-white'
                      : isDark
                      ? 'text-blue-200'
                      : 'text-[#2E4A70]'
                  }`}
                >
                  Pasadas ({filteredPastArchive.length})
                </button>
              </div>

              {(selectedCourseId || selectedEspId || searchTerm) && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className={`text-xs font-bold underline cursor-pointer ${
                    isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                  }`}
                >
                  Limpiar filtros
                </button>
              )}
            </div>

            {viewMode === 'past' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPastOnlyRecorded(false)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer border ${
                      !pastOnlyRecorded
                        ? 'bg-[#014ba0] border-[#014ba0] text-white'
                        : isDark
                        ? 'bg-[#1e293b] border-white/10 text-blue-200'
                        : 'bg-white border-[#2E4A70]/15 text-[#2E4A70]'
                    }`}
                  >
                    Todas ({filteredPastArchive.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPastOnlyRecorded(true)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer border ${
                      pastOnlyRecorded
                        ? 'bg-[#014ba0] border-[#014ba0] text-white'
                        : isDark
                        ? 'bg-[#1e293b] border-white/10 text-blue-200'
                        : 'bg-white border-[#2E4A70]/15 text-[#2E4A70]'
                    }`}
                  >
                    Con grabación / diapos ({pastArchiveWithResourcesCount})
                  </button>
                </div>

                {visiblePastArchive.length === 0 ? (
                  <div className={`p-8 rounded-2xl border text-center space-y-2 ${cardSurface}`}>
                    <p className="text-sm font-extrabold">No hay clases pasadas en esta selección</p>
                    <p className={`text-xs ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                      Cuando finalice una sesión en vivo o se agregue su grabación y diapositivas, aparecerá aquí.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visiblePastArchive.map((occ) => renderClassCard(occ, false, true))}
                  </div>
                )}
              </div>
            ) : !mobileShowAllWeek ? (
              <>
                <div className="grid grid-cols-7 gap-1.5">
                  {weekDays.map((day) => {
                    const isSelected = day.date === selectedMobileDay;
                    const isToday = day.date === todayStr;
                    const isPastDay = day.date < todayStr;
                    const count = filteredOccurrences.filter(
                      (o) => o.occurrence_date === day.date
                    ).length;
                    return (
                      <button
                        key={day.date}
                        type="button"
                        onClick={() => setSelectedMobileDay(day.date)}
                        className={`py-2 px-1 rounded-xl border text-center transition-colors cursor-pointer flex flex-col items-center gap-0.5 ${
                          isSelected
                            ? 'bg-[#014ba0] text-white border-[#014ba0] shadow-sm'
                            : isToday
                            ? isDark
                              ? 'bg-[#1e293b] border-[#24B0BA] text-[#24B0BA]'
                              : 'bg-[#24B0BA]/10 border-[#24B0BA] text-[#014ba0]'
                            : isPastDay
                            ? `${cardSurface} opacity-65`
                            : cardSurface
                        }`}
                      >
                        <span className="text-[10px] font-bold uppercase">{day.shortLabel}</span>
                        <span className="text-xs font-extrabold">{day.displayDate.split('/')[0]}</span>
                        <span
                          className={`text-[9px] font-black px-1.5 rounded-full min-w-[16px] ${
                            count > 0
                              ? isSelected
                                ? 'bg-white text-[#014ba0]'
                                : isPastDay
                                ? isDark
                                  ? 'bg-white/10 text-slate-300'
                                  : 'bg-[#2E4A70]/15 text-[#2E4A70]'
                                : isDark
                                ? 'bg-[#24B0BA]/25 text-[#24B0BA]'
                                : 'bg-[#014ba0]/12 text-[#014ba0]'
                              : 'opacity-25'
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-3">
                  {(() => {
                    const dayOccs = filteredOccurrences.filter(
                      (o) => o.occurrence_date === selectedMobileDay
                    );
                    const isSelectedPast = selectedMobileDay < todayStr;
                    if (dayOccs.length === 0) {
                      return (
                        <div className={`p-7 rounded-2xl border text-center space-y-3 ${cardSurface}`}>
                          <p className={`text-sm font-semibold ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                            {isSelectedPast
                              ? 'Este día ya pasó y no tuvo clases programadas.'
                              : 'No hay clases programadas para este día.'}
                          </p>
                          {nextMobilePendingDay ? (
                            <button
                              type="button"
                              onClick={() => setSelectedMobileDay(nextMobilePendingDay.day.date)}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#014ba0] text-white text-xs font-bold cursor-pointer"
                            >
                              <span>
                                Ver pendientes ({nextMobilePendingDay.day.label}{' '}
                                {nextMobilePendingDay.day.displayDate})
                              </span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          ) : nextMobileDayWithClass ? (
                            <button
                              type="button"
                              onClick={() => setSelectedMobileDay(nextMobileDayWithClass.day.date)}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#014ba0] text-white text-xs font-bold cursor-pointer"
                            >
                              <span>
                                Ir al {nextMobileDayWithClass.day.label}{' '}
                                {nextMobileDayWithClass.day.displayDate} (
                                {nextMobileDayWithClass.items.length})
                              </span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setWeekStart(nextWeekStart)}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#014ba0] text-white text-xs font-bold cursor-pointer"
                            >
                              <span>
                                {filteredNextWeekOccurrences.length > 0
                                  ? `Ver siguiente semana (${filteredNextWeekOccurrences.length})`
                                  : 'Ver próxima semana'}
                              </span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    }
                    return (
                      <>
                        {isSelectedPast && (
                          <div
                            className={`px-3.5 py-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${
                              isDark
                                ? 'bg-[#162235] border-white/10 text-slate-300'
                                : 'bg-[#F0F2F2] border-[#2E4A70]/15 text-[#2E4A70]'
                            }`}
                          >
                            <span className="font-semibold">
                              Este día ya pasó · clases finalizadas.
                            </span>
                            {nextMobilePendingDay && (
                              <button
                                type="button"
                                onClick={() => setSelectedMobileDay(nextMobilePendingDay.day.date)}
                                className={`font-extrabold underline cursor-pointer ${
                                  isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                                }`}
                              >
                                Ir a pendientes ({nextMobilePendingDay.day.shortLabel}{' '}
                                {nextMobilePendingDay.day.displayDate})
                              </button>
                            )}
                          </div>
                        )}
                        {dayOccs.map((occ) => renderClassCard(occ, false))}
                      </>
                    );
                  })()}
                </div>

                {/* Vista previa de la siguiente semana en móvil cuando hay clases */}
                {filteredNextWeekOccurrences.length > 0 && (
                  <div className={`rounded-2xl border p-3.5 space-y-2.5 ${cardSurface}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p
                          className={`text-[10px] font-extrabold uppercase tracking-wider ${
                            isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                          }`}
                        >
                          Próxima Semana
                        </p>
                        <p className="text-xs font-extrabold tabular-nums">
                          {nextWeekDays[0]?.displayDate} – {nextWeekDays[6]?.displayDate} (
                          {filteredNextWeekOccurrences.length}{' '}
                          {filteredNextWeekOccurrences.length === 1 ? 'clase' : 'clases'})
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {filteredNextWeekOccurrences.map((occ) => (
                        <button
                          key={occ.occurrence_id}
                          type="button"
                          onClick={() => setSelectedOccurrence(occ)}
                          className={`w-full text-left px-3 py-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                            isDark
                              ? 'border-white/10 bg-[#162235] hover:bg-white/5'
                              : 'border-[#2E4A70]/12 bg-[#FFF9F0] hover:bg-[#F0F2F2]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-extrabold truncate">{occ.titulo}</p>
                            <p
                              className={`text-[11px] font-semibold truncate ${
                                isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                              }`}
                            >
                              {occ.occurrence_date.slice(8, 10)}/{occ.occurrence_date.slice(5, 7)} ·{' '}
                              {occ.hora_inicio} · {occ.course_title || 'Clase General'}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 opacity-50 shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : daysWithClasses.length === 0 && nextWeekDaysWithClasses.length === 0 ? (
              <div className={`p-8 rounded-2xl border text-center space-y-3 ${cardSurface}`}>
                <p className={`text-sm font-semibold ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                  No se encontraron clases para esta semana ni la siguiente con los filtros actuales.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWeekStart((w) => addDaysToDateStr(w, -7))}
                    className={`inline-flex items-center gap-1 px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                      isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/20 hover:bg-[#F0F2F2]'
                    }`}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Semana anterior</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeekStart(nextWeekStart)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#014ba0] text-white text-xs font-bold cursor-pointer"
                  >
                    <span>Siguiente semana</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {daysWithClasses.length === 0 ? (
                  <div
                    className={`px-3.5 py-2.5 rounded-xl border text-xs font-semibold ${
                      isDark
                        ? 'bg-[#162235] border-white/10 text-blue-200'
                        : 'bg-white border-[#2E4A70]/15 text-[#2E4A70]'
                    }`}
                  >
                    Sin clases en la semana del {weekDays[0]?.displayDate} – {weekDays[6]?.displayDate}.
                    Te mostramos las programadas para la siguiente semana:
                  </div>
                ) : (
                  daysWithClasses.map(({ day, items }) => {
                    const isPastDay = day.date < todayStr;
                    const isToday = day.date === todayStr;
                    return (
                      <div key={day.date} className="space-y-2.5">
                        <h3
                          className={`text-xs font-extrabold uppercase tracking-wider px-1 flex items-center gap-2 ${
                            isToday
                              ? isDark
                                ? 'text-[#24B0BA]'
                                : 'text-[#014ba0]'
                              : isPastDay
                              ? isDark
                                ? 'text-slate-400'
                                : 'text-[#2E4A70]/70'
                              : isDark
                              ? 'text-blue-200'
                              : 'text-[#2E4A70]'
                          }`}
                        >
                          <span>
                            {getFriendlyDayLabel(day)} ({items.length})
                          </span>
                          {isPastDay && (
                            <span
                              className={`text-[9px] px-2 py-0.5 rounded-full ${
                                isDark ? 'bg-white/10 text-slate-300' : 'bg-[#F0F2F2] text-[#2E4A70]'
                              }`}
                            >
                              Pasado
                            </span>
                          )}
                        </h3>
                        <div className="space-y-3">{items.map((occ) => renderClassCard(occ, false))}</div>
                      </div>
                    );
                  })
                )}

                {nextWeekDaysWithClasses.length > 0 && (
                  <div className="space-y-4 pt-1">
                    {renderNextWeekHeader()}
                    {nextWeekDaysWithClasses.map(({ day, items }) => (
                      <div key={day.date} className="space-y-2.5">
                        <h3
                          className={`text-xs font-extrabold uppercase tracking-wider px-1 ${
                            isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                          }`}
                        >
                          {getFriendlyDayLabel(day)} ({items.length})
                        </h3>
                        <div className="space-y-3">{items.map((occ) => renderClassCard(occ, false))}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Vista Tablet y Escritorio (>= md): Calendario Semanal, Agenda o Clases Pasadas */}
          <div className="hidden md:block">
            {viewMode === 'past' ? (
              <div className="space-y-4">
                <div
                  className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${cardSurface}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPastOnlyRecorded(false)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer border transition-colors ${
                        !pastOnlyRecorded
                          ? 'bg-[#014ba0] border-[#014ba0] text-white'
                          : isDark
                          ? 'bg-[#162235] border-white/10 text-blue-200 hover:bg-white/10'
                          : 'bg-[#F0F2F2] border-[#2E4A70]/15 text-[#2E4A70]'
                      }`}
                    >
                      Todas las pasadas ({filteredPastArchive.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPastOnlyRecorded(true)}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer border transition-colors ${
                        pastOnlyRecorded
                          ? 'bg-[#014ba0] border-[#014ba0] text-white'
                          : isDark
                          ? 'bg-[#162235] border-white/10 text-blue-200 hover:bg-white/10'
                          : 'bg-[#F0F2F2] border-[#2E4A70]/15 text-[#2E4A70]'
                      }`}
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>Con grabación o diapositivas ({pastArchiveWithResourcesCount})</span>
                    </button>
                  </div>
                  <p className={`text-xs font-medium ${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]/85'}`}>
                    Sesiones ya dictadas ordenadas de la más reciente a la más antigua.
                  </p>
                </div>

                {visiblePastArchive.length === 0 ? (
                  <div className={`p-10 rounded-3xl border text-center space-y-3 ${cardSurface}`}>
                    <PlayCircle
                      className={`w-12 h-12 mx-auto opacity-45 ${
                        isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                      }`}
                    />
                    <p className="text-lg font-extrabold">No hay clases pasadas para mostrar</p>
                    <p className={`text-sm ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                      Cuando finalice una sesión en vivo o se publiquen su grabación y diapositivas, aparecerá aquí.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visiblePastArchive.map((occ) => renderAgendaRowCard(occ, true))}
                  </div>
                )}
              </div>
            ) : viewMode === 'calendar' ? (
              <div>
                {renderCalendarWeekGrid(weekDays, filteredOccurrences, false)}

                {filteredNextWeekOccurrences.length > 0 ? (
                  <div className="mt-6 space-y-3">
                    {renderNextWeekHeader()}
                    {renderCalendarWeekGrid(nextWeekDays, filteredNextWeekOccurrences, true)}
                  </div>
                ) : (
                  renderExploreMoreWeeksStrip()
                )}
              </div>
            ) : daysWithClasses.length === 0 && nextWeekDaysWithClasses.length === 0 ? (
              <div className={`p-10 rounded-3xl border text-center space-y-4 ${cardSurface}`}>
                <Calendar
                  className={`w-12 h-12 mx-auto opacity-45 ${
                    isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                  }`}
                />
                <div>
                  <p className="text-lg font-extrabold">No hay clases en estas dos semanas</p>
                  <p className={`text-sm mt-1 ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                    Prueba quitando los filtros o navega a otras semanas para ver próximas sesiones.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {(selectedCourseId || selectedEspId || searchTerm) && (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer"
                    >
                      Limpiar filtros
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setWeekStart((w) => addDaysToDateStr(w, -7))}
                    className={`inline-flex items-center gap-1 px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                      isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/20 hover:bg-[#F0F2F2]'
                    }`}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Semana anterior</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeekStart(nextWeekStart)}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-[#014ba0] text-white text-xs font-bold cursor-pointer"
                  >
                    <span>Siguiente semana</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {daysWithClasses.length === 0 ? (
                  <div
                    className={`px-4 py-3 rounded-2xl border flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-semibold ${
                      isDark
                        ? 'bg-[#162235] border-white/10 text-blue-200'
                        : 'bg-white border-[#2E4A70]/15 text-[#2E4A70]'
                    }`}
                  >
                    <span>
                      No hay clases en la semana actual ({weekDays[0]?.displayDate} –{' '}
                      {weekDays[6]?.displayDate}). Se muestran las próximas de la siguiente semana:
                    </span>
                  </div>
                ) : (
                  renderAgendaDayGroups(daysWithClasses)
                )}

                {nextWeekDaysWithClasses.length > 0 ? (
                  <div className="space-y-4">
                    {renderNextWeekHeader()}
                    {renderAgendaDayGroups(nextWeekDaysWithClasses)}
                  </div>
                ) : (
                  renderExploreMoreWeeksStrip()
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal / Bottom Sheet con detalle completo de la clase al tocar en el calendario */}
      {selectedOccurrence && (() => {
        const occ = selectedOccurrence;
        const flags = getOccurrenceFlags(occ);
        const { isLiveNow, isCancelled, isFinished } = flags;
        const endTime = formatEndTimeHHMM(occ.hora_inicio, occ.duracion_minutos);

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="class-detail-title"
            onClick={() => setSelectedOccurrence(null)}
            className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
              className={`w-full sm:max-w-lg max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border shadow-2xl p-5 sm:p-6 space-y-4 ${cardSurface}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {renderStatusPill(flags)}
                  {occ.is_recurring && (
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full ${
                        isDark ? 'bg-white/10 text-blue-200' : 'bg-[#F0F2F2] text-[#2E4A70]'
                      }`}
                    >
                      <Repeat className="w-3 h-3" />
                      <span>Clase semanal</span>
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedOccurrence(null)}
                  aria-label="Cerrar detalle"
                  className={`p-1.5 rounded-lg cursor-pointer ${
                    isDark ? 'hover:bg-white/10 text-blue-200' : 'hover:bg-black/5 text-[#2E4A70]'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div>
                <h2
                  id="class-detail-title"
                  className={`text-xl font-black leading-snug ${isCancelled ? 'line-through opacity-75' : ''}`}
                >
                  {occ.titulo}
                </h2>
                <p
                  className={`text-sm font-semibold mt-1.5 flex items-center gap-1.5 ${
                    isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                  }`}
                >
                  <User className="w-4 h-4 shrink-0" />
                  <span>{occ.expositor}</span>
                </p>
              </div>

              <div
                className={`grid grid-cols-2 gap-2.5 p-3.5 rounded-2xl border text-xs ${
                  isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0] border-[#2E4A70]/15'
                }`}
              >
                <div>
                  <span className="block opacity-65 font-bold uppercase text-[10px]">Fecha</span>
                  <span className="font-extrabold">{occ.occurrence_date}</span>
                </div>
                <div>
                  <span className="block opacity-65 font-bold uppercase text-[10px]">
                    Horario (Bolivia)
                  </span>
                  <span className="font-extrabold tabular-nums">
                    {occ.hora_inicio} – {endTime} ({occ.duracion_minutos} min)
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {occ.course_title ? (
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-lg ${
                      isDark ? 'bg-[#CF8A40]/20 text-amber-300' : 'bg-[#CF8A40]/15 text-[#9a5d1f]'
                    }`}
                  >
                    {occ.course_title}
                  </span>
                ) : (
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-lg ${
                      isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#24B0BA]/15 text-[#0e6b73]'
                    }`}
                  >
                    Clase General
                  </span>
                )}
                {occ.especialidad_nombre && (
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-lg ${
                      isDark ? 'bg-white/10 text-blue-200' : 'bg-[#F0F2F2] text-[#2E4A70]'
                    }`}
                  >
                    {occ.especialidad_nombre}
                  </span>
                )}
                {occ.id_reunion && !isCancelled && (
                  <button
                    type="button"
                    onClick={() => handleCopyText('modal-id', occ.id_reunion, 'ID de reunión')}
                    className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-lg border cursor-pointer ${
                      isDark
                        ? 'bg-white/5 border-white/15 text-blue-100'
                        : 'bg-white border-[#2E4A70]/20 text-[#1a2639]'
                    }`}
                  >
                    {copiedId === 'modal-id' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 opacity-70" />
                    )}
                    <span>ID: {occ.id_reunion}</span>
                  </button>
                )}
              </div>

              {occ.motivo && (
                <p className={`text-xs font-semibold italic ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                  Nota: {occ.motivo}
                </p>
              )}

              {occ.descripcion && (
                <div
                  className={`p-3.5 rounded-2xl border text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                    isDark ? 'bg-[#162235] border-white/10 text-blue-100' : 'bg-slate-50 border-slate-200 text-[#2E4A70]'
                  }`}
                >
                  <span className="block text-[10px] font-extrabold uppercase tracking-wider opacity-70 mb-1">
                    Temario e indicaciones
                  </span>
                  {occ.descripcion}
                </div>
              )}

              {!isCancelled && (
                <div className="space-y-2.5 pt-2">
                  {(occ.has_recording || occ.has_slides || occ.notes) && (
                    <div
                      className={`rounded-2xl border p-3.5 space-y-2.5 ${
                        isDark
                          ? 'bg-[#162235] border-[#24B0BA]/30'
                          : 'bg-[#FFF9F0] border-[#014ba0]/20'
                      }`}
                    >
                      <p className="text-xs font-extrabold uppercase tracking-wider opacity-80">
                        Grabación y Diapositivas
                      </p>

                      {occ.notes && (
                        <p className={`text-xs leading-relaxed ${isDark ? 'text-blue-100' : 'text-[#2E4A70]'}`}>
                          {occ.notes}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {occ.has_recording && (
                          <button
                            type="button"
                            onClick={() => handleOpenRecording(occ)}
                            className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold cursor-pointer transition-colors"
                          >
                            <PlayCircle className="w-4 h-4 shrink-0" />
                            <span>Ver grabación</span>
                          </button>
                        )}
                        {occ.has_slides && (
                          <button
                            type="button"
                            onClick={() => handleOpenSlides(occ)}
                            className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs sm:text-sm font-bold cursor-pointer transition-colors"
                          >
                            <Presentation className="w-4 h-4 shrink-0" />
                            <span>Abrir diapositivas</span>
                          </button>
                        )}
                        {occ.slides_material && occ.slides_url && (
                          <a
                            href={occ.slides_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-bold ${
                              isDark
                                ? 'border-white/15 hover:bg-white/10 text-blue-200'
                                : 'border-[#2E4A70]/20 bg-white hover:bg-[#F0F2F2] text-[#014ba0]'
                            }`}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Enlace externo</span>
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {isFinished ? (
                    <div
                      className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${
                        isDark
                          ? 'bg-[#162235] border-white/10 text-slate-300'
                          : 'bg-[#F0F2F2] border-[#2E4A70]/15 text-[#2E4A70]'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5 font-bold">
                        <Check className="w-4 h-4 shrink-0" />
                        <span>
                          {occ.has_resources
                            ? 'Clase finalizada · Grabación y material disponibles arriba'
                            : 'Esta clase ya pasó (sesión finalizada)'}
                        </span>
                      </span>
                      <a
                        href={occ.enlace}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border font-bold ${
                          isDark
                            ? 'border-white/15 bg-white/5 hover:bg-white/10 text-blue-200'
                            : 'border-[#2E4A70]/20 bg-white hover:bg-white/80 text-[#014ba0]'
                        }`}
                      >
                        <span>Enlace original</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <a
                          href={occ.enlace}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex-1 inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-white transition-colors ${
                            isLiveNow
                              ? 'bg-emerald-600 hover:bg-emerald-700'
                              : 'bg-[#014ba0] hover:bg-[#013b80]'
                          }`}
                        >
                          <Video className="w-4 h-4" />
                          <span>{isLiveNow ? 'Unirse ahora' : 'Entrar a la clase'}</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => handleCopyText('modal-link', occ.enlace, 'Enlace')}
                          className={`px-3.5 py-3 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
                            isDark
                              ? 'border-white/15 hover:bg-white/10 text-white'
                              : 'border-[#2E4A70]/20 hover:bg-[#F0F2F2] text-[#1a2639]'
                          }`}
                        >
                          {copiedId === 'modal-link' ? (
                            <Check className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                          <span>Copiar</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <a
                          href={buildGoogleCalendarUrl(occ)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-bold ${
                            isDark
                              ? 'border-white/15 hover:bg-white/5 text-blue-200'
                              : 'border-[#2E4A70]/15 hover:bg-[#F0F2F2] text-[#2E4A70]'
                          }`}
                        >
                          <CalendarPlus className="w-4 h-4" />
                          <span>Google Calendar</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDownloadIcs(occ)}
                          className={`inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-bold cursor-pointer ${
                            isDark
                              ? 'border-white/15 hover:bg-white/5 text-blue-200'
                              : 'border-[#2E4A70]/15 hover:bg-[#F0F2F2] text-[#2E4A70]'
                          }`}
                        >
                          <Download className="w-4 h-4" />
                          <span>Apple (.ics)</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <LiveClassRecordingModal
        isOpen={Boolean(activeRecordingOcc)}
        occurrence={activeRecordingOcc}
        onClose={() => setActiveRecordingOcc(null)}
        onOpenSlides={(occ) => {
          setActiveRecordingOcc(null);
          handleOpenSlides(occ);
        }}
        isDark={isDark}
      />

      <ProtectedDocumentViewer
        isOpen={Boolean(activeSlidesMaterial)}
        onClose={() => setActiveSlidesMaterial(null)}
        material={activeSlidesMaterial}
        isDark={isDark}
      />

      <Toaster position="top-right" />
    </section>
  );
}
