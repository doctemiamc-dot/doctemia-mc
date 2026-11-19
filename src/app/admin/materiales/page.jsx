'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { db } from '@/lib/firebase';
import {
  getCachedCategories,
  getCachedPagoUnicoCourses,
  getCachedSubcategories,
} from '@/lib/catalogCache';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { validateMaterialFile } from '@/lib/materialUtils';
import { matchesVideoUrl } from '@/lib/youtubeUtils';
import ProtectedDocumentViewer from '@/app/components/documents/ProtectedDocumentViewer';
import Swal from 'sweetalert2';
import { toast, Toaster } from 'react-hot-toast';
import {
  UploadCloud,
  FileText,
  Presentation,
  BookOpen,
  Trash2,
  Eye,
  Edit3,
  Search,
  FolderOpen,
  Link as LinkIcon,
  Plus,
  X,
  Loader2,
  CheckCircle2,
  Video,
  GraduationCap,
  ChevronLeft,
  ChevronRight,
  LayoutList,
  LayoutGrid,
  CheckSquare,
  Square,
  EyeOff,
  ChevronDown,
} from 'lucide-react';

function formatBytes(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return '—';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(0)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function resolveCourseLocationLabel(mat, course) {
  if (!course) return 'Material de curso';
  const modules = Array.isArray(course.modules) ? course.modules : [];

  if (mat.video_url) {
    for (let mIdx = 0; mIdx < modules.length; mIdx += 1) {
      const mod = modules[mIdx];
      const modTitle = mod.title || `Módulo ${mIdx + 1}`;
      const matchedVid = (mod.videos || []).find((v) =>
        matchesVideoUrl(mat.video_url, v.url)
      );
      if (matchedVid) {
        return matchedVid.title ? `${modTitle} · ${matchedVid.title}` : modTitle;
      }
    }
    return 'Vinculado a video';
  }

  if (mat.module_index !== null && mat.module_index !== undefined) {
    const mod = modules[mat.module_index];
    return mod?.title || `Módulo ${Number(mat.module_index) + 1}`;
  }

  return 'General del curso';
}

export default function AdminMaterialesPage() {
  const { isDark, isLoaded } = useTheme();
  const { firebaseAuthUser } = useAuth();
  const fileInputRef = useRef(null);
  const fetchSeqRef = useRef(0);

  // Catálogos Firestore
  const [categories, setCategories] = useState([]);
  const [subcategoriesMap, setSubcategoriesMap] = useState({});
  const [courses, setCourses] = useState([]);

  // Listado paginado en servidor
  const [materials, setMaterials] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 24,
    total: 0,
    totalPages: 1,
  });
  const [counts, setCounts] = useState({
    all: 0,
    courses: 0,
    live_classes: 0,
    library: 0,
    hidden: 0,
  });
  const [initialLoading, setInitialLoading] = useState(true);
  const [fetchingList, setFetchingList] = useState(false);

  // Filtros en servidor
  const [originFilter, setOriginFilter] = useState('all'); // 'all' | 'courses' | 'live_classes' | 'library'
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterEsp, setFilterEsp] = useState('');
  const [filterCourse, setFilterCourse] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterSource, setFilterSource] = useState(''); // '' | 'supabase_storage' | 'google_drive_legacy' | 'external_url'
  const [filterVisibility, setFilterVisibility] = useState(''); // '' | 'true' | 'false'
  const [sortBy, setSortBy] = useState('newest'); // 'newest' | 'oldest' | 'title_asc' | 'largest'
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'grid'

  // Panel colapsable de subida
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState('files'); // 'files' | 'link'
  const [stagedFiles, setStagedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Metadatos del formulario de subida
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [materialType, setMaterialType] = useState('pdf');
  const [especialidadId, setEspecialidadId] = useState('');
  const [subtema, setSubtema] = useState('');
  const [courseId, setCourseId] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [externalUrl, setExternalUrl] = useState('');

  // Selección masiva, edición rápida y visor
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [viewerMaterial, setViewerMaterial] = useState(null);
  const [loadingViewerId, setLoadingViewerId] = useState(null);
  const [editingMaterial, setEditingMaterial] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f8fafc' : '#1a2639',
      confirmButtonColor: '#014ba0',
      cancelButtonColor: '#dc2626',
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

  // Debounce del buscador para no bombardear SQL en cada tecla
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Cargar catálogos ligeros desde caché de sesión (cursos y especialidades; subtemas bajo demanda)
  useEffect(() => {
    const loadCatalogs = async () => {
      try {
        const [cats, puCourses] = await Promise.all([
          getCachedCategories(),
          getCachedPagoUnicoCourses({ onlyActive: false }),
        ]);

        setCategories(cats);
        setCourses(puCourses);
      } catch (err) {
        console.error('Error cargando catálogos en /admin/materiales:', err);
      }
    };
    loadCatalogs();
  }, []);

  // Cargar subtemas solo de la especialidad seleccionada en el formulario (con caché)
  useEffect(() => {
    if (!especialidadId || subcategoriesMap[especialidadId]) return;
    let cancelled = false;
    const loadSubthemes = async () => {
      try {
        const subs = await getCachedSubcategories(especialidadId);
        if (cancelled) return;
        setSubcategoriesMap((prev) => ({
          ...prev,
          [especialidadId]: subs,
        }));
      } catch (err) {
        console.error('Error cargando subtemas:', err);
      }
    };
    loadSubthemes();
    return () => {
      cancelled = true;
    };
  }, [especialidadId, subcategoriesMap]);

  const fetchMaterialsPage = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setFetchingList(true);
    try {
      const params = new URLSearchParams({
        include_inactive: 'true',
        page: String(page),
        pageSize: String(pageSize),
        sort: sortBy,
      });

      if (originFilter !== 'all') params.set('origin', originFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (filterEsp) params.set('especialidad_id', filterEsp);
      if (filterCourse) params.set('course_id', filterCourse);
      if (filterType) params.set('material_type', filterType);
      if (filterSource) params.set('source_type', filterSource);
      if (filterVisibility) params.set('is_active', filterVisibility);

      const headers = await getAuthHeaders();
      const res = await fetch(`/api/materials?${params.toString()}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al consultar materiales');
      if (seq !== fetchSeqRef.current) return;

      setMaterials(data.materials || []);
      if (data.pagination) setPagination(data.pagination);
      if (data.counts) setCounts(data.counts);
      setSelectedIds([]);
    } catch (err) {
      if (seq === fetchSeqRef.current) {
        toast.error(err.message);
      }
    } finally {
      if (seq === fetchSeqRef.current) {
        setInitialLoading(false);
        setFetchingList(false);
      }
    }
  }, [
    getAuthHeaders,
    page,
    pageSize,
    sortBy,
    originFilter,
    debouncedSearch,
    filterEsp,
    filterCourse,
    filterType,
    filterSource,
    filterVisibility,
  ]);

  useEffect(() => {
    if (!firebaseAuthUser) return;
    fetchMaterialsPage();
  }, [firebaseAuthUser, fetchMaterialsPage]);

  const courseMap = useMemo(
    () => new Map(courses.map((c) => [c.id, c])),
    [courses]
  );

  const availableSubthemes = useMemo(() => {
    if (!especialidadId) return [];
    return subcategoriesMap[especialidadId] || [];
  }, [especialidadId, subcategoriesMap]);

  const selectedCourseVideos = useMemo(() => {
    if (!courseId) return [];
    const course = courseMap.get(courseId);
    if (!course?.modules) return [];
    const list = [];
    course.modules.forEach((mod, modIdx) => {
      (mod.videos || []).forEach((vid) => {
        if (vid.url) {
          list.push({
            moduleIndex: modIdx,
            label: `${mod.title || `Módulo ${modIdx + 1}`} → ${vid.title || 'Video'}`,
            url: vid.url,
          });
        }
      });
    });
    return list;
  }, [courseId, courseMap]);

  const handleFilesAdded = (fileList) => {
    const incoming = Array.from(fileList || []);
    const validFiles = [];
    for (const f of incoming) {
      const check = validateMaterialFile(f.name, f.type);
      if (!check.valid) {
        toast.error(`${f.name}: ${check.error}`);
        continue;
      }
      validFiles.push(f);
    }
    if (validFiles.length > 0) {
      setStagedFiles((prev) => [...prev, ...validFiles]);
    }
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (uploading) return;

    const espObj = categories.find((c) => c.id === especialidadId);
    const matchedVideo = selectedCourseVideos.find((v) => v.url === videoUrl);

    if (uploadMode === 'files') {
      if (stagedFiles.length === 0) {
        toast.error('Selecciona o arrastra al menos un documento.');
        return;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        stagedFiles.forEach((file) => formData.append('files', file));
        if (title.trim()) formData.append('title', title.trim());
        if (description.trim()) formData.append('description', description.trim());
        formData.append('material_type', materialType);
        if (especialidadId) formData.append('especialidad_id', especialidadId);
        if (espObj?.name) formData.append('especialidad_nombre', espObj.name);
        if (subtema) formData.append('subtema', subtema);
        if (courseId) formData.append('course_id', courseId);
        if (matchedVideo) formData.append('module_index', String(matchedVideo.moduleIndex));
        if (videoUrl) formData.append('video_url', videoUrl);

        const headers = await getAuthHeaders();
        const res = await fetch('/api/materials', {
          method: 'POST',
          headers,
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error subiendo archivos');

        toast.success(`${data.materials?.length || stagedFiles.length} material(es) publicado(s).`);
        setStagedFiles([]);
        setTitle('');
        setDescription('');
        setVideoUrl('');
        setPage(1);
        await fetchMaterialsPage();
      } catch (err) {
        Swal.fire({ title: 'Error', text: err.message, icon: 'error', ...swalTheme });
      } finally {
        setUploading(false);
      }
      return;
    }

    if (!title.trim() || !externalUrl.trim()) {
      toast.error('Ingresa el título y el enlace del material.');
      return;
    }

    setUploading(true);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/materials', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          material_type: materialType,
          source_type:
            externalUrl.includes('drive.google.com') || externalUrl.includes('docs.google.com')
              ? 'google_drive_legacy'
              : 'external_url',
          file_url: externalUrl.trim(),
          especialidad_id: especialidadId || null,
          especialidad_nombre: espObj?.name || null,
          subtema: subtema || null,
          course_id: courseId || null,
          module_index: matchedVideo ? matchedVideo.moduleIndex : null,
          video_url: videoUrl || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error guardando enlace');

      toast.success('Enlace guardado en la biblioteca.');
      setTitle('');
      setDescription('');
      setExternalUrl('');
      setVideoUrl('');
      setPage(1);
      await fetchMaterialsPage();
    } catch (err) {
      Swal.fire({ title: 'Error', text: err.message, icon: 'error', ...swalTheme });
    } finally {
      setUploading(false);
    }
  };

  const handleOpenViewer = async (mat) => {
    if (!mat) return;
    // Para archivos privados de Storage obtenemos `signed_url` bajo demanda (útil en Office/fallback)
    if (mat.source_type === 'supabase_storage' && !mat.signed_url) {
      setLoadingViewerId(mat.id);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/materials/${mat.id}`, { headers });
        const data = await res.json();
        if (res.ok && data.material) {
          setViewerMaterial(data.material);
          return;
        }
      } catch {
        // Fallback al objeto actual con `proxy_url`
      } finally {
        setLoadingViewerId(null);
      }
    }
    setViewerMaterial(mat);
  };

  const handleToggleActive = async (mat) => {
    if (!mat?.id || togglingId === mat.id) return;
    const nextActive = !mat.is_active;
    setTogglingId(mat.id);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`/api/materials/${mat.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ is_active: nextActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo cambiar visibilidad');
      toast.success(nextActive ? 'Material visible' : 'Material ocultado');
      await fetchMaterialsPage();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (mat) => {
    const isLiveClass = mat.origin_type === 'live_class';
    const result = await Swal.fire({
      title: '¿Eliminar material?',
      text: isLiveClass
        ? `Se eliminará "${mat.title}" (pertenece a la clase en vivo "${
            mat.live_class_info?.titulo || mat.subtema || ''
          }") junto con su archivo en Storage.`
        : `Se eliminará "${mat.title}" de la BD${
            mat.source_type === 'supabase_storage' ? ' y del almacenamiento Storage' : ''
          }.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      ...swalTheme,
      confirmButtonColor: '#dc2626',
    });

    if (!result.isConfirmed) return;

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/materials/${mat.id}`, { method: 'DELETE', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar');
      toast.success('Material eliminado de BD y Storage.');
      await fetchMaterialsPage();
    } catch (err) {
      Swal.fire({ title: 'Error', text: err.message, icon: 'error', ...swalTheme });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0 || bulkDeleting) return;
    const confirm = await Swal.fire({
      title: `¿Eliminar ${selectedIds.length} materiales?`,
      text: 'Se borrarán permanentemente sus registros en PostgreSQL, sus archivos en Supabase Storage y cualquier vínculo con clases en vivo.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar lote',
      cancelButtonText: 'Cancelar',
      ...swalTheme,
      confirmButtonColor: '#dc2626',
    });
    if (!confirm.isConfirmed) return;

    setBulkDeleting(true);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/materials', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ ids: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudieron eliminar');
      toast.success(
        `${data.deletedCount || selectedIds.length} materiales y ${
          data.deletedFilesCount || 0
        } archivo(s) eliminados`
      );
      setSelectedIds([]);
      await fetchMaterialsPage();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingMaterial || savingEdit) return;
    setSavingEdit(true);
    try {
      const espObj = categories.find((c) => c.id === editingMaterial.especialidad_id);
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`/api/materials/${editingMaterial.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          title: editingMaterial.title,
          description: editingMaterial.description,
          material_type: editingMaterial.material_type,
          especialidad_id: editingMaterial.especialidad_id || null,
          especialidad_nombre: espObj?.name || editingMaterial.especialidad_nombre || null,
          subtema: editingMaterial.subtema || null,
          course_id: editingMaterial.course_id || null,
          is_active: editingMaterial.is_active,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo actualizar');
      toast.success('Material actualizado.');
      setEditingMaterial(null);
      await fetchMaterialsPage();
    } catch (err) {
      Swal.fire({ title: 'Error', text: err.message, icon: 'error', ...swalTheme });
    } finally {
      setSavingEdit(false);
    }
  };

  const resetAllFilters = () => {
    setOriginFilter('all');
    setSearchInput('');
    setDebouncedSearch('');
    setFilterEsp('');
    setFilterCourse('');
    setFilterType('');
    setFilterSource('');
    setFilterVisibility('');
    setSortBy('newest');
    setPage(1);
  };

  const hasActiveFilters =
    originFilter !== 'all' ||
    Boolean(searchInput.trim()) ||
    Boolean(filterEsp) ||
    Boolean(filterCourse) ||
    Boolean(filterType) ||
    Boolean(filterSource) ||
    Boolean(filterVisibility) ||
    sortBy !== 'newest';

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = materials.map((m) => m.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  if (!isLoaded || initialLoading) {
    return (
      <div
        className={`min-h-[calc(100vh-4rem)] flex items-center justify-center gap-3 ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <Loader2 className={`w-7 h-7 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
        <span className="text-sm font-bold">Cargando biblioteca de materiales...</span>
      </div>
    );
  }

  const pageBg = isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]';
  const surfaceClass = isDark
    ? 'bg-[#1e293b] border-white/10 text-white'
    : 'bg-white border-[#2E4A70]/15 text-[#1a2639]';
  const inputClass = isDark
    ? 'bg-[#162235] border-white/15 text-white placeholder:text-slate-400 focus:border-[#24B0BA]'
    : 'bg-white border-[#2E4A70]/25 text-[#1a2639] placeholder:text-slate-400 focus:border-[#014ba0]';
  const optionClass = isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]';
  const selectColorScheme = { colorScheme: isDark ? 'dark' : 'light' };

  const renderOriginBadgeBlock = (mat) => {
    const course = mat.course_id ? courseMap.get(mat.course_id) : null;

    if (mat.origin_type === 'live_class') {
      const liveTitle = mat.live_class_info?.titulo || mat.subtema || 'Sesión en vivo';
      const liveDate = mat.live_class_info?.occurrence_date;
      return (
        <div className="space-y-1 min-w-0 max-w-full">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md ${
                isDark
                  ? 'bg-[#24B0BA]/20 text-[#24B0BA] border border-[#24B0BA]/30'
                  : 'bg-[#24B0BA]/15 text-[#0b6168] border border-[#24B0BA]/30'
              }`}
            >
              <Video className="w-3 h-3 shrink-0" />
              <span>Clase en Vivo</span>
            </span>
            {liveDate && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-md tabular-nums ${
                  isDark ? 'bg-white/10 text-blue-100' : 'bg-[#F0F2F2] text-[#2E4A70]'
                }`}
              >
                {liveDate}
              </span>
            )}
          </div>
          <p className={`text-xs font-semibold truncate lg:max-w-[260px] ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`} title={liveTitle}>
            {liveTitle}
          </p>
          {course && (
            <p className="text-[10px] opacity-75 truncate lg:max-w-[260px]">
              Curso: {course.title}
            </p>
          )}
        </div>
      );
    }

    if (mat.origin_type === 'course' || mat.course_id) {
      const courseName = course?.title || 'Curso vinculado (eliminado o inactivo)';
      const subLocation = course ? resolveCourseLocationLabel(mat, course) : mat.subtema || 'Material de curso';
      return (
        <div className="space-y-1 min-w-0 max-w-full">
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md max-w-full lg:max-w-[260px] truncate ${
              isDark
                ? 'bg-[#CF8A40]/20 text-amber-200 border border-[#CF8A40]/35'
                : 'bg-[#CF8A40]/15 text-[#8a4f14] border border-[#CF8A40]/30'
            }`}
            title={courseName}
          >
            <GraduationCap className="w-3 h-3 shrink-0" />
            <span className="truncate">{courseName}</span>
          </span>
          <p className={`text-xs font-semibold truncate lg:max-w-[260px] ${isDark ? 'text-blue-200/85' : 'text-[#2E4A70]'}`} title={subLocation}>
            {subLocation}
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-1 min-w-0 max-w-full">
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md ${
            isDark
              ? 'bg-white/10 text-blue-200 border border-white/15'
              : 'bg-[#014ba0]/10 text-[#014ba0] border border-[#014ba0]/20'
          }`}
        >
          <FolderOpen className="w-3 h-3 shrink-0" />
          <span>Biblioteca General</span>
        </span>
        {(mat.especialidad_nombre || mat.subtema) && (
          <p className={`text-xs truncate lg:max-w-[240px] ${isDark ? 'text-slate-300' : 'text-[#2E4A70]'}`}>
            {[mat.especialidad_nombre, mat.subtema].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    );
  };

  const renderMaterialActions = (mat) => (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={loadingViewerId === mat.id}
        onClick={() => handleOpenViewer(mat)}
        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
          isDark
            ? 'border-white/15 bg-white/5 hover:bg-white/10 text-blue-200'
            : 'border-[#2E4A70]/20 bg-white hover:bg-slate-100 text-[#014ba0]'
        }`}
        title="Abrir visor protegido"
      >
        {loadingViewerId === mat.id ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Eye className="w-3.5 h-3.5" />
        )}
        <span>Ver</span>
      </button>
      <button
        type="button"
        onClick={() => setEditingMaterial({ ...mat })}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold cursor-pointer transition-colors"
        title="Editar metadatos"
      >
        <Edit3 className="w-3.5 h-3.5" />
        <span>Editar</span>
      </button>
      <button
        type="button"
        onClick={() => handleDelete(mat)}
        className={`inline-flex items-center gap-1 p-1.5 rounded-xl border cursor-pointer transition-colors ${
          isDark
            ? 'border-red-500/30 bg-red-500/15 hover:bg-red-500/25 text-red-300'
            : 'border-red-200 bg-red-50 hover:bg-red-100 text-red-600'
        }`}
        title="Eliminar de BD y Storage"
        aria-label={`Eliminar ${mat.title}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd = Math.min(pagination.page * pagination.pageSize, pagination.total);

  return (
    <div className={`min-h-[calc(100vh-4rem)] w-full min-w-0 overflow-x-hidden p-3 sm:p-6 ${pageBg}`}>
      <div className="w-full max-w-7xl mx-auto min-w-0 space-y-5">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2.5">
              <FolderOpen className={`w-7 h-7 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
              <span>Biblioteca y Materiales</span>
            </h1>
            <p className={`text-xs sm:text-sm font-medium mt-1 ${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]'}`}>
              Listado paginado en PostgreSQL + Supabase Storage con origen exacto por curso, módulo y clase en vivo.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setUploadPanelOpen((v) => !v)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white font-bold text-xs sm:text-sm cursor-pointer transition-colors self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>{uploadPanelOpen ? 'Ocultar formulario' : 'Subir / Registrar Material'}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${uploadPanelOpen ? 'rotate-180' : ''}`} />
          </button>
        </header>

        {/* Formulario colapsable de Carga Múltiple */}
        {uploadPanelOpen && (
          <form onSubmit={handleUploadSubmit} className={`p-5 sm:p-6 rounded-2xl border space-y-5 ${surfaceClass}`}>
            <div
              className={`flex flex-wrap items-center justify-between gap-3 border-b pb-4 ${
                isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
              }`}
            >
              <h2 className="text-base sm:text-lg font-extrabold flex items-center gap-2">
                <UploadCloud className={`w-5 h-5 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
                <span>Publicar Nuevo Material</span>
              </h2>
              <div
                className={`inline-flex rounded-xl p-1 border ${
                  isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0] border-[#2E4A70]/15'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setUploadMode('files')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    uploadMode === 'files'
                      ? 'bg-[#014ba0] text-white'
                      : isDark
                      ? 'text-slate-300'
                      : 'text-[#2E4A70]'
                  }`}
                >
                  Subir Archivos (Storage)
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode('link')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    uploadMode === 'link'
                      ? 'bg-[#014ba0] text-white'
                      : isDark
                      ? 'text-slate-300'
                      : 'text-[#2E4A70]'
                  }`}
                >
                  Enlace Drive / Externo
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5 min-w-0">
              <div className="min-w-0">
                <label className="block text-xs font-bold mb-1.5 opacity-80">Especialidad</label>
                <select
                  value={especialidadId}
                  onChange={(e) => {
                    setEspecialidadId(e.target.value);
                    setSubtema('');
                  }}
                  style={selectColorScheme}
                  className={`w-full min-w-0 max-w-full truncate p-2.5 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                >
                  <option value="" className={optionClass}>-- General / Todas --</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id} className={optionClass}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="min-w-0">
                <label className="block text-xs font-bold mb-1.5 opacity-80">Tema / Subtema</label>
                <select
                  value={subtema}
                  onChange={(e) => setSubtema(e.target.value)}
                  disabled={!especialidadId}
                  style={selectColorScheme}
                  className={`w-full min-w-0 max-w-full truncate p-2.5 rounded-xl border text-xs sm:text-sm outline-none disabled:opacity-50 ${inputClass}`}
                >
                  <option value="" className={optionClass}>-- Todos / Sin subtema --</option>
                  {availableSubthemes.map((s) => (
                    <option key={s.id} value={s.name} className={optionClass}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="min-w-0">
                <label className="block text-xs font-bold mb-1.5 opacity-80">Curso (Pago Único)</label>
                <select
                  value={courseId}
                  onChange={(e) => {
                    setCourseId(e.target.value);
                    setVideoUrl('');
                  }}
                  style={selectColorScheme}
                  className={`w-full min-w-0 max-w-full truncate p-2.5 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                >
                  <option value="" className={optionClass}>-- Sin curso (Biblioteca general) --</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id} className={optionClass}>{c.title}</option>
                  ))}
                </select>
              </div>

              <div className="min-w-0">
                <label className="block text-xs font-bold mb-1.5 opacity-80">Tipo de Material</label>
                <select
                  value={materialType}
                  onChange={(e) => setMaterialType(e.target.value)}
                  style={selectColorScheme}
                  className={`w-full min-w-0 max-w-full truncate p-2.5 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                >
                  <option value="pdf" className={optionClass}>PDF / Guía</option>
                  <option value="slides" className={optionClass}>Diapositivas / Presentación</option>
                  <option value="summary" className={optionClass}>Resumen</option>
                </select>
              </div>
            </div>

            {courseId && selectedCourseVideos.length > 0 && (
              <div className="min-w-0">
                <label className="block text-xs font-bold mb-1.5 opacity-80">
                  Vincular a clase específica del curso (Opcional)
                </label>
                <select
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  style={selectColorScheme}
                  className={`w-full min-w-0 max-w-full truncate p-2.5 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                >
                  <option value="" className={optionClass}>-- Material general del curso --</option>
                  {selectedCourseVideos.map((v, idx) => (
                    <option key={`${v.url}-${idx}`} value={v.url} className={optionClass}>{v.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold mb-1.5 opacity-80">
                  {uploadMode === 'files'
                    ? 'Título (opcional en lote; toma el nombre de cada archivo)'
                    : 'Título del Material *'}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej: Diapositivas Cardiología"
                  className={`w-full p-2.5 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1.5 opacity-80">Descripción breve (opcional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ej: Guía actualizada 2026"
                  className={`w-full p-2.5 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                />
              </div>
            </div>

            {uploadMode === 'files' ? (
              <div>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    handleFilesAdded(e.dataTransfer.files);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-[#24B0BA] bg-[#24B0BA]/10'
                      : isDark
                      ? 'border-white/20 hover:border-[#24B0BA] bg-[#162235]/60'
                      : 'border-[#2E4A70]/25 hover:border-[#014ba0] bg-[#FFF9F0]/60'
                  }`}
                >
                  <UploadCloud className={`w-9 h-9 mx-auto mb-2 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
                  <p className="font-bold text-xs sm:text-sm">
                    Arrastra uno o varios archivos aquí, o haz clic para seleccionar
                  </p>
                  <p className="text-[11px] opacity-70 mt-1">
                    PDF, PPT, PPTX, DOC, DOCX, PNG, JPG, WEBP (sin videos).
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg,.webp"
                    onChange={(e) => {
                      handleFilesAdded(e.target.files);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                </div>

                {stagedFiles.length > 0 && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {stagedFiles.map((f, idx) => (
                      <div
                        key={`${f.name}-${idx}`}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs ${
                          isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0] border-[#2E4A70]/15'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          <span className="truncate font-semibold">{f.name}</span>
                          <span className="opacity-65 shrink-0 tabular-nums">({formatBytes(f.size)})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setStagedFiles((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-red-500 hover:text-red-600 p-1 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold mb-1.5 opacity-80">
                  Enlace de Google Drive o URL externa *
                </label>
                <div className="relative">
                  <LinkIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
                  <input
                    type="url"
                    value={externalUrl}
                    onChange={(e) => setExternalUrl(e.target.value)}
                    placeholder="https://drive.google.com/file/d/..."
                    className={`w-full pl-9 p-2.5 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={uploading}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#014ba0] hover:bg-[#013b80] disabled:opacity-50 text-white font-bold text-xs sm:text-sm cursor-pointer transition-colors"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                <span>{uploading ? 'Publicando...' : 'Publicar Material(es)'}</span>
              </button>
            </div>
          </form>
        )}

        {/* Barra de Origen, Filtros en Servidor y Paginación */}
        <div className={`w-full min-w-0 p-3.5 sm:p-5 rounded-2xl border space-y-4 ${surfaceClass}`}>
          {/* Pestañas por Origen + Vista */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 min-w-0">
            <div
              className={`grid grid-cols-2 sm:flex sm:flex-wrap w-full lg:w-auto rounded-xl p-1 border gap-1 min-w-0 ${
                isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0] border-[#2E4A70]/15'
              }`}
            >
              {[
                { key: 'all', label: `Todos (${counts.all})` },
                { key: 'courses', label: `De Cursos (${counts.courses})` },
                { key: 'live_classes', label: `Clases en Vivo (${counts.live_classes})` },
                { key: 'library', label: `Biblioteca (${counts.library})` },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setOriginFilter(tab.key);
                    setPage(1);
                  }}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold cursor-pointer transition-colors tabular-nums truncate text-center ${
                    originFilter === tab.key
                      ? 'bg-[#014ba0] text-white'
                      : isDark
                      ? 'text-blue-200 hover:text-white'
                      : 'text-[#2E4A70] hover:text-[#014ba0]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
              {fetchingList && <Loader2 className="w-4 h-4 animate-spin text-[#24B0BA]" />}
              <div
                className={`inline-flex rounded-xl p-1 border ${
                  isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0] border-[#2E4A70]/15'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  title="Vista tabla"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    viewMode === 'table'
                      ? 'bg-[#014ba0] text-white'
                      : isDark
                      ? 'text-blue-200'
                      : 'text-[#2E4A70]'
                  }`}
                >
                  <LayoutList className="w-3.5 h-3.5" />
                  <span>Tabla</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  title="Vista tarjetas"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    viewMode === 'grid'
                      ? 'bg-[#014ba0] text-white'
                      : isDark
                      ? 'text-blue-200'
                      : 'text-[#2E4A70]'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Tarjetas</span>
                </button>
              </div>
            </div>
          </div>

          {/* Filtros en 2 filas limpias con min-w-0 para evitar desbordamiento horizontal en móviles y tabletas */}
          <div className="space-y-2.5 min-w-0">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 min-w-0">
              <div className="relative md:col-span-6 min-w-0">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Buscar título, archivo, clase en vivo o subtema..."
                  style={selectColorScheme}
                  className={`w-full min-w-0 pl-9 pr-8 py-2.5 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput('');
                      setDebouncedSearch('');
                      setPage(1);
                    }}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="md:col-span-3 min-w-0">
                <select
                  value={filterCourse}
                  onChange={(e) => {
                    setFilterCourse(e.target.value);
                    setPage(1);
                  }}
                  style={selectColorScheme}
                  className={`w-full min-w-0 max-w-full truncate px-3 py-2.5 rounded-xl border text-xs sm:text-sm font-semibold outline-none cursor-pointer ${inputClass}`}
                >
                  <option value="" className={optionClass}>Todos los Cursos</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id} className={optionClass}>{c.title}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3 min-w-0">
                <select
                  value={filterEsp}
                  onChange={(e) => {
                    setFilterEsp(e.target.value);
                    setPage(1);
                  }}
                  style={selectColorScheme}
                  className={`w-full min-w-0 max-w-full truncate px-3 py-2.5 rounded-xl border text-xs sm:text-sm font-semibold outline-none cursor-pointer ${inputClass}`}
                >
                  <option value="" className={optionClass}>Todas las Especialidades</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id} className={optionClass}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 min-w-0">
              <div className="min-w-0">
                <select
                  value={filterType}
                  onChange={(e) => {
                    setFilterType(e.target.value);
                    setPage(1);
                  }}
                  style={selectColorScheme}
                  className={`w-full min-w-0 max-w-full truncate px-2.5 py-2.5 rounded-xl border text-xs font-semibold outline-none cursor-pointer ${inputClass}`}
                >
                  <option value="" className={optionClass}>Tipo: Todos</option>
                  <option value="pdf" className={optionClass}>PDF</option>
                  <option value="slides" className={optionClass}>Diapos</option>
                  <option value="summary" className={optionClass}>Resumen</option>
                </select>
              </div>

              <div className="min-w-0">
                <select
                  value={filterSource}
                  onChange={(e) => {
                    setFilterSource(e.target.value);
                    setPage(1);
                  }}
                  style={selectColorScheme}
                  className={`w-full min-w-0 max-w-full truncate px-2.5 py-2.5 rounded-xl border text-xs font-semibold outline-none cursor-pointer ${inputClass}`}
                >
                  <option value="" className={optionClass}>Fuente: Todas</option>
                  <option value="supabase_storage" className={optionClass}>Subido a BD</option>
                  <option value="google_drive_legacy" className={optionClass}>Drive</option>
                  <option value="external_url" className={optionClass}>URL externa</option>
                </select>
              </div>

              <div className="min-w-0">
                <select
                  value={filterVisibility}
                  onChange={(e) => {
                    setFilterVisibility(e.target.value);
                    setPage(1);
                  }}
                  style={selectColorScheme}
                  className={`w-full min-w-0 max-w-full truncate px-2.5 py-2.5 rounded-xl border text-xs font-semibold outline-none cursor-pointer ${inputClass}`}
                >
                  <option value="" className={optionClass}>Estado: Todos</option>
                  <option value="true" className={optionClass}>Visibles</option>
                  <option value="false" className={optionClass}>Ocultos ({counts.hidden})</option>
                </select>
              </div>

              <div className="min-w-0">
                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value);
                    setPage(1);
                  }}
                  style={selectColorScheme}
                  className={`w-full min-w-0 max-w-full truncate px-2.5 py-2.5 rounded-xl border text-xs font-semibold outline-none cursor-pointer ${inputClass}`}
                >
                  <option value="newest" className={optionClass}>Más recientes</option>
                  <option value="oldest" className={optionClass}>Más antiguos</option>
                  <option value="title_asc" className={optionClass}>Título A–Z</option>
                  <option value="largest" className={optionClass}>Mayor peso</option>
                </select>
              </div>
            </div>
          </div>

          {/* Barra contextual: selección masiva + rango actual + limpiar */}
          <div
            className={`pt-3 border-t flex flex-wrap items-center justify-between gap-2 text-xs ${
              isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2.5">
              {materials.length > 0 && (
                <button
                  type="button"
                  onClick={toggleSelectAllOnPage}
                  className={`inline-flex items-center gap-1.5 font-bold cursor-pointer ${
                    isDark ? 'text-blue-200 hover:text-white' : 'text-[#2E4A70] hover:text-[#014ba0]'
                  }`}
                >
                  {materials.every((m) => selectedIds.includes(m.id)) ? (
                    <CheckSquare className="w-4 h-4 text-[#014ba0]" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                  <span>Seleccionar página ({materials.length})</span>
                </button>
              )}

              {selectedIds.length > 0 && (
                <button
                  type="button"
                  disabled={bulkDeleting}
                  onClick={handleBulkDelete}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {bulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  <span>Eliminar seleccionados ({selectedIds.length})</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold opacity-75 tabular-nums">
                {rangeStart}–{rangeEnd} de {pagination.total} resultados
              </span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className={`inline-flex items-center gap-1 font-bold underline cursor-pointer ${
                    isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Limpiar filtros</span>
                </button>
              )}
            </div>
          </div>

          {/* Resultados */}
          {materials.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <FolderOpen className="w-10 h-10 mx-auto opacity-35" />
              <p className="text-sm font-extrabold">No hay materiales con los filtros actuales.</p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#014ba0] text-white text-xs font-bold cursor-pointer"
                >
                  Restablecer filtros
                </button>
              )}
            </div>
          ) : viewMode === 'table' ? (
            <>
              {/* Móvil (< lg): tarjetas limpias */}
              <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
                {materials.map((mat) => {
                  const Icon =
                    mat.material_type === 'slides'
                      ? Presentation
                      : mat.material_type === 'summary'
                        ? BookOpen
                        : FileText;
                  const isSelected = selectedIds.includes(mat.id);
                  return (
                    <div
                      key={mat.id}
                      className={`p-4 rounded-2xl border space-y-3 ${
                        isSelected
                          ? isDark
                            ? 'bg-blue-950/30 border-[#24B0BA]'
                            : 'bg-blue-50/70 border-[#014ba0]'
                          : isDark
                          ? 'bg-[#162235] border-white/10'
                          : 'bg-[#FFF9F0]/60 border-[#2E4A70]/15'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <button
                            type="button"
                            onClick={() => toggleSelect(mat.id)}
                            className="mt-0.5 cursor-pointer shrink-0"
                            aria-label="Seleccionar material"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-[#014ba0]" />
                            ) : (
                              <Square className="w-4 h-4 opacity-50" />
                            )}
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Icon className="w-4 h-4 text-[#24B0BA] shrink-0" />
                              <h3 className="font-bold text-sm truncate">{mat.title}</h3>
                            </div>
                            <p className="text-[11px] opacity-70 truncate mt-0.5">
                              {mat.file_name || (mat.source_type === 'supabase_storage' ? 'Archivo' : 'Enlace externo')} ·{' '}
                              {formatBytes(mat.file_size)}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={togglingId === mat.id}
                          onClick={() => handleToggleActive(mat)}
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full cursor-pointer shrink-0 ${
                            mat.is_active
                              ? 'bg-emerald-500/15 text-emerald-500'
                              : 'bg-red-500/15 text-red-400'
                          }`}
                        >
                          {mat.is_active ? 'Visible' : 'Oculto'}
                        </button>
                      </div>

                      {renderOriginBadgeBlock(mat)}

                      <div className={`pt-2 border-t flex flex-wrap items-center justify-between gap-2 ${isDark ? 'border-white/10' : 'border-[#2E4A70]/10'}`}>
                        <span className="text-[11px] opacity-65 tabular-nums">{formatDateShort(mat.created_at)}</span>
                        {renderMaterialActions(mat)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Escritorio (>= lg): tabla paginada compacta y clara */}
              <div className={`hidden lg:block w-full min-w-0 overflow-x-auto rounded-2xl border ${isDark ? 'border-white/10' : 'border-[#2E4A70]/15'}`}>
                <table className={`min-w-full divide-y ${isDark ? 'divide-white/10' : 'divide-[#2E4A70]/10'}`}>
                  <thead className={isDark ? 'bg-[#162235]' : 'bg-[#FFF9F0]'}>
                    <tr>
                      <th className="w-10 px-3 py-3 text-center">
                        <button
                          type="button"
                          onClick={toggleSelectAllOnPage}
                          className="cursor-pointer opacity-75 hover:opacity-100"
                          aria-label="Seleccionar todos"
                        >
                          {materials.every((m) => selectedIds.includes(m.id)) ? (
                            <CheckSquare className="w-4 h-4 text-[#014ba0]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                      <th className={`px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                        Material / Archivo
                      </th>
                      <th className={`px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                        Pertenece a (Origen y Ubicación)
                      </th>
                      <th className={`px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                        Tipo / Peso
                      </th>
                      <th className={`px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                        Estado
                      </th>
                      <th className={`px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-white/10 bg-[#1e293b]' : 'divide-[#2E4A70]/10 bg-white'}`}>
                    {materials.map((mat) => {
                      const Icon =
                        mat.material_type === 'slides'
                          ? Presentation
                          : mat.material_type === 'summary'
                            ? BookOpen
                            : FileText;
                      const isSelected = selectedIds.includes(mat.id);
                      const typeLabel =
                        mat.material_type === 'slides'
                          ? 'Diapositivas'
                          : mat.material_type === 'summary'
                            ? 'Resumen'
                            : 'PDF';
                      const sourceLabel =
                        mat.source_type === 'supabase_storage'
                          ? 'Storage BD'
                          : mat.source_type === 'google_drive_legacy'
                            ? 'Drive'
                            : 'URL';

                      return (
                        <tr
                          key={mat.id}
                          className={
                            isSelected
                              ? isDark
                                ? 'bg-blue-950/35'
                                : 'bg-blue-50/70'
                              : isDark
                              ? 'hover:bg-white/[0.03]'
                              : 'hover:bg-[#FFF9F0]/60'
                          }
                        >
                          <td className="px-3 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => toggleSelect(mat.id)}
                              className="cursor-pointer"
                              aria-label={`Seleccionar ${mat.title}`}
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-[#014ba0]" />
                              ) : (
                                <Square className="w-4 h-4 opacity-45" />
                              )}
                            </button>
                          </td>

                          <td className="px-4 py-3 max-w-xs">
                            <div className="flex items-start gap-2.5 min-w-0">
                              <span
                                className={`p-2 rounded-xl shrink-0 ${
                                  isDark ? 'bg-[#162235] text-[#24B0BA]' : 'bg-[#FFF9F0] text-[#014ba0]'
                                }`}
                              >
                                <Icon className="w-4 h-4" />
                              </span>
                              <div className="min-w-0">
                                <p className="font-bold text-sm truncate" title={mat.title}>
                                  {mat.title}
                                </p>
                                <p className="text-[11px] opacity-70 truncate" title={mat.file_name || mat.file_url || ''}>
                                  {mat.file_name || mat.description || mat.file_url || 'Sin descripción'}
                                </p>
                                <p className="text-[10px] opacity-55 tabular-nums mt-0.5">
                                  {formatDateShort(mat.created_at)}
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3">{renderOriginBadgeBlock(mat)}</td>

                          <td className="px-4 py-3 whitespace-nowrap text-xs">
                            <div className="font-bold">{typeLabel}</div>
                            <div className="text-[11px] opacity-70 tabular-nums">
                              {sourceLabel}
                              {mat.file_size ? ` · ${formatBytes(mat.file_size)}` : ''}
                            </div>
                          </td>

                          <td className="px-4 py-3 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={togglingId === mat.id}
                              onClick={() => handleToggleActive(mat)}
                              className={`inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                                mat.is_active
                                  ? isDark
                                    ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                                  : isDark
                                  ? 'bg-white/10 text-slate-300 hover:bg-white/15'
                                  : 'bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200'
                              }`}
                            >
                              {togglingId === mat.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : mat.is_active ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : (
                                <EyeOff className="w-3 h-3" />
                              )}
                              <span>{mat.is_active ? 'Visible' : 'Oculto'}</span>
                            </button>
                          </td>

                          <td className="px-4 py-3 whitespace-nowrap text-right">
                            <div className="inline-flex">{renderMaterialActions(mat)}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {materials.map((mat) => {
                const Icon =
                  mat.material_type === 'slides'
                    ? Presentation
                    : mat.material_type === 'summary'
                      ? BookOpen
                      : FileText;
                const isSelected = selectedIds.includes(mat.id);
                return (
                  <div
                    key={mat.id}
                    className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 ${
                      isSelected
                        ? isDark
                          ? 'bg-blue-950/30 border-[#24B0BA]'
                          : 'bg-blue-50/70 border-[#014ba0]'
                        : isDark
                        ? 'bg-[#162235] border-white/10'
                        : 'bg-[#FFF9F0]/60 border-[#2E4A70]/15'
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => toggleSelect(mat.id)}
                            className="mt-0.5 cursor-pointer shrink-0"
                            aria-label={`Seleccionar ${mat.title}`}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-[#014ba0]" />
                            ) : (
                              <Square className="w-4 h-4 opacity-50" />
                            )}
                          </button>
                          <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
                          <h3 className="font-bold text-sm line-clamp-2" title={mat.title}>
                            {mat.title}
                          </h3>
                        </div>

                        <button
                          type="button"
                          disabled={togglingId === mat.id}
                          onClick={() => handleToggleActive(mat)}
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full shrink-0 cursor-pointer ${
                            mat.is_active
                              ? 'bg-emerald-500/15 text-emerald-500'
                              : 'bg-red-500/15 text-red-400'
                          }`}
                        >
                          {mat.is_active ? 'Visible' : 'Oculto'}
                        </button>
                      </div>

                      {renderOriginBadgeBlock(mat)}

                      <p className="text-[11px] opacity-70 truncate tabular-nums">
                        {mat.file_name || (mat.source_type === 'supabase_storage' ? 'Archivo' : 'Enlace externo')}
                        {mat.file_size ? ` · ${formatBytes(mat.file_size)}` : ''} · {formatDateShort(mat.created_at)}
                      </p>
                    </div>

                    <div className={`flex items-center justify-end gap-2 pt-2.5 border-t ${isDark ? 'border-white/10' : 'border-[#2E4A70]/10'}`}>
                      {renderMaterialActions(mat)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Paginador */}
          {pagination.total > 0 && (
            <div
              className={`pt-3 border-t flex flex-wrap items-center justify-between gap-3 text-xs ${
                isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="opacity-75 font-semibold">Por página:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  style={selectColorScheme}
                  className={`px-2 py-1 rounded-lg border font-bold outline-none cursor-pointer ${inputClass}`}
                >
                  <option value={24} className={optionClass}>24</option>
                  <option value={48} className={optionClass}>48</option>
                  <option value={100} className={optionClass}>100</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pagination.page <= 1 || fetchingList}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border font-bold cursor-pointer disabled:opacity-40 ${
                    isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/20 hover:bg-slate-100'
                  }`}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Anterior</span>
                </button>
                <span className="font-bold px-2 tabular-nums">
                  Página {pagination.page} de {pagination.totalPages}
                </span>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.totalPages || fetchingList}
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border font-bold cursor-pointer disabled:opacity-40 ${
                    isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/20 hover:bg-slate-100'
                  }`}
                >
                  <span>Siguiente</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal Edición Rápida */}
      {editingMaterial && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !savingEdit && setEditingMaterial(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveEdit}
            className={`w-full max-w-lg rounded-2xl border p-6 space-y-4 shadow-2xl ${surfaceClass}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold">Editar Material</h3>
              <button
                type="button"
                onClick={() => setEditingMaterial(null)}
                className="p-1 opacity-70 hover:opacity-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">Título</label>
              <input
                type="text"
                required
                value={editingMaterial.title}
                onChange={(e) => setEditingMaterial((p) => ({ ...p, title: e.target.value }))}
                className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
              />
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">Descripción</label>
              <textarea
                rows={2}
                value={editingMaterial.description || ''}
                onChange={(e) => setEditingMaterial((p) => ({ ...p, description: e.target.value }))}
                className={`w-full p-2.5 rounded-xl border text-sm outline-none resize-none ${inputClass}`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">Tipo</label>
                <select
                  value={editingMaterial.material_type}
                  onChange={(e) => setEditingMaterial((p) => ({ ...p, material_type: e.target.value }))}
                  style={selectColorScheme}
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                >
                  <option value="pdf" className={optionClass}>PDF</option>
                  <option value="slides" className={optionClass}>Diapositivas</option>
                  <option value="summary" className={optionClass}>Resumen</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Estado</label>
                <select
                  value={editingMaterial.is_active ? 'true' : 'false'}
                  onChange={(e) => setEditingMaterial((p) => ({ ...p, is_active: e.target.value === 'true' }))}
                  style={selectColorScheme}
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                >
                  <option value="true" className={optionClass}>Visible</option>
                  <option value="false" className={optionClass}>Oculto</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">Especialidad</label>
                <select
                  value={editingMaterial.especialidad_id || ''}
                  onChange={(e) =>
                    setEditingMaterial((p) => ({ ...p, especialidad_id: e.target.value, subtema: '' }))
                  }
                  style={selectColorScheme}
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                >
                  <option value="" className={optionClass}>-- General --</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id} className={optionClass}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Curso</label>
                <select
                  value={editingMaterial.course_id || ''}
                  onChange={(e) => setEditingMaterial((p) => ({ ...p, course_id: e.target.value }))}
                  style={selectColorScheme}
                  className={`w-full p-2.5 rounded-xl border text-sm outline-none ${inputClass}`}
                >
                  <option value="" className={optionClass}>-- General --</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id} className={optionClass}>{c.title}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => setEditingMaterial(null)}
                className={`px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                  isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/25 hover:bg-slate-100'
                }`}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="px-5 py-2 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {savingEdit ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Visor Integrado */}
      <ProtectedDocumentViewer
        isOpen={Boolean(viewerMaterial)}
        onClose={() => setViewerMaterial(null)}
        material={viewerMaterial}
        isDark={isDark}
      />

      <Toaster position="top-right" />
    </div>
  );
}
