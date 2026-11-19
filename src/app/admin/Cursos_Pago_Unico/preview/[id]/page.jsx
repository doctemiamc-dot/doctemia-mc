'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, useMemo } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import ReactPlayer from 'react-player/lazy';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import ProtectedDocumentViewer from '@/app/components/documents/ProtectedDocumentViewer';
import { cleanYouTubeUrl } from '@/lib/youtubeUtils';
import { buildCourseCurriculum } from '@/lib/courseCurriculum';
import {
  ArrowLeft,
  ChevronDown,
  Edit3,
  FileText,
  Presentation,
  BookOpen,
  FolderOpen,
  Video,
  Eye,
  Maximize2,
} from 'lucide-react';

const MATERIAL_STYLE = {
  pdf: {
    label: 'PDF',
    Icon: FileText,
    badgeLight: 'bg-blue-50 text-blue-700 border-blue-200',
    badgeDark: 'bg-blue-950/60 text-blue-300 border-blue-800',
  },
  slides: {
    label: 'Diapositivas',
    Icon: Presentation,
    badgeLight: 'bg-teal-50 text-teal-700 border-teal-200',
    badgeDark: 'bg-teal-950/60 text-teal-300 border-teal-800',
  },
  summary: {
    label: 'Resumen',
    Icon: BookOpen,
    badgeLight: 'bg-amber-50 text-amber-700 border-amber-200',
    badgeDark: 'bg-amber-950/60 text-amber-300 border-amber-800',
  },
};

