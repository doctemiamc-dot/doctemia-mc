'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Download, Share, PlusSquare, WifiOff, X, Smartphone } from 'lucide-react';

const DISMISS_STORAGE_KEY = 'doctemia_pwa_install_dismissed_until';
const DISMISS_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

let sharedDeferredPrompt = null;
const promptSubscribers = new Set();

function notifyPromptSubscribers() {
  promptSubscribers.forEach((cb) => cb(sharedDeferredPrompt));
}

function detectIosSafari() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const isIosDevice =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Excluir navegadores de terceros en iOS que no permiten Añadir a Inicio nativo como Safari
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIosDevice && isSafari;
}

function detectStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

/**
 * Hook ligero para que otros componentes (p. ej. NavbarUser) muestren un botón "Instalar app".
 */
export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(sharedDeferredPrompt);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    setIsStandalone(detectStandalone());
    setIsIos(detectIosSafari());

    const sub = (promptEvent) => setDeferredPrompt(promptEvent);
    promptSubscribers.add(sub);

    const handleInstalled = () => {
      sharedDeferredPrompt = null;
      notifyPromptSubscribers();
      setIsStandalone(true);
    };

    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      promptSubscribers.delete(sub);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const triggerInstall = useCallback(async () => {
    if (sharedDeferredPrompt) {
      sharedDeferredPrompt.prompt();
      const choice = await sharedDeferredPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        sharedDeferredPrompt = null;
        notifyPromptSubscribers();
      }
      return choice?.outcome || 'dismissed';
    }
    if (isIos) {
      window.dispatchEvent(new CustomEvent('doctemia-open-ios-install'));
      return 'ios-guide';
    }
    return 'unavailable';
  }, [isIos]);

  return {
    isStandalone,
    isIos,
    canInstall: !isStandalone && (Boolean(deferredPrompt) || isIos),
    hasNativePrompt: Boolean(deferredPrompt),
    triggerInstall,
  };
}

