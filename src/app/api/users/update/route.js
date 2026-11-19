// src/app/api/users/update/route.js
import { NextResponse } from 'next/server';
import { auth as adminAuth, db } from '@/lib/firebase-admin';
import { invalidateUserAuthCache } from '@/lib/apiAuth';
import { invalidateUsersSearchCache } from '@/lib/usersSearchCache';

export async function POST(req) {
  try {
    if (!db || !adminAuth) {
      return NextResponse.json({ error: 'Servidor no inicializado (Firebase)' }, { status: 500 });
    }

    const { userId, password, id, ...userData } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID es requerido' }, { status: 400 });
    }

    // Si se proporcionó una nueva contraseña, actualizarla en Firebase Auth (sin guardarla en Firestore)
    if (typeof password === 'string' && password.trim() !== '') {
      const cleanPassword = password.trim();
      if (cleanPassword.length < 6) {
        return NextResponse.json(
          { error: 'La nueva contraseña debe tener al menos 6 caracteres.' },
          { status: 400 }
        );
      }
      await adminAuth.updateUser(userId, { password: cleanPassword });
    }

    // Limpiar marcas de expiración si se reactiva la cuenta
    if (userData.active === true) {
      userData.expiredAt = null;
      userData.deactivatedReason = null;
    }

    const userRef = db.collection('users').doc(userId);
    await userRef.update(userData);
    invalidateUserAuthCache(userId);
    invalidateUsersSearchCache();

    return NextResponse.json({ message: 'Usuario actualizado correctamente' }, { status: 200 });
  } catch (error) {
    console.error('Error al actualizar el usuario:', error);
    return NextResponse.json({ error: 'No se pudo actualizar el usuario', details: error.message }, { status: 500 });
  }
}
