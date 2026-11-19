import { NextResponse } from 'next/server';
import { verifySessionUser } from '@/lib/apiAuth';
import { deletePagoUnicoCourseData } from '@/lib/pagoUnicoCourseCleanupServer';

/**
 * Elimina un curso de Cursos_Pago_Unico junto con todos sus registros asociados
 * en PostgreSQL (`course_materials`, `live_class_schedules`) y sus archivos físicos
 * almacenados en Supabase Storage (materiales + portada).
 */
export async function DELETE(request, context) {
  const authResult = await verifySessionUser(request, { requireAdmin: true });
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const courseId = String(id || '').trim();
    if (!courseId) {
      return NextResponse.json({ error: 'ID de curso requerido.' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const result = await deletePagoUnicoCourseData({
      courseId,
      fallbackImageUrl: typeof body?.imageUrl === 'string' ? body.imageUrl : null,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('Error en DELETE /api/pago-unico-courses/[id]:', error);
    return NextResponse.json(
      {
        error: 'No se pudo eliminar el curso y sus archivos asociados.',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
