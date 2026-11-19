# DarkRever — Respaldo y Guía de Reversión del Modo Oscuro Anterior

Este documento registra **exactamente** cómo funcionaban los estilos en modo oscuro antes de aplicar la actualización **"Midnight Clinical"**, para permitir una reversión rápida y exacta si los clientes prefieren el aspecto anterior.

> El **Modo Claro** no fue alterado en la actualización.

---

## 1. Diagnóstico del Modo Oscuro Anterior

Antes de la actualización coexistían varias paletas desconectadas entre layouts y páginas:
- **Layout Estudiante (`NavbarUser.jsx`):** header, sidebar y `<main>` usaban `#2E4A70` sólido (`style={{ backgroundColor: '#2E4A70' }}`), botón de tema `#3b8eed`, botón móvil de salida `#030303ff`, borde de avatar `#000000ff` y enlaces activos `bg-[#24B0BA] text-white`.
- **Layout Admin (`AdminNavbar.jsx` vs `admin/layout.jsx`):** `AdminNavbar` usaba `#1f2937` (header/sidebar), `#111827` (main), `#2d3748` (notificaciones) y `#374151` (bordes), mientras `admin/layout.jsx` usaba `bg-[#1a2639]`.
- **Páginas internas (`/app/*` y `/admin/*`):** mezclaban `bg-[#1a2639]`, `bg-[#1e293b]`, `bg-[#162235]` con `bg-gray-900`, `bg-gray-800`, `bg-gray-700`, `bg-slate-900`, `bg-slate-800` y `border-gray-700`.

### Inventario en `src/` previo al cambio
- `bg-[#1e293b]`: 143 usos (`bg-[#1e293b]/95`: 4, `border-[#1e293b]`: 1)
- `bg-[#162235]`: 121 usos (`bg-[#162235]/80`: 5, `/60`: 4, `/65`: 2, `/85`: 1, `/55`: 1, `/50`: 1)
- `bg-[#1a2639]`: 48 usos (`bg-[#1a2639]/60`: 1)
- `bg-[#0f172a]`: 5 usos
- `bg-gray-800`: 85 usos (`bg-gray-800/40`: 7, `/95`: 2, `/80`: 1, `/70`: 1, `/50`: 1)
- `bg-gray-900`: 46 usos (`bg-gray-900/40`: 7, `/50`: 5, `/60`: 5, `/70`: 4, `/30`: 2, `/35`: 1, `/95`: 1)
- `bg-gray-700`: 59 usos (`bg-gray-700/50`: 2, `/60`: 2, `/80`: 1, `/70`: 1)
- `bg-slate-800`: 19 usos (`bg-slate-800/80`: 1, `/70`: 1, `/95`: 1)
- `bg-slate-900`: 5 usos (`bg-slate-900/70`: 3, `/90`: 2, `/65`: 1, `/60`: 1, `/55`: 1, `/50`: 1, `/95`: 1)
- `bg-slate-700`: 13 usos (`bg-slate-700/80`: 2, `/70`: 1, `/35`: 1)
- `bg-slate-950`: 2 usos (`bg-slate-950/75`: 2, `/85`: 1, `/60`: 1, `/45`: 1, `/20`: 1)
- `border-gray-700`: 74 usos (`/80`: 3), `border-gray-800`: 4
- `border-slate-700`: 23 usos (`/80`: 3), `border-slate-800`: 1, `divide-slate-700`: 1 (`/70`: 1)

---

## 2. Copias Verbatim de Archivos Modificados (Pre-Cambio)

### 2.1 `src/app/globals.css`
```css
/* src/app/globals.css */
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #111827;
    --foreground: #f9fafb;
  }
}

/* Evitar el parpadeo durante la carga */
html {
  color-scheme: light dark;
}

/* Transiciones suaves para el cambio de tema */
* {
  transition-property: background-color, border-color, color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 200ms;
}

/* Estilos base para el body */
body {
  background-color: var(--background);
  color: var(--foreground);
}

/* Estilos para el scrollbar en modo oscuro */
.dark ::-webkit-scrollbar {
  width: 8px;
}

.dark ::-webkit-scrollbar-track {
  background: #374151;
}

.dark ::-webkit-scrollbar-thumb {
  background: #6b7280;
  border-radius: 4px;
}

.dark ::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}

/* Estilos para el scrollbar en modo claro */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: #f3f4f6;
}

::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}
```

---

### 2.2 `src/app/layout.js` (líneas relevantes `7-15` y `49`)
```js
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#014ba0' },
    { media: '(prefers-color-scheme: dark)', color: '#2E4A70' },
  ],
};
```
```jsx
      <body className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-white transition-colors duration-200">
```

---

