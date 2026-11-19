// src/app/api/login/route.js
import { NextResponse } from 'next/server';
import { auth as adminAuth, db } from '@/lib/firebase-admin';
import { isAccountExpired } from '@/lib/accountExpiration';

export async function POST(request) {
  try {
    if (!adminAuth || !db) {
      return NextResponse.json({ error: 'Servidor no inicializado (Firebase)' }, { status: 500 });
    }

    const { token } = await request.json();
    if (!token) {
      return NextResponse.json({ error: 'Token no proporcionado' }, { status: 400 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token, true);
    const uid = decodedToken.uid;
    const email = decodedToken.email;
    const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'admin@admin.com';

    let role = 'user';

    if (email === adminEmail) {
      role = 'admin';
    } else {
      const userDocRef = db.collection('users').doc(uid);
      const userDocSnap = await userDocRef.get();

      if (!userDocSnap.exists) {
        return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
      }

      const userData = userDocSnap.data();
      if (userData.active !== true) {
        const msg = userData.deactivatedReason === 'expired'
          ? 'Tu periodo activo ha vencido. Contacta al administrador para renovar tu acceso.'
          : 'Cuenta inactiva';
        return NextResponse.json({ error: msg }, { status: 403 });
      }

      if (isAccountExpired(userData)) {
        await userDocRef.update({
          active: false,
          expiredAt: new Date().toISOString(),
          deactivatedReason: 'expired',
        });
        return NextResponse.json(
          { error: 'Tu periodo activo ha vencido. Contacta al administrador para renovar tu acceso.' },
          { status: 403 }
        );
      }

      role = decodedToken.role || userData.rol || 'user';
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const response = NextResponse.json({ ok: true, role: role }, { status: 200 });
    
    response.cookies.set('__session', token, {
      httpOnly: true,
      secure: isProduction,
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
      sameSite: 'Strict',
    });

    response.cookies.set('role', role, {
      httpOnly: false,
      secure: isProduction,
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
      sameSite: 'Strict',
    });

    return response;

  } catch (error) {
    console.error('Error detallado en login:', error);
    
    let errorMessage = 'Error interno del servidor.';
    let status = 500;

    const errorCode = error.code ? String(error.code) : '';

    if (errorCode === 'auth/id-token-expired') {
        errorMessage = 'La sesión ha expirado.';
        status = 401;
    } else if (errorCode.includes('auth/invalid') || errorCode === 'auth/argument-error') {
        errorMessage = 'Token inválido.';
        status = 401;
    } else if (errorCode === '8' || error.message?.includes('Quota exceeded')) {
        errorMessage = 'Límite de cuota de Firebase excedido.';
        status = 429;
    }

    return NextResponse.json({ 
      error: errorMessage, 
      details: error.message,
      code: errorCode 
    }, { status });
  }
}
