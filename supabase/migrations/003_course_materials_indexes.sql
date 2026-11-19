-- =============================================================================
-- ÍNDICES PARA ESCALABILIDAD DE BIBLIOTECA DE MATERIALES (/admin/materiales)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_course_materials_created_at_desc
  ON public.course_materials (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_course_materials_type_active
  ON public.course_materials (material_type, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_course_materials_storage_path_prefix
  ON public.course_materials (storage_path text_pattern_ops)
  WHERE storage_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_live_class_resources_slides_mat_id
  ON public.live_class_resources (slides_material_id)
  WHERE slides_material_id IS NOT NULL;
