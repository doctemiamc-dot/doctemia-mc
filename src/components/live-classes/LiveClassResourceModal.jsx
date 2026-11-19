'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  FileText,
  Link2,
  Loader2,
  Presentation,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { validateMaterialFile } from '@/lib/materialUtils';
import { extractYouTubeId } from '@/lib/youtubeUtils';
import { formatEndTimeHHMM } from '@/lib/scheduleUtils';

export function createEmptyResourceDraft(source = null) {
  return {
    recordingUrl: source?.recording_url || '',
    slidesMode: source?.slides_url && !source?.slides_material_id ? 'link' : 'upload',
    slidesUrl: source?.slides_url || '',
    slidesTitle: source?.slides_title || '',
    notes: source?.notes || '',
    slidesFile: null,
    removeUploadedSlides: false,
    existingUploadedMat: source?.slides_material || null,
    slidesMaterialId: source?.slides_material_id || null,
    hadInitialResources: Boolean(
      source?.has_resources ||
        source?.recording_url ||
        source?.slides_material_id ||
        source?.slides_url ||
        source?.notes
    ),
  };
}

export function hasResourceDraftContent(draft) {
  if (!draft) return false;
  return Boolean(
    draft.recordingUrl?.trim() ||
      draft.slidesUrl?.trim() ||
      draft.notes?.trim() ||
      draft.slidesFile ||
      draft.removeUploadedSlides ||
      draft.hadInitialResources ||
      draft.slidesMaterialId
  );
}

export async function saveLiveClassResources({
  scheduleId,
  occurrenceDate,
  draft,
  getAuthHeaders,
}) {
  const trimmedRec = String(draft?.recordingUrl || '').trim();
  const trimmedSlidesLink = String(draft?.slidesUrl || '').trim();
  const trimmedTitle = String(draft?.slidesTitle || '').trim();
  const trimmedNotes = String(draft?.notes || '').trim();

  if (trimmedRec && !/^https?:\/\//i.test(trimmedRec)) {
    throw new Error('El enlace de la grabación debe comenzar con https:// o http://');
  }
  if (trimmedSlidesLink && !/^https?:\/\//i.test(trimmedSlidesLink)) {
    throw new Error('El enlace de diapositivas debe comenzar con https:// o http://');
  }

  let res;
  if (draft?.slidesFile) {
    const headers = await getAuthHeaders();
    const fd = new FormData();
    fd.append('occurrence_date', occurrenceDate);
    fd.append('recording_url', trimmedRec);
    fd.append('slides_url', trimmedSlidesLink);
    fd.append('slides_title', trimmedTitle);
    fd.append('notes', trimmedNotes);
    fd.append('remove_uploaded_slides', draft.removeUploadedSlides ? 'true' : 'false');
    fd.append('slides_file', draft.slidesFile);

    res = await fetch(`/api/schedules/${scheduleId}/resources`, {
      method: 'PUT',
      headers,
      body: fd,
    });
  } else {
    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
    res = await fetch(`/api/schedules/${scheduleId}/resources`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        occurrence_date: occurrenceDate,
        recording_url: trimmedRec,
        slides_url: trimmedSlidesLink,
        slides_title: trimmedTitle,
        notes: trimmedNotes,
        remove_uploaded_slides: Boolean(draft?.removeUploadedSlides),
      }),
    });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'No se pudieron guardar los recursos.');
  }

  const deletedFilesCount = Number(data.deletedFilesCount || 0);
  return {
    resource: data.resource || null,
    deletedFilesCount,
    message:
      deletedFilesCount > 0
        ? `Cambios guardados (${deletedFilesCount} archivo(s) anterior(es) borrado(s) de Storage y BD)`
        : 'Grabación y diapositivas guardadas',
  };
}

