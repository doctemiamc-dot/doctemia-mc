'use client';

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { getCachedCategories, getCachedPagoUnicoCourses } from '@/lib/catalogCache';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import PagoUnicoAccessDenied from '@/app/components/access/PagoUnicoAccessDenied';

const ProtectedDocumentViewer = dynamic(
  () => import('@/app/components/documents/ProtectedDocumentViewer'),
  { ssr: false }
);
import { matchesVideoUrl } from '@/lib/youtubeUtils';
import Link from 'next/link';
import {
  FolderOpen,
  FileText,
  Presentation,
  BookOpen,
  Search,
  Eye,
  Loader2,
  LayoutGrid,
  List,
  Layers,
  GraduationCap,
  ExternalLink,
  RotateCcw,
  X,
  Video,
  Calendar,
  User,
  PlayCircle,
} from 'lucide-react';

function getCourseCoverSrc(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) return trimmed;
  if (trimmed.includes('drive.google.com/thumbnail')) return trimmed;
  if (trimmed.includes('drive.google.com/uc') || trimmed.includes('drive.google.com/open')) {
    try {
      const id = new URL(trimmed).searchParams.get('id');
      if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w500`;
    } catch {
      // ignore malformed URL
    }
  }
  if (trimmed.includes('drive.google.com')) {
    const match = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match?.[1]) return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w500`;
  }
  return trimmed;
}

function getMaterialStyle(materialType) {
  if (materialType === 'slides') {
    return {
      label: 'Diapositivas',
      Icon: Presentation,
      badgeLight: 'bg-teal-50 text-teal-800 border-teal-200',
      badgeDark: 'bg-teal-950/70 text-teal-300 border-teal-800',
      iconWrapLight: 'bg-teal-50 text-teal-700',
      iconWrapDark: 'bg-teal-950/70 text-teal-300',
    };
  }
  if (materialType === 'summary') {
    return {
      label: 'Resumen',
      Icon: BookOpen,
      badgeLight: 'bg-amber-50 text-amber-800 border-amber-200',
      badgeDark: 'bg-amber-950/70 text-amber-300 border-amber-800',
      iconWrapLight: 'bg-amber-50 text-amber-700',
      iconWrapDark: 'bg-amber-950/70 text-amber-300',
    };
  }
  return {
    label: 'PDF / Guía',
    Icon: FileText,
    badgeLight: 'bg-blue-50 text-blue-800 border-blue-200',
    badgeDark: 'bg-blue-950/70 text-blue-300 border-blue-800',
    iconWrapLight: 'bg-blue-50 text-blue-700',
    iconWrapDark: 'bg-blue-950/70 text-blue-300',
  };
}

