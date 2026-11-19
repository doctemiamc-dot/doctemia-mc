import { NextResponse } from 'next/server';
import { auth, db } from '@/lib/firebase-admin';
import { buildExpirationFields } from '@/lib/accountExpiration';
import { invalidateUsersSearchCache } from '@/lib/usersSearchCache';

export async function POST(request) {
  let createdUserRecord = null;
  
  try {
    if (!auth || !db) {
      return NextResponse.json({ error: 'Servidor no inicializado (Firebase)' }, { status: 500 });
    }

    const body = await request.json();
    let {
      fullName,
      fechaNacimiento,
      sexo,
      telefono,
      universidad,
      profesion,
      fechaExamen,
      email,
      password,
      rol,
      durationType,
      activeDurationMonths,
      exactDate,
      activeUntil,
    } = body;

    // Normalizar email
    const normalizedEmail = email?.trim().toLowerCase();

    // 1. Intentar crear el usuario en Firebase Authentication
    try {
      createdUserRecord = await auth.createUser({
        email: normalizedEmail,
        password,
        displayName: fullName,
      });
    } catch (authError) {
      // Si el error es que ya existe, intentamos obtener el usuario existente
      if (authError.code === 'auth/email-already-exists') {
        console.log(`El usuario ${normalizedEmail} ya existe en Auth. Verificando Firestore...`);
        createdUserRecord = await auth.getUserByEmail(normalizedEmail);
      } else {
        throw authError;
      }
    }

    // 2. Calcular vigencia de la cuenta (por defecto 3 meses para usuarios nuevos)
    let expirationFields;
    if (rol === 'admin') {
      expirationFields = { activeDurationMonths: null, activeFrom: null, activeUntil: null };
    } else if (activeUntil !== undefined) {
      expirationFields = {
        activeDurationMonths: activeDurationMonths ?? null,
        activeFrom: activeUntil ? new Date().toISOString() : null,
        activeUntil: activeUntil || null,
      };
    } else {
      expirationFields = buildExpirationFields({
        durationType: durationType || 'months',
        activeDurationMonths: activeDurationMonths ?? 3,
        exactDate: exactDate || '',
      });
    }

    // 3. Graba los datos adicionales del usuario en Firestore
    try {
      await db
        .collection('users')
        .doc(createdUserRecord.uid)
        .set({
          fullName: fullName || '',
          fechaNacimiento: fechaNacimiento || '',
          sexo: sexo || '',
          telefono: telefono || '',
          universidad: universidad || '', 
          profesion: profesion || '',
          fechaExamen: fechaExamen || null, 
          email: normalizedEmail || '',
          rol: rol || 'user',
          active: true, 
          isPremium: false,
          fechaSuscripcion: '-',
          fechaVencimiento: '-',
          hasPagoUnicoAccess: false,
          activeDurationMonths: expirationFields.activeDurationMonths,
          activeFrom: expirationFields.activeFrom || null,
          activeUntil: expirationFields.activeUntil,
          expiredAt: null,
          deactivatedReason: null,
          createdAt: new Date().toISOString(),
          mesesSuscrito: 0,
        });

      invalidateUsersSearchCache();
      return NextResponse.json({ ok: true }, { status: 201 });

    } catch (firestoreError) {
      console.error('Error al guardar en Firestore:', firestoreError);
      
      // SOLO BORRAMOS SI LO ACABAMOS DE CREAR (para no borrar un usuario que ya existía previamente en Auth)
      // Pero como no sabemos con certeza si lo acabamos de crear o ya existía, 
      // y estamos en un flujo de "Crear Nuevo", si falla Firestore después de detectar que ya existía,
      // quizás es mejor dejarlo ahí para que el admin pueda intentar de nuevo.
      
      throw firestoreError; 
    }

  } catch (error) {
    console.error('create-user error final:', error);
    
    let errorMessage = 'Ocurrió un error al registrar el usuario.';
    if (error.code === 'auth/email-already-exists') {
      errorMessage = 'El correo electrónico ya está en uso.';
    } else if (error.message.includes('Quota exceeded')) {
      errorMessage = 'Límite de cuota de Firebase excedido.';
    }
    
    return NextResponse.json({ 
      error: errorMessage, 
      details: error.message,
      code: error.code 
    }, { status: 500 });
  }
}
