import { NextResponse } from 'next/server';
import { verifySessionUser } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { MATERIAL_BUCKET, sanitizeStorageFileName } from '@/lib/materialUtils';

const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_IMAGE_EXT = /\.(png|jpg|jpeg|webp)$/i;
const MAX_COVER_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file !== 'object' || file.size === 0) {
      return NextResponse.json({ error: 'Debes adjuntar una imagen de portada.' }, { status: 400 });
    }

    const mime = String(file.type || '').toLowerCase();
    const name = String(file.name || '').trim();
    if (!ALLOWED_IMAGE_MIMES.has(mime) && !ALLOWED_IMAGE_EXT.test(name)) {
      return NextResponse.json(
        { error: 'Formato no válido. Usa PNG, JPG, JPEG o WEBP.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_COVER_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'La portada supera el límite de 10 MB.' },
        { status: 400 }
      );
    }

    let cleanName = sanitizeStorageFileName(name || 'portada.jpg');
    if (!ALLOWED_IMAGE_EXT.test(cleanName)) {
      const extFromMime = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
      cleanName = `${cleanName}${extFromMime}`;
    }
    const storageFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${cleanName}`;
    const storagePath = `covers/${storageFileName}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabaseAdmin.storage
      .from(MATERIAL_BUCKET)
      .upload(storagePath, arrayBuffer, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    return NextResponse.json(
      {
        url: `/api/course-covers/${encodeURIComponent(storageFileName)}`,
        storage_path: storagePath,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error en POST /api/course-covers:', error);
    return NextResponse.json(
      { error: 'No se pudo subir la imagen de portada.', details: error.message },
      { status: 500 }
    );
  }
}
