'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  getDocs,
  getCountFromServer,
  deleteDoc,
  updateDoc,
  doc,
  query,
  where,
  limit,
  startAfter,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { singlePaymentCoursesCollectionRef } from '@/lib/db';
import { getCachedCategories, invalidateCatalogCache } from '@/lib/catalogCache';
import { countValidCourseVideos } from '@/lib/courseCurriculum';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import Swal from 'sweetalert2';
import { toast, Toaster } from 'react-hot-toast';
import {
  Plus,
  Search,
  Tags,
  Eye,
  Edit3,
  Trash2,
  X,
  BookOpen,
  PlayCircle,
  Layers,
  LayoutGrid,
  LayoutList,
  Calendar,
  CheckCircle2,
  EyeOff,
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';

const DEFAULT_PAGE_SIZE = 10;

const extractDriveFileId = (url) => {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  const pathMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (pathMatch) return pathMatch[1];
  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch) return queryMatch[1];
  return '';
};

// Función para normalizar portada opcional sin forzar imagen 404
const resolveCourseCoverUrl = (url, useFallback = false) => {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  if (trimmed.includes('drive.google.com') || trimmed.includes('lh3.googleusercontent.com')) {
    const fileId = extractDriveFileId(trimmed);
    if (fileId) {
      return useFallback
        ? `https://drive.google.com/uc?export=view&id=${fileId}`
        : `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
    }
  }

  return trimmed;
};

function formatCourseDateShort(createdAt) {
  if (!createdAt?.toDate) return 'Reciente';
  try {
    const d = createdAt.toDate();
    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return 'Reciente';
  }
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getPaginationItems(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const items = [1];
  const left = current >= total - 2 ? Math.max(2, total - 3) : Math.max(2, current - 1);
  const right = current <= 3 ? Math.min(total - 1, 4) : Math.min(total - 1, current + 1);

  if (left > 3) items.push('ellipsis-left');
  else for (let p = 2; p < left; p += 1) items.push(p);

  for (let p = left; p <= right; p += 1) items.push(p);

  if (right < total - 2) items.push('ellipsis-right');
  else for (let p = right + 1; p < total; p += 1) items.push(p);

  items.push(total);
  return items;
}

function buildFilteredCoursesQuery(statusFilter, categoryFilter, maxDocs, cursorSnap = null) {
  const constraints = [];
  if (statusFilter === 'active') {
    constraints.push(where('isActive', '==', true));
  } else if (statusFilter === 'inactive') {
    constraints.push(where('isActive', '==', false));
  }
  if (categoryFilter !== 'all' && categoryFilter !== 'null') {
    constraints.push(where('categoryId', '==', categoryFilter));
  }
  if (cursorSnap) {
    constraints.push(startAfter(cursorSnap));
  }
  constraints.push(limit(Math.min(50, Math.max(1, maxDocs))));
  return query(singlePaymentCoursesCollectionRef, ...constraints);
}

export default function AdminSinglePaymentCoursesPage() {
  const [courses, setCourses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [counts, setCounts] = useState({ total: null, active: null, inactive: null });
  const [loading, setLoading] = useState(true);
  const [fetchingPage, setFetchingPage] = useState(false);
  const [searchingDb, setSearchingDb] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'active' | 'inactive'
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'grid'
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [clientPage, setClientPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [poolVersion, setPoolVersion] = useState(0);

  const [togglingStatusId, setTogglingStatusId] = useState(null);
  const [failedCovers, setFailedCovers] = useState({});
  const [driveFallbacks, setDriveFallbacks] = useState({});

  const handleCoverError = useCallback(
    (courseId, imageUrl) => {
      const current = resolveCourseCoverUrl(imageUrl, Boolean(driveFallbacks[courseId]));
      const fallback = resolveCourseCoverUrl(imageUrl, true);
      if (!driveFallbacks[courseId] && fallback && fallback !== current) {
        setDriveFallbacks((prev) => ({ ...prev, [courseId]: true }));
        return;
      }
      setFailedCovers((prev) => ({ ...prev, [courseId]: true }));
    },
    [driveFallbacks]
  );

  const pageCacheRef = useRef({});
  const searchPoolRef = useRef({ items: [], lastDoc: null, hasMore: false, loadedAll: false });
  const reqSeqRef = useRef(0);

  const { isDark, isLoaded } = useTheme();
  const { firebaseAuthUser } = useAuth();

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f8fafc' : '#1a2639',
      confirmButtonColor: '#014ba0',
      cancelButtonColor: '#dc2626',
    }),
    [isDark]
  );

  // Cuando hay filtros solo en cliente (mes, texto, "Sin categoría") o ya cargamos toda la colección, paginamos en memoria
  const queryKey = useMemo(
    () => `${filterStatus}::${filterCategory}::${pageSize}`,
    [filterStatus, filterCategory, pageSize]
  );

  const fetchCountsAndCategories = useCallback(async ({ forceCategories = false } = {}) => {
    try {
      const [cats, totalSnap, activeSnap, inactiveSnap] = await Promise.all([
        getCachedCategories({ forceRefresh: forceCategories }),
        getCountFromServer(singlePaymentCoursesCollectionRef),
        getCountFromServer(query(singlePaymentCoursesCollectionRef, where('isActive', '==', true))),
        getCountFromServer(query(singlePaymentCoursesCollectionRef, where('isActive', '==', false))),
      ]);
      setCategories(cats);
      setCounts({
        total: totalSnap.data().count,
        active: activeSnap.data().count,
        inactive: inactiveSnap.data().count,
      });
    } catch (err) {
      console.error('Error cargando categorías o conteos:', err);
    }
  }, []);

  const fetchCoursesPage = useCallback(
    async (targetPage = 1, { forceRemote = false } = {}) => {
      const safePage = Math.max(1, targetPage);

      // Si ya cargamos toda la colección en memoria (p. ej. <= 50 cursos o tras escanear), 0 lecturas adicionales
      if (!forceRemote && searchPoolRef.current.loadedAll) {
        setLoading(false);
        return;
      }

      if (!pageCacheRef.current[queryKey]) {
        pageCacheRef.current[queryKey] = {
          pages: {},
          lastDocs: {},
          hasMoreByPage: {},
          highestPage: 0,
        };
      }
      const cache = pageCacheRef.current[queryKey];

      if (!forceRemote && cache.pages[safePage]) {
        setCourses(cache.pages[safePage]);
        setHasMore(Boolean(cache.hasMoreByPage[safePage]));
        setCurrentPage(safePage);
        setLoading(false);
        return;
      }

      const seq = ++reqSeqRef.current;
      setFetchingPage(true);

      try {
        let startPage = 0;
        for (let p = safePage - 1; p >= 1; p -= 1) {
          if (cache.lastDocs[p]) {
            startPage = p;
            break;
          }
        }

        let cursorDoc = startPage > 0 ? cache.lastDocs[startPage] : null;
        let fillPage = startPage + 1;

        while (fillPage <= safePage) {
          const askLimit = Math.min(50, pageSize + 1);
          const q = buildFilteredCoursesQuery(filterStatus, filterCategory, askLimit, cursorDoc);
          const snap = await getDocs(q);
          if (seq !== reqSeqRef.current) return;

          const docs = snap.docs;
          const pageHasMore =
            pageSize < 50 ? docs.length > pageSize : docs.length === 50;
          const slicedDocs = pageSize < 50 && pageHasMore ? docs.slice(0, pageSize) : docs;
          const items = slicedDocs.map((d) => ({ id: d.id, ...d.data() }));

          cache.pages[fillPage] = items;
          cache.lastDocs[fillPage] = slicedDocs[slicedDocs.length - 1] || null;
          cache.hasMoreByPage[fillPage] = pageHasMore;
          cache.highestPage = Math.max(cache.highestPage, fillPage);

          // Si el catálogo completo del filtro 'all' + 'all' cupo en la página 1, cachearlo como pool completo
          if (filterStatus === 'all' && filterCategory === 'all' && fillPage === 1 && !pageHasMore) {
            searchPoolRef.current = {
              items,
              lastDoc: null,
              hasMore: false,
              loadedAll: true,
            };
            setPoolVersion((v) => v + 1);
          }

          cursorDoc = cache.lastDocs[fillPage];
          fillPage += 1;
          if (!pageHasMore || !cursorDoc) break;
        }

        const resolvedPage = cache.pages[safePage] ? safePage : Math.max(1, cache.highestPage);
        setCourses(cache.pages[resolvedPage] || []);
        setHasMore(Boolean(cache.hasMoreByPage[resolvedPage]));
        setCurrentPage(resolvedPage);
      } catch (error) {
        if (seq !== reqSeqRef.current) return;
        console.error('Error cargando cursos paginados:', error);
        toast.error('No se pudieron cargar los cursos.');
      } finally {
        if (seq === reqSeqRef.current) {
          setLoading(false);
          setFetchingPage(false);
        }
      }
    },
    [queryKey, pageSize, filterStatus, filterCategory]
  );

  useEffect(() => {
    fetchCountsAndCategories();
  }, [fetchCountsAndCategories]);

  useEffect(() => {
    setClientPage(1);
    if (filterCategory === 'null') return; // Filtro sin categoría se resuelve sobre pool local/búsqueda BD
    fetchCoursesPage(1);
  }, [fetchCoursesPage, filterCategory]);

  // Escaneo acotado en lotes de 50 para búsqueda global / filtros locales (mes o "Sin categoría")
  const loadNextSearchBatch = useCallback(async ({ reset = false } = {}) => {
    setSearchingDb(true);
    try {
      const cursor = reset ? null : searchPoolRef.current.lastDoc;
      const q = buildFilteredCoursesQuery('all', 'all', 50, cursor);
      const snap = await getDocs(q);
      const docs = snap.docs;
      const fetchedItems = docs.map((d) => ({ id: d.id, ...d.data() }));
      const batchHasMore = docs.length === 50;
      const lastDoc = docs[docs.length - 1] || null;

      const base = reset ? [] : searchPoolRef.current.items;
      const seen = new Set(base.map((c) => c.id));
      const merged = [...base];
      for (const item of fetchedItems) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          merged.push(item);
        }
      }

      searchPoolRef.current = {
        items: merged,
        lastDoc,
        hasMore: batchHasMore,
        loadedAll: !batchHasMore,
      };
      setPoolVersion((v) => v + 1);
    } catch (err) {
      console.error('Error buscando cursos en BD:', err);
      toast.error('No se pudo consultar el siguiente lote en BD.');
    } finally {
      setSearchingDb(false);
    }
  }, []);

  const handleRefreshAll = async () => {
    pageCacheRef.current = {};
    searchPoolRef.current = { items: [], lastDoc: null, hasMore: false, loadedAll: false };
    setPoolVersion((v) => v + 1);
    invalidateCatalogCache('pu_courses_');
    await Promise.all([
      fetchCountsAndCategories({ forceCategories: true }),
      fetchCoursesPage(1, { forceRemote: true }),
    ]);
    toast.success('Catálogo actualizado');
  };

  const categoryMap = useMemo(
    () => new Map(categories.map((cat) => [cat.id, cat.name])),
    [categories]
  );

  // Fuente base: si ya se escaneó pool completo o estamos usando filtros de cliente (texto, mes, sin categoría), combinamos sin perder lo cargado
  const hasClientOnlyFilter =
    Boolean(searchTerm.trim()) || filterMonth !== 'all' || filterCategory === 'null';
  const useMemoryPool = searchPoolRef.current.loadedAll || (hasClientOnlyFilter && searchPoolRef.current.items.length > 0);

  const sourceList = useMemo(() => {
    void poolVersion;
    if (useMemoryPool) {
      return searchPoolRef.current.items;
    }
    return courses;
  }, [useMemoryPool, courses, poolVersion]);

  const availableMonths = useMemo(() => {
    const monthSet = new Set(
      sourceList
        .map((c) => (c.createdAt?.toDate ? c.createdAt.toDate().toISOString().slice(0, 7) : null))
        .filter(Boolean)
    );
    return Array.from(monthSet).sort().reverse();
  }, [sourceList]);

  const filteredCourses = useMemo(() => {
    const q = normalizeSearchText(searchTerm.trim());

    return sourceList
      .filter((course) => {
        const categoryName = normalizeSearchText(categoryMap.get(course.categoryId) || '');
        const courseMonth = course.createdAt?.toDate
          ? course.createdAt.toDate().toISOString().slice(0, 7)
          : '';
        const isCourseActive = course.isActive !== false;

        const matchesModules =
          Array.isArray(course.modules) &&
          course.modules.some((m) => normalizeSearchText(m.title || '').includes(q));

        const matchesSearch =
          !q ||
          normalizeSearchText(course.title || '').includes(q) ||
          normalizeSearchText(course.description || '').includes(q) ||
          categoryName.includes(q) ||
          matchesModules;

        const matchesCategory =
          filterCategory === 'all' || (course.categoryId || 'null') === filterCategory;
        const matchesMonth = filterMonth === 'all' || courseMonth === filterMonth;
        const matchesStatus =
          filterStatus === 'all' ||
          (filterStatus === 'active' && isCourseActive) ||
          (filterStatus === 'inactive' && !isCourseActive);

        return matchesSearch && matchesCategory && matchesMonth && matchesStatus;
      })
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  }, [sourceList, categoryMap, searchTerm, filterCategory, filterMonth, filterStatus]);

  // Cálculo de paginación (en memoria cuando usamos pool local/búsqueda; por cursor cuando navegamos limpio por Firestore)
  const isMemoryPaginated = useMemoryPool || hasClientOnlyFilter;

  const estimatedServerTotal = useMemo(() => {
    if (filterCategory === 'all') {
      if (filterStatus === 'all' && counts.total !== null) return counts.total;
      if (filterStatus === 'active' && counts.active !== null) return counts.active;
      if (filterStatus === 'inactive' && counts.inactive !== null) return counts.inactive;
    }
    return null;
  }, [filterCategory, filterStatus, counts]);

  const totalPages = useMemo(() => {
    if (isMemoryPaginated) {
      return Math.max(1, Math.ceil(filteredCourses.length / pageSize));
    }
    if (estimatedServerTotal !== null) {
      return Math.max(1, Math.ceil(estimatedServerTotal / pageSize));
    }
    return hasMore ? currentPage + 1 : currentPage;
  }, [isMemoryPaginated, filteredCourses.length, pageSize, estimatedServerTotal, hasMore, currentPage]);

  const safeCurrentPage = isMemoryPaginated
    ? Math.min(clientPage, totalPages)
    : Math.min(currentPage, totalPages);

  const visibleCourses = useMemo(() => {
    if (!isMemoryPaginated) return filteredCourses;
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredCourses.slice(start, start + pageSize);
  }, [isMemoryPaginated, filteredCourses, safeCurrentPage, pageSize]);

  const paginationItems = useMemo(
    () => getPaginationItems(safeCurrentPage, totalPages),
    [safeCurrentPage, totalPages]
  );

  const handlePageChange = (targetPage) => {
    const clamped = Math.max(1, Math.min(totalPages, Number(targetPage) || 1));
    if (clamped === safeCurrentPage) return;
    if (isMemoryPaginated) {
      setClientPage(clamped);
    } else {
      fetchCoursesPage(clamped);
    }
  };

  useEffect(() => {
    setClientPage(1);
  }, [searchTerm, filterCategory, filterMonth, filterStatus, pageSize]);

  const summaryStats = useMemo(() => {
    let totalModules = 0;
    let totalVideos = 0;
    let activeInView = 0;
    for (const c of visibleCourses) {
      if (c.isActive !== false) activeInView += 1;
      const mods = Array.isArray(c.modules) ? c.modules : [];
      totalModules += mods.length;
      totalVideos += countValidCourseVideos(c);
    }
    return { totalModules, totalVideos, activeInView };
  }, [visibleCourses]);

  const hasActiveFilters =
    Boolean(searchTerm.trim()) ||
    filterCategory !== 'all' ||
    filterMonth !== 'all' ||
    filterStatus !== 'all';

  const resetFilters = () => {
    setSearchTerm('');
    setFilterCategory('all');
    setFilterMonth('all');
    setFilterStatus('all');
  };

  const patchCourseInCaches = useCallback((courseId, patch) => {
    setCourses((prev) => prev.map((c) => (c.id === courseId ? { ...c, ...patch } : c)));
    Object.values(pageCacheRef.current).forEach((entry) => {
      if (!entry?.pages) return;
      Object.keys(entry.pages).forEach((p) => {
        entry.pages[p] = entry.pages[p].map((c) => (c.id === courseId ? { ...c, ...patch } : c));
      });
    });
    if (searchPoolRef.current.items.length > 0) {
      searchPoolRef.current.items = searchPoolRef.current.items.map((c) =>
        c.id === courseId ? { ...c, ...patch } : c
      );
      setPoolVersion((v) => v + 1);
    }
  }, []);

  const removeCourseFromCaches = useCallback((courseId) => {
    setCourses((prev) => prev.filter((c) => c.id !== courseId));
    Object.values(pageCacheRef.current).forEach((entry) => {
      if (!entry?.pages) return;
      Object.keys(entry.pages).forEach((p) => {
        entry.pages[p] = entry.pages[p].filter((c) => c.id !== courseId);
      });
    });
    if (searchPoolRef.current.items.length > 0) {
      searchPoolRef.current.items = searchPoolRef.current.items.filter((c) => c.id !== courseId);
      setPoolVersion((v) => v + 1);
    }
  }, []);

  const handleToggleStatus = async (course) => {
    if (!course?.id || togglingStatusId === course.id) return;
    const wasActive = course.isActive !== false;
    const nextActive = !wasActive;
    setTogglingStatusId(course.id);
    try {
      await updateDoc(doc(db, 'Cursos_Pago_Unico', course.id), { isActive: nextActive });
      patchCourseInCaches(course.id, { isActive: nextActive });
      setCounts((prev) => ({
        ...prev,
        active:
          prev.active !== null ? Math.max(0, prev.active + (nextActive ? 1 : -1)) : prev.active,
        inactive:
          prev.inactive !== null
            ? Math.max(0, prev.inactive + (nextActive ? -1 : 1))
            : prev.inactive,
      }));
      invalidateCatalogCache('pu_courses_');
      toast.success(nextActive ? `"${course.title}" publicado` : `"${course.title}" ocultado`);
    } catch (err) {
      console.error('Error cambiando estado del curso:', err);
      toast.error('No se pudo actualizar la visibilidad del curso');
    } finally {
      setTogglingStatusId(null);
    }
  };

  const handleDelete = (course) => {
    const courseId = typeof course === 'string' ? course : course?.id;
    const courseTitle = typeof course === 'object' ? course?.title : '';
    const courseImageUrl = typeof course === 'object' ? course?.imageUrl || null : null;
    const wasActive = typeof course === 'object' ? course?.isActive !== false : true;
    if (!courseId) return;

    Swal.fire({
      title: '¿Eliminar curso por completo?',
      text: courseTitle
        ? `Se eliminará "${courseTitle}" permanentemente junto con todos sus registros en la BD, clases en vivo vinculadas y archivos subidos en Supabase Storage (materiales y portada).`
        : 'Esta acción eliminará el curso junto con sus registros en la BD y archivos subidos en Supabase Storage.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar todo',
      cancelButtonText: 'Cancelar',
      showLoaderOnConfirm: true,
      allowOutsideClick: () => !Swal.isLoading(),
      ...swalTheme,
      confirmButtonColor: '#dc2626',
      preConfirm: async () => {
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (firebaseAuthUser) {
            const token = await firebaseAuthUser.getIdToken();
            if (token) headers.Authorization = `Bearer ${token}`;
          }

          const res = await fetch(`/api/pago-unico-courses/${encodeURIComponent(courseId)}`, {
            method: 'DELETE',
            headers,
            body: JSON.stringify({ imageUrl: courseImageUrl }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error || 'No se pudo eliminar el curso de Supabase.');
          }

          if (!data.deletedFirestoreDoc) {
            await deleteDoc(doc(db, 'Cursos_Pago_Unico', courseId));
          }
          return data;
        } catch (error) {
          Swal.showValidationMessage(error.message || 'No se pudo eliminar el curso.');
          return false;
        }
      },
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        removeCourseFromCaches(courseId);
        invalidateCatalogCache('pu_courses_');
        setCounts((prev) => ({
          total: prev.total !== null ? Math.max(0, prev.total - 1) : prev.total,
          active:
            prev.active !== null && wasActive ? Math.max(0, prev.active - 1) : prev.active,
          inactive:
            prev.inactive !== null && !wasActive ? Math.max(0, prev.inactive - 1) : prev.inactive,
        }));
        const stats = result.value;
        const details = [];
        if (stats.deletedMaterialsCount > 0) {
          details.push(`${stats.deletedMaterialsCount} material(es) de BD`);
        }
        if (stats.deletedFilesCount > 0) {
          details.push(`${stats.deletedFilesCount} archivo(s) de Storage`);
        }
        if (stats.deletedSchedulesCount > 0) {
          details.push(`${stats.deletedSchedulesCount} clase(s) en vivo`);
        }
        const summaryText =
          details.length > 0
            ? `Curso eliminado junto con ${details.join(', ')}.`
            : 'El curso ha sido eliminado permanentemente.';
        Swal.fire({ title: 'Eliminado', text: summaryText, icon: 'success', ...swalTheme });
      }
    });
  };

  if (!isLoaded || loading) {
    return (
      <section
        className={`min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center gap-3 ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <Loader2 className={`w-8 h-8 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
        <p className="text-sm font-bold">Cargando lote de cursos...</p>
      </section>
    );
  }

  const pageBg = isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]';
  const surfaceClass = isDark
    ? 'bg-[#1e293b] border-white/10 text-white'
    : 'bg-white border-[#2E4A70]/15 text-[#1a2639]';
  const fieldClass = isDark
    ? 'bg-[#162235] border-white/15 text-white placeholder:text-slate-400 focus:border-[#24B0BA]'
    : 'bg-white border-[#2E4A70]/25 text-[#1a2639] placeholder:text-slate-400 focus:border-[#014ba0]';
  const optionClass = isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]';
  const selectColorScheme = { colorScheme: isDark ? 'dark' : 'light' };

  const renderStatusPill = (course) => {
    const isActive = course.isActive !== false;
    return (
      <button
        type="button"
        disabled={togglingStatusId === course.id}
        onClick={() => handleToggleStatus(course)}
        title={isActive ? 'Ocultar curso de estudiantes' : 'Publicar curso'}
        className={`inline-flex items-center gap-1.5 min-h-[32px] text-[11px] font-extrabold px-3 py-1 rounded-full cursor-pointer transition-colors shrink-0 ${
          isActive
            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
            : isDark
            ? 'bg-slate-800 text-slate-200 border border-white/15 hover:bg-slate-700'
            : 'bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200'
        }`}
      >
        {togglingStatusId === course.id ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isActive ? (
          <CheckCircle2 className="w-3.5 h-3.5" />
        ) : (
          <EyeOff className="w-3.5 h-3.5" />
        )}
        <span>{isActive ? 'Activo' : 'Oculto'}</span>
      </button>
    );
  };

  // Tarjeta ancha horizontal (ocupa todo el ancho disponible de su columna sin quedar comprimida ni pegada a la izquierda)
  const renderCourseCard = (course) => {
    const catName = categoryMap.get(course.categoryId) || 'Sin Categoría';
    const mods = Array.isArray(course.modules) ? course.modules : [];
    const videoCount = countValidCourseVideos(course);
    const coverUrl = resolveCourseCoverUrl(course.imageUrl, Boolean(driveFallbacks[course.id]));
    const showCover = Boolean(coverUrl && !failedCovers[course.id]);

    return (
      <article
        key={course.id}
        className={`w-full rounded-2xl border overflow-hidden flex flex-col sm:flex-row transition-colors ${surfaceClass}`}
      >
        {/* Portada ancha lateral en sm+ o superior en móvil */}
        <div
          className={`relative sm:w-52 md:w-60 h-44 sm:h-auto shrink-0 overflow-hidden ${
            isDark ? 'bg-[#162235]' : 'bg-[#FFF9F0]'
          }`}
        >
          {showCover ? (
            <img
              src={coverUrl}
              alt={course.title || 'Portada del curso'}
              referrerPolicy={coverUrl.startsWith('http') ? 'no-referrer' : undefined}
              onError={() => handleCoverError(course.id, course.imageUrl)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full min-h-[140px] flex flex-col items-center justify-center gap-1.5 opacity-60">
              <BookOpen className={`w-8 h-8 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
              <span className="text-[11px] font-bold">Sin portada</span>
            </div>
          )}
        </div>

        {/* Contenido + Acciones ocupando todo el ancho restante */}
        <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col justify-between gap-3.5">
          <div className="space-y-2.5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <span
                  className={`text-[11px] font-extrabold px-2.5 py-1 rounded-lg truncate max-w-[220px] ${
                    isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
                  }`}
                >
                  {catName}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg ${
                    isDark ? 'bg-white/5 text-slate-300' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <Calendar className="w-3 h-3 shrink-0" />
                  <span>{formatCourseDateShort(course.createdAt)}</span>
                </span>
              </div>
              {renderStatusPill(course)}
            </div>

            <div className="space-y-1 min-w-0">
              <h3 className="font-extrabold text-base sm:text-lg leading-snug line-clamp-2 break-words">
                {course.title}
              </h3>
              {course.description && (
                <p
                  className={`text-xs sm:text-sm leading-relaxed line-clamp-2 ${
                    isDark ? 'text-slate-300' : 'text-[#2E4A70]/90'
                  }`}
                >
                  {course.description}
                </p>
              )}
            </div>

            <div
              className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-bold tabular-nums ${
                isDark ? 'text-blue-200/90' : 'text-[#2E4A70]'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Layers className="w-4 h-4 shrink-0 text-[#CF8A40]" />
                <span>
                  {mods.length} {mods.length === 1 ? 'módulo' : 'módulos'}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                {videoCount > 0 ? (
                  <>
                    <PlayCircle className="w-4 h-4 shrink-0 text-[#24B0BA]" />
                    <span>
                      {videoCount} {videoCount === 1 ? 'video' : 'videos'}
                    </span>
                  </>
                ) : (
                  <>
                    <BookOpen className="w-4 h-4 shrink-0 text-[#24B0BA]" />
                    <span>PDFs / Diapositivas</span>
                  </>
                )}
              </span>
            </div>
          </div>

          <div
            className={`pt-3 border-t grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 ${
              isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
            }`}
          >
            <Link
              href={`/admin/Cursos_Pago_Unico/preview/${course.id}`}
              className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-bold transition-colors sm:flex-1 ${
                isDark
                  ? 'border-white/15 bg-white/5 hover:bg-white/10 text-blue-200'
                  : 'border-[#2E4A70]/20 bg-white hover:bg-slate-100 text-[#014ba0]'
              }`}
            >
              <Eye className="w-4 h-4 shrink-0" />
              <span>Preview</span>
            </Link>
            <Link
              href={`/admin/Cursos_Pago_Unico/edit/${course.id}`}
              className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold transition-colors sm:flex-1"
            >
              <Edit3 className="w-4 h-4 shrink-0" />
              <span>Editar</span>
            </Link>
            <button
              type="button"
              onClick={() => handleDelete(course)}
              title="Eliminar curso"
              aria-label={`Eliminar ${course.title}`}
              className={`col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                isDark
                  ? 'border-red-500/30 bg-red-500/15 hover:bg-red-500/25 text-red-300'
                  : 'border-red-200 bg-red-50 hover:bg-red-100 text-red-600'
              }`}
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              <span>Eliminar</span>
            </button>
          </div>
        </div>
      </article>
    );
  };

  return (
    <section className={`w-full min-w-0 overflow-x-hidden p-3 sm:p-6 min-h-[calc(100vh-4rem)] ${pageBg}`}>
      <div className="w-full max-w-[1600px] mx-auto min-w-0 space-y-5">
        {/* Encabezado */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2.5">
              <BookOpen className={`w-7 h-7 shrink-0 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
              <span>Cursos de Pago Único</span>
            </h1>
            <p className={`text-xs sm:text-sm font-medium mt-1 ${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]'}`}>
              Listado paginado ({pageSize} por página) para administrar temarios, módulos y visibilidad sin saturar la BD.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-2 w-full md:w-auto">
            <button
              type="button"
              disabled={fetchingPage || searchingDb}
              onClick={handleRefreshAll}
              className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] py-2 px-3.5 rounded-xl border text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 ${
                isDark
                  ? 'bg-[#1e293b] border-white/15 hover:bg-white/10 text-blue-200'
                  : 'bg-white border-[#2E4A70]/25 hover:bg-slate-50 text-[#1a2639]'
              }`}
            >
              <RefreshCw className={`w-4 h-4 shrink-0 ${fetchingPage || searchingDb ? 'animate-spin' : ''}`} />
              <span>Actualizar</span>
            </button>
            <Link
              href="/admin/Cursos_Pago_Unico/categoria"
              className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] py-2 px-4 rounded-xl border text-xs sm:text-sm font-bold transition-colors ${
                isDark
                  ? 'bg-[#1e293b] border-white/15 hover:bg-white/10 text-white'
                  : 'bg-white border-[#2E4A70]/25 hover:bg-slate-50 text-[#1a2639]'
              }`}
            >
              <Tags className="w-4 h-4 text-[#CF8A40] shrink-0" />
              <span>Categorías</span>
            </Link>
            <Link
              href="/admin/Cursos_Pago_Unico/new"
              className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] bg-[#014ba0] hover:bg-[#013b80] text-white py-2 px-4 rounded-xl text-xs sm:text-sm font-bold transition-colors"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Agregar Curso</span>
            </Link>
          </div>
        </header>

        {/* Pestañas de estado + Búsqueda + Desplegables + Selector Tabla/Tarjetas */}
        <div className={`p-4 rounded-2xl border space-y-3.5 ${surfaceClass}`}>
          {/* Navegación por pestañas */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div
              className={`grid grid-cols-3 sm:inline-flex rounded-xl p-1 border w-full lg:w-auto ${
                isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0] border-[#2E4A70]/15'
              }`}
            >
              {[
                {
                  key: 'all',
                  label: 'Todos',
                  count: counts.total,
                },
                {
                  key: 'active',
                  label: 'Activos',
                  count: counts.active,
                },
                {
                  key: 'inactive',
                  label: 'Ocultos',
                  count: counts.inactive,
                },
              ].map((tab) => {
                const isTabActive = filterStatus === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilterStatus(tab.key)}
                    className={`inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      isTabActive
                        ? 'bg-[#014ba0] text-white shadow-xs'
                        : isDark
                        ? 'text-slate-300 hover:text-white'
                        : 'text-[#2E4A70] hover:text-[#014ba0]'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.count !== null && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${
                          isTabActive
                            ? 'bg-white/20 text-white'
                            : isDark
                            ? 'bg-white/10 text-slate-300'
                            : 'bg-[#014ba0]/10 text-[#014ba0]'
                        }`}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selector Tabla / Tarjetas */}
            <div className="flex items-center justify-between sm:justify-end gap-2">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="opacity-75 font-semibold">Por página:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  aria-label="Cursos por página"
                  style={selectColorScheme}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold outline-none cursor-pointer ${fieldClass}`}
                >
                  <option value={10} className={optionClass}>10</option>
                  <option value={25} className={optionClass}>25</option>
                  <option value={50} className={optionClass}>50</option>
                </select>
              </div>

              <div
                className={`inline-flex rounded-xl p-1 border ${
                  isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0] border-[#2E4A70]/15'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  title="Vista tabla"
                  aria-label="Vista tabla"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    viewMode === 'table'
                      ? 'bg-[#014ba0] text-white'
                      : isDark
                      ? 'text-slate-300 hover:text-white'
                      : 'text-[#2E4A70] hover:text-[#014ba0]'
                  }`}
                >
                  <LayoutList className="w-4 h-4" />
                  <span className="hidden sm:inline">Tabla</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  title="Vista tarjetas"
                  aria-label="Vista tarjetas"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-[#014ba0] text-white'
                      : isDark
                      ? 'text-slate-300 hover:text-white'
                      : 'text-[#2E4A70] hover:text-[#014ba0]'
                  }`}
                >
                  <LayoutGrid className="w-4 h-4" />
                  <span className="hidden sm:inline">Tarjetas</span>
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-center">
            {/* Buscador + botón de búsqueda acotada en BD */}
            <div className="sm:col-span-2 lg:col-span-6 flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1 min-w-0">
                <Search
                  className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${
                    isDark ? 'text-slate-400' : 'text-[#2E4A70]/70'
                  }`}
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por título, módulo o categoría..."
                  aria-label="Buscar curso"
                  style={selectColorScheme}
                  className={`w-full min-h-[42px] pl-9 pr-8 py-2 rounded-xl border text-xs sm:text-sm font-medium outline-none ${fieldClass}`}
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-65 hover:opacity-100 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {!searchPoolRef.current.loadedAll && (
                <button
                  type="button"
                  disabled={searchingDb}
                  onClick={() =>
                    loadNextSearchBatch({ reset: searchPoolRef.current.items.length === 0 })
                  }
                  className={`inline-flex items-center justify-center gap-1.5 min-h-[42px] px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer shrink-0 disabled:opacity-50 ${
                    isDark
                      ? 'border-[#24B0BA]/40 bg-[#24B0BA]/15 text-[#24B0BA] hover:bg-[#24B0BA]/25'
                      : 'border-[#014ba0]/25 bg-[#014ba0]/10 text-[#014ba0] hover:bg-[#014ba0]/15'
                  }`}
                >
                  {searchingDb ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {searchingDb
                      ? 'Buscando...'
                      : searchPoolRef.current.hasMore
                      ? 'Cargar más en BD (+50)'
                      : 'Buscar en BD'}
                  </span>
                </button>
              )}
            </div>

            {/* Desplegable Categoría */}
            <div className="lg:col-span-3">
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                aria-label="Filtrar por categoría"
                style={selectColorScheme}
                className={`w-full min-h-[42px] px-3 py-2 rounded-xl border text-xs sm:text-sm font-semibold outline-none cursor-pointer ${fieldClass}`}
              >
                <option value="all" className={optionClass}>
                  Todas las categorías
                </option>
                <option value="null" className={optionClass}>
                  Sin Categoría
                </option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id} className={optionClass}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Desplegable Mes */}
            <div className="lg:col-span-3">
              <select
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                aria-label="Filtrar por mes"
                style={selectColorScheme}
                className={`w-full min-h-[42px] px-3 py-2 rounded-xl border text-xs sm:text-sm font-semibold outline-none cursor-pointer ${fieldClass}`}
              >
                <option value="all" className={optionClass}>
                  Todos los meses
                </option>
                {availableMonths.map((month) => {
                  const label = new Date(month + '-02')
                    .toLocaleString('es-ES', { month: 'long', year: 'numeric' })
                    .replace(/^\w/, (c) => c.toUpperCase());
                  return (
                    <option key={month} value={month} className={optionClass}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Resumen inline + Limpiar filtros */}
          <div
            className={`pt-2.5 border-t flex flex-wrap items-center justify-between gap-2 text-xs font-semibold ${
              isDark ? 'border-white/10 text-blue-200/85' : 'border-[#2E4A70]/10 text-[#2E4A70]'
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              {(fetchingPage || searchingDb) && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#24B0BA]" />
              )}
              <span>
                Página <strong>{safeCurrentPage}</strong> de <strong>{totalPages}</strong> ·{' '}
                {visibleCourses.length} curso(s) visibles
                {estimatedServerTotal !== null && !isMemoryPaginated
                  ? ` (de ${estimatedServerTotal} en filtro)`
                  : ''}
              </span>
              <span className="opacity-45">·</span>
              <span>
                {summaryStats.activeInView} activos · {summaryStats.totalModules} módulos ·{' '}
                {summaryStats.totalVideos} videos en esta página
              </span>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className={`inline-flex items-center gap-1 text-xs font-bold underline cursor-pointer ${
                  isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                }`}
              >
                <X className="w-3.5 h-3.5" />
                <span>Limpiar filtros</span>
              </button>
            )}
          </div>
        </div>

        {/* Listado principal paginado (ancho completo en ambas vistas) */}
        {visibleCourses.length === 0 ? (
          <div className={`p-10 rounded-2xl border text-center space-y-3 ${surfaceClass}`}>
            <BookOpen
              className={`w-10 h-10 mx-auto opacity-45 ${
                isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
              }`}
            />
            <p className="text-base font-extrabold">
              {counts.total === 0
                ? 'Aún no hay cursos registrados'
                : 'No se encontraron cursos con esos filtros'}
            </p>
            <p className={`text-xs ${isDark ? 'text-blue-200/75' : 'text-[#2E4A70]'}`}>
              {counts.total === 0
                ? 'Crea tu primer curso de pago único para comenzar a agregar módulos y materiales.'
                : hasActiveFilters && !searchPoolRef.current.loadedAll
                ? 'Puedes pulsar "Buscar en BD" para escanear más lotes de cursos o restablecer filtros.'
                : 'Prueba ajustando el buscador, categoría, mes o pestaña de estado.'}
            </p>
            <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
              {hasActiveFilters && !searchPoolRef.current.loadedAll && (
                <button
                  type="button"
                  disabled={searchingDb}
                  onClick={() => loadNextSearchBatch({ reset: searchPoolRef.current.items.length === 0 })}
                  className={`inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                    isDark
                      ? 'border-[#24B0BA]/40 bg-[#24B0BA]/15 text-[#24B0BA]'
                      : 'border-[#014ba0]/25 bg-[#014ba0]/10 text-[#014ba0]'
                  }`}
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Buscar en BD</span>
                </button>
              )}
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Restablecer filtros</span>
                </button>
              ) : (
                <Link
                  href="/admin/Cursos_Pago_Unico/new"
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Agregar Curso</span>
                </Link>
              )}
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visibleCourses.map((course) => renderCourseCard(course))}
          </div>
        ) : (
          <>
            {/* Móvil (< md): tarjetas anchas apiladas sin scroll horizontal */}
            <div className="md:hidden grid grid-cols-1 gap-3.5">
              {visibleCourses.map((course) => renderCourseCard(course))}
            </div>

            {/* Escritorio (>= md): tabla amplia de ancho completo */}
            <div className={`hidden md:block w-full overflow-x-auto rounded-2xl border ${surfaceClass}`}>
              <table
                className={`w-full divide-y ${
                  isDark ? 'divide-white/10' : 'divide-[#2E4A70]/15'
                }`}
              >
                <thead className={isDark ? 'bg-[#162235]' : 'bg-[#FFF9F0]'}>
                  <tr>
                    <th
                      className={`px-5 py-3.5 text-left text-[11px] font-extrabold uppercase tracking-wider ${
                        isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                      }`}
                    >
                      Curso
                    </th>
                    <th
                      className={`px-4 py-3.5 text-left text-[11px] font-extrabold uppercase tracking-wider whitespace-nowrap ${
                        isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                      }`}
                    >
                      Categoría
                    </th>
                    <th
                      className={`px-4 py-3.5 text-left text-[11px] font-extrabold uppercase tracking-wider whitespace-nowrap ${
                        isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                      }`}
                    >
                      Contenido
                    </th>
                    <th
                      className={`px-4 py-3.5 text-left text-[11px] font-extrabold uppercase tracking-wider whitespace-nowrap ${
                        isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                      }`}
                    >
                      Estado
                    </th>
                    <th
                      className={`px-5 py-3.5 text-right text-[11px] font-extrabold uppercase tracking-wider whitespace-nowrap ${
                        isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                      }`}
                    >
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody
                  className={`divide-y ${
                    isDark ? 'divide-white/10 bg-[#1e293b]' : 'divide-[#2E4A70]/10 bg-white'
                  }`}
                >
                  {visibleCourses.map((course) => {
                    const catName = categoryMap.get(course.categoryId) || 'Sin Categoría';
                    const mods = Array.isArray(course.modules) ? course.modules : [];
                    const videoCount = countValidCourseVideos(course);
                    const rowCover = resolveCourseCoverUrl(
                      course.imageUrl,
                      Boolean(driveFallbacks[course.id])
                    );
                    const hasRowCover = Boolean(rowCover && !failedCovers[course.id]);

                    return (
                      <tr
                        key={course.id}
                        className={isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-[#FFF9F0]/70'}
                      >
                        <td className="px-5 py-4 min-w-[300px]">
                          <div className="flex items-center gap-4 min-w-0">
                            {hasRowCover ? (
                              <img
                                className={`h-14 w-24 rounded-xl object-cover shrink-0 border ${
                                  isDark ? 'border-white/10' : 'border-[#2E4A70]/15'
                                }`}
                                src={rowCover}
                                alt={course.title || 'Imagen del curso'}
                                referrerPolicy={
                                  rowCover.startsWith('http') ? 'no-referrer' : undefined
                                }
                                onError={() => handleCoverError(course.id, course.imageUrl)}
                              />
                            ) : (
                              <span
                                className={`h-14 w-24 rounded-xl shrink-0 border flex items-center justify-center ${
                                  isDark
                                    ? 'bg-[#162235] border-white/10 text-[#24B0BA]'
                                    : 'bg-[#FFF9F0] border-[#2E4A70]/15 text-[#014ba0]'
                                }`}
                                title="Curso sin portada"
                              >
                                <BookOpen className="w-5 h-5" />
                              </span>
                            )}
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="text-sm sm:text-base font-extrabold leading-snug line-clamp-1">
                                {course.title}
                              </div>
                              {course.description ? (
                                <p
                                  className={`text-xs line-clamp-2 ${
                                    isDark ? 'text-slate-300/85' : 'text-[#2E4A70]/85'
                                  }`}
                                >
                                  {course.description}
                                </p>
                              ) : (
                                <p
                                  className={`text-xs ${
                                    isDark ? 'text-slate-400' : 'text-[#2E4A70]/65'
                                  }`}
                                >
                                  Creado el {formatCourseDateShort(course.createdAt)}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-extrabold ${
                              isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
                            }`}
                          >
                            {catName}
                          </span>
                        </td>

                        <td
                          className={`px-4 py-4 whitespace-nowrap text-xs font-semibold tabular-nums ${
                            isDark ? 'text-blue-100' : 'text-[#2E4A70]'
                          }`}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span>
                              {mods.length} {mods.length === 1 ? 'módulo' : 'módulos'}
                            </span>
                            <span className="opacity-75">
                              {videoCount > 0
                                ? `${videoCount} ${videoCount === 1 ? 'video' : 'videos'}`
                                : 'Solo PDFs / diapositivas'}{' '}
                              · {formatCourseDateShort(course.createdAt)}
                            </span>
                          </div>
                        </td>

                        <td className="px-4 py-4 whitespace-nowrap">{renderStatusPill(course)}</td>

                        <td className="px-5 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex justify-end items-center gap-2">
                            <Link
                              href={`/admin/Cursos_Pago_Unico/preview/${course.id}`}
                              className={`inline-flex items-center gap-1.5 min-h-[36px] px-3.5 py-1.5 text-xs font-bold rounded-xl border transition-colors ${
                                isDark
                                  ? 'border-white/15 bg-white/5 hover:bg-white/10 text-blue-200'
                                  : 'border-[#2E4A70]/20 bg-white hover:bg-slate-100 text-[#014ba0]'
                              }`}
                              title="Vista previa"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Preview</span>
                            </Link>
                            <Link
                              href={`/admin/Cursos_Pago_Unico/edit/${course.id}`}
                              className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 py-1.5 text-xs font-bold bg-[#014ba0] hover:bg-[#013b80] text-white rounded-xl transition-colors"
                              title="Editar curso"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Editar</span>
                            </Link>
                            <button
                              type="button"
                              onClick={() => handleDelete(course)}
                              className={`inline-flex items-center gap-1.5 min-h-[36px] px-3.5 py-1.5 text-xs font-bold rounded-xl border cursor-pointer transition-colors ${
                                isDark
                                  ? 'border-red-500/30 bg-red-500/15 hover:bg-red-500/25 text-red-300'
                                  : 'border-red-200 bg-red-50 hover:bg-red-100 text-red-600'
                              }`}
                              title="Eliminar curso"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Eliminar</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Paginador por páginas */}
        {totalPages > 1 && (
          <div
            className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${surfaceClass}`}
          >
            <span className="font-semibold tabular-nums text-center sm:text-left opacity-80">
              Página {safeCurrentPage} de {totalPages}
            </span>

            <div className="flex flex-wrap items-center justify-center sm:justify-end gap-1.5">
              <button
                type="button"
                disabled={safeCurrentPage <= 1 || fetchingPage}
                onClick={() => handlePageChange(safeCurrentPage - 1)}
                className={`inline-flex items-center gap-1 min-h-[38px] px-3 py-1.5 rounded-xl border font-bold cursor-pointer disabled:opacity-40 ${
                  isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/25 hover:bg-slate-50'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Anterior</span>
              </button>

              {paginationItems.map((item) => {
                if (typeof item === 'string') {
                  return (
                    <span key={item} className="px-1.5 font-bold opacity-50 select-none">
                      ...
                    </span>
                  );
                }
                const isActive = item === safeCurrentPage;
                return (
                  <button
                    key={item}
                    type="button"
                    disabled={fetchingPage && !isMemoryPaginated}
                    onClick={() => handlePageChange(item)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`min-w-[38px] min-h-[38px] px-2.5 rounded-xl border font-extrabold tabular-nums transition-colors cursor-pointer disabled:opacity-60 ${
                      isActive
                        ? isDark
                          ? 'bg-[#24B0BA] border-[#24B0BA] text-[#0f172a]'
                          : 'bg-[#014ba0] border-[#014ba0] text-white'
                        : isDark
                        ? 'border-white/15 hover:bg-white/10 text-slate-200'
                        : 'border-[#2E4A70]/20 hover:bg-slate-50 text-[#1a2639]'
                    }`}
                  >
                    {item}
                  </button>
                );
              })}

              <button
                type="button"
                disabled={
                  fetchingPage ||
                  (isMemoryPaginated ? safeCurrentPage >= totalPages : !hasMore && safeCurrentPage >= totalPages)
                }
                onClick={() => handlePageChange(safeCurrentPage + 1)}
                className={`inline-flex items-center gap-1 min-h-[38px] px-3 py-1.5 rounded-xl border font-bold cursor-pointer disabled:opacity-40 ${
                  isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/25 hover:bg-slate-50'
                }`}
              >
                <span>Siguiente</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <Toaster position="top-right" />
    </section>
  );
}
