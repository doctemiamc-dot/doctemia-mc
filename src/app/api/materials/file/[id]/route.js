import { NextResponse } from 'next/server';
import { verifySessionUser } from '@/lib/apiAuth';
import { db as adminDb } from '@/lib/firebase-admin';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { MATERIAL_BUCKET } from '@/lib/materialUtils';

/**
 * Sirve el archivo privado desde Supabase Storage en modo `inline` previa validación de sesión Firebase,
 * permitiendo previsualización directa dentro de `ProtectedDocumentViewer` sin exponer URLs permanentes.
 */
export async function GET(request, context) {
  const authResult = await verifySessionUser(request, { requirePagoUnico: true });
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const { data: material, error } = await supabaseAdmin
      .from('course_materials')
      .select('id, course_id, source_type, storage_path, file_name, mime_type, is_active')
      .eq('id', id)
      .single();

    if (error || !material || (!material.is_active && !authResult.isAdmin)) {
      return NextResponse.json({ error: 'Archivo no disponible.' }, { status: 404 });
    }

    if (!authResult.isAdmin && material.course_id && adminDb) {
      const courseSnap = await adminDb
        .collection('Cursos_Pago_Unico')
        .doc(material.course_id)
        .get();
      if (!courseSnap.exists || courseSnap.data()?.isActive === false) {
        return NextResponse.json(
          { error: 'Este material pertenece a un curso que no está disponible.' },
          { status: 404 }
        );
      }
    }

    if (material.source_type !== 'supabase_storage' || !material.storage_path) {
      return NextResponse.json({ error: 'Este material no pertenece a Storage.' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    if (searchParams.get('mode') === 'signed_url') {
      const { data: signedData, error: signErr } = await supabaseAdmin.storage
        .from(MATERIAL_BUCKET)
        .createSignedUrl(material.storage_path, 3600);
      if (signErr || !signedData?.signedUrl) {
        throw signErr || new Error('No se pudo generar el enlace temporal.');
      }
      return NextResponse.json(
        { signed_url: signedData.signedUrl },
        {
          status: 200,
          headers: { 'Cache-Control': 'private, max-age=300' },
        }
      );
    }

    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
      .from(MATERIAL_BUCKET)
      .download(material.storage_path);

    if (downloadError || !fileBlob) {
      throw downloadError || new Error('No se pudo descargar el archivo');
    }

    const contentType = material.mime_type || 'application/pdf';
    const safeName = (material.file_name || 'documento.pdf').replace(/["\r\n]/g, '');
    const headers = {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    };
    if (typeof fileBlob.size === 'number' && fileBlob.size > 0) {
      headers['Content-Length'] = String(fileBlob.size);
    }

    return new NextResponse(fileBlob.stream(), {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Error en GET /api/materials/file/[id]:', error);
    return NextResponse.json(
      { error: 'Error al cargar el documento.', details: error.message },
      { status: 500 }
    );
  }
}
