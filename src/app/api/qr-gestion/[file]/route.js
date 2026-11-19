import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { MATERIAL_BUCKET } from '@/lib/materialUtils';

const SAFE_QR_FILE_REGEX = /^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/i;

function getImageContentType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export async function GET(_request, context) {
  try {
    const { file } = await context.params;
    const decoded = decodeURIComponent(file || '');

    if (!decoded || !SAFE_QR_FILE_REGEX.test(decoded) || decoded.includes('..')) {
      return NextResponse.json({ error: 'Imagen QR no válida.' }, { status: 400 });
    }

    const { data: blob, error } = await supabaseAdmin.storage
      .from(MATERIAL_BUCKET)
      .download(`qr-payments/${decoded}`);

    if (error || !blob) {
      return NextResponse.json({ error: 'Imagen QR no encontrada.' }, { status: 404 });
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': getImageContentType(decoded),
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Error en GET /api/qr-gestion/[file]:', error);
    return NextResponse.json({ error: 'Error al cargar la imagen QR.' }, { status: 500 });
  }
}