export default function PwaSupport() {
  const pathname = usePathname();
  const [isOnline, setIsOnline] = useState(true);
  const [isStandalone, setIsStandalone] = useState(true);
  const [isIos, setIsIos] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(true);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsOnline(navigator.onLine);
    setIsStandalone(detectStandalone());
    setIsIos(detectIosSafari());

    try {
      const until = Number(localStorage.getItem(DISMISS_STORAGE_KEY) || 0);
      setDismissed(Date.now() < until);
    } catch {
      setDismissed(false);
    }

    // Registrar Service Worker solo en producción; en desarrollo limpiar para no interferir con HMR
    if ('serviceWorker' in navigator) {
      if (process.env.NODE_ENV === 'production') {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/' })
          .catch((err) => {
            console.warn('No se pudo registrar el Service Worker:', err);
          });
      } else {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          registrations.forEach((registration) => registration.unregister());
        });
        if ('caches' in window) {
          caches.keys().then((keys) => {
            keys
              .filter((k) => k.startsWith('doctemia-mc-'))
              .forEach((k) => caches.delete(k));
          });
        }
      }
    }

    const handleBeforeInstall = (event) => {
      event.preventDefault();
      sharedDeferredPrompt = event;
      setDeferredPrompt(event);
      notifyPromptSubscribers();
    };

    const handleInstalled = () => {
      sharedDeferredPrompt = null;
      setDeferredPrompt(null);
      setIsStandalone(true);
      setShowIosGuide(false);
      notifyPromptSubscribers();
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleOpenIosGuide = () => setShowIosGuide(true);

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayMode = (e) => {
      if (e.matches) setIsStandalone(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('doctemia-open-ios-install', handleOpenIosGuide);
    mediaQuery.addEventListener?.('change', handleDisplayMode);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('doctemia-open-ios-install', handleOpenIosGuide);
      mediaQuery.removeEventListener?.('change', handleDisplayMode);
    };
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    setShowIosGuide(false);
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now() + DISMISS_DAYS_MS));
    } catch {
      // ignore storage errors
    }
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result?.outcome === 'accepted') {
        sharedDeferredPrompt = null;
        setDeferredPrompt(null);
        notifyPromptSubscribers();
      }
      return;
    }
    if (isIos) {
      setShowIosGuide(true);
    }
  };

  // No estorbar dentro del reproductor de clases/PDF ni en paneles admin
  const isImmersiveStudyRoute =
    pathname?.includes('/ContenidoCursos/') ||
    pathname?.startsWith('/admin');

  const showFloatingPrompt =
    !isStandalone &&
    !dismissed &&
    !isImmersiveStudyRoute &&
    (Boolean(deferredPrompt) || isIos);

  return (
    <>
      {/* Indicador discreto cuando no hay red */}
      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-2 left-1/2 -translate-x-1/2 z-[120] inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-amber-600 text-white text-xs font-bold shadow-lg"
        >
          <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Sin conexión a internet</span>
        </div>
      )}

      {/* Banner compacto de instalación PWA */}
      {showFloatingPrompt && !showIosGuide && (
        <div
          className="fixed bottom-4 left-3 right-3 sm:left-auto sm:right-5 sm:w-[360px] z-[90] rounded-2xl bg-white dark:bg-[#1e2f47] text-[#1a2639] dark:text-[#FFF9F0] border border-[#014ba0]/20 dark:border-white/15 shadow-xl p-3.5 flex items-center gap-3"
          style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="w-11 h-11 rounded-xl bg-[#FFF9F0] dark:bg-white p-1.5 border border-[#014ba0]/10 flex-shrink-0 flex items-center justify-center">
            <img
              src="/pwa/icon-192x192.png"
              alt="DOCTEMIA MC"
              className="w-full h-full object-contain"
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold tracking-tight truncate">
              Instala DOCTEMIA MC
            </p>
            <p className="text-[11px] text-[#2E4A70] dark:text-blue-100/80 leading-snug">
              Accede más rápido a tus cursos en pantalla completa.
            </p>
          </div>

          <button
            type="button"
            onClick={handleInstallClick}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold transition-colors flex-shrink-0 cursor-pointer"
          >
            {isIos && !deferredPrompt ? (
              <Smartphone className="w-3.5 h-3.5" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{isIos && !deferredPrompt ? 'Cómo' : 'Instalar'}</span>
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Cerrar aviso de instalación"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Guía paso a paso para iOS Safari */}
      {showIosGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-pwa-title"
          className="fixed inset-0 z-[130] bg-black/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 sm:p-5"
          onClick={() => setShowIosGuide(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1e2f47] text-[#1a2639] dark:text-[#FFF9F0] border border-[#014ba0]/15 dark:border-white/15 shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <img
                  src="/pwa/apple-touch-icon.png"
                  alt="DOCTEMIA MC"
                  className="w-11 h-11 rounded-xl border border-gray-200 object-contain bg-white"
                />
                <div>
                  <h2 id="ios-pwa-title" className="text-sm font-extrabold">
                    Instalar DOCTEMIA MC en iPhone/iPad
                  </h2>
                  <p className="text-xs text-[#2E4A70] dark:text-blue-100/75">
                    Usa la app sin barras del navegador
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIosGuide(false)}
                aria-label="Cerrar guía"
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ol className="space-y-3 text-xs text-[#2E4A70] dark:text-blue-100/90 mb-5">
              <li className="flex items-center gap-3 p-2.5 rounded-xl bg-[#FFF9F0] dark:bg-white/5">
                <span className="w-7 h-7 rounded-lg bg-[#014ba0] text-white flex items-center justify-center flex-shrink-0">
                  <Share className="w-4 h-4" />
                </span>
                <span>
                  Toca el botón <strong>Compartir</strong> en la barra inferior o superior de Safari.
                </span>
              </li>
              <li className="flex items-center gap-3 p-2.5 rounded-xl bg-[#FFF9F0] dark:bg-white/5">
                <span className="w-7 h-7 rounded-lg bg-[#24B0BA] text-white flex items-center justify-center flex-shrink-0">
                  <PlusSquare className="w-4 h-4" />
                </span>
                <span>
                  Desliza y selecciona <strong>&ldquo;Añadir a pantalla de inicio&rdquo;</strong>.
                </span>
              </li>
            </ol>

            <button
              type="button"
              onClick={handleDismiss}
              className="w-full py-2.5 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold transition-colors cursor-pointer"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
