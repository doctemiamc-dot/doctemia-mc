import { NextResponse } from 'next/server';
import { verifySessionUser } from '@/lib/apiAuth';
import { db as adminDb } from '@/lib/firebase-admin';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { MATERIAL_BUCKET, sanitizeStorageFileName } from '@/lib/materialUtils';

const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_IMAGE_EXT = /\.(png|jpg|jpeg|webp)$/i;
const MAX_QR_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function extractQrStoragePath(data = {}) {
  if (typeof data.qrStoragePath === 'string' && data.qrStoragePath.startsWith('qr-payments/')) {
    return data.qrStoragePath;
  }
  const url = typeof data.qrUrl === 'string' ? data.qrUrl.trim() : '';
  const match = url.match(/^\/api\/qr-gestion\/([^?#]+)$/);
  if (!match?.[1]) return null;
  try {
    const fileName = decodeURIComponent(match[1]);
    if (!fileName || fileName.includes('..') || fileName.includes('/')) return null;
    return `qr-payments/${fileName}`;
  } catch {
    return null;
  }
}

async function deleteOldQrFromSupabase(storagePath) {
  if (!storagePath) return false;
  try {
    const { error } = await supabaseAdmin.storage
      .from(MATERIAL_BUCKET)
      .remove([storagePath]);
    if (error) {
      console.warn('No se pudo borrar el QR anterior de Supabase:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Error borrando QR anterior de Supabase:', err.message);
    return false;
  }
}

export async function GET(request) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const snap = await adminDb.collection('pags').doc('infoContacto').get();
    const data = snap.exists ? snap.data() : {};
    return NextResponse.json(
      {
        qrUrl: data.qrUrl || '',
        qrStoragePath: data.qrStoragePath || extractQrStoragePath(data) || null,
        adminPhone: data.adminPhone || '',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error en GET /api/qr-gestion:', error);
    return NextResponse.json(
      { error: 'Error al consultar la configuración de QR y contacto.' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const docRef = adminDb.collection('pags').doc('infoContacto');
    const existingSnap = await docRef.get();
    const existingData = existingSnap.exists ? existingSnap.data() : {};
    const oldStoragePath = extractQrStoragePath(existingData);

    const contentType = request.headers.get('content-type') || '';

    // Caso 1: Subida de imagen física a Supabase Storage (reemplaza y borra la anterior)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      const rawPhone = formData.get('adminPhone');
      const adminPhone =
        typeof rawPhone === 'string' && rawPhone.trim()
          ? rawPhone.trim()
          : existingData.adminPhone || '';

      if (!adminPhone) {
        return NextResponse.json(
          { error: 'El número de WhatsApp del administrador es obligatorio.' },
          { status: 400 }
        );
      }

      if (!file || typeof file !== 'object' || file.size === 0) {
        return NextResponse.json(
          { error: 'Debes seleccionar una imagen QR válida.' },
          { status: 400 }
        );
      }

      const mime = String(file.type || '').toLowerCase();
      const name = String(file.name || '').trim();
      if (!ALLOWED_IMAGE_MIMES.has(mime) && !ALLOWED_IMAGE_EXT.test(name)) {
        return NextResponse.json(
          { error: 'Formato no válido. Usa PNG, JPG, JPEG o WEBP.' },
          { status: 400 }
        );
      }

      if (file.size > MAX_QR_SIZE_BYTES) {
        return NextResponse.json(
          { error: 'La imagen QR supera el límite de 10 MB.' },
          { status: 400 }
        );
      }

      let cleanName = sanitizeStorageFileName(name || 'qr.png');
      if (!ALLOWED_IMAGE_EXT.test(cleanName)) {
        const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
        cleanName = `${cleanName}${ext}`;
      }
      const storageFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${cleanName}`;
      const newStoragePath = `qr-payments/${storageFileName}`;
      const newQrUrl = `/api/qr-gestion/${encodeURIComponent(storageFileName)}`;

      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadError } = await supabaseAdmin.storage
        .from(MATERIAL_BUCKET)
        .upload(newStoragePath, arrayBuffer, {
          contentType: file.type || 'image/png',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      try {
        await docRef.set(
          {
            qrUrl: newQrUrl,
            qrStoragePath: newStoragePath,
            adminPhone,
          },
          { merge: true }
        );
      } catch (firestoreErr) {
        // Si falló el guardado en Firestore, revertimos el archivo recién subido
        await deleteOldQrFromSupabase(newStoragePath);
        throw firestoreErr;
      }

      let deletedOldFile = false;
      if (oldStoragePath && oldStoragePath !== newStoragePath) {
        deletedOldFile = await deleteOldQrFromSupabase(oldStoragePath);
      }

      return NextResponse.json(
        {
          qrUrl: newQrUrl,
          qrStoragePath: newStoragePath,
          adminPhone,
          deletedOldFile,
        },
        { status: 200 }
      );
    }

    // Caso 2: Actualización JSON (solo teléfono o enlace externo)
    const body = await request.json().catch(() => ({}));
    const adminPhone = typeof body.adminPhone === 'string' ? body.adminPhone.trim() : '';
    if (!adminPhone) {
      return NextResponse.json(
        { error: 'El número de WhatsApp del administrador es obligatorio.' },
        { status: 400 }
      );
    }

    const updatePayload = { adminPhone };
    let deletedOldFile = false;

    if (typeof body.qrUrl === 'string') {
      const nextUrl = body.qrUrl.trim();
      if (nextUrl) {
        if (!/^https?:\/\//i.test(nextUrl) && !nextUrl.startsWith('/api/qr-gestion/')) {
          return NextResponse.json(
            { error: 'La URL del código QR debe comenzar con https:// o http://.' },
            { status: 400 }
          );
        }
        updatePayload.qrUrl = nextUrl;
        if (nextUrl.startsWith('http') && oldStoragePath) {
          updatePayload.qrStoragePath = null;
          deletedOldFile = await deleteOldQrFromSupabase(oldStoragePath);
        }
      }
    }

    await docRef.set(updatePayload, { merge: true });

    const finalSnap = await docRef.get();
    const finalData = finalSnap.exists ? finalSnap.data() : {};

    return NextResponse.json(
      {
        qrUrl: finalData.qrUrl || '',
        qrStoragePath: finalData.qrStoragePath || null,
        adminPhone: finalData.adminPhone || adminPhone,
        deletedOldFile,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error en POST /api/qr-gestion:', error);
    return NextResponse.json(
      { error: 'No se pudo guardar la configuración del QR.', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const docRef = adminDb.collection('pags').doc('infoContacto');
    const existingSnap = await docRef.get();
    const existingData = existingSnap.exists ? existingSnap.data() : {};
    const oldStoragePath = extractQrStoragePath(existingData);

    let deletedFromStorage = false;
    if (oldStoragePath) {
      deletedFromStorage = await deleteOldQrFromSupabase(oldStoragePath);
    }

    await docRef.set(
      {
        qrUrl: '',
        qrStoragePath: null,
      },
      { merge: true }
    );

    return NextResponse.json(
      {
        ok: true,
        qrUrl: '',
        qrStoragePath: null,
        deletedFromStorage,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error en DELETE /api/qr-gestion:', error);
    return NextResponse.json(
      { error: 'No se pudo eliminar la imagen QR.', details: error.message },
      { status: 500 }
    );
  }
}
