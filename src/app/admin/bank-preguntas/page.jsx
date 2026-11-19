'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  deleteDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Swal from 'sweetalert2';
import { useTheme } from '@/context/ThemeContext';
import {
  Plus,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2,
  FileText,
  Edit3,
  Trash2,
  BarChart3,
  X,
  Clock,
  Calendar,
  ListChecks,
  Power,
  LayoutList,
  LayoutGrid,
} from 'lucide-react';

const DEFAULT_PAGE_SIZE = 10;
const SEARCH_BATCH_SIZE = 50;
const MAX_SERVER_SEARCH_DOCS = 50;

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function matchesExamSearch(exam, normalizedTerm) {
  if (!normalizedTerm) return true;
  const haystack = normalizeSearchText([exam.title, exam.description, exam.status, exam.id].join(' '));
  return haystack.includes(normalizedTerm);
}

function formatScheduledDate(ts) {
  if (!ts) return 'No programado';
  const date =
    typeof ts?.toDate === 'function'
      ? ts.toDate()
      : typeof ts?.seconds === 'number'
      ? new Date(ts.seconds * 1000)
      : new Date(ts);
  if (Number.isNaN(date.getTime())) return 'No programado';
  return date.toLocaleString('es-BO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getExamStatusBadge(status, isDark) {
  const isActive = status === 'active';
  return {
    label: isActive ? 'Activo' : 'Inactivo',
    dotClass: isActive ? 'bg-emerald-500' : 'bg-slate-400',
    badgeClass: isActive
      ? isDark
        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
        : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
      : isDark
      ? 'bg-slate-700/70 text-slate-300 border border-slate-600/60'
      : 'bg-slate-100 text-slate-700 border border-slate-200',
  };
}

function getPaginationItems(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const items = [1];
  const left = current >= total - 2 ? Math.max(2, total - 3) : Math.max(2, current - 1);
  const right = current <= 3 ? Math.min(total - 1, 4) : Math.min(total - 1, current + 1);

  if (left > 3) {
    items.push('ellipsis-left');
  } else {
    for (let p = 2; p < left; p += 1) items.push(p);
  }

  for (let p = left; p <= right; p += 1) items.push(p);

  if (right < total - 2) {
    items.push('ellipsis-right');
  } else {
    for (let p = right + 1; p < total; p += 1) items.push(p);
  }

  items.push(total);
  return items;
}

export default function BankPreguntasPage() {
  const router = useRouter();
  const { isDark, isLoaded } = useTheme();

  const [exams, setExams] = useState([]);
  const [totalCount, setTotalCount] = useState(null);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchPage, setSearchPage] = useState(1);
  const [jumpPageInput, setJumpPageInput] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [fetchingPage, setFetchingPage] = useState(false);
  const [searchingServer, setSearchingServer] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [poolVersion, setPoolVersion] = useState(0);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active' | 'inactive'
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'cards'
  const userToggledViewRef = useRef(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [examToDelete, setExamToDelete] = useState(null);
  const [deletingExam, setDeletingExam] = useState(false);
  const [togglingExamId, setTogglingExamId] = useState(null);

  const pageCacheRef = useRef({});
  const searchPoolCacheRef = useRef({});
  const reqSeqRef = useRef(0);
  const searchSeqRef = useRef(0);

  const currentPageCacheKey = useMemo(() => `${statusFilter}::${pageSize}`, [statusFilter, pageSize]);

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f8fafc' : '#1a2639',
      confirmButtonColor: '#014ba0',
      cancelButtonColor: '#dc2626',
    }),
    [isDark]
  );

  const buildFilterConstraints = useCallback(() => {
    const constraints = [];
    if (statusFilter !== 'all') {
      constraints.push(where('status', '==', statusFilter));
    }
    return constraints;
  }, [statusFilter]);

  const fetchExamsPage = useCallback(
    async (targetPage = 1, { refreshCount = false, forceRemote = false } = {}) => {
      const safeTargetPage = Math.max(1, targetPage);
      const cacheKey = currentPageCacheKey;

      if (!pageCacheRef.current[cacheKey]) {
        pageCacheRef.current[cacheKey] = {
          pages: {},
          endCursors: {},
          hasMoreByPage: {},
          highestPage: 0,
          useNoOrderFallback: null,
        };
      }
      const cacheEntry = pageCacheRef.current[cacheKey];

      if (!forceRemote && !refreshCount && cacheEntry.pages[safeTargetPage]) {
        setExams(cacheEntry.pages[safeTargetPage]);
        setHasMore(Boolean(cacheEntry.hasMoreByPage[safeTargetPage]));
        setCurrentPage(safeTargetPage);
        setFetchError('');
        setInitialLoading(false);
        return;
      }

      const seq = ++reqSeqRef.current;
      setFetchingPage(true);
      setFetchError('');

      try {
        const baseRef = collection(db, 'exams');
        const filterConstraints = buildFilterConstraints();
        const hasEqualityFilters = filterConstraints.length > 0;

        if (refreshCount || safeTargetPage === 1) {
          try {
            const countQuery = hasEqualityFilters ? query(baseRef, ...filterConstraints) : baseRef;
            const countSnap = await getCountFromServer(countQuery);
            if (seq === reqSeqRef.current) {
              setTotalCount(countSnap.data().count);
            }
          } catch {
            // La falta de agregación puntual no bloquea el listado
          }
        }

        const buildQuery = (withOrderByCreatedAt, afterDoc, batchLimit) => {
          const parts = [...filterConstraints];
          if (withOrderByCreatedAt) parts.push(orderBy('createdAt', 'desc'));
          if (afterDoc) parts.push(startAfter(afterDoc));
          parts.push(limit(batchLimit));
          return query(baseRef, ...parts);
        };

        let useOrder = !hasEqualityFilters && cacheEntry.useNoOrderFallback !== true;
        let startPage = 0;
        for (let p = safeTargetPage - 1; p >= 1; p -= 1) {
          if (cacheEntry.endCursors[p]) {
            startPage = p;
            break;
          }
        }

        let cursor = startPage > 0 ? cacheEntry.endCursors[startPage] : null;
        let currentFillPage = startPage + 1;
        let pagesLeftToLoad = safeTargetPage - startPage;
        const maxChunkDocs = 49;

        while (pagesLeftToLoad > 0) {
          const pagesInChunk = Math.min(pagesLeftToLoad, Math.max(1, Math.floor(maxChunkDocs / pageSize)));
          const askCount = Math.min(50, pagesInChunk * pageSize + 1);

          let snap;
          try {
            snap = await getDocs(buildQuery(useOrder, cursor, askCount));
            if (snap.empty && useOrder && startPage === 0) {
              const fallbackSnap = await getDocs(buildQuery(false, null, askCount));
              if (!fallbackSnap.empty) {
                snap = fallbackSnap;
                useOrder = false;
                cacheEntry.useNoOrderFallback = true;
              }
            }
          } catch (idxErr) {
            if (idxErr?.code === 'failed-precondition') {
              useOrder = false;
              cacheEntry.useNoOrderFallback = true;
              snap = await getDocs(buildQuery(false, cursor, askCount));
            } else {
              throw idxErr;
            }
          }

          if (seq !== reqSeqRef.current) return;

          const allDocs = snap.docs;
          const hasBeyondChunk = allDocs.length >= askCount;
          const usableDocs = hasBeyondChunk ? allDocs.slice(0, pagesInChunk * pageSize) : allDocs;

          if (usableDocs.length === 0) {
            if (currentFillPage === 1) {
              cacheEntry.pages[1] = [];
              cacheEntry.hasMoreByPage[1] = false;
              cacheEntry.highestPage = Math.max(cacheEntry.highestPage, 1);
            }
            break;
          }

          for (let i = 0; i < pagesInChunk; i += 1) {
            const sliceStart = i * pageSize;
            const sliceEnd = sliceStart + pageSize;
            const pageDocs = usableDocs.slice(sliceStart, sliceEnd);
            if (pageDocs.length === 0) break;

            const pNum = currentFillPage + i;
            const isLastSliceInChunk = sliceEnd >= usableDocs.length;
            const pageHasNext = isLastSliceInChunk ? hasBeyondChunk : true;

            cacheEntry.pages[pNum] = pageDocs.map((d) => ({ id: d.id, ...d.data() }));
            cacheEntry.endCursors[pNum] = pageDocs[pageDocs.length - 1];
            cacheEntry.hasMoreByPage[pNum] = pageHasNext;
            cacheEntry.highestPage = Math.max(cacheEntry.highestPage, pNum);
          }

          const producedPages = Math.ceil(usableDocs.length / pageSize);
          currentFillPage += producedPages;
          pagesLeftToLoad -= producedPages;
          cursor = usableDocs[usableDocs.length - 1];

          if (!hasBeyondChunk) break;
        }

        if (cacheEntry.pages[1] && !cacheEntry.hasMoreByPage[1]) {
          searchPoolCacheRef.current[statusFilter] = {
            exams: cacheEntry.pages[1],
            lastDoc: null,
            hasMore: false,
          };
          setPoolVersion((v) => v + 1);
        }

        const resolvedPage = cacheEntry.pages[safeTargetPage]
          ? safeTargetPage
          : Math.max(1, cacheEntry.highestPage);
        setExams(cacheEntry.pages[resolvedPage] || []);
        setHasMore(Boolean(cacheEntry.hasMoreByPage[resolvedPage]));
        setCurrentPage(resolvedPage);
      } catch (err) {
        if (seq !== reqSeqRef.current) return;
        console.error('Error cargando exámenes:', err);
        if (err?.code === 'resource-exhausted') {
          setFetchError(
            'Se alcanzó temporalmente la cuota diaria de lecturas de Firestore. Reduce consultas o intenta más tarde.'
          );
        } else {
          setFetchError(err?.message || 'No se pudieron cargar los exámenes.');
        }
      } finally {
        if (seq === reqSeqRef.current) {
          setInitialLoading(false);
          setFetchingPage(false);
        }
      }
    },
    [buildFilterConstraints, currentPageCacheKey, pageSize, statusFilter]
  );

  useEffect(() => {
    fetchExamsPage(1, { refreshCount: true, forceRemote: true });
  }, [fetchExamsPage]);

  const ensureSearchPoolLoaded = useCallback(
    async ({ appendMore = false } = {}) => {
      const existingPool = searchPoolCacheRef.current[statusFilter];
      if (!appendMore && existingPool && (!existingPool.hasMore || existingPool.exams.length > 0)) {
        return existingPool;
      }

      const seq = ++searchSeqRef.current;
      setSearchingServer(true);
      setFetchError('');

      try {
        const baseRef = collection(db, 'exams');
        const filterConstraints = buildFilterConstraints();
        const accumulated = appendMore && existingPool ? [...existingPool.exams] : [];
        const seenIds = new Set(accumulated.map((item) => item.id));
        let cursor = appendMore && existingPool ? existingPool.lastDoc : null;
        let batchHasMore = true;
        let batchesLoaded = 0;
        const maxBatches = Math.ceil(MAX_SERVER_SEARCH_DOCS / SEARCH_BATCH_SIZE);

        while (batchHasMore && batchesLoaded < maxBatches) {
          const parts = [...filterConstraints];
          if (cursor) parts.push(startAfter(cursor));
          parts.push(limit(SEARCH_BATCH_SIZE));

          const snap = await getDocs(query(baseRef, ...parts));
          if (seq !== searchSeqRef.current) return null;

          for (const d of snap.docs) {
            if (!seenIds.has(d.id)) {
              seenIds.add(d.id);
              accumulated.push({ id: d.id, ...d.data() });
            }
          }

          if (snap.docs.length < SEARCH_BATCH_SIZE) {
            batchHasMore = false;
            cursor = null;
          } else {
            cursor = snap.docs[snap.docs.length - 1];
          }
          batchesLoaded += 1;
        }

        const updatedPool = { exams: accumulated, lastDoc: cursor, hasMore: batchHasMore };
        searchPoolCacheRef.current[statusFilter] = updatedPool;
        setPoolVersion((v) => v + 1);
        return updatedPool;
      } catch (err) {
        if (seq !== searchSeqRef.current) return null;
        if (err?.code === 'resource-exhausted') {
          setFetchError('Cuota diaria agotada temporalmente; filtrando sobre exámenes ya cargados.');
        } else {
          setFetchError(err?.message || 'Error buscando exámenes.');
        }
        return null;
      } finally {
        if (seq === searchSeqRef.current) {
          setSearchingServer(false);
        }
      }
    },
    [buildFilterConstraints, statusFilter]
  );

  // Escribir filtra en memoria (0 lecturas); la búsqueda en servidor se ejecuta solo bajo clic explícito (lotes de 50)
  const handleServerSearch = async (e) => {
    e?.preventDefault?.();
    if (!searchTerm.trim()) return;
    await ensureSearchPoolLoaded({ appendMore: false });
  };

  const normalizedSearchTerm = useMemo(() => normalizeSearchText(searchTerm.trim()), [searchTerm]);
  const activeSearchPool = useMemo(() => {
    void poolVersion;
    return searchPoolCacheRef.current[statusFilter] || null;
  }, [statusFilter, poolVersion]);

  const isSearchMode = Boolean(normalizedSearchTerm);
  const isShowingGlobalSearch = Boolean(normalizedSearchTerm && activeSearchPool);

  useEffect(() => {
    setSearchPage(1);
    setJumpPageInput('');
  }, [normalizedSearchTerm, statusFilter, pageSize]);

  const allSearchMatches = useMemo(() => {
    if (!isSearchMode) return [];
    const source = activeSearchPool ? activeSearchPool.exams : exams;
    return source.filter((item) => matchesExamSearch(item, normalizedSearchTerm));
  }, [isSearchMode, activeSearchPool, exams, normalizedSearchTerm]);

  const browseTotalPages = useMemo(() => {
    if (totalCount !== null) return Math.max(1, Math.ceil(totalCount / pageSize));
    return hasMore ? currentPage + 1 : currentPage;
  }, [totalCount, pageSize, hasMore, currentPage]);

  const searchTotalPages = useMemo(
    () => Math.max(1, Math.ceil(allSearchMatches.length / pageSize)),
    [allSearchMatches.length, pageSize]
  );

  const displayPage = isSearchMode ? Math.min(searchPage, searchTotalPages) : currentPage;
  const displayTotalPages = isSearchMode ? searchTotalPages : browseTotalPages;
  const displayHasMore = isSearchMode ? displayPage < searchTotalPages : hasMore || displayPage < browseTotalPages;

  const visibleExams = useMemo(() => {
    if (!isSearchMode) return exams;
    const start = (displayPage - 1) * pageSize;
    return allSearchMatches.slice(start, start + pageSize);
  }, [isSearchMode, exams, allSearchMatches, displayPage, pageSize]);

  const paginationItems = useMemo(
    () => getPaginationItems(displayPage, displayTotalPages),
    [displayPage, displayTotalPages]
  );

  const handlePageChange = useCallback(
    (targetPage) => {
      const clamped = Math.max(1, Math.min(displayTotalPages, Number(targetPage) || 1));
      if (clamped === displayPage) return;
      if (isSearchMode) {
        setSearchPage(clamped);
      } else {
        fetchExamsPage(clamped);
      }
    },
    [displayTotalPages, displayPage, isSearchMode, fetchExamsPage]
  );

  const handleJumpToPage = (e) => {
    e.preventDefault();
    const parsed = parseInt(jumpPageInput, 10);
    if (Number.isNaN(parsed)) return;
    handlePageChange(parsed);
    setJumpPageInput('');
  };

  useEffect(() => {
    if (typeof window === 'undefined' || userToggledViewRef.current) return;
    setViewMode(window.innerWidth < 768 ? 'cards' : 'table');
  }, []);

  const handleSelectViewMode = (mode) => {
    userToggledViewRef.current = true;
    setViewMode(mode);
  };

  useEffect(() => {
    if (!showDeleteModal) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !deletingExam) {
        setShowDeleteModal(false);
        setExamToDelete(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showDeleteModal, deletingExam]);

  const handleDelete = async () => {
    if (!examToDelete || deletingExam) return;
    setDeletingExam(true);
    try {
      await deleteDoc(doc(db, 'exams', examToDelete.id));
      setExams((prev) => prev.filter((item) => item.id !== examToDelete.id));
      Object.keys(pageCacheRef.current).forEach((key) => {
        const entry = pageCacheRef.current[key];
        if (entry?.pages) {
          Object.keys(entry.pages).forEach((p) => {
            entry.pages[p] = entry.pages[p].filter((item) => item.id !== examToDelete.id);
          });
        }
      });
      Object.keys(searchPoolCacheRef.current).forEach((key) => {
        const pool = searchPoolCacheRef.current[key];
        if (pool) {
          pool.exams = pool.exams.filter((item) => item.id !== examToDelete.id);
        }
      });
      setPoolVersion((v) => v + 1);
      setTotalCount((prev) => (prev !== null ? Math.max(0, prev - 1) : prev));
      Swal.fire({ icon: 'success', title: '¡Eliminado!', text: 'Examen eliminado exitosamente.', ...swalTheme });
    } catch (error) {
      console.error('Error al eliminar examen: ', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Error al eliminar el examen.', ...swalTheme });
    } finally {
      setDeletingExam(false);
      setShowDeleteModal(false);
      setExamToDelete(null);
    }
  };

  const openDeleteModal = (exam) => {
    setExamToDelete(exam);
    setShowDeleteModal(true);
  };

  const toggleExamStatus = async (exam) => {
    if (togglingExamId) return;
    const newStatus = exam.status === 'active' ? 'inactive' : 'active';
    setTogglingExamId(exam.id);
    try {
      await updateDoc(doc(db, 'exams', exam.id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
      const applyPatch = (item) => (item.id === exam.id ? { ...item, status: newStatus } : item);
      setExams((prev) => prev.map(applyPatch));
      Object.keys(pageCacheRef.current).forEach((key) => {
        const entry = pageCacheRef.current[key];
        if (entry?.pages) {
          Object.keys(entry.pages).forEach((p) => {
            entry.pages[p] = entry.pages[p].map(applyPatch);
          });
        }
      });
      Object.keys(searchPoolCacheRef.current).forEach((key) => {
        const pool = searchPoolCacheRef.current[key];
        if (pool) pool.exams = pool.exams.map(applyPatch);
      });
      setPoolVersion((v) => v + 1);
      Swal.fire({
        icon: 'success',
        title: newStatus === 'active' ? 'Activado' : 'Desactivado',
        text: `Examen ${newStatus === 'active' ? 'activado' : 'desactivado'}.`,
        ...swalTheme,
      });
    } catch (error) {
      console.error('Error al cambiar estado: ', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Error al cambiar estado del examen.', ...swalTheme });
    } finally {
      setTogglingExamId(null);
    }
  };

  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
  };

  const hasFilters = Boolean(searchTerm.trim()) || statusFilter !== 'all';

  const pageBg = isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]';
  const surfaceClass = isDark
    ? 'bg-[#1e293b] border-white/10 text-white'
    : 'bg-white border-[#2E4A70]/15 text-[#1a2639]';
  const inputClass = isDark
    ? 'bg-[#162235] border-white/15 text-white placeholder:text-slate-400 focus:border-[#24B0BA] focus:ring-2 focus:ring-[#24B0BA]/25'
    : 'bg-white border-[#2E4A70]/25 text-[#1a2639] placeholder:text-slate-500 focus:border-[#014ba0] focus:ring-2 focus:ring-[#014ba0]/20';
  const optionClass = isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]';
  const selectColorScheme = { colorScheme: isDark ? 'dark' : 'light' };

  if (!isLoaded || initialLoading) {
    return (
      <div className={`w-full min-w-0 p-3 sm:p-6 lg:p-8 min-h-[calc(100vh-4rem)] ${pageBg}`}>
        <div className="w-full max-w-7xl mx-auto space-y-5 animate-pulse">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className={`h-8 w-56 rounded-xl ${isDark ? 'bg-white/10' : 'bg-[#2E4A70]/15'}`} />
              <div className={`h-4 w-72 max-w-full rounded-lg ${isDark ? 'bg-white/5' : 'bg-[#2E4A70]/10'}`} />
            </div>
            <div className="flex gap-2">
              <div className={`h-11 w-28 rounded-xl ${isDark ? 'bg-white/10' : 'bg-[#2E4A70]/15'}`} />
              <div className={`h-11 w-44 rounded-xl ${isDark ? 'bg-white/10' : 'bg-[#014ba0]/20'}`} />
            </div>
          </div>
          <div className={`h-28 rounded-2xl border ${surfaceClass}`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className={`h-44 rounded-2xl border ${surfaceClass}`} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full min-w-0 overflow-x-hidden p-3 sm:p-6 lg:p-8 min-h-[calc(100vh-4rem)] ${pageBg}`}>
      <div className="w-full max-w-7xl mx-auto min-w-0 space-y-4 sm:space-y-5">
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 sm:gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <div
                className={`p-2 rounded-xl shrink-0 ${
                  isDark ? 'bg-[#24B0BA]/15 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
                }`}
              >
                <FileText className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-black tracking-tight break-words">
                Banco de Preguntas
              </h1>
              {totalCount !== null && (
                <span
                  className={`text-xs font-extrabold px-2.5 py-1 rounded-full tabular-nums ${
                    isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
                  }`}
                >
                  {totalCount} en filtro
                </span>
              )}
            </div>
            <p className={`text-xs sm:text-sm font-medium mt-1.5 ${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]'}`}>
              Administra simulacros, programación de disponibilidad y resultados de estudiantes.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={fetchingPage || searchingServer}
              onClick={() => {
                searchPoolCacheRef.current = {};
                pageCacheRef.current = {};
                setPoolVersion((v) => v + 1);
                fetchExamsPage(1, { refreshCount: true, forceRemote: true });
              }}
              className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl border text-xs sm:text-sm font-bold cursor-pointer transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24B0BA] ${
                isDark
                  ? 'bg-[#1e293b] border-white/15 hover:bg-white/10 text-blue-200'
                  : 'bg-white border-[#2E4A70]/25 hover:bg-slate-50 text-[#1a2639]'
              }`}
            >
              <RefreshCw className={`w-4 h-4 shrink-0 ${fetchingPage || searchingServer ? 'animate-spin' : ''}`} />
              <span>Actualizar</span>
            </button>

            <Link
              href="/admin/bank-preguntas/nueva"
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] bg-[#014ba0] hover:bg-[#013b80] text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24B0BA]"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span className="truncate">Nuevo Examen</span>
            </Link>
          </div>
        </header>

        {fetchError && (
          <div
            role="alert"
            className={`p-3.5 sm:p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm ${
              isDark
                ? 'bg-amber-950/35 border-amber-500/40 text-amber-200'
                : 'bg-amber-50 border-amber-300 text-amber-900'
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <p className="font-semibold break-words">{fetchError}</p>
            </div>
            <button
              type="button"
              onClick={() => fetchExamsPage(currentPage, { refreshCount: false, forceRemote: true })}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer shrink-0 self-end sm:self-auto"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Barra de búsqueda y filtros responsiva */}
        <div className={`p-3.5 sm:p-4 rounded-2xl border space-y-3 min-w-0 ${surfaceClass}`}>
          <form onSubmit={handleServerSearch} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 min-w-0">
            <div className="relative sm:col-span-6 lg:col-span-6 min-w-0">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
              <input
                type="text"
                aria-label="Buscar exámenes por título o descripción"
                placeholder="Buscar por título o descripción..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={selectColorScheme}
                className={`w-full min-w-0 min-h-[44px] sm:min-h-[40px] pl-9 pr-9 py-2 rounded-xl border text-base sm:text-sm outline-none transition-colors ${inputClass}`}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Limpiar búsqueda"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg opacity-65 hover:opacity-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:contents gap-2.5">
              <button
                type="submit"
                disabled={fetchingPage || searchingServer || !searchTerm.trim()}
                className={`sm:col-span-3 lg:col-span-2 min-h-[44px] sm:min-h-[40px] px-3 py-2 rounded-xl border text-xs sm:text-sm font-bold cursor-pointer transition-colors disabled:opacity-45 flex items-center justify-center gap-1.5 ${
                  isDark
                    ? 'border-[#24B0BA]/40 bg-[#24B0BA]/15 text-[#24B0BA] hover:bg-[#24B0BA]/25'
                    : 'border-[#014ba0]/25 bg-[#014ba0]/10 text-[#014ba0] hover:bg-[#014ba0]/15'
                }`}
              >
                {searchingServer ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <Search className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">{searchingServer ? 'Buscando...' : 'Buscar en BD'}</span>
              </button>

              <div className="sm:col-span-3 lg:col-span-4 min-w-0">
                <select
                  aria-label="Filtrar por estado"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={selectColorScheme}
                  className={`w-full min-w-0 max-w-full min-h-[44px] sm:min-h-[40px] truncate px-3 py-2 rounded-xl border text-sm font-semibold outline-none cursor-pointer ${inputClass}`}
                >
                  <option value="all" className={optionClass}>Todos los estados</option>
                  <option value="active" className={optionClass}>Activos</option>
                  <option value="inactive" className={optionClass}>Inactivos</option>
                </select>
              </div>
            </div>
          </form>

          <div
            className={`pt-2.5 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs ${
              isDark ? 'border-white/10 text-blue-200/80' : 'border-[#2E4A70]/10 text-[#2E4A70]'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2 font-semibold tabular-nums">
              {(fetchingPage || searchingServer) && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#24B0BA]" />}
              <span>
                {searchingServer
                  ? 'Buscando coincidencias en la base de datos...'
                  : isShowingGlobalSearch
                  ? `${allSearchMatches.length} coincidencia(s) (escaneados ${activeSearchPool.exams.length} en BD) · Pág. ${displayPage} de ${displayTotalPages}`
                  : `Página ${displayPage} de ${displayTotalPages} · ${visibleExams.length} visible(s)`}
              </span>
              {totalCount !== null && !isShowingGlobalSearch && !searchingServer && (
                <span className="opacity-75">· Total: {totalCount}</span>
              )}
              {isShowingGlobalSearch && activeSearchPool?.hasMore && (
                <button
                  type="button"
                  disabled={searchingServer}
                  onClick={() => ensureSearchPoolLoaded({ appendMore: true })}
                  className={`underline font-bold cursor-pointer ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}
                >
                  Seguir buscando (+{MAX_SERVER_SEARCH_DOCS})
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3">
              {hasFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className={`inline-flex items-center gap-1 font-bold underline cursor-pointer py-1 ${
                    isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Limpiar filtros</span>
                </button>
              )}

              {/* Selector de vista: Filas (Tabla) o Tarjetas */}
              <div
                role="group"
                aria-label="Modo de visualización"
                className={`inline-flex rounded-xl p-0.5 border ${
                  isDark ? 'bg-[#162235] border-white/15' : 'bg-[#F0F2F2] border-[#2E4A70]/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSelectViewMode('table')}
                  aria-pressed={viewMode === 'table'}
                  className={`inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    viewMode === 'table'
                      ? isDark
                        ? 'bg-[#24B0BA] text-[#0f172a]'
                        : 'bg-[#014ba0] text-white'
                      : isDark
                      ? 'text-slate-300 hover:text-white'
                      : 'text-[#2E4A70] hover:text-[#1a2639]'
                  }`}
                >
                  <LayoutList className="w-3.5 h-3.5" />
                  <span>Filas</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectViewMode('cards')}
                  aria-pressed={viewMode === 'cards'}
                  className={`inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    viewMode === 'cards'
                      ? isDark
                        ? 'bg-[#24B0BA] text-[#0f172a]'
                        : 'bg-[#014ba0] text-white'
                      : isDark
                      ? 'text-slate-300 hover:text-white'
                      : 'text-[#2E4A70] hover:text-[#1a2639]'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Tarjetas</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <label htmlFor="exams-page-size" className="opacity-80 font-semibold">
                  Por página:
                </label>
                <select
                  id="exams-page-size"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  style={selectColorScheme}
                  className={`min-h-[36px] px-2.5 py-1 rounded-lg border text-xs font-bold outline-none cursor-pointer ${inputClass}`}
                >
                  <option value={10} className={optionClass}>10</option>
                  <option value={25} className={optionClass}>25</option>
                  <option value={50} className={optionClass}>50</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {visibleExams.length === 0 ? (
          <div className={`text-center py-14 px-4 rounded-2xl border-2 border-dashed ${surfaceClass}`}>
            {searchingServer ? (
              <div className="flex flex-col items-center gap-2.5">
                <Loader2 className="w-7 h-7 animate-spin text-[#24B0BA]" />
                <p className="text-sm font-bold opacity-85">Buscando exámenes en la base de datos...</p>
              </div>
            ) : (
              <div className="max-w-md mx-auto space-y-3">
                <div
                  className={`w-12 h-12 mx-auto rounded-2xl flex items-center justify-center ${
                    isDark ? 'bg-white/5 text-blue-300' : 'bg-[#014ba0]/10 text-[#014ba0]'
                  }`}
                >
                  <FileText className="w-6 h-6" />
                </div>
                <p className="text-sm sm:text-base font-bold">
                  {hasFilters ? 'No se encontraron exámenes con estos filtros' : 'Aún no hay exámenes registrados'}
                </p>
                <p className={`text-xs ${isDark ? 'text-slate-300' : 'text-[#2E4A70]'}`}>
                  {hasFilters
                    ? 'Prueba limpiar los filtros o pulsa "Buscar en BD" si buscas un examen en páginas siguientes.'
                    : 'Crea el primer simulacro para que los estudiantes puedan rendirlo.'}
                </p>
                {hasFilters ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-1 inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold cursor-pointer"
                  >
                    Restablecer filtros
                  </button>
                ) : (
                  <Link
                    href="/admin/bank-preguntas/nueva"
                    className="mt-1 inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Registrar Nuevo Examen</span>
                  </Link>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {viewMode === 'cards' ? (
              /* Vista Tarjetas: Móvil y opcional en Tablet/Desktop */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {visibleExams.map((exam) => {
                  const statusInfo = getExamStatusBadge(exam.status, isDark);
                  const qCount = Array.isArray(exam.questions) ? exam.questions.length : 0;
                  const isToggling = togglingExamId === exam.id;

                  return (
                    <article
                      key={exam.id}
                      className={`p-4 rounded-2xl border flex flex-col justify-between gap-3.5 min-w-0 transition-colors ${surfaceClass}`}
                    >
                      <div className="space-y-2.5 min-w-0">
                        <div className="flex items-start justify-between gap-2.5 min-w-0">
                          <h2 className="font-extrabold text-sm sm:text-base leading-snug break-words min-w-0">
                            {exam.title || 'Examen sin título'}
                          </h2>
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${statusInfo.badgeClass}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotClass}`} />
                            <span>{statusInfo.label}</span>
                          </span>
                        </div>

                        <p
                          className={`text-xs leading-relaxed line-clamp-2 ${
                            isDark ? 'text-slate-300' : 'text-slate-600'
                          }`}
                        >
                          {exam.description || 'Sin descripción registrada.'}
                        </p>

                        <div
                          className={`flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs font-semibold tabular-nums ${
                            isDark ? 'text-blue-200/85' : 'text-[#2E4A70]'
                          }`}
                        >
                          <span className="inline-flex items-center gap-1">
                            <ListChecks className="w-3.5 h-3.5 opacity-80 shrink-0" />
                            <span>{qCount} {qCount === 1 ? 'pregunta' : 'preguntas'}</span>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 opacity-80 shrink-0" />
                            <span>{exam.timer ? `${exam.timer} min` : 'Sin límite'}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 min-w-0">
                            <Calendar className="w-3.5 h-3.5 opacity-80 shrink-0" />
                            <span className="truncate">{formatScheduledDate(exam.scheduledAt)}</span>
                          </span>
                        </div>
                      </div>

                      <div
                        className={`pt-3 border-t grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 ${
                          isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
                        }`}
                      >
                        <Link
                          href={`/admin/bank-preguntas/editar/${exam.id}`}
                          className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold transition-colors sm:flex-1"
                        >
                          <Edit3 className="w-3.5 h-3.5 shrink-0" />
                          <span>Editar</span>
                        </Link>

                        <button
                          type="button"
                          onClick={() => router.push(`/admin/bank-preguntas/resultados/${exam.id}`)}
                          className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-colors sm:flex-1 ${
                            isDark
                              ? 'border-white/15 hover:bg-white/10 text-slate-100'
                              : 'border-[#2E4A70]/25 hover:bg-slate-50 text-[#1a2639]'
                          }`}
                        >
                          <BarChart3 className="w-3.5 h-3.5 shrink-0" />
                          <span>Resultados</span>
                        </button>

                        <button
                          type="button"
                          disabled={isToggling}
                          onClick={() => toggleExamStatus(exam)}
                          className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl text-white text-xs font-bold cursor-pointer transition-colors disabled:opacity-60 ${
                            exam.status === 'active'
                              ? 'bg-amber-600 hover:bg-amber-700'
                              : 'bg-emerald-600 hover:bg-emerald-700'
                          }`}
                        >
                          <Power className="w-3.5 h-3.5 shrink-0" />
                          <span>{exam.status === 'active' ? 'Desactivar' : 'Activar'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => openDeleteModal(exam)}
                          aria-label={`Eliminar examen ${exam.title}`}
                          title="Eliminar examen"
                          className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                            isDark
                              ? 'border-red-500/30 bg-red-500/15 hover:bg-red-500/25 text-red-300'
                              : 'border-red-200 bg-red-50 hover:bg-red-100 text-red-700'
                          }`}
                        >
                          <Trash2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Eliminar</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              /* Vista Filas (Tabla): Conserva las filas en escritorio/tablet y con scroll horizontal fluido si se activa en móvil */
              <div className={`w-full min-w-0 overflow-x-auto rounded-2xl border ${surfaceClass}`}>
                <table className={`w-full min-w-[760px] text-left border-collapse divide-y ${isDark ? 'divide-white/10' : 'divide-[#2E4A70]/10'}`}>
                  <thead className={isDark ? 'bg-[#162235]' : 'bg-[#FFF9F0]'}>
                    <tr>
                      <th className={`p-3.5 xl:p-4 text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                        Examen
                      </th>
                      <th className={`p-3.5 xl:p-4 text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                        Configuración
                      </th>
                      <th className={`p-3.5 xl:p-4 text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                        Estado
                      </th>
                      <th className={`p-3.5 xl:p-4 text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                        Programación
                      </th>
                      <th className={`p-3.5 xl:p-4 text-[11px] font-extrabold uppercase tracking-wider text-right ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-white/10 bg-[#1e293b]' : 'divide-[#2E4A70]/10 bg-white'}`}>
                    {visibleExams.map((exam) => {
                      const statusInfo = getExamStatusBadge(exam.status, isDark);
                      const qCount = Array.isArray(exam.questions) ? exam.questions.length : 0;
                      const isToggling = togglingExamId === exam.id;

                      return (
                        <tr
                          key={exam.id}
                          className={`transition-colors ${isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-[#FFF9F0]/60'}`}
                        >
                          <td className="p-3.5 xl:p-4 max-w-sm xl:max-w-md">
                            <div className="font-bold text-sm leading-snug">{exam.title || 'Examen sin título'}</div>
                            <div className={`text-xs mt-0.5 line-clamp-1 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                              {exam.description || 'Sin descripción'}
                            </div>
                          </td>
                          <td className="p-3.5 xl:p-4 whitespace-nowrap">
                            <div className={`text-xs font-semibold tabular-nums space-y-0.5 ${isDark ? 'text-blue-200/85' : 'text-[#2E4A70]'}`}>
                              <div className="flex items-center gap-1.5">
                                <ListChecks className="w-3.5 h-3.5 opacity-80" />
                                <span>{qCount} {qCount === 1 ? 'pregunta' : 'preguntas'}</span>
                              </div>
                              <div className="flex items-center gap-1.5 opacity-85">
                                <Clock className="w-3.5 h-3.5" />
                                <span>{exam.timer ? `${exam.timer} min` : 'Sin límite'}</span>
                              </div>
                            </div>
                          </td>
                          <td className="p-3.5 xl:p-4 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${statusInfo.badgeClass}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotClass}`} />
                              <span>{statusInfo.label}</span>
                            </span>
                          </td>
                          <td className={`p-3.5 xl:p-4 text-xs whitespace-nowrap tabular-nums ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                            {formatScheduledDate(exam.scheduledAt)}
                          </td>
                          <td className="p-3.5 xl:p-4 whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5 xl:gap-2">
                              <Link
                                href={`/admin/bank-preguntas/editar/${exam.id}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold transition-colors"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Editar</span>
                              </Link>
                              <button
                                type="button"
                                disabled={isToggling}
                                onClick={() => toggleExamStatus(exam)}
                                className={`px-2.5 py-1.5 rounded-xl text-white text-xs font-bold cursor-pointer transition-colors disabled:opacity-60 ${
                                  exam.status === 'active'
                                    ? 'bg-amber-600 hover:bg-amber-700'
                                    : 'bg-emerald-600 hover:bg-emerald-700'
                                }`}
                              >
                                {exam.status === 'active' ? 'Desactivar' : 'Activar'}
                              </button>
                              <button
                                type="button"
                                onClick={() => router.push(`/admin/bank-preguntas/resultados/${exam.id}`)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                                  isDark ? 'border-white/15 hover:bg-white/10 text-slate-100' : 'border-[#2E4A70]/25 hover:bg-slate-50 text-[#1a2639]'
                                }`}
                              >
                                <BarChart3 className="w-3.5 h-3.5" />
                                <span>Resultados</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openDeleteModal(exam)}
                                aria-label={`Eliminar examen ${exam.title}`}
                                className={`p-2 rounded-xl cursor-pointer transition-colors ${
                                  isDark ? 'text-red-400 hover:bg-red-500/15' : 'text-red-600 hover:bg-red-50'
                                }`}
                                title="Eliminar"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {visibleExams.length > 0 && (
          <nav
            aria-label="Navegación de páginas"
            className={`p-3.5 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs ${surfaceClass}`}
          >
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 font-semibold tabular-nums">
              <span className={isDark ? 'text-blue-200/85' : 'text-[#2E4A70]'}>
                Mostrando {(displayPage - 1) * pageSize + 1}–{(displayPage - 1) * pageSize + visibleExams.length}
                {isSearchMode
                  ? ` de ${allSearchMatches.length} coincidencia(s)`
                  : totalCount !== null
                  ? ` de ${totalCount} exámenes`
                  : ''}
              </span>
              <span className="opacity-50">·</span>
              <span>
                Página <strong>{displayPage}</strong> de <strong>{displayTotalPages}</strong>
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-center md:justify-end gap-2">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  aria-label="Página anterior"
                  disabled={displayPage <= 1 || fetchingPage}
                  onClick={() => handlePageChange(displayPage - 1)}
                  className={`inline-flex items-center justify-center gap-1 min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-xl border font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/25 hover:bg-slate-50'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">Anterior</span>
                </button>

                {paginationItems.map((item) => {
                  if (typeof item === 'string') {
                    return (
                      <span key={item} className="px-1.5 font-bold opacity-50 select-none">
                        …
                      </span>
                    );
                  }
                  const isActive = item === displayPage;
                  return (
                    <button
                      key={item}
                      type="button"
                      disabled={fetchingPage && !isSearchMode}
                      onClick={() => handlePageChange(item)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`min-w-[38px] sm:min-w-[36px] h-10 sm:h-9 px-2 rounded-xl border font-extrabold tabular-nums transition-colors cursor-pointer disabled:opacity-60 ${
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
                  aria-label="Página siguiente"
                  disabled={!displayHasMore || fetchingPage}
                  onClick={() => handlePageChange(displayPage + 1)}
                  className={`inline-flex items-center justify-center gap-1 min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-xl border font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/25 hover:bg-slate-50'
                  }`}
                >
                  <span className="hidden sm:inline">Siguiente</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {displayTotalPages > 1 && (
                <form onSubmit={handleJumpToPage} className="flex items-center gap-1.5">
                  <label htmlFor="exams-jump-page" className="font-semibold opacity-75 whitespace-nowrap">
                    Ir a pág.:
                  </label>
                  <input
                    id="exams-jump-page"
                    type="number"
                    min={1}
                    max={displayTotalPages}
                    value={jumpPageInput}
                    onChange={(e) => setJumpPageInput(e.target.value)}
                    placeholder={`1-${displayTotalPages}`}
                    style={selectColorScheme}
                    className={`w-16 min-h-[36px] px-2 py-1 rounded-lg border text-xs font-bold text-center outline-none tabular-nums ${inputClass}`}
                  />
                  <button
                    type="submit"
                    disabled={fetchingPage && !isSearchMode}
                    className={`min-h-[36px] px-3 py-1 rounded-lg border font-bold cursor-pointer transition-colors disabled:opacity-50 ${
                      isDark
                        ? 'border-[#24B0BA]/40 bg-[#24B0BA]/15 text-[#24B0BA] hover:bg-[#24B0BA]/25'
                        : 'border-[#014ba0]/25 bg-[#014ba0]/10 text-[#014ba0] hover:bg-[#014ba0]/15'
                    }`}
                  >
                    Ir
                  </button>
                </form>
              )}
            </div>
          </nav>
        )}

        {showDeleteModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-exam-modal-title"
            onClick={() => {
              if (!deletingExam) {
                setShowDeleteModal(false);
                setExamToDelete(null);
              }
            }}
            className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex justify-center items-center z-50 p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`p-6 rounded-2xl border shadow-xl max-w-md w-full text-center space-y-4 ${surfaceClass}`}
            >
              <div
                className={`w-12 h-12 mx-auto rounded-2xl flex items-center justify-center ${
                  isDark ? 'bg-red-500/15 text-red-400' : 'bg-red-50 text-red-600'
                }`}
              >
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 id="delete-exam-modal-title" className="font-extrabold text-base sm:text-lg">
                  Eliminar examen
                </h3>
                <p className={`text-xs sm:text-sm ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  ¿Estás seguro de eliminar permanentemente{' '}
                  <strong className={isDark ? 'text-white' : 'text-[#1a2639]'}>
                    &quot;{examToDelete?.title}&quot;
                  </strong>
                  ? Esta acción no se puede deshacer.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={deletingExam}
                  onClick={() => {
                    setShowDeleteModal(false);
                    setExamToDelete(null);
                  }}
                  className={`min-h-[44px] px-4 py-2 rounded-xl border text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-50 ${
                    isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/25 hover:bg-slate-50'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deletingExam}
                  onClick={handleDelete}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-60"
                >
                  {deletingExam && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{deletingExam ? 'Eliminando...' : 'Sí, Eliminar'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
