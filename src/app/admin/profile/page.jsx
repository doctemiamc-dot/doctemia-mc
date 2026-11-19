'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Swal from 'sweetalert2';
import { db, auth } from '@/lib/firebase'; // Asegúrate de que db y auth estén importados correctamente
import { doc, updateDoc } from 'firebase/firestore';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { useAuth } from '@/context/AuthContext'; // Para obtener el usuario autenticado
import { useTheme } from '@/context/ThemeContext'; // Para el tema oscuro/claro

const getDefaultAvatarUrl = (isDark = false) =>
  isDark ? '/images/gallooscuro-avatar.webp' : '/images/galloclaro-avatar.webp';

const isDefaultOrLegacyAvatar = (url) => {
  if (!url) return true;
  const normalized = String(url).trim();
  return (
    normalized === '' ||
    normalized === '/icons/user.jpg' ||
    normalized === '/icons/user.png' ||
    normalized === '/images/galloclaro-avatar.webp' ||
    normalized === '/images/gallooscuro-avatar.webp'
  );
};

const convertGoogleDriveUrl = (url, isDark = false) => {
  if (isDefaultOrLegacyAvatar(url)) return getDefaultAvatarUrl(isDark);
  
  // Si ya es una URL de visualización directa, la devolvemos tal como está
  if (url.includes('drive.google.com/uc?') || url.includes('drive.google.com/thumbnail?')) {
    return url;
  }
  
  // Convertir URL de formato /view a formato de visualización directa
  const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    const fileId = fileIdMatch[1];
    // Usar el formato de thumbnail que funciona mejor para imágenes públicas
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
  }
  
  // Si no es una URL de Google Drive, la devolvemos tal como está
  return url;
};

