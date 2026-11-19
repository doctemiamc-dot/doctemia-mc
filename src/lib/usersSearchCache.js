import { isAccountExpired } from '@/lib/accountExpiration';

const USERS_SEARCH_CACHE_TTL_MS = 90 * 1000;
const MAX_CACHED_STATUS_POOLS = 8;

const usersSearchMemoryCache = new Map();

export const USER_SEARCH_SELECT_FIELDS = [
  'fullName',
  'name',
  'displayName',
  'email',
  'telefono',
  'universidad',
  'profesion',
  'role',
  'rol',
  'active',
  'hasPagoUnicoAccess',
  'activeFrom',
  'activeUntil',
  'activeDurationMonths',
  'expiredAt',
  'deactivatedReason',
  'isPremium',
  'fechaSuscripcion',
  'fechaVencimiento',
];

export function normalizeUsersSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function matchesUserSearchTerm(user, normalizedTerm) {
  if (!normalizedTerm) return true;
  const haystack = normalizeUsersSearchText(
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

export function userMatchesStatusFilter(user, status, nowMs = Date.now()) {
  if (!status || status === 'all') return true;
  const effectiveExpired = user.active === true && isAccountExpired(user, nowMs);
  const effectiveActive = user.active === true && !effectiveExpired;

  if (status === 'active') return effectiveActive;
  if (status === 'inactive') return user.active === false || effectiveExpired;
  if (status === 'expired') return user.deactivatedReason === 'expired' || effectiveExpired;
  if (status === 'pago_unico') return user.hasPagoUnicoAccess === true;
  return true;
}

export function getCachedUsersSearchPool(status = 'all') {
  const key = String(status || 'all');
  const entry = usersSearchMemoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts >= USERS_SEARCH_CACHE_TTL_MS) {
    usersSearchMemoryCache.delete(key);
    return null;
  }
  return entry;
}

export function setCachedUsersSearchPool(status = 'all', payload) {
  const key = String(status || 'all');
  if (usersSearchMemoryCache.size >= MAX_CACHED_STATUS_POOLS && !usersSearchMemoryCache.has(key)) {
    const oldestKey = usersSearchMemoryCache.keys().next().value;
    if (oldestKey) usersSearchMemoryCache.delete(oldestKey);
  }
  usersSearchMemoryCache.set(key, {
    ts: Date.now(),
    users: Array.isArray(payload?.users) ? payload.users : [],
    nextCursorId: payload?.nextCursorId || null,
    hasMore: Boolean(payload?.hasMore),
    scannedCount: Number(payload?.scannedCount || 0),
  });
}

export function invalidateUsersSearchCache() {
  usersSearchMemoryCache.clear();
}
