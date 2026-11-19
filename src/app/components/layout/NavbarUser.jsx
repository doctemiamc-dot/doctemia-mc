'use client';

import NavbarProfileAvatar from './NavbarProfileAvatar';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { usePwaInstall } from '@/app/components/pwa/PwaSupport';
// --- ✅ MEJORA: Se importa el icono ChevronDown para el desplegable ---
import {
  Home,
  Star,
  ShoppingBag,
  FileText,
  Video,
  UserCircle,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  BookmarkCheck,
  ChevronDown,
  BookMarked,
  FolderOpen,
  Download,
  Loader2
} from 'lucide-react';

export default function NavbarUser({ children }) {
  const { user, signOut } = useAuth();
  const { isDark, toggleTheme, isLoaded } = useTheme();
  const { canInstall, isStandalone, triggerInstall } = usePwaInstall();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [pendingHref, setPendingHref] = useState(null);
  // --- ✅ MEJORA: Estado para controlar el menú desplegable ---
  const [openDropdown, setOpenDropdown] = useState(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    if (!pendingHref) return undefined;
    const timer = setTimeout(() => setPendingHref(null), 8000);
    return () => clearTimeout(timer);
  }, [pendingHref]);

  const handleNavClick = (href) => {
    if (href && href !== pathname) {
      setPendingHref(href);
    }
    if (isMobile) {
      setIsSidebarOpen(false);
    }
  };

  // --- ✅ MEJORA: Estructura de navegación con sub-menús ---
  const navItems = useMemo(() => [
    { href: '/app', label: 'Inicio', Icon: Home },
    { type: 'separator', label: 'Contenido' },

  //Descomentar estqa linea para acceder a cursos premiun----------------------------------------------
/*
    {
      type: 'dropdown',
      label: 'Cursos Premium',
      Icon: Star,
      subItems: [
        { href: '/app/courses', label: 'Catálogo Premium', Icon: ShoppingBag },
        { href: '/app/cursosPagados', label: 'Mis Cursos Adquiridos', Icon: BookmarkCheck },
      ]
    },
*/
 //Descomentar estqa linea para acceder a cursos premiun----------------------------------------------

    /*user?.hasPagoUnicoAccess &&*/ 
    /* Se modifico el nombre de la carpeta coursesPagoUnico a pagoUnicoCourses
    no puede comenzar dos carpetas con la misma palabra porque se van a activar las dos en el sidebar*/
    { href: '/app/pagoUnicoCourses', label: 'Cursos', Icon: BookMarked },
    { href: '/app/materiales', label: 'Materiales', Icon: FolderOpen },
    { type: 'separator', label: 'Herramientas' },
    { href: '/app/flashcards', label: 'Tarjetas de Estudio', Icon: Star },
    { href: '/app/examen-test', label: 'Exámenes', Icon: FileText },
    { href: '/app/clases-en-vivo', label: 'Clases en Vivo', Icon: Video },
    { type: 'separator', label: 'Cuenta' },
    { href: '/app/profile', label: 'Mi Perfil', Icon: UserCircle },
  ].filter(Boolean), [user]);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      setIsSidebarOpen(!mobile);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // Efecto para abrir el dropdown si una de sus rutas secundarias está activa
  useEffect(() => {
     const activeDropdown = navItems.find(item => 
        item.type === 'dropdown' && item.subItems.some(sub => pathname.startsWith(sub.href))
     );
     if (activeDropdown) {
        setOpenDropdown(activeDropdown.label);
     }
  }, [pathname, navItems]);


  const toggleSidebar = () => setIsSidebarOpen(o => !o);
  
  const handleDropdownClick = (label) => {
    setOpenDropdown(openDropdown === label ? null : label);
  };

  // --- ✅ MEJORA: Paleta Midnight Clinical con separación arquitectónica chrome/canvas ---
  const headerBg = isDark 
    ? 'text-[#F1F5F9] border-slate-400/20' 
    : 'text-gray-900 border-gray-200';
  
  const sidebarBg = isDark 
    ? 'border-slate-400/25' 
    : 'border-gray-200';
  
  const mainBg = isDark 
    ? 'bg-[#060A13] text-slate-100' 
    : 'text-gray-900';


  // Estilos dinámicos para el header con la nueva paleta
  const headerStyle = isDark
    ? {
        backgroundColor: '#121E34',
        borderBottomColor: 'rgba(148, 163, 184, 0.22)',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.50), inset 0 -1px 0 rgba(56, 214, 224, 0.08)',
      }
    : { backgroundColor: '#FFFFFF' }; // Blanco para modo claro

  // Estilos dinámicos para el sidebar con la nueva paleta
  const sidebarStyle = isDark
    ? {
        backgroundColor: '#121E34',
        borderRightColor: 'rgba(148, 163, 184, 0.24)',
        boxShadow: '8px 0 32px rgba(0, 0, 0, 0.55), inset -1px 0 0 rgba(56, 214, 224, 0.10)',
      }
    : { backgroundColor: '#FFF9F0' }; // Crema para modo claro

  // Estilos dinámicos para el main con el fondo especificado
  const mainStyle = isDark
    ? { backgroundColor: '#060A13' } // Canvas abisal para contrastar con el sidebar
    : { backgroundColor: '#FFF9F0' }; // Crema para modo claro (fondo solicitado)

  if (!isLoaded) {
    return (
      <div className={`min-h-screen`} style={mainStyle}>
        <div className={`animate-pulse h-16 w-full`} style={headerStyle}></div>
      </div>
    );
  }

  return (
    <>
      {isMobile && isSidebarOpen && <div className="fixed inset-0 bg-black/60 z-[60]" onClick={toggleSidebar}></div>}

      <header 
        className={`fixed top-0 left-0 w-full flex justify-between items-center px-4 py-3 border-b z-[70] shadow-sm transition-colors ${headerBg}`}
        style={headerStyle}
      >
        <div className="flex items-center gap-4">
          <button className="cursor-pointer p-2 hover:bg-white/10 rounded-lg transition-colors" onClick={toggleSidebar}>
            {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
          <div className="flex items-center gap-2">
            <img src="/icons/udemy.png" alt="logo" className="w-7" />
            <span className="font-bold text-lg">DOCTEMIA MC</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={toggleTheme} 
            className={`p-2 rounded-lg transition-all ${isDark ? 'hover:bg-[#253A5E]' : 'hover:bg-white/10'}`}
            style={{
              backgroundColor: isDark ? 'rgba(28, 44, 71, 0.95)' : '#F0F2F2',
              border: isDark ? '1px solid rgba(148, 163, 184, 0.24)' : 'none',
            }}
          >
            {isDark ? <Sun className="w-5 h-5 text-amber-300" /> : <Moon className="w-5 h-5 text-gray-700" />}
          </button>
          {user && (
            <>
              <Link
                href="/app/profile"
                aria-label="Ir a mi perfil"
                title="Mi Perfil"
                className="group hidden sm:inline-flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#24B0BA]"
              >
                <NavbarProfileAvatar isDark={isDark} sizeClass="w-9 h-9" pixelSize={36} alt="" />
              </Link>
              <button 
                onClick={signOut} 
                className={`hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all hover:opacity-90 text-white`}
                style={{ backgroundColor: '#d8220aff' }}
              >
                <LogOut className="w-4 h-4" />
                <span>Salir</span>
              </button>
              <button 
                onClick={signOut} 
                className={`sm:hidden p-2 rounded-lg transition-all hover:opacity-90 text-white`}
                style={{ backgroundColor: isDark ? '#d8220aff' : '#030303ff' }}
              >
                <LogOut className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </header>

      <aside 
        className={`fixed top-0 left-0 h-full pt-16 border-r shadow-lg transition-transform duration-300 ease-in-out flex flex-col ${sidebarBg}`} 
        style={{ 
          transform: isSidebarOpen ? 'translateX(0)' : 'translateX(-100%)', 
          width: '16rem', 
          zIndex: 65,
          ...sidebarStyle
        }}
      >
        <nav className="flex-grow overflow-y-auto overflow-x-hidden mt-4">
          <ul className="space-y-1 px-2">
            {navItems.map((item, index) => {
              if (item.type === 'separator') {
                return (
                  <li key={index} className="px-4 pt-6 pb-2">
                    <span 
                      className={`text-[10px] font-black uppercase tracking-[0.15em] opacity-60 ${
                        isDark ? 'text-[#8FA2BC]' : 'text-[#2E4A70]'
                      }`}
                    >
                      {item.label}
                    </span>
                  </li>
                );
              }
              
              // --- ✅ MEJORA: Lógica para renderizar el menú desplegable ---
              if (item.type === 'dropdown') {
                const isOpen = openDropdown === item.label;
                const isParentActive = item.subItems.some(sub => pathname.startsWith(sub.href));
                
                return (
                  <li key={item.label}>
                    <button 
                      onClick={() => handleDropdownClick(item.label)} 
                      className={`w-full flex items-center justify-between gap-4 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                        isParentActive && !isOpen 
                          ? (isDark ? 'bg-[#24B0BA]/15 text-[#38D6E0] border border-[#24B0BA]/35' : 'bg-[#014ba0] text-white')
                          : (isDark ? 'text-slate-200 hover:bg-white/[0.06] hover:text-white' : 'text-[#2E4A70] hover:bg-[#F0F2F2]')
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <item.Icon className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110`} />
                        <span className="truncate font-semibold tracking-tight">{item.label}</span>
                      </div>
                      <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <ul className="pl-6 mt-1 space-y-1">
                        {item.subItems.map(subItem => {
                          const isPendingSub = pendingHref === subItem.href && pathname !== subItem.href;
                          const active = isPendingSub || pathname.startsWith(subItem.href);
                          return (
                            <li key={subItem.href}>
                              <Link 
                                href={subItem.href} 
                                onClick={() => handleNavClick(subItem.href)}
                                className={`flex items-center gap-4 px-3 py-2 rounded-xl transition-all duration-200 text-sm group ${
                                  active 
                                    ? (isDark ? 'bg-[#24B0BA]/15 text-[#38D6E0] border border-[#24B0BA]/35' : 'bg-[#014ba0] text-white shadow-md')
                                    : (isDark ? 'text-slate-300 hover:bg-white/[0.06] hover:text-white' : 'text-[#2E4A70] hover:bg-[#F0F2F2]')
                                }`}
                              >
                                <subItem.Icon className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 group-hover:scale-110`} />
                                <span className="truncate font-semibold">{subItem.label}</span>
                                {isPendingSub && <Loader2 className="w-3.5 h-3.5 ml-auto animate-spin shrink-0 opacity-80" />}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              }

              const isPending = pendingHref === item.href && pathname !== item.href;
              const active = isPending || pathname === item.href || (item.href !== '/app' && pathname.startsWith(item.href));
              
              return (
                <li key={`${item.href}-${item.label}`}>
                  <Link 
                    href={item.href} 
                    onClick={() => handleNavClick(item.href)}
                    className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 group ${
                      active 
                        ? (isDark ? 'bg-[#24B0BA]/15 text-[#38D6E0] border border-[#24B0BA]/35 shadow-sm' : 'bg-[#014ba0] text-white shadow-md')
                        : (isDark ? 'text-slate-200 hover:bg-white/[0.06] hover:text-white' : 'text-[#2E4A70] hover:bg-[#F0F2F2]')
                    }`}
                  >
                    <item.Icon className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${active ? 'scale-110' : 'group-hover:scale-110'}`} />
                    <span className="truncate font-bold tracking-tight">{item.label}</span>
                    {isPending && <Loader2 className="w-4 h-4 ml-auto animate-spin shrink-0 opacity-80" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {canInstall && !isStandalone && (
          <div className={`p-3 border-t ${isDark ? 'border-white/10' : 'border-[#2E4A70]/10'}`}>
            <button
              type="button"
              onClick={triggerInstall}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                isDark
                  ? 'bg-[#24B0BA] hover:bg-[#2fc4ce] text-[#051B20]'
                  : 'bg-[#014ba0] hover:bg-[#013b80] text-white'
              }`}
            >
              <Download className="w-4 h-4 flex-shrink-0" />
              <span>Instalar app DOCTEMIA MC</span>
            </button>
          </div>
        )}
      </aside>

      <main 
        className={`pt-16 transition-all duration-300 ease-in-out min-h-screen ${mainBg}`} 
        style={{ 
          paddingLeft: isMobile ? '0' : (isSidebarOpen ? '16rem' : '0'),
          ...mainStyle
        }}
      >
        {children}
      </main>
    </>
  );
}