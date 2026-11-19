'use client';

import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  X,
  FileText,
  Presentation,
  BookOpen,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ShieldCheck,
  Loader2,
  AlertCircle,
  Maximize2,
} from 'lucide-react';
import { toDrivePreviewUrl } from '@/lib/materialUtils';
import {
  getCachedMaterialPayload,
  setCachedMaterialPayload,
  getCachedSignedUrl,
  setCachedSignedUrl,
} from '@/lib/materialBufferCache';
import { useAuth } from '@/context/AuthContext';
import PdfCanvasReader from './PdfCanvasReader';

/**
 * Visor integrado y protegido de documentos (PDFs en `<canvas>`, diapositivas, resúmenes e imágenes)
 * para escritorio y móvil (iPhone/Android), disponible en modalidad fullscreen (`inline={false}`) o
 * incrustado dentro del reproductor de curso (`inline={true}`).
 */
export default function ProtectedDocumentViewer({
  isOpen,
  onClose,
  material,
  isDark = false,
  inline = false,
  onExpandFullscreen,
}) {
  const { user, firebaseAuthUser } = useAuth();
  const [zoom, setZoom] = useState(1);
  const [useAltPdfViewer, setUseAltPdfViewer] = useState(false);
  const [blobSrc, setBlobSrc] = useState('');
  const [pdfBytes, setPdfBytes] = useState(null);
  const [onDemandSignedUrl, setOnDemandSignedUrl] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState('');
  const [devToolsOpen, setDevToolsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setZoom(1);
    setUseAltPdfViewer(false);
    setDevToolsOpen(false);

    const prevOverflow = !inline ? document.body.style.overflow : '';
    if (!inline) {
      document.body.style.overflow = 'hidden';
    }

    const handleKeyDown = (e) => {
      if (!inline && e.key === 'Escape') {
        onClose?.();
        return;
      }
      const key = e.key.toUpperCase();
      if (
        e.key === 'F12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'I' || key === 'J' || key === 'C')) ||
        ((e.ctrlKey || e.metaKey) && (key === 'U' || key === 'S' || key === 'P'))
      ) {
        e.preventDefault();
      }
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('contextmenu', handleContextMenu);

    // Detección de DevTools acoplado en escritorio (compensando zoom de navegador para evitar falsos positivos)
    const ua = navigator.userAgent || '';
    const isMobile =
      /iPhone|iPad|iPod|Android|Mobile/i.test(ua) ||
      (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) ||
      Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);

    const baselineDpr = window.devicePixelRatio || 1;
    const devToolsInterval = isMobile
      ? null
      : setInterval(() => {
          if (
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            (window.visualViewport?.scale || 1) > 1.02
          ) {
            return;
          }
          const currentDpr = window.devicePixelRatio || 1;
          const zoomScale = currentDpr / baselineDpr;
          const adjustedW = window.innerWidth * zoomScale;
          const adjustedH = window.innerHeight * zoomScale;
          const isOpenNow =
            window.outerWidth - adjustedW > 160 || window.outerHeight - adjustedH > 160;
          setDevToolsOpen(isOpenNow);
        }, 1200);

    return () => {
      if (!inline) {
        document.body.style.overflow = prevOverflow;
      }
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('contextmenu', handleContextMenu);
      if (devToolsInterval) clearInterval(devToolsInterval);
    };
  }, [isOpen, inline, onClose, material?.id, material?.file_url]);

  const sourceType = material
    ? material.source_type ||
      (material.file_url?.includes('drive.google.com') ? 'google_drive_legacy' : 'external_url')
    : '';
  const mimeType = (material?.mime_type || '').toLowerCase();
  const fileName = (material?.file_name || material?.title || '').toLowerCase();

  const isImage =
    sourceType === 'supabase_storage' &&
    (mimeType.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(fileName));

  const isOfficeDoc =
    sourceType === 'supabase_storage' &&
    (mimeType.includes('powerpoint') ||
      mimeType.includes('presentation') ||
      mimeType.includes('word') ||
      /\.(ppt|pptx|doc|docx)$/i.test(fileName));

  const isDrive =
    sourceType === 'google_drive_legacy' ||
    String(material?.file_url || '').includes('drive.google.com') ||
    String(material?.file_url || '').includes('docs.google.com');

  const rawProxyUrl = material
    ? material.proxy_url || material.preview_url || (material.id ? `/api/materials/file/${material.id}` : '')
    : '';
  const signedUrl = material?.signed_url || onDemandSignedUrl || '';

  const useCanvasPdf =
    Boolean(isOpen && material && rawProxyUrl) &&
    sourceType === 'supabase_storage' &&
    !isImage &&
    !isOfficeDoc &&
    !useAltPdfViewer;

  const shouldFetchProtectedFile =
    Boolean(isOpen && material && rawProxyUrl) &&
    sourceType === 'supabase_storage' &&
    (isImage || useCanvasPdf);

  const shouldFetchSignedUrl =
    Boolean(isOpen && material && rawProxyUrl) &&
    sourceType === 'supabase_storage' &&
    !material?.signed_url &&
    (isOfficeDoc || useAltPdfViewer);

  useEffect(() => {
    setOnDemandSignedUrl('');
  }, [material?.id]);

  useEffect(() => {
    if (!shouldFetchSignedUrl) return;
    const cachedUrl = getCachedSignedUrl(user?.uid, material?.id);
    if (cachedUrl) {
      setOnDemandSignedUrl(cachedUrl);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadSignedUrl = async () => {
      setLoadingFile(true);
      setFileError('');
      try {
        const headers = {};
        if (firebaseAuthUser && typeof firebaseAuthUser.getIdToken === 'function') {
          const token = await firebaseAuthUser.getIdToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const sep = rawProxyUrl.includes('?') ? '&' : '?';
        const res = await fetch(`${rawProxyUrl}${sep}mode=signed_url`, {
          headers,
          signal: controller.signal,
        });
        if (!res.ok) {
          let errMsg = `No se pudo preparar la vista previa (${res.status}).`;
          try {
            const errJson = await res.json();
            if (errJson?.error) errMsg = errJson.error;
          } catch {
            // ignore non-json error
          }
          throw new Error(errMsg);
        }
        const data = await res.json();
        if (cancelled) return;
        if (data?.signed_url) {
          setCachedSignedUrl(user?.uid, material?.id, data.signed_url);
          setOnDemandSignedUrl(data.signed_url);
        }
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') return;
        setFileError(err?.message || 'Error generando enlace temporal de lectura.');
      } finally {
        if (!cancelled) setLoadingFile(false);
      }
    };

    loadSignedUrl();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [shouldFetchSignedUrl, rawProxyUrl, user?.uid, firebaseAuthUser, material?.id]);

  useEffect(() => {
    if (!shouldFetchProtectedFile) {
      setBlobSrc('');
      setPdfBytes(null);
      if (!shouldFetchSignedUrl) {
        setLoadingFile(false);
        setFileError('');
      }
      return;
    }

    let cancelled = false;
    let objectUrl = '';
    const controller = new AbortController();

    const cached = getCachedMaterialPayload(user?.uid, material?.id);
    if (cached) {
      setFileError('');
      if (isImage && cached.kind === 'image' && cached.blob) {
        objectUrl = URL.createObjectURL(cached.blob);
        setBlobSrc(objectUrl);
        setPdfBytes(null);
        setLoadingFile(false);
        return () => {
          cancelled = true;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
      }
      if (!isImage && cached.kind === 'pdf' && cached.bytes) {
        setPdfBytes(cached.bytes);
        setBlobSrc('');
        setLoadingFile(false);
        return () => {
          cancelled = true;
        };
      }
    }

    const loadProtectedFile = async () => {
      setLoadingFile(true);
      setFileError('');
      setBlobSrc('');
      setPdfBytes(null);
      try {
        const headers = {};
        if (firebaseAuthUser && typeof firebaseAuthUser.getIdToken === 'function') {
          const token = await firebaseAuthUser.getIdToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }

        const res = await fetch(rawProxyUrl, {
          headers,
          signal: controller.signal,
        });

        if (!res.ok) {
          let errMsg = `No se pudo cargar el documento (${res.status}).`;
          try {
            const errJson = await res.json();
            if (errJson?.error) errMsg = errJson.error;
          } catch {
            // ignore non-json error
          }
          throw new Error(errMsg);
        }

        if (isImage) {
          const fileBlob = await res.blob();
          if (cancelled) return;
          setCachedMaterialPayload(user?.uid, material?.id, {
            kind: 'image',
            blob: fileBlob,
          });
          objectUrl = URL.createObjectURL(fileBlob);
          setBlobSrc(objectUrl);
        } else {
          const buffer = await res.arrayBuffer();
          if (cancelled) return;
          const bytes = new Uint8Array(buffer);
          setCachedMaterialPayload(user?.uid, material?.id, {
            kind: 'pdf',
            bytes,
          });
          setPdfBytes(bytes);
        }
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') return;
        setFileError(err?.message || 'Error al cargar el archivo protegido.');
      } finally {
        if (!cancelled) setLoadingFile(false);
      }
    };

    loadProtectedFile();

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [shouldFetchProtectedFile, shouldFetchSignedUrl, rawProxyUrl, isImage, user?.uid, firebaseAuthUser, material?.id]);

  if (!isOpen || !material) return null;

  let iframeSrc = '';
  if (isDrive) {
    iframeSrc = toDrivePreviewUrl(material.preview_url || material.file_url);
  } else if (isOfficeDoc) {
    iframeSrc = signedUrl
      ? `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(signedUrl)}`
      : rawProxyUrl;
  } else if (sourceType === 'supabase_storage' && useAltPdfViewer && signedUrl) {
    iframeSrc = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(signedUrl)}`;
  } else if (sourceType !== 'supabase_storage') {
    iframeSrc = material.preview_url || material.file_url || '';
  }

  const TypeIcon =
    material.material_type === 'slides'
      ? Presentation
      : material.material_type === 'summary'
        ? BookOpen
        : FileText;

  const typeLabel =
    material.material_type === 'slides'
      ? 'Diapositivas'
      : material.material_type === 'summary'
        ? 'Resumen'
        : 'PDF / Documento';

  const watermarkLabel = user?.email || user?.name || 'Doctemia MC';

  return (
    <div
      className={
        inline
          ? `relative flex flex-col w-full h-full min-h-0 rounded-xl border overflow-hidden shadow-lg select-none ${
              isDark ? 'border-gray-700 bg-slate-950' : 'border-gray-200 bg-slate-100'
            }`
          : 'fixed inset-0 z-[100] flex flex-col h-[100dvh] w-screen bg-black/80 backdrop-blur-sm select-none'
      }
      style={{ WebkitTouchCallout: 'none', userSelect: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Bloquear impresión directa mientras el visor está abierto */}
      <style jsx global>{`
        @media print {
          body {
            display: none !important;
          }
        }
      `}</style>

      {/* Barra superior compacta (adaptada a modal fullscreen o reproductor embebido inline) */}
      <header
        className={`flex items-center justify-between gap-2 px-2.5 sm:px-4 ${
          inline
            ? 'py-2'
            : 'pt-[calc(0.375rem+env(safe-area-inset-top))] pb-1.5 sm:py-2.5'
        } border-b shadow-sm ${
          isDark
            ? 'bg-slate-900 border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {!inline && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Volver atrás"
              title="Volver"
              className={`sm:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 transition-colors ${
                isDark
                  ? 'text-slate-200 hover:bg-slate-800 active:bg-slate-800'
                  : 'text-slate-700 hover:bg-slate-100 active:bg-slate-200'
              }`}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          <div className={`${inline ? 'flex' : 'hidden sm:flex'} p-1.5 rounded-lg bg-blue-600/15 text-blue-500 flex-shrink-0`}>
            <TypeIcon className="w-4 h-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-xs sm:text-sm truncate">
                {material.title || 'Material de Estudio'}
              </h2>
              <span
                className={`hidden sm:inline-flex text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0 ${
                  isDark ? 'bg-slate-800 text-blue-300' : 'bg-blue-50 text-blue-700'
                }`}
              >
                {typeLabel}
              </span>
            </div>
            {(material.especialidad_nombre || material.subtema) && (
              <p className={`hidden sm:block text-[11px] truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {[material.especialidad_nombre, material.subtema].filter(Boolean).join(' • ')}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isImage && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                className={`p-1.5 sm:p-2 rounded-lg border text-xs ${
                  isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-100'
                }`}
                title="Alejar"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="hidden sm:inline text-xs font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
                className={`p-1.5 sm:p-2 rounded-lg border text-xs ${
                  isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-100'
                }`}
                title="Acercar"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          )}

          {sourceType === 'supabase_storage' && !isImage && !isOfficeDoc && rawProxyUrl && (
            <button
              type="button"
              onClick={() => setUseAltPdfViewer((v) => !v)}
              className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                isDark
                  ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
              title="Cambiar entre lector Canvas propio y visor alternativo"
            >
              <RotateCw className="w-3.5 h-3.5" />
              {useAltPdfViewer ? 'Lector Canvas' : 'Visor Alternativo'}
            </button>
          )}

          <span className="hidden lg:inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-500">
            <ShieldCheck className="w-3.5 h-3.5" />
            Lectura Protegida
          </span>

          {inline && onExpandFullscreen && (
            <button
              type="button"
              onClick={onExpandFullscreen}
              aria-label="Abrir documento en pantalla completa"
              title="Pantalla completa"
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer min-h-[34px] ${
                isDark
                  ? 'bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/40'
                  : 'bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white border border-blue-200'
              }`}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Pantalla completa</span>
            </button>
          )}

          {!inline && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar visor"
              className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                isDark
                  ? 'bg-slate-800 hover:bg-red-600 text-slate-200 hover:text-white border border-slate-700'
                  : 'bg-slate-100 hover:bg-red-600 text-slate-700 hover:text-white border border-slate-200'
              }`}
            >
              <X className="w-4 h-4" />
              <span>Cerrar</span>
            </button>
          )}
        </div>
      </header>

      {/* Contenido del visor */}
      <div
        className={`relative flex-1 min-h-0 overflow-hidden ${
          isDark ? 'bg-slate-950' : 'bg-slate-100'
        }`}
      >
        {loadingFile ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <p className={`text-sm font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
              Cargando documento protegido...
            </p>
          </div>
        ) : fileError ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6 text-center max-w-md mx-auto">
            <AlertCircle className="w-9 h-9 text-red-500" />
            <p className={`text-sm font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              {fileError}
            </p>
            {(signedUrl || rawProxyUrl) && !isImage && (
              <button
                type="button"
                onClick={() => {
                  setFileError('');
                  setUseAltPdfViewer(true);
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition cursor-pointer"
              >
                Abrir con Visor Alternativo
              </button>
            )}
          </div>
        ) : useCanvasPdf && pdfBytes ? (
          <PdfCanvasReader
            pdfBytes={pdfBytes}
            materialType={material.material_type}
            watermarkLabel={watermarkLabel}
            isDark={isDark}
            devToolsBlocked={devToolsOpen}
            onFallbackViewer={signedUrl || rawProxyUrl ? () => setUseAltPdfViewer(true) : undefined}
          />
        ) : isImage ? (
          <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
            <img
              src={blobSrc || rawProxyUrl || signedUrl}
              alt={material.title}
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
              style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
              className="max-w-full max-h-full object-contain rounded-lg shadow-xl transition-transform duration-200"
            />
          </div>
        ) : (
          <div className="relative w-full h-full">
            {/* Escudo discreto en la esquina superior derecha para ocultar botón "Abrir en ventana externa" de Drive/GView */}
            {(isDrive || isOfficeDoc || (useAltPdfViewer && signedUrl)) && (
              <div
                className="absolute top-0 right-0 w-16 h-14 z-20"
                onContextMenu={(e) => e.preventDefault()}
                title="Lectura integrada dentro de Doctemia MC"
              />
            )}

            {iframeSrc ? (
              <iframe
                key={iframeSrc}
                src={iframeSrc}
                title={material.title || 'Visor de Documento'}
                className="w-full h-full border-0 bg-white"
                allow="autoplay"
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
