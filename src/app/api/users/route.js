import { db } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import { isAccountExpired } from '@/lib/accountExpiration';
import {
  USER_SEARCH_SELECT_FIELDS,
  getCachedUsersSearchPool,
  invalidateUsersSearchCache,
  matchesUserSearchTerm,
  normalizeUsersSearchText,
  setCachedUsersSearchPool,
  userMatchesStatusFilter,
} from '@/lib/usersSearchCache';

function formatDate(field) {
  if (field?.toDate) {
    return field.toDate().toISOString().split('T')[0];
  }
  if (typeof field === 'string') {
    return field;
  }
  return '';
}

function isQuotaError(error) {
  return (
    error?.code === 8 ||
    error?.code === 'resource-exhausted' ||
    /quota exceeded|resource_exhausted/i.test(error?.message || '')
  );
}

function mapUserDoc(docSnap, nowMs, nowIso, expiredUpdates = null) {
  const data = docSnap.data();
  const isExpiredNow = data.active === true && isAccountExpired(data, nowMs);

  if (isExpiredNow && Array.isArray(expiredUpdates)) {
    expiredUpdates.push(docSnap.ref);
  }

  return {
    id: docSnap.id,
    ...data,
    active: isExpiredNow ? false : data.active,
    expiredAt: isExpiredNow ? nowIso : data.expiredAt || null,
    deactivatedReason: isExpiredNow ? 'expired' : data.deactivatedReason || null,
    fechaSuscripcion: formatDate(data.fechaSuscripcion),
    fechaVencimiento: formatDate(data.fechaVencimiento),
  };
}

async function commitExpiredUpdates(expiredUpdates, nowIso) {
  if (expiredUpdates.length === 0) return;
  const CHUNK_SIZE = 450;
  for (let i = 0; i < expiredUpdates.length; i += CHUNK_SIZE) {
    const batch = db.batch();
    expiredUpdates.slice(i, i + CHUNK_SIZE).forEach((ref) => {
      batch.update(ref, {
        active: false,
        expiredAt: nowIso,
        deactivatedReason: 'expired',
      });
    });
    await batch.commit();
  }
}

function applyStatusFilter(baseCollection, status) {
  if (status === 'active') return baseCollection.where('active', '==', true);
  if (status === 'inactive') return baseCollection.where('active', '==', false);
  if (status === 'expired') return baseCollection.where('deactivatedReason', '==', 'expired');
  if (status === 'pago_unico') return baseCollection.where('hasPagoUnicoAccess', '==', true);
  return baseCollection;
}

