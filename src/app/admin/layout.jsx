//src/app/admin/layout.jsx
'use client';
import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useRouter } from 'next/navigation';
import AdminNavbar from '@/app/components/layout/AdminNavbar';

export default function AdminLayout({ children }) {
  const { user, role, loading } = useAuth();
  const { isDark } = useTheme();
  const router = useRouter();

  useEffect(() => {
    const logoutAndRedirect = async () => {
      if (!loading) {
        if (!user) {
          try {
            await fetch('/api/logout', { method: 'POST' });
          } catch (error) {
            console.error('Error al limpiar sesión:', error);
          } finally {
            router.replace('/login');
          }
          return;
        }

        const isAdmin = role === 'admin';
        if (!isAdmin) return router.replace('/app');
      }
    };

    logoutAndRedirect();
  }, [loading, user, role, router]);

  if (loading || !user) {
    return (
      <div
        className={`min-h-screen flex items-center justify-center transition-colors duration-200 ${
          isDark ? 'bg-[#060A13]' : 'bg-[#FFF9F0]'
        }`}
      >
        <div className="text-center">
          <div
            className={`animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4 ${
              isDark ? 'border-[#24B0BA]' : 'border-blue-600'
            }`}
          />
          <p className={`text-lg font-medium ${isDark ? 'text-slate-300' : 'text-gray-600'}`}>
            {loading ? 'Cargando...' : 'Limpiando sesión e iniciando redirección al login...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen transition-colors duration-200 ${
        isDark ? 'bg-[#060A13]' : 'bg-[#FFF9F0]'
      }`}
    >
      <AdminNavbar>{children}</AdminNavbar>
    </div>
  );
}