'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  collection,
  getDocs,
  getCountFromServer,
  query,
  orderBy,
  limit,
  startAfter,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Swal from 'sweetalert2';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import {
  Check,
  X,
  User,
  Mail,
  Calendar,
  Phone,
  MessageSquare,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

const DEFAULT_PAGE_SIZE = 24;
const SEARCH_BATCH_SIZE = 48;
const MAX_SERVER_SEARCH_DOCS = 48;

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function matchesRequestSearch(req, normalizedTerm) {
  if (!normalizedTerm) return true;
  const haystack = normalizeSearchText(
    [req.userName, req.userEmail, req.userPhone, req.id].join(' ')
  );
  return haystack.includes(normalizedTerm);
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

export default function AdminAccessRequestsPage() {
  const { isDark } = useTheme();
  const { firebaseAuthUser } = useAuth();

  const [solicitudes, setSolicitudes] = useState([]);
  const [totalCount, setTotalCount] = useState(null);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchingPage, setFetchingPage] = useState(false);
  const [searchingServer, setSearchingServer] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [poolVersion, setPoolVersion] = useState(0);

  const [searchTerm, setSearchTerm] = useState('');

  const pageCacheRef = useRef({});
  const searchPoolRef = useRef(null);
  const reqSeqRef = useRef(0);
  const searchSeqRef = useRef(0);

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f8fafc' : '#1a2639',
    }),
    [isDark]
  );

  const fetchRequestsPage = useCallback(
    async (targetPage = 1, { refreshCount = false, forceRemote = false } = {}) => {
      const safeTargetPage = Math.max(1, targetPage);
      const cacheKey = String(pageSize);

      if (!pageCacheRef.current[cacheKey]) {
        pageCacheRef.current[cacheKey] = {
          pages: {},
          endCursors: {},
          hasMoreByPage: {},
          highestPage: 0,
          useNoOrderFallback: false,
        };
      }
      const cacheEntry = pageCacheRef.current[cacheKey];

      if (!forceRemote && !refreshCount && cacheEntry.pages[safeTargetPage]) {
        setSolicitudes(cacheEntry.pages[safeTargetPage]);
        setHasMore(Boolean(cacheEntry.hasMoreByPage[safeTargetPage]));
        setCurrentPage(safeTargetPage);
        setFetchError('');
        setLoading(false);
        return;
      }

      const seq = ++reqSeqRef.current;
      setFetchingPage(true);
      setFetchError('');

      try {
        const baseRef = collection(db, 'pagoUnico_solicitudes');

        if (refreshCount || safeTargetPage === 1) {
          try {
            const countSnap = await getCountFromServer(baseRef);
            if (seq === reqSeqRef.current) {
              setTotalCount(countSnap.data().count);
            }
          } catch {
            // No bloquea si falla conteo
          }
        }

        const buildQuery = (withOrder, afterDoc, batchLimit) => {
          const parts = [];
          if (withOrder) parts.push(orderBy('requestDate', 'desc'));
          if (afterDoc) parts.push(startAfter(afterDoc));
          parts.push(limit(batchLimit));
          return query(baseRef, ...parts);
        };

        let useOrder = !cacheEntry.useNoOrderFallback;
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
        const maxChunkDocs = 48;

        while (pagesLeftToLoad > 0) {
          const pagesInChunk = Math.min(pagesLeftToLoad, Math.max(1, Math.floor(maxChunkDocs / pageSize)));
          const askCount = pagesInChunk * pageSize + 1;

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
          searchPoolRef.current = { items: cacheEntry.pages[1], lastDoc: null, hasMore: false };
          setPoolVersion((v) => v + 1);
        }

        const resolvedPage = cacheEntry.pages[safeTargetPage]
          ? safeTargetPage
          : Math.max(1, cacheEntry.highestPage);
        setSolicitudes(cacheEntry.pages[resolvedPage] || []);
        setHasMore(Boolean(cacheEntry.hasMoreByPage[resolvedPage]));
        setCurrentPage(resolvedPage);
      } catch (err) {
        if (seq !== reqSeqRef.current) return;
        console.error('Error cargando solicitudes:', err);
        if (err?.code === 'resource-exhausted') {
          setFetchError(
            'Se alcanzó temporalmente la cuota diaria de lecturas de Firestore. Vuelve a intentar cuando se reinicie.'
          );
        } else {
          setFetchError(err?.message || 'No se pudieron cargar las solicitudes.');
        }
      } finally {
        if (seq === reqSeqRef.current) {
          setLoading(false);
          setFetchingPage(false);
        }
      }
    },
    [pageSize]
  );

  useEffect(() => {
    fetchRequestsPage(1, { refreshCount: true, forceRemote: true });
  }, [fetchRequestsPage]);

  const ensureSearchPoolLoaded = useCallback(async ({ appendMore = false } = {}) => {
    const existing = searchPoolRef.current;
    if (!appendMore && existing && (!existing.hasMore || existing.items.length > 0)) {
      return existing;
    }

    const seq = ++searchSeqRef.current;
    setSearchingServer(true);
    setFetchError('');

    try {
      const baseRef = collection(db, 'pagoUnico_solicitudes');
      const accumulated = appendMore && existing ? [...existing.items] : [];
      const seenIds = new Set(accumulated.map((item) => item.id));
      let cursor = appendMore && existing ? existing.lastDoc : null;
      let batchHasMore = true;
      let batchesLoaded = 0;
      const maxBatches = Math.ceil(MAX_SERVER_SEARCH_DOCS / SEARCH_BATCH_SIZE);

      while (batchHasMore && batchesLoaded < maxBatches) {
        const parts = [];
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

      accumulated.sort((a, b) => (b.requestDate?.seconds || 0) - (a.requestDate?.seconds || 0));
      const updatedPool = { items: accumulated, lastDoc: cursor, hasMore: batchHasMore };
      searchPoolRef.current = updatedPool;
      setPoolVersion((v) => v + 1);
      return updatedPool;
    } catch (err) {
      if (seq !== searchSeqRef.current) return null;
      if (err?.code === 'resource-exhausted') {
        setFetchError('Cuota diaria de Firestore agotada temporalmente; filtrando sobre lo cargado.');
      } else {
        setFetchError(err?.message || 'Error buscando solicitudes.');
      }
      return null;
    } finally {
      if (seq === searchSeqRef.current) {
        setSearchingServer(false);
      }
    }
  }, []);

  // El input filtra en memoria (0 lecturas); la búsqueda en BD se ejecuta solo bajo clic explícito en lotes de 48
  const removeRequestLocally = useCallback((requestId) => {
    setSolicitudes((prev) => prev.filter((item) => item.id !== requestId));
    Object.keys(pageCacheRef.current).forEach((key) => {
      const entry = pageCacheRef.current[key];
      if (entry?.pages) {
        Object.keys(entry.pages).forEach((p) => {
          entry.pages[p] = entry.pages[p].filter((item) => item.id !== requestId);
        });
      }
    });
    if (searchPoolRef.current) {
      searchPoolRef.current.items = searchPoolRef.current.items.filter((item) => item.id !== requestId);
      setPoolVersion((v) => v + 1);
    }
    setTotalCount((prev) => (prev !== null ? Math.max(0, prev - 1) : prev));
  }, []);

  const handleApprove = async (solicitud) => {
    const whatsappLink = solicitud.userPhone
      ? `https://api.whatsapp.com/send?phone=${solicitud.userPhone}&text=${encodeURIComponent(
          `Hola ${solicitud.userName}, te contacto desde DOCTEMIA MC para confirmar tu acceso.`
        )}`
      : null;

    Swal.fire({
      title: `¿Aprobar a ${solicitud.userName}?`,
      html: `
        <div class="text-left space-y-2">
          <p>Estás a punto de conceder acceso a todos los cursos de pago único a este usuario.</p>
          <p><strong>Usuario:</strong> ${solicitud.userName}</p>
          <p><strong>Email:</strong> ${solicitud.userEmail}</p>
          ${solicitud.userPhone ? `<p><strong>Teléfono:</strong> ${solicitud.userPhone}</p>` : ''}
          <p class="mt-4 font-semibold">¿Has verificado el pago correspondiente?</p>
        </div>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, aprobar acceso',
      cancelButtonText: 'Cancelar',
      showDenyButton: Boolean(whatsappLink),
      denyButtonText: 'Contactar',
      confirmButtonColor: '#22c55e',
      denyButtonColor: '#3b82f6',
      ...swalTheme,
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          if (!solicitud?.userId) {
            throw new Error('La solicitud no contiene un ID de usuario válido.');
          }
          const headers = { 'Content-Type': 'application/json' };
          if (firebaseAuthUser && typeof firebaseAuthUser.getIdToken === 'function') {
            const token = await firebaseAuthUser.getIdToken();
            if (token) headers.Authorization = `Bearer ${token}`;
          }
          const res = await fetch('/api/users/bulk-update', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              userIds: [solicitud.userId],
              changes: { pagoUnicoMode: 'grant' },
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data?.error || 'No se pudo habilitar el acceso en el servidor.');
          }
          await deleteDoc(doc(db, 'pagoUnico_solicitudes', solicitud.id));
          removeRequestLocally(solicitud.id);
          Swal.fire({ title: '¡Aprobado!', text: `${solicitud.userName} ahora tiene acceso.`, icon: 'success', ...swalTheme });
        } catch (error) {
          console.error('Error approving access:', error);
          Swal.fire({ title: 'Error', text: error?.message || 'No se pudo completar la operación.', icon: 'error', ...swalTheme });
        }
      } else if (result.isDenied && whatsappLink) {
        window.open(whatsappLink, '_blank');
      }
    });
  };

  const handleReject = async (solicitud) => {
    Swal.fire({
      title: '¿Rechazar Solicitud?',
      text: `Esta acción eliminará la solicitud de ${solicitud.userName} permanentemente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, rechazar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
      ...swalTheme,
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await deleteDoc(doc(db, 'pagoUnico_solicitudes', solicitud.id));
          removeRequestLocally(solicitud.id);
          Swal.fire({ title: 'Rechazada', text: 'La solicitud ha sido eliminada.', icon: 'success', ...swalTheme });
        } catch (error) {
          console.error('Error rejecting request:', error);
          Swal.fire({ title: 'Error', text: 'No se pudo eliminar la solicitud.', icon: 'error', ...swalTheme });
        }
      }
    });
  };

  const normalizedSearchTerm = useMemo(() => normalizeSearchText(searchTerm.trim()), [searchTerm]);
  const activeSearchPool = useMemo(() => {
    void poolVersion;
    return searchPoolRef.current;
  }, [poolVersion]);

  const isSearchMode = Boolean(normalizedSearchTerm);
  const isShowingGlobalSearch = Boolean(normalizedSearchTerm && activeSearchPool);

  useEffect(() => {
    setSearchPage(1);
  }, [normalizedSearchTerm, pageSize]);

  const allSearchMatches = useMemo(() => {
    if (!isSearchMode) return [];
    const source = activeSearchPool ? activeSearchPool.items : solicitudes;
    return source.filter((item) => matchesRequestSearch(item, normalizedSearchTerm));
  }, [isSearchMode, activeSearchPool, solicitudes, normalizedSearchTerm]);

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

  const visibleRequests = useMemo(() => {
    if (!isSearchMode) return solicitudes;
    const start = (displayPage - 1) * pageSize;
    return allSearchMatches.slice(start, start + pageSize);
  }, [isSearchMode, solicitudes, allSearchMatches, displayPage, pageSize]);

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
        fetchRequestsPage(clamped);
      }
    },
    [displayTotalPages, displayPage, isSearchMode, fetchRequestsPage]
  );

  if (loading) {
    return (
      <div
        className={`p-8 min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center gap-3 font-bold ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <Loader2 className={`w-8 h-8 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
        <span>Cargando solicitudes...</span>
      </div>
    );
  }

  const surfaceClass = isDark
    ? 'bg-[#1e293b] border-white/10 text-white'
    : 'bg-white border-[#2E4A70]/20 text-[#1a2639] shadow-xs';
  const inputClass = isDark
    ? 'bg-[#162235] border-white/15 text-white placeholder:text-slate-400 focus:border-[#24B0BA]'
    : 'bg-white border-[#2E4A70]/25 text-[#1a2639] placeholder:text-slate-400 focus:border-[#014ba0]';
  const optionClass = isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]';
  const selectColorScheme = { colorScheme: isDark ? 'dark' : 'light' };

  return (
    <div className={`w-full min-w-0 overflow-x-hidden p-4 md:p-6 min-h-[calc(100vh-4rem)] ${isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'}`}>
      <div className="max-w-7xl mx-auto min-w-0 space-y-5">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className={`text-2xl sm:text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-[#1a2639]'}`}>
              Solicitudes de Acceso (Pago Único)
            </h1>
            {totalCount !== null && (
              <span
                className={`text-xs font-extrabold px-2.5 py-1 rounded-full tabular-nums ${
                  isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
                }`}
              >
                {totalCount} pendientes
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={fetchingPage || searchingServer}
            onClick={() => {
              searchPoolRef.current = null;
              pageCacheRef.current = {};
              setPoolVersion((v) => v + 1);
              fetchRequestsPage(1, { refreshCount: true, forceRemote: true });
            }}
            className={`inline-flex items-center gap-1.5 self-start sm:self-auto px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 ${
              isDark
                ? 'bg-[#1e293b] border-white/15 hover:bg-white/10 text-blue-200'
                : 'bg-white border-[#2E4A70]/25 hover:bg-slate-50 text-[#1a2639]'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${fetchingPage || searchingServer ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </header>

        {fetchError && (
          <div
            className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm ${
              isDark
                ? 'bg-amber-950/35 border-amber-500/40 text-amber-200'
                : 'bg-amber-50 border-amber-300 text-amber-900'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <p className="font-semibold">{fetchError}</p>
            </div>
            <button
              type="button"
              onClick={() => fetchRequestsPage(currentPage, { refreshCount: false, forceRemote: true })}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer shrink-0"
            >
              Reintentar
            </button>
          </div>
        )}

        <div className={`p-4 rounded-2xl border space-y-3 min-w-0 ${surfaceClass}`}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (searchTerm.trim()) ensureSearchPoolLoaded({ appendMore: false });
            }}
            className="flex flex-col sm:flex-row gap-2.5 min-w-0"
          >
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar por nombre, correo o teléfono..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={selectColorScheme}
                className={`w-full min-w-0 pl-9 pr-8 py-2.5 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
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
            <button
              type="submit"
              disabled={fetchingPage || searchingServer || !searchTerm.trim()}
              className={`px-3.5 py-2.5 rounded-xl border text-xs font-bold cursor-pointer shrink-0 transition-colors disabled:opacity-50 ${
                isDark
                  ? 'border-[#24B0BA]/40 bg-[#24B0BA]/15 text-[#24B0BA] hover:bg-[#24B0BA]/25'
                  : 'border-[#014ba0]/25 bg-[#014ba0]/10 text-[#014ba0] hover:bg-[#014ba0]/15'
              }`}
            >
              {searchingServer ? 'Buscando...' : 'Buscar en BD'}
            </button>
          </form>

          <div
            className={`pt-2.5 border-t flex flex-wrap items-center justify-between gap-2 text-xs ${
              isDark ? 'border-white/10 text-blue-200/80' : 'border-[#2E4A70]/10 text-[#2E4A70]'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2 font-semibold tabular-nums">
              {(fetchingPage || searchingServer) && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#24B0BA]" />}
              <span>
                {searchingServer
                  ? 'Buscando solicitudes...'
                  : isShowingGlobalSearch
                  ? `${allSearchMatches.length} coincidencia(s) · Pág. ${displayPage} de ${displayTotalPages}`
                  : `Página ${displayPage} de ${displayTotalPages} · ${visibleRequests.length} solicitudes visibles`}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="opacity-75 font-semibold">Por página:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={selectColorScheme}
                className={`px-2 py-1 rounded-lg border text-xs font-bold outline-none cursor-pointer ${inputClass}`}
              >
                <option value={24} className={optionClass}>24</option>
                <option value={48} className={optionClass}>48</option>
              </select>
            </div>
          </div>
        </div>

        {visibleRequests.length === 0 ? (
          <div className={`text-center py-16 px-6 rounded-2xl border-2 border-dashed ${isDark ? 'border-white/15 bg-[#1e293b] text-white' : 'border-[#2E4A70]/25 bg-white text-[#1a2639]'}`}>
            <h3 className={`text-xl font-extrabold ${isDark ? 'text-white' : 'text-[#1a2639]'}`}>
              {searchTerm.trim() ? 'Sin coincidencias' : '¡Todo al día!'}
            </h3>
            <p className={`${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]'} mt-2 text-sm font-medium`}>
              {searchTerm.trim()
                ? 'No hay solicitudes que coincidan con tu búsqueda.'
                : 'No hay solicitudes pendientes en este momento.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {visibleRequests.map((solicitud) => {
              const formattedDate = solicitud.requestDate?.toDate
                ? solicitud.requestDate.toDate().toLocaleString('es-ES', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Fecha pendiente';

              return (
                <div
                  key={solicitud.id}
                  className={`p-5 rounded-2xl border flex flex-col gap-4 transition-colors ${surfaceClass}`}
                >
                  <div className="space-y-3 flex-grow min-w-0">
                    <p className="flex items-center gap-2.5 min-w-0">
                      <User size={18} className={`shrink-0 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
                      <strong className={`text-base sm:text-lg font-extrabold truncate ${isDark ? 'text-white' : 'text-[#1a2639]'}`}>
                        {solicitud.userName || 'Sin nombre'}
                      </strong>
                    </p>
                    <p className={`flex items-center gap-2.5 min-w-0 ${isDark ? 'text-slate-200' : 'text-[#2E4A70]'}`}>
                      <Mail size={16} className={`shrink-0 ${isDark ? 'text-slate-400' : 'text-[#014ba0]/75'}`} />
                      <span className="truncate text-sm font-semibold">{solicitud.userEmail || 'Sin correo'}</span>
                    </p>
                    {solicitud.userPhone && (
                      <p className={`flex items-center gap-2.5 min-w-0 ${isDark ? 'text-slate-200' : 'text-[#2E4A70]'}`}>
                        <Phone size={16} className={`shrink-0 ${isDark ? 'text-slate-400' : 'text-[#014ba0]/75'}`} />
                        <span className="text-sm font-semibold tabular-nums">{solicitud.userPhone}</span>
                      </p>
                    )}
                    <p className={`flex items-center gap-2.5 text-xs font-semibold tabular-nums ${isDark ? 'text-slate-300' : 'text-[#2E4A70]/85'}`}>
                      <Calendar size={14} className="shrink-0" />
                      <span>{formattedDate}</span>
                    </p>
                  </div>
                  <div className={`flex justify-end items-center gap-2 pt-3 border-t ${isDark ? 'border-white/10' : 'border-[#2E4A70]/15'}`}>
                    {solicitud.userPhone && (
                      <a
                        href={`https://api.whatsapp.com/send?phone=${solicitud.userPhone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Contactar por WhatsApp a ${solicitud.userName || 'usuario'}`}
                        title="Contactar por WhatsApp"
                        className={`p-2 rounded-xl transition-colors ${
                          isDark
                            ? 'text-emerald-400 hover:bg-emerald-500/15'
                            : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                        }`}
                      >
                        <MessageSquare size={18} />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => handleReject(solicitud)}
                      aria-label={`Rechazar solicitud de ${solicitud.userName || 'usuario'}`}
                      title="Rechazar solicitud"
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-red-600 text-white hover:bg-red-700 cursor-pointer transition-colors"
                    >
                      <X size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApprove(solicitud)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer transition-colors"
                    >
                      <Check size={15} />
                      <span>Aprobar</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {displayTotalPages > 1 && (
          <div className={`p-3.5 rounded-2xl border flex flex-wrap items-center justify-center sm:justify-between gap-2 text-xs ${surfaceClass}`}>
            <button
              type="button"
              disabled={displayPage <= 1 || fetchingPage}
              onClick={() => handlePageChange(displayPage - 1)}
              className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl border font-bold cursor-pointer disabled:opacity-40 ${
                isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/25 hover:bg-slate-50'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Anterior</span>
            </button>

            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {paginationItems.map((item) => {
                if (typeof item === 'string') {
                  return (
                    <span key={item} className="px-1.5 font-bold opacity-50 select-none">
                      ...
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
                    className={`min-w-[34px] h-9 px-2 rounded-xl border font-extrabold tabular-nums transition-colors cursor-pointer disabled:opacity-60 ${
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
            </div>

            <button
              type="button"
              disabled={!displayHasMore || fetchingPage}
              onClick={() => handlePageChange(displayPage + 1)}
              className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl border font-bold cursor-pointer disabled:opacity-40 ${
                isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/25 hover:bg-slate-50'
              }`}
            >
              <span>Siguiente</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
