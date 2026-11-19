'use client';

import { useState, useEffect, Suspense, useMemo, useRef, useCallback } from 'react';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  getCountFromServer,
  limit,
  startAfter,
  doc,
  getDoc,
  deleteDoc,
} from 'firebase/firestore';
import { useParams, useRouter } from 'next/navigation';
import { useTheme } from '@/context/ThemeContext';
import Swal from 'sweetalert2';
import {
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2,
  X,
} from 'lucide-react';

const DEFAULT_PAGE_SIZE = 25;
const SEARCH_BATCH_SIZE = 50;

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

// --- Modal Component ---
function AttemptDetailsModal({ attempt, exam, onClose, isDark }) {
  const answersWithDetails = useMemo(() => {
    if (!attempt || !exam || !Array.isArray(exam.questions)) return [];
    return exam.questions.map((question, index) => {
      const userAnswer = attempt.answers?.[index];
      return { question, userAnswer };
    });
  }, [exam, attempt]);

  if (!attempt || !exam) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 p-4 transition-opacity duration-300">
      <div
        className={`rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col ${
          isDark ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'
        }`}
      >
        <div className={`px-6 py-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          <h2 className="text-2xl font-bold">Detalles del Intento</h2>
          <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>
            Usuario: <span className="font-medium">{attempt.userEmail}</span>
          </p>
          <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>
            Puntaje: <span className="font-medium">{attempt.score}/100</span>
          </p>
        </div>

        <div className="overflow-y-auto p-6 space-y-6">
          {answersWithDetails.map(({ question, userAnswer }, index) => (
            <div key={index} className={`p-4 rounded-md ${isDark ? 'bg-gray-700' : 'bg-gray-100'}`}>
              <p className="font-semibold mb-2">
                P{index + 1}: {question.questionText}
              </p>

              {question.type === 'open-ended' ? (
                <div className="space-y-2">
                  <div>
                    <h4 className={`text-sm font-bold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                      Respuesta del Usuario:
                    </h4>
                    <p className={`p-2 rounded ${isDark ? 'bg-gray-800' : 'bg-white'}`}>
                      {userAnswer?.textAnswer || (
                        <span className="italic text-gray-500">No contestada</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <h4
                      className={`text-sm font-bold ${isDark ? 'text-green-400' : 'text-green-600'}`}
                    >
                      Respuesta Correcta de Referencia:
                    </h4>
                    <p className={`p-2 rounded ${isDark ? 'bg-gray-800' : 'bg-white'}`}>
                      {question.correctAnswer}
                    </p>
                  </div>
                </div>
              ) : (
                <ul className="space-y-1">
                  {(question.options || []).map((option, optIndex) => {
                    const isUserAnswer = userAnswer?.selectedOptionIndex === optIndex;
                    const isCorrectAnswer = question.correctOptionIndex === optIndex;
                    let optionClass = isDark ? 'bg-gray-800' : 'bg-white';
                    if (isUserAnswer && isCorrectAnswer)
                      optionClass = isDark
                        ? 'bg-green-800 border-green-500'
                        : 'bg-green-100 border-green-500';
                    else if (isUserAnswer && !isCorrectAnswer)
                      optionClass = isDark
                        ? 'bg-red-800 border-red-500'
                        : 'bg-red-100 border-red-500';
                    else if (isCorrectAnswer)
                      optionClass = isDark
                        ? 'bg-green-800 border-green-500'
                        : 'bg-green-100 border-green-500';

                    return (
                      <li
                        key={optIndex}
                        className={`p-2 rounded border ${
                          isDark ? 'border-gray-600' : 'border-gray-300'
                        } ${optionClass}`}
                      >
                        {option}
                        {isUserAnswer && <span className="text-xs font-bold ml-2"> (Tu respuesta)</span>}
                        {isCorrectAnswer && !isUserAnswer && (
                          <span className="text-xs font-bold ml-2"> (Correcta)</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div
          className={`px-6 py-3 border-t ${
            isDark ? 'border-gray-700' : 'border-gray-200'
          } text-right`}
        >
          <button
            onClick={onClose}
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer ${
              isDark
                ? 'bg-gray-600 hover:bg-gray-500 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
            }`}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultadosContent() {
  const { examId } = useParams();
  const router = useRouter();
  const { isDark } = useTheme();

  const [attempts, setAttempts] = useState([]);
  const [exam, setExam] = useState(null);
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
  const [deletingId, setDeletingId] = useState(null);
  const [selectedAttempt, setSelectedAttempt] = useState(null);

  const pageCacheRef = useRef({});
  const searchPoolRef = useRef(null);
  const reqSeqRef = useRef(0);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    const loadExamHeader = async () => {
      try {
        const examSnap = await getDoc(doc(db, 'exams', examId));
        if (cancelled) return;
        if (examSnap.exists()) {
          setExam({ id: examSnap.id, ...examSnap.data() });
        } else {
          Swal.fire('Error', 'El examen que buscas no existe.', 'error');
          router.push('/admin/bank-preguntas');
        }
      } catch (err) {
        console.error('Error cargando examen:', err);
      }
    };
    loadExamHeader();
    return () => {
      cancelled = true;
    };
  }, [examId, router]);

  const fetchAttemptsPage = useCallback(
    async (targetPage = 1, { refreshCount = false, forceRemote = false } = {}) => {
      if (!examId) return;
      const safeTargetPage = Math.max(1, targetPage);
      const cacheKey = `${examId}::${pageSize}`;

      if (!pageCacheRef.current[cacheKey]) {
        pageCacheRef.current[cacheKey] = {
          pages: {},
          endCursors: {},
          hasMoreByPage: {},
          highestPage: 0,
        };
      }
      const cacheEntry = pageCacheRef.current[cacheKey];

      if (!forceRemote && !refreshCount && cacheEntry.pages[safeTargetPage]) {
        setAttempts(cacheEntry.pages[safeTargetPage]);
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
        const baseRef = collection(db, 'examAttempts');
        const examConstraint = where('examId', '==', examId);

        if (refreshCount || safeTargetPage === 1) {
          try {
            const countSnap = await getCountFromServer(query(baseRef, examConstraint));
            if (seq === reqSeqRef.current) {
              setTotalCount(countSnap.data().count);
            }
          } catch {
            // Ignorar si falla agregación puntual
          }
        }

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
        const maxChunkDocs = 50;

        while (pagesLeftToLoad > 0) {
          const pagesInChunk = Math.min(
            pagesLeftToLoad,
            Math.max(1, Math.floor(maxChunkDocs / pageSize))
          );
          const askCount = Math.min(50, pagesInChunk * pageSize) + 1;
          const parts = [examConstraint];
          if (cursor) parts.push(startAfter(cursor));
          parts.push(limit(askCount));

          const snap = await getDocs(query(baseRef, ...parts));
          if (seq !== reqSeqRef.current) return;

          const allDocs = snap.docs;
          const hasBeyondChunk = allDocs.length >= askCount;
          const usableDocs = hasBeyondChunk
            ? allDocs.slice(0, pagesInChunk * pageSize)
            : allDocs;

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

            const mapped = pageDocs.map((d) => ({ id: d.id, ...d.data() }));
            mapped.sort((a, b) => (b.score || 0) - (a.score || 0));

            cacheEntry.pages[pNum] = mapped;
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
          searchPoolRef.current = {
            items: cacheEntry.pages[1],
            lastDoc: null,
            hasMore: false,
          };
          setPoolVersion((v) => v + 1);
        }

        const resolvedPage = cacheEntry.pages[safeTargetPage]
          ? safeTargetPage
          : Math.max(1, cacheEntry.highestPage);
        setAttempts(cacheEntry.pages[resolvedPage] || []);
        setHasMore(Boolean(cacheEntry.hasMoreByPage[resolvedPage]));
        setCurrentPage(resolvedPage);
      } catch (error) {
        if (seq !== reqSeqRef.current) return;
        console.error('Error al cargar resultados:', error);
        if (error?.code === 'resource-exhausted') {
          setFetchError(
            'Se alcanzó temporalmente la cuota diaria de lecturas de Firestore. Intenta nuevamente más tarde.'
          );
        } else {
          setFetchError(error?.message || 'Hubo un error al cargar los resultados.');
        }
      } finally {
        if (seq === reqSeqRef.current) {
          setLoading(false);
          setFetchingPage(false);
        }
      }
    },
    [examId, pageSize]
  );

  useEffect(() => {
    fetchAttemptsPage(1, { refreshCount: true, forceRemote: true });
  }, [fetchAttemptsPage]);

  // Escaneo explícito bajo clic en lotes de máximo 50 documentos
  const handleSearchInServer = useCallback(
    async ({ appendMore = false } = {}) => {
      if (!examId) return null;
      const existing = searchPoolRef.current;
      if (!appendMore && existing && (!existing.hasMore || existing.items.length > 0)) {
        return existing;
      }

      const seq = ++searchSeqRef.current;
      setSearchingServer(true);
      setFetchError('');

      try {
        const baseRef = collection(db, 'examAttempts');
        const accumulated = appendMore && existing ? [...existing.items] : [];
        const seenIds = new Set(accumulated.map((item) => item.id));
        const cursor = appendMore && existing ? existing.lastDoc : null;

        const parts = [where('examId', '==', examId)];
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

        accumulated.sort((a, b) => (b.score || 0) - (a.score || 0));
        const batchHasMore = snap.docs.length >= SEARCH_BATCH_SIZE;
        const lastDoc = batchHasMore ? snap.docs[snap.docs.length - 1] : null;

        const updatedPool = { items: accumulated, lastDoc, hasMore: batchHasMore };
        searchPoolRef.current = updatedPool;
        setPoolVersion((v) => v + 1);
        return updatedPool;
      } catch (err) {
        if (seq !== searchSeqRef.current) return null;
        setFetchError(err?.message || 'No se pudo buscar en la base de datos.');
        return null;
      } finally {
        if (seq === searchSeqRef.current) {
          setSearchingServer(false);
        }
      }
    },
    [examId]
  );

  const handleDeleteAttempt = async (attemptId, userEmail) => {
    const result = await Swal.fire({
      title: '¿Estás seguro?',
      text: `Se eliminará permanentemente el intento de ${userEmail}.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      background: isDark ? '#1f2937' : '#fff',
      color: isDark ? '#f9fafb' : '#111827',
    });

    if (result.isConfirmed) {
      setDeletingId(attemptId);
      try {
        await deleteDoc(doc(db, 'examAttempts', attemptId));
        setAttempts((prev) => prev.filter((a) => a.id !== attemptId));
        setTotalCount((prev) => (typeof prev === 'number' ? Math.max(0, prev - 1) : prev));

        const cacheKey = `${examId}::${pageSize}`;
        const entry = pageCacheRef.current[cacheKey];
        if (entry?.pages) {
          Object.keys(entry.pages).forEach((pKey) => {
            entry.pages[pKey] = entry.pages[pKey].filter((a) => a.id !== attemptId);
          });
        }
        if (searchPoolRef.current) {
          searchPoolRef.current.items = searchPoolRef.current.items.filter(
            (a) => a.id !== attemptId
          );
          setPoolVersion((v) => v + 1);
        }

        Swal.fire({
          title: '¡Eliminado!',
          text: 'La respuesta ha sido eliminada.',
          icon: 'success',
          background: isDark ? '#1f2937' : '#fff',
          color: isDark ? '#f9fafb' : '#111827',
        });
      } catch (error) {
        console.error('Error al eliminar respuesta:', error);
        Swal.fire('Error', 'No se pudo eliminar la respuesta. Inténtalo de nuevo.', 'error');
      } finally {
        setDeletingId(null);
      }
    }
  };

  const normalizedTerm = useMemo(() => normalizeSearchText(searchTerm.trim()), [searchTerm]);
  const activePool = useMemo(() => {
    void poolVersion;
    return searchPoolRef.current;
  }, [poolVersion]);

  const isSearchMode = Boolean(normalizedTerm);

  const allCachedAttempts = useMemo(() => {
    if (activePool?.items?.length) return activePool.items;
    const cacheKey = `${examId}::${pageSize}`;
    const entry = pageCacheRef.current[cacheKey];
    if (!entry?.pages) return attempts;
    const map = new Map();
    Object.values(entry.pages).forEach((list) => {
      (list || []).forEach((item) => map.set(item.id, item));
    });
    return map.size > 0 ? Array.from(map.values()) : attempts;
  }, [activePool, attempts, examId, pageSize]);

  const filteredAttempts = useMemo(() => {
    if (!isSearchMode) return attempts;
    return allCachedAttempts.filter((item) =>
      normalizeSearchText([item.userEmail, item.resultStatus, item.score, item.id].join(' ')).includes(
        normalizedTerm
      )
    );
  }, [isSearchMode, allCachedAttempts, attempts, normalizedTerm]);

  useEffect(() => {
    setSearchPage(1);
  }, [normalizedTerm, pageSize]);

  const browseTotalPages = useMemo(() => {
    if (totalCount !== null) return Math.max(1, Math.ceil(totalCount / pageSize));
    return hasMore ? currentPage + 1 : currentPage;
  }, [totalCount, pageSize, hasMore, currentPage]);

  const searchTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredAttempts.length / pageSize)),
    [filteredAttempts.length, pageSize]
  );

  const visibleAttempts = useMemo(() => {
    if (!isSearchMode) return attempts;
    const start = (searchPage - 1) * pageSize;
    return filteredAttempts.slice(start, start + pageSize);
  }, [isSearchMode, attempts, filteredAttempts, searchPage, pageSize]);

  const activePageNum = isSearchMode ? searchPage : currentPage;
  const activeTotalPages = isSearchMode ? searchTotalPages : browseTotalPages;
  const paginationItems = useMemo(
    () => getPaginationItems(activePageNum, activeTotalPages),
    [activePageNum, activeTotalPages]
  );

  const selectColorScheme = { colorScheme: isDark ? 'dark' : 'light' };
  const optionClass = isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900';

  if (loading) {
    return (
      <div
        className={`flex items-center justify-center min-h-screen gap-2 ${
          isDark ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'
        }`}
      >
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        <p className="text-lg font-medium">Cargando resultados...</p>
      </div>
    );
  }

  return (
    <>
      <div
        className={`min-h-screen p-4 sm:p-6 transition-colors duration-200 ${
          isDark ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'
        }`}
      >
        <div
          className={`max-w-7xl mx-auto ${
            isDark ? 'bg-gray-800' : 'bg-white'
          } rounded-lg shadow-lg transition-colors duration-200`}
        >
          <div
            className={`px-6 py-4 border-b flex flex-wrap items-center justify-between gap-3 ${
              isDark ? 'border-gray-700' : 'border-gray-200'
            }`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <h1
                className={`text-xl sm:text-2xl font-bold ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}
              >
                Resultados del Examen: {exam?.title || `ID: ${examId}`}
              </h1>
              {totalCount !== null && (
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    isDark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  Total: {totalCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={fetchingPage}
                onClick={() => {
                  pageCacheRef.current = {};
                  searchPoolRef.current = null;
                  setPoolVersion((v) => v + 1);
                  fetchAttemptsPage(1, { refreshCount: true, forceRemote: true });
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50 ${
                  isDark
                    ? 'bg-gray-700 border-gray-600 hover:bg-gray-600 text-gray-100'
                    : 'bg-gray-100 border-gray-300 hover:bg-gray-200 text-gray-800'
                }`}
              >
                <RefreshCw className={`w-4 h-4 ${fetchingPage ? 'animate-spin' : ''}`} />
                <span>Actualizar</span>
              </button>
              <button
                type="button"
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                  isDark
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
                onClick={() => router.back()}
              >
                Volver
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-6 space-y-4">
            {fetchError && (
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs sm:text-sm ${
                  isDark
                    ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                    : 'bg-amber-50 border-amber-300 text-amber-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                  <span>{fetchError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => fetchAttemptsPage(currentPage, { forceRemote: true })}
                  className="px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-bold cursor-pointer"
                >
                  Reintentar
                </button>
              </div>
            )}

            {/* Barra de búsqueda local (0 lecturas) + búsqueda bajo demanda en BD (máx. 50) */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (searchTerm.trim()) handleSearchInServer({ appendMore: false });
              }}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="relative flex-1 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Filtrar por correo, estado o puntaje..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={selectColorScheme}
                    className={`w-full pl-9 pr-8 py-2 rounded-lg border text-xs sm:text-sm outline-none ${
                      isDark
                        ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                    }`}
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={searchingServer || !searchTerm.trim()}
                  className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer shrink-0"
                >
                  {searchingServer ? 'Buscando...' : 'Buscar en BD (+50)'}
                </button>
                {activePool?.hasMore && (
                  <button
                    type="button"
                    disabled={searchingServer}
                    onClick={() => handleSearchInServer({ appendMore: true })}
                    className="px-3 py-2 rounded-lg border border-blue-500 text-blue-500 hover:bg-blue-500/10 text-xs font-bold cursor-pointer shrink-0"
                  >
                    +50 en BD
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="opacity-75 font-semibold">Por página:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  style={selectColorScheme}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold outline-none cursor-pointer ${
                    isDark
                      ? 'bg-gray-700 border-gray-600 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                  }`}
                >
                  <option value={25} className={optionClass}>
                    25
                  </option>
                  <option value={50} className={optionClass}>
                    50
                  </option>
                </select>
              </div>
            </form>

            {visibleAttempts.length === 0 ? (
              <div className="text-center py-12">
                <p className={`text-lg ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  {isSearchMode
                    ? 'No hay intentos cargados que coincidan. Pulsa "Buscar en BD (+50)" para ampliar.'
                    : 'Nadie ha realizado este examen todavía.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table
                  className={`w-full border-collapse rounded-lg overflow-hidden shadow-sm ${
                    isDark ? 'bg-gray-800' : 'bg-white'
                  }`}
                >
                  <thead className={isDark ? 'bg-gray-700' : 'bg-gray-100'}>
                    <tr>
                      <th
                        className={`px-6 py-4 text-left text-sm font-semibold ${
                          isDark ? 'text-gray-200' : 'text-gray-700'
                        }`}
                      >
                        Usuario
                      </th>
                      <th
                        className={`px-6 py-4 text-left text-sm font-semibold ${
                          isDark ? 'text-gray-200' : 'text-gray-700'
                        }`}
                      >
                        Puntaje
                      </th>
                      <th
                        className={`px-6 py-4 text-left text-sm font-semibold ${
                          isDark ? 'text-gray-200' : 'text-gray-700'
                        }`}
                      >
                        Estado
                      </th>
                      <th
                        className={`px-6 py-4 text-left text-sm font-semibold ${
                          isDark ? 'text-gray-200' : 'text-gray-700'
                        }`}
                      >
                        Fecha
                      </th>
                      <th
                        className={`px-6 py-4 text-left text-sm font-semibold ${
                          isDark ? 'text-gray-200' : 'text-gray-700'
                        }`}
                      >
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAttempts.map((attempt) => (
                      <tr
                        key={attempt.id}
                        className={`transition-colors duration-150 border-b ${
                          isDark
                            ? 'hover:bg-gray-700 border-gray-600'
                            : 'hover:bg-gray-50 border-gray-200'
                        }`}
                      >
                        <td
                          className={`px-6 py-4 text-sm ${
                            isDark ? 'text-gray-300' : 'text-gray-900'
                          }`}
                        >
                          {attempt.userEmail}
                        </td>
                        <td
                          className={`px-6 py-4 text-sm font-medium ${
                            isDark ? 'text-gray-200' : 'text-gray-900'
                          }`}
                        >
                          {attempt.score}/100
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <span
                            className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                              attempt.resultStatus === 'aprobado'
                                ? isDark
                                  ? 'bg-green-900 text-green-200'
                                  : 'bg-green-100 text-green-800'
                                : isDark
                                ? 'bg-red-900 text-red-200'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {attempt.resultStatus}
                          </span>
                        </td>
                        <td
                          className={`px-6 py-4 text-sm ${
                            isDark ? 'text-gray-300' : 'text-gray-600'
                          }`}
                        >
                          {attempt.completedAt?.seconds
                            ? new Date(attempt.completedAt.seconds * 1000).toLocaleString()
                            : 'N/A'}
                        </td>
                        <td className="px-6 py-4 text-sm space-x-2">
                          <button
                            onClick={() => setSelectedAttempt(attempt)}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                              isDark
                                ? 'bg-sky-600 hover:bg-sky-700 text-white'
                                : 'bg-sky-500 hover:bg-sky-600 text-white'
                            }`}
                          >
                            Detalles
                          </button>
                          <button
                            onClick={() => handleDeleteAttempt(attempt.id, attempt.userEmail)}
                            disabled={deletingId === attempt.id}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                              deletingId === attempt.id
                                ? isDark
                                  ? 'bg-gray-600 cursor-not-allowed'
                                  : 'bg-gray-300 cursor-not-allowed'
                                : isDark
                                ? 'bg-red-600 hover:bg-red-700 text-white'
                                : 'bg-red-500 hover:bg-red-600 text-white'
                            }`}
                          >
                            {deletingId === attempt.id ? '...' : 'Eliminar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Paginador */}
            {activeTotalPages > 1 && (
              <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs opacity-75">
                  Página <strong>{activePageNum}</strong> de <strong>{activeTotalPages}</strong>
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={activePageNum <= 1 || fetchingPage}
                    onClick={() => {
                      if (isSearchMode) setSearchPage((p) => Math.max(1, p - 1));
                      else fetchAttemptsPage(currentPage - 1);
                    }}
                    className={`p-1.5 rounded-lg border text-xs cursor-pointer disabled:opacity-40 ${
                      isDark ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {paginationItems.map((item) =>
                    typeof item === 'string' ? (
                      <span key={item} className="px-1.5 text-xs opacity-50">
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        disabled={fetchingPage}
                        onClick={() => {
                          if (isSearchMode) setSearchPage(item);
                          else fetchAttemptsPage(item);
                        }}
                        className={`min-w-[30px] h-7 px-2 rounded-lg text-xs font-bold cursor-pointer ${
                          item === activePageNum
                            ? 'bg-blue-600 text-white'
                            : isDark
                            ? 'hover:bg-gray-700 text-gray-200'
                            : 'hover:bg-gray-100 text-gray-800'
                        }`}
                      >
                        {item}
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    disabled={
                      fetchingPage ||
                      (isSearchMode
                        ? searchPage >= searchTotalPages
                        : !hasMore && currentPage >= browseTotalPages)
                    }
                    onClick={() => {
                      if (isSearchMode) setSearchPage((p) => Math.min(searchTotalPages, p + 1));
                      else fetchAttemptsPage(currentPage + 1);
                    }}
                    className={`p-1.5 rounded-lg border text-xs cursor-pointer disabled:opacity-40 ${
                      isDark ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {selectedAttempt && (
        <AttemptDetailsModal
          attempt={selectedAttempt}
          exam={exam}
          onClose={() => setSelectedAttempt(null)}
          isDark={isDark}
        />
      )}
    </>
  );
}

export default function ResultadosPage() {
  const { isDark, isLoaded } = useTheme();

  if (!isLoaded) {
    return (
      <div className={`min-h-screen ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className="animate-pulse p-6">
          <div
            className={`max-w-7xl mx-auto ${
              isDark ? 'bg-gray-800' : 'bg-white'
            } rounded-lg shadow-lg`}
          >
            <div className={`px-6 py-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
              <div className={`h-8 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded mb-4`} />
              <div className={`h-10 w-24 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded`} />
            </div>
            <div className="p-6">
              <div className={`h-64 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded`} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div
          className={`flex items-center justify-center min-h-screen ${
            isDark ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'
          }`}
        >
          <div className="text-lg font-medium">Cargando...</div>
        </div>
      }
    >
      <ResultadosContent />
    </Suspense>
  );
}
