'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import {
  CheckCircle,
  XCircle,
  Trash2,
  UserPlus,
  ListChecks,
  X,
  AlertTriangle,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Users,
  Edit3,
  Phone,
  SlidersHorizontal,
  Plus,
  Check,
  CalendarClock,
  ShieldCheck,
} from 'lucide-react';
import {
  buildExpirationFields,
  formatExpirationDisplay,
  getBoliviaDateParts,
  isAccountExpired,
  parseExpirationMs,
} from '@/lib/accountExpiration';

const DEFAULT_PAGE_SIZE = 25;

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function matchesUserSearch(user, normalizedTerm) {
  if (!normalizedTerm) return true;
  const haystack = normalizeSearchText(
    [
      user.fullName,
      user.name,
      user.displayName,
      user.email,
      user.telefono,
      user.universidad,
      user.profesion,
      user.id,
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

export default function UsersClient() {
  const router = useRouter();
  const { isDark, isLoaded } = useTheme();
  const { firebaseAuthUser } = useAuth();

  // Listado paginado bajo demanda (sin polling automático)
  const [users, setUsers] = useState([]);
  const [totalCount, setTotalCount] = useState(null);
  const [expiredUsersCount, setExpiredUsersCount] = useState(0);
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
  const [statusFilter, setStatusFilter] = useState('all');

  // Selección múltiple persistente entre páginas y búsquedas
  const [selectedUsersMap, setSelectedUsersMap] = useState({});
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // Buscador rápido en BD para agregar usuarios a la selección múltiple
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerSearching, setPickerSearching] = useState(false);
  const [pickerPool, setPickerPool] = useState({ users: [], nextCursorId: null, hasMore: false, loadedOnce: false });

  // Modal de Edición Masiva (estado, Pago Único, vigencia)
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [savingBulkEdit, setSavingBulkEdit] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    activeMode: 'unchanged', // 'unchanged' | 'activate' | 'deactivate'
    pagoUnicoMode: 'unchanged', // 'unchanged' | 'grant' | 'revoke'
    vigenciaMode: 'unchanged', // 'unchanged' | 'months' | 'exact' | 'unlimited'
    activeDurationMonths: '3',
    exactDate: '',
    exactTime: '23:59',
  });

  const selectedUsersList = useMemo(() => Object.values(selectedUsersMap), [selectedUsersMap]);
  const selectedUsers = useMemo(() => Object.keys(selectedUsersMap), [selectedUsersMap]);

  // Cachés locales por filtro/tamaño para ahorrar lecturas de Firestore
  const pageCacheRef = useRef({});
  const searchQueryCacheRef = useRef({});
  const [serverSearchState, setServerSearchState] = useState(null);
  const serverSearchStateRef = useRef(null);
  serverSearchStateRef.current = serverSearchState;
  const searchTermRef = useRef('');
  searchTermRef.current = searchTerm;
  const reqSeqRef = useRef(0);
  const searchSeqRef = useRef(0);
  const pickerLastQueriedRef = useRef('');
  const pickerPoolNextCursorRef = useRef(null);
  pickerPoolNextCursorRef.current = pickerPool.nextCursorId;
  const pickerQueryRef = useRef('');
  pickerQueryRef.current = pickerQuery;

  const currentPageCacheKey = useMemo(
    () => `${statusFilter}::${pageSize}`,
    [statusFilter, pageSize]
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

  const fetchUsersPage = useCallback(
    async (targetPage = 1, { refreshCount = false, forceRemote = false } = {}) => {
      const safeTargetPage = Math.max(1, targetPage);
      const cacheKey = currentPageCacheKey;

      if (!pageCacheRef.current[cacheKey]) {
        pageCacheRef.current[cacheKey] = {
          pages: {},
          endCursors: {},
          hasMoreByPage: {},
          highestPage: 0,
        };
      }
      const cacheEntry = pageCacheRef.current[cacheKey];

      // Si ya visitamos o cacheamos esta página al saltar, usar memoria local (0 lecturas)
      if (!forceRemote && !refreshCount && cacheEntry.pages[safeTargetPage]) {
        setUsers(cacheEntry.pages[safeTargetPage]);
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
        let startPage = 0;
        for (let p = safeTargetPage - 1; p >= 1; p -= 1) {
          if (cacheEntry.endCursors[p]) {
            startPage = p;
            break;
          }
        }

        let afterId = startPage > 0 ? cacheEntry.endCursors[startPage] : '';
        let currentFillPage = startPage + 1;
        let pagesLeftToLoad = safeTargetPage - startPage;
        let needCounts = refreshCount || safeTargetPage === 1;

        while (pagesLeftToLoad > 0) {
          const pagesInChunk = Math.min(pagesLeftToLoad, 2);
          const params = new URLSearchParams({
            paginated: '1',
            action: 'page',
            status: statusFilter,
            pageSize: String(pageSize),
            pagesToFetch: String(pagesInChunk),
          });
          if (afterId) params.set('afterId', afterId);
          if (needCounts) params.set('includeCounts', '1');

          const res = await fetch(`/api/users?${params.toString()}`, { cache: 'no-store' });
          const data = await res.json().catch(() => ({}));

          if (!res.ok) {
            const err = new Error(data?.error || 'No se pudo cargar la lista de usuarios.');
            if (res.status === 429 || data?.code === 'resource-exhausted') {
              err.code = 'resource-exhausted';
            }
            throw err;
          }

          if (seq !== reqSeqRef.current) return;

          if (needCounts) {
            if (data.totalCount !== undefined && data.totalCount !== null) {
              setTotalCount(data.totalCount);
            }
            if (data.expiredCount !== undefined && data.expiredCount !== null) {
              setExpiredUsersCount(data.expiredCount);
            }
            needCounts = false;
          }

          const returnedPages = Array.isArray(data.pages) ? data.pages : [];
          if (returnedPages.length === 0) break;

          returnedPages.forEach((slice, idx) => {
            const pNum = currentFillPage + idx;
            cacheEntry.pages[pNum] = slice.items || [];
            if (slice.endCursorId) {
              cacheEntry.endCursors[pNum] = slice.endCursorId;
            }
            cacheEntry.hasMoreByPage[pNum] = Boolean(slice.hasMore);
            cacheEntry.highestPage = Math.max(cacheEntry.highestPage, pNum);
          });

          const lastSlice = returnedPages[returnedPages.length - 1];
          currentFillPage += returnedPages.length;
          pagesLeftToLoad -= returnedPages.length;
          afterId = lastSlice?.endCursorId || '';

          if (!lastSlice?.hasMore || !afterId) break;
        }

        // Si el filtro cupo entero en la página 1, reutilizarlo en búsqueda global sin lecturas extra
        if (cacheEntry.pages[1] && !cacheEntry.hasMoreByPage[1]) {
          searchQueryCacheRef.current[`${statusFilter}::__all__`] = {
            cacheKey: `${statusFilter}::__all__`,
            statusFilter,
            normalizedQuery: '',
            users: cacheEntry.pages[1],
            totalMatches: cacheEntry.pages[1].length,
            matchesTruncated: false,
            nextCursorId: null,
            hasMore: false,
            scannedCount: cacheEntry.pages[1].length,
          };
          setPoolVersion((v) => v + 1);
        }

        const resolvedPage = cacheEntry.pages[safeTargetPage]
          ? safeTargetPage
          : Math.max(1, cacheEntry.highestPage);
        setUsers(cacheEntry.pages[resolvedPage] || []);
        setHasMore(Boolean(cacheEntry.hasMoreByPage[resolvedPage]));
        setCurrentPage(resolvedPage);
      } catch (err) {
        if (seq !== reqSeqRef.current) return;
        console.error('Error cargando usuarios paginados:', err);
        if (err?.code === 'resource-exhausted') {
          setFetchError(
            'Se alcanzó temporalmente la cuota diaria de lecturas de Firestore. Reduce consultas o vuelve a intentar cuando se reinicie la cuota.'
          );
        } else {
          setFetchError(err?.message || 'Error al sincronizar usuarios.');
        }
      } finally {
        if (seq === reqSeqRef.current) {
          setInitialLoading(false);
          setFetchingPage(false);
        }
      }
    },
    [currentPageCacheKey, pageSize, statusFilter]
  );

  // Cargar página 1 cuando cambia estado o tamaño de página
  useEffect(() => {
    fetchUsersPage(1, { refreshCount: true, forceRemote: true });
  }, [fetchUsersPage]);

  // Búsqueda acotada en servidor con caché por consulta y reutilización de subconjuntos ya completos
  const runServerSearch = useCallback(
    async ({ term = '', appendMore = false, forceRefresh = false } = {}) => {
      const trimmedTerm = String(term || '').trim();
      const normTerm = normalizeSearchText(trimmedTerm);
      if (!normTerm) return null;

      const cacheKey = `${statusFilter}::${normTerm}`;
      const currentState = serverSearchStateRef.current;
      const existingResult =
        currentState?.cacheKey === cacheKey
          ? currentState
          : searchQueryCacheRef.current[cacheKey] || null;

      if (!appendMore && !forceRefresh) {
        if (existingResult) {
          setServerSearchState(existingResult);
          return existingResult;
        }

        // Si el filtro completo ya cupo en la página 1, resolver en memoria (0 lecturas)
        const fullSinglePage = searchQueryCacheRef.current[`${statusFilter}::__all__`];
        if (fullSinglePage && !fullSinglePage.hasMore) {
          const filtered = fullSinglePage.users.filter((u) => matchesUserSearch(u, normTerm));
          const resolved = {
            cacheKey,
            statusFilter,
            normalizedQuery: normTerm,
            users: filtered,
            totalMatches: filtered.length,
            matchesTruncated: false,
            nextCursorId: null,
            hasMore: false,
            scannedCount: fullSinglePage.scannedCount,
          };
          searchQueryCacheRef.current[cacheKey] = resolved;
          setServerSearchState(resolved);
          return resolved;
        }

        // Si un prefijo más corto ya recorrió toda la BD sin truncar, el nuevo término es un subconjunto exacto
        const prefixMatch = Object.values(searchQueryCacheRef.current).find(
          (entry) =>
            entry &&
            entry.statusFilter === statusFilter &&
            entry.normalizedQuery &&
            !entry.hasMore &&
            !entry.matchesTruncated &&
            normTerm.includes(entry.normalizedQuery)
        );
        if (prefixMatch) {
          const filtered = prefixMatch.users.filter((u) => matchesUserSearch(u, normTerm));
          const resolved = {
            cacheKey,
            statusFilter,
            normalizedQuery: normTerm,
            users: filtered,
            totalMatches: filtered.length,
            matchesTruncated: false,
            nextCursorId: null,
            hasMore: false,
            scannedCount: prefixMatch.scannedCount,
          };
          searchQueryCacheRef.current[cacheKey] = resolved;
          setServerSearchState(resolved);
          return resolved;
        }
      }

      if (appendMore && existingResult && !existingResult.hasMore) {
        return existingResult;
      }

      const seq = ++searchSeqRef.current;
      setSearchingServer(true);
      setFetchError('');

      try {
        const params = new URLSearchParams({
          paginated: '1',
          action: 'search',
          status: statusFilter,
          q: trimmedTerm,
        });
        if (appendMore && existingResult?.nextCursorId) {
          params.set('afterId', existingResult.nextCursorId);
        }
        if (forceRefresh) {
          params.set('refresh', '1');
        }

        const res = await fetch(`/api/users?${params.toString()}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const err = new Error(data?.error || 'No se pudo completar la búsqueda en BD.');
          if (res.status === 429 || data?.code === 'resource-exhausted') {
            err.code = 'resource-exhausted';
          }
          throw err;
        }

        if (seq !== searchSeqRef.current) return null;

        const baseUsers = appendMore && existingResult ? [...existingResult.users] : [];
        const seenIds = new Set(baseUsers.map((u) => u.id));
        for (const u of data.users || []) {
          if (!seenIds.has(u.id)) {
            seenIds.add(u.id);
            baseUsers.push(u);
          }
        }

        const updatedResult = {
          cacheKey,
          statusFilter,
          normalizedQuery: normTerm,
          users: baseUsers,
          totalMatches: appendMore
            ? Math.max(baseUsers.length, Number(data.totalMatches || baseUsers.length))
            : Number(data.totalMatches ?? baseUsers.length),
          matchesTruncated: Boolean(data.matchesTruncated),
          nextCursorId: data.nextCursorId || null,
          hasMore: Boolean(data.hasMore),
          scannedCount: Number(data.scannedCount || baseUsers.length),
        };

        searchQueryCacheRef.current[cacheKey] = updatedResult;
        setServerSearchState(updatedResult);
        setPoolVersion((v) => v + 1);
        return updatedResult;
      } catch (err) {
        if (seq !== searchSeqRef.current) return null;
        if (err?.code === 'resource-exhausted') {
          setFetchError(
            'Cuota diaria de Firestore agotada temporalmente; solo es posible filtrar sobre los usuarios ya cargados.'
          );
        } else {
          setFetchError(err?.message || 'Error buscando usuarios.');
        }
        return null;
      } finally {
        if (seq === searchSeqRef.current) {
          setSearchingServer(false);
        }
      }
    },
    [statusFilter]
  );

  // Disparar búsqueda en BD con debounce (450 ms) desde 2+ caracteres para encontrar usuarios en cualquier página
  const normalizedSearchTerm = useMemo(() => normalizeSearchText(searchTerm.trim()), [searchTerm]);

  useEffect(() => {
    if (!normalizedSearchTerm) {
      searchSeqRef.current += 1;
      setSearchingServer(false);
      return undefined;
    }
    if (normalizedSearchTerm.length < 2) {
      return undefined;
    }
    const timer = setTimeout(() => {
      runServerSearch({ term: searchTermRef.current, appendMore: false });
    }, 450);
    return () => clearTimeout(timer);
  }, [normalizedSearchTerm, statusFilter, runServerSearch]);

  const handleServerSearch = async (e) => {
    e?.preventDefault?.();
    if (!searchTerm.trim()) return;
    await runServerSearch({ term: searchTerm, appendMore: false });
  };

  const activeServerResult = useMemo(() => {
    void poolVersion;
    if (!normalizedSearchTerm) return null;
    const exactKey = `${statusFilter}::${normalizedSearchTerm}`;
    if (searchQueryCacheRef.current[exactKey]) {
      return searchQueryCacheRef.current[exactKey];
    }
    if (
      serverSearchState &&
      serverSearchState.statusFilter === statusFilter &&
      serverSearchState.normalizedQuery &&
      (serverSearchState.normalizedQuery === normalizedSearchTerm ||
        (!serverSearchState.hasMore &&
          !serverSearchState.matchesTruncated &&
          normalizedSearchTerm.includes(serverSearchState.normalizedQuery)))
    ) {
      return serverSearchState;
    }
    const fullSinglePage = searchQueryCacheRef.current[`${statusFilter}::__all__`];
    if (fullSinglePage && !fullSinglePage.hasMore) {
      return fullSinglePage;
    }
    return null;
  }, [normalizedSearchTerm, statusFilter, serverSearchState, poolVersion]);

  const isSearchMode = Boolean(normalizedSearchTerm);
  const isShowingGlobalSearch = Boolean(
    normalizedSearchTerm && activeServerResult && activeServerResult.normalizedQuery !== ''
  );

  useEffect(() => {
    setSearchPage(1);
    setJumpPageInput('');
  }, [normalizedSearchTerm, statusFilter, pageSize]);

  // Combinar los usuarios ya visitados en caché local para búsqueda instantánea mientras resuelve el debounce
  const visitedPagesPool = useMemo(() => {
    void poolVersion;
    const byId = new Map();
    const entry = pageCacheRef.current[currentPageCacheKey];
    if (entry?.pages) {
      Object.values(entry.pages).forEach((slice) => {
        for (const u of slice || []) {
          byId.set(u.id, u);
        }
      });
    }
    for (const u of users) {
      byId.set(u.id, u);
    }
    return Array.from(byId.values());
  }, [currentPageCacheKey, users, poolVersion]);

  const allSearchMatches = useMemo(() => {
    if (!isSearchMode) return [];
    const source = activeServerResult ? activeServerResult.users : visitedPagesPool;
    return source.filter((u) => matchesUserSearch(u, normalizedSearchTerm));
  }, [isSearchMode, activeServerResult, visitedPagesPool, normalizedSearchTerm]);

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

  const visibleUsers = useMemo(() => {
    if (!isSearchMode) return users;
    const start = (displayPage - 1) * pageSize;
    return allSearchMatches.slice(start, start + pageSize);
  }, [isSearchMode, users, allSearchMatches, displayPage, pageSize]);

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
        fetchUsersPage(clamped);
      }
    },
    [displayTotalPages, displayPage, isSearchMode, fetchUsersPage]
  );

  const handleJumpToPage = (e) => {
    e.preventDefault();
    const parsed = parseInt(jumpPageInput, 10);
    if (Number.isNaN(parsed)) return;
    handlePageChange(parsed);
    setJumpPageInput('');
  };

  const removeUsersFromCaches = useCallback((deletedIdsSet) => {
    setUsers((prev) => prev.filter((u) => !deletedIdsSet.has(u.id)));
    Object.keys(pageCacheRef.current).forEach((key) => {
      const entry = pageCacheRef.current[key];
      if (entry?.pages) {
        Object.keys(entry.pages).forEach((p) => {
          entry.pages[p] = entry.pages[p].filter((u) => !deletedIdsSet.has(u.id));
        });
      }
    });
    Object.keys(searchQueryCacheRef.current).forEach((key) => {
      const entry = searchQueryCacheRef.current[key];
      if (entry) {
        entry.users = entry.users.filter((u) => !deletedIdsSet.has(u.id));
      }
    });
    setServerSearchState((prev) =>
      prev ? { ...prev, users: prev.users.filter((u) => !deletedIdsSet.has(u.id)) } : prev
    );
    setPickerPool((prev) => ({
      ...prev,
      users: prev.users.filter((u) => !deletedIdsSet.has(u.id)),
    }));
    setSelectedUsersMap((prev) => {
      const next = { ...prev };
      let changed = false;
      deletedIdsSet.forEach((id) => {
        if (next[id]) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setPoolVersion((v) => v + 1);
  }, []);

  const updateUsersInCaches = useCallback((userIdsSet, patch) => {
    const applyPatch = (u) => (userIdsSet.has(u.id) ? { ...u, ...patch } : u);
    setUsers((prev) => prev.map(applyPatch));
    Object.keys(pageCacheRef.current).forEach((key) => {
      const entry = pageCacheRef.current[key];
      if (entry?.pages) {
        Object.keys(entry.pages).forEach((p) => {
          entry.pages[p] = entry.pages[p].map(applyPatch);
        });
      }
    });
    Object.keys(searchQueryCacheRef.current).forEach((key) => {
      const entry = searchQueryCacheRef.current[key];
      if (entry) {
        entry.users = entry.users.map(applyPatch);
      }
    });
    setServerSearchState((prev) =>
      prev ? { ...prev, users: prev.users.map(applyPatch) } : prev
    );
    setPickerPool((prev) => ({
      ...prev,
      users: prev.users.map(applyPatch),
    }));
    setSelectedUsersMap((prev) => {
      let changed = false;
      const next = { ...prev };
      userIdsSet.forEach((id) => {
        if (next[id]) {
          next[id] = { ...next[id], ...patch };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setPoolVersion((v) => v + 1);
  }, []);

  const updateUserInCaches = useCallback(
    (userId, patch) => {
      updateUsersInCaches(new Set([userId]), patch);
    },
    [updateUsersInCaches]
  );

  const toUserSummary = (u) => ({
    id: u.id,
    fullName: u.fullName || '',
    email: u.email || '',
    active: Boolean(u.active),
    hasPagoUnicoAccess: Boolean(u.hasPagoUnicoAccess),
    activeUntil: u.activeUntil ?? null,
    deactivatedReason: u.deactivatedReason || null,
  });

  const toggleSelectUser = (userObjOrId) => {
    const targetUser =
      typeof userObjOrId === 'string'
        ? visibleUsers.find((u) => u.id === userObjOrId) ||
          pickerPool.users.find((u) => u.id === userObjOrId) ||
          selectedUsersMap[userObjOrId]
        : userObjOrId;
    if (!targetUser?.id) return;

    setSelectedUsersMap((prev) => {
      const next = { ...prev };
      if (next[targetUser.id]) {
        delete next[targetUser.id];
      } else {
        next[targetUser.id] = toUserSummary(targetUser);
      }
      return next;
    });
  };

  const allVisibleSelected =
    visibleUsers.length > 0 && visibleUsers.every((u) => Boolean(selectedUsersMap[u.id]));

  const toggleSelectAll = () => {
    setSelectedUsersMap((prev) => {
      const next = { ...prev };
      if (allVisibleSelected) {
        visibleUsers.forEach((u) => {
          delete next[u.id];
        });
      } else {
        visibleUsers.forEach((u) => {
          next[u.id] = toUserSummary(u);
        });
      }
      return next;
    });
  };

  const addUsersBatchToSelection = (list) => {
    if (!Array.isArray(list) || list.length === 0) return;
    setSelectedUsersMap((prev) => {
      const next = { ...prev };
      for (const u of list) {
        if (u?.id) next[u.id] = toUserSummary(u);
      }
      return next;
    });
  };

  const normalizedPickerQuery = useMemo(
    () => normalizeSearchText(pickerQuery.trim()),
    [pickerQuery]
  );

  const handlePickerSearch = useCallback(
    async ({ appendMore = false, termOverride = null } = {}) => {
      const qText = (termOverride !== null ? termOverride : pickerQueryRef.current).trim();
      const normQ = normalizeSearchText(qText);
      setPickerSearching(true);
      try {
        const params = new URLSearchParams({
          paginated: '1',
          action: 'search',
          status: 'all',
        });
        if (qText) {
          params.set('q', qText);
        }
        if (appendMore && pickerPoolNextCursorRef.current) {
          params.set('afterId', pickerPoolNextCursorRef.current);
        }
        const res = await fetch(`/api/users?${params.toString()}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'No se pudo consultar usuarios en BD.');

        pickerLastQueriedRef.current = normQ;
        setPickerPool((prev) => {
          const base = appendMore ? [...prev.users] : [];
          const seen = new Set(base.map((u) => u.id));
          for (const u of data.users || []) {
            if (!seen.has(u.id)) {
              seen.add(u.id);
              base.push(u);
            }
          }
          return {
            users: base,
            nextCursorId: data.nextCursorId || null,
            hasMore: Boolean(data.hasMore),
            loadedOnce: true,
          };
        });
      } catch (err) {
        Swal.fire({ title: 'Error', text: err.message, icon: 'error', ...swalTheme });
      } finally {
        setPickerSearching(false);
      }
    },
    [swalTheme]
  );

  useEffect(() => {
    if (!isSelectionMode || normalizedPickerQuery.length < 2) return undefined;
    if (pickerLastQueriedRef.current === normalizedPickerQuery) return undefined;
    const timer = setTimeout(() => {
      handlePickerSearch({ appendMore: false, termOverride: pickerQueryRef.current });
    }, 450);
    return () => clearTimeout(timer);
  }, [isSelectionMode, normalizedPickerQuery, handlePickerSearch]);

  const pickerMatches = useMemo(() => {
    if (!normalizedPickerQuery) return [];
    const byId = new Map();
    for (const u of visitedPagesPool) byId.set(u.id, u);
    for (const u of activeServerResult?.users || []) byId.set(u.id, u);
    for (const u of pickerPool.users) byId.set(u.id, u);

    return Array.from(byId.values())
      .filter((u) => matchesUserSearch(u, normalizedPickerQuery))
      .slice(0, 30);
  }, [normalizedPickerQuery, visitedPagesPool, activeServerResult, pickerPool.users]);

  const openBulkEditModal = () => {
    if (selectedUsers.length === 0) return;
    const todayParts = getBoliviaDateParts(new Date());
    setBulkForm({
      activeMode: 'unchanged',
      pagoUnicoMode: 'unchanged',
      vigenciaMode: 'unchanged',
      activeDurationMonths: '3',
      exactDate: todayParts?.dateStr || '',
      exactTime: '23:59',
    });
    setBulkEditOpen(true);
  };

  const bulkHasChanges =
    bulkForm.activeMode !== 'unchanged' ||
    bulkForm.pagoUnicoMode !== 'unchanged' ||
    bulkForm.vigenciaMode !== 'unchanged';

  const bulkVigenciaPreview = useMemo(() => {
    if (bulkForm.vigenciaMode === 'months') {
      const m = Math.max(1, Math.min(120, Number(bulkForm.activeDurationMonths) || 3));
      const preview = buildExpirationFields({ durationType: 'months', activeDurationMonths: m });
      return `Vence el ${formatExpirationDisplay(preview.activeUntil)} (23:59 Bolivia)`;
    }
    if (bulkForm.vigenciaMode === 'exact' && bulkForm.exactDate) {
      const preview = buildExpirationFields({
        durationType: 'exact',
        exactDate: bulkForm.exactDate,
        exactTime: bulkForm.exactTime || '23:59',
      });
      return `Vence el ${formatExpirationDisplay(preview.activeUntil)} (${bulkForm.exactTime || '23:59'} Bolivia)`;
    }
    if (bulkForm.vigenciaMode === 'unlimited') {
      return 'Sin fecha de vencimiento';
    }
    return '';
  }, [bulkForm.vigenciaMode, bulkForm.activeDurationMonths, bulkForm.exactDate, bulkForm.exactTime]);

  const handleBulkEditSubmit = async (e) => {
    e.preventDefault();
    if (savingBulkEdit || selectedUsers.length === 0 || !bulkHasChanges) return;

    if (bulkForm.vigenciaMode === 'exact' && !bulkForm.exactDate) {
      Swal.fire({
        title: 'Fecha requerida',
        text: 'Selecciona la fecha límite para la vigencia exacta.',
        icon: 'warning',
        ...swalTheme,
      });
      return;
    }

    setSavingBulkEdit(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (firebaseAuthUser) {
        const token = await firebaseAuthUser.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch('/api/users/bulk-update', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          userIds: selectedUsers,
          changes: {
            activeMode: bulkForm.activeMode,
            pagoUnicoMode: bulkForm.pagoUnicoMode,
            vigenciaMode: bulkForm.vigenciaMode,
            activeDurationMonths: Number(bulkForm.activeDurationMonths) || 3,
            exactDate: bulkForm.exactDate,
            exactTime: bulkForm.exactTime || '23:59',
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'No se pudieron actualizar los usuarios.');

      const succeededIds = Array.isArray(data?.results?.success) ? data.results.success : selectedUsers;
      const updatedSet = new Set(succeededIds);
      const patch = data.updatedFields || {};

      if (patch.active === true) {
        const reactivatedExpiredCount = selectedUsersList.filter(
          (u) =>
            updatedSet.has(u.id) &&
            (u.deactivatedReason === 'expired' || isAccountExpired(u))
        ).length;
        if (reactivatedExpiredCount > 0) {
          setExpiredUsersCount((prev) => Math.max(0, prev - reactivatedExpiredCount));
        }
      }

      updateUsersInCaches(updatedSet, patch);
      setBulkEditOpen(false);
      await Swal.fire({
        title: 'Actualización aplicada',
        text: data.message || `Se actualizaron ${succeededIds.length} usuario(s).`,
        icon: 'success',
        ...swalTheme,
      });
    } catch (err) {
      Swal.fire({ title: 'Error', text: err.message, icon: 'error', ...swalTheme });
    } finally {
      setSavingBulkEdit(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedUsers.length === 0) return;

    if (selectedUsers.length > 1) {
      const { value: password } = await Swal.fire({
        title: 'Acción Protegida',
        text: `Se eliminarán ${selectedUsers.length} usuarios seleccionados. Ingrese la contraseña maestra:`,
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
        title: '¿Eliminar usuario seleccionado?',
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
      Swal.fire({ title: 'Procesando...', allowOutsideClick: false, didOpen: () => Swal.showLoading(), ...swalTheme });

      const response = await fetch('/api/delete-user', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: selectedUsers }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Error en el servidor');

      const succeededIds = Array.isArray(data?.results?.success) ? data.results.success : selectedUsers;
      const deletedSet = new Set(succeededIds);
      const expiredRemoved = selectedUsersList.filter(
        (u) => deletedSet.has(u.id) && (u.deactivatedReason === 'expired' || isAccountExpired(u))
      ).length;

      removeUsersFromCaches(deletedSet);
      setTotalCount((prev) => (prev !== null ? Math.max(0, prev - deletedSet.size) : prev));
      if (expiredRemoved > 0) {
        setExpiredUsersCount((prev) => Math.max(0, prev - expiredRemoved));
      }
      setSelectedUsersMap({});
      setIsSelectionMode(false);
      Swal.fire({
        title: 'Eliminados',
        text: 'Los usuarios seleccionados han sido borrados.',
        icon: 'success',
        ...swalTheme,
      });
    } catch (err) {
      Swal.fire({ title: 'Error', text: err.message, icon: 'error', ...swalTheme });
    }
  };

  const handleToggleActive = async (user) => {
    try {
      const wasExpired = user.deactivatedReason === 'expired' || isAccountExpired(user);
      const res = await fetch('/api/toggle-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'No se pudo cambiar el estado.');

      const patch = data.updatedFields || { active: !user.active };
      updateUserInCaches(user.id, patch);

      if (wasExpired && patch.active === true) {
        setExpiredUsersCount((prev) => Math.max(0, prev - 1));
      }
    } catch (err) {
      Swal.fire({ title: 'Error', text: err.message || 'No se pudo cambiar el estado.', icon: 'error', ...swalTheme });
    }
  };

  const handleDeleteUser = async (user) => {
    const result = await Swal.fire({
      title: `¿Eliminar a ${user.fullName}?`,
      text: 'Acción individual inmediata.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      ...swalTheme,
    });

    if (!result.isConfirmed) return;

    try {
      const res = await fetch('/api/delete-user', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) throw new Error('No se pudo eliminar el usuario.');

      removeUsersFromCaches(new Set([user.id]));
      setTotalCount((prev) => (prev !== null ? Math.max(0, prev - 1) : prev));
      if (user.deactivatedReason === 'expired' || isAccountExpired(user)) {
        setExpiredUsersCount((prev) => Math.max(0, prev - 1));
      }
      Swal.fire({ title: 'Eliminado', icon: 'success', timer: 1500, showConfirmButton: false, ...swalTheme });
    } catch (err) {
      Swal.fire({ title: 'Error', text: err.message, icon: 'error', ...swalTheme });
    }
  };

  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
  };

  const hasFilters = Boolean(searchTerm.trim()) || statusFilter !== 'all';

  if (!isLoaded || initialLoading) {
    return (
      <section
        className={`min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center gap-3 ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <Loader2 className={`w-8 h-8 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
        <p className="text-sm font-bold">Cargando lote inicial de usuarios...</p>
      </section>
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

  const renderVigenciaBadge = (user) => {
    const expMs = parseExpirationMs(user.activeUntil);
    if (expMs === null) {
      return (
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
            isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-600'
          }`}
        >
          Sin vencimiento
        </span>
      );
    }
    if (user.deactivatedReason === 'expired' || isAccountExpired(user)) {
      return (
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
            isDark
              ? 'bg-red-500/20 text-red-300 border-red-500/35'
              : 'bg-red-50 text-red-700 border-red-200'
          }`}
        >
          Vencido / Auto-desactivado
        </span>
      );
    }
    const daysLeft = Math.ceil((expMs - Date.now()) / 86400000);
    return (
      <span
        className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
          daysLeft <= 7
            ? isDark
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/35'
              : 'bg-amber-50 text-amber-800 border-amber-200'
            : isDark
            ? 'bg-teal-500/15 text-teal-300 border-teal-500/30'
            : 'bg-teal-50 text-teal-700 border-teal-200'
        }`}
      >
        Hasta {formatExpirationDisplay(user.activeUntil)}
      </span>
    );
  };

  return (
    <div className={`w-full min-w-0 overflow-x-hidden p-3 sm:p-6 min-h-[calc(100vh-4rem)] ${pageBg}`}>
      <div className="w-full max-w-7xl mx-auto min-w-0 space-y-5">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2.5">
                <Users className={`w-7 h-7 shrink-0 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
                <span>Usuarios</span>
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
                <span className="bg-[#014ba0] text-white text-[10px] px-2.5 py-1 rounded-full font-extrabold tabular-nums">
                  {selectedUsers.length} SELECCIONADO{selectedUsers.length === 1 ? '' : 'S'}
                </span>
              )}
            </div>
            <p className={`text-xs sm:text-sm font-medium mt-1 ${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]'}`}>
              Listado paginado bajo demanda ({pageSize} usuarios/página) sin sondeo automático para ahorrar cuota.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-2 w-full md:w-auto">
            <button
              type="button"
              disabled={fetchingPage || searchingServer}
              onClick={() => {
                searchQueryCacheRef.current = {};
                pageCacheRef.current = {};
                pickerLastQueriedRef.current = '';
                setServerSearchState(null);
                setPickerPool({ users: [], nextCursorId: null, hasMore: false, loadedOnce: false });
                setPoolVersion((v) => v + 1);
                fetchUsersPage(1, { refreshCount: true, forceRemote: true });
                if (normalizedSearchTerm) {
                  runServerSearch({ term: searchTerm, appendMore: false, forceRefresh: true });
                }
              }}
              className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#014ba0] ${
                isDark
                  ? 'bg-[#1e293b] border-white/15 hover:bg-white/10 text-blue-200'
                  : 'bg-white border-[#2E4A70]/25 hover:bg-slate-50 text-[#1a2639]'
              }`}
              title="Recargar desde Firestore y limpiar caché local"
            >
              <RefreshCw className={`w-4 h-4 shrink-0 ${fetchingPage || searchingServer ? 'animate-spin' : ''}`} />
              <span>Actualizar</span>
            </button>

            <button
              type="button"
              onClick={() => router.push('/admin/users/create')}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] bg-[#014ba0] hover:bg-[#013b80] text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition-colors sm:order-last focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24B0BA]"
            >
              <UserPlus className="w-4 h-4 shrink-0" />
              <span>Nuevo</span>
            </button>

            {!isSelectionMode ? (
              <button
                type="button"
                onClick={() => setIsSelectionMode(true)}
                className={`col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#014ba0] ${
                  isDark
                    ? 'bg-[#1e293b] border-white/15 hover:bg-white/10 text-white'
                    : 'bg-white border-[#2E4A70]/25 hover:bg-slate-50 text-[#1a2639]'
                }`}
              >
                <ListChecks className="w-4 h-4 shrink-0" />
                <span>Selección Múltiple</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedUsersMap({});
                  setPickerQuery('');
                }}
                className={`col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#014ba0] ${
                  isDark
                    ? 'border-white/20 bg-white/5 hover:bg-white/10 text-slate-200'
                    : 'border-[#2E4A70]/25 bg-white hover:bg-slate-50 text-[#2E4A70]'
                }`}
              >
                <X className="w-4 h-4 shrink-0" />
                <span>Salir de selección</span>
              </button>
            )}
          </div>
        </header>

        {/* Aviso si hubo cuota agotada o error */}
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
              onClick={() => fetchUsersPage(currentPage, { refreshCount: false, forceRemote: true })}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer shrink-0"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Aviso de cuentas vencidas */}
        {expiredUsersCount > 0 && (
          <div
            className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm ${
              isDark
                ? 'bg-amber-900/20 border-amber-500/40 text-amber-300'
                : 'bg-amber-50 border-amber-300 text-amber-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
              <p className="font-medium">
                Hay <strong>{expiredUsersCount}</strong>{' '}
                {expiredUsersCount === 1 ? 'cuenta vencida / auto-desactivada' : 'cuentas vencidas / auto-desactivadas'} por cumplimiento de vigencia.
              </p>
            </div>
            {statusFilter !== 'expired' && (
              <button
                type="button"
                onClick={() => setStatusFilter('expired')}
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer ${
                  isDark
                    ? 'border-amber-400/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                    : 'border-amber-400 bg-white text-amber-900 hover:bg-amber-100'
                }`}
              >
                Ver vencidas
              </button>
            )}
          </div>
        )}

        {/* Toolbar de búsqueda y filtro */}
        <div className={`p-4 rounded-2xl border space-y-3 min-w-0 ${surfaceClass}`}>
          <form onSubmit={handleServerSearch} className="grid grid-cols-1 md:grid-cols-12 gap-2.5 min-w-0">
            <div className="relative md:col-span-8 flex gap-2 min-w-0">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, correo, teléfono o universidad..."
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
                title="Buscar inmediatamente en toda la colección"
                className={`px-3 py-2.5 rounded-xl border text-xs font-bold cursor-pointer shrink-0 transition-colors disabled:opacity-50 ${
                  isDark
                    ? 'border-[#24B0BA]/40 bg-[#24B0BA]/15 text-[#24B0BA] hover:bg-[#24B0BA]/25'
                    : 'border-[#014ba0]/25 bg-[#014ba0]/10 text-[#014ba0] hover:bg-[#014ba0]/15'
                }`}
              >
                {searchingServer ? 'Buscando...' : 'Buscar en BD'}
              </button>
            </div>

            <div className="md:col-span-4 min-w-0">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={selectColorScheme}
                className={`w-full min-w-0 max-w-full truncate px-3 py-2.5 rounded-xl border text-xs sm:text-sm font-semibold outline-none cursor-pointer ${inputClass}`}
              >
                <option value="all" className={optionClass}>Todos los estados</option>
                <option value="active" className={optionClass}>Solo activos</option>
                <option value="inactive" className={optionClass}>Solo inactivos</option>
                <option value="expired" className={optionClass}>Vencidos / Auto-desactivados</option>
                <option value="pago_unico" className={optionClass}>Con Pago Único</option>
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
                  ? 'Buscando coincidencias en toda la colección...'
                  : isShowingGlobalSearch
                  ? `${allSearchMatches.length} coincidencia(s)${activeServerResult?.matchesTruncated ? ' (primeras 150)' : ''} · explorados ${activeServerResult?.scannedCount || allSearchMatches.length} en BD · Pág. ${displayPage} de ${displayTotalPages}`
                  : isSearchMode
                  ? `${allSearchMatches.length} coincidencia(s) en páginas cargadas · Pág. ${displayPage} de ${displayTotalPages}`
                  : `Página ${displayPage} de ${displayTotalPages} · ${visibleUsers.length} usuarios visibles`}
              </span>
              {totalCount !== null && !isShowingGlobalSearch && !searchingServer && (
                <span className="opacity-70">· Total en filtro: {totalCount}</span>
              )}
              {isShowingGlobalSearch && activeServerResult?.hasMore && (
                <button
                  type="button"
                  disabled={searchingServer}
                  onClick={() => runServerSearch({ term: searchTerm, appendMore: true })}
                  className={`underline font-bold cursor-pointer ${
                    isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                  }`}
                >
                  Seguir buscando en BD (+1000)
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

        {/* Panel persistente de Selección Múltiple y Buscador en BD */}
        {isSelectionMode && (
          <div className={`p-3.5 sm:p-4 rounded-2xl border space-y-3.5 min-w-0 ${surfaceClass}`}>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs sm:text-sm font-black tabular-nums">
                  {selectedUsers.length} usuario(s) en tu lote
                </p>
                <p className={`text-[11px] font-medium ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  La selección se conserva aunque cambies de página o hagas nuevas búsquedas.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-stretch sm:items-center gap-2 w-full lg:w-auto">
                {visibleUsers.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className={`inline-flex items-center justify-center gap-1.5 min-h-[42px] sm:min-h-[38px] px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                      isDark
                        ? 'border-white/15 hover:bg-white/10 text-slate-200'
                        : 'border-[#2E4A70]/25 hover:bg-slate-50 text-[#1a2639]'
                    }`}
                  >
                    <ListChecks className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {allVisibleSelected
                        ? `Quitar página actual (${visibleUsers.length})`
                        : `Seleccionar página actual (${visibleUsers.length})`}
                    </span>
                  </button>
                )}
                {selectedUsers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedUsersMap({})}
                    className={`inline-flex items-center justify-center gap-1.5 min-h-[42px] sm:min-h-[38px] px-3.5 py-2 rounded-xl border text-xs font-bold text-red-500 cursor-pointer transition-colors ${
                      isDark ? 'border-red-500/30 hover:bg-red-500/10' : 'border-red-200 hover:bg-red-50'
                    }`}
                  >
                    <X className="w-3.5 h-3.5 shrink-0" />
                    <span>Vaciar lista</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={openBulkEditModal}
                  disabled={selectedUsers.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-45 transition-colors shadow-xs"
                >
                  <SlidersHorizontal className="w-4 h-4 shrink-0" />
                  <span>Editar en lote ({selectedUsers.length})</span>
                </button>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={selectedUsers.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer disabled:opacity-45 transition-colors"
                >
                  <Trash2 className="w-4 h-4 shrink-0" />
                  <span>Eliminar ({selectedUsers.length})</span>
                </button>
              </div>
            </div>

            {selectedUsersList.length > 0 && (
              <div
                className={`flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-2.5 rounded-xl border ${
                  isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0]/80 border-[#2E4A70]/15'
                }`}
              >
                {selectedUsersList.map((u) => (
                  <span
                    key={u.id}
                    className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs font-bold border max-w-full ${
                      isDark
                        ? 'bg-[#1e293b] border-white/15 text-slate-100'
                        : 'bg-white border-[#2E4A70]/20 text-[#1a2639]'
                    }`}
                  >
                    <span className="max-w-[180px] sm:max-w-[210px] truncate">{u.fullName || u.email}</span>
                    <button
                      type="button"
                      onClick={() => toggleSelectUser(u)}
                      aria-label={`Quitar a ${u.fullName || u.email}`}
                      className="w-6 h-6 inline-flex items-center justify-center rounded-full hover:bg-red-500/15 hover:text-red-500 cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Buscador rápido en BD para agregar usuarios directamente sin perder los anteriores */}
            <div
              className={`pt-3 border-t space-y-2.5 ${
                isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
              }`}
            >
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
                  <input
                    type="text"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handlePickerSearch({ appendMore: false });
                      }
                    }}
                    placeholder="Buscar en BD (nombre, correo o teléfono) para agregar al lote..."
                    style={selectColorScheme}
                    className={`w-full min-h-[44px] sm:min-h-[40px] pl-9 pr-9 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                  />
                  {pickerQuery && (
                    <button
                      type="button"
                      onClick={() => setPickerQuery('')}
                      aria-label="Limpiar búsqueda rápida"
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center rounded-lg opacity-60 hover:opacity-100 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:flex sm:items-center gap-2 w-full sm:w-auto shrink-0">
                  <button
                    type="button"
                    disabled={pickerSearching}
                    onClick={() => handlePickerSearch({ appendMore: false })}
                    className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer disabled:opacity-50 ${
                      isDark
                        ? 'border-[#24B0BA]/40 bg-[#24B0BA]/15 text-[#24B0BA] hover:bg-[#24B0BA]/25'
                        : 'border-[#014ba0]/25 bg-[#014ba0]/10 text-[#014ba0] hover:bg-[#014ba0]/15'
                    }`}
                  >
                    {pickerSearching ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5" />
                    )}
                    <span>{pickerSearching ? 'Buscando...' : 'Buscar en BD'}</span>
                  </button>
                  {pickerPool.hasMore && (
                    <button
                      type="button"
                      disabled={pickerSearching}
                      onClick={() => handlePickerSearch({ appendMore: true })}
                      className={`inline-flex items-center justify-center min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer disabled:opacity-50 ${
                        isDark ? 'border-white/15 hover:bg-white/10' : 'border-[#2E4A70]/25 hover:bg-slate-50'
                      }`}
                    >
                      {normalizedPickerQuery ? '+ Seguir buscando (+1000)' : '+ Cargar más (+50)'}
                    </button>
                  )}
                </div>
              </div>

              {normalizedPickerQuery && (
                <div className="space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <span className="font-semibold opacity-80 tabular-nums">
                      {pickerMatches.length} resultado(s)
                      {pickerPool.loadedOnce ? ` (escaneados ${pickerPool.users.length} en BD)` : ' en caché local'}
                    </span>
                    {pickerMatches.length > 0 && (
                      <button
                        type="button"
                        onClick={() => addUsersBatchToSelection(pickerMatches)}
                        className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] sm:min-h-[34px] px-3.5 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                          isDark
                            ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/25'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                        }`}
                      >
                        <Plus className="w-3.5 h-3.5 shrink-0" />
                        <span>Agregar todos los resultados ({pickerMatches.length})</span>
                      </button>
                    )}
                  </div>

                  {pickerMatches.length === 0 ? (
                    <p className="text-xs opacity-70">
                      Sin coincidencias en memoria. Pulsa <strong>Buscar en BD</strong> para consultar el siguiente lote.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-64 overflow-y-auto pr-1">
                      {pickerMatches.map((u) => {
                        const already = Boolean(selectedUsersMap[u.id]);
                        return (
                          <div
                            key={u.id}
                            className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl border text-xs ${
                              already
                                ? isDark
                                  ? 'bg-emerald-950/30 border-emerald-500/40'
                                  : 'bg-emerald-50 border-emerald-200'
                                : isDark
                                ? 'bg-[#162235] border-white/10'
                                : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="font-bold truncate">{u.fullName || 'Sin nombre'}</p>
                              <p className="text-[11px] opacity-75 truncate">{u.email}</p>
                              <div className="flex flex-wrap items-center gap-1 mt-1">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    u.active ? 'bg-green-500/15 text-green-600' : 'bg-red-500/15 text-red-500'
                                  }`}
                                >
                                  {u.active ? 'Activo' : 'Inactivo'}
                                </span>
                                {u.hasPagoUnicoAccess && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-500">
                                    Pago Único
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleSelectUser(u)}
                              className={`w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-1.5 min-h-[40px] sm:min-h-[34px] px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                                already
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  : 'bg-[#014ba0] hover:bg-[#013b80] text-white'
                              }`}
                            >
                              {already ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                              <span>{already ? 'En lote' : 'Agregar'}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Listado */}
        {visibleUsers.length === 0 ? (
          <div className={`text-center py-16 px-4 rounded-2xl border-2 border-dashed ${surfaceClass}`}>
            {searchingServer ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-[#24B0BA]" />
                <p className="text-sm font-bold opacity-80">
                  Buscando coincidencias en toda la lista de usuarios...
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm font-bold opacity-75">
                  {hasFilters
                    ? normalizedSearchTerm && !isShowingGlobalSearch && (currentPage > 1 || hasMore)
                      ? 'Buscando coincidencias en BD o pulsa "Buscar en BD".'
                      : isShowingGlobalSearch && activeServerResult?.hasMore
                      ? 'No se encontraron coincidencias en los registros explorados hasta ahora.'
                      : 'No se encontraron usuarios que coincidan con esos filtros.'
                    : 'No hay usuarios registrados.'}
                </p>
                {hasFilters && (
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    {normalizedSearchTerm && !isShowingGlobalSearch && (
                      <button
                        type="button"
                        disabled={searchingServer}
                        onClick={() => runServerSearch({ term: searchTerm, appendMore: false })}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                      >
                        <Search className="w-3.5 h-3.5" />
                        <span>Buscar en toda la BD</span>
                      </button>
                    )}
                    {isShowingGlobalSearch && activeServerResult?.hasMore && (
                      <button
                        type="button"
                        disabled={searchingServer}
                        onClick={() => runServerSearch({ term: searchTerm, appendMore: true })}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                      >
                        <Search className="w-3.5 h-3.5" />
                        <span>Seguir buscando en BD (+1000)</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#014ba0] text-white text-xs font-bold cursor-pointer"
                    >
                      Restablecer filtros
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {/* Móvil / Tableta (< lg): tarjetas responsivas */}
            <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleUsers.map((user) => {
                const isSelected = Boolean(selectedUsersMap[user.id]);
                return (
                  <div
                    key={user.id}
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
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectUser(user)}
                            className="w-4 h-4 mt-1 cursor-pointer accent-[#014ba0] shrink-0"
                            aria-label={`Seleccionar a ${user.fullName}`}
                          />
                        )}
                        <div className="min-w-0">
                          <p className="font-extrabold text-sm break-words">{user.fullName || 'Sin nombre'}</p>
                          <p className={`text-xs break-all ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                            {user.email}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(user)}
                        className={`px-2.5 py-1 text-[11px] font-extrabold rounded-full border cursor-pointer shrink-0 ${
                          user.active
                            ? isDark
                              ? 'bg-green-500/20 text-green-300 border-green-500/40'
                              : 'bg-green-50 text-green-700 border-green-200'
                            : isDark
                            ? 'bg-red-500/20 text-red-300 border-red-500/40'
                            : 'bg-red-50 text-red-700 border-red-200'
                        }`}
                      >
                        {user.active ? 'ACTIVO' : 'INACTIVO'}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {renderVigenciaBadge(user)}
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-semibold ${
                          user.hasPagoUnicoAccess
                            ? isDark
                              ? 'bg-green-500/15 text-green-300'
                              : 'bg-green-50 text-green-700'
                            : isDark
                            ? 'bg-white/5 text-slate-400'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {user.hasPagoUnicoAccess ? (
                          <CheckCircle className="w-3.5 h-3.5" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 opacity-60" />
                        )}
                        <span>Pago Único</span>
                      </span>
                    </div>

                    {user.telefono && (
                      <div className={`flex items-center gap-1.5 text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                        <Phone className="w-3.5 h-3.5 opacity-70 shrink-0" />
                        <span>{user.telefono}</span>
                      </div>
                    )}

                    <div
                      className={`pt-2 border-t flex items-center justify-end gap-2 ${
                        isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => router.push(`/admin/users/edit/${user.id}`)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#014ba0] text-white text-xs font-bold cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Editar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(user)}
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
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 cursor-pointer accent-[#014ba0]"
                          aria-label="Seleccionar página actual"
                        />
                      </th>
                    )}
                    {['Nombre', 'Correo', 'Estado', 'Vigencia', 'Pago Único', 'Teléfono', 'Acciones'].map((header) => (
                      <th
                        key={header}
                        className={`p-4 text-[11px] font-extrabold uppercase tracking-wider ${
                          isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                        }`}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-white/10 bg-[#1e293b]' : 'divide-[#2E4A70]/10 bg-white'}`}>
                  {visibleUsers.map((user) => (
                    <tr
                      key={user.id}
                      className={`transition-colors ${
                        selectedUsersMap[user.id]
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
                          <input
                            type="checkbox"
                            checked={Boolean(selectedUsersMap[user.id])}
                            onChange={() => toggleSelectUser(user)}
                            className="w-4 h-4 cursor-pointer accent-[#014ba0]"
                            aria-label={`Seleccionar a ${user.fullName}`}
                          />
                        </td>
                      )}
                      <td className="p-4 font-bold text-sm">{user.fullName || 'Sin nombre'}</td>
                      <td className={`p-4 text-xs sm:text-sm ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                        {user.email}
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(user)}
                          className={`cursor-pointer px-3 py-1 text-xs font-extrabold rounded-full border transition-transform hover:scale-105 ${
                            user.active
                              ? isDark
                                ? 'bg-green-500/20 text-green-300 border-green-500/40'
                                : 'bg-green-50 text-green-700 border-green-200'
                              : isDark
                              ? 'bg-red-500/20 text-red-300 border-red-500/40'
                              : 'bg-red-50 text-red-700 border-red-200'
                          }`}
                        >
                          {user.active ? 'ACTIVO' : 'INACTIVO'}
                        </button>
                      </td>
                      <td className="p-4 whitespace-nowrap">{renderVigenciaBadge(user)}</td>
                      <td className="p-4">
                        {user.hasPagoUnicoAccess ? (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-400 opacity-35" />
                        )}
                      </td>
                      <td className={`p-4 text-xs sm:text-sm whitespace-nowrap ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                        {user.telefono || '---'}
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => router.push(`/admin/users/edit/${user.id}`)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                              isDark ? 'text-[#24B0BA] hover:bg-white/10' : 'text-[#014ba0] hover:bg-[#014ba0]/10'
                            }`}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Editar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(user)}
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
                <label htmlFor="users-jump-page" className="font-semibold opacity-75 whitespace-nowrap">
                  Ir a pág.:
                </label>
                <input
                  id="users-jump-page"
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

      {/* Barra flotante inferior responsiva cuando hay usuarios seleccionados */}
      {isSelectionMode && selectedUsers.length > 0 && !bulkEditOpen && (
        <div className="sticky bottom-3 z-30 mt-4 w-full max-w-7xl mx-auto px-0.5">
          <div
            className={`p-3 sm:px-4 sm:py-3 rounded-2xl border shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${surfaceClass}`}
          >
            <div className="flex items-center justify-between gap-2 text-xs sm:text-sm font-black tabular-nums">
              <span>{selectedUsers.length} usuario(s) listo(s) para editar</span>
              <button
                type="button"
                onClick={() => setSelectedUsersMap({})}
                className="sm:hidden text-xs font-bold text-red-500 underline cursor-pointer"
              >
                Vaciar
              </button>
            </div>
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setSelectedUsersMap({})}
                className={`hidden sm:inline-flex items-center justify-center min-h-[40px] px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                  isDark ? 'border-white/15 hover:bg-white/10 text-slate-300' : 'border-[#2E4A70]/25 hover:bg-slate-50 text-[#2E4A70]'
                }`}
              >
                Vaciar
              </button>
              <button
                type="button"
                onClick={openBulkEditModal}
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer transition-colors"
              >
                <SlidersHorizontal className="w-4 h-4 shrink-0" />
                <span>Editar ({selectedUsers.length})</span>
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer transition-colors"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>Eliminar ({selectedUsers.length})</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edición Masiva de Usuarios */}
      {bulkEditOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-edit-users-title"
          onClick={() => !savingBulkEdit && setBulkEditOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <form
            onSubmit={handleBulkEditSubmit}
            onClick={(e) => e.stopPropagation()}
            style={selectColorScheme}
            className={`w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border shadow-2xl p-5 sm:p-6 space-y-5 ${surfaceClass}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="bulk-edit-users-title" className="text-lg sm:text-xl font-black flex items-center gap-2">
                  <SlidersHorizontal className="w-5 h-5 text-[#24B0BA]" />
                  <span>Edición Masiva de Usuarios</span>
                </h2>
                <p className={`text-xs mt-1 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  Se aplicarán únicamente los bloques que modifiques a{' '}
                  <strong className="tabular-nums">{selectedUsers.length}</strong> usuario(s) seleccionado(s).
                </p>
              </div>
              <button
                type="button"
                disabled={savingBulkEdit}
                onClick={() => setBulkEditOpen(false)}
                className="p-1.5 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Vista rápida de usuarios en el lote */}
            <div
              className={`p-3 rounded-2xl border flex flex-wrap gap-1.5 max-h-24 overflow-y-auto ${
                isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0]/80 border-[#2E4A70]/15'
              }`}
            >
              {selectedUsersList.map((u) => (
                <span
                  key={u.id}
                  className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-[11px] font-bold border ${
                    isDark
                      ? 'bg-[#1e293b] border-white/15 text-slate-100'
                      : 'bg-white border-[#2E4A70]/20 text-[#1a2639]'
                  }`}
                >
                  <span className="max-w-[160px] truncate">{u.fullName || u.email}</span>
                  {selectedUsersList.length > 1 && (
                    <button
                      type="button"
                      onClick={() => toggleSelectUser(u)}
                      className="p-0.5 rounded-full hover:bg-red-500/15 hover:text-red-500 cursor-pointer"
                      aria-label={`Quitar a ${u.fullName || u.email}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>

            {/* 1. Estado en el sistema */}
            <div
              className={`p-4 rounded-2xl border space-y-2.5 ${
                isDark ? 'bg-[#162235] border-white/10' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <label className="flex items-center gap-2 text-xs sm:text-sm font-extrabold">
                <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Estado de la cuenta en el sistema</span>
              </label>
              <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-2">
                {[
                  { key: 'unchanged', label: 'No modificar' },
                  { key: 'activate', label: 'Activar cuentas' },
                  { key: 'deactivate', label: 'Desactivar' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setBulkForm((p) => ({ ...p, activeMode: opt.key }))}
                    className={`inline-flex items-center justify-center text-center min-h-[44px] sm:min-h-[40px] px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                      bulkForm.activeMode === opt.key
                        ? opt.key === 'deactivate'
                          ? 'bg-red-600 border-red-600 text-white'
                          : opt.key === 'activate'
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-[#014ba0] border-[#014ba0] text-white'
                        : isDark
                        ? 'bg-[#1e293b] border-white/10 text-slate-300 hover:bg-white/10'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {bulkForm.activeMode === 'activate' && bulkForm.vigenciaMode === 'unchanged' && (
                <p className="text-[11px] text-amber-500 font-semibold">
                  Nota: Si alguna cuenta tenía fecha vencida y no cambias su vigencia abajo, puede volver a expirar al iniciar sesión.
                </p>
              )}
            </div>

            {/* 2. Acceso a Pago Único */}
            <div
              className={`p-4 rounded-2xl border space-y-2.5 ${
                isDark ? 'bg-[#162235] border-white/10' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <label className="flex items-center gap-2 text-xs sm:text-sm font-extrabold">
                <CheckCircle className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Acceso a Cursos de Pago Único</span>
              </label>
              <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-2">
                {[
                  { key: 'unchanged', label: 'No modificar' },
                  { key: 'grant', label: 'Conceder acceso' },
                  { key: 'revoke', label: 'Quitar acceso' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setBulkForm((p) => ({ ...p, pagoUnicoMode: opt.key }))}
                    className={`inline-flex items-center justify-center text-center min-h-[44px] sm:min-h-[40px] px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                      bulkForm.pagoUnicoMode === opt.key
                        ? opt.key === 'revoke'
                          ? 'bg-red-600 border-red-600 text-white'
                          : opt.key === 'grant'
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-[#014ba0] border-[#014ba0] text-white'
                        : isDark
                        ? 'bg-[#1e293b] border-white/10 text-slate-300 hover:bg-white/10'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Vigencia de la cuenta */}
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isDark ? 'bg-[#162235] border-white/10' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs sm:text-sm font-extrabold">
                  <CalendarClock className="w-4 h-4 text-[#24B0BA] shrink-0" />
                  <span>Vigencia de la cuenta (Hora Bolivia)</span>
                </label>
                {bulkVigenciaPreview && (
                  <span className="text-[11px] font-bold text-[#24B0BA] tabular-nums">
                    {bulkVigenciaPreview}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { key: 'unchanged', label: 'No modificar' },
                  { key: 'months', label: 'Por meses' },
                  { key: 'exact', label: 'Fecha exacta' },
                  { key: 'unlimited', label: 'Sin vencimiento' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setBulkForm((p) => ({ ...p, vigenciaMode: opt.key }))}
                    className={`inline-flex items-center justify-center text-center min-h-[44px] sm:min-h-[40px] px-2.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                      bulkForm.vigenciaMode === opt.key
                        ? 'bg-[#014ba0] border-[#014ba0] text-white'
                        : isDark
                        ? 'bg-[#1e293b] border-white/10 text-slate-300 hover:bg-white/10'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {bulkForm.vigenciaMode === 'months' && (
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 pt-1">
                  {['1', '3', '6', '12'].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setBulkForm((p) => ({ ...p, activeDurationMonths: m }))}
                      className={`inline-flex items-center justify-center min-h-[42px] sm:min-h-[36px] px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer ${
                        String(bulkForm.activeDurationMonths) === m
                          ? 'bg-[#24B0BA] border-[#24B0BA] text-[#0f172a]'
                          : isDark
                          ? 'bg-[#1e293b] border-white/15 text-slate-200'
                          : 'bg-white border-slate-300 text-slate-700'
                      }`}
                    >
                      {m} {m === '1' ? 'mes' : 'meses'}
                    </button>
                  ))}
                  <div className="col-span-2 sm:col-span-1 flex items-center gap-2">
                    <span className="text-xs font-semibold opacity-75">Otro (meses):</span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={bulkForm.activeDurationMonths}
                      onChange={(e) =>
                        setBulkForm((p) => ({ ...p, activeDurationMonths: e.target.value }))
                      }
                      style={selectColorScheme}
                      className={`flex-1 sm:w-20 min-h-[42px] sm:min-h-[36px] px-2.5 py-1.5 rounded-xl border text-xs font-bold outline-none tabular-nums ${inputClass}`}
                    />
                  </div>
                </div>
              )}

              {bulkForm.vigenciaMode === 'exact' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-bold mb-1 opacity-80">Fecha límite *</label>
                    <input
                      type="date"
                      required
                      value={bulkForm.exactDate}
                      onChange={(e) => setBulkForm((p) => ({ ...p, exactDate: e.target.value }))}
                      style={selectColorScheme}
                      className={`w-full min-h-[44px] sm:min-h-[40px] px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold mb-1 opacity-80">Hora límite (Bolivia)</label>
                    <input
                      type="time"
                      required
                      value={bulkForm.exactTime}
                      onChange={(e) => setBulkForm((p) => ({ ...p, exactTime: e.target.value }))}
                      style={selectColorScheme}
                      className={`w-full min-h-[44px] sm:min-h-[40px] px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none ${inputClass}`}
                    />
                  </div>
                </div>
              )}
            </div>

            <div
              className={`grid grid-cols-1 sm:flex sm:items-center sm:justify-end gap-2.5 pt-2 border-t ${
                isDark ? 'border-white/10' : 'border-slate-200'
              }`}
            >
              <button
                type="button"
                disabled={savingBulkEdit}
                onClick={() => setBulkEditOpen(false)}
                className={`w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer order-2 sm:order-1 ${
                  isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-100'
                }`}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingBulkEdit || !bulkHasChanges || selectedUsers.length === 0}
                className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-50 order-1 sm:order-2"
              >
                {savingBulkEdit ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Aplicando cambios...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Aplicar a {selectedUsers.length} usuario(s)</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
