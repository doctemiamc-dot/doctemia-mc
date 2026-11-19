// src/app/app/coursesPagoUnico/ContenidoCursos/[courseId]/page.jsx
'use client';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import Swal from 'sweetalert2';
import ProtectedVideoPlayer from '@/app/components/video/ProtectedVideoPlayer';
import { cleanYouTubeUrl } from '@/lib/youtubeUtils';
import { buildCourseCurriculum } from '@/lib/courseCurriculum';
import {
    peekCachedPagoUnicoCourseById,
    getCachedPagoUnicoCourseById,
    peekCachedCourseMaterials,
    getCachedCourseMaterials,
} from '@/lib/catalogCache';
import {
    FileText,
    Video,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    FolderOpen,
    Presentation,
    BookOpen,
    Maximize2,
    Minimize2,
    ArrowLeft,
    Loader2,
} from 'lucide-react';

const ProtectedDocumentViewer = dynamic(
    () => import('@/app/components/documents/ProtectedDocumentViewer'),
    { ssr: false }
);

function resolveInitialSelection(courseData, loadedMaterials = []) {
    if (!courseData) return { key: null, moduleIdx: 0 };
    const { moduleSections, flatCurriculum } = buildCourseCurriculum(
        courseData,
        loadedMaterials
    );

    const search =
        typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search)
            : null;
    const matParam = search?.get('material') || '';
    const modParam = search ? Number.parseInt(search.get('module') || '', 10) : NaN;
    const vidParam = search ? Number.parseInt(search.get('video') || '', 10) : NaN;

    let initialEntry = null;
    if (matParam) {
        initialEntry =
            flatCurriculum.find(
                (item) =>
                    item.kind === 'material' &&
                    String(item.material?.id || '') === matParam
            ) || null;
    }
    if (!initialEntry && Number.isInteger(modParam) && moduleSections[modParam]) {
        const sec = moduleSections[modParam];
        if (Number.isInteger(vidParam)) {
            initialEntry =
                sec.videos.find((v) => v.videoIdx === vidParam) || null;
        }
        if (!initialEntry) {
            initialEntry = sec.videos[0] || sec.docLessons[0] || null;
        }
    }
    if (!initialEntry) {
        initialEntry =
            flatCurriculum.find((item) => item.kind === 'video') ||
            flatCurriculum[0] ||
            null;
    }

    if (initialEntry) {
        return {
            key: initialEntry.key,
            moduleIdx:
                initialEntry.moduleIdx !== null && initialEntry.moduleIdx !== undefined
                    ? initialEntry.moduleIdx
                    : -1,
        };
    }
    return {
        key: null,
        moduleIdx: Number.isInteger(modParam) && moduleSections[modParam] ? modParam : 0,
    };
}

function getMaterialMeta(materialType) {
    if (materialType === 'slides') {
        return { Icon: Presentation, badge: 'Diapositivas' };
    }
    if (materialType === 'summary') {
        return { Icon: BookOpen, badge: 'Resumen' };
    }
    return { Icon: FileText, badge: 'PDF' };
}

