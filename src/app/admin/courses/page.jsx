'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import Swal from 'sweetalert2';
import {
  collection,
  getDocs,
  getCountFromServer,
  query,
  limit,
  startAfter,
  doc,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useTheme } from '@/context/ThemeContext';
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2,
  X,
} from 'lucide-react';

const DEFAULT_PAGE_SIZE = 25;
const SEARCH_BATCH_SIZE = 50;

const PlusIcon = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SearchIcon = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export default function AdminCourses() {
  const [courses, setCourses] = useState([]);
  const [totalCount, setTotalCount] = useState(null);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchingPage, setFetchingPage] = useState(false);
  const [searchingServer, setSearchingServer] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [poolVersion, setPoolVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState('newest');
  const { isDark, isLoaded } = useTheme();

  const pageCacheRef = useRef({});
  const searchPoolRef = useRef(null);
  const reqSeqRef = useRef(0);
  const searchSeqRef = useRef(0);

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1f2937' : '#ffffff',
      color: isDark ? '#f9fafb' : '#111827',
      confirmButtonColor: '#3b82f6',
      cancelButtonColor: '#ef4444',
    }),
    [isDark]
  );

  const fetchCoursesPage = useCallback(
    async (targetPage = 1, { refreshCount = false, forceRemote = false } = {}) => {
      const safeTargetPage = Math.max(1, targetPage);
      const cacheKey = String(pageSize);

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
        setCourses(cacheEntry.pages[safeTargetPage]);
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
        const baseRef = collection(db, 'courses');

        if (refreshCount || safeTargetPage === 1) {
          try {
            const countSnap = await getCountFromServer(baseRef);
            if (seq === reqSeqRef.current) {
              setTotalCount(countSnap.data().count);
            }
          } catch {
            // No bloquear si falla el conteo
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
        setCourses(cacheEntry.pages[resolvedPage] || []);
        setHasMore(Boolean(cacheEntry.hasMoreByPage[resolvedPage]));
        setCurrentPage(resolvedPage);
      } catch (error) {
        if (seq !== reqSeqRef.current) return;
        console.error('Error fetching courses:', error);
        if (error?.code === 'resource-exhausted') {
          setFetchError(
            'Se alcanzó temporalmente la cuota diaria de lecturas de Firestore. Intenta nuevamente más tarde.'
          );
        } else {
          setFetchError(error?.message || 'No se pudieron cargar los cursos.');
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
    fetchCoursesPage(1, { refreshCount: true, forceRemote: true });
  }, [fetchCoursesPage]);

  const handleSearchInServer = useCallback(async ({ appendMore = false } = {}) => {
    const existing = searchPoolRef.current;
    if (!appendMore && existing && (!existing.hasMore || existing.items.length > 0)) {
      return existing;
    }

    const seq = ++searchSeqRef.current;
    setSearchingServer(true);
    setFetchError('');

    try {
      const baseRef = collection(db, 'courses');
      const accumulated = appendMore && existing ? [...existing.items] : [];
      const seenIds = new Set(accumulated.map((c) => c.id));
      const cursor = appendMore && existing ? existing.lastDoc : null;

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

      const batchHasMore = snap.docs.length >= SEARCH_BATCH_SIZE;
      const lastDoc = batchHasMore ? snap.docs[snap.docs.length - 1] : null;
      const updated = { items: accumulated, lastDoc, hasMore: batchHasMore };
      searchPoolRef.current = updated;
      setPoolVersion((v) => v + 1);
      return updated;
    } catch (err) {
      if (seq !== searchSeqRef.current) return null;
      setFetchError(err?.message || 'No se pudo buscar en la base de datos.');
      return null;
    } finally {
      if (seq === searchSeqRef.current) {
        setSearchingServer(false);
      }
    }
  }, []);

  const filteredAndSortedCourses = useMemo(() => {
    void poolVersion;
    const sourceList =
      searchTerm.trim() && searchPoolRef.current?.items?.length
        ? searchPoolRef.current.items
        : courses;
    const q = searchTerm.trim().toLowerCase();

    const filtered = sourceList.filter(
      (course) =>
        !q ||
        (course.name?.toLowerCase() || '').includes(q) ||
        (course.description?.toLowerCase() || '').includes(q) ||
        (course.price?.toString() || '').toLowerCase().includes(q)
    );

    const copy = [...filtered];
    switch (sortOption) {
      case 'newest':
        copy.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        break;
      case 'oldest':
        copy.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
        break;
      case 'name':
        copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'price':
        copy.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
        break;
      default:
        break;
    }

    return copy;
  }, [courses, searchTerm, sortOption, poolVersion]);

  const handleDelete = (courseId) => {
    Swal.fire({
      title: '¿Estás seguro?',
      text: 'Esta acción eliminará el curso permanentemente.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      ...swalTheme,
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await deleteDoc(doc(db, 'courses', courseId));
          setCourses((prev) => prev.filter((course) => course.id !== courseId));
          setTotalCount((prev) => (typeof prev === 'number' ? Math.max(0, prev - 1) : prev));
          Swal.fire({
            title: 'Eliminado',
            text: 'El curso ha sido eliminado.',
            icon: 'success',
            ...swalTheme,
          });
        } catch (error) {
          console.error('Error eliminando el curso:', error);
          Swal.fire({
            title: 'Error',
            text: 'No se pudo eliminar el curso.',
            icon: 'error',
            ...swalTheme,
          });
        }
      }
    });
  };

  const toggleCourseStatus = (courseId, currentStatus) => {
    const newStatus = !currentStatus;
    Swal.fire({
      title: `¿Quieres ${newStatus ? 'activar' : 'desactivar'} este curso?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí',
      cancelButtonText: 'Cancelar',
      ...swalTheme,
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await updateDoc(doc(db, 'courses', courseId), { isActive: newStatus });
          setCourses((prev) =>
            prev.map((course) =>
              course.id === courseId ? { ...course, isActive: newStatus } : course
            )
          );
          Swal.fire({
            title: 'Actualizado',
            text: `El curso ha sido ${newStatus ? 'activado' : 'desactivado'}.`,
            icon: 'success',
            ...swalTheme,
          });
        } catch (error) {
          console.error('Error actualizando el estado del curso:', error);
          Swal.fire({
            title: 'Error',
            text: 'No se pudo actualizar el curso.',
            icon: 'error',
            ...swalTheme,
          });
        }
      }
    });
  };

  const totalPages = useMemo(() => {
    if (totalCount !== null) return Math.max(1, Math.ceil(totalCount / pageSize));
    return hasMore ? currentPage + 1 : currentPage;
  }, [totalCount, pageSize, hasMore, currentPage]);

  const selectColorScheme = { colorScheme: isDark ? 'dark' : 'light' };
  const optionClass = isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900';

  if (!isLoaded) {
    return (
      <section
        className={`min-h-[calc(100vh-4rem)] flex items-center justify-center ${
          isDark ? 'bg-[#1a2639]' : 'bg-[#FFF9F0]'
        }`}
      >
        <p className={`text-lg animate-pulse ${isDark ? 'text-white' : 'text-[#1a2639]'}`}>
          Cargando...
        </p>
      </section>
    );
  }

  return (
    <section
      className={`p-4 sm:p-6 min-h-[calc(100vh-4rem)] transition-colors duration-300 ${
        isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
      }`}
    >
      <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
        <div className="flex items-center gap-3">
          <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Cursos
          </h1>
          {totalCount !== null && (
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                isDark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-800'
              }`}
            >
              {totalCount}
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
              fetchCoursesPage(1, { refreshCount: true, forceRemote: true });
            }}
            className={`inline-flex items-center gap-1.5 py-2 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
              isDark
                ? 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'
                : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${fetchingPage ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
          <Link
            href="/admin/courses/new"
            className={`inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg shadow-lg transition-transform transform hover:scale-105 ${
              isDark ? 'shadow-blue-500/30' : 'shadow-blue-500/50'
            }`}
          >
            <PlusIcon className="h-5 w-5" />
            <span>Agregar Curso</span>
          </Link>
        </div>
      </div>

      {fetchError && (
        <div
          className={`mb-6 p-4 rounded-xl border flex items-center justify-between gap-3 text-sm ${
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
            onClick={() => fetchCoursesPage(currentPage, { forceRemote: true })}
            className="px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-bold cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* --- Controles de Búsqueda y Ordenamiento --- */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (searchTerm.trim()) handleSearchInServer({ appendMore: false });
        }}
        className={`mb-8 p-4 rounded-lg shadow-md flex flex-col md:flex-row gap-4 items-center ${
          isDark ? 'bg-gray-800' : 'bg-white'
        }`}
      >
        <div className="relative w-full md:flex-grow flex items-center gap-2">
          <div className="relative flex-grow">
            <SearchIcon
              className={`absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}
            />
            <input
              type="text"
              placeholder="Buscar por título, descripción, precio..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={selectColorScheme}
              className={`w-full pl-10 pr-8 py-2 border rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={searchingServer || !searchTerm.trim()}
            className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer shrink-0"
          >
            {searchingServer ? 'Buscando...' : 'Buscar en BD (+50)'}
          </button>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <label
            htmlFor="sort"
            className={`text-sm font-medium whitespace-nowrap ${
              isDark ? 'text-gray-300' : 'text-gray-600'
            }`}
          >
            Ordenar por:
          </label>
          <select
            id="sort"
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value)}
            style={selectColorScheme}
            className={`w-full md:w-auto p-2 border rounded-md text-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              isDark
                ? 'bg-gray-700 border-gray-600 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            }`}
          >
            <option value="newest" className={optionClass}>
              Más recientes
            </option>
            <option value="oldest" className={optionClass}>
              Más antiguos
            </option>
            <option value="name" className={optionClass}>
              Nombre (A-Z)
            </option>
            <option value="price" className={optionClass}>
              Precio (menor a mayor)
            </option>
          </select>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            style={selectColorScheme}
            className={`p-2 border rounded-md text-sm font-bold ${
              isDark
                ? 'bg-gray-700 border-gray-600 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            }`}
          >
            <option value={25} className={optionClass}>
              25 / pág.
            </option>
            <option value={50} className={optionClass}>
              50 / pág.
            </option>
          </select>
        </div>
      </form>

      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          <p className={isDark ? 'text-gray-300' : 'text-gray-700'}>Cargando cursos...</p>
        </div>
      ) : filteredAndSortedCourses.length === 0 ? (
        <p className={`text-center py-10 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          No se encontraron cursos que coincidan con tu búsqueda.
        </p>
      ) : (
        <>
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredAndSortedCourses.map((course) => (
              <div
                key={course.id}
                className={`shadow-md hover:shadow-xl rounded-lg p-4 flex flex-col transition-all duration-300 border hover:-translate-y-1 ${
                  isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                }`}
              >
                {course.image && (
                  <img
                    src={course.image}
                    alt={course.name}
                    className="w-full h-40 object-cover rounded-md"
                  />
                )}
                <div className="flex-grow mt-3">
                  <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {course.name}
                  </h2>
                  <p className={`text-sm mt-1 mb-3 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    {course.description}
                  </p>
                </div>
                <div className="mt-auto">
                  <div className="flex justify-between items-center mb-3">
                    <p
                      className={`font-bold text-lg ${isDark ? 'text-blue-400' : 'text-blue-600'}`}
                    >
                      Bs {Number(course.price || 0).toFixed(2)}
                    </p>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        course.isActive
                          ? isDark
                            ? 'bg-green-900 text-green-300'
                            : 'bg-green-100 text-green-800'
                          : isDark
                          ? 'bg-red-900 text-red-300'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {course.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <button
                      onClick={() => toggleCourseStatus(course.id, course.isActive)}
                      className={`w-full py-2 rounded-md transition cursor-pointer ${
                        course.isActive
                          ? isDark
                            ? 'bg-yellow-600 hover:bg-yellow-700'
                            : 'bg-yellow-500 hover:bg-yellow-600'
                          : isDark
                          ? 'bg-green-600 hover:bg-green-700'
                          : 'bg-green-500 hover:bg-green-600'
                      } text-white`}
                    >
                      {course.isActive ? 'Desactivar' : 'Activar'}
                    </button>
                    <Link
                      href={`/admin/courses/edit/${course.id}`}
                      className={`w-full text-center py-2 rounded-md transition ${
                        isDark ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
                      } text-white`}
                    >
                      Editar
                    </Link>
                    <Link
                      href={`/admin/courses/preview/${course.id}`}
                      className={`w-full text-center py-2 rounded-md transition ${
                        isDark ? 'bg-gray-600 hover:bg-gray-700' : 'bg-gray-500 hover:bg-gray-600'
                      } text-white`}
                    >
                      Preview
                    </Link>
                    <button
                      onClick={() => handleDelete(course.id)}
                      className={`w-full py-2 rounded-md transition cursor-pointer ${
                        isDark ? 'bg-red-700 hover:bg-red-800' : 'bg-red-600 hover:bg-red-700'
                      } text-white`}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {(totalPages > 1 || hasMore) && (
            <div className="mt-8 flex items-center justify-between">
              <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1 || fetchingPage}
                  onClick={() => fetchCoursesPage(currentPage - 1)}
                  className={`p-2 rounded-lg border cursor-pointer disabled:opacity-40 ${
                    isDark
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-800'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={(!hasMore && currentPage >= totalPages) || fetchingPage}
                  onClick={() => fetchCoursesPage(currentPage + 1)}
                  className={`p-2 rounded-lg border cursor-pointer disabled:opacity-40 ${
                    isDark
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-800'
                  }`}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
