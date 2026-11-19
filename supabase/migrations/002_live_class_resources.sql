-- =============================================================================
-- MÓDULO DE GRABACIONES Y DIAPOSITIVAS POR SESIÓN DE CLASE EN VIVO
-- Cada fila corresponde a una ocurrencia específica (schedule_id + occurrence_date),
-- evitando que series semanales recurrentes sobrescriban clases anteriores.
-- Grabaciones: solo enlace (URL) para no saturar BD/Storage.
-- Diapositivas: archivo subido a course_materials (Storage) y/o enlace externo.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.live_class_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.live_class_schedules(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,

  recording_url text,

  slides_material_id uuid REFERENCES public.course_materials(id) ON DELETE SET NULL,
  slides_url text,
  slides_title text,

  notes text,
  updated_by text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(schedule_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_live_class_resources_schedule_date
  ON public.live_class_resources (schedule_id, occurrence_date);

CREATE INDEX IF NOT EXISTS idx_live_class_resources_occ_date_desc
  ON public.live_class_resources (occurrence_date DESC);

DROP TRIGGER IF EXISTS trg_live_class_resources_updated_at ON public.live_class_resources;
CREATE TRIGGER trg_live_class_resources_updated_at
  BEFORE UPDATE ON public.live_class_resources
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

ALTER TABLE public.live_class_resources ENABLE ROW LEVEL SECURITY;