export default function PreviewSinglePaymentCourse() {
  const { id: courseId } = useParams();
  const router = useRouter();
  const { isDark, isLoaded } = useTheme();
  const { firebaseAuthUser, loading: authLoading } = useAuth();

  const [course, setCourse] = useState(null);
  const [courseMaterials, setCourseMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeLessonKey, setActiveLessonKey] = useState(null);
  const [openModuleIndex, setOpenModuleIndex] = useState(0);
  const [viewerMaterial, setViewerMaterial] = useState(null);

  useEffect(() => {
    if (!courseId || authLoading) {
      if (!courseId) setLoading(false);
      return;
    }

    let isMounted = true;
    const fetchCourseAndMaterials = async () => {
      setLoading(true);
      try {
        const docRef = doc(db, 'Cursos_Pago_Unico', courseId);
        const materialsPromise = (async () => {
          try {
            const headers = {};
            if (firebaseAuthUser && typeof firebaseAuthUser.getIdToken === 'function') {
              const token = await firebaseAuthUser.getIdToken();
              if (token) headers.Authorization = `Bearer ${token}`;
            }
            const matRes = await fetch(
              `/api/materials?course_id=${encodeURIComponent(courseId)}&include_inactive=true`,
              { headers }
            );
            if (matRes.ok) {
              const matData = await matRes.json();
              return matData.materials || [];
            }
          } catch (matErr) {
            console.error('Error cargando materiales del curso:', matErr);
          }
          return [];
        })();

        const [docSnap, loadedMaterials] = await Promise.all([
          getDoc(docRef),
          materialsPromise,
        ]);

        if (!isMounted) return;
        if (docSnap.exists()) {
          const courseData = { id: docSnap.id, ...docSnap.data() };
          setCourse(courseData);
          setCourseMaterials(loadedMaterials);

          const { flatCurriculum } = buildCourseCurriculum(courseData, loadedMaterials);
          const initial =
            flatCurriculum.find((item) => item.kind === 'video') ||
            flatCurriculum[0] ||
            null;
          if (initial) {
            setActiveLessonKey(initial.key);
            setOpenModuleIndex(initial.moduleIdx ?? 0);
          }
        }
      } catch (error) {
        console.error('Error fetching course:', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchCourseAndMaterials();
    return () => {
      isMounted = false;
    };
  }, [courseId, firebaseAuthUser, authLoading]);

  const curriculum = useMemo(
    () => buildCourseCurriculum(course, courseMaterials),
    [course, courseMaterials]
  );

  const activeEntry = useMemo(() => {
    if (!curriculum.flatCurriculum.length) return null;
    return (
      curriculum.flatCurriculum.find((item) => item.key === activeLessonKey) ||
      curriculum.flatCurriculum[0]
    );
  }, [curriculum.flatCurriculum, activeLessonKey]);

  if (!isLoaded || loading) {
    return (
      <div className={`min-h-screen p-4 sm:p-6 lg:p-8 ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className="max-w-[1440px] mx-auto animate-pulse space-y-6">
          <div className={`h-8 w-56 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 space-y-4">
              <div className={`aspect-video w-full rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
              <div className={`h-24 w-full rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            </div>
            <div className="lg:col-span-4 space-y-3">
              <div className={`h-20 w-full rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
              <div className={`h-20 w-full rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className={`min-h-screen p-8 text-center text-lg ${isDark ? 'bg-gray-900 text-red-400' : 'bg-gray-50 text-red-600'}`}>
        El curso no existe o hubo un error al cargarlo.
      </div>
    );
  }

  const cardClass = `rounded-xl border shadow-sm ${
    isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
  }`;
  const dividerClass = isDark ? 'border-gray-700' : 'border-gray-200';

  const { moduleSections, generalLessons, totalVideos, totalDocs } = curriculum;
  const activeVideoMaterials = activeEntry?.kind === 'video' ? activeEntry.attachments || [] : [];
  const hasVideoMaterials =
    activeEntry?.kind === 'video' &&
    (Boolean(activeEntry.video?.driveLink) || activeVideoMaterials.length > 0);

  const renderMaterialButton = (entry) => {
    const mat = entry.material || entry;
    const style = MATERIAL_STYLE[mat.material_type] || MATERIAL_STYLE.pdf;
    const MatIcon = style.Icon;
    const isSelected = activeEntry?.key === entry.key;
    return (
      <button
        key={entry.key || mat.id}
        type="button"
        onClick={() => (entry.key ? setActiveLessonKey(entry.key) : setViewerMaterial(mat))}
        className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer min-h-[44px] max-w-full ${
          isSelected
            ? isDark
              ? 'bg-indigo-950/60 border-indigo-500 text-indigo-200'
              : 'bg-indigo-50 border-indigo-500 text-indigo-900'
            : isDark
              ? 'bg-gray-900/60 hover:bg-gray-700 border-gray-700 text-gray-100'
              : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-900'
        }`}
      >
        <MatIcon className="w-4 h-4 flex-shrink-0 text-indigo-500" />
        <span className="truncate max-w-[210px] sm:max-w-xs">{entry.title || mat.title}</span>
        <span
          className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border flex-shrink-0 ${
            isDark ? style.badgeDark : style.badgeLight
          }`}
        >
          {style.label}
        </span>
      </button>
    );
  };

  return (
    <section className={`min-h-screen py-5 px-3 sm:px-6 lg:px-8 ${isDark ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
      <div className="max-w-[1440px] mx-auto space-y-5">
        {/* Cabecera */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => router.back()}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs sm:text-sm font-semibold transition-colors min-h-[40px] ${
                isDark
                  ? 'border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={`text-xl sm:text-2xl font-bold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {course.title}
                </h1>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                    isDark
                      ? 'bg-indigo-950/60 text-indigo-300 border-indigo-800'
                      : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  Vista previa
                </span>
              </div>
            </div>
          </div>

          <Link
            href={`/admin/Cursos_Pago_Unico/edit/${courseId}`}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold shadow-sm transition-colors min-h-[44px] self-start sm:self-center"
          >
            <Edit3 className="w-4 h-4" />
            Editar curso y materiales
          </Link>
        </div>

        {/* Layout principal 12 columnas */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Columna izquierda: Visor Video/Documento + Info + Recursos generales */}
          <div className="lg:col-span-8 space-y-5 min-w-0">
            {activeEntry?.kind === 'video' ? (
              <div className="aspect-video w-full bg-black rounded-xl overflow-hidden shadow-lg">
                <ReactPlayer url={cleanYouTubeUrl(activeEntry.video.url)} width="100%" height="100%" controls={true} />
              </div>
            ) : activeEntry?.kind === 'material' ? (
              <div className="w-full h-[64vh] sm:h-[70vh] min-h-[420px]">
                <ProtectedDocumentViewer
                  inline
                  isOpen
                  material={activeEntry.material}
                  isDark={isDark}
                  onExpandFullscreen={() => setViewerMaterial(activeEntry.material)}
                />
              </div>
            ) : (
              <div className={`${cardClass} aspect-video w-full flex flex-col items-center justify-center p-6 text-center gap-2`}>
                <FolderOpen className={`w-10 h-10 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                <p className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  Este curso aún no tiene videos ni PDFs/diapositivas cargados.
                </p>
              </div>
            )}

            {/* Tarjeta de la lección/documento seleccionado */}
            {activeEntry && (
              <div className={`${cardClass} p-4 sm:p-6 space-y-4`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {activeEntry.moduleTitle}
                    </p>
                    <h2 className={`text-lg sm:text-xl font-bold mt-0.5 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {activeEntry.title}
                    </h2>
                  </div>
                  {activeEntry.kind === 'material' && (
                    <button
                      type="button"
                      onClick={() => setViewerMaterial(activeEntry.material)}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition cursor-pointer min-h-[40px] ${
                        isDark
                          ? 'border-indigo-500/40 bg-indigo-950/50 text-indigo-300 hover:bg-indigo-900/50'
                          : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                      }`}
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span>Pantalla completa</span>
                    </button>
                  )}
                </div>

                {activeEntry.kind === 'video' && (
                  hasVideoMaterials ? (
                    <div className={`pt-3 border-t ${dividerClass} space-y-2.5`}>
                      <h3 className={`text-xs sm:text-sm font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        Material de apoyo de esta clase ({activeVideoMaterials.length + (activeEntry.video.driveLink ? 1 : 0)})
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {activeVideoMaterials.map((mat) => renderMaterialButton(mat))}

                        {activeEntry.video.driveLink && (
                          <button
                            type="button"
                            onClick={() =>
                              setViewerMaterial({
                                id: `drive-video-${activeEntry.video.url}`,
                                title: `Material: ${activeEntry.title}`,
                                material_type: 'summary',
                                source_type: 'google_drive_legacy',
                                file_url: activeEntry.video.driveLink,
                              })
                            }
                            className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer min-h-[44px] ${
                              isDark
                                ? 'bg-gray-900/60 hover:bg-gray-700 border-gray-700 text-gray-100'
                                : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-900'
                            }`}
                          >
                            <FolderOpen className="w-4 h-4 text-amber-500 flex-shrink-0" />
                            <span>Resumen de la clase (Drive)</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Esta clase no tiene PDFs ni diapositivas adjuntas.
                    </p>
                  )
                )}
              </div>
            )}

            {/* Descripción y Recursos Generales del Curso */}
            <div className={`${cardClass} p-4 sm:p-6 space-y-4`}>
              <div>
                <h2 className={`text-base sm:text-lg font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Descripción del Curso
                </h2>
                <p className={`text-sm whitespace-pre-line ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  {course.description || 'Sin descripción registrada.'}
                </p>
              </div>

              {generalLessons.length > 0 && (
                <div className={`pt-4 border-t ${dividerClass} space-y-2.5`}>
                  <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    Recursos Generales del Curso
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {generalLessons.map((entry) => renderMaterialButton(entry))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Columna derecha: Contenido del curso (Módulos, PDFs/diapositivas y videos) */}
          <aside className={`lg:col-span-4 ${cardClass} p-4 sm:p-5 lg:sticky lg:top-20`}>
            <div className={`flex items-center justify-between gap-2 pb-3 mb-3 border-b ${dividerClass}`}>
              <h2 className={`text-base sm:text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Contenido del Curso
              </h2>
              <span className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {moduleSections.length} {moduleSections.length === 1 ? 'módulo' : 'módulos'}
                {totalVideos > 0 ? ` · ${totalVideos} videos` : totalDocs > 0 ? ` · ${totalDocs} docs` : ''}
              </span>
            </div>

            <div className="space-y-2.5 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto lg:pr-1">
              {moduleSections.map((sec) => {
                const moduleIndex = sec.moduleIdx;
                const isOpen = openModuleIndex === moduleIndex;

                return (
                  <div
                    key={moduleIndex}
                    className={`rounded-xl border overflow-hidden ${dividerClass}`}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenModuleIndex(isOpen ? -1 : moduleIndex)}
                      className={`w-full flex justify-between items-center gap-2 p-3 text-left font-semibold transition-colors min-h-[44px] cursor-pointer ${
                        isDark ? 'bg-gray-700/50 hover:bg-gray-700' : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      <span className="text-sm truncate">{sec.moduleTitle}</span>
                      <ChevronDown
                        className={`w-4 h-4 flex-shrink-0 transition-transform ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {isOpen && (
                      <div className={`p-2 space-y-2 ${isDark ? 'bg-gray-800' : 'bg-white'}`}>
                        {sec.videos.length > 0 && (
                          <div className="space-y-1.5">
                            {sec.videos.map((vidEntry) => {
                              const isSelected = activeEntry?.key === vidEntry.key;
                              const thisVideoMaterials = vidEntry.attachments || [];
                              const videoHasMat =
                                Boolean(vidEntry.video.driveLink) || thisVideoMaterials.length > 0;

                              return (
                                <div
                                  key={vidEntry.key}
                                  className={`rounded-lg transition-colors ${
                                    isSelected
                                      ? isDark
                                        ? 'bg-indigo-950/50 border border-indigo-800/80'
                                        : 'bg-indigo-50/90 border border-indigo-200'
                                      : ''
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setActiveLessonKey(vidEntry.key)}
                                    className={`w-full text-left p-2.5 rounded-lg flex items-center justify-between gap-2 transition-colors min-h-[44px] cursor-pointer ${
                                      isSelected
                                        ? isDark
                                          ? 'text-indigo-200'
                                          : 'text-indigo-900'
                                        : isDark
                                          ? 'hover:bg-gray-700/60 text-gray-200'
                                          : 'hover:bg-gray-100 text-gray-800'
                                    }`}
                                  >
                                    <span className="flex items-center gap-2.5 min-w-0">
                                      <Video
                                        className={`w-4 h-4 flex-shrink-0 ${
                                          isSelected
                                            ? 'text-indigo-500'
                                            : isDark
                                              ? 'text-gray-400'
                                              : 'text-gray-500'
                                        }`}
                                      />
                                      <span className="text-sm font-medium break-words">
                                        {vidEntry.title}
                                      </span>
                                    </span>
                                    {videoHasMat && (
                                      <span
                                        className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                                          isDark
                                            ? 'bg-gray-800 text-indigo-300'
                                            : 'bg-white text-indigo-700 border border-indigo-100'
                                        }`}
                                        title="Archivos adjuntos en este video"
                                      >
                                        <FolderOpen className="w-3 h-3" />
                                        {thisVideoMaterials.length + (vidEntry.video.driveLink ? 1 : 0)}
                                      </span>
                                    )}
                                  </button>

                                  {videoHasMat && (
                                    <div className="px-2.5 pb-2.5 pt-0.5 space-y-1">
                                      {thisVideoMaterials.map((mat) => {
                                        const style = MATERIAL_STYLE[mat.material_type] || MATERIAL_STYLE.pdf;
                                        const MatIcon = style.Icon;
                                        return (
                                          <button
                                            key={mat.id}
                                            type="button"
                                            onClick={() => setViewerMaterial(mat)}
                                            className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between gap-2 transition-colors cursor-pointer min-h-[36px] ${
                                              isDark
                                                ? 'bg-gray-900/70 hover:bg-gray-700 text-gray-200 border border-gray-700/80'
                                                : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'
                                            }`}
                                          >
                                            <span className="flex items-center gap-2 min-w-0">
                                              <MatIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                                              <span className="truncate">{mat.title}</span>
                                            </span>
                                            <span
                                              className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border flex-shrink-0 ${
                                                isDark ? style.badgeDark : style.badgeLight
                                              }`}
                                            >
                                              {style.label}
                                            </span>
                                          </button>
                                        );
                                      })}

                                      {vidEntry.video.driveLink && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setViewerMaterial({
                                              id: `drive-video-${vidEntry.video.url}`,
                                              title: `Resumen: ${vidEntry.title}`,
                                              material_type: 'summary',
                                              source_type: 'google_drive_legacy',
                                              file_url: vidEntry.video.driveLink,
                                            })
                                          }
                                          className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between gap-2 transition-colors cursor-pointer min-h-[36px] ${
                                            isDark
                                              ? 'bg-gray-900/70 hover:bg-gray-700 text-gray-200 border border-gray-700/80'
                                              : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'
                                          }`}
                                        >
                                          <span className="flex items-center gap-2 min-w-0">
                                            <FolderOpen className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                                            <span className="truncate">Resumen de la clase</span>
                                          </span>
                                          <span
                                            className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border flex-shrink-0 ${
                                              isDark ? MATERIAL_STYLE.summary.badgeDark : MATERIAL_STYLE.summary.badgeLight
                                            }`}
                                          >
                                            Drive
                                          </span>
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {sec.docLessons.length > 0 && (
                          <div className={`${sec.videos.length > 0 ? `pt-2 border-t ${dividerClass}` : ''} space-y-1.5`}>
                            <p className={`px-1.5 text-[11px] font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                              {sec.videos.length > 0 ? 'Materiales del Módulo' : 'PDFs y Diapositivas'}
                            </p>
                            {sec.docLessons.map((docEntry) => {
                              const mat = docEntry.material;
                              const style = MATERIAL_STYLE[mat.material_type] || MATERIAL_STYLE.pdf;
                              const MatIcon = style.Icon;
                              const isSelected = activeEntry?.key === docEntry.key;
                              return (
                                <button
                                  key={docEntry.key}
                                  type="button"
                                  onClick={() => setActiveLessonKey(docEntry.key)}
                                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium flex items-center justify-between gap-2 transition-colors cursor-pointer min-h-[40px] border ${
                                    isSelected
                                      ? isDark
                                        ? 'bg-indigo-950/60 border-indigo-500 text-indigo-200'
                                        : 'bg-indigo-50 border-indigo-500 text-indigo-900'
                                      : isDark
                                        ? 'bg-gray-900/60 hover:bg-gray-700 text-gray-200 border-gray-700'
                                        : 'bg-gray-50 hover:bg-gray-100 text-gray-800 border-gray-200'
                                  }`}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <MatIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                                    <span className="truncate">{docEntry.title}</span>
                                  </span>
                                  <span
                                    className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border flex-shrink-0 ${
                                      isDark ? style.badgeDark : style.badgeLight
                                    }`}
                                  >
                                    {style.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {sec.videos.length === 0 && sec.docLessons.length === 0 && (
                          <p className={`px-2 py-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            Este módulo no tiene videos ni documentos aún.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {generalLessons.length > 0 && (
                <div className={`rounded-xl border p-2.5 space-y-1.5 ${dividerClass} ${isDark ? 'bg-gray-900/40' : 'bg-gray-50'}`}>
                  <p className={`px-1 text-[11px] font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Recursos Generales
                  </p>
                  {generalLessons.map((docEntry) => {
                    const mat = docEntry.material;
                    const style = MATERIAL_STYLE[mat.material_type] || MATERIAL_STYLE.pdf;
                    const MatIcon = style.Icon;
                    const isSelected = activeEntry?.key === docEntry.key;
                    return (
                      <button
                        key={docEntry.key}
                        type="button"
                        onClick={() => setActiveLessonKey(docEntry.key)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium flex items-center justify-between gap-2 transition-colors cursor-pointer min-h-[40px] border ${
                          isSelected
                            ? isDark
                              ? 'bg-indigo-950/60 border-indigo-500 text-indigo-200'
                              : 'bg-indigo-50 border-indigo-500 text-indigo-900'
                            : isDark
                              ? 'bg-gray-800 hover:bg-gray-700 text-gray-200 border-gray-700'
                              : 'bg-white hover:bg-gray-100 text-gray-800 border-gray-200'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <MatIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                          <span className="truncate">{docEntry.title}</span>
                        </span>
                        <span
                          className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border flex-shrink-0 ${
                            isDark ? style.badgeDark : style.badgeLight
                          }`}
                        >
                          {style.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      <ProtectedDocumentViewer
        isOpen={Boolean(viewerMaterial)}
        onClose={() => setViewerMaterial(null)}
        material={viewerMaterial}
        isDark={isDark}
      />
    </section>
  );
}
