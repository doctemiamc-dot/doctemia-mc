'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  collection,
  getDocs,
  getCountFromServer,
  query,
  limit,
  startAfter,
  deleteDoc,
  doc,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Swal from 'sweetalert2';
import { useTheme } from '@/context/ThemeContext';
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

export default function AdminSolicitudesPage() {
  const [solicitudes, setSolicitudes] = useState([]);
  const [sourceTab, setSourceTab] = useState('solicitudes'); // 'solicitudes' | 'examenTest_solicitudes'
  const [countsByTab, setCountsByTab] = useState({
    solicitudes: null,
    examenTest_solicitudes: null,
  });
  const [loading, setLoading] = useState(true);
  const [fetchingPage, setFetchingPage] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const { isDark, isLoaded } = useTheme();

  const pageCacheRef = useRef({});
  const reqSeqRef = useRef(0);

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f8fafc' : '#1a2639',
      confirmButtonColor: '#014ba0',
      cancelButtonColor: '#dc2626',
    }),
    [isDark]
  );

  const swalThemeRef = useRef(swalTheme);
  useEffect(() => {
    swalThemeRef.current = swalTheme;
  }, [swalTheme]);

  const fetchTabCounts = useCallback(async () => {
    try {
      const [c1, c2] = await Promise.all([
        getCountFromServer(collection(db, 'solicitudes')),
        getCountFromServer(collection(db, 'examenTest_solicitudes')),
      ]);
      setCountsByTab({
        solicitudes: c1.data().count,
        examenTest_solicitudes: c2.data().count,
      });
    } catch {
      // No bloquear listado si falla el conteo agregado
    }
  }, []);

  const fetchSolicitudesPage = useCallback(
    async (targetPage = 1, { refreshCount = false, forceRemote = false } = {}) => {
      const safeTargetPage = Math.max(1, targetPage);
      const cacheKey = `${sourceTab}::${pageSize}`;

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
        if (refreshCount) {
          fetchTabCounts();
        }

        const baseRef = collection(db, sourceTab);
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
          const parts = [];
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

          const mappedType =
            sourceTab === 'solicitudes' ? 'inscripcion_curso' : 'examen_test_access';

          for (let i = 0; i < pagesInChunk; i += 1) {
            const sliceStart = i * pageSize;
            const sliceEnd = sliceStart + pageSize;
            const pageDocs = usableDocs.slice(sliceStart, sliceEnd);
            if (pageDocs.length === 0) break;

            const pNum = currentFillPage + i;
            const isLastSliceInChunk = sliceEnd >= usableDocs.length;
            const pageHasNext = isLastSliceInChunk ? hasBeyondChunk : true;

            const items = pageDocs.map((d) => ({
              id: d.id,
              ...d.data(),
              type: mappedType,
              sourceCollection: sourceTab,
            }));

            items.sort((a, b) => {
              const dateA = a.requestDate?.seconds || a.examDate || 0;
              const dateB = b.requestDate?.seconds || b.examDate || 0;
              return Number(dateB) - Number(dateA);
            });

            cacheEntry.pages[pNum] = items;
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

        const resolvedPage = cacheEntry.pages[safeTargetPage]
          ? safeTargetPage
          : Math.max(1, cacheEntry.highestPage);
        setSolicitudes(cacheEntry.pages[resolvedPage] || []);
        setHasMore(Boolean(cacheEntry.hasMoreByPage[resolvedPage]));
        setCurrentPage(resolvedPage);
      } catch (error) {
        if (seq !== reqSeqRef.current) return;
        console.error('Error fetching solicitudes:', error);
        if (error?.code === 'resource-exhausted') {
          setFetchError(
            'Se alcanzó temporalmente la cuota diaria de lecturas de Firestore. Vuelve a intentar más tarde.'
          );
        } else {
          setFetchError(error?.message || 'No se pudieron cargar las solicitudes.');
        }
      } finally {
        if (seq === reqSeqRef.current) {
          setLoading(false);
          setFetchingPage(false);
        }
      }
    },
    [sourceTab, pageSize, fetchTabCounts]
  );

  useEffect(() => {
    fetchSolicitudesPage(1, { refreshCount: true, forceRemote: true });
  }, [fetchSolicitudesPage]);

  const removeSolicitudLocally = (id, colName) => {
    setSolicitudes((prev) => prev.filter((s) => s.id !== id));
    setCountsByTab((prev) => ({
      ...prev,
      [colName]: typeof prev[colName] === 'number' ? Math.max(0, prev[colName] - 1) : prev[colName],
    }));
    const cacheKey = `${colName}::${pageSize}`;
    const entry = pageCacheRef.current[cacheKey];
    if (entry?.pages) {
      Object.keys(entry.pages).forEach((pKey) => {
        entry.pages[pKey] = entry.pages[pKey].filter((s) => s.id !== id);
      });
    }
  };

  const handleRecibirPagoCurso = async (solicitud) => {
    const confirm = await Swal.fire({
      title: '¿Confirmar Pago de Curso?',
      text: `Se asignará el curso "${solicitud.courseName}" al usuario.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, asignar curso',
      cancelButtonText: 'Cancelar',
      ...swalThemeRef.current,
    });

    if (confirm.isConfirmed) {
      try {
        const userRef = doc(db, 'users', solicitud.userId);
        await updateDoc(userRef, {
          cursosPagados: arrayUnion({
            idCurso: solicitud.courseId,
            fechaExamen: solicitud.examDate,
            nota: null,
          }),
        });
        await deleteDoc(doc(db, solicitud.sourceCollection, solicitud.id));
        removeSolicitudLocally(solicitud.id, solicitud.sourceCollection);
        Swal.fire({
          title: '¡Éxito!',
          text: 'El curso ha sido asignado al usuario.',
          icon: 'success',
          ...swalThemeRef.current,
        });
      } catch (error) {
        console.error('Error al asignar curso:', error);
        Swal.fire({
          title: 'Error',
          text: 'No se pudo asignar el curso.',
          icon: 'error',
          ...swalThemeRef.current,
        });
      }
    }
  };

  const handleAprobarAccesoTest = async (solicitud) => {
    const confirm = await Swal.fire({
      title: '¿Aprobar Acceso a Examen Test?',
      text: `Se habilitará el acceso a los exámenes de test para ${solicitud.userName}.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, aprobar acceso',
      cancelButtonText: 'Cancelar',
      ...swalThemeRef.current,
    });

    if (confirm.isConfirmed) {
      try {
        const userRef = doc(db, 'users', solicitud.userId);
        await updateDoc(userRef, { hasExamenTestAccess: true });
        await updateDoc(doc(db, solicitud.sourceCollection, solicitud.id), { status: 'aprobado' });

        setSolicitudes((prev) =>
          prev.map((s) => (s.id === solicitud.id ? { ...s, status: 'aprobado' } : s))
        );
        Swal.fire({
          title: '¡Acceso Aprobado!',
          text: 'El usuario ahora puede acceder a los exámenes de test.',
          icon: 'success',
          ...swalThemeRef.current,
        });
      } catch (error) {
        console.error('Error al aprobar acceso:', error);
        Swal.fire({
          title: 'Error',
          text: 'No se pudo aprobar el acceso.',
          icon: 'error',
          ...swalThemeRef.current,
        });
      }
    }
  };

  const handleRechazarSolicitud = async (solicitud) => {
    const result = await Swal.fire({
      title: '¿Rechazar esta solicitud?',
      text: 'La solicitud se eliminará permanentemente.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, borrar solicitud',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
      ...swalThemeRef.current,
    });

    if (result.isConfirmed) {
      try {
        await deleteDoc(doc(db, solicitud.sourceCollection, solicitud.id));
        removeSolicitudLocally(solicitud.id, solicitud.sourceCollection);
        Swal.fire({
          title: 'Eliminada',
          text: 'La solicitud ha sido eliminada.',
          icon: 'success',
          ...swalThemeRef.current,
        });
      } catch (error) {
        console.error('Error al eliminar solicitud:', error);
        Swal.fire({
          title: 'Error',
          text: 'No se pudo eliminar la solicitud.',
          icon: 'error',
          ...swalThemeRef.current,
        });
      }
    }
  };

  const normalizedTerm = useMemo(() => normalizeSearchText(searchTerm.trim()), [searchTerm]);
  const visibleSolicitudes = useMemo(() => {
    if (!normalizedTerm) return solicitudes;
    return solicitudes.filter((s) =>
      normalizeSearchText([s.userName, s.userEmail, s.courseName, s.userPhone, s.status].join(' ')).includes(
        normalizedTerm
      )
    );
  }, [solicitudes, normalizedTerm]);

  const activeTabTotal = countsByTab[sourceTab];
  const totalPages = useMemo(() => {
    if (typeof activeTabTotal === 'number') {
      return Math.max(1, Math.ceil(activeTabTotal / pageSize));
    }
    return hasMore ? currentPage + 1 : currentPage;
  }, [activeTabTotal, pageSize, hasMore, currentPage]);

  const paginationItems = useMemo(
    () => getPaginationItems(currentPage, totalPages),
    [currentPage, totalPages]
  );

  const surfaceClass = isDark
    ? 'bg-[#1e293b] border-white/10 text-white'
    : 'bg-white border-[#2E4A70]/20 text-[#1a2639] shadow-xs';
  const inputClass = isDark
    ? 'bg-[#162235] border-white/15 text-white placeholder:text-slate-400 focus:border-[#24B0BA]'
    : 'bg-white border-[#2E4A70]/25 text-[#1a2639] placeholder:text-slate-400 focus:border-[#014ba0]';
  const optionClass = isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]';
  const selectColorScheme = { colorScheme: isDark ? 'dark' : 'light' };

  if (loading || !isLoaded) {
    return (
      <section
        className={`p-8 min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center gap-3 font-bold ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <Loader2 className={`w-8 h-8 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
        <span>Cargando solicitudes...</span>
      </section>
    );
  }

  return (
    <div
      className={`w-full min-w-0 overflow-x-hidden p-4 md:p-6 min-h-[calc(100vh-4rem)] ${
        isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
      }`}
    >
      <div className="max-w-7xl mx-auto min-w-0 space-y-5">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1
              className={`text-2xl sm:text-3xl font-black tracking-tight ${
                isDark ? 'text-white' : 'text-[#1a2639]'
              }`}
            >
              Solicitudes Pendientes
            </h1>
            <span
              className={`text-xs font-extrabold px-2.5 py-1 rounded-full tabular-nums ${
                isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
              }`}
            >
              {typeof activeTabTotal === 'number' ? activeTabTotal : visibleSolicitudes.length}
            </span>
          </div>

          <button
            type="button"
            disabled={fetchingPage}
            onClick={() => {
              pageCacheRef.current = {};
              fetchSolicitudesPage(1, { refreshCount: true, forceRemote: true });
            }}
            className={`inline-flex items-center gap-1.5 self-start sm:self-auto px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 ${
              isDark
                ? 'bg-[#1e293b] border-white/15 hover:bg-white/10 text-blue-200'
                : 'bg-white border-[#2E4A70]/25 hover:bg-slate-50 text-[#1a2639]'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${fetchingPage ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </header>

        {/* Pestañas por colección para paginar con cursor real de 25 en 25 */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSourceTab('solicitudes')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold border cursor-pointer transition-colors ${
              sourceTab === 'solicitudes'
                ? 'bg-[#014ba0] border-[#014ba0] text-white'
                : surfaceClass
            }`}
          >
            Inscripciones a Cursos ({countsByTab.solicitudes ?? '…'})
          </button>
          <button
            type="button"
            onClick={() => setSourceTab('examenTest_solicitudes')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold border cursor-pointer transition-colors ${
              sourceTab === 'examenTest_solicitudes'
                ? 'bg-[#014ba0] border-[#014ba0] text-white'
                : surfaceClass
            }`}
          >
            Acceso a Exámenes ({countsByTab.examenTest_solicitudes ?? '…'})
          </button>
        </div>

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
              onClick={() => fetchSolicitudesPage(currentPage, { forceRemote: true })}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer shrink-0"
            >
              Reintentar
            </button>
          </div>
        )}

        <div
          className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0 ${surfaceClass}`}
        >
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
            <input
              type="text"
              placeholder="Filtrar en esta página por usuario, correo, curso o estado..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={selectColorScheme}
              className={`w-full min-w-0 pl-9 pr-8 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
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

          <div className="flex items-center gap-1.5 text-xs">
            <span className="opacity-75 font-semibold">Por página:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              style={selectColorScheme}
              className={`px-2 py-1.5 rounded-lg border text-xs font-bold outline-none cursor-pointer ${inputClass}`}
            >
              <option value={25} className={optionClass}>
                25
              </option>
              <option value={50} className={optionClass}>
                50
              </option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {visibleSolicitudes.length === 0 ? (
            <div className={`text-center py-12 px-6 rounded-2xl border-2 border-dashed ${surfaceClass}`}>
              <p className={`text-sm font-bold ${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]'}`}>
                {searchTerm.trim()
                  ? 'No hay solicitudes que coincidan con tu búsqueda en esta página.'
                  : '¡Felicidades! No hay solicitudes pendientes en esta categoría.'}
              </p>
            </div>
          ) : (
            visibleSolicitudes.map((solicitud) => (
              <div
                key={solicitud.id}
                className={`p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${surfaceClass}`}
              >
                <div className="space-y-2 min-w-0">
                  <p className={`text-sm ${isDark ? 'text-slate-200' : 'text-[#2E4A70]'}`}>
                    <strong className={isDark ? 'text-white' : 'text-[#1a2639]'}>Usuario:</strong>{' '}
                    {solicitud.userName} ({solicitud.userEmail})
                  </p>
                  {solicitud.type === 'examen_test_access' ? (
                    <>
                      <p className={`text-sm ${isDark ? 'text-slate-200' : 'text-[#2E4A70]'}`}>
                        <strong className={isDark ? 'text-white' : 'text-[#1a2639]'}>Tipo:</strong>{' '}
                        Acceso a Examen Test
                      </p>
                      <p className={`text-sm ${isDark ? 'text-slate-200' : 'text-[#2E4A70]'}`}>
                        <strong className={isDark ? 'text-white' : 'text-[#1a2639]'}>
                          Teléfono:
                        </strong>{' '}
                        {solicitud.userPhone || 'No proporcionado'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className={`text-sm ${isDark ? 'text-slate-200' : 'text-[#2E4A70]'}`}>
                        <strong className={isDark ? 'text-white' : 'text-[#1a2639]'}>Tipo:</strong>{' '}
                        Inscripción a Curso
                      </p>
                      <p className={`text-sm ${isDark ? 'text-slate-200' : 'text-[#2E4A70]'}`}>
                        <strong className={isDark ? 'text-white' : 'text-[#1a2639]'}>Curso:</strong>{' '}
                        {solicitud.courseName}
                      </p>
                      <p className={`text-sm ${isDark ? 'text-slate-200' : 'text-[#2E4A70]'}`}>
                        <strong className={isDark ? 'text-white' : 'text-[#1a2639]'}>
                          Fecha de Examen:
                        </strong>{' '}
                        {solicitud.examDate}
                      </p>
                    </>
                  )}
                  <p className="text-xs font-semibold">
                    <span
                      className={`inline-flex px-2.5 py-1 rounded-full ${
                        solicitud.status === 'aprobado'
                          ? isDark
                            ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : isDark
                          ? 'bg-amber-950/60 text-amber-300 border border-amber-500/30'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      Estado: {solicitud.status}
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap gap-2.5 shrink-0">
                  {solicitud.type === 'inscripcion_curso' && (
                    <button
                      type="button"
                      onClick={() => handleRecibirPagoCurso(solicitud)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                    >
                      Confirmar Pago
                    </button>
                  )}

                  {solicitud.type === 'examen_test_access' && solicitud.status === 'pendiente' && (
                    <button
                      type="button"
                      onClick={() => handleAprobarAccesoTest(solicitud)}
                      className="bg-[#014ba0] hover:bg-[#013b80] text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                    >
                      Aprobar Acceso
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleRechazarSolicitud(solicitud)}
                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {(totalPages > 1 || hasMore) && (
          <div
            className={`p-3.5 sm:p-4 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-3 ${surfaceClass}`}
          >
            <div className="text-xs font-semibold opacity-80">
              Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1 || fetchingPage}
                onClick={() => fetchSolicitudesPage(currentPage - 1)}
                className={`p-2 rounded-xl border text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-200 hover:bg-slate-100'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {paginationItems.map((item) =>
                typeof item === 'string' ? (
                  <span key={item} className="px-1.5 text-xs font-bold opacity-50 select-none">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    disabled={fetchingPage}
                    onClick={() => fetchSolicitudesPage(item)}
                    className={`min-w-[32px] h-8 px-2.5 rounded-xl text-xs font-extrabold cursor-pointer transition-colors ${
                      item === currentPage
                        ? 'bg-[#014ba0] text-white shadow-xs'
                        : isDark
                        ? 'hover:bg-white/10 text-blue-100'
                        : 'hover:bg-slate-100 text-[#1a2639]'
                    }`}
                  >
                    {item}
                  </button>
                )
              )}

              <button
                type="button"
                disabled={(!hasMore && currentPage >= totalPages) || fetchingPage}
                onClick={() => fetchSolicitudesPage(currentPage + 1)}
                className={`p-2 rounded-xl border text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-200 hover:bg-slate-100'
                }`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
