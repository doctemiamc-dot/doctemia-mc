'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  BookOpen,
  Layers,
  Moon,
  Sun,
  Loader2,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from 'lucide-react';

/**
 * Dibuja una marca de agua diagonal sutil pero trazable directamente sobre los píxeles del canvas.
 */
function drawCanvasWatermark(canvas, watermarkText) {
  if (!canvas || !watermarkText) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  const width = canvas.width;
  const height = canvas.height;
  const fontSize = Math.max(14, Math.round(width * 0.022));
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = 'rgba(100, 116, 139, 0.14)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const stepX = Math.max(320, Math.round(width * 0.45));
  const stepY = Math.max(220, Math.round(height * 0.3));

  ctx.translate(width / 2, height / 2);
  ctx.rotate((-28 * Math.PI) / 180);

  for (let y = -height; y <= height; y += stepY) {
    for (let x = -width; x <= width; x += stepX) {
      ctx.fillText(watermarkText, x, y);
    }
  }
  ctx.restore();
}

function PdfPageCanvas({
  pdfDoc,
  pageNumber,
  scale,
  watermarkText,
  nightFilter,
  isDark,
  eager = false,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [isVisible, setIsVisible] = useState(eager);
  const [rendered, setRendered] = useState(false);
  const [pageRatio, setPageRatio] = useState(1.414);

  useEffect(() => {
    if (eager) {
      setIsVisible(true);
      return;
    }
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsVisible(true);
        }
      },
      { rootMargin: '650px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [eager]);

  useEffect(() => {
    if (!isVisible || !pdfDoc) return;
    let cancelled = false;
    let renderTask = null;

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        setPageRatio(baseViewport.height / baseViewport.width);

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * dpr });
        const cssWidth = Math.round(baseViewport.width * scale);
        const cssHeight = Math.round(baseViewport.height * scale);

        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        renderTask = page.render({
          canvasContext: context,
          viewport,
        });
        await renderTask.promise;
        if (cancelled) return;

        drawCanvasWatermark(canvas, watermarkText);
        setRendered(true);
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error(`Error renderizando página ${pageNumber}:`, err);
        }
      }
    };

    setRendered(false);
    renderPage();

    return () => {
      cancelled = true;
      if (renderTask?.cancel) {
        try {
          renderTask.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [isVisible, pdfDoc, pageNumber, scale, watermarkText]);

  return (
    <div
      ref={containerRef}
      data-page-number={pageNumber}
      className={`relative mx-auto rounded-lg shadow-md overflow-hidden select-none transition-colors ${
        isDark ? 'bg-slate-800' : 'bg-white'
      }`}
      style={{
        minHeight: rendered ? undefined : `${Math.round(520 * scale * pageRatio)}px`,
        maxWidth: '100%',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        className="block mx-auto max-w-full h-auto"
        style={
          nightFilter
            ? { filter: 'invert(0.88) hue-rotate(180deg) contrast(0.95)' }
            : undefined
        }
      />
      {!rendered && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500 opacity-70" />
        </div>
      )}
      <div
        className={`absolute bottom-2 right-2 px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-semibold pointer-events-none ${
          isDark ? 'bg-black/60 text-slate-300' : 'bg-slate-900/55 text-white'
        }`}
      >
        {pageNumber}
      </div>
    </div>
  );
}

/**
 * Lector PDF nativo en `<canvas>` optimizado para móvil/PWA y escritorio:
 * - Cero barras superiores cubriendo la página 1.
 * - Cápsula compacta en zona inferior (thumb-zone) que se atenúa al hacer scroll hacia abajo y abre un panel limpio de ajustes desde cualquier página.
 * - Soporte swipe horizontal en modo diapositivas/página única.
 */
export default function PdfCanvasReader({
  pdfBytes,
  materialType = 'pdf',
  watermarkLabel = 'Doctemia MC',
  isDark = false,
  devToolsBlocked = false,
  onFallbackViewer,
}) {
  const scrollContainerRef = useRef(null);
  const touchStartRef = useRef(null);
  const lastScrollTopRef = useRef(0);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [docError, setDocError] = useState('');

  const [viewMode, setViewMode] = useState(materialType === 'slides' ? 'single' : 'scroll');
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [isFitMode, setIsFitMode] = useState(true);
  const [nightFilter, setNightFilter] = useState(false);

  // Panel de personalización cerrado por defecto para nunca tapar la página 1
  const [controlsOpen, setControlsOpen] = useState(false);
  const [pillCompact, setPillCompact] = useState(false);

  const computeFitWidthScale = useCallback(async (docInstance) => {
    if (!docInstance) return 1;
    try {
      const firstPage = await docInstance.getPage(1);
      const vp = firstPage.getViewport({ scale: 1 });
      const viewportWidth =
        scrollContainerRef.current?.clientWidth ||
        (typeof window !== 'undefined' ? window.innerWidth : 375);
      const horizontalPad = viewportWidth < 640 ? 16 : 40;
      const maxReadableWidth =
        viewportWidth >= 1024 ? (vp.width > vp.height ? 1240 : 960) : viewportWidth;
      const available = Math.max(240, Math.min(viewportWidth - horizontalPad, maxReadableWidth));
      const next = Math.max(0.2, Math.min(2.2, Number((available / vp.width).toFixed(2))));
      return next;
    } catch {
      return 1;
    }
  }, []);

  useEffect(() => {
    if (!pdfBytes) return;
    let cancelled = false;
    let loadedDoc = null;

    const loadPdf = async () => {
      setLoadingDoc(true);
      setDocError('');
      setCurrentPage(1);
      setPageInput('1');
      setControlsOpen(false);
      setPillCompact(false);
      try {
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const cloned = new Uint8Array(pdfBytes).slice();
        const loadingTask = pdfjsLib.getDocument({
          data: cloned,
          disableAutoFetch: false,
          disableStream: false,
        });

        loadedDoc = await loadingTask.promise;
        if (cancelled) {
          loadedDoc.destroy?.();
          return;
        }

        const initialFit = await computeFitWidthScale(loadedDoc);
        setFitScale(initialFit);
        setScale(initialFit);
        setIsFitMode(true);
        setPdfDoc(loadedDoc);
        setNumPages(loadedDoc.numPages || 0);
      } catch (err) {
        if (!cancelled) {
          console.error('Error cargando PDF en CanvasReader:', err);
          setDocError('No se pudo renderizar este PDF en el lector protegido.');
        }
      } finally {
        if (!cancelled) setLoadingDoc(false);
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
      if (loadedDoc?.destroy) {
        loadedDoc.destroy().catch(() => null);
      }
    };
  }, [pdfBytes, computeFitWidthScale]);

  // Recalcular ajuste tras montar el contenedor y al rotar pantalla en móvil/PWA
  useEffect(() => {
    if (!pdfDoc || loadingDoc) return;
    let active = true;
    const syncFit = async () => {
      const nextFit = await computeFitWidthScale(pdfDoc);
      if (!active) return;
      setFitScale(nextFit);
      if (isFitMode) {
        setScale(nextFit);
      }
    };
    syncFit();
    window.addEventListener('resize', syncFit);
    return () => {
      active = false;
      window.removeEventListener('resize', syncFit);
    };
  }, [pdfDoc, loadingDoc, isFitMode, computeFitWidthScale]);

  // Navegación con flechas en modo página por página
  useEffect(() => {
    if (viewMode !== 'single' || numPages <= 1) return;
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setCurrentPage((p) => {
          const next = Math.min(numPages, p + 1);
          setPageInput(String(next));
          return next;
        });
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setCurrentPage((p) => {
          const prev = Math.max(1, p - 1);
          setPageInput(String(prev));
          return prev;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, numPages]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const currentTop = container.scrollTop;
    const delta = currentTop - lastScrollTopRef.current;

    if (currentTop <= 20) {
      setPillCompact(false);
    } else if (delta > 14 && currentTop > 60) {
      setPillCompact(true);
      if (controlsOpen) setControlsOpen(false);
    } else if (delta < -16) {
      setPillCompact(false);
    }
    lastScrollTopRef.current = currentTop;

    if (viewMode !== 'scroll') return;
    const pages = container.querySelectorAll('[data-page-number]');
    const midY = currentTop + container.clientHeight * 0.35;
    for (const el of pages) {
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (midY >= top && midY <= bottom) {
        const num = Number(el.getAttribute('data-page-number'));
        if (num && num !== currentPage) {
          setCurrentPage(num);
          setPageInput(String(num));
        }
        break;
      }
    }
  };

  const goToPage = (target) => {
    const clamped = Math.max(1, Math.min(numPages || 1, Number(target) || 1));
    setCurrentPage(clamped);
    setPageInput(String(clamped));
    if (viewMode === 'scroll' && scrollContainerRef.current) {
      const targetEl = scrollContainerRef.current.querySelector(
        `[data-page-number="${clamped}"]`
      );
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleFitWidth = async () => {
    const nextFit = await computeFitWidthScale(pdfDoc);
    setFitScale(nextFit);
    setScale(nextFit);
    setIsFitMode(true);
  };

  const handleStepZoom = (direction) => {
    const base = fitScale || 1;
    const step = Number((base * 0.15).toFixed(3));
    setIsFitMode(false);
    setScale((s) => {
      const minScale = Number((base * 0.5).toFixed(3));
      const maxScale = Number((base * 2.5).toFixed(3));
      const next = direction > 0 ? s + step : s - step;
      return Math.max(minScale, Math.min(maxScale, Number(next.toFixed(3))));
    });
  };

  // Swipe horizontal en modo diapositiva/página única para móviles
  const handleTouchStart = (e) => {
    if (viewMode !== 'single' || e.touches.length !== 1) return;
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e) => {
    if (viewMode !== 'single' || !touchStartRef.current || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0 && currentPage < numPages) {
        goToPage(currentPage + 1);
      } else if (dx > 0 && currentPage > 1) {
        goToPage(currentPage - 1);
      }
    }
  };

  const watermarkText = `${watermarkLabel} • Doctemia MC`;
  const ctrlBtnClass = `inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors min-h-[42px] ${
    isDark
      ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 active:bg-slate-700'
      : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100 active:bg-slate-200'
  }`;

  if (loadingDoc) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <p className={`text-sm font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
          Preparando páginas del documento...
        </p>
      </div>
    );
  }

  if (docError || !pdfDoc) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6 text-center max-w-md mx-auto">
        <ShieldAlert className="w-9 h-9 text-amber-500" />
        <p className={`text-sm font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
          {docError || 'No se pudo cargar el PDF.'}
        </p>
        {onFallbackViewer && (
          <button
            type="button"
            onClick={onFallbackViewer}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition min-h-[44px]"
          >
            Abrir con Visor Alternativo
          </button>
        )}
      </div>
    );
  }

  const pageNumbers =
    viewMode === 'single'
      ? [currentPage]
      : Array.from({ length: numPages }, (_, idx) => idx + 1);

  return (
    <div className="relative flex flex-col w-full h-full min-h-0">
      {/* Área de lectura en Canvas: empieza desde arriba sin ninguna barra tapando la página 1 */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (controlsOpen) setControlsOpen(false);
        }}
        className={`relative flex-1 min-h-0 overflow-auto px-2 py-3 sm:p-5 pb-20 space-y-3 sm:space-y-4 ${
          devToolsBlocked ? 'blur-xl pointer-events-none select-none' : ''
        }`}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        {pageNumbers.map((pageNum) => (
          <PdfPageCanvas
            key={`${pageNum}-${viewMode}`}
            pdfDoc={pdfDoc}
            pageNumber={pageNum}
            scale={scale}
            watermarkText={watermarkText}
            nightFilter={nightFilter}
            isDark={isDark}
            eager={viewMode === 'single' || pageNum <= 2}
          />
        ))}
      </div>

      {/* Panel flotante de personalización (solo aparece cuando el usuario lo pide) */}
      {controlsOpen && !devToolsBlocked && (
        <div
          className={`absolute bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-30 w-[calc(100%-1.5rem)] max-w-md rounded-2xl border shadow-2xl p-3.5 space-y-3 backdrop-blur-md ${
            isDark
              ? 'bg-slate-900/95 border-slate-700 text-slate-100'
              : 'bg-white/95 border-slate-200 text-slate-900'
          }`}
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-700">
            <span className="text-xs font-bold uppercase tracking-wider opacity-75">
              Opciones de lectura
            </span>
            <button
              type="button"
              onClick={() => setControlsOpen(false)}
              aria-label="Cerrar opciones de lectura"
              className="p-1.5 rounded-lg hover:bg-slate-500/15"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Fila 1: Ir a página */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium opacity-80">Página</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => goToPage(currentPage - 1)}
                aria-label="Página anterior"
                className={`${ctrlBtnClass} !px-2.5 disabled:opacity-40`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  goToPage(pageInput);
                }}
                className="flex items-center gap-1.5 text-xs font-semibold"
              >
                <input
                  type="text"
                  inputMode="numeric"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
                  onBlur={() => goToPage(pageInput)}
                  aria-label="Número de página"
                  className={`w-12 text-center rounded-xl border py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[42px] ${
                    isDark
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-white border-slate-300 text-slate-900'
                  }`}
                />
                <span className="opacity-70">/ {numPages}</span>
              </form>
              <button
                type="button"
                disabled={currentPage >= numPages}
                onClick={() => goToPage(currentPage + 1)}
                aria-label="Página siguiente"
                className={`${ctrlBtnClass} !px-2.5 disabled:opacity-40`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Fila 2: Zoom */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium opacity-80">Zoom</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleStepZoom(-1)}
                aria-label="Alejar documento"
                className={ctrlBtnClass}
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono font-semibold w-12 text-center">
                {Math.round((scale / (fitScale || 1)) * 100)}%
              </span>
              <button
                type="button"
                onClick={() => handleStepZoom(1)}
                aria-label="Acercar documento"
                className={ctrlBtnClass}
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleFitWidth}
                className={`${ctrlBtnClass} ${
                  isFitMode ? '!bg-blue-600 !text-white !border-blue-600' : ''
                }`}
              >
                <Maximize className="w-3.5 h-3.5" />
                <span>Ajustar</span>
              </button>
            </div>
          </div>

          {/* Fila 3: Modo Scroll / Página y Lectura Nocturna */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setViewMode((m) => (m === 'scroll' ? 'single' : 'scroll'))}
              className={ctrlBtnClass}
            >
              {viewMode === 'scroll' ? (
                <>
                  <Layers className="w-4 h-4 text-blue-500" />
                  <span>Scroll continuo</span>
                </>
              ) : (
                <>
                  <BookOpen className="w-4 h-4 text-teal-500" />
                  <span>Página a página</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setNightFilter((v) => !v)}
              className={`${ctrlBtnClass} ${
                nightFilter ? '!bg-indigo-600 !text-white !border-indigo-600' : ''
              }`}
            >
              {nightFilter ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span>{nightFilter ? 'Modo normal' : 'Lectura noche'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Píldora inferior compacta: página, zoom rápido visible y ajustes en la zona del pulgar */}
      {!devToolsBlocked && (
        <div
          className={`absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-0.5 sm:gap-1 rounded-full border shadow-lg backdrop-blur-md p-1 max-w-[calc(100vw-1rem)] transition-opacity duration-200 ${
            pillCompact && !controlsOpen ? 'opacity-65 hover:opacity-100' : 'opacity-100'
          } ${
            isDark
              ? 'bg-slate-900/90 border-slate-700 text-slate-100'
              : 'bg-white/92 border-slate-200 text-slate-800'
          }`}
        >
          {viewMode === 'single' && numPages > 1 && (
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => goToPage(currentPage - 1)}
              aria-label="Página anterior"
              className="p-2 rounded-full hover:bg-slate-500/15 disabled:opacity-35 min-w-[34px] min-h-[34px] flex items-center justify-center"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setPillCompact(false);
              setControlsOpen((v) => !v);
            }}
            aria-label="Página actual y opciones"
            className="px-2.5 py-1 rounded-full text-xs font-semibold hover:bg-slate-500/10 min-h-[34px] whitespace-nowrap cursor-pointer"
          >
            {currentPage} / {numPages}
          </button>

          {viewMode === 'single' && numPages > 1 && (
            <button
              type="button"
              disabled={currentPage >= numPages}
              onClick={() => goToPage(currentPage + 1)}
              aria-label="Página siguiente"
              className="p-2 rounded-full hover:bg-slate-500/15 disabled:opacity-35 min-w-[34px] min-h-[34px] flex items-center justify-center"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          <span className={`h-4 w-px mx-0.5 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`} />

          <button
            type="button"
            onClick={() => handleStepZoom(-1)}
            aria-label="Alejar"
            title="Alejar"
            className="p-2 rounded-full hover:bg-slate-500/15 min-w-[34px] min-h-[34px] flex items-center justify-center cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleFitWidth}
            aria-label="Ajustar al 100%"
            title="Ajustar al 100% del ancho"
            className={`px-2 py-1 rounded-full text-[11px] font-mono font-bold transition-colors min-h-[30px] cursor-pointer ${
              isFitMode
                ? 'bg-blue-600 text-white'
                : 'hover:bg-slate-500/15'
            }`}
          >
            {Math.round((scale / (fitScale || 1)) * 100)}%
          </button>

          <button
            type="button"
            onClick={() => handleStepZoom(1)}
            aria-label="Acercar"
            title="Acercar"
            className="p-2 rounded-full hover:bg-slate-500/15 min-w-[34px] min-h-[34px] flex items-center justify-center cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <span className={`h-4 w-px mx-0.5 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`} />

          <button
            type="button"
            onClick={() => {
              setPillCompact(false);
              setControlsOpen((v) => !v);
            }}
            aria-label="Más opciones de lectura"
            title="Más opciones de lectura"
            className={`p-2 rounded-full hover:bg-slate-500/15 min-w-[34px] min-h-[34px] flex items-center justify-center cursor-pointer ${
              controlsOpen ? 'text-blue-500' : ''
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Overlay de bloqueo visual si DevTools acoplado está abierto */}
      {devToolsBlocked && (
        <div className="absolute inset-0 z-30 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center text-center p-6 text-white">
          <ShieldAlert className="w-12 h-12 text-amber-400 mb-3" />
          <h3 className="text-lg sm:text-xl font-bold mb-1.5">
            Herramientas de desarrollo detectadas
          </h3>
          <p className="text-xs sm:text-sm text-slate-300 max-w-md">
            Por seguridad del contenido académico, el documento se oculta mientras las herramientas de inspección estén abiertas. Ciérralas para continuar leyendo.
          </p>
        </div>
      )}
    </div>
  );
}
