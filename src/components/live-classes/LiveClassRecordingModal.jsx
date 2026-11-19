'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Calendar, Clock, ExternalLink, Presentation, User, Video, X } from 'lucide-react';
import { cleanYouTubeUrl, extractYouTubeId } from '@/lib/youtubeUtils';
import { toDrivePreviewUrl } from '@/lib/materialUtils';
import { formatEndTimeHHMM } from '@/lib/scheduleUtils';

const ProtectedVideoPlayer = dynamic(
  () => import('@/app/components/video/ProtectedVideoPlayer'),
  { ssr: false }
);

/**
 * Modal de reproducción de clase grabada para estudiantes.
 * Utiliza `ProtectedVideoPlayer` para YouTube, `/preview` integrado para Google Drive,
 * o tarjeta de acceso seguro para otros enlaces externos (Zoom, Vimeo, Loom, etc.).
 */
export default function LiveClassRecordingModal({
  isOpen,
  occurrence,
  onClose,
  onOpenSlides,
  isDark = false,
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen || !occurrence || !occurrence.recording_url) return null;

  const recUrl = occurrence.recording_url;
  const isYouTube = Boolean(extractYouTubeId(recUrl));
  const isDrive =
    recUrl.includes('drive.google.com') || recUrl.includes('docs.google.com');
  const endTime = formatEndTimeHHMM(occurrence.hora_inicio, occurrence.duracion_minutos);

  const surfaceClass = isDark
    ? 'bg-[#1a2639] border-white/15 text-white'
    : 'bg-white border-[#2E4A70]/20 text-[#1a2639]';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recording-modal-title"
      onClick={() => onClose?.()}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-4xl max-h-[94dvh] overflow-y-auto rounded-2xl sm:rounded-3xl border shadow-2xl p-4 sm:p-6 space-y-4 ${surfaceClass}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-500">
                <Video className="w-3.5 h-3.5" />
                <span>Clase grabada</span>
              </span>
              <span className={`inline-flex items-center gap-1 tabular-nums ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                <Calendar className="w-3.5 h-3.5" />
                <span>{occurrence.occurrence_date}</span>
              </span>
              <span className={`inline-flex items-center gap-1 tabular-nums ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {occurrence.hora_inicio} – {endTime}
                </span>
              </span>
            </div>

            <h2 id="recording-modal-title" className="text-base sm:text-xl font-black leading-snug">
              {occurrence.titulo}
            </h2>

            <p className={`text-xs inline-flex items-center gap-1.5 font-medium ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
              <User className="w-3.5 h-3.5" />
              <span>{occurrence.expositor}</span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => onClose?.()}
            aria-label="Cerrar grabación"
            className="p-2 rounded-xl opacity-75 hover:opacity-100 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Reproductor o enlace externo */}
        <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black relative">
          {isYouTube ? (
            <ProtectedVideoPlayer url={cleanYouTubeUrl(recUrl)} width="100%" height="100%" />
          ) : isDrive ? (
            <div className="relative w-full h-full">
              <div
                className="absolute top-0 right-0 w-16 h-14 z-20"
                onContextMenu={(e) => e.preventDefault()}
                title="Reproducción integrada en Doctemia MC"
              />
              <iframe
                src={toDrivePreviewUrl(recUrl)}
                title={occurrence.titulo}
                className="w-full h-full border-0"
                allow="autoplay; fullscreen"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-6 text-center text-white bg-gradient-to-br from-[#0f172a] to-[#1e293b]">
              <Video className="w-10 h-10 text-[#24B0BA]" />
              <div className="space-y-1 max-w-md">
                <p className="text-sm sm:text-base font-extrabold">
                  Grabación alojada en enlace externo
                </p>
                <p className="text-xs text-slate-300">
                  Haz clic en el botón inferior para abrir la grabación de esta sesión en una pestaña segura.
                </p>
              </div>
              <a
                href={recUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-sm font-bold shadow-md transition-colors"
              >
                <Video className="w-4 h-4" />
                <span>Abrir grabación ahora</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>

        {(occurrence.notes || occurrence.has_slides) && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            {occurrence.notes ? (
              <p
                className={`text-xs px-3 py-2 rounded-xl border flex-1 ${
                  isDark
                    ? 'bg-[#162235] border-white/10 text-blue-100'
                    : 'bg-[#FFF9F0] border-[#2E4A70]/15 text-[#2E4A70]'
                }`}
              >
                <strong>Nota del docente:</strong> {occurrence.notes}
              </p>
            ) : (
              <span />
            )}

            {occurrence.has_slides && (
              <button
                type="button"
                onClick={() => onOpenSlides?.(occurrence)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-extrabold cursor-pointer shrink-0"
              >
                <Presentation className="w-4 h-4" />
                <span>Ver Diapositivas de esta clase</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
