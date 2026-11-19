// src/app/api/toggle-active/route.js
import { NextResponse } from 'next/server';
// CORRECCIÓN: Se importa 'db' desde el archivo correcto 'firebaseAdmin.js'
import { db } from '@/lib/firebase-admin';
import { buildExpirationFields, isAccountExpired } from '@/lib/accountExpiration';
import { invalidateUserAuthCache } from '@/lib/apiAuth';
import { invalidateUsersSearchCache } from '@/lib/usersSearchCache';

export async function POST(req) {
  try {
    if (!db) {
      console.error("Firebase Admin DB no inicializada.");
      return NextResponse.json({ error: 'Configuración del servidor incompleta (Firebase DB)' }, { status: 500 });
    }
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID es requerido' }, { status: 400 });
    }

    // CORRECCIÓN: Se usa 'db' en lugar del inexistente 'dbAdmin'
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }

    // Si se reactiva una cuenta que estaba vencida, renovar su vigencia automáticamente (por defecto 3 meses)
    const userData = userSnap.data();
    const currentStatus = userData.active || false;
    const nextActive = !currentStatus;
    const updatePayload = { active: nextActive };

    if (nextActive) {
      updatePayload.expiredAt = null;
      updatePayload.deactivatedReason = null;
      // Si la cuenta estaba vencida o nunca tuvo vigencia configurada, iniciar 3 meses desde hoy
      if (isAccountExpired(userData) || userData.activeUntil === undefined) {
        const renewed = buildExpirationFields({
          durationType: 'months',
          activeDurationMonths: userData.activeDurationMonths || 3,
        });
        updatePayload.activeFrom = renewed.activeFrom;
        updatePayload.activeUntil = renewed.activeUntil;
        updatePayload.activeDurationMonths = renewed.activeDurationMonths;
      }
    }

    await userRef.update(updatePayload);
    invalidateUserAuthCache(userId);
    invalidateUsersSearchCache();

    return NextResponse.json({
      message: `Usuario ${!currentStatus ? 'activado' : 'desactivado'} correctamente`,
      updatedFields: updatePayload,
    });
  } catch (error) {
    console.error('Error en toggle-active:', error);
    return NextResponse.json({ error: 'Error interno del servidor', details: error.message }, { status: 500 });
  }
}
