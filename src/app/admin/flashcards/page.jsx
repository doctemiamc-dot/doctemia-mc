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
} from 'firebase/firestore';
import { deleteFlashcardCompleta } from '@/lib/flashcardServices';
import { getCachedCategories, getCachedSubcategories } from '@/lib/catalogCache';
import Link from 'next/link';
import Swal from 'sweetalert2';
import { useTheme } from '@/context/ThemeContext';
import {
  Plus,
  Edit3,
  Trash2,
  Search,
  ListChecks,
  X,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2,
  Layers,
  CheckSquare,
  Square,
} from 'lucide-react';

const DEFAULT_PAGE_SIZE = 25;
const SEARCH_BATCH_SIZE = 50;
const MAX_SERVER_SEARCH_DOCS = 50;

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getCreatedAtMillis(card) {
  const ts = card?.createdAt;
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function matchesLocalCardSearch(card, normalizedTerm) {
  if (!normalizedTerm) return true;
  const tagsText = Array.isArray(card.tags) ? card.tags.join(' ') : card.tags || '';
  const haystack = normalizeSearchText(
    [
      card.pregunta,
      card.respuesta,
      card.explicacion,
      card.especialidadNombre,
      card.subtema,
      card.subtemaName,
      card.tipo,
      tagsText,
      card.id,
    ].join(' ')
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

  for (let p = left; p <= right; p += 1) {
    items.push(p);
  }

  if (right < total - 2) {
    items.push('ellipsis-right');
  } else {
    for (let p = right + 1; p < total; p += 1) items.push(p);
  }

  items.push(total);
  return items;
}

export default function FlashcardsAdminPage() {
  const { isDark, isLoaded } = useTheme();

  // Catálogos ligeros
  const [categories, setCategories] = useState([]);
  const [subthemesByCatId, setSubthemesByCatId] = useState({});

  // Listado paginado bajo demanda (sin onSnapshot masivo)
  const [flashcards, setFlashcards] = useState([]);
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

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEspecialidad, setSelectedEspecialidad] = useState('Todas');
  const [selectedSubtema, setSelectedSubtema] = useState('Todos');
  const [selectedTipo, setSelectedTipo] = useState('Todos');

  // Selección múltiple
  const [selectedCards, setSelectedCards] = useState([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // Caché de páginas visitadas y caché de búsqueda por filtro
  const pageCacheRef = useRef({});
  const searchPoolCacheRef = useRef({});
  const reqSeqRef = useRef(0);
  const searchSeqRef = useRef(0);

  const currentFilterKey = useMemo(
    () => `${selectedEspecialidad}||${selectedSubtema}||${selectedTipo}`,
    [selectedEspecialidad, selectedSubtema, selectedTipo]
  );
  const currentPageCacheKey = useMemo(
    () => `${currentFilterKey}::${pageSize}`,
    [currentFilterKey, pageSize]
  );

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f8fafc' : '#1a2639',
      confirmButtonColor: '#014ba0',
      cancelButtonColor: '#dc2626',
    }),
    [isDark]
  );

  // Cargar especialidades desde caché de sesión (0 lecturas en visitas repetidas)
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const cats = await getCachedCategories();
        setCategories(cats);
      } catch (err) {
        console.error('Error cargando especialidades:', err);
      }
    };
    fetchCategories();
  }, []);

  // Cargar subtemas bajo demanda solo para la especialidad seleccionada (con caché de sesión)
  const selectedCategoryObj = useMemo(
    () => categories.find((c) => c.name === selectedEspecialidad) || null,
    [categories, selectedEspecialidad]
  );

  useEffect(() => {
    const catId = selectedCategoryObj?.id;
    if (!catId || subthemesByCatId[catId]) return;
    let cancelled = false;
    const loadSubs = async () => {
      try {
        const subs = await getCachedSubcategories(catId);
        if (cancelled) return;
        setSubthemesByCatId((prev) => ({ ...prev, [catId]: subs }));
      } catch (err) {
        console.error('Error cargando subtemas:', err);
      }
    };
    loadSubs();
    return () => {
      cancelled = true;
    };
  }, [selectedCategoryObj, subthemesByCatId]);

  const availableSubthemes = useMemo(() => {
    if (!selectedCategoryObj?.id) return [];
    return subthemesByCatId[selectedCategoryObj.id] || [];
  }, [selectedCategoryObj, subthemesByCatId]);

  const buildFilterConstraints = useCallback(() => {
    const constraints = [];
    if (selectedEspecialidad !== 'Todas') {
      constraints.push(where('especialidadNombre', '==', selectedEspecialidad));
    }
    if (selectedSubtema !== 'Todos') {
      constraints.push(where('subtema', '==', selectedSubtema));
    }
    if (selectedTipo !== 'Todos') {
      constraints.push(where('tipo', '==', selectedTipo));
    }
    return constraints;
  }, [selectedEspecialidad, selectedSubtema, selectedTipo]);

  const fetchFlashcardsPage = useCallback(
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

      // Si ya visitamos o cacheamos esta página al saltar, mostrarla con 0 lecturas a Firestore
      if (!forceRemote && !refreshCount && cacheEntry.pages[safeTargetPage]) {
        setFlashcards(cacheEntry.pages[safeTargetPage]);
        setHasMore(Boolean(cacheEntry.hasMoreByPage[safeTargetPage]));
        setCurrentPage(safeTargetPage);
        setSelectedCards([]);
        setFetchError('');
        setInitialLoading(false);
        return;
      }

      const seq = ++reqSeqRef.current;
      setFetchingPage(true);
      setFetchError('');

      try {
        const baseRef = collection(db, 'flashcards');
        const filterConstraints = buildFilterConstraints();
        const hasEqualityFilters = filterConstraints.length > 0;

        // Agregación getCountFromServer (~1 lectura por cada 1000 docs en el índice)
        if (refreshCount || safeTargetPage === 1) {
          try {
            const countQuery = hasEqualityFilters ? query(baseRef, ...filterConstraints) : baseRef;
            const countSnap = await getCountFromServer(countQuery);
            if (seq === reqSeqRef.current) {
              setTotalCount(countSnap.data().count);
            }
          } catch {
            // Si falla agregación o cuota justa, no bloquea el listado
          }
        }

        const buildQuery = (withOrderByCreatedAt, afterDoc, batchLimit) => {
          const parts = [...filterConstraints];
          if (withOrderByCreatedAt) {
            parts.push(orderBy('createdAt', 'desc'));
          }
          if (afterDoc) {
            parts.push(startAfter(afterDoc));
          }
          parts.push(limit(batchLimit));
          return query(baseRef, ...parts);
        };

        // Determinar estrategia de ordenamiento consistente para toda la caché de este filtro
        let useOrder = !hasEqualityFilters && cacheEntry.useNoOrderFallback !== true;

        // Encontrar el cursor contiguo más cercano previo a safeTargetPage para saltar en bloque
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

        // Si el filtro completo cupo en la página 1, reutilizarlo también para búsquedas sin reconsultar Firestore
        if (cacheEntry.pages[1] && !cacheEntry.hasMoreByPage[1]) {
          searchPoolCacheRef.current[currentFilterKey] = {
            cards: cacheEntry.pages[1],
            lastDoc: null,
            hasMore: false,
          };
          setPoolVersion((v) => v + 1);
        }

        const resolvedPage = cacheEntry.pages[safeTargetPage]
          ? safeTargetPage
          : Math.max(1, cacheEntry.highestPage);
        setFlashcards(cacheEntry.pages[resolvedPage] || []);
        setHasMore(Boolean(cacheEntry.hasMoreByPage[resolvedPage]));
        setCurrentPage(resolvedPage);
        setSelectedCards([]);
      } catch (err) {
        if (seq !== reqSeqRef.current) return;
        console.error('Error cargando flashcards paginadas:', err);
        if (err?.code === 'resource-exhausted') {
          setFetchError(
            'Se alcanzó temporalmente la cuota diaria de lecturas de Firestore. Reduce consultas o vuelve a intentar cuando se reinicie la cuota.'
          );
        } else {
          setFetchError(err?.message || 'No se pudieron cargar las flashcards.');
        }
      } finally {
        if (seq === reqSeqRef.current) {
          setInitialLoading(false);
          setFetchingPage(false);
        }
      }
    },
    [buildFilterConstraints, currentFilterKey, currentPageCacheKey, pageSize]
  );

  // Reiniciar caché de páginas del filtro actual y cargar página 1 cuando cambian filtros estructurados o tamaño de página
  useEffect(() => {
    fetchFlashcardsPage(1, { refreshCount: true, forceRemote: true });
  }, [fetchFlashcardsPage]);

  // Escaneo acotado en lotes para búsqueda global (cacheado por filtro en sesión)
  const ensureSearchPoolLoaded = useCallback(
    async ({ appendMore = false } = {}) => {
      const filterKey = currentFilterKey;
      const existingPool = searchPoolCacheRef.current[filterKey];

      if (!appendMore && existingPool && (!existingPool.hasMore || existingPool.cards.length > 0)) {
        return existingPool;
      }

      const seq = ++searchSeqRef.current;
      setSearchingServer(true);
      setFetchError('');

      try {
        const baseRef = collection(db, 'flashcards');
        const filterConstraints = buildFilterConstraints();
        const accumulated = appendMore && existingPool ? [...existingPool.cards] : [];
        const seenIds = new Set(accumulated.map((c) => c.id));
        let cursor = appendMore && existingPool ? existingPool.lastDoc : null;
        let batchHasMore = true;
        let batchesLoaded = 0;
        const maxBatchesPerRun = Math.ceil(MAX_SERVER_SEARCH_DOCS / SEARCH_BATCH_SIZE);

        while (batchHasMore && batchesLoaded < maxBatchesPerRun) {
          const parts = [...filterConstraints];
          if (cursor) {
            parts.push(startAfter(cursor));
          }
          parts.push(limit(SEARCH_BATCH_SIZE));

          const snap = await getDocs(query(baseRef, ...parts));
          if (seq !== searchSeqRef.current) return null;

          for (const docSnap of snap.docs) {
            if (!seenIds.has(docSnap.id)) {
              seenIds.add(docSnap.id);
              accumulated.push({ id: docSnap.id, ...docSnap.data() });
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

        accumulated.sort((a, b) => getCreatedAtMillis(b) - getCreatedAtMillis(a));

        const updatedPool = {
          cards: accumulated,
          lastDoc: cursor,
          hasMore: batchHasMore,
        };
        searchPoolCacheRef.current[filterKey] = updatedPool;
        setPoolVersion((v) => v + 1);
        return updatedPool;
      } catch (err) {
        if (seq !== searchSeqRef.current) return null;
        if (err?.code === 'resource-exhausted') {
          setFetchError(
            'Cuota diaria de Firestore agotada temporalmente; solo es posible filtrar sobre las tarjetas ya cargadas.'
          );
        } else {
          setFetchError(err?.message || 'No se pudo completar la búsqueda en BD.');
        }
        return null;
      } finally {
        if (seq === searchSeqRef.current) {
          setSearchingServer(false);
        }
      }
    },
    [buildFilterConstraints, currentFilterKey]
  );

  // Escribir en el buscador filtra en memoria (0 lecturas). La búsqueda en BD se ejecuta solo al enviar formulario o pulsar "Buscar en BD" (en lotes de 50)
  const handleServerSearch = async (e) => {
    e?.preventDefault?.();
    const trimmed = searchTerm.trim();
    if (!trimmed) return;
    await ensureSearchPoolLoaded({ appendMore: false });
  };

  const normalizedSearchTerm = useMemo(() => normalizeSearchText(searchTerm.trim()), [searchTerm]);
  const activeSearchPool = useMemo(() => {
    void poolVersion;
    return searchPoolCacheRef.current[currentFilterKey] || null;
  }, [currentFilterKey, poolVersion]);
  const isShowingGlobalSearch = Boolean(normalizedSearchTerm && activeSearchPool);

  useEffect(() => {
    setSearchPage(1);
    setJumpPageInput('');
  }, [normalizedSearchTerm, currentFilterKey, pageSize]);

  // Coincidencias completas cuando hay búsqueda activa
  const allSearchMatches = useMemo(() => {
    if (!normalizedSearchTerm) return [];
    const source = activeSearchPool ? activeSearchPool.cards : flashcards;
    return source.filter((c) => matchesLocalCardSearch(c, normalizedSearchTerm));
  }, [flashcards, activeSearchPool, normalizedSearchTerm]);

  const browseTotalPages = useMemo(() => {
    if (totalCount !== null) return Math.max(1, Math.ceil(totalCount / pageSize));
    return hasMore ? currentPage + 1 : currentPage;
  }, [totalCount, pageSize, hasMore, currentPage]);

  const searchTotalPages = useMemo(
    () => Math.max(1, Math.ceil(allSearchMatches.length / pageSize)),
    [allSearchMatches.length, pageSize]
  );

  const isSearchMode = Boolean(normalizedSearchTerm);
  const displayPage = isSearchMode ? Math.min(searchPage, searchTotalPages) : currentPage;
  const displayTotalPages = isSearchMode ? searchTotalPages : browseTotalPages;
  const displayHasMore = isSearchMode ? displayPage < searchTotalPages : hasMore || displayPage < browseTotalPages;

  // Al escribir busca sobre página/pool y aplica paginación local instantánea en resultados de búsqueda
  const visibleFlashcards = useMemo(() => {
    if (!isSearchMode) return flashcards;
    const start = (displayPage - 1) * pageSize;
    return allSearchMatches.slice(start, start + pageSize);
  }, [isSearchMode, flashcards, allSearchMatches, displayPage, pageSize]);

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
        setSelectedCards([]);
      } else {
        fetchFlashcardsPage(clamped);
      }
    },
    [displayTotalPages, displayPage, isSearchMode, fetchFlashcardsPage]
  );

  const handleJumpToPage = (e) => {
    e.preventDefault();
    const parsed = parseInt(jumpPageInput, 10);
    if (Number.isNaN(parsed)) return;
    handlePageChange(parsed);
    setJumpPageInput('');
  };

  const toggleSelectCard = (cardId) => {
    setSelectedCards((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedCards.length === visibleFlashcards.length && visibleFlashcards.length > 0) {
      setSelectedCards([]);
    } else {
      setSelectedCards(visibleFlashcards.map((c) => c.id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCards.length === 0) return;

    if (selectedCards.length > 1) {
      const { value: password } = await Swal.fire({
        title: 'Acción Protegida',
        text: `Se eliminarán ${selectedCards.length} tarjetas seleccionadas. Ingrese la contraseña maestra:`,
        input: 'password',
        inputPlaceholder: 'Contraseña de administrador',
        showCancelButton: true,
        confirmButtonText: 'Confirmar Borrado Masivo',
        cancelButtonText: 'Cancelar',
        ...swalTheme,
      });

      if (!password) return;
      if (password !== '1234567890') {
        return Swal.fire({
          title: 'Acceso Denegado',
          text: 'La contraseña es incorrecta.',
          icon: 'error',
          ...swalTheme,
        });
      }
    } else {
      const result = await Swal.fire({
        title: '¿Eliminar tarjeta seleccionada?',
        text: 'Esta acción no se puede deshacer.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        ...swalTheme,
      });
      if (!result.isConfirmed) return;
    }

    try {
      Swal.fire({
        title: 'Procesando...',
        text: 'Eliminando tarjetas y su progreso...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
        ...swalTheme,
      });

      const deletedSet = new Set(selectedCards);
      for (const cardId of selectedCards) {
        await deleteFlashcardCompleta(cardId);
      }

      // Actualización optimista local sin gastar lecturas de reconsulta
      setFlashcards((prev) => prev.filter((c) => !deletedSet.has(c.id)));
      Object.keys(pageCacheRef.current).forEach((key) => {
        const entry = pageCacheRef.current[key];
        if (entry?.pages) {
          Object.keys(entry.pages).forEach((p) => {
            entry.pages[p] = entry.pages[p].filter((c) => !deletedSet.has(c.id));
          });
        }
      });
      Object.keys(searchPoolCacheRef.current).forEach((key) => {
        const pool = searchPoolCacheRef.current[key];
        if (pool) {
          pool.cards = pool.cards.filter((c) => !deletedSet.has(c.id));
        }
      });
      setPoolVersion((v) => v + 1);
      setTotalCount((prev) => (prev !== null ? Math.max(0, prev - deletedSet.size) : prev));
      setSelectedCards([]);
      setIsSelectionMode(false);
      Swal.fire({
        title: 'Eliminadas',
        text: 'Las tarjetas seleccionadas han sido borradas con éxito.',
        icon: 'success',
        ...swalTheme,
      });
    } catch (err) {
      Swal.fire({
        title: 'Error',
        text: 'Hubo un problema al eliminar algunas tarjetas: ' + err.message,
        icon: 'error',
        ...swalTheme,
      });
    }
  };

  const handleDelete = async (id, pregunta) => {
    const result = await Swal.fire({
      title: '¿Estás seguro?',
      text: `Vas a eliminar la tarjeta: "${pregunta}"`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      ...swalTheme,
    });

    if (!result.isConfirmed) return;

    try {
      await deleteFlashcardCompleta(id);
      setFlashcards((prev) => prev.filter((c) => c.id !== id));
      Object.keys(pageCacheRef.current).forEach((key) => {
        const entry = pageCacheRef.current[key];
        if (entry?.pages) {
          Object.keys(entry.pages).forEach((p) => {
            entry.pages[p] = entry.pages[p].filter((c) => c.id !== id);
          });
        }
      });
      Object.keys(searchPoolCacheRef.current).forEach((key) => {
        const pool = searchPoolCacheRef.current[key];
        if (pool) {
          pool.cards = pool.cards.filter((c) => c.id !== id);
        }
      });
      setPoolVersion((v) => v + 1);
      setTotalCount((prev) => (prev !== null ? Math.max(0, prev - 1) : prev));
      setSelectedCards((prev) => prev.filter((cid) => cid !== id));
      Swal.fire({
        icon: 'success',
        title: '¡Eliminado!',
        text: 'La tarjeta y su progreso asociado han sido eliminados.',
        ...swalTheme,
      });
    } catch (error) {
      console.error('Error al eliminar flashcard:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se pudo eliminar la tarjeta por completo.',
        ...swalTheme,
      });
    }
  };

  const resetFilters = () => {
    setSearchTerm('');
    setSelectedEspecialidad('Todas');
    setSelectedSubtema('Todos');
    setSelectedTipo('Todos');
  };

  const hasFilters =
    Boolean(searchTerm.trim()) ||
    selectedEspecialidad !== 'Todas' ||
    selectedSubtema !== 'Todos' ||
    selectedTipo !== 'Todos';

  if (!isLoaded || initialLoading) {
    return (
      <div
        className={`flex flex-col justify-center items-center min-h-[calc(100vh-4rem)] gap-3 ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <Loader2 className={`w-8 h-8 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
        <p className="text-sm font-bold">Cargando lote inicial de flashcards...</p>
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

  return (
    <div className={`w-full min-w-0 overflow-x-hidden p-3 sm:p-6 min-h-[calc(100vh-4rem)] ${pageBg}`}>
      <div className="w-full max-w-7xl mx-auto min-w-0 space-y-5">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2.5">
                <Layers className={`w-7 h-7 shrink-0 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
                <span>Gestión de Flashcards</span>
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
              {isSelectionMode && (
                <span className="bg-red-600 text-white text-[10px] px-2.5 py-1 rounded-full font-extrabold">
                  MODO SELECCIÓN
                </span>
              )}
            </div>
            <p className={`text-xs sm:text-sm font-medium mt-1 ${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]'}`}>
              Carga paginada bajo demanda ({pageSize} tarjetas/página) para ahorrar cuota de Firestore.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={fetchingPage || searchingServer}
              onClick={() => {
                searchPoolCacheRef.current = {};
                pageCacheRef.current = {};
                setPoolVersion((v) => v + 1);
                fetchFlashcardsPage(1, { refreshCount: true, forceRemote: true });
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 ${
                isDark
                  ? 'bg-[#1e293b] border-white/15 hover:bg-white/10 text-blue-200'
                  : 'bg-white border-[#2E4A70]/25 hover:bg-slate-50 text-[#1a2639]'
              }`}
              title="Recargar desde Firestore y limpiar caché local"
            >
              <RefreshCw className={`w-4 h-4 ${fetchingPage || searchingServer ? 'animate-spin' : ''}`} />
              <span>Actualizar</span>
            </button>

            {!isSelectionMode ? (
              <button
                type="button"
                onClick={() => setIsSelectionMode(true)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                  isDark
                    ? 'bg-[#1e293b] border-white/15 hover:bg-white/10 text-white'
                    : 'bg-white border-[#2E4A70]/25 hover:bg-slate-50 text-[#1a2639]'
                }`}
              >
                <ListChecks className="w-4 h-4" />
                <span>Selección Múltiple</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={selectedCards.length === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer disabled:opacity-45"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Eliminar ({selectedCards.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsSelectionMode(false);
                    setSelectedCards([]);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                    isDark ? 'border-white/15 text-slate-300' : 'border-[#2E4A70]/25 text-[#2E4A70] bg-white'
                  }`}
                >
                  <X className="w-4 h-4" />
                  <span>Cancelar</span>
                </button>
              </>
            )}

            <Link
              href="/admin/flashcards/new"
              className="inline-flex items-center gap-1.5 bg-[#014ba0] hover:bg-[#013b80] text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Nueva Tarjeta</span>
            </Link>
          </div>
        </header>

        {/* Aviso si hubo cuota agotada o error de Firestore */}
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
              onClick={() => fetchFlashcardsPage(currentPage, { refreshCount: false })}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer shrink-0"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Toolbar de Filtros en Servidor */}
        <div className={`p-4 rounded-2xl border space-y-3 min-w-0 ${surfaceClass}`}>
          <form onSubmit={handleServerSearch} className="grid grid-cols-1 md:grid-cols-12 gap-2.5 min-w-0">
            <div className="relative md:col-span-5 flex gap-2 min-w-0">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Buscar por pregunta, respuesta, tema o tag..."
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
                title="Buscar inmediatamente en toda la colección del filtro"
                className={`px-3 py-2.5 rounded-xl border text-xs font-bold cursor-pointer shrink-0 transition-colors disabled:opacity-50 ${
                  isDark
                    ? 'border-[#24B0BA]/40 bg-[#24B0BA]/15 text-[#24B0BA] hover:bg-[#24B0BA]/25'
                    : 'border-[#014ba0]/25 bg-[#014ba0]/10 text-[#014ba0] hover:bg-[#014ba0]/15'
                }`}
              >
                {searchingServer ? 'Buscando...' : 'Buscar en BD'}
              </button>
            </div>

            <div className="md:col-span-3 min-w-0">
              <select
                value={selectedEspecialidad}
                onChange={(e) => {
                  setSelectedEspecialidad(e.target.value);
                  setSelectedSubtema('Todos');
                }}
                style={selectColorScheme}
                className={`w-full min-w-0 max-w-full truncate px-3 py-2.5 rounded-xl border text-xs sm:text-sm font-semibold outline-none cursor-pointer ${inputClass}`}
              >
                <option value="Todas" className={optionClass}>Todas las especialidades</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.name} className={optionClass}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 min-w-0">
              <select
                value={selectedSubtema}
                onChange={(e) => setSelectedSubtema(e.target.value)}
                disabled={selectedEspecialidad === 'Todas'}
                style={selectColorScheme}
                className={`w-full min-w-0 max-w-full truncate px-3 py-2.5 rounded-xl border text-xs sm:text-sm font-semibold outline-none cursor-pointer disabled:opacity-50 ${inputClass}`}
              >
                <option value="Todos" className={optionClass}>Todos los subtemas</option>
                {availableSubthemes.map((sub) => (
                  <option key={sub.id} value={sub.name} className={optionClass}>
                    {sub.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 min-w-0">
              <select
                value={selectedTipo}
                onChange={(e) => setSelectedTipo(e.target.value)}
                style={selectColorScheme}
                className={`w-full min-w-0 max-w-full truncate px-3 py-2.5 rounded-xl border text-xs sm:text-sm font-semibold outline-none cursor-pointer ${inputClass}`}
              >
                <option value="Todos" className={optionClass}>Todos los tipos</option>
                <option value="Pregunta" className={optionClass}>Pregunta</option>
                <option value="Pregunta-Respuesta" className={optionClass}>Pregunta-Respuesta</option>
                <option value="Completar Espacios" className={optionClass}>Completar Espacios</option>
                <option value="Caso Clínico Corto" className={optionClass}>Caso Clínico Corto</option>
              </select>
            </div>
          </form>

          <div
            className={`pt-2.5 border-t flex flex-wrap items-center justify-between gap-2 text-xs ${
              isDark ? 'border-white/10 text-blue-200/80' : 'border-[#2E4A70]/10 text-[#2E4A70]'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2 font-semibold tabular-nums">
              {(fetchingPage || searchingServer) && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#24B0BA]" />
              )}
              <span>
                {searchingServer
                  ? 'Buscando coincidencias en la colección...'
                  : isShowingGlobalSearch
                  ? `${allSearchMatches.length} coincidencia(s) (escaneadas ${activeSearchPool.cards.length} en BD) · Pág. ${displayPage} de ${displayTotalPages}`
                  : `Página ${displayPage} de ${displayTotalPages} · ${visibleFlashcards.length} tarjetas visibles`}
              </span>
              {totalCount !== null && !isShowingGlobalSearch && !searchingServer && (
                <span className="opacity-70">· Total en filtro: {totalCount}</span>
              )}
              {isShowingGlobalSearch && activeSearchPool?.hasMore && (
                <button
                  type="button"
                  disabled={searchingServer}
                  onClick={() => ensureSearchPoolLoaded({ appendMore: true })}
                  className={`underline font-bold cursor-pointer ${
                    isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                  }`}
                >
                  Seguir buscando en BD (+{MAX_SERVER_SEARCH_DOCS})
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {hasFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className={`inline-flex items-center gap-1 font-bold underline cursor-pointer ${
                    isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Limpiar filtros</span>
                </button>
              )}

              <div className="flex items-center gap-1.5">
                <span className="opacity-75 font-semibold">Por página:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  style={selectColorScheme}
                  className={`px-2 py-1 rounded-lg border text-xs font-bold outline-none cursor-pointer ${inputClass}`}
                >
                  <option value={25} className={optionClass}>25</option>
                  <option value={50} className={optionClass}>50</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Listado */}
        {visibleFlashcards.length === 0 ? (
          <div className={`text-center py-16 px-4 rounded-2xl border-2 border-dashed ${surfaceClass}`}>
            {searchingServer ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-[#24B0BA]" />
                <p className="text-sm font-bold opacity-80">
                  Buscando coincidencias más allá de la página actual...
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm font-bold opacity-75">
                  {hasFilters
                    ? normalizedSearchTerm && !activeSearchPool && (currentPage > 1 || hasMore)
                      ? 'Buscando coincidencias o escribe al menos 2 caracteres / pulsa "Buscar en BD".'
                      : 'No se encontraron tarjetas con esos filtros.'
                    : 'No hay tarjetas registradas aún.'}
                </p>
                {hasFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#014ba0] text-white text-xs font-bold cursor-pointer"
                  >
                    Restablecer filtros
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {/* Móvil / Tableta (< lg): tarjetas apiladas sin desbordamiento */}
            <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleFlashcards.map((card) => {
                const isSelected = selectedCards.includes(card.id);
                return (
                  <div
                    key={card.id}
                    className={`p-4 rounded-2xl border space-y-3 ${
                      isSelected
                        ? isDark
                          ? 'bg-blue-950/30 border-[#24B0BA]'
                          : 'bg-blue-50/70 border-[#014ba0]'
                        : surfaceClass
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        {isSelectionMode && (
                          <button
                            type="button"
                            onClick={() => toggleSelectCard(card.id)}
                            className="mt-0.5 cursor-pointer shrink-0"
                            aria-label="Seleccionar tarjeta"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-[#014ba0]" />
                            ) : (
                              <Square className="w-4 h-4 opacity-50" />
                            )}
                          </button>
                        )}
                        <p className="font-bold text-sm line-clamp-3 break-words">{card.pregunta}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                      <span
                        className={`px-2 py-0.5 rounded-md ${
                          isDark ? 'bg-purple-500/20 text-purple-300' : 'bg-purple-50 text-purple-700'
                        }`}
                      >
                        {card.tipo || 'Pregunta'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md ${
                          isDark ? 'bg-white/10 text-blue-200' : 'bg-[#F0F2F2] text-[#2E4A70]'
                        }`}
                      >
                        {card.especialidadNombre || 'Sin especialidad'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md ${
                          isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
                        }`}
                      >
                        {card.subtema || 'Sin identificador'}
                      </span>
                    </div>

                    <div
                      className={`pt-2 border-t flex items-center justify-end gap-2 ${
                        isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
                      }`}
                    >
                      <Link
                        href={`/admin/flashcards/edit/${card.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#014ba0] text-white text-xs font-bold"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Editar</span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(card.id, card.pregunta)}
                        className={`p-1.5 rounded-xl border cursor-pointer ${
                          isDark
                            ? 'border-red-500/30 bg-red-500/15 text-red-300'
                            : 'border-red-200 bg-red-50 text-red-600'
                        }`}
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Escritorio (>= lg): tabla paginada */}
            <div className={`hidden lg:block w-full min-w-0 overflow-x-auto rounded-2xl border ${surfaceClass}`}>
              <table className={`w-full text-left border-collapse divide-y ${isDark ? 'divide-white/10' : 'divide-[#2E4A70]/10'}`}>
                <thead className={isDark ? 'bg-[#162235]' : 'bg-[#FFF9F0]'}>
                  <tr>
                    {isSelectionMode && (
                      <th className="p-4 text-left w-10">
                        <button type="button" onClick={toggleSelectAll} className="cursor-pointer">
                          {selectedCards.length === visibleFlashcards.length && visibleFlashcards.length > 0 ? (
                            <CheckSquare className="w-4 h-4 text-[#014ba0]" />
                          ) : (
                            <Square className="w-4 h-4 opacity-60" />
                          )}
                        </button>
                      </th>
                    )}
                    <th className={`p-4 text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                      Pregunta
                    </th>
                    <th className={`p-4 text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                      Tipo
                    </th>
                    <th className={`p-4 text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                      Especialidad
                    </th>
                    <th className={`p-4 text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                      Identificador (Tema)
                    </th>
                    <th className={`p-4 text-[11px] font-extrabold uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                      Tags
                    </th>
                    <th className={`p-4 text-[11px] font-extrabold uppercase tracking-wider text-center ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-white/10 bg-[#1e293b]' : 'divide-[#2E4A70]/10 bg-white'}`}>
                  {visibleFlashcards.map((card) => (
                    <tr
                      key={card.id}
                      className={`transition-colors ${
                        selectedCards.includes(card.id)
                          ? isDark
                            ? 'bg-blue-950/35'
                            : 'bg-blue-50/70'
                          : isDark
                          ? 'hover:bg-white/[0.03]'
                          : 'hover:bg-[#FFF9F0]/60'
                      }`}
                    >
                      {isSelectionMode && (
                        <td className="p-4">
                          <button type="button" onClick={() => toggleSelectCard(card.id)} className="cursor-pointer">
                            {selectedCards.includes(card.id) ? (
                              <CheckSquare className="w-4 h-4 text-[#014ba0]" />
                            ) : (
                              <Square className="w-4 h-4 opacity-50" />
                            )}
                          </button>
                        </td>
                      )}
                      <td className="p-4 max-w-md">
                        <div className="font-semibold text-sm line-clamp-2 break-words" title={card.pregunta}>
                          {card.pregunta}
                        </div>
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 rounded-md text-[10px] font-extrabold uppercase ${
                            isDark ? 'bg-purple-500/20 text-purple-300' : 'bg-purple-50 text-purple-700'
                          }`}
                        >
                          {card.tipo || 'Pregunta'}
                        </span>
                      </td>
                      <td className="p-4 whitespace-nowrap text-xs font-semibold">
                        {card.especialidadNombre || 'Sin especialidad'}
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                            isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
                          }`}
                        >
                          {card.subtema || 'Sin identificador'}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {Array.isArray(card.tags) &&
                            card.tags.slice(0, 4).map((tag, idx) => (
                              <span
                                key={idx}
                                className={`text-[10px] px-2 py-0.5 rounded border ${
                                  isDark
                                    ? 'bg-[#162235] border-white/10 text-slate-300'
                                    : 'bg-slate-50 border-slate-200 text-slate-600'
                                }`}
                              >
                                {tag}
                              </span>
                            ))}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex justify-center items-center gap-2">
                          <Link
                            href={`/admin/flashcards/edit/${card.id}`}
                            className={`p-2 rounded-xl transition-colors ${
                              isDark ? 'text-[#24B0BA] hover:bg-white/10' : 'text-[#014ba0] hover:bg-[#014ba0]/10'
                            }`}
                            title="Editar"
                          >
                            <Edit3 className="w-4 h-4" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDelete(card.id, card.pregunta)}
                            className={`p-2 rounded-xl transition-colors cursor-pointer ${
                              isDark ? 'text-red-400 hover:bg-red-500/15' : 'text-red-600 hover:bg-red-50'
                            }`}
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Paginador con atajos numéricos y salto directo */}
        {displayTotalPages > 1 && (
          <div className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${surfaceClass}`}>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5">
              <button
                type="button"
                disabled={displayPage <= 1 || fetchingPage}
                onClick={() => handlePageChange(displayPage - 1)}
                className={`inline-flex items-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl border font-bold cursor-pointer disabled:opacity-40 ${
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

              <button
                type="button"
                disabled={!displayHasMore || fetchingPage}
                onClick={() => handlePageChange(displayPage + 1)}
                className={`inline-flex items-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl border font-bold cursor-pointer disabled:opacity-40 ${
                  isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/25 hover:bg-slate-50'
                }`}
              >
                <span className="hidden sm:inline">Siguiente</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {displayTotalPages > 5 && (
              <form onSubmit={handleJumpToPage} className="flex items-center justify-center sm:justify-end gap-1.5">
                <label htmlFor="flashcards-jump-page" className="font-semibold opacity-75 whitespace-nowrap">
                  Ir a pág.:
                </label>
                <input
                  id="flashcards-jump-page"
                  type="number"
                  min={1}
                  max={displayTotalPages}
                  value={jumpPageInput}
                  onChange={(e) => setJumpPageInput(e.target.value)}
                  placeholder={`1-${displayTotalPages}`}
                  style={selectColorScheme}
                  className={`w-16 px-2 py-1.5 rounded-lg border text-xs font-bold text-center outline-none tabular-nums ${inputClass}`}
                />
                <button
                  type="submit"
                  disabled={fetchingPage && !isSearchMode}
                  className={`px-2.5 py-1.5 rounded-lg border font-bold cursor-pointer transition-colors disabled:opacity-50 ${
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
        )}
      </div>
    </div>
  );
}
