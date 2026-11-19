import { NextResponse } from 'next/server';
import { auth as adminAuth, db } from '@/lib/firebase-admin';
import { isAccountExpired } from '@/lib/accountExpiration';
import { invalidateUserAuthCache } from '@/lib/apiAuth';

/**
 * Verifica si la sesión activa corresponde a un usuario vigente.
 * Si su `activeUntil` venció, desactiva la cuenta en Firestore y expira las cookies de sesión.
 */
export async function POST(request) {
  try {
    if (!adminAuth || !db) {
      return NextResponse.json({ error: 'Servidor no inicializado (Firebase)' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization');
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const cookieToken = request.cookies.get('__session')?.value || null;
    const token = headerToken || cookieToken;

    if (!token) {
      return NextResponse.json({ expired: false, active: false }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token, false);
    const uid = decodedToken.uid;
    const email = decodedToken.email;
    const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'admin@admin.com';

    if (email === adminEmail || decodedToken.role === 'admin') {
      return NextResponse.json({ expired: false, active: true, role: 'admin' });
    }

    const userDocRef = db.collection('users').doc(uid);
    const userDocSnap = await userDocRef.get();

    if (!userDocSnap.exists) {
      return NextResponse.json({ expired: false, active: false }, { status: 404 });
    }

    const userData = userDocSnap.data();
    const expiredByDate = isAccountExpired(userData);

    if (expiredByDate && userData.active !== false) {
      await userDocRef.update({
        active: false,
        expiredAt: new Date().toISOString(),
        deactivatedReason: 'expired',
      });
      invalidateUserAuthCache(uid);
    }

    if (expiredByDate || userData.active !== true) {
      const isProduction = process.env.NODE_ENV === 'production';
      const response = NextResponse.json(
        {
          expired: expiredByDate || userData.deactivatedReason === 'expired',
          active: false,
          deactivatedReason: expiredByDate ? 'expired' : (userData.deactivatedReason || 'inactive'),
        },
        { status: 200 }
      );
      response.cookies.set('__session', '', {
        httpOnly: true,
        secure: isProduction,
        path: '/',
        maxAge: 0,
        sameSite: 'Strict',
      });
      response.cookies.set('role', '', {
        httpOnly: false,
        secure: isProduction,
        path: '/',
        maxAge: 0,
        sameSite: 'Strict',
      });
      return response;
    }

    return NextResponse.json({
      expired: false,
      active: true,
      activeUntil: userData.activeUntil || null,
    });
  } catch (error) {
    console.error('Error en check-expiration:', error);
    return NextResponse.json({ error: 'No se pudo verificar la vigencia' }, { status: 500 });
  }
}
