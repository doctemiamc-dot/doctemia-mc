'use client';

import React from 'react';
import { WifiOff, RefreshCw, ArrowLeft } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-[#FFF9F0] dark:bg-[#162235] text-[#1a2639] dark:text-[#FFF9F0] flex items-center justify-center p-5">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#2E4A70] border border-[#2E4A70]/15 dark:border-white/15 shadow-lg p-6 sm:p-8 text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-[#FFF9F0] dark:bg-[#1a2639]/60 border border-[#014ba0]/15 flex items-center justify-center mb-5 shadow-sm">
          <img
            src="/pwa/icon-192x192.png"
            alt="DOCTEMIA MC"
            className="w-11 h-11 object-contain"
          />
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-xs font-bold mb-3">
          <WifiOff className="w-3.5 h-3.5" />
          <span>Sin conexión a internet</span>
        </div>

        <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight mb-2">
          DOCTEMIA MC requiere conexión
        </h1>
        <p className="text-sm text-[#2E4A70] dark:text-blue-100/85 leading-relaxed mb-6">
          Tus cursos, videos y materiales protegidos se cargan en línea de forma segura. Verifica tu Wi-Fi o datos móviles e intenta nuevamente.
        </p>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-sm font-bold transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Reintentar</span>
          </button>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-[#2E4A70]/25 dark:border-white/20 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Volver</span>
          </button>
        </div>
      </div>
    </div>
  );
}
