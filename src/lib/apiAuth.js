import { NextResponse } from 'next/server';
import { auth as adminAuth, db as adminDb } from '@/lib/firebase-admin';
import { isAccountExpired } from '@/lib/accountExpiration';

const USER_AUTH_CACHE_TTL_MS = 60 * 1000; // 60 segundos por uid para evitar lecturas en ráfaga (PDFs / horarios)
const userAuthMemoryCache = new Map();

export function invalidateUserAuthCache(uid) {
  if (!uid) {
    userAuthMemoryCache.clear();
    return;
  }
  userAuthMemoryCache.delete(String(uid));
}

function getCachedUserDoc(uid) {
  const entry = userAuthMemoryCache.get(uid);
  if (!entry) return null;
  if (Date.now() - entry.ts >= USER_AUTH_CACHE_TTL_MS) {
    userAuthMemoryCache.delete(uid);
    return null;
  }
  return entry.userData;
}

function setCachedUserDoc(uid, userData) {
  if (!uid || !userData) return;
  if (userAuthMemoryCache.size > 500) {
    const oldestKey = userAuthMemoryCache.keys().next().value;
    if (oldestKey) userAuthMemoryCache.delete(oldestKey);
  }
  userAuthMemoryCache.set(uid, { ts: Date.now(), userData });
}

/**
 * Verifica la sesión del usuario mediante Bearer token o cookie `__session` de Firebase.
 * Valida rol `'admin'`, cuenta activa (`active === true`), vigencia y `hasPagoUnicoAccess`.
 *
 * @param {Request} request
 * @param {Object} [options]
 * @param {boolean} [options.requireAdmin=false]
 * @param {boolean} [options.requirePagoUnico=false]
 * @returns {Promise<{ ok: true, uid: string, email: string, role: string, isAdmin: boolean, userData: Object|null } | { ok: false, response: NextResponse }>}
 */
export async function verifySessionUser(
  request,
  { requireAdmin = false, requirePagoUnico = false } = {}
) {
  try {
    if (!adminAuth || !adminDb) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Servidor no inicializado (Firebase Admin).' },
          { status: 500 }
        ),
      };
    }

    const authHeader = request.headers.get('authorization');
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const cookieToken = request.cookies?.get('__session')?.value || null;
    const token = headerToken || cookieToken;

    if (!token) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'No autenticado.' }, { status: 401 }),
      };
    }

    const decoded = await adminAuth.verifyIdToken(token, false);
    const uid = decoded.uid;
    const email = decoded.email || '';
    const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'admin@admin.com';

    if (email === adminEmail || decoded.role === 'admin') {
      return {
        ok: true,
        uid,
        email,
        role: 'admin',
        isAdmin: true,
        userData: null,
      };
    }

    let userData = getCachedUserDoc(uid);
    if (!userData) {
      const userSnap = await adminDb.collection('users').doc(uid).get();
      if (!userSnap.exists) {
        return {
          ok: false,
          response: NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 }),
        };
      }
      userData = userSnap.data();
      setCachedUserDoc(uid, userData);
    }
    const isUserAdmin = userData.rol === 'admin' || userData.role === 'admin';

    if (isUserAdmin) {
      return {
        ok: true,
        uid,
        email,
        role: 'admin',
        isAdmin: true,
        userData,
      };
    }

    if (requireAdmin) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Acceso restringido a administradores.' },
          { status: 403 }
        ),
      };
    }

    if (userData.active !== true || isAccountExpired(userData)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Tu cuenta se encuentra inactiva o vencida.' },
          { status: 403 }
        ),
      };
    }

    if (requirePagoUnico && !userData.hasPagoUnicoAccess) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Requiere acceso habilitado a Cursos de Pago Único.' },
          { status: 403 }
        ),
      };
    }

    return {
      ok: true,
      uid,
      email,
      role: userData.rol || userData.role || 'user',
      isAdmin: false,
      userData,
    };
  } catch (error) {
    console.error('Error verificando sesión en API:', error);
    return {
      ok: false,
      response: NextResponse.json({ error: 'Sesión inválida o expirada.' }, { status: 401 }),
    };
  }
}
