import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { verifySessionUser, invalidateUserAuthCache } from '@/lib/apiAuth';
import { invalidateUsersSearchCache } from '@/lib/usersSearchCache';
import { buildExpirationFields } from '@/lib/accountExpiration';

const MAX_USERS_PER_REQUEST = 400;

export async function POST(req) {
  const authResult = await verifySessionUser(req, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    if (!db) {
      return NextResponse.json(
        { error: 'Servidor no inicializado (Firebase DB)' },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawIds = Array.isArray(body.userIds) ? body.userIds : [];
    const userIds = Array.from(
      new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean))
    );

    if (userIds.length === 0) {
      return NextResponse.json(
        { error: 'Debes seleccionar al menos un usuario.' },
        { status: 400 }
      );
    }

    if (userIds.length > MAX_USERS_PER_REQUEST) {
      return NextResponse.json(
        { error: `El límite por lote es de ${MAX_USERS_PER_REQUEST} usuarios.` },
        { status: 400 }
      );
    }

    const changes = body.changes || {};
    const activeMode = changes.activeMode || 'unchanged'; // 'unchanged' | 'activate' | 'deactivate'
    const pagoUnicoMode = changes.pagoUnicoMode || 'unchanged'; // 'unchanged' | 'grant' | 'revoke'
    const vigenciaMode = changes.vigenciaMode || 'unchanged'; // 'unchanged' | 'months' | 'exact' | 'unlimited'

    const updateFields = {};

    if (activeMode === 'activate') {
      updateFields.active = true;
      updateFields.expiredAt = null;
      updateFields.deactivatedReason = null;
    } else if (activeMode === 'deactivate') {
      updateFields.active = false;
    } else if (activeMode !== 'unchanged') {
      return NextResponse.json({ error: 'Modo de estado inválido.' }, { status: 400 });
    }

    if (pagoUnicoMode === 'grant') {
      updateFields.hasPagoUnicoAccess = true;
    } else if (pagoUnicoMode === 'revoke') {
      updateFields.hasPagoUnicoAccess = false;
    } else if (pagoUnicoMode !== 'unchanged') {
      return NextResponse.json({ error: 'Modo de Pago Único inválido.' }, { status: 400 });
    }

    if (vigenciaMode === 'months') {
      const months = Number(changes.activeDurationMonths);
      if (!Number.isFinite(months) || months < 1 || months > 120) {
        return NextResponse.json(
          { error: 'La duración en meses debe estar entre 1 y 120.' },
          { status: 400 }
        );
      }
      const exp = buildExpirationFields({
        durationType: 'months',
        activeDurationMonths: Math.floor(months),
      });
      updateFields.activeDurationMonths = exp.activeDurationMonths;
      updateFields.activeFrom = exp.activeFrom;
      updateFields.activeUntil = exp.activeUntil;
    } else if (vigenciaMode === 'exact') {
      const exactDate = String(changes.exactDate || '').trim();
      const exactTime = String(changes.exactTime || '23:59').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(exactDate)) {
        return NextResponse.json(
          { error: 'Debes indicar una fecha límite válida (YYYY-MM-DD).' },
          { status: 400 }
        );
      }
      const exp = buildExpirationFields({
        durationType: 'exact',
        exactDate,
        exactTime: /^\d{2}:\d{2}$/.test(exactTime) ? exactTime : '23:59',
      });
      updateFields.activeDurationMonths = exp.activeDurationMonths;
      updateFields.activeFrom = exp.activeFrom;
      updateFields.activeUntil = exp.activeUntil;
    } else if (vigenciaMode === 'unlimited') {
      const exp = buildExpirationFields({ durationType: 'unlimited' });
      updateFields.activeDurationMonths = exp.activeDurationMonths;
      updateFields.activeFrom = exp.activeFrom;
      updateFields.activeUntil = exp.activeUntil;
    } else if (vigenciaMode !== 'unchanged') {
      return NextResponse.json({ error: 'Modo de vigencia inválido.' }, { status: 400 });
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json(
        { error: 'Debes elegir al menos un cambio para aplicar al lote.' },
        { status: 400 }
      );
    }

    const usersCol = db.collection('users');
    const success = [];
    const failed = [];

    try {
      const batch = db.batch();
      for (const uid of userIds) {
        batch.update(usersCol.doc(uid), updateFields);
      }
      await batch.commit();
      for (const uid of userIds) {
        invalidateUserAuthCache(uid);
        success.push(uid);
      }
    } catch {
      // Si algún documento del lote no existe, aplicamos de forma individual en bloques para no perder los válidos
      const CONCURRENCY = 20;
      for (let i = 0; i < userIds.length; i += CONCURRENCY) {
        const slice = userIds.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
          slice.map(async (uid) => {
            await usersCol.doc(uid).update(updateFields);
            invalidateUserAuthCache(uid);
            return uid;
          })
        );
        settled.forEach((res, idx) => {
          const uid = slice[idx];
          if (res.status === 'fulfilled') {
            success.push(uid);
          } else {
            failed.push({ id: uid, error: res.reason?.message || 'Error actualizando usuario' });
          }
        });
      }
    }

    if (success.length === 0) {
      return NextResponse.json(
        { error: 'No se pudo actualizar ninguno de los usuarios seleccionados.', failed },
        { status: 500 }
      );
    }

    invalidateUsersSearchCache();

    return NextResponse.json(
      {
        message: `Se actualizaron ${success.length} usuario(s)${
          failed.length > 0 ? ` (${failed.length} fallido(s))` : ''
        }.`,
        updatedFields: updateFields,
        results: { success, failed },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error en POST /api/users/bulk-update:', error);
    return NextResponse.json(
      { error: 'No se pudieron actualizar los usuarios seleccionados.', details: error.message },
      { status: 500 }
    );
  }
}
