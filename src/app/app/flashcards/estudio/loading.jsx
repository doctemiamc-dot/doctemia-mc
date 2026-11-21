'use client';

import { useTheme } from '@/context/ThemeContext';
import { BrainCircuit } from 'lucide-react';

export default function FlashcardStudyLoading() {
  const { isDark } = useTheme();

  return (
    <div
      className={`flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] transition-colors ${
        isDark ? 'bg-[#060A13] text-slate-200' : 'bg-[#FFF9F0] text-[#1a2639]'
      }`}
    >
      <div className="relative">
        <div
          className={`w-16 h-16 border-4 rounded-full animate-spin ${
            isDark
              ? 'border-[#24B0BA]/20 border-t-[#24B0BA]'
              : 'border-[#014ba0]/20 border-t-[#014ba0]'
          }`}
        />
        <BrainCircuit
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 ${
            isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
          }`}
        />
      </div>
      <p className="mt-4 text-xs font-extrabold uppercase tracking-[0.2em] opacity-70">
        Preparando sesión
      </p>
    </div>
  );
}
