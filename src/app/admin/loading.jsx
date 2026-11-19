'use client';

import { useTheme } from '@/context/ThemeContext';
import { Loader2 } from 'lucide-react';

export default function AdminRouteLoading() {
  const { isDark } = useTheme();

  return (
    <div
      className={`min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center gap-3 px-4 transition-colors ${
        isDark ? 'bg-[#060A13] text-slate-200' : 'bg-gray-50 text-gray-800'
      }`}
    >
      <Loader2
        className={`w-9 h-9 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-blue-600'}`}
      />
      <p className="text-sm font-bold opacity-80">Cargando panel...</p>
    </div>
  );
}