export default function ContenidoCursoPagoUnicoPage() {
    const { user, firebaseAuthUser, loading: authLoading } = useAuth();
    const { isDark } = useTheme();
    const isDarkRef = useRef(isDark);
    isDarkRef.current = isDark;
    const router = useRouter();
    const params = useParams();
    const courseId = params.courseId;

    const cachedCourseOnMount = peekCachedPagoUnicoCourseById(courseId);
    const cachedMaterialsOnMount = peekCachedCourseMaterials(courseId);
    const initialSelection = cachedCourseOnMount
        ? resolveInitialSelection(cachedCourseOnMount, cachedMaterialsOnMount || [])
        : { key: null, moduleIdx: 0 };

    const [courseDetails, setCourseDetails] = useState(cachedCourseOnMount);
    const [loading, setLoading] = useState(!cachedCourseOnMount);
    const [materialsLoading, setMaterialsLoading] = useState(
        Boolean(cachedCourseOnMount && cachedMaterialsOnMount === null)
    );
    const [error, setError] = useState(null);
    const [activeLessonKey, setActiveLessonKey] = useState(initialSelection.key);
    const [openModuleIndex, setOpenModuleIndex] = useState(initialSelection.moduleIdx);
    // --- ✅ CORRECCIÓN: Se añade el estado para el progreso del video ---
    const [videoProgress, setVideoProgress] = useState({});
    const [courseMaterials, setCourseMaterials] = useState(cachedMaterialsOnMount || []);
    const [viewerMaterial, setViewerMaterial] = useState(null);
    const [isTheaterMode, setIsTheaterMode] = useState(false);

    // --- Medida de Seguridad 1: Deshabilitar inspección de elementos (centralizado sin duplicar detectDevTools) ---
    useEffect(() => {
        const ua = navigator.userAgent || '';
        const isMobile =
            /iPhone|iPad|iPod|Android|Mobile/i.test(ua) ||
            (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) ||
            Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);

        const showSecurityWarning = () => {
            if (Swal.isVisible()) return;
            Swal.fire({
                title: 'Contenido Protegido',
                text: 'Las funciones de inspección, copia y descarga están deshabilitadas.',
                icon: 'warning',
                timer: 3000,
                showConfirmButton: false,
                background: isDark ? '#1f2937' : '#ffffff',
                color: isDark ? '#f9fafb' : '#111827',
            });
        };
        const handleKeyDown = (e) => {
            if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 67)) || (e.ctrlKey && e.keyCode === 85)) {
                e.preventDefault();
                showSecurityWarning();
                return false;
            }
        };
        const handleContextMenu = (e) => {
            e.preventDefault();
            if (!isMobile) {
                showSecurityWarning();
            }
            return false;
        };
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('contextmenu', handleContextMenu);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('contextmenu', handleContextMenu);
        };
    }, [isDark]);

    // --- ✅ CORRECCIÓN: Medida de Seguridad 2: Deshabilitar selección de texto ---
    useEffect(() => {
        const disableSelection = (e) => { e.preventDefault(); return false; };
        const disableDrag = (e) => { e.preventDefault(); return false; };
        document.addEventListener('selectstart', disableSelection);
        document.addEventListener('dragstart', disableDrag);
        return () => {
            document.removeEventListener('selectstart', disableSelection);
            document.removeEventListener('dragstart', disableDrag);
        };
    }, []);

    // --- Lógica principal para hidratar al instante desde caché y cargar materiales en paralelo ---
    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            router.push('/login');
            return;
        }

        if (!user.hasPagoUnicoAccess) {
            const darkNow = isDarkRef.current;
            Swal.fire({
                title: 'Acceso Denegado',
                text: 'No tienes permiso para acceder a esta sección.',
                icon: 'error',
                background: darkNow ? '#1f2937' : '#ffffff',
                color: darkNow ? '#f9fafb' : '#111827',
            });
            router.push('/app/pagoUnicoCourses');
            return;
        }

        if (!courseId) {
            setLoading(false);
            setError('ID de curso no proporcionado.');
            return;
        }

        let cancelled = false;

        const applyCourseAndSelection = (courseData, loadedMaterials, isInitial) => {
            if (courseData.isActive === false && user.role !== 'admin') {
                setError('Este curso no está disponible actualmente.');
                setLoading(false);
                return false;
            }
            setCourseDetails(courseData);
            if (Array.isArray(loadedMaterials)) {
                setCourseMaterials(loadedMaterials);
            }
            const search =
                typeof window !== 'undefined'
                    ? new URLSearchParams(window.location.search)
                    : null;
            const wantsMaterialParam = Boolean(search?.get('material'));

            setActiveLessonKey((prevKey) => {
                if (!isInitial && prevKey && !wantsMaterialParam) {
                    return prevKey;
                }
                const sel = resolveInitialSelection(courseData, loadedMaterials || []);
                setOpenModuleIndex(sel.moduleIdx);
                return sel.key;
            });
            setLoading(false);
            return true;
        };

        const loadCourseAndMaterials = async () => {
            setError(null);
            const getToken = () =>
                firebaseAuthUser && typeof firebaseAuthUser.getIdToken === 'function'
                    ? firebaseAuthUser.getIdToken()
                    : Promise.resolve(null);

            const cachedCourse = peekCachedPagoUnicoCourseById(courseId);
            const cachedMats = peekCachedCourseMaterials(courseId);

            if (cachedCourse) {
                const ok = applyCourseAndSelection(cachedCourse, cachedMats || [], true);
                if (!ok) return;
            } else {
                setLoading(true);
            }

            if (cachedMats !== null) {
                setCourseMaterials(cachedMats);
                setMaterialsLoading(false);
                if (cachedCourse) return;
            } else {
                setMaterialsLoading(true);
            }

            const materialsPromise =
                cachedMats !== null
                    ? Promise.resolve(cachedMats)
                    : getCachedCourseMaterials(courseId, getToken).catch(() => []);

            if (cachedCourse) {
                const loadedMaterials = await materialsPromise;
                if (cancelled) return;
                setMaterialsLoading(false);
                applyCourseAndSelection(cachedCourse, loadedMaterials, false);
                return;
            }

            try {
                const courseData = await getCachedPagoUnicoCourseById(courseId);
                if (cancelled) return;
                if (!courseData) {
                    setError('Curso no encontrado.');
                    setLoading(false);
                    setMaterialsLoading(false);
                    return;
                }
                const ok = applyCourseAndSelection(courseData, cachedMats || [], true);
                if (!ok) {
                    setMaterialsLoading(false);
                    return;
                }

                const loadedMaterials = await materialsPromise;
                if (cancelled) return;
                setMaterialsLoading(false);
                applyCourseAndSelection(courseData, loadedMaterials, false);
            } catch (err) {
                console.error("Error fetching course content:", err);
                if (!cancelled) {
                    setError('Error al cargar el contenido del curso.');
                    setLoading(false);
                    setMaterialsLoading(false);
                }
            }
        };

        loadCourseAndMaterials();

        return () => {
            cancelled = true;
        };
    }, [courseId, authLoading, user?.uid, user?.hasPagoUnicoAccess, user?.role, firebaseAuthUser, router]);

    const curriculum = useMemo(
        () => buildCourseCurriculum(courseDetails, courseMaterials),
        [courseDetails, courseMaterials]
    );

    const activeEntry = useMemo(() => {
        if (!curriculum.flatCurriculum.length) return null;
        return (
            curriculum.flatCurriculum.find((item) => item.key === activeLessonKey) ||
            curriculum.flatCurriculum[0]
        );
    }, [curriculum.flatCurriculum, activeLessonKey]);

    const activeVideo = activeEntry?.kind === 'video' ? activeEntry.video : null;

    // --- ✅ CORRECCIÓN: Se actualiza el progreso solo cuando avanza >= 1% para evitar re-renders cada tick ---
    const handleVideoProgress = (state) => {
        if (!activeVideo) return;
        const nextPct = Math.round((state.played || 0) * 100);
        setVideoProgress(prev => {
            const prevPlayed = prev[activeVideo.url]?.played;
            const prevPct = prevPlayed !== undefined ? Math.round(prevPlayed * 100) : -1;
            if (Math.abs(nextPct - prevPct) < 1) return prev;
            return {
                ...prev,
                [activeVideo.url]: { played: state.played }
            };
        });
    };

    if (loading || (authLoading && !courseDetails)) return (
        <div className={`flex flex-col gap-3 justify-center items-center h-screen ${isDark ? 'bg-[#060A13] text-slate-200' : 'bg-[#FFF9F0] text-[#1a2639]'}`}>
            <Loader2 className={`w-10 h-10 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
            <p className="text-sm font-bold">Cargando contenido del curso...</p>
        </div>
    );
    if (error) return <div className={`flex justify-center items-center h-screen ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}><p className="text-red-500">{error}</p></div>;
    if (!courseDetails) return <div className={`flex justify-center items-center h-screen ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}><p>No se encontraron detalles.</p></div>;

    const { moduleSections, generalLessons, flatCurriculum, totalVideos, totalDocs } = curriculum;

    const currentPlaylistIndex = activeEntry
        ? flatCurriculum.findIndex((item) => item.key === activeEntry.key)
        : -1;
    const prevEntry = currentPlaylistIndex > 0 ? flatCurriculum[currentPlaylistIndex - 1] : null;
    const nextEntry =
        currentPlaylistIndex >= 0 && currentPlaylistIndex < flatCurriculum.length - 1
            ? flatCurriculum[currentPlaylistIndex + 1]
            : null;

    const selectCurriculumEntry = (entry) => {
        if (!entry) return;
        setActiveLessonKey(entry.key);
        if (entry.moduleIdx !== null && entry.moduleIdx !== undefined) {
            setOpenModuleIndex(entry.moduleIdx);
        }
    };

    const cardSurface = isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
    const dividerClass = isDark ? 'border-gray-700' : 'border-gray-200';

    const contentSummaryText =
        totalVideos > 0 && totalDocs > 0
            ? `${totalVideos} ${totalVideos === 1 ? 'clase' : 'clases'} · ${totalDocs} ${totalDocs === 1 ? 'doc.' : 'docs.'}`
            : totalDocs > 0
                ? `${totalDocs} ${totalDocs === 1 ? 'documento' : 'documentos'}`
                : `${totalVideos} ${totalVideos === 1 ? 'clase' : 'clases'}`;

    const renderMainStage = (theater = false) => {
        if (activeEntry?.kind === 'video') {
            return (
                <div className={`w-full bg-black rounded-xl shadow-lg overflow-hidden aspect-video ${theater ? 'max-h-[82vh] mb-5' : 'max-h-[75vh]'}`}>
                    <ProtectedVideoPlayer
                        url={cleanYouTubeUrl(activeEntry.video.url)}
                        onProgress={handleVideoProgress}
                        width="100%"
                        height="100%"
                    />
                </div>
            );
        }

        if (activeEntry?.kind === 'material') {
            return (
                <div
                    className={`w-full ${
                        theater
                            ? 'h-[76vh] max-h-[84vh] mb-5'
                            : 'h-[64vh] sm:h-[70vh] lg:h-[76vh] min-h-[420px]'
                    }`}
                >
                    <ProtectedDocumentViewer
                        inline
                        isOpen
                        material={activeEntry.material}
                        isDark={isDark}
                        onExpandFullscreen={() => setViewerMaterial(activeEntry.material)}
                    />
                </div>
            );
        }

        return (
            <div
                className={`w-full rounded-xl border shadow-sm p-8 sm:p-12 flex flex-col items-center justify-center text-center gap-3 aspect-video max-h-[60vh] ${cardSurface} ${
                    theater ? 'mb-5' : ''
                }`}
            >
                <FolderOpen className={`w-12 h-12 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                <p className="text-base sm:text-lg font-semibold">
                    Este curso aún no tiene videos ni documentos disponibles.
                </p>
                <p className={`text-xs sm:text-sm max-w-md ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Cuando el docente publique las clases, PDFs o diapositivas, aparecerán aquí automáticamente.
                </p>
            </div>
        );
    };

    const activeVideoMaterials = activeEntry?.kind === 'video' ? activeEntry.attachments || [] : [];
    const hasVideoMaterials =
        activeEntry?.kind === 'video' &&
        (Boolean(activeEntry.video?.driveLink) || activeVideoMaterials.length > 0);
    const activeMatMeta =
        activeEntry?.kind === 'material'
            ? getMaterialMeta(activeEntry.material?.material_type)
            : null;

    return (
        <div className={`min-h-screen ${isDark ? 'bg-gray-900 text-gray-100' : 'bg-gray-100 text-gray-900'}`}>
            <header className={`${isDark ? 'bg-gray-800/95 border-gray-700' : 'bg-white/95 border-gray-200'} border-b backdrop-blur-sm sticky top-16 z-20`}>
                <div className="w-full max-w-[1800px] mx-auto px-3 sm:px-5 lg:px-6 py-3 flex items-center justify-between gap-3">
                    <Link
                        href="/app/pagoUnicoCourses"
                        prefetch={true}
                        className={`font-medium text-xs sm:text-sm inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition min-h-[38px] flex-shrink-0 cursor-pointer ${
                            isDark ? 'text-blue-400 hover:bg-gray-700' : 'text-blue-600 hover:bg-gray-100'
                        }`}
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span className="hidden sm:inline">Volver al Catálogo</span>
                        <span className="sm:hidden">Catálogo</span>
                    </Link>

                    <h1 className="text-sm sm:text-lg md:text-xl font-bold text-center flex-1 min-w-0 truncate px-2">
                        {courseDetails.title}
                    </h1>

                    <button
                        type="button"
                        onClick={() => setIsTheaterMode((prev) => !prev)}
                        title={isTheaterMode ? 'Vista estándar con panel lateral' : 'Expandir visor (Modo Teatro)'}
                        className={`hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition flex-shrink-0 min-h-[38px] cursor-pointer ${
                            isTheaterMode
                                ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-500'
                                : isDark
                                    ? 'border-gray-600 text-gray-200 hover:bg-gray-700'
                                    : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                        }`}
                    >
                        {isTheaterMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        <span>{isTheaterMode ? 'Vista estándar' : 'Modo teatro'}</span>
                    </button>
                </div>
            </header>

            <main className="w-full max-w-[1800px] mx-auto px-2 sm:px-4 lg:px-6 py-4 sm:py-5">
                {isTheaterMode && renderMainStage(true)}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                    <div className={isTheaterMode ? 'lg:col-span-7 xl:col-span-8 space-y-4 min-w-0' : 'lg:col-span-8 xl:col-span-9 space-y-4 min-w-0'}>
                        {!isTheaterMode && renderMainStage(false)}

                        {/* Información de la Lección / Documento Actual, Navegación y Materiales Integrados */}
                        {activeEntry && (
                            <div className={`p-4 sm:p-6 rounded-xl border shadow-sm ${cardSurface}`}>
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                    <div className="min-w-0 space-y-1">
                                        <p className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                            {activeEntry.moduleTitle}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="text-lg sm:text-xl font-semibold break-words">
                                                {activeEntry.title}
                                            </h2>
                                            {activeMatMeta && (
                                                <span
                                                    className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                                                        isDark
                                                            ? 'bg-blue-950/60 text-blue-300 border-blue-800'
                                                            : 'bg-blue-50 text-blue-700 border-blue-200'
                                                    }`}
                                                >
                                                    <activeMatMeta.Icon className="w-3 h-3" />
                                                    {activeMatMeta.badge}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                                        {activeEntry.kind === 'material' && (
                                            <button
                                                type="button"
                                                onClick={() => setViewerMaterial(activeEntry.material)}
                                                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition min-h-[40px] cursor-pointer ${
                                                    isDark
                                                        ? 'border-blue-500/40 bg-blue-900/30 text-blue-300 hover:bg-blue-900/50'
                                                        : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                                                }`}
                                            >
                                                <Maximize2 className="w-3.5 h-3.5" />
                                                <span>Pantalla completa</span>
                                            </button>
                                        )}

                                        {flatCurriculum.length > 1 && (
                                            <>
                                                <button
                                                    type="button"
                                                    disabled={!prevEntry}
                                                    onClick={() => selectCurriculumEntry(prevEntry)}
                                                    className={`inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-xs font-semibold transition min-h-[40px] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                                                        isDark
                                                            ? 'border-gray-600 text-gray-200 hover:bg-gray-700'
                                                            : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                                                    }`}
                                                >
                                                    <ChevronLeft className="w-4 h-4" />
                                                    Anterior
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={!nextEntry}
                                                    onClick={() => selectCurriculumEntry(nextEntry)}
                                                    className={`inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-xs font-semibold transition min-h-[40px] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                                                        isDark
                                                            ? 'border-gray-600 text-gray-200 hover:bg-gray-700'
                                                            : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                                                    }`}
                                                >
                                                    Siguiente
                                                    <ChevronRight className="w-4 h-4" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {hasVideoMaterials && (
                                    <div className={`mt-4 pt-4 border-t ${dividerClass} space-y-2`}>
                                        <h3 className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                            Material de Apoyo de la Clase:
                                        </h3>
                                        <div className="flex flex-wrap gap-2">
                                            {activeVideoMaterials.map((mat) => {
                                                const { Icon: MatIcon, badge: typeBadge } = getMaterialMeta(mat.material_type);
                                                return (
                                                    <button
                                                        key={mat.id}
                                                        type="button"
                                                        onClick={() => setViewerMaterial(mat)}
                                                        className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg font-medium text-sm transition cursor-pointer min-h-[42px] ${
                                                            isDark
                                                                ? 'bg-blue-900/30 hover:bg-blue-900/50 text-blue-300 border border-blue-700'
                                                                : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200'
                                                        }`}
                                                    >
                                                        <MatIcon className="h-4 w-4 flex-shrink-0" />
                                                        <span className="truncate max-w-[220px] sm:max-w-xs">{mat.title}</span>
                                                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${isDark ? 'bg-blue-950 text-blue-200' : 'bg-white text-blue-700 border border-blue-200'}`}>
                                                            {typeBadge}
                                                        </span>
                                                    </button>
                                                );
                                            })}

                                            {activeEntry.video.driveLink && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setViewerMaterial({
                                                            id: `drive-video-${activeEntry.video.url}`,
                                                            title: `Material: ${activeEntry.video.title || 'Clase'}`,
                                                            material_type: 'summary',
                                                            source_type: 'google_drive_legacy',
                                                            file_url: activeEntry.video.driveLink,
                                                        })
                                                    }
                                                    className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg font-medium text-sm transition cursor-pointer min-h-[42px] ${
                                                        isDark
                                                            ? 'bg-blue-900/30 hover:bg-blue-900/50 text-blue-300 border border-blue-700'
                                                            : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200'
                                                    }`}
                                                >
                                                    <FolderOpen className="h-4 w-4 flex-shrink-0" />
                                                    <span>Ver Resumen de la Clase</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className={`p-4 sm:p-6 rounded-xl border shadow-sm ${cardSurface}`}>
                            <h3 className="text-lg sm:text-xl font-semibold mb-2">Descripción del Curso</h3>
                            <p className={`text-sm sm:text-base ${isDark ? 'text-gray-300' : 'text-gray-600'} whitespace-pre-line`}>
                                {courseDetails.description || 'No hay descripción.'}
                            </p>

                            {generalLessons.length > 0 && (
                                <div className={`mt-6 pt-4 border-t ${dividerClass}`}>
                                    <h4 className="text-lg font-semibold mb-3">Recursos Generales del Curso</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {generalLessons.map((entry) => {
                                            const mat = entry.material;
                                            const { Icon: MatIcon, badge: typeBadge } = getMaterialMeta(mat.material_type);
                                            const isSelected = activeEntry?.key === entry.key;
                                            return (
                                                <button
                                                    key={entry.key}
                                                    type="button"
                                                    onClick={() => selectCurriculumEntry(entry)}
                                                    className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg font-semibold text-sm transition cursor-pointer min-h-[42px] border ${
                                                        isSelected
                                                            ? isDark
                                                                ? 'bg-blue-900/45 border-blue-500 text-blue-200'
                                                                : 'bg-blue-50 border-blue-500 text-blue-800'
                                                            : isDark
                                                                ? 'bg-gray-700 hover:bg-gray-600 border-gray-600 text-gray-100'
                                                                : 'bg-gray-100 hover:bg-gray-200 border-gray-200 text-gray-800'
                                                    }`}
                                                >
                                                    <MatIcon className="h-4 w-4 flex-shrink-0" />
                                                    <span className="truncate max-w-[220px] sm:max-w-xs">{entry.title}</span>
                                                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-700'}`}>
                                                        {typeBadge}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <aside className={isTheaterMode ? 'lg:col-span-5 xl:col-span-4 lg:sticky lg:top-32' : 'lg:col-span-4 xl:col-span-3 lg:sticky lg:top-32'}>
                        <div className={`p-4 rounded-xl border shadow-sm lg:max-h-[calc(100vh-9.5rem)] lg:overflow-y-auto ${cardSurface}`}>
                            <div className={`flex items-center justify-between gap-2 mb-3 pb-2.5 border-b ${dividerClass}`}>
                                <h3 className="text-base sm:text-lg font-semibold">Contenido</h3>
                                <div className="flex items-center gap-2">
                                    {materialsLoading && (
                                        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${isDark ? 'text-[#24B0BA]' : 'text-blue-600'}`}>
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            <span>Adjuntos...</span>
                                        </span>
                                    )}
                                    <span className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {contentSummaryText}
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                {moduleSections.map((sec) => {
                                    const moduleIdx = sec.moduleIdx;
                                    const isModuleOpen = openModuleIndex === moduleIdx;
                                    const moduleItemCount = sec.videos.length + sec.docLessons.length;

                                    return (
                                        <div key={moduleIdx} className={`rounded-xl border overflow-hidden ${dividerClass}`}>
                                            <button
                                                type="button"
                                                onClick={() => setOpenModuleIndex(isModuleOpen ? -1 : moduleIdx)}
                                                className={`w-full flex justify-between items-center gap-2 p-3 text-left font-semibold min-h-[44px] cursor-pointer ${
                                                    isDark ? 'bg-gray-700/50 hover:bg-gray-700' : 'bg-gray-50 hover:bg-gray-100'
                                                }`}
                                            >
                                                <span className="text-sm truncate flex-1">{sec.moduleTitle}</span>
                                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                                                    isDark ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-600 border border-gray-200'
                                                }`}>
                                                    {moduleItemCount}
                                                </span>
                                                <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${isModuleOpen ? 'rotate-180' : ''}`} />
                                            </button>

                                            {isModuleOpen && (
                                                <div className={`p-2 space-y-2 ${isDark ? 'bg-gray-800' : 'bg-white'}`}>
                                                    {sec.videos.length > 0 && (
                                                        <ul className="space-y-1.5">
                                                            {sec.videos.map((vidEntry) => {
                                                                const isSelected = activeEntry?.key === vidEntry.key;
                                                                const progress = videoProgress[vidEntry.video.url]?.played || 0;
                                                                const videoMats = vidEntry.attachments || [];
                                                                const hasMat = Boolean(vidEntry.video.driveLink) || videoMats.length > 0;

                                                                return (
                                                                    <li
                                                                        key={vidEntry.key}
                                                                        className={`rounded-lg ${
                                                                            isSelected
                                                                                ? isDark
                                                                                    ? 'bg-blue-950/40 ring-1 ring-blue-700/60'
                                                                                    : 'bg-blue-50/70 ring-1 ring-blue-200'
                                                                                : ''
                                                                        }`}
                                                                    >
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => selectCurriculumEntry(vidEntry)}
                                                                            className={`w-full text-left p-2.5 rounded-lg transition-colors flex items-center gap-2.5 relative overflow-hidden group min-h-[44px] cursor-pointer ${
                                                                                isSelected
                                                                                    ? isDark
                                                                                        ? 'text-blue-200'
                                                                                        : 'text-blue-900'
                                                                                    : isDark
                                                                                        ? 'hover:bg-gray-700/60'
                                                                                        : 'hover:bg-gray-100'
                                                                            }`}
                                                                        >
                                                                            <div
                                                                                className={`absolute left-0 top-0 h-full opacity-25 ${
                                                                                    isDark ? 'bg-green-800' : 'bg-green-200'
                                                                                }`}
                                                                                style={{ width: `${progress * 100}%` }}
                                                                            />
                                                                            <Video
                                                                                size={17}
                                                                                className={`relative flex-shrink-0 ${
                                                                                    isSelected
                                                                                        ? isDark
                                                                                            ? 'text-blue-300'
                                                                                            : 'text-blue-600'
                                                                                        : isDark
                                                                                            ? 'text-gray-400'
                                                                                            : 'text-gray-500'
                                                                                }`}
                                                                            />
                                                                            <div className="relative flex flex-col flex-grow min-w-0">
                                                                                <div className="flex items-start justify-between gap-2">
                                                                                    <span className="text-sm font-medium break-words">
                                                                                        {vidEntry.title}
                                                                                    </span>
                                                                                    {hasMat && (
                                                                                        <span
                                                                                            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                                                                                                isDark
                                                                                                    ? 'bg-gray-700 text-blue-300'
                                                                                                    : 'bg-white text-blue-700 border border-blue-200'
                                                                                            }`}
                                                                                            title="Incluye material de apoyo"
                                                                                        >
                                                                                            <FolderOpen size={11} />
                                                                                            {videoMats.length + (vidEntry.video.driveLink ? 1 : 0)}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                {progress > 0 && (
                                                                                    <span className={`text-xs ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                                                                                        {Math.round(progress * 100)}% visto
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </button>

                                                                        {hasMat && (
                                                                            <div className="px-2 pb-2 space-y-1">
                                                                                {videoMats.map((mat) => {
                                                                                    const { Icon: MatIcon, badge: typeLabel } = getMaterialMeta(mat.material_type);
                                                                                    return (
                                                                                        <button
                                                                                            key={mat.id}
                                                                                            type="button"
                                                                                            onClick={() => setViewerMaterial(mat)}
                                                                                            className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between gap-2 transition cursor-pointer min-h-[36px] ${
                                                                                                isDark
                                                                                                    ? 'bg-gray-900/70 hover:bg-gray-700 text-gray-200 border border-gray-700'
                                                                                                    : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'
                                                                                            }`}
                                                                                        >
                                                                                            <span className="flex items-center gap-1.5 min-w-0">
                                                                                                <MatIcon className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                                                                                                <span className="truncate">{mat.title}</span>
                                                                                            </span>
                                                                                            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
                                                                                                isDark ? 'bg-gray-800 text-blue-300' : 'bg-blue-50 text-blue-700'
                                                                                            }`}>
                                                                                                {typeLabel}
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
                                                                                                title: `Material: ${vidEntry.title}`,
                                                                                                material_type: 'summary',
                                                                                                source_type: 'google_drive_legacy',
                                                                                                file_url: vidEntry.video.driveLink,
                                                                                            })
                                                                                        }
                                                                                        className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between gap-2 transition cursor-pointer min-h-[36px] ${
                                                                                            isDark
                                                                                                ? 'bg-gray-900/70 hover:bg-gray-700 text-gray-200 border border-gray-700'
                                                                                                : 'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200'
                                                                                        }`}
                                                                                    >
                                                                                        <span className="flex items-center gap-1.5 min-w-0">
                                                                                            <FolderOpen className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                                                                                            <span className="truncate">Resumen de la clase</span>
                                                                                        </span>
                                                                                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
                                                                                            isDark ? 'bg-gray-800 text-amber-300' : 'bg-amber-50 text-amber-700'
                                                                                        }`}>
                                                                                            Drive
                                                                                        </span>
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </li>
                                                                );
                                                            })}
                                                        </ul>
                                                    )}

                                                    {sec.docLessons.length > 0 && (
                                                        <div className={`${sec.videos.length > 0 ? `pt-2 border-t ${dividerClass}` : ''} space-y-1.5`}>
                                                            <p className={`px-1.5 text-[11px] font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                                                {sec.videos.length > 0
                                                                    ? 'Materiales del Módulo'
                                                                    : 'PDFs y Diapositivas'}
                                                            </p>
                                                            {sec.docLessons.map((docEntry) => {
                                                                const mat = docEntry.material;
                                                                const { Icon: MatIcon, badge: typeLabel } = getMaterialMeta(mat.material_type);
                                                                const isSelected = activeEntry?.key === docEntry.key;
                                                                return (
                                                                    <button
                                                                        key={docEntry.key}
                                                                        type="button"
                                                                        onClick={() => selectCurriculumEntry(docEntry)}
                                                                        className={`w-full text-left px-2.5 py-2.5 rounded-lg text-xs font-medium flex items-center justify-between gap-2 transition cursor-pointer min-h-[42px] border ${
                                                                            isSelected
                                                                                ? isDark
                                                                                    ? 'bg-blue-950/55 border-blue-600 text-blue-200 ring-1 ring-blue-600/50'
                                                                                    : 'bg-blue-50 border-blue-400 text-blue-900 ring-1 ring-blue-300/60'
                                                                                : isDark
                                                                                    ? 'bg-gray-900/60 hover:bg-gray-700 text-gray-200 border-gray-700'
                                                                                    : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                                                                        }`}
                                                                    >
                                                                        <span className="flex items-center gap-2 min-w-0">
                                                                            <MatIcon className={`w-4 h-4 flex-shrink-0 ${
                                                                                isSelected
                                                                                    ? isDark ? 'text-blue-300' : 'text-blue-600'
                                                                                    : isDark ? 'text-indigo-300' : 'text-indigo-600'
                                                                            }`} />
                                                                            <span className="truncate">{docEntry.title}</span>
                                                                        </span>
                                                                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
                                                                            isDark ? 'bg-gray-800 text-gray-300' : 'bg-white text-indigo-700 border border-indigo-100'
                                                                        }`}>
                                                                            {typeLabel}
                                                                        </span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}

                                                    {sec.videos.length === 0 && sec.docLessons.length === 0 && (
                                                        <p className={`px-2 py-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                                            Este módulo aún no tiene contenido adjunto.
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {generalLessons.length > 0 && (
                                    <div className={`rounded-xl border p-2.5 space-y-1.5 ${dividerClass} ${isDark ? 'bg-gray-900/35' : 'bg-slate-50/70'}`}>
                                        <p className={`px-1 text-[11px] font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                            Recursos Generales del Curso
                                        </p>
                                        {generalLessons.map((docEntry) => {
                                            const mat = docEntry.material;
                                            const { Icon: MatIcon, badge: typeLabel } = getMaterialMeta(mat.material_type);
                                            const isSelected = activeEntry?.key === docEntry.key;
                                            return (
                                                <button
                                                    key={docEntry.key}
                                                    type="button"
                                                    onClick={() => selectCurriculumEntry(docEntry)}
                                                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium flex items-center justify-between gap-2 transition cursor-pointer min-h-[40px] border ${
                                                        isSelected
                                                            ? isDark
                                                                ? 'bg-blue-950/55 border-blue-600 text-blue-200 ring-1 ring-blue-600/50'
                                                                : 'bg-blue-50 border-blue-400 text-blue-900 ring-1 ring-blue-300/60'
                                                            : isDark
                                                                ? 'bg-gray-800 hover:bg-gray-700 text-gray-200 border-gray-700'
                                                                : 'bg-white hover:bg-slate-100 text-slate-800 border-slate-200'
                                                    }`}
                                                >
                                                    <span className="flex items-center gap-2 min-w-0">
                                                        <MatIcon className="w-3.5 h-3.5 flex-shrink-0 text-blue-500" />
                                                        <span className="truncate">{docEntry.title}</span>
                                                    </span>
                                                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
                                                        isDark ? 'bg-gray-900 text-gray-300' : 'bg-slate-100 text-slate-700'
                                                    }`}>
                                                        {typeLabel}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </aside>
                </div>
            </main>

            <ProtectedDocumentViewer
                isOpen={Boolean(viewerMaterial)}
                onClose={() => setViewerMaterial(null)}
                material={viewerMaterial}
                isDark={isDark}
            />
        </div>
    );
}