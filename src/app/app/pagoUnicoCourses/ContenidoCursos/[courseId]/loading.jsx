'use client';

import { useTheme } from '@/context/ThemeContext';
import { Loader2 } from 'lucide-react';

export default function CourseContentLoading() {
  const { isDark } = useTheme();

  return (
    <div
      className={`min-h-[calc(100vh-4rem)] px-3 sm:px-6 py-6 transition-colors ${
        isDark ? 'bg-[#060A13] text-slate-200' : 'bg-gray-100 text-gray-900'
      }`}
    >
      <div className="max-w-[1800px] mx-auto space-y-5">
        <div
          className={`h-14 rounded-xl border animate-pulse ${
            isDark ? 'bg-[#152238] border-white/10' : 'bg-white border-gray-200'
          }`}
        />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div
            className={`lg:col-span-8 xl:col-span-9 aspect-video rounded-xl border flex flex-col items-center justify-center gap-3 ${
              isDark ? 'bg-[#152238] border-white/10' : 'bg-white border-gray-200'
            }`}
          >
            <Loader2
              className={`w-10 h-10 animate-spin ${
                isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
              }`}
            />
            <p className="text-sm font-bold">Abriendo contenido del curso...</p>
          </div>
          <div
            className={`lg:col-span-4 xl:col-span-3 h-80 rounded-xl border animate-pulse ${
              isDark ? 'bg-[#152238] border-white/10' : 'bg-white border-gray-200'
            }`}
          />
        </div>
      </div>
    </div>
  );
}