### 2.3 `src/app/components/layout/NavbarUser.jsx` (secciones de estilos oscuros `99-315`)
```jsx
  // Paleta de colores: #014ba0, #FFF9F0, #24B0BA, #F0F2F2, #2E4A70, #CF8A40
  const headerBg = isDark 
    ? 'text-white border-gray-700' 
    : 'text-gray-900 border-gray-200';
  
  const sidebarBg = isDark 
    ? 'border-gray-700' 
    : 'border-gray-200';
  
  const mainBg = isDark 
    ? 'bg-gray-900 text-gray-100' 
    : 'text-gray-900';

  const headerStyle = isDark
    ? { backgroundColor: '#2E4A70' } // Azul oscuro para modo oscuro
    : { backgroundColor: '#FFFFFF' };

  const sidebarStyle = isDark
    ? { backgroundColor: '#2E4A70' } // Azul oscuro para modo oscuro
    : { backgroundColor: '#FFF9F0' };

  const mainStyle = isDark
    ? { backgroundColor: '#2E4A70' } // Azul oscuro para modo oscuro
    : { backgroundColor: '#FFF9F0' };
```
Botón de tema y acciones en header:
```jsx
          <button 
            onClick={toggleTheme} 
            className={`p-2 rounded-lg transition-all hover:bg-white/10`}
            style={{ backgroundColor: isDark ? '#3b8eed' : '#F0F2F2' }}
          >
            {isDark ? <Sun className="w-5 h-5 text-yellow-400" /> : <Moon className="w-5 h-5 text-gray-700" />}
          </button>
          ...
                <img 
                  src={user.photoURL || '/icons/user.png'} 
                  alt="user" 
                  className={`w-9 h-9 rounded-full border-2 transition-all hover:border-opacity-80`}
                  style={{ borderColor: isDark ? '#000000ff' : '#000000ff' }}
                />
          ...
              <button 
                onClick={signOut} 
                className={`sm:hidden p-2 rounded-lg transition-all hover:opacity-90 text-white`}
                style={{ backgroundColor: '#030303ff' }}
              >
                <LogOut className="w-5 h-5" />
              </button>
```
Separadores, enlaces activos, dropdowns e instalar PWA en sidebar:
```jsx
                    <span 
                      className={`text-[10px] font-black uppercase tracking-[0.15em] opacity-60 ${
                        isDark ? 'text-blue-300' : 'text-[#2E4A70]'
                      }`}
                    >
                      {item.label}
                    </span>
```
```jsx
                    <button 
                      onClick={() => handleDropdownClick(item.label)} 
                      className={`w-full flex items-center justify-between gap-4 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                        isParentActive && !isOpen 
                          ? (isDark ? 'bg-[#24B0BA] text-[#FFF9F0]' : 'bg-[#014ba0] text-white')
                          : (isDark ? 'text-[#FFF9F0] hover:bg-[#24B0BA]/10' : 'text-[#2E4A70] hover:bg-[#F0F2F2]')
                      }`}
                    >
```
```jsx
                              <Link 
                                href={subItem.href} 
                                className={`flex items-center gap-4 px-3 py-2 rounded-xl transition-all duration-200 text-sm group ${
                                  active 
                                    ? (isDark ? 'bg-[#24B0BA] text-[#FFF9F0]' : 'bg-[#014ba0] text-white shadow-md')
                                    : (isDark ? 'text-[#F0F2F2] hover:bg-[#24B0BA]/10' : 'text-[#2E4A70] hover:bg-[#F0F2F2]')
                                }`}
                              >
```
```jsx
                  <Link 
                    href={item.href} 
                    className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 group ${
                      active 
                        ? (isDark ? 'bg-[#24B0BA] text-white shadow-md' : 'bg-[#014ba0] text-white shadow-md')
                        : (isDark ? 'text-[#FFF9F0] hover:bg-white/10' : 'text-[#2E4A70] hover:bg-[#F0F2F2]')
                    }`}
                  >
```
```jsx
              className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                isDark
                  ? 'bg-[#24B0BA] hover:bg-[#1e9ca5] text-white'
                  : 'bg-[#014ba0] hover:bg-[#013b80] text-white'
              }`}
```

---

### 2.4 `src/app/components/layout/AdminNavbar.jsx` (secciones de estilos oscuros `206-359`)
```jsx
  const headerStyle = { backgroundColor: isDark ? '#1f2937' : '#ffffff', borderBottomColor: isDark ? '#374151' : '#e5e7eb', color: isDark ? '#f9fafb' : '#111827' };
  const sidebarStyle = { backgroundColor: isDark ? '#1f2937' : '#ffffff', borderRightColor: isDark ? '#374151' : '#e5e7eb' };
  const mainStyle = { backgroundColor: isDark ? '#111827' : '#f9fafb' };
  const notificationPanelStyle = { backgroundColor: isDark ? '#2d3748' : '#ffffff', borderColor: isDark ? '#4a5568' : '#e2e8f0', color: isDark ? '#e2e8f0' : '#4a5568' };
  const notificationItemStyle = { borderBottomColor: isDark ? '#4a5568' : '#e2e8f0' };
  const emptyNotificationStyle = { color: isDark ? '#cbd5e0' : '#718096' };

  if (!isLoaded) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: isDark ? '#111827' : '#ffffff' }}>
        <div className="animate-pulse">
          <div className="h-16" style={{ backgroundColor: isDark ? '#1f2937' : '#f3f4f6' }}></div>
        </div>
      </div>
    );
  }
```
Controles en header y sidebar de admin:
```jsx
<button onClick={toggleTheme} className={`p-2 rounded-lg transition-all duration-200 ${isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'}`}>
```
```jsx
<h3 className={`text-lg font-semibold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>Notificaciones</h3>
```
```jsx
<Link href={item.href} className={`flex items-center gap-4 px-2 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group ${pathname === item.href ? (isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-600') : (isDark ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-700')}`}>
```
```jsx
<button onClick={signOut} className={`px-4 py-2 text-white rounded-lg font-medium transition-all duration-200 ${isDark ? 'bg-blue-500 hover:bg-blue-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
```

---

### 2.5 `src/app/admin/layout.jsx` (`L36-65`)
```jsx
      <div
        className={`min-h-screen flex items-center justify-center transition-colors duration-200 ${
          isDark ? 'bg-[#1a2639]' : 'bg-[#FFF9F0]'
        }`}
      >
...
    <div
      className={`min-h-screen transition-colors duration-200 ${
        isDark ? 'bg-[#1a2639]' : 'bg-[#FFF9F0]'
      }`}
    >
      <AdminNavbar>{children}</AdminNavbar>
    </div>
```

---

### 2.6 `src/app/app/page.jsx` (`AnimatedBackground`, tarjetas y Hero)
```jsx
    if (isDark) {
      return {
        background: `linear-gradient(135deg,
          #1a2639 0%,
          rgba(36, 176, 186, 0.14) 35%,
          rgba(1, 75, 160, 0.18) 65%,
          #1a2639 100%)`,
      };
    }
```
Tarjetas oscuras (`TeamMemberCard`, `AccessCard`, `FeatureCard`, y bloque de Creadores):
```jsx
// TeamMemberCard
  const frontSurface = isDark
    ? 'bg-[#1e293b]/95 border-white/10 text-white hover:border-[#73C7E3]/60'
    : 'bg-white/95 border-[#2E4A70]/15 text-[#1a2639] hover:border-[#73C7E3]';
  const backSurface = isDark
    ? 'bg-[#162235] border-[#24B0BA]/35 text-slate-200'
    : 'bg-[#FAF5EB] border-[#73C7E3]/45 text-[#2E4A70]';

// AccessCard
  const cardSurface = isDark
    ? 'bg-[#1e293b]/95 border-white/10 hover:border-[#73C7E3]/60'
    : 'bg-white/95 border-[#2E4A70]/15 hover:border-[#014ba0]/45';

// FeatureCard
  const cardSurface = isDark
    ? 'bg-[#1e293b]/95 border-white/10 hover:border-[#CF8A40]/60'
    : 'bg-white/95 border-[#2E4A70]/15 hover:border-[#CF8A40]/70';

// Sección Creadores
  isDark ? 'bg-[#1e293b]/95 border-white/10 hover:border-[#73C7E3]/45' : ...
  isDark ? 'bg-[#162235]' : 'bg-[#FAF5EB]'
  isDark ? 'bg-[#162235] border-white/10 hover:border-[#73C7E3]/60 text-white' : ...
```
Hero (`L544-570`):
```jsx
        <section
          ref={heroSectionRef}
          className="md:min-h-[calc(100dvh-4rem)] w-full flex flex-col items-center justify-center text-center text-white relative overflow-hidden px-4 py-10 sm:py-14 md:py-16"
          style={{
            background:
              'radial-gradient(circle at 30% 25%, #014ba0 0%, #1a2639 55%, #0f172a 100%)',
          }}
        >
...
          <div
            className="absolute inset-0 bg-gradient-to-b from-[#0f172a]/70 via-[#0f172a]/60 to-[#0f172a]/85 z-10"
            aria-hidden="true"
          />
```

---

## 3. Cómo revertir al Modo Oscuro Anterior

### Opción A — Reversión manual exacta
1. Restaurar el bloque CSS de la sección `2.1` en `src/app/globals.css` (eliminando la sección `/* === MIDNIGHT CLINICAL DARK THEME === */` y restaurando el scrollbar `.dark` original).
2. Restaurar los bloques exactos de las secciones `2.2` a `2.6` en:
   - `src/app/layout.js`
   - `src/app/components/layout/NavbarUser.jsx`
   - `src/app/components/layout/AdminNavbar.jsx`
   - `src/app/admin/layout.jsx`
   - `src/app/app/page.jsx`

### Opción B — Si aún no hay cambios posteriores en Git
```bash
git checkout -- src/app/globals.css src/app/layout.js src/app/components/layout/NavbarUser.jsx src/app/components/layout/AdminNavbar.jsx src/app/admin/layout.jsx src/app/app/page.jsx
```