function formatOccurrenceDate(rawDate) {
  if (!rawDate) return '';
  const text = String(rawDate).slice(0, 10);
  const parts = text.split('-');
  if (parts.length !== 3) return text;
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const dt = new Date(year, month, day);
  if (Number.isNaN(dt.getTime())) return text;
  return dt.toLocaleDateString('es-BO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getMaterialProvenance(mat, course) {
  const isLiveClass =
    mat.origin_type === 'live_class' ||
    Boolean(mat.live_class_info?.schedule_id) ||
    Boolean(mat.storage_path && String(mat.storage_path).startsWith('live-classes/'));

  const modules = Array.isArray(course?.modules) ? course.modules : [];
  let moduleIndex = null;
  let moduleTitle = null;
  let videoIndex = null;
  let videoTitle = null;

  if (course && mat.video_url) {
    for (let mIdx = 0; mIdx < modules.length; mIdx += 1) {
      const mod = modules[mIdx];
      const videos = Array.isArray(mod.videos) ? mod.videos : [];
      const vIdx = videos.findIndex((v) => matchesVideoUrl(mat.video_url, v.url));
      if (vIdx >= 0) {
        moduleIndex = mIdx;
        const rawModTitle = (mod.title || '').trim();
        moduleTitle = rawModTitle
          ? /^m[óo]dulo\s+\d+/i.test(rawModTitle)
            ? rawModTitle
            : `Módulo ${mIdx + 1}: ${rawModTitle}`
          : `Módulo ${mIdx + 1}`;
        videoIndex = vIdx;
        videoTitle = (videos[vIdx].title || '').trim() || `Clase ${vIdx + 1}`;
        break;
      }
    }
  }

  if (
    moduleIndex === null &&
    course &&
    mat.module_index !== null &&
    mat.module_index !== undefined &&
    modules[mat.module_index]
  ) {
    moduleIndex = mat.module_index;
    const rawModTitle = (modules[mat.module_index].title || '').trim();
    moduleTitle = rawModTitle
      ? /^m[óo]dulo\s+\d+/i.test(rawModTitle)
        ? rawModTitle
        : `Módulo ${mat.module_index + 1}: ${rawModTitle}`
      : `Módulo ${mat.module_index + 1}`;
  }

  const courseDeepLink = course
    ? `/app/pagoUnicoCourses/ContenidoCursos/${course.id}${
        moduleIndex !== null
          ? `?module=${moduleIndex}${
              videoIndex !== null
                ? `&video=${videoIndex}`
                : `&material=${encodeURIComponent(mat.id)}`
            }`
          : `?material=${encodeURIComponent(mat.id)}`
      }`
    : null;

  if (isLiveClass) {
    const lc = mat.live_class_info || {};
    const hasRecording = Boolean(lc.recording_url);
    return {
      kind: 'live_class',
      originBadge: hasRecording ? 'Clase Grabada' : 'Clase en Vivo',
      liveTitle: lc.titulo || mat.subtema || 'Sesión en vivo',
      expositor: lc.expositor || '',
      occurrenceDateLabel: formatOccurrenceDate(lc.occurrence_date),
      hasRecording,
      courseTitle: course?.title || null,
      moduleIndex,
      moduleTitle,
      videoIndex,
      videoTitle,
      courseDeepLink,
      liveLink: '/app/clases-en-vivo',
      searchSummary: [
        hasRecording ? 'clase grabada' : 'clase en vivo',
        lc.titulo,
        lc.expositor,
        course?.title,
        moduleTitle,
        videoTitle,
      ]
        .filter(Boolean)
        .join(' '),
    };
  }

  if (course) {
    return {
      kind: 'course',
      originBadge: moduleTitle ? 'Módulo de Curso' : 'Curso',
      courseTitle: course.title,
      moduleIndex,
      moduleTitle: moduleTitle || 'Material general del curso',
      hasSpecificModule: moduleIndex !== null,
      videoIndex,
      videoTitle,
      courseDeepLink,
      liveLink: null,
      searchSummary: [course.title, moduleTitle, videoTitle, 'curso'].filter(Boolean).join(' '),
    };
  }

  return {
    kind: 'library',
    originBadge: 'Biblioteca General',
    courseTitle: null,
    moduleIndex: null,
    moduleTitle: null,
    hasSpecificModule: false,
    videoIndex: null,
    videoTitle: null,
    courseDeepLink: null,
    liveLink: null,
    searchSummary: [mat.especialidad_nombre, mat.subtema, 'biblioteca general']
      .filter(Boolean)
      .join(' '),
  };
}

function getOriginBadgeClasses(kind, isDark) {
  if (kind === 'live_class') {
    return isDark
      ? 'bg-[#24B0BA]/15 text-[#24B0BA] border-[#24B0BA]/30'
      : 'bg-teal-50 text-teal-800 border-teal-200';
  }
  if (kind === 'course') {
    return isDark
      ? 'bg-[#014ba0]/30 text-blue-200 border-[#73C7E3]/30'
      : 'bg-blue-50 text-[#014ba0] border-blue-200';
  }
  return isDark
    ? 'bg-amber-500/15 text-amber-300 border-amber-400/30'
    : 'bg-amber-50 text-amber-800 border-amber-200';
}

function MaterialProvenanceBox({ provenance, isDark, compact = false, showCourseTitle = true }) {
  const OriginIcon =
    provenance.kind === 'live_class'
      ? Video
      : provenance.kind === 'course'
        ? GraduationCap
        : BookOpen;

  const boxBg = isDark
    ? 'bg-slate-900/65 border-slate-700/80 text-slate-300'
    : 'bg-[#FFF9F0]/90 border-slate-200 text-[#2E4A70]';

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${getOriginBadgeClasses(
            provenance.kind,
            isDark
          )}`}
        >
          <OriginIcon className="w-3 h-3 shrink-0" />
          <span>{provenance.originBadge}</span>
        </span>

        {provenance.kind === 'live_class' ? (
          <span className={`truncate font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            {[
              provenance.liveTitle,
              provenance.expositor ? `Exp: ${provenance.expositor}` : null,
              provenance.occurrenceDateLabel,
            ]
              .filter(Boolean)
              .join(' • ')}
          </span>
        ) : provenance.kind === 'course' ? (
          <span className={`truncate font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            {[
              showCourseTitle ? provenance.courseTitle : null,
              provenance.moduleTitle,
              provenance.videoTitle ? `Clase: ${provenance.videoTitle}` : null,
            ]
              .filter(Boolean)
              .join(' • ')}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`rounded-xl border p-2.5 space-y-1.5 text-xs ${boxBg}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-extrabold ${getOriginBadgeClasses(
            provenance.kind,
            isDark
          )}`}
        >
          <OriginIcon className="w-3 h-3 shrink-0" />
          <span>{provenance.originBadge}</span>
        </span>

        {provenance.kind === 'live_class' && provenance.liveLink && (
          <Link
            href={provenance.liveLink}
            className={`inline-flex items-center gap-1 font-bold hover:underline ${
              isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
            }`}
          >
            <PlayCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{provenance.hasRecording ? 'Ver grabación' : 'Ir a Clases'}</span>
          </Link>
        )}

        {provenance.kind === 'course' && provenance.courseDeepLink && (
          <Link
            href={provenance.courseDeepLink}
            className={`inline-flex items-center gap-1 font-bold hover:underline ${
              isDark ? 'text-[#73C7E3]' : 'text-[#014ba0]'
            }`}
          >
            <ExternalLink className="w-3 h-3 shrink-0" />
            <span>{provenance.videoTitle ? 'Ir a la clase' : 'Ir al módulo'}</span>
          </Link>
        )}
      </div>

      {provenance.kind === 'live_class' && (
        <div className="space-y-1">
          <p className={`font-bold leading-snug line-clamp-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
            Clase: {provenance.liveTitle}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {provenance.expositor && (
              <span className="inline-flex items-center gap-1">
                <User className="w-3 h-3 shrink-0 opacity-75" />
                <span>{provenance.expositor}</span>
              </span>
            )}
            {provenance.occurrenceDateLabel && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Calendar className="w-3 h-3 shrink-0 opacity-75" />
                <span>{provenance.occurrenceDateLabel}</span>
              </span>
            )}
          </div>
          {showCourseTitle && provenance.courseTitle && (
            <p className="text-[11px] font-semibold opacity-90 truncate">
              Curso vinculado: {provenance.courseTitle}
            </p>
          )}
        </div>
      )}

      {provenance.kind === 'course' && (
        <div className="space-y-0.5">
          {showCourseTitle && provenance.courseTitle && (
            <p className={`font-bold truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {provenance.courseTitle}
            </p>
          )}
          <p className="font-semibold flex items-center gap-1.5 flex-wrap">
            <Layers className="w-3.5 h-3.5 shrink-0 opacity-75" />
            <span>{provenance.moduleTitle}</span>
          </p>
          {provenance.videoTitle && (
            <p className="text-[11px] flex items-center gap-1.5 font-medium opacity-90 pl-5">
              <PlayCircle className="w-3 h-3 shrink-0" />
              <span className="truncate">Clase: {provenance.videoTitle}</span>
            </p>
          )}
        </div>
      )}

      {provenance.kind === 'library' && (
        <p className="text-[11px] font-medium">
          Recurso independiente disponible para consulta general en la plataforma.
        </p>
      )}
    </div>
  );
}

function CourseThumbnail({ imageUrl, title, isDark, sizeClass = 'w-12 h-12 rounded-xl' }) {
  const [failed, setFailed] = useState(false);
  const src = getCourseCoverSrc(imageUrl);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={`${sizeClass} flex items-center justify-center flex-shrink-0 border ${
          isDark
            ? 'bg-slate-900 border-slate-700 text-teal-400'
            : 'bg-slate-100 border-slate-200 text-[#014ba0]'
        }`}
      >
        <GraduationCap className="w-5 h-5" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={title || 'Portada del curso'}
      referrerPolicy={src.startsWith('http') ? 'no-referrer' : undefined}
      onError={() => setFailed(true)}
      className={`${sizeClass} object-cover flex-shrink-0 border ${
        isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-100'
      }`}
    />
  );
}

export default function StudentMaterialesPage() {
  const { user, firebaseAuthUser, loading: authLoading } = useAuth();
  const { isDark, isLoaded } = useTheme();

  const [materials, setMaterials] = useState([]);
  const [categories, setCategories] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedEsp, setSelectedEsp] = useState('');
  const [selectedSubtema, setSelectedSubtema] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedOrigin, setSelectedOrigin] = useState(''); // '' | 'course' | 'live_class' | 'library'
  const [selectedType, setSelectedType] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('by_course'); // 'by_course' | 'cards' | 'list'

  const [viewerMaterial, setViewerMaterial] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !user.hasPagoUnicoAccess) {
      setLoading(false);
      return;
    }

    const loadAll = async () => {
      setLoading(true);
      try {
        const headers = {};
        if (firebaseAuthUser && typeof firebaseAuthUser.getIdToken === 'function') {
          const token = await firebaseAuthUser.getIdToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }

        const [matRes, cats, puCourses] = await Promise.all([
          fetch('/api/materials', { headers }),
          getCachedCategories(),
          getCachedPagoUnicoCourses({ onlyActive: true }),
        ]);

        const matJson = await matRes.json();
        const loadedMaterials = matRes.ok ? matJson.materials || [] : [];

        let resolvedCourses = puCourses;
        const cachedCourseIds = new Set((puCourses || []).map((c) => c.id));
        const hasMissingActiveCourse = loadedMaterials.some(
          (m) => m.course_id && !cachedCourseIds.has(m.course_id)
        );
        if (hasMissingActiveCourse) {
          resolvedCourses = await getCachedPagoUnicoCourses({
            onlyActive: true,
            forceRefresh: true,
          });
        }

        setMaterials(loadedMaterials);
        setCategories(cats);
        setCourses(resolvedCourses);
      } catch (err) {
        console.error('Error cargando biblioteca de materiales:', err);
      } finally {
        setLoading(false);
      }
    };

    loadAll();
  }, [authLoading, user?.uid, user?.hasPagoUnicoAccess, firebaseAuthUser]);

  const activeCourses = useMemo(
    () => courses.filter((c) => c.isActive !== false),
    [courses]
  );

  const activeCourseIds = useMemo(
    () => new Set(activeCourses.map((c) => c.id)),
    [activeCourses]
  );

  const courseMap = useMemo(
    () => new Map(activeCourses.map((c) => [c.id, c])),
    [activeCourses]
  );

  const visibleMaterials = useMemo(
    () => materials.filter((m) => !m.course_id || activeCourseIds.has(m.course_id)),
    [materials, activeCourseIds]
  );

  const provenanceMap = useMemo(() => {
    const map = new Map();
    visibleMaterials.forEach((mat) => {
      const course = mat.course_id ? courseMap.get(mat.course_id) : null;
      map.set(mat.id, getMaterialProvenance(mat, course));
    });
    return map;
  }, [visibleMaterials, courseMap]);

  const availableSubtemas = useMemo(() => {
    const set = new Set();
    visibleMaterials.forEach((m) => {
      if (selectedEsp && m.especialidad_id !== selectedEsp) return;
      if (m.subtema) set.add(m.subtema);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [visibleMaterials, selectedEsp]);

  // Materiales filtrados antes de origen y tipo (para contadores de origen)
  const preOriginFilteredMaterials = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return visibleMaterials.filter((m) => {
      if (selectedEsp && m.especialidad_id !== selectedEsp) return false;
      if (selectedSubtema && m.subtema !== selectedSubtema) return false;
      if (selectedCourse) {
        if (selectedCourse === '__general__') {
          if (m.course_id) return false;
        } else if (m.course_id !== selectedCourse) {
          return false;
        }
      }
      if (term) {
        const courseObj = m.course_id ? courseMap.get(m.course_id) : null;
        const prov = provenanceMap.get(m.id) || getMaterialProvenance(m, courseObj);
        const hay = [
          m.title,
          m.description,
          m.subtema,
          m.especialidad_nombre,
          courseObj?.title,
          prov?.searchSummary,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [visibleMaterials, selectedEsp, selectedSubtema, selectedCourse, searchTerm, courseMap, provenanceMap]);

  const originCounts = useMemo(() => {
    const counts = {
      all: preOriginFilteredMaterials.length,
      course: 0,
      live_class: 0,
      library: 0,
    };
    preOriginFilteredMaterials.forEach((m) => {
      const prov = provenanceMap.get(m.id);
      const kind = prov?.kind || 'library';
      if (kind === 'live_class') counts.live_class += 1;
      else if (kind === 'course') counts.course += 1;
      else counts.library += 1;
    });
    return counts;
  }, [preOriginFilteredMaterials, provenanceMap]);

  // Materiales filtrados sin tipo (para calcular contadores en píldoras de formato)
  const baseFilteredMaterials = useMemo(() => {
    if (!selectedOrigin) return preOriginFilteredMaterials;
    return preOriginFilteredMaterials.filter((m) => {
      const prov = provenanceMap.get(m.id);
      return (prov?.kind || 'library') === selectedOrigin;
    });
  }, [preOriginFilteredMaterials, selectedOrigin, provenanceMap]);

  const typeCounts = useMemo(() => {
    const counts = { all: baseFilteredMaterials.length, slides: 0, pdf: 0, summary: 0 };
    baseFilteredMaterials.forEach((m) => {
      if (m.material_type === 'slides') counts.slides += 1;
      else if (m.material_type === 'summary') counts.summary += 1;
      else counts.pdf += 1;
    });
    return counts;
  }, [baseFilteredMaterials]);

  const filteredMaterials = useMemo(() => {
    if (!selectedType) return baseFilteredMaterials;
    return baseFilteredMaterials.filter((m) => m.material_type === selectedType);
  }, [baseFilteredMaterials, selectedType]);

  const groupedByCourse = useMemo(() => {
    const groups = new Map();
    filteredMaterials.forEach((mat) => {
      const course = mat.course_id ? courseMap.get(mat.course_id) : null;
      const prov = provenanceMap.get(mat.id) || getMaterialProvenance(mat, course);
      const key = mat.course_id
        ? mat.course_id
        : prov.kind === 'live_class'
          ? '__live_classes__'
          : '__general__';

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          groupType: mat.course_id
            ? 'course'
            : prov.kind === 'live_class'
              ? 'live_class'
              : 'library',
          courseId: mat.course_id || null,
          courseTitle:
            course?.title ||
            (mat.course_id
              ? 'Curso asociado'
              : prov.kind === 'live_class'
                ? 'Clases en Vivo y Grabadas'
                : 'Biblioteca General'),
          imageUrl: course?.imageUrl || '',
          especialidad: mat.especialidad_nombre || '',
          items: [],
          sectionsMap: new Map(),
        });
      }

      const group = groups.get(key);
      group.items.push(mat);

      let sectionKey = 'general';
      let sectionTitle = group.courseId
        ? 'Material general del curso'
        : 'Recursos de Biblioteca General';
      let sectionKind = 'general';
      let sortOrder = 20000;
      let sectionLink = null;

      if (prov.hasSpecificModule && prov.moduleIndex !== null) {
        sectionKey = `mod_${prov.moduleIndex}`;
        sectionTitle = prov.moduleTitle
          ? `Módulo ${prov.moduleIndex + 1}: ${prov.moduleTitle}`
          : `Módulo ${prov.moduleIndex + 1}`;
        sectionKind = 'module';
        sortOrder = prov.moduleIndex;
        sectionLink = `/app/pagoUnicoCourses/ContenidoCursos/${mat.course_id}?module=${prov.moduleIndex}`;
      } else if (prov.kind === 'live_class') {
        sectionKey = 'live_class';
        sectionTitle = group.courseId
          ? 'Clases en Vivo y Grabadas del curso'
          : 'Sesiones en Vivo y Grabaciones';
        sectionKind = 'live_class';
        sortOrder = 10000;
        sectionLink = '/app/clases-en-vivo';
      }

      if (!group.sectionsMap.has(sectionKey)) {
        group.sectionsMap.set(sectionKey, {
          sectionKey,
          sectionTitle,
          sectionKind,
          sortOrder,
          sectionLink,
          items: [],
        });
      }
      group.sectionsMap.get(sectionKey).items.push(mat);
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        sections: Array.from(group.sectionsMap.values()).sort(
          (a, b) => a.sortOrder - b.sortOrder
        ),
      }))
      .sort((a, b) => {
        const rank = (g) =>
          g.key === '__general__' ? 2 : g.key === '__live_classes__' ? 1 : 0;
        const diff = rank(a) - rank(b);
        if (diff !== 0) return diff;
        return a.courseTitle.localeCompare(b.courseTitle);
      });
  }, [filteredMaterials, courseMap, provenanceMap]);

  const hasActiveFilters = Boolean(
    selectedEsp ||
      selectedSubtema ||
      selectedCourse ||
      selectedOrigin ||
      selectedType ||
      searchTerm.trim()
  );

  const clearAllFilters = () => {
    setSelectedEsp('');
    setSelectedSubtema('');
    setSelectedCourse('');
    setSelectedOrigin('');
    setSelectedType('');
    setSearchTerm('');
  };

  if (!isLoaded || authLoading || loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#2E4A70]'}`}>
        <Loader2 className="w-8 h-8 animate-spin mr-3 text-teal-500" />
        <span className="font-semibold">Cargando biblioteca de materiales...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <p className="text-lg font-semibold">Inicia sesión para ver tus materiales.</p>
          <Link href="/login" className="inline-block px-6 py-3 bg-[#014ba0] text-white rounded-xl font-bold">
            Iniciar Sesión
          </Link>
        </div>
      </div>
    );
  }

  if (!user.hasPagoUnicoAccess) {
    return (
      <PagoUnicoAccessDenied
        user={user}
        isDark={isDark}
        description="La biblioteca de diapositivas, resúmenes y PDFs está disponible para estudiantes con acceso habilitado a Cursos de Pago Único."
        whatsappSubject="el acceso de PAGO ÚNICO (Materiales)"
        requestType="pago_unico_access"
      />
    );
  }

  const cardBg = isDark
    ? 'bg-slate-800/95 border-slate-700 text-slate-100'
    : 'bg-white border-slate-200 text-slate-900';
  const inputBg = isDark
    ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-400 focus:border-[#24B0BA] focus:ring-[#24B0BA]/30'
    : 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-500 focus:border-[#014ba0] focus:ring-[#014ba0]/20';
  const primaryBtn = isDark
    ? 'bg-[#24B0BA] hover:bg-[#1d9aa3] text-slate-950 font-bold'
    : 'bg-[#014ba0] hover:bg-[#013b7f] text-white font-semibold';

  const originTabs = [
    { value: '', label: 'Todo origen', count: originCounts.all },
    { value: 'course', label: 'Cursos y Módulos', count: originCounts.course },
    { value: 'live_class', label: 'Clases en Vivo / Grabadas', count: originCounts.live_class },
    { value: 'library', label: 'Biblioteca General', count: originCounts.library },
  ];

  const typeTabs = [
    { value: '', label: 'Todos', count: typeCounts.all },
    { value: 'slides', label: 'Diapositivas', count: typeCounts.slides },
    { value: 'pdf', label: 'PDFs / Guías', count: typeCounts.pdf },
    { value: 'summary', label: 'Resúmenes', count: typeCounts.summary },
  ];

  const viewOptions = [
    { id: 'by_course', label: 'Por Curso', Icon: Layers },
    { id: 'cards', label: 'Tarjetas', Icon: LayoutGrid },
    { id: 'list', label: 'Lista', Icon: List },
  ];

  return (
    <div className={`min-h-screen py-5 px-3 sm:px-6 lg:px-8 ${isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#2E4A70]'}`}>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Encabezado */}
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="space-y-1">
            <h1 className={`text-2xl sm:text-3xl font-extrabold flex items-center gap-2.5 ${isDark ? 'text-white' : 'text-[#2E4A70]'}`}>
              <FolderOpen className={`w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
              Biblioteca de Materiales
            </h1>
            <p className={`text-sm ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              Diapositivas, resúmenes y guías identificados por curso, módulo, clase grabada y especialidad.
            </p>
          </div>

          {/* Selector de vista: Por Curso | Tarjetas | Lista */}
          <div
            role="group"
            aria-label="Modo de visualización"
            className={`inline-flex items-center p-1 rounded-xl border self-start sm:self-auto ${
              isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200 shadow-sm'
            }`}
          >
            {viewOptions.map(({ id, label, Icon }) => {
              const active = viewMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setViewMode(id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[38px] cursor-pointer ${
                    active
                      ? isDark
                        ? 'bg-[#24B0BA] text-slate-950'
                        : 'bg-[#014ba0] text-white'
                      : isDark
                        ? 'text-slate-300 hover:bg-slate-800'
                        : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </header>

        {/* Barra de Filtros, Origen y Formato */}
        <section className={`p-4 sm:p-5 rounded-2xl border shadow-sm space-y-4 ${cardBg}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className={`flex items-center gap-2 px-3 rounded-xl border min-h-[44px] focus-within:ring-2 ${inputBg}`}>
              <Search className="w-4 h-4 opacity-50 flex-shrink-0" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar título, curso, módulo o expositor..."
                aria-label="Buscar materiales"
                className="w-full py-2.5 bg-transparent text-sm outline-none min-w-0"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Limpiar búsqueda"
                  className="p-1 text-slate-400 hover:text-red-500 flex-shrink-0 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              aria-label="Filtrar por curso"
              className={`p-2.5 rounded-xl border text-sm min-h-[44px] outline-none focus:ring-2 ${inputBg}`}
            >
              <option value="">Todos los Cursos</option>
              <option value="__general__">Sin curso (Clases en vivo / Biblioteca)</option>
              {activeCourses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>

            <select
              value={selectedEsp}
              onChange={(e) => {
                setSelectedEsp(e.target.value);
                setSelectedSubtema('');
              }}
              aria-label="Filtrar por especialidad"
              className={`p-2.5 rounded-xl border text-sm min-h-[44px] outline-none focus:ring-2 ${inputBg}`}
            >
              <option value="">Todas las Especialidades</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              value={selectedSubtema}
              onChange={(e) => setSelectedSubtema(e.target.value)}
              aria-label="Filtrar por tema"
              className={`p-2.5 rounded-xl border text-sm min-h-[44px] outline-none focus:ring-2 ${inputBg}`}
            >
              <option value="">Todos los Temas</option>
              {availableSubtemas.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
          </div>

          {/* Píldoras de procedencia / origen */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className={`text-[11px] font-bold uppercase tracking-wider mr-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Origen:
            </span>
            {originTabs.map((tab) => {
              const active = selectedOrigin === tab.value;
              return (
                <button
                  key={tab.value || 'all-origin'}
                  type="button"
                  onClick={() => setSelectedOrigin(tab.value)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold whitespace-nowrap transition-colors min-h-[34px] cursor-pointer ${
                    active
                      ? isDark
                        ? 'bg-[#24B0BA]/20 border-[#24B0BA] text-[#24B0BA]'
                        : 'bg-[#014ba0]/10 border-[#014ba0] text-[#014ba0]'
                      : isDark
                        ? 'bg-slate-900/70 border-slate-700 text-slate-300 hover:bg-slate-700'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      active
                        ? isDark
                          ? 'bg-[#24B0BA] text-slate-950'
                          : 'bg-[#014ba0] text-white'
                        : isDark
                          ? 'bg-slate-800 text-slate-300'
                          : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Píldoras de formato + contador y botón limpiar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
              {typeTabs.map((tab) => {
                const active = selectedType === tab.value;
                return (
                  <button
                    key={tab.value || 'all'}
                    type="button"
                    onClick={() => setSelectedType(tab.value)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold whitespace-nowrap transition-colors min-h-[36px] cursor-pointer ${
                      active
                        ? isDark
                          ? 'bg-[#24B0BA] border-[#24B0BA] text-slate-950'
                          : 'bg-[#014ba0] border-[#014ba0] text-white'
                        : isDark
                          ? 'bg-slate-900/70 border-slate-700 text-slate-300 hover:bg-slate-700'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        active
                          ? isDark
                            ? 'bg-slate-950/20 text-slate-950'
                            : 'bg-white/20 text-white'
                          : isDark
                            ? 'bg-slate-800 text-slate-300'
                            : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 text-xs">
              <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>
                Mostrando <strong className={isDark ? 'text-white' : 'text-slate-900'}>{filteredMaterials.length}</strong> de {visibleMaterials.length}
              </span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className={`inline-flex items-center gap-1 font-semibold px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                    isDark
                      ? 'border-slate-700 text-slate-200 hover:bg-slate-700'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Limpiar
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Estado vacío */}
        {filteredMaterials.length === 0 ? (
          <div className={`p-10 sm:p-12 rounded-2xl border text-center space-y-3 ${cardBg}`}>
            <FolderOpen className="w-12 h-12 mx-auto opacity-40" />
            <p className="font-semibold">No se encontraron materiales con esos filtros.</p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm min-h-[44px] ${primaryBtn}`}
              >
                <RotateCcw className="w-4 h-4" />
                Mostrar todos los materiales
              </button>
            )}
          </div>
        ) : viewMode === 'cards' ? (
          /* MODO 1: TARJETAS CON PORTADA Y PROCEDENCIA COMPLETA EN CADA TARJETA */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredMaterials.map((mat) => {
              const style = getMaterialStyle(mat.material_type);
              const Icon = style.Icon;
              const course = mat.course_id ? courseMap.get(mat.course_id) : null;
              const provenance = provenanceMap.get(mat.id) || getMaterialProvenance(mat, course);
              const headerLink = provenance.courseDeepLink || (provenance.kind === 'live_class' ? provenance.liveLink : null);
              const headerTitle =
                course?.title ||
                provenance.liveTitle ||
                mat.especialidad_nombre ||
                'Material Complementario';

              return (
                <article
                  key={mat.id}
                  className={`rounded-2xl border shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between overflow-hidden ${cardBg}`}
                >
                  <div>
                    {/* Cabecera de Origen (Curso / Clase en Vivo / Biblioteca) */}
                    <div
                      className={`p-3.5 border-b flex items-center gap-3 ${
                        isDark
                          ? 'bg-slate-900/60 border-slate-700/80'
                          : 'bg-slate-50 border-slate-200/80'
                      }`}
                    >
                      {!course && provenance.kind === 'live_class' ? (
                        <div
                          className={`w-14 h-10 rounded-lg flex items-center justify-center flex-shrink-0 border ${
                            isDark
                              ? 'bg-emerald-900/40 border-emerald-700/60 text-emerald-300'
                              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          }`}
                        >
                          <Video className="w-5 h-5" />
                        </div>
                      ) : (
                        <CourseThumbnail
                          imageUrl={course?.imageUrl}
                          title={course?.title}
                          isDark={isDark}
                          sizeClass="w-14 h-10 rounded-lg"
                        />
                      )}

                      <div className="min-w-0 flex-1 space-y-0.5">
                        <span
                          className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${getOriginBadgeClasses(provenance.kind, isDark)}`}
                        >
                          {provenance.originBadge}
                        </span>
                        <p className={`text-xs sm:text-sm font-bold truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                          {headerTitle}
                        </p>
                      </div>

                      {headerLink && (
                        <Link
                          href={headerLink}
                          title={provenance.courseDeepLink ? 'Ir a la clase / curso' : 'Ir a Clases en Vivo'}
                          aria-label={`Abrir origen de ${mat.title}`}
                          className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
                            isDark
                              ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                              : 'text-slate-500 hover:text-[#014ba0] hover:bg-slate-200/70'
                          }`}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Link>
                      )}
                    </div>

                    {/* Contenido del Material */}
                    <div className="p-4 sm:p-5 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className={`p-2 rounded-xl flex-shrink-0 ${isDark ? style.iconWrapDark : style.iconWrapLight}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <span
                          className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                            isDark ? style.badgeDark : style.badgeLight
                          }`}
                        >
                          {style.label}
                        </span>
                      </div>

                      <div>
                        <h3 className={`font-bold text-base leading-snug line-clamp-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                          {mat.title}
                        </h3>
                        {mat.description && (
                          <p className={`text-xs mt-1.5 line-clamp-2 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                            {mat.description}
                          </p>
                        )}
                      </div>

                      <MaterialProvenanceBox
                        provenance={provenance}
                        isDark={isDark}
                        showCourseTitle={false}
                      />

                      {(mat.especialidad_nombre || mat.subtema) && (
                        <div className="flex flex-wrap gap-1.5 text-[11px]">
                          {mat.especialidad_nombre && (
                            <span
                              className={`px-2 py-0.5 rounded-md font-medium ${
                                isDark ? 'bg-slate-700/80 text-slate-200' : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {mat.especialidad_nombre}
                            </span>
                          )}
                          {mat.subtema && (
                            <span
                              className={`px-2 py-0.5 rounded-md font-medium ${
                                isDark ? 'bg-slate-700/80 text-slate-200' : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {mat.subtema}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="px-4 pb-4 sm:px-5 sm:pb-5 pt-0">
                    <button
                      type="button"
                      onClick={() => setViewerMaterial(mat)}
                      className={`w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm transition-colors min-h-[44px] cursor-pointer ${primaryBtn}`}
                    >
                      <Eye className="w-4 h-4" />
                      Abrir en Visor
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : viewMode === 'list' ? (
          /* MODO 2: LISTA COMPACTA CON PROCEDENCIA EXACTA */
          <div className={`rounded-2xl border shadow-sm divide-y overflow-hidden ${cardBg} ${isDark ? 'divide-slate-700' : 'divide-slate-200'}`}>
            {filteredMaterials.map((mat) => {
              const style = getMaterialStyle(mat.material_type);
              const Icon = style.Icon;
              const course = mat.course_id ? courseMap.get(mat.course_id) : null;
              const provenance = provenanceMap.get(mat.id) || getMaterialProvenance(mat, course);

              return (
                <div
                  key={mat.id}
                  className={`p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                    isDark ? 'hover:bg-slate-700/35' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                    {!course && provenance.kind === 'live_class' ? (
                      <div
                        className={`w-16 h-11 rounded-lg flex items-center justify-center flex-shrink-0 border ${
                          isDark
                            ? 'bg-emerald-900/40 border-emerald-700/60 text-emerald-300'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        }`}
                      >
                        <Video className="w-5 h-5" />
                      </div>
                    ) : (
                      <CourseThumbnail
                        imageUrl={course?.imageUrl}
                        title={course?.title}
                        isDark={isDark}
                        sizeClass="w-16 h-11 rounded-lg"
                      />
                    )}

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                            isDark ? style.badgeDark : style.badgeLight
                          }`}
                        >
                          <Icon className="w-3 h-3" />
                          {style.label}
                        </span>
                        <span
                          className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${getOriginBadgeClasses(provenance.kind, isDark)}`}
                        >
                          {provenance.originBadge}
                        </span>
                        {course?.title && (
                          <span className={`text-xs font-bold truncate ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}>
                            {course.title}
                          </span>
                        )}
                      </div>

                      <h3 className={`font-bold text-sm sm:text-base truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                        {mat.title}
                      </h3>

                      <MaterialProvenanceBox
                        provenance={provenance}
                        isDark={isDark}
                        compact
                        showCourseTitle={false}
                      />

                      {(mat.especialidad_nombre || mat.subtema) && (
                        <p className={`text-[11px] truncate ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                          {[mat.especialidad_nombre, mat.subtema].filter(Boolean).join(' • ')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:flex-shrink-0">
                    {provenance.courseDeepLink ? (
                      <Link
                        href={provenance.courseDeepLink}
                        className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors min-h-[42px] ${
                          isDark
                            ? 'border-slate-600 text-slate-200 hover:bg-slate-700'
                            : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">
                          {provenance.hasSpecificModule ? 'Ir al módulo' : 'Curso'}
                        </span>
                      </Link>
                    ) : provenance.kind === 'live_class' && provenance.liveLink ? (
                      <Link
                        href={provenance.liveLink}
                        className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors min-h-[42px] ${
                          isDark
                            ? 'border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/30'
                            : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                        }`}
                      >
                        <Video className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Clases</span>
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setViewerMaterial(mat)}
                      className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm transition-colors min-h-[42px] cursor-pointer ${primaryBtn}`}
                    >
                      <Eye className="w-4 h-4" />
                      Abrir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* MODO 3: AGRUPADO POR CURSO, MÓDULO Y CLASES EN VIVO */
          <div className="space-y-6">
            {groupedByCourse.map((group) => {
              const moduleCount = group.sections.filter((s) => s.sectionKind === 'module').length;
              return (
                <section key={group.key} className={`rounded-2xl border shadow-sm overflow-hidden ${cardBg}`}>
                  {/* Banner del Grupo (Curso / Clases en Vivo / Biblioteca General) */}
                  <div
                    className={`p-4 sm:p-5 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                      isDark ? 'bg-slate-900/70 border-slate-700' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      {group.groupType === 'live_class' && !group.imageUrl ? (
                        <div
                          className={`w-16 h-12 sm:w-20 sm:h-14 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                            isDark
                              ? 'bg-emerald-900/40 border-emerald-700/60 text-emerald-300'
                              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          }`}
                        >
                          <Video className="w-6 h-6 sm:w-7 sm:h-7" />
                        </div>
                      ) : (
                        <CourseThumbnail
                          imageUrl={group.imageUrl}
                          title={group.courseTitle}
                          isDark={isDark}
                          sizeClass="w-20 h-14 sm:w-24 sm:h-16 rounded-xl"
                        />
                      )}
                      <div className="min-w-0">
                        <p className={`text-[11px] font-bold uppercase tracking-wider ${
                          group.groupType === 'live_class'
                            ? isDark ? 'text-emerald-400' : 'text-emerald-700'
                            : isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                        }`}>
                          {group.groupType === 'course'
                            ? 'Curso'
                            : group.groupType === 'live_class'
                              ? 'Clases en Vivo y Grabadas'
                              : 'Recursos Generales'}
                        </p>
                        <h2 className={`text-base sm:text-xl font-bold truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                          {group.courseTitle}
                        </h2>
                        <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                          {group.items.length} {group.items.length === 1 ? 'material disponible' : 'materiales disponibles'}
                          {moduleCount > 0 ? ` • ${moduleCount} ${moduleCount === 1 ? 'módulo' : 'módulos'}` : ''}
                          {group.especialidad ? ` • ${group.especialidad}` : ''}
                        </p>
                      </div>
                    </div>

                    {group.courseId ? (
                      <Link
                        href={`/app/pagoUnicoCourses/ContenidoCursos/${group.courseId}`}
                        className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors min-h-[40px] self-start sm:self-center flex-shrink-0 ${
                          isDark
                            ? 'border-slate-600 text-slate-200 hover:bg-slate-700'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Ir al curso
                      </Link>
                    ) : group.groupType === 'live_class' ? (
                      <Link
                        href="/app/clases-en-vivo"
                        className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors min-h-[40px] self-start sm:self-center flex-shrink-0 ${
                          isDark
                            ? 'border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/30'
                            : 'border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50'
                        }`}
                      >
                        <Video className="w-3.5 h-3.5" />
                        Ir a Clases en Vivo
                      </Link>
                    ) : null}
                  </div>

                  {/* Sub-secciones por Módulo / Clase en Vivo / General */}
                  <div className={`divide-y ${isDark ? 'divide-slate-700/70' : 'divide-slate-200/80'}`}>
                    {group.sections.map((section) => {
                      const showSectionHeader =
                        group.groupType === 'course' ||
                        group.sections.length > 1 ||
                        section.sectionKind === 'module';
                      const SectionIcon =
                        section.sectionKind === 'module'
                          ? Layers
                          : section.sectionKind === 'live_class'
                            ? Video
                            : FolderOpen;

                      return (
                        <div key={section.sectionKey} className="p-3 sm:p-4 space-y-3">
                          {showSectionHeader && (
                            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <SectionIcon
                                  className={`w-4 h-4 flex-shrink-0 ${
                                    section.sectionKind === 'live_class'
                                      ? isDark ? 'text-emerald-400' : 'text-emerald-700'
                                      : isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                                  }`}
                                />
                                <h3 className={`text-xs sm:text-sm font-bold truncate ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                                  {section.sectionTitle}
                                </h3>
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-200/80 text-slate-700'
                                  }`}
                                >
                                  {section.items.length}
                                </span>
                              </div>

                              {section.sectionLink && (
                                <Link
                                  href={section.sectionLink}
                                  className={`inline-flex items-center gap-1 text-xs font-semibold hover:underline ${
                                    section.sectionKind === 'live_class'
                                      ? isDark ? 'text-emerald-400' : 'text-emerald-700'
                                      : isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                                  }`}
                                >
                                  <span>
                                    {section.sectionKind === 'module' ? 'Abrir módulo' : 'Ver clases'}
                                  </span>
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              )}
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {section.items.map((mat) => {
                              const style = getMaterialStyle(mat.material_type);
                              const Icon = style.Icon;
                              const course = mat.course_id ? courseMap.get(mat.course_id) : null;
                              const provenance =
                                provenanceMap.get(mat.id) || getMaterialProvenance(mat, course);

                              return (
                                <div
                                  key={mat.id}
                                  className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
                                    isDark
                                      ? 'bg-slate-900/50 border-slate-700/80'
                                      : 'bg-white border-slate-200'
                                  }`}
                                >
                                  <div className="flex items-start gap-3 min-w-0 flex-1">
                                    <div className={`p-2 rounded-lg flex-shrink-0 ${isDark ? style.iconWrapDark : style.iconWrapLight}`}>
                                      <Icon className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-1.5">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <h4 className={`text-sm font-bold truncate max-w-full ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                          {mat.title}
                                        </h4>
                                        <span
                                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                            isDark ? style.badgeDark : style.badgeLight
                                          }`}
                                        >
                                          {style.label}
                                        </span>
                                        {provenance.kind === 'live_class' && (
                                          <span
                                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getOriginBadgeClasses(provenance.kind, isDark)}`}
                                          >
                                            {provenance.originBadge}
                                          </span>
                                        )}
                                      </div>

                                      <MaterialProvenanceBox
                                        provenance={provenance}
                                        isDark={isDark}
                                        showCourseTitle={false}
                                      />

                                      {(mat.especialidad_nombre || mat.subtema) && (
                                        <p className={`text-[11px] truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                          {[mat.especialidad_nombre, mat.subtema].filter(Boolean).join(' • ')}
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => setViewerMaterial(mat)}
                                    className={`w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs transition-colors min-h-[40px] flex-shrink-0 cursor-pointer ${primaryBtn}`}
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>Abrir</span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <ProtectedDocumentViewer
        isOpen={Boolean(viewerMaterial)}
        onClose={() => setViewerMaterial(null)}
        material={viewerMaterial}
        isDark={isDark}
      />
    </div>
  );
}
