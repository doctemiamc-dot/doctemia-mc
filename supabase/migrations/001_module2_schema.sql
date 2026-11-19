-- Migración Módulo 2: Biblioteca de Materiales y Calendario Semanal de Clases en Vivo
-- Ejecutar en Supabase PostgreSQL (compatible con Pooler IPv4)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Tabla: course_materials (diapositivas, resúmenes y PDFs; NUNCA videos)
CREATE TABLE IF NOT EXISTS public.course_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  material_type text NOT NULL CHECK (material_type IN ('slides', 'summary', 'pdf')),
  source_type text NOT NULL CHECK (source_type IN ('supabase_storage', 'google_drive_legacy', 'external_url')),
  storage_path text,
  file_url text,
  file_name text,
  mime_type text,
  file_size bigint,
  especialidad_id text,
  especialidad_nombre text,
  subtema text,
  course_id text,
  module_index int,
  video_url text,
  uploaded_by text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_materials_lookup
  ON public.course_materials (course_id, especialidad_id, subtema)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_course_materials_video
  ON public.course_materials (course_id, video_url)
  WHERE is_active = true;

-- 2. Tabla: live_class_schedules (clases en vivo únicas y semanales recurrentes)
CREATE TABLE IF NOT EXISTS public.live_class_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descripcion text,
  expositor text NOT NULL,
  course_id text,
  course_title text,
  especialidad_id text,
  especialidad_nombre text,
  enlace text NOT NULL,
  id_reunion text,
  is_recurring boolean NOT NULL DEFAULT false,
  day_of_week int CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
  fecha_especifica date,
  hora_inicio time NOT NULL,
  duracion_minutos int NOT NULL DEFAULT 60 CHECK (duracion_minutos > 0),
  status text NOT NULL DEFAULT 'programada' CHECK (status IN ('programada', 'en_vivo', 'cancelada', 'reprogramada')),
  vigente_desde date,
  vigente_hasta date,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_schedules_filter
  ON public.live_class_schedules (course_id, especialidad_id, is_recurring, day_of_week, fecha_especifica);

-- 3. Tabla: live_class_exceptions (mover o cancelar una sola ocurrencia de una serie recurrente)
CREATE TABLE IF NOT EXISTS public.live_class_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.live_class_schedules(id) ON DELETE CASCADE,
  original_date date NOT NULL,
  action text NOT NULL CHECK (action IN ('cancelled', 'rescheduled')),
  new_date date,
  new_hora_inicio time,
  new_enlace text,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_schedule_original_date UNIQUE (schedule_id, original_date)
);

CREATE INDEX IF NOT EXISTS idx_live_exceptions_schedule
  ON public.live_class_exceptions (schedule_id, original_date);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_course_materials_updated_at ON public.course_materials;
CREATE TRIGGER trg_course_materials_updated_at
  BEFORE UPDATE ON public.course_materials
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_live_class_schedules_updated_at ON public.live_class_schedules;
CREATE TRIGGER trg_live_class_schedules_updated_at
  BEFORE UPDATE ON public.live_class_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

-- Seguridad: habilitar RLS en las 3 tablas (todo acceso pasa por API Routes verificadas con Firebase Admin + supabaseAdmin)
ALTER TABLE public.course_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_class_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_class_exceptions ENABLE ROW LEVEL SECURITY;
