'use client';

import { useState, useRef } from 'react';
import {
  FileText,
  Presentation,
  BookOpen,
  UploadCloud,
  Trash2,
  Link as LinkIcon,
  X,
  Check,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const TYPE_META = {
  pdf: {
    label: 'PDF',
    badgeLight: 'bg-blue-50 text-blue-700 border-blue-200',
    badgeDark: 'bg-blue-950/60 text-blue-300 border-blue-800',
    Icon: FileText,
  },
  slides: {
    label: 'Diapositivas',
    badgeLight: 'bg-teal-50 text-teal-700 border-teal-200',
    badgeDark: 'bg-teal-950/60 text-teal-300 border-teal-800',
    Icon: Presentation,
  },
  summary: {
    label: 'Resumen',
    badgeLight: 'bg-amber-50 text-amber-700 border-amber-200',
    badgeDark: 'bg-amber-950/60 text-amber-300 border-amber-800',
    Icon: BookOpen,
  },
};

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Panel reutilizable para adjuntar PDFs/Resúmenes y Diapositivas (con Drag & Drop separado),
 * editar título y tipo por archivo, y gestionar un enlace Drive/URL opcional.
 */
export default function MaterialAttachPanel({
  scopeTitle,
  scopeHint,
  isDark,
  compact = false,
  isUploading = false,
  savedMaterials = [],
  stagedItems = [],
  onFilesSelected,
  onUpdateStagedItem,
  onRemoveStagedItem,
  onUpdateSavedMaterial,
  onDeleteSavedMaterial,
  driveUrl = '',
  onDriveUrlChange,
  drivePlaceholder = 'https://drive.google.com/file/d/... o enlace externo',
  driveLabel = 'Enlace de Google Drive / URL externa (opcional)',
}) {
  const [dragZone, setDragZone] = useState(null); // 'pdf' | 'slides' | null
  const [showUrlField, setShowUrlField] = useState(Boolean(driveUrl));
  const [savingId, setSavingId] = useState(null);
  const [draftTitles, setDraftTitles] = useState({});

  const pdfInputRef = useRef(null);
  const slidesInputRef = useRef(null);

  const handleDrop = (e, materialType) => {
    e.preventDefault();
    e.stopPropagation();
    setDragZone(null);
    if (e.dataTransfer?.files?.length) {
      onFilesSelected(e.dataTransfer.files, materialType);
    }
  };

  const handleDragOver = (e, zone) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragZone !== zone) setDragZone(zone);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragZone(null);
  };

  const commitSavedTitle = async (mat) => {
    const nextTitle = (draftTitles[mat.id] ?? mat.title ?? '').trim();
    if (!nextTitle || nextTitle === mat.title) return;
    setSavingId(mat.id);
    try {
      await onUpdateSavedMaterial(mat.id, { title: nextTitle });
    } finally {
      setSavingId(null);
    }
  };

  const handleSavedTypeChange = async (mat, nextType) => {
    if (nextType === mat.material_type) return;
    setSavingId(mat.id);
    try {
      await onUpdateSavedMaterial(mat.id, { material_type: nextType });
    } finally {
      setSavingId(null);
    }
  };

  const totalCount = savedMaterials.length + stagedItems.length;
  const isUrlOpen = showUrlField || Boolean(driveUrl?.trim());

  const surfaceMuted = isDark
    ? 'bg-gray-900/50 border-gray-700 text-gray-200'
    : 'bg-gray-50 border-gray-200 text-gray-800';

  const inputBase = isDark
    ? 'bg-gray-800 border-gray-600 text-white placeholder:text-gray-400 focus:border-indigo-400 focus:ring-indigo-400/30'
    : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-indigo-600 focus:ring-indigo-600/20';

  return (
    <div className={`space-y-3 ${compact ? 'pt-2' : ''}`}>
      {(scopeTitle || scopeHint) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {scopeTitle && (
              <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                {scopeTitle}
                {totalCount > 0 && (
                  <span
                    className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      isDark ? 'bg-indigo-950 text-indigo-300' : 'bg-indigo-50 text-indigo-700'
                    }`}
                  >
                    {totalCount} {totalCount === 1 ? 'archivo' : 'archivos'}
                  </span>
                )}
              </p>
            )}
            {scopeHint && (
              <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {scopeHint}
              </p>
            )}
          </div>
          {isUploading && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Subiendo archivo(s)...
            </span>
          )}
        </div>
      )}

      {/* Dos zonas Drag & Drop diferenciadas: PDFs/Resúmenes vs Diapositivas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Zona 1: Documentos PDF / Resúmenes */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => pdfInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pdfInputRef.current?.click();
            }
          }}
          onDragEnter={(e) => handleDragOver(e, 'pdf')}
          onDragOver={(e) => handleDragOver(e, 'pdf')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, 'pdf')}
          aria-label="Subir o arrastrar documentos PDF o resúmenes"
          className={`group rounded-xl border-2 border-dashed transition-colors cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            compact ? 'p-3' : 'p-4'
          } ${
            dragZone === 'pdf'
              ? 'border-blue-500 bg-blue-500/10'
              : isDark
                ? 'border-gray-600 bg-gray-900/40 hover:border-blue-500/70 hover:bg-blue-950/20'
                : 'border-gray-300 bg-gray-50/80 hover:border-blue-500 hover:bg-blue-50/60'
          }`}
        >
          <input
            ref={pdfInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
            onChange={(e) => {
              if (e.target.files?.length) onFilesSelected(e.target.files, 'pdf');
              e.target.value = '';
            }}
            className="hidden"
          />
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-lg flex-shrink-0 ${
                isDark ? 'bg-blue-950/70 text-blue-400' : 'bg-blue-100 text-blue-600'
              }`}
            >
              <FileText className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-xs sm:text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                Documentos PDF / Resúmenes
              </p>
              <p className={`text-[11px] sm:text-xs mt-0.5 leading-snug ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Arrastra aquí o toca para elegir (.pdf, .doc, .docx, imágenes)
              </p>
            </div>
            <UploadCloud
              className={`w-4 h-4 flex-shrink-0 mt-0.5 transition-transform group-hover:-translate-y-0.5 ${
                isDark ? 'text-gray-400 group-hover:text-blue-400' : 'text-gray-400 group-hover:text-blue-600'
              }`}
            />
          </div>
        </div>

        {/* Zona 2: Diapositivas */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => slidesInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              slidesInputRef.current?.click();
            }
          }}
          onDragEnter={(e) => handleDragOver(e, 'slides')}
          onDragOver={(e) => handleDragOver(e, 'slides')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, 'slides')}
          aria-label="Subir o arrastrar diapositivas"
          className={`group rounded-xl border-2 border-dashed transition-colors cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
            compact ? 'p-3' : 'p-4'
          } ${
            dragZone === 'slides'
              ? 'border-teal-500 bg-teal-500/10'
              : isDark
                ? 'border-gray-600 bg-gray-900/40 hover:border-teal-500/70 hover:bg-teal-950/20'
                : 'border-gray-300 bg-gray-50/80 hover:border-teal-500 hover:bg-teal-50/60'
          }`}
        >
          <input
            ref={slidesInputRef}
            type="file"
            multiple
            accept=".pdf,.ppt,.pptx"
            onChange={(e) => {
              if (e.target.files?.length) onFilesSelected(e.target.files, 'slides');
              e.target.value = '';
            }}
            className="hidden"
          />
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-lg flex-shrink-0 ${
                isDark ? 'bg-teal-950/70 text-teal-400' : 'bg-teal-100 text-teal-700'
              }`}
            >
              <Presentation className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-xs sm:text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                Diapositivas
              </p>
              <p className={`text-[11px] sm:text-xs mt-0.5 leading-snug ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Arrastra aquí o toca para elegir (.ppt, .pptx o .pdf de clase)
              </p>
            </div>
            <UploadCloud
              className={`w-4 h-4 flex-shrink-0 mt-0.5 transition-transform group-hover:-translate-y-0.5 ${
                isDark ? 'text-gray-400 group-hover:text-teal-400' : 'text-gray-400 group-hover:text-teal-600'
              }`}
            />
          </div>
        </div>
      </div>

      {/* Lista de materiales guardados en Supabase (modo edición) */}
      {(savedMaterials.length > 0 || stagedItems.length > 0) && (
        <div className="space-y-2">
          {savedMaterials.map((mat) => {
            const meta = TYPE_META[mat.material_type] || TYPE_META.pdf;
            const TypeIcon = meta.Icon;
            const currentDraft = draftTitles[mat.id] ?? mat.title ?? '';
            const hasDirtyTitle = currentDraft.trim() !== (mat.title || '').trim() && currentDraft.trim() !== '';

            return (
              <div
                key={mat.id}
                className={`flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-lg border ${surfaceMuted}`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-semibold flex-shrink-0 ${
                      isDark ? meta.badgeDark : meta.badgeLight
                    }`}
                  >
                    <TypeIcon className="w-3.5 h-3.5" />
                    {meta.label}
                  </span>
                  <input
                    type="text"
                    value={currentDraft}
                    onChange={(e) =>
                      setDraftTitles((prev) => ({ ...prev, [mat.id]: e.target.value }))
                    }
                    onBlur={() => commitSavedTitle(mat)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitSavedTitle(mat);
                      }
                    }}
                    aria-label={`Título para ${mat.file_name || mat.title}`}
                    placeholder="Título visible para el estudiante"
                    className={`flex-1 min-w-0 rounded-md border px-2.5 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-2 ${inputBase}`}
                  />
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <select
                      value={mat.material_type || 'pdf'}
                      onChange={(e) => handleSavedTypeChange(mat, e.target.value)}
                      disabled={savingId === mat.id}
                      aria-label="Tipo de material"
                      className={`rounded-md border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 min-h-[36px] ${inputBase}`}
                    >
                      <option value="pdf">PDF</option>
                      <option value="slides">Diapositivas</option>
                      <option value="summary">Resumen</option>
                    </select>
                    {mat.file_size ? (
                      <span className={`text-[11px] whitespace-nowrap ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {formatFileSize(mat.file_size)}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1">
                    {hasDirtyTitle && (
                      <button
                        type="button"
                        onClick={() => commitSavedTitle(mat)}
                        disabled={savingId === mat.id}
                        title="Guardar título"
                        aria-label="Guardar título"
                        className="p-2 rounded-md text-emerald-600 hover:bg-emerald-500/10 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                      >
                        {savingId === mat.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteSavedMaterial(mat.id)}
                      disabled={savingId === mat.id}
                      title="Eliminar material"
                      aria-label={`Eliminar ${mat.title}`}
                      className="p-2 rounded-md text-red-500 hover:bg-red-500/10 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Lista de archivos preparados en cola (modo creación antes de guardar el curso) */}
          {stagedItems.map((item) => {
            const meta = TYPE_META[item.materialType] || TYPE_META.pdf;
            const TypeIcon = meta.Icon;

            return (
              <div
                key={item.id}
                className={`flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-lg border ${
                  isDark
                    ? 'bg-indigo-950/25 border-indigo-800/60 text-gray-100'
                    : 'bg-indigo-50/70 border-indigo-200 text-gray-900'
                }`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-semibold flex-shrink-0 ${
                      isDark ? meta.badgeDark : meta.badgeLight
                    }`}
                  >
                    <TypeIcon className="w-3.5 h-3.5" />
                    {meta.label}
                  </span>
                  <input
                    type="text"
                    value={item.title}
                    onChange={(e) => onUpdateStagedItem(item.id, { title: e.target.value })}
                    aria-label={`Título para ${item.file.name}`}
                    placeholder="Título visible para el estudiante"
                    className={`flex-1 min-w-0 rounded-md border px-2.5 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-2 ${inputBase}`}
                  />
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <select
                      value={item.materialType}
                      onChange={(e) => onUpdateStagedItem(item.id, { materialType: e.target.value })}
                      aria-label="Tipo de material"
                      className={`rounded-md border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 min-h-[36px] ${inputBase}`}
                    >
                      <option value="pdf">PDF</option>
                      <option value="slides">Diapositivas</option>
                      <option value="summary">Resumen</option>
                    </select>
                    <span className={`text-[11px] whitespace-nowrap ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>
                      {formatFileSize(item.file.size)} · en cola
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveStagedItem(item.id)}
                    title="Quitar archivo de la cola"
                    aria-label={`Quitar ${item.title || item.file.name}`}
                    className="p-2 rounded-md text-red-500 hover:bg-red-500/10 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Opción de URL externa / Google Drive (opcional, colapsable) */}
      <div>
        {!isUrlOpen ? (
          <button
            type="button"
            onClick={() => setShowUrlField(true)}
            className={`inline-flex items-center gap-2 text-xs sm:text-sm font-medium py-1.5 px-2.5 -ml-2.5 rounded-lg transition-colors min-h-[36px] ${
              isDark
                ? 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/40'
                : 'text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50'
            }`}
          >
            <LinkIcon className="w-4 h-4 flex-shrink-0" />
            <span>Agregar enlace de Google Drive / URL (opcional)</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-75" />
          </button>
        ) : (
          <div className={`p-3 rounded-lg border ${surfaceMuted}`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className={`text-xs font-medium flex items-center gap-1.5 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                <LinkIcon className="w-3.5 h-3.5 text-indigo-500" />
                {driveLabel}
              </label>
              <button
                type="button"
                onClick={() => {
                  onDriveUrlChange('');
                  setShowUrlField(false);
                }}
                title="Quitar enlace opcional"
                className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded hover:bg-red-500/10 text-red-500 transition-colors`}
              >
                <ChevronUp className="w-3.5 h-3.5" />
                Ocultar / Quitar
              </button>
            </div>
            <input
              type="url"
              value={driveUrl}
              onChange={(e) => onDriveUrlChange(e.target.value)}
              placeholder={drivePlaceholder}
              className={`w-full rounded-md border px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 ${inputBase}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