export async function GET(request) {
  try {
    if (!db) {
      console.error('Firebase Admin DB no está inicializado. Verifica las variables de entorno.');
      return NextResponse.json({ error: 'Error de configuración del servidor' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const isPaginated = searchParams.get('paginated') === '1';

    // Compatibilidad con vistas heredadas que aún solicitan /api/users sin parámetros (acotado a 50 máx.)
    if (!isPaginated) {
      const snapshot = await db.collection('users').limit(50).get();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const expiredUpdates = [];

      const users = snapshot.docs.map((docSnap) => mapUserDoc(docSnap, nowMs, nowIso, expiredUpdates));
      await commitExpiredUpdates(expiredUpdates, nowIso);
      return NextResponse.json(users);
    }

    const action = searchParams.get('action') || 'page';
    const status = searchParams.get('status') || 'all';
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '25', 10) || 25));
    const pagesToFetch = Math.min(2, Math.max(1, parseInt(searchParams.get('pagesToFetch') || '1', 10) || 1));
    const afterId = (searchParams.get('afterId') || '').trim();
    const includeCounts = searchParams.get('includeCounts') === '1';

    const usersCol = db.collection('users');
    const filteredQuery = applyStatusFilter(usersCol, status);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiredUpdates = [];

    // Modo 1: Estadísticas globales con agregación .count() (3 lecturas vs toda la colección)
    if (action === 'stats') {
      const [totalSnap, premiumSnap, pagoUnicoSnap] = await Promise.all([
        usersCol.count().get(),
        usersCol.where('isPremium', '==', true).count().get(),
        usersCol.where('hasPagoUnicoAccess', '==', true).count().get(),
      ]);

      return NextResponse.json({
        total: totalSnap.data().count,
        premium: premiumSnap.data().count,
        pagoUnico: pagoUnicoSnap.data().count,
      });
    }

    // Modo 2: Un solo usuario por ID para vista de edición (1 lectura vs toda la colección)
    if (action === 'single') {
      const targetUserId = (searchParams.get('userId') || '').trim();
      if (!targetUserId) {
        return NextResponse.json({ error: 'userId es requerido' }, { status: 400 });
      }
      const userSnap = await usersCol.doc(targetUserId).get();
      if (!userSnap.exists) {
        return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
      }
      const mappedUser = mapUserDoc(userSnap, nowMs, nowIso, expiredUpdates);
      await commitExpiredUpdates(expiredUpdates, nowIso);
      return NextResponse.json({ user: mappedUser });
    }

    let startAfterSnap = null;
    if (afterId) {
      const cursorSnap = await usersCol.doc(afterId).get();
      if (cursorSnap.exists) {
        startAfterSnap = cursorSnap;
      }
    }

    if (action === 'search') {
      const rawQuery = (searchParams.get('q') || '').trim();
      const normalizedQ = normalizeUsersSearchText(rawQuery);
      const forceRefresh = searchParams.get('refresh') === '1';

      if (forceRefresh) {
        invalidateUsersSearchCache();
      }

      const SEARCH_BATCH_SIZE = normalizedQ ? 200 : 50;
      const MAX_SCAN_PER_REQUEST = normalizedQ ? 1000 : 50;
      const MAX_CACHE_DOCS = 3000;
      const MAX_RETURNED_MATCHES = 150;

      const scanWindow = async (cursorDoc) => {
        const windowUsers = [];
        let rawCursor = cursorDoc;
        let rawScanned = 0;
        let hasMore = false;

        while (rawScanned < MAX_SCAN_PER_REQUEST) {
          const batchLimit = Math.min(SEARCH_BATCH_SIZE, MAX_SCAN_PER_REQUEST - rawScanned);
          let qRef = filteredQuery.select(...USER_SEARCH_SELECT_FIELDS);
          if (rawCursor) qRef = qRef.startAfter(rawCursor);
          qRef = qRef.limit(batchLimit);

          const snap = await qRef.get();
          if (snap.empty) {
            hasMore = false;
            break;
          }

          for (const docSnap of snap.docs) {
            const mapped = mapUserDoc(docSnap, nowMs, nowIso, null);
            if (mapped.role !== 'admin') {
              windowUsers.push(mapped);
            }
          }

          rawScanned += snap.docs.length;
          rawCursor = snap.docs[snap.docs.length - 1];

          if (snap.docs.length < batchLimit) {
            hasMore = false;
            break;
          }
          hasMore = true;
        }

        return {
          windowUsers,
          nextCursorId: hasMore && rawCursor ? rawCursor.id : null,
          hasMore,
          rawScanned,
        };
      };

      // Modo sin término (por ej. botón rápido de selección): lote acotado de 50 sin contaminar caché global
      if (!normalizedQ) {
        const { windowUsers, nextCursorId, hasMore } = await scanWindow(startAfterSnap);
        return NextResponse.json({
          users: windowUsers,
          totalMatches: windowUsers.length,
          matchesTruncated: false,
          nextCursorId,
          hasMore,
          scannedCount: windowUsers.length,
          fromCache: false,
        });
      }

      let poolUsers = null;
      let nextCursorId = null;
      let hasMore = false;
      let scannedCount = 0;
      let fromCache = false;

      if (!afterId) {
        let cached = getCachedUsersSearchPool(status);
        if (!cached && status !== 'all') {
          const allCached = getCachedUsersSearchPool('all');
          if (allCached && !allCached.hasMore) {
            const filteredFromAll = allCached.users.filter((u) =>
              userMatchesStatusFilter(u, status, nowMs)
            );
            setCachedUsersSearchPool(status, {
              users: filteredFromAll,
              nextCursorId: null,
              hasMore: false,
              scannedCount: filteredFromAll.length,
            });
            cached = getCachedUsersSearchPool(status);
          }
        }

        if (cached) {
          poolUsers = cached.users;
          nextCursorId = cached.nextCursorId;
          hasMore = cached.hasMore;
          scannedCount = cached.scannedCount || cached.users.length;
          fromCache = true;
        } else {
          const scanned = await scanWindow(null);
          poolUsers = scanned.windowUsers;
          nextCursorId = scanned.nextCursorId;
          hasMore = scanned.hasMore;
          scannedCount = scanned.windowUsers.length;
          setCachedUsersSearchPool(status, {
            users: poolUsers,
            nextCursorId,
            hasMore,
            scannedCount,
          });
        }
      } else {
        const scanned = await scanWindow(startAfterSnap);
        const existingPool = getCachedUsersSearchPool(status);
        if (existingPool && existingPool.users.length < MAX_CACHE_DOCS) {
          const merged = [...existingPool.users];
          const seenIds = new Set(merged.map((u) => u.id));
          for (const u of scanned.windowUsers) {
            if (!seenIds.has(u.id)) {
              seenIds.add(u.id);
              merged.push(u);
            }
          }
          setCachedUsersSearchPool(status, {
            users: merged,
            nextCursorId: scanned.nextCursorId,
            hasMore: scanned.hasMore,
            scannedCount: merged.length,
          });
          poolUsers = merged;
          scannedCount = merged.length;
        } else {
          poolUsers = scanned.windowUsers;
          scannedCount = (existingPool?.scannedCount || 0) + scanned.windowUsers.length;
        }
        nextCursorId = scanned.nextCursorId;
        hasMore = scanned.hasMore;
      }

      const matched = [];
      const seenMatchedIds = new Set();
      for (const u of poolUsers) {
        if (
          userMatchesStatusFilter(u, status, nowMs) &&
          matchesUserSearchTerm(u, normalizedQ) &&
          !seenMatchedIds.has(u.id)
        ) {
          seenMatchedIds.add(u.id);
          matched.push(u);
        }
      }

      // Fast-path directo por correo o UID exacto cuando la BD excede el límite escaneado y aún hay más docs
      if (!afterId && hasMore && matched.length === 0) {
        try {
          if (rawQuery.includes('@') && !rawQuery.startsWith('@') && !rawQuery.includes(' ')) {
            const lowerEmail = rawQuery.toLowerCase();
            const emailSnap = await usersCol
              .where('email', '>=', lowerEmail)
              .where('email', '<=', `${lowerEmail}\uf8ff`)
              .select(...USER_SEARCH_SELECT_FIELDS)
              .limit(15)
              .get();
            for (const docSnap of emailSnap.docs) {
              const mapped = mapUserDoc(docSnap, nowMs, nowIso, null);
              if (
                mapped.role !== 'admin' &&
                userMatchesStatusFilter(mapped, status, nowMs) &&
                matchesUserSearchTerm(mapped, normalizedQ) &&
                !seenMatchedIds.has(mapped.id)
              ) {
                seenMatchedIds.add(mapped.id);
                matched.push(mapped);
              }
            }
          } else if (/^[a-zA-Z0-9_-]{18,48}$/.test(rawQuery)) {
            const uidSnap = await usersCol.doc(rawQuery).get();
            if (uidSnap.exists) {
              const mapped = mapUserDoc(uidSnap, nowMs, nowIso, null);
              if (
                mapped.role !== 'admin' &&
                userMatchesStatusFilter(mapped, status, nowMs) &&
                !seenMatchedIds.has(mapped.id)
              ) {
                seenMatchedIds.add(mapped.id);
                matched.push(mapped);
              }
            }
          }
        } catch (fastErr) {
          console.warn('Fast-path search fallback:', fastErr?.message || fastErr);
        }
      }

      return NextResponse.json({
        users: matched.slice(0, MAX_RETURNED_MATCHES),
        totalMatches: matched.length,
        matchesTruncated: matched.length > MAX_RETURNED_MATCHES,
        nextCursorId,
        hasMore,
        scannedCount,
        fromCache,
      });
    }

    // action === 'page': trae páginas exactas (con 1 lectura extra de sonda para hasMore)
    const targetNonAdminCount = pagesToFetch * pageSize + 1;
    const collected = [];
    let rawCursor = startAfterSnap;
    let exhausted = false;
    let guardLoops = 0;

    while (collected.length < targetNonAdminCount && !exhausted && guardLoops < 2) {
      const needed = targetNonAdminCount - collected.length;
      const askLimit = Math.min(50, needed + (status === 'all' ? 2 : 0));
      let q = filteredQuery;
      if (rawCursor) q = q.startAfter(rawCursor);
      q = q.limit(askLimit);

      const snap = await q.get();
      if (snap.empty) {
        exhausted = true;
        break;
      }

      for (const docSnap of snap.docs) {
        const mapped = mapUserDoc(docSnap, nowMs, nowIso, expiredUpdates);
        if (mapped.role !== 'admin') {
          collected.push(mapped);
        }
      }

      rawCursor = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < askLimit) {
        exhausted = true;
      }
      guardLoops += 1;
    }

    await commitExpiredUpdates(expiredUpdates, nowIso);

    const pages = [];
    for (let i = 0; i < pagesToFetch; i += 1) {
      const start = i * pageSize;
      const items = collected.slice(start, start + pageSize);
      if (items.length === 0) {
        if (i === 0) {
          pages.push({ items: [], endCursorId: null, hasMore: false });
        }
        break;
      }
      const hasMoreAfterSlice = collected.length > start + pageSize || !exhausted;
      pages.push({
        items,
        endCursorId: items[items.length - 1].id,
        hasMore: hasMoreAfterSlice,
      });
    }

    let totalCount = null;
    let expiredCount = null;

    if (includeCounts) {
      try {
        const [rawTotalSnap, expiredSnap, adminCountSnap] = await Promise.all([
          filteredQuery.count().get().catch(() => null),
          usersCol.where('deactivatedReason', '==', 'expired').count().get().catch(() => null),
          status === 'all'
            ? usersCol.where('role', '==', 'admin').count().get().catch(() => null)
            : Promise.resolve(null),
        ]);

        if (rawTotalSnap) {
          const adminOffset = adminCountSnap ? adminCountSnap.data().count : 0;
          totalCount = Math.max(0, rawTotalSnap.data().count - adminOffset);
        }
        if (expiredSnap) {
          expiredCount = expiredSnap.data().count;
        }
      } catch {
        // Si falla la agregación puntual, no bloquea la entrega de la página
      }
    }

    return NextResponse.json({
      pages,
      totalCount,
      expiredCount,
    });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    if (isQuotaError(error)) {
      return NextResponse.json(
        {
          error: 'Se alcanzó temporalmente la cuota diaria de lecturas de Firestore.',
          code: 'resource-exhausted',
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: 'Error interno al obtener usuarios' }, { status: 500 });
  }
}