export function LiveClassResourcesFields({
  draft,
  setDraft,
  titleHint = '',
  isDark = false,
  inputClass,
  idPrefix = 'live-res',
}) {
  const fileInputRef = useRef(null);
  const existingUploadedMat = !draft.removeUploadedSlides ? draft.existingUploadedMat : null;
  const hasYt = Boolean(extractYouTubeId(draft.recordingUrl || ''));

  const resolvedInputClass =
    inputClass ||
    (isDark
      ? 'bg-[#0f172a] border-white/15 text-white placeholder:text-slate-400 focus:border-[#24B0BA]'
      : 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-[#014ba0]');

  const handleFilePick = (fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    const validation = validateMaterialFile(file.name, file.type);
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }
    setDraft((prev) => ({
      ...prev,
      slidesFile: file,
      removeUploadedSlides: false,
      slidesTitle: prev.slidesTitle?.trim()
        ? prev.slidesTitle
        : file.name.replace(/\.[^/.]+$/, ''),
    }));
  };

  return (
    <div className="space-y-3.5">
      {/* 1. Grabación: ÚNICAMENTE enlace */}
      <div
        className={`rounded-2xl border p-3.5 space-y-2 ${
          isDark ? 'bg-[#162235] border-white/10' : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={`${idPrefix}-rec-url`}
            className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide"
          >
            <Video className="w-3.5 h-3.5 text-rose-500" />
            <span>Enlace de Grabación (solo link)</span>
          </label>
          {draft.recordingUrl?.trim() && (
            <button
              type="button"
              onClick={() => setDraft((p) => ({ ...p, recordingUrl: '' }))}
              className="text-[11px] font-bold text-red-500 hover:underline cursor-pointer"
            >
              Limpiar
            </button>
          )}
        </div>

        <input
          id={`${idPrefix}-rec-url`}
          type="url"
          value={draft.recordingUrl || ''}
          onChange={(e) => setDraft((p) => ({ ...p, recordingUrl: e.target.value }))}
          placeholder="https://youtu.be/... o https://drive.google.com/..."
          className={`w-full px-3 py-2.5 rounded-xl border text-xs sm:text-sm outline-none ${resolvedInputClass}`}
        />

        <p className="text-[11px] opacity-75">
          {hasYt ? (
            <span className="inline-flex items-center gap-1 text-emerald-500 font-bold">
              <Check className="w-3.5 h-3.5" />
              YouTube detectado: se reproducirá dentro del visor protegido sin salir de la plataforma.
            </span>
          ) : (
            'Pega el enlace de YouTube (no listado), Google Drive o plataforma de video para mantener ligera la BD.'
          )}
        </p>
      </div>

      {/* 2. Diapositivas / Documentos: Subir archivo a la BD O copiar enlace externo */}
      <div
        className={`rounded-2xl border p-3.5 space-y-3 ${
          isDark ? 'bg-[#162235] border-white/10' : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide">
            <Presentation className="w-3.5 h-3.5 text-blue-500" />
            <span>Diapositivas o documento de la clase</span>
          </span>

          <div
            className={`inline-flex rounded-xl p-0.5 border ${
              isDark ? 'bg-[#0f172a] border-white/10' : 'bg-white border-slate-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setDraft((p) => ({ ...p, slidesMode: 'upload' }))}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                draft.slidesMode === 'upload'
                  ? 'bg-[#014ba0] text-white'
                  : isDark
                  ? 'text-slate-300'
                  : 'text-slate-600'
              }`}
            >
              <Upload className="w-3 h-3" />
              <span>Subir a BD</span>
            </button>
            <button
              type="button"
              onClick={() => setDraft((p) => ({ ...p, slidesMode: 'link' }))}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                draft.slidesMode === 'link'
                  ? 'bg-[#014ba0] text-white'
                  : isDark
                  ? 'text-slate-300'
                  : 'text-slate-600'
              }`}
            >
              <Link2 className="w-3 h-3" />
              <span>Pegar enlace</span>
            </button>
          </div>
        </div>

        <div>
          <label htmlFor={`${idPrefix}-slides-title`} className="block text-[11px] font-bold mb-1 opacity-80">
            Nombre del material (opcional)
          </label>
          <input
            id={`${idPrefix}-slides-title`}
            type="text"
            value={draft.slidesTitle || ''}
            onChange={(e) => setDraft((p) => ({ ...p, slidesTitle: e.target.value }))}
            placeholder={titleHint ? `Ej: Diapositivas · ${titleHint}` : 'Ej: Diapositivas o guía de clase'}
            className={`w-full px-3 py-2 rounded-xl border text-xs outline-none ${resolvedInputClass}`}
          />
        </div>

        {draft.slidesMode === 'upload' ? (
          <div className="space-y-2.5">
            {existingUploadedMat && !draft.slidesFile && (
              <div
                className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-xs ${
                  isDark
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold truncate">
                      {existingUploadedMat.file_name || existingUploadedMat.title}
                    </p>
                    <p className="text-[10px] opacity-80">
                      Registrado en BD (`course_materials`)
                      {existingUploadedMat.file_size
                        ? ` · ${(Number(existingUploadedMat.file_size) / (1024 * 1024)).toFixed(2)} MB`
                        : ''}
                      {' · '}Se borrará de Storage y BD al quitarlo o eliminar la clase
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDraft((p) => ({ ...p, removeUploadedSlides: true }))}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/15 text-red-500 hover:bg-red-500/25 text-[11px] font-bold cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Quitar</span>
                </button>
              </div>
            )}

            {draft.removeUploadedSlides && draft.slidesMaterialId && !draft.slidesFile && (
              <div className="flex items-center justify-between gap-2 text-[11px] px-2.5 py-2 rounded-xl bg-amber-500/10 text-amber-500 font-semibold">
                <span>El archivo anterior se quitará al guardar.</span>
                <button
                  type="button"
                  onClick={() => setDraft((p) => ({ ...p, removeUploadedSlides: false }))}
                  className="underline font-bold cursor-pointer"
                >
                  Deshacer
                </button>
              </div>
            )}

            {draft.slidesFile ? (
              <div
                className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-xs ${
                  isDark
                    ? 'bg-blue-950/35 border-blue-500/40 text-blue-100'
                    : 'bg-blue-50 border-blue-200 text-blue-900'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Upload className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold truncate">{draft.slidesFile.name}</p>
                    <p className="text-[10px] opacity-80">
                      {(draft.slidesFile.size / (1024 * 1024)).toFixed(2)} MB · Listo para subir
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDraft((p) => ({ ...p, slidesFile: null }))}
                  className="text-[11px] font-bold text-red-500 hover:underline cursor-pointer shrink-0"
                >
                  Cancelar archivo
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFilePick(e.dataTransfer?.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${
                  isDark
                    ? 'border-white/20 hover:border-[#24B0BA] hover:bg-white/5'
                    : 'border-slate-300 hover:border-[#014ba0] hover:bg-white'
                }`}
              >
                <Upload className="w-5 h-5 mx-auto opacity-70 mb-1" />
                <p className="text-xs font-bold">
                  {existingUploadedMat
                    ? 'Arrastra otro archivo o haz clic para reemplazar'
                    : 'Arrastra aquí tu PDF / PPT / DOC / Imagen o haz clic para subir'}
                </p>
                <p className="text-[10px] opacity-65 mt-0.5">
                  PDF, PPT, PPTX, DOC, DOCX, PNG, JPG (no permite videos)
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg,.webp"
              onChange={(e) => {
                handleFilePick(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`${idPrefix}-slides-link`} className="text-[11px] font-bold opacity-80">
                Enlace de Google Drive, Google Slides, Canva o PDF externo
              </label>
              {draft.slidesUrl?.trim() && (
                <button
                  type="button"
                  onClick={() => setDraft((p) => ({ ...p, slidesUrl: '' }))}
                  className="text-[11px] font-bold text-red-500 hover:underline cursor-pointer"
                >
                  Limpiar
                </button>
              )}
            </div>
            <input
              id={`${idPrefix}-slides-link`}
              type="url"
              value={draft.slidesUrl || ''}
              onChange={(e) => setDraft((p) => ({ ...p, slidesUrl: e.target.value }))}
              placeholder="https://drive.google.com/file/d/... o enlace externo"
              className={`w-full px-3 py-2.5 rounded-xl border text-xs sm:text-sm outline-none ${resolvedInputClass}`}
            />
            {existingUploadedMat && (
              <p className="text-[11px] text-amber-500 font-semibold">
                También hay un archivo subido en BD ({existingUploadedMat.file_name || existingUploadedMat.title}).{' '}
                <button
                  type="button"
                  onClick={() => setDraft((p) => ({ ...p, removeUploadedSlides: true }))}
                  className="underline font-bold cursor-pointer"
                >
                  Quitar archivo subido
                </button>
              </p>
            )}
          </div>
        )}
      </div>

      {/* 3. Notas opcionales */}
      <div>
        <label htmlFor={`${idPrefix}-notes`} className="block text-xs font-bold mb-1">
          Nota o indicaciones post-clase (opcional)
        </label>
        <textarea
          id={`${idPrefix}-notes`}
          rows={2}
          value={draft.notes || ''}
          onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
          placeholder="Ej: Revisar caso clínico página 14 del PDF antes del simulacro."
          className={`w-full px-3 py-2 rounded-xl border text-xs outline-none resize-none ${resolvedInputClass}`}
        />
      </div>
    </div>
  );
}

/**
 * Modal administrativo para adjuntar post-clase a una sesión específica (`schedule_id + occurrence_date`):
 * - Grabación: únicamente enlace (YouTube, Drive, Loom, Zoom, etc.) para no sobrecargar Storage/BD.
 * - Diapositivas: archivo subido a Supabase Storage (`course_materials`) y/o enlace externo.
 */
export default function LiveClassResourceModal({
  isOpen,
  occurrence,
  onClose,
  onSaved,
  getAuthHeaders,
  isDark = false,
}) {
  const [draft, setDraft] = useState(() => createEmptyResourceDraft());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!isOpen || !occurrence) return;
    setDraft(createEmptyResourceDraft(occurrence));
  }, [isOpen, occurrence]);

  if (!isOpen || !occurrence) return null;

  const endTime = formatEndTimeHHMM(occurrence.hora_inicio, occurrence.duracion_minutos);

  const surfaceClass = isDark
    ? 'bg-[#1e293b] border-white/10 text-white'
    : 'bg-white border-slate-200 text-slate-900';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving || deleting) return;

    setSaving(true);
    try {
      const result = await saveLiveClassResources({
        scheduleId: occurrence.schedule_id,
        occurrenceDate: occurrence.occurrence_date,
        draft,
        getAuthHeaders,
      });
      toast.success(result.message);
      onSaved?.(result.resource, occurrence);
      onClose?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAll = async () => {
    if (saving || deleting) return;
    setDeleting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `/api/schedules/${occurrence.schedule_id}/resources?occurrence_date=${encodeURIComponent(
          occurrence.occurrence_date
        )}`,
        { method: 'DELETE', headers }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudieron quitar los recursos.');
      const deletedFiles = Number(data.deletedFilesCount || 0);
      toast.success(
        deletedFiles > 0
          ? `Recursos y ${deletedFiles} archivo(s) eliminados de Storage y BD`
          : 'Recursos eliminados de esta sesión'
      );
      onSaved?.(null, occurrence);
      onClose?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resource-modal-title"
      onClick={() => !saving && !deleting && onClose?.()}
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full sm:max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border shadow-2xl p-5 sm:p-6 space-y-4 ${surfaceClass}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-[#24B0BA] uppercase tracking-wider">
              <Video className="w-3.5 h-3.5" />
              <span>
                {occurrence.occurrence_date} · {occurrence.hora_inicio} – {endTime}
              </span>
            </span>
            <h2 id="resource-modal-title" className="text-lg font-black leading-snug mt-0.5">
              Grabación y Diapositivas
            </h2>
            <p className="text-xs opacity-75 truncate">{occurrence.titulo}</p>
          </div>
          <button
            type="button"
            disabled={saving || deleting}
            onClick={() => onClose?.()}
            className="p-1.5 rounded-lg opacity-70 hover:opacity-100 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <LiveClassResourcesFields
            draft={draft}
            setDraft={setDraft}
            titleHint={occurrence.titulo}
            isDark={isDark}
            idPrefix="live-modal"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {occurrence.has_resources ? (
              <button
                type="button"
                disabled={saving || deleting}
                onClick={handleDeleteAll}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-500 text-xs font-bold cursor-pointer disabled:opacity-45"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Quitar todo</span>
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving || deleting}
                onClick={() => onClose?.()}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold border cursor-pointer ${
                  isDark ? 'border-white/15 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-100'
                }`}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || deleting}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{saving ? 'Guardando...' : 'Guardar Grabación y Diapos'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
