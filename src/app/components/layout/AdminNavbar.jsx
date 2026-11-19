'use client';
import { useAuth } from '@/context/AuthContext';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, getDocs, getCountFromServer, query, limit } from 'firebase/firestore'; // Importaciones acotadas para evitar listeners permanentes
import { useTheme } from '@/context/ThemeContext';
// Importamos iconos nuevos, incluyendo KeyRound para las nuevas solicitudes
import {
  Moon, Sun, Home, FileText, Users,
  Wallet, Video, QrCode, Bell, LogOut,
  Star, ShoppingBag, Tags, KeyRound, CreditCard, FolderOpen, RefreshCw, Loader2
} from 'lucide-react';

import NavbarProfileAvatar from './NavbarProfileAvatar';

export default function AdminNavbar({ children }) {
  const { signOut, user } = useAuth();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const { isDark, toggleTheme, isLoaded } = useTheme();
  const [isMobile, setIsMobile] = useState(false);
  const [pendingHref, setPendingHref] = useState(null);
  // ✅ NUEVO ESTADO: Para almacenar el nombre del admin de Firestore
  const [adminName, setAdminName] = useState('Admin'); 

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

  const bellButtonRef = useRef(null);
  const notificationsPanelRef = useRef(null);

  // Hook para detectar si es vista móvil y ajustar el sidebar
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setIsSidebarOpen(true);
      } else {
        setIsSidebarOpen(false);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ✅ Tomar el nombre del admin directamente de AuthContext (0 lecturas extra a Firestore)
  useEffect(() => {
    if (user && (user.role === 'admin' || user.rol === 'admin')) {
      const rawName = user.name || user.fullName || user.displayName || 'Admin';
      const firstName = String(rawName).trim().split(' ')[0] || 'Admin';
      setAdminName(firstName);
    } else {
      setAdminName('Admin');
    }
  }, [user]);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const loadNotificationItems = async ({ force = false } = {}) => {
    if (!user || loadingNotifications || (notificationsLoaded && !force)) return;
    setLoadingNotifications(true);
    try {
      const [premiumSnap, pagoUnicoSnap] = await Promise.all([
        getDocs(query(collection(db, 'solicitudes'), limit(8))),
        getDocs(query(collection(db, 'pagoUnico_solicitudes'), limit(8))),
      ]);
      const premiumData = premiumSnap.docs.map((d) => ({ id: d.id, ...d.data(), type: 'Premium' }));
      const pagoUnicoData = pagoUnicoSnap.docs.map((d) => ({ id: d.id, ...d.data(), type: 'Acceso' }));
      const combined = [...premiumData, ...pagoUnicoData];
      setNotifications(combined);
      setNotificationsLoaded(true);
      if (force) {
        const [pCount, puCount] = await Promise.all([
          getCountFromServer(collection(db, 'solicitudes')),
          getCountFromServer(collection(db, 'pagoUnico_solicitudes')),
        ]);
        const nextCount = (pCount.data().count || 0) + (puCount.data().count || 0);
        setPendingCount(nextCount);
        try {
          window.sessionStorage.setItem(
            'doctemia_admin_pending_count_v1',
            JSON.stringify({ ts: Date.now(), count: nextCount })
          );
        } catch {
          // Ignorar
        }
      }
    } catch (err) {
      console.error('Error cargando notificaciones:', err);
    } finally {
      setLoadingNotifications(false);
    }
  };

  const toggleNotifications = () => {
    const next = !showNotifications;
    setShowNotifications(next);
    if (next && !notificationsLoaded) {
      loadNotificationItems();
    }
  };

  // Hook para cerrar el panel de notificaciones al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        notificationsPanelRef.current &&
        !notificationsPanelRef.current.contains(event.target) &&
        bellButtonRef.current &&
        !bellButtonRef.current.contains(event.target)
      ) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Conteo ligero cacheado en sessionStorage (TTL 3 min) para evitar lecturas en cada cambio de ruta
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    const CACHE_KEY = 'doctemia_admin_pending_count_v1';
    const TTL_MS = 3 * 60 * 1000;

    try {
      const raw = window.sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.ts === 'number' && Date.now() - parsed.ts < TTL_MS) {
          setPendingCount(parsed.count || 0);
          return;
        }
      }
    } catch {
      // Ignorar
    }

    const loadCounts = async () => {
      try {
        const [premiumCountSnap, pagoUnicoCountSnap] = await Promise.all([
          getCountFromServer(collection(db, 'solicitudes')),
          getCountFromServer(collection(db, 'pagoUnico_solicitudes')),
        ]);
        if (!cancelled) {
          const total = (premiumCountSnap.data().count || 0) + (pagoUnicoCountSnap.data().count || 0);
          setPendingCount(total);
          try {
            window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), count: total }));
          } catch {
            // Ignorar
          }
        }
      } catch {
        // Si la cuota está agotada, el navbar sigue operando con 0
      }
    };
    loadCounts();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // --- ITEMS DE NAVEGACIÓN ---
  const navItems = [
    { type: 'link', href: '/admin', label: 'Inicio', icon: <Home className="w-5 h-5" /> },
    { type: 'link', href: '/admin/users', label: 'Usuarios', icon: <Users className="w-5 h-5" /> },
    { type: 'separator' },
    { type: 'link', href: '/admin/courses', label: 'Cursos Premium', icon: <Star className="w-5 h-5" /> },
    { type: 'link', href: '/admin/Cursos_Pago_Unico', label: 'Cursos Pago Único', icon: <ShoppingBag className="w-5 h-5" /> },
    { type: 'link', href: '/admin/Cursos_Pago_Unico/categoria', label: 'Categorías', icon: <Tags className="w-5 h-5" /> },
    { type: 'link', href: '/admin/materiales', label: 'Materiales', icon: <FolderOpen className="w-5 h-5" /> },
    { type: 'separator' },
    { type: 'link', href: '/admin/bank-preguntas', label: 'Exámenes', icon: <FileText className="w-5 h-5" /> },
    { type: 'link', href: '/admin/flashcards', label: 'Tarjetas', icon: <CreditCard className="w-5 h-5" /> },
    { type: 'link', href: '/admin/solicitudes', label: 'Solicitudes Premium', icon: <Wallet className="w-5 h-5" /> },
    { type: 'link', href: '/admin/solicitudes-pago-unico', label: 'Solicitudes de Acceso', icon: <KeyRound className="w-5 h-5" /> },
    { type: 'separator' },
    { type: 'link', href: '/admin/live-classes', label: 'Clases en Vivo', icon: <Video className="w-5 h-5" /> },
    { type: 'link', href: '/admin/qr-gestion', label: 'Gestión de QR', icon: <QrCode className="w-5 h-5" /> },
  ];

  // Estilos condicionales (Midnight Clinical con separación chrome/canvas; modo claro intacto)
  const headerStyle = {
    backgroundColor: isDark ? '#121E34' : '#ffffff',
    borderBottomColor: isDark ? 'rgba(148, 163, 184, 0.22)' : '#e5e7eb',
    boxShadow: isDark ? '0 4px 24px rgba(0, 0, 0, 0.50), inset 0 -1px 0 rgba(56, 214, 224, 0.08)' : undefined,
    color: isDark ? '#F1F5F9' : '#111827',
  };
  const sidebarStyle = {
    backgroundColor: isDark ? '#121E34' : '#ffffff',
    borderRightColor: isDark ? 'rgba(148, 163, 184, 0.24)' : '#e5e7eb',
    boxShadow: isDark ? '8px 0 32px rgba(0, 0, 0, 0.55), inset -1px 0 0 rgba(56, 214, 224, 0.10)' : undefined,
  };
  const mainStyle = { backgroundColor: isDark ? '#060A13' : '#f9fafb' };
  const notificationPanelStyle = { backgroundColor: isDark ? '#152238' : '#ffffff', borderColor: isDark ? 'rgba(148, 163, 184, 0.24)' : '#e2e8f0', color: isDark ? '#E2E8F0' : '#4a5568' };
  const notificationItemStyle = { borderBottomColor: isDark ? 'rgba(148, 163, 184, 0.16)' : '#e2e8f0' };
  const emptyNotificationStyle = { color: isDark ? '#94A3B8' : '#718096' };

  if (!isLoaded) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: isDark ? '#060A13' : '#ffffff' }}>
        <div className="animate-pulse">
          <div className="h-16" style={{ backgroundColor: isDark ? '#121E34' : '#f3f4f6' }}></div>
        </div>
      </div>
    );
  }

  return (
    <>
      {isMobile && isSidebarOpen && <div className="fixed inset-0 bg-black/60 z-30" onClick={toggleSidebar}></div>}

      {/* Header */}
      <header className="border-b px-4 py-3 flex justify-between items-center fixed top-0 left-0 w-full z-40 shadow-sm transition-colors duration-200" style={headerStyle}>
        <div className="flex items-center gap-4">
          <div className="cursor-pointer" onClick={toggleSidebar}>
            <div className={`w-6 h-0.5 mb-1 transition-all duration-300 ${isDark ? 'bg-gray-300' : 'bg-gray-600'} ${isSidebarOpen ? 'rotate-45 translate-y-1.5' : ''}`}></div>
            <div className={`w-6 h-0.5 transition-all duration-300 ${isDark ? 'bg-gray-300' : 'bg-gray-600'} ${isSidebarOpen ? 'opacity-0' : ''}`}></div>
            <div className={`w-6 h-0.5 mt-1 transition-all duration-300 ${isDark ? 'bg-gray-300' : 'bg-gray-600'} ${isSidebarOpen ? '-rotate-45 -translate-y-1.5' : ''}`}></div>
          </div>
          <div className="flex items-center gap-1">
            <img src="/icons/udemy.png" alt="logo" className="w-7" />
            <span className={`font-bold text-lg ${isDark ? 'text-white' : 'text-gray-800'}`}>DOCTEMIA MC</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={toggleTheme} className={`p-2 rounded-lg transition-all duration-200 ${isDark ? 'bg-[#1C2C47] border border-white/15 hover:bg-[#253A5E]' : 'bg-gray-100 hover:bg-gray-200'}`}>
            {isDark ? <Sun className="w-5 h-5 text-amber-300" /> : <Moon className="w-5 h-5 text-gray-700" />}
          </button>
          <button ref={bellButtonRef} onClick={toggleNotifications} aria-label="Notificaciones" className={`relative p-2 rounded-lg transition-all duration-200 ${isDark ? 'hover:bg-white/[0.06]' : 'hover:bg-gray-100'}`}>
            <Bell className={`w-6 h-6 ${isDark ? 'text-gray-300' : 'text-gray-600'}`} />
            {pendingCount > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">{pendingCount > 9 ? '9+' : pendingCount}</span>}
          </button>
          {showNotifications && (
            <div ref={notificationsPanelRef} className="absolute right-4 top-16 w-80 max-h-[80vh] overflow-y-auto rounded-lg shadow-xl border z-50 flex flex-col" style={notificationPanelStyle}>
              <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                <h3 className={`text-lg font-semibold ${isDark ? 'text-[#24B0BA]' : 'text-blue-600'}`}>Notificaciones</h3>
                <button
                  type="button"
                  onClick={() => loadNotificationItems({ force: true })}
                  disabled={loadingNotifications}
                  title="Actualizar notificaciones"
                  className="p-1.5 rounded-lg opacity-75 hover:opacity-100 cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingNotifications ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="flex-grow p-2">
                {loadingNotifications && !notificationsLoaded ? (
                  <p className="text-center p-4 text-sm" style={emptyNotificationStyle}>Cargando notificaciones...</p>
                ) : notifications.length === 0 ? (
                  <p className="text-center p-4" style={emptyNotificationStyle}>No hay notificaciones pendientes.</p>
                ) : (
                  notifications.map((notification, index) => (
                    <div key={notification.id || index} className="p-3 border-b last:border-b-0" style={notificationItemStyle}>
                      <p className="text-sm font-medium" style={{color: isDark ? '#e2e8f0' : '#4a5568'}}>
                        <span className="font-semibold">{notification.userName}</span> solicitó {notification.type === 'Acceso' ? 'acceso a Cursos.' : `el curso ${notification.courseName}.`}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          {/* ✅ CAMBIO: Foto de perfil y botón de cerrar sesión en el header (solo para desktop) */}
          {!isMobile && user && (
            <div className="flex items-center gap-2.5">
              <Link
                href="/admin/profile"
                aria-label="Ir a mi perfil"
                title="Mi Perfil"
                className="group inline-flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#24B0BA]"
              >
                <NavbarProfileAvatar isDark={isDark} sizeClass="w-9 h-9" pixelSize={36} alt="" />
              </Link>
              <button
                type="button"
                onClick={signOut}
                className={`px-4 py-2 text-white rounded-lg font-medium transition-all duration-200 ${isDark ? 'bg-[#1C2C47] border border-white/15 hover:bg-red-600/90 hover:border-red-500/40' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Sidebar */}
      <div
        className="fixed top-0 left-0 h-full pt-16 border-r shadow-lg transition-all duration-300 ease-in-out flex flex-col"
        style={{
          width: isSidebarOpen ? '16rem' : '4rem',
          transform: isMobile ? (isSidebarOpen ? 'translateX(0)' : 'translateX(-100%)') : 'translateX(0)',
          zIndex: isMobile ? 35 : 20,
          ...sidebarStyle
        }}
      >
        <nav className="flex-grow overflow-y-auto overflow-x-hidden">
          <ul className="space-y-1 px-2 mt-4">
            {navItems.map((item, index) => {
              if (item.type === 'separator') {
                return <li key={index}><hr className={`my-2 ${isDark ? 'border-gray-700' : 'border-gray-200'}`} /></li>;
              }
              const isPending = pendingHref === item.href && pathname !== item.href;
              const isItemActive = isPending || pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => handleNavClick(item.href)}
                    className={`flex items-center gap-4 px-2 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group ${isItemActive ? (isDark ? 'bg-[#24B0BA]/15 text-[#38D6E0] border border-[#24B0BA]/30' : 'bg-blue-100 text-blue-600') : (isDark ? 'hover:bg-white/[0.06] text-slate-200' : 'hover:bg-gray-100 text-gray-700')}`}
                  >
                    {item.icon}
                    {isSidebarOpen && <span className="truncate font-medium">{item.label}</span>}
                    {isSidebarOpen && isPending && <Loader2 className="w-4 h-4 ml-auto animate-spin shrink-0 opacity-80" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Sección de usuario en el sidebar */}
        {user && (
          <div className={`border-t p-2 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className={`flex items-center transition-all duration-300 ${isSidebarOpen ? 'flex-row gap-3' : 'flex-col gap-2'}`}>
              {/* ✅ CAMBIO: Contenedor clicable para la foto y el nombre */}
              <Link
                href="/admin/profile"
                aria-label="Ir a mi perfil"
                title="Mi Perfil"
                onClick={() => handleNavClick('/admin/profile')}
                className={`flex items-center transition-all duration-300 cursor-pointer group ${isSidebarOpen ? 'flex-row gap-3 flex-grow min-w-0' : 'justify-center'}`}
              >
                <NavbarProfileAvatar
                  isDark={isDark}
                  sizeClass={isSidebarOpen ? 'w-10 h-10' : 'w-8 h-8'}
                  pixelSize={isSidebarOpen ? 40 : 32}
                  alt=""
                />
                {isSidebarOpen && (
                  <div className="flex-grow min-w-0">
                    {/* ✅ CAMBIO: Mostrar adminName (primera palabra del nombre) */}
                    <span className={`block truncate text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{adminName}</span>
                  </div>
                )}
              </Link>
              {/* El botón de cerrar sesión se mueve al header para desktop, se mantiene oculto en mobile aquí */}
              {!isSidebarOpen && ( // Solo mostrar el icono de cerrar sesión si el sidebar está colapsado en mobile
                <button
                  type="button"
                  onClick={signOut}
                  aria-label="Cerrar sesión"
                  title="Cerrar sesión"
                  className={`rounded-lg transition-all duration-300 p-1 text-gray-500 hover:text-red-500`}
                >
                  <LogOut className="w-5 h-5" />
                </button>
              )}
            </div>
            {isSidebarOpen && ( // Mostrar el botón de cerrar sesión completo solo si el sidebar está abierto
              <button
                type="button"
                onClick={signOut}
                className={`mt-2 w-full p-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-all duration-200`}
              >
                Cerrar sesión
              </button>
            )}
          </div>
        )}
      </div>

      {/* Contenido Principal */}
      <main
        className="pt-16 transition-all duration-300 ease-in-out min-h-screen"
        style={{
          paddingLeft: isMobile ? '0' : (isSidebarOpen ? '16rem' : '4rem'),
          ...mainStyle
        }}
      >
        <div className="p-0">
          {children}
        </div>
      </main>
    </>
  );
}