export default function AdminEditProfilePage() {
  const router = useRouter();
  const { user: authUser, refreshUserData } = useAuth(); // Obtener el usuario autenticado
  const { isDark, isLoaded } = useTheme();

  const [form, setForm] = useState({
    name: '',
    email: '',
    photoURL: '',
    role: '',
    password: '', // Campo para la nueva contraseña
  });
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const [imageError, setImageError] = useState(false);

  // Memoizar swalTheme para evitar bucles de renderizado
  const swalTheme = useMemo(() => ({
    background: isDark ? '#1f2937' : '#ffffff',
    color: isDark ? '#f9fafb' : '#111827',
    confirmButtonColor: '#f59e0b', // Amarillo para consistencia
    cancelButtonColor: '#6b7280',
  }), [isDark]);

  useEffect(() => {
    // Reutilizar el documento de usuario ya sincronizado por AuthContext (0 lecturas extra)
    if (authUser && (authUser.role === 'admin' || authUser.rol === 'admin') && loading) {
      const initialPhoto = isDefaultOrLegacyAvatar(authUser.photoURL)
        ? getDefaultAvatarUrl(isDark)
        : authUser.photoURL;
      setForm({
        name: authUser.name || authUser.displayName || '',
        email: authUser.email || '',
        photoURL: initialPhoto,
        role: authUser.role || authUser.rol || 'admin',
        password: '',
      });
      setImagePreview(initialPhoto);
      setLoading(false);
    } else if (!authUser || (authUser.role !== 'admin' && authUser.rol !== 'admin')) {
      router.push('/login');
    }
  }, [authUser, loading, router, isDark]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (name === 'photoURL') {
      setImagePreview(convertGoogleDriveUrl(value, isDark)); // Convertir URL de Google Drive
      setImageError(false); // Resetear error al cambiar URL
    }
  };

  const handleImageError = () => {
    setImageError(true);
    setImagePreview(getDefaultAvatarUrl(isDark));
  };

  // ✅ NUEVA FUNCIÓN: Usar imagen por defecto
  const handleUseDefaultImage = () => {
    const defaultImageUrl = getDefaultAvatarUrl(isDark);
    setForm(prev => ({ ...prev, photoURL: defaultImageUrl }));
    setImagePreview(defaultImageUrl);
    setImageError(false); // Limpiar cualquier error de imagen anterior
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form || isSubmitting) return;

    // --- Validación de campos obligatorios (name, photoURL) ---
    const requiredFields = ['name', 'photoURL'];
    const missingFields = [];

    for (const field of requiredFields) {
      if (!form[field] || (typeof form[field] === 'string' && form[field].trim() === '')) {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      const fieldNamesMap = {
        name: 'Nombre',
        photoURL: 'URL de la Foto de Perfil',
      };
      const translatedMissingFields = missingFields.map(field => fieldNamesMap[field] || field).join(', ');

      await Swal.fire({
        title: 'Campos Obligatorios',
        text: `Por favor, completa los siguientes campos: ${translatedMissingFields}.`,
        icon: 'warning',
        ...swalTheme,
      });
      return;
    }

    // --- Validación de URL de imagen ---
    if (form.photoURL && imageError) {
      await Swal.fire({
        title: 'URL de Imagen Inválida',
        text: 'La URL de la foto de perfil no es válida o la imagen no se pudo cargar. Por favor, verifica el enlace.',
        icon: 'error',
        ...swalTheme,
      });
      return;
    }

    setIsSubmitting(true);
    const updateData = { ...form };
    
    // Eliminar campos no editables o no relevantes para la actualización de Firestore
    delete updateData.email; // El email no se actualiza desde aquí
    delete updateData.role;  // El rol no se actualiza desde aquí
    
    // Manejo de la contraseña
    const newPassword = updateData.password;
    delete updateData.password; // Eliminar del objeto de actualización de Firestore

    try {
      // 1. Actualizar datos en Firestore
      const adminDocRef = doc(db, 'users', authUser.uid);
      await updateDoc(adminDocRef, updateData);

      // 2. Actualizar contraseña en Firebase Authentication si se proporcionó una nueva
      if (newPassword && newPassword.trim() !== '') {
        if (newPassword.length < 6) {
          throw new Error('La contraseña debe tener al menos 6 caracteres.');
        }
        // Reautenticación no es necesaria para updatePassword en el Admin SDK
        // Pero en el cliente, si se usa updatePassword, Firebase suele requerir reautenticación
        // Aquí asumimos que el admin ya está autenticado y la llamada a la API es segura.
        await updatePassword(auth.currentUser, newPassword); // Usar auth.currentUser para actualizar la contraseña del usuario logueado
        Swal.fire({ title: 'Contraseña Actualizada', text: 'Tu contraseña ha sido cambiada.', icon: 'success', ...swalTheme });
      }

      // 3. Refrescar datos del usuario en el contexto de autenticación (si es necesario)
      if (refreshUserData) {
        await refreshUserData(auth.currentUser); // Asegurar que los datos del contexto se actualicen
      }

      Swal.fire({ title: '¡Actualizado!', text: 'El perfil del administrador ha sido actualizado correctamente.', icon: 'success', ...swalTheme });
      router.push('/admin'); // Redirigir al dashboard de admin o donde sea apropiado
    } catch (err) {
      console.error('Error al actualizar perfil de admin:', err);
      let errorMessage = err.message || 'No se pudo actualizar el perfil del administrador.';
      if (err.code === 'auth/requires-recent-login') {
        errorMessage = 'Por favor, inicia sesión de nuevo para cambiar la contraseña.';
      }
      Swal.fire({ title: 'Error', text: errorMessage, icon: 'error', ...swalTheme });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isLoaded || loading) {
    return (
      <section className="min-h-screen flex items-center justify-center" style={{ backgroundColor: isDark ? '#111827' : '#f9fafb' }}>
        <p style={{ color: isDark ? '#f9fafb' : '#111827' }} className="animate-pulse">Cargando perfil de administrador...</p>
      </section>
    );
  }

  // Si no es admin, redirigir
  if (!authUser || authUser.role !== 'admin') {
    return null; // O un componente de "acceso denegado"
  }

  const labelStyle = { color: isDark ? '#9ca3af' : '#6b7280' };
  const inputStyle = {
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    color: isDark ? '#f9fafb' : '#111827',
    borderColor: isDark ? '#374151' : '#d1d5db'
  };
  const readOnlyInputStyle = { ...inputStyle, backgroundColor: isDark ? '#374151' : '#f3f4f6', cursor: 'not-allowed' };
  const buttonStyle = {
    backgroundColor: isDark ? '#f59e0b' : '#d97706', // Amarillo/Naranja para guardar
    color: '#ffffff',
    transition: 'background-color 0.2s ease-in-out',
    '&:hover': { backgroundColor: isDark ? '#d97706' : '#b45309' }
  };
  const cancelButtonBg = isDark ? '#374151' : '#e5e7eb';
  const cancelButtonColor = isDark ? '#f9fafb' : '#374151';

  return (
    <section 
      className="p-4 md:p-8 min-h-screen"
      style={{ backgroundColor: isDark ? '#111827' : '#f9fafb' }}
    >
      <div 
        className="max-w-3xl mx-auto p-6 md:p-8 rounded-lg shadow-lg border"
        style={{
          backgroundColor: isDark ? '#1f2937' : '#ffffff',
          borderColor: isDark ? '#374151' : '#e5e7eb'
        }}
      >
        <h1 className="text-3xl font-bold mb-2" style={{ color: isDark ? '#f59e0b' : '#d97706' }}>Editar Perfil de Administrador</h1>
        <p className="mb-8" style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>
          Modificando perfil de: <span className="font-semibold" style={{ color: isDark ? 'white' : 'black' }}>{form.name || form.email}</span>
        </p>
        
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          {/* Columna 1 */}
          <div className="space-y-5">
            <div>
              <label htmlFor="name" className="text-sm mb-1 block" style={labelStyle}>Nombre:</label>
              <input name="name" id="name" value={form.name || ''} placeholder="Nombre del Administrador" onChange={handleChange} className="w-full p-3 border rounded-lg" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="email" className="text-sm mb-1 block" style={labelStyle}>Correo Electrónico (no editable):</label>
              <input name="email" id="email" value={form.email || ''} type="email" className="w-full p-3 border rounded-lg" style={readOnlyInputStyle} readOnly />
            </div>
            <div>
              <label htmlFor="role" className="text-sm mb-1 block" style={labelStyle}>Rol (no editable):</label>
              <input name="role" id="role" value={form.role || ''} className="w-full p-3 border rounded-lg" style={readOnlyInputStyle} readOnly />
            </div>
          </div>

          {/* Columna 2 */}
          <div className="space-y-5">
            <div>
              <label htmlFor="photoURL" className="text-sm mb-1 block" style={labelStyle}>URL de la Foto de Perfil:</label>
              <div className="flex items-center gap-2"> {/* Contenedor para input y botón */}
                <input 
                  name="photoURL" 
                  id="photoURL" 
                  value={form.photoURL || ''} 
                  placeholder="https://ejemplo.com/tu-foto.jpg" 
                  onChange={handleChange} 
                  className="w-full p-3 border rounded-lg" 
                  style={inputStyle} 
                />
                <button 
                  type="button" 
                  onClick={handleUseDefaultImage} 
                  className="flex-shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-white bg-blue-500 hover:bg-blue-600 transition"
                >
                  Usar por Defecto
                </button>
              </div>
              {imagePreview && (
                <div className="mt-2 text-center">
                  <p className="text-sm mb-1" style={labelStyle}>Vista Previa:</p>
                  <img 
                    src={convertGoogleDriveUrl(imagePreview, isDark)} 
                    alt="Vista previa de la foto de perfil" 
                    width={128}
                    height={128}
                    className={`w-32 h-32 mx-auto rounded-full border-2 ${isDefaultOrLegacyAvatar(imagePreview) ? 'object-contain p-1' : 'object-cover'}`} 
                    style={{borderColor: isDark ? '#374151' : '#d1d5db'}}
                    onError={handleImageError} // Manejar error de carga de imagen
                  />
                  {imageError && (
                    <p className="text-red-500 text-xs mt-1">URL de imagen inválida o no se pudo cargar.</p>
                  )}
                </div>
              )}
            </div>
            <div>
              <label htmlFor="password" className="text-sm mb-1 block" style={labelStyle}>Nueva Contraseña:</label>
              <input 
                name="password" 
                id="password"
                value={form.password} 
                type="password" 
                onChange={handleChange} 
                className="w-full p-3 border rounded-lg" 
                style={inputStyle}
                placeholder="Dejar en blanco para no cambiar"
              />
            </div>
          </div>

          <div className="md:col-span-2 mt-6 flex justify-end gap-4">
            <button type="button" onClick={() => router.back()} className="px-6 py-3 font-semibold rounded-lg transition hover:opacity-80" style={{backgroundColor: cancelButtonBg, color: cancelButtonColor}}>
              Cancelar
            </button>
            <button type="submit" disabled={isSubmitting} className="px-6 py-3 font-semibold rounded-lg text-white disabled:opacity-50 disabled:cursor-wait transition" style={buttonStyle}>
              {isSubmitting ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
