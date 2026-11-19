'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Swal from 'sweetalert2';
import useSWR, { mutate } from 'swr';
import { fetcher } from '@/lib/fetcher';
import { useTheme } from '@/context/ThemeContext';
import { CalendarClock, Sparkles, Lock } from 'lucide-react';
import {
  buildExpirationFields,
  calculateDurationDays,
  formatDateShortEs,
  formatDateTimeBolivia,
  formatExpirationDisplay,
  getBoliviaDateParts,
  isAccountExpired,
} from '@/lib/accountExpiration';

// Función para convertir de forma segura Timestamps de Firestore a formato ISO (YYYY-MM-DD)
const firestoreTimestampToInputDate = (timestamp) => {
  if (!timestamp) return '';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  } catch (error) {
    console.error("Error convirtiendo fecha:", error);
    return '';
  }
};

export default function EditUserPage() {
  const router = useRouter();
  const params = useParams();
  const { userId } = params;
  const { isDark, isLoaded } = useTheme();

  const [form, setForm] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activationNotice, setActivationNotice] = useState(false);

  const singleUserKey = userId
    ? `/api/users?paginated=1&action=single&userId=${encodeURIComponent(userId)}`
    : null;

  // Cargar únicamente 1 documento de usuario en lugar de descargar toda la colección
  const { data: userResponse, error: usersError } = useSWR(singleUserKey, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  
  const swalTheme = useMemo(() => ({
    background: isDark ? '#1f2937' : '#ffffff',
    color: isDark ? '#f9fafb' : '#111827',
    confirmButtonColor: '#f59e0b', // Amarillo para consistencia
    cancelButtonColor: '#6b7280',
  }), [isDark]);

  useEffect(() => {
    if (userResponse && userId) {
      const currentUser = userResponse.user;
      if (currentUser) {
        setForm({
          ...currentUser,
          fechaNacimiento: firestoreTimestampToInputDate(currentUser.fechaNacimiento),
          // Asegurarse de que hasPagoUnicoAccess y active sean booleanos
          hasPagoUnicoAccess: typeof currentUser.hasPagoUnicoAccess === 'boolean' ? currentUser.hasPagoUnicoAccess : false,
          active: typeof currentUser.active === 'boolean' ? currentUser.active : false,
          activeFrom: currentUser.activeFrom || null,
          activeUntil: currentUser.activeUntil ?? null,
          activeDurationMonths: currentUser.activeDurationMonths ?? null,
          password: '', // La contraseña siempre se inicializa vacía para no cambiarla a menos que se ingrese una nueva
        });
        setActivationNotice(false);
      } else {
        // Si el usuario no se encuentra, redirigir o mostrar un error
        Swal.fire({
          title: 'Usuario no encontrado',
          text: 'El usuario que intentas editar no existe.',
          icon: 'error',
          ...swalTheme,
        }).then(() => router.push('/admin/users'));
      }
    }
  }, [userResponse, userId, router, swalTheme]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'hasPagoUnicoAccess' || name === 'active') {
      const boolValue = value === 'true';
      setForm(prev => {
        // Cuando el admin habilita una cuenta de Inactivo -> Activo:
        // reconoce la fecha actual y asigna 3 meses por defecto (personalizable)
        if (name === 'active' && boolValue && !prev.active) {
          const shouldAssignDefault = !prev.activeUntil || isAccountExpired(prev);
          if (shouldAssignDefault) {
            const renewed = buildExpirationFields({ durationType: 'months', activeDurationMonths: 3 });
            setActivationNotice(true);
            return {
              ...prev,
              active: true,
              activeFrom: renewed.activeFrom,
              activeUntil: renewed.activeUntil,
              activeDurationMonths: renewed.activeDurationMonths,
              deactivatedReason: null,
            };
          }
          setActivationNotice(true);
        }
        if (name === 'active' && !boolValue) {
          setActivationNotice(false);
        }
        return { ...prev, [name]: boolValue };
      });
    } else {
      setForm(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleRenewMonths = (months) => {
    const renewed = buildExpirationFields({ durationType: 'months', activeDurationMonths: months });
    setForm(prev => ({
      ...prev,
      active: true,
      activeFrom: renewed.activeFrom,
      activeDurationMonths: renewed.activeDurationMonths,
      activeUntil: renewed.activeUntil,
      deactivatedReason: null,
    }));
  };

  const handleSetUnlimited = () => {
    setForm(prev => ({
      ...prev,
      active: true,
      activeFrom: prev.activeFrom || new Date().toISOString(),
      activeDurationMonths: null,
      activeUntil: null,
      deactivatedReason: null,
    }));
  };

  const handleExactExpirationChange = (e) => {
    const dateVal = e.target.value;
    if (!dateVal) return;
    const currentParts = getBoliviaDateParts(form?.activeUntil);
    const timeVal = currentParts?.timeStr || '23:59';
    const baseStart = form?.activeFrom && !isAccountExpired(form)
      ? new Date(form.activeFrom)
      : new Date();
    const updated = buildExpirationFields({
      durationType: 'exact',
      exactDate: dateVal,
      exactTime: timeVal,
      baseDate: isNaN(baseStart.getTime()) ? new Date() : baseStart,
    });
    setForm(prev => ({
      ...prev,
      active: true,
      activeFrom: prev.activeFrom && !isAccountExpired(prev) ? prev.activeFrom : updated.activeFrom,
      activeDurationMonths: null,
      activeUntil: updated.activeUntil,
      deactivatedReason: null,
    }));
  };

  const handleExactTimeChange = (e) => {
    const timeVal = e.target.value;
    if (!timeVal) return;
    const currentParts = getBoliviaDateParts(form?.activeUntil) || getBoliviaDateParts(new Date());
    const dateVal = currentParts.dateStr;
    const baseStart = form?.activeFrom && !isAccountExpired(form)
      ? new Date(form.activeFrom)
      : new Date();
    const updated = buildExpirationFields({
      durationType: 'exact',
      exactDate: dateVal,
      exactTime: timeVal,
      baseDate: isNaN(baseStart.getTime()) ? new Date() : baseStart,
    });
    setForm(prev => ({
      ...prev,
      active: true,
      activeFrom: prev.activeFrom && !isAccountExpired(prev) ? prev.activeFrom : updated.activeFrom,
      activeDurationMonths: null,
      activeUntil: updated.activeUntil,
      deactivatedReason: null,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form || isSubmitting) return;

    // ✅ INICIO DE LA VALIDACIÓN DE CAMPOS
    // hasPagoUnicoAccess y active NO se incluyen aquí, ya que son selects con valores por defecto
    const requiredFields = [
      'fullName', 'fechaNacimiento', 'sexo', 'telefono', 
      'universidad', 'profesion', 'email'
    ];
    const missingFields = [];

    for (const field of requiredFields) {
      // Trim para eliminar espacios en blanco y verificar si está vacío
      if (!form[field] || (typeof form[field] === 'string' && form[field].trim() === '')) {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      const fieldNamesMap = {
        fullName: 'Nombre completo',
        fechaNacimiento: 'Fecha de Nacimiento',
        sexo: 'Sexo',
        telefono: 'Teléfono',
        universidad: 'Universidad',
        profesion: 'Profesión / Cargo',
        email: 'Correo Electrónico',
      };
      const translatedMissingFields = missingFields.map(field => fieldNamesMap[field] || field).join(', ');

      await Swal.fire({
        title: 'Campos Obligatorios',
        text: `Por favor, completa los siguientes campos: ${translatedMissingFields}.`,
        icon: 'warning',
        ...swalTheme,
      });
      return; // Detener el envío si hay campos faltantes
    }
    // ✅ FIN DE LA VALIDACIÓN DE CAMPOS

    setIsSubmitting(true);
    const updateData = { ...form };
    
    // Si la contraseña está vacía, no la enviamos para que no se cambie
    if (!updateData.password || updateData.password.trim() === '') {
      delete updateData.password;
    }

    // Eliminar los campos que no deben ser enviados si no son relevantes para la actualización
    delete updateData.role;
    delete updateData.id;
    // ✅ active, activeUntil, activeDurationMonths y hasPagoUnicoAccess se conservan para guardarse en Firestore

    try {
      const res = await fetch('/api/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...updateData }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Error desconocido del servidor');
      }

      await Swal.fire({ title: '¡Actualizado!', text: 'El usuario ha sido actualizado correctamente.', icon: 'success', ...swalTheme });
      if (singleUserKey) mutate(singleUserKey);
      router.push('/admin/users');
    } catch (err) {
      await Swal.fire({ title: 'Error', text: err.message || 'No se pudo actualizar el usuario.', icon: 'error', ...swalTheme });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (usersError || !isLoaded) {
    return (
      <section style={{ backgroundColor: isDark ? '#111827' : '#f9fafb' }} className="p-8 min-h-screen text-center">
        <p style={{ color: isDark ? '#fca5a5' : '#ef4444' }}>Error al cargar datos del usuario.</p>
      </section>
    );
  }
  if (!form) {
    return (
      <section style={{ backgroundColor: isDark ? '#111827' : '#f9fafb' }} className="p-8 min-h-screen text-center">
        <p style={{ color: isDark ? '#f9fafb' : '#111827' }} className="animate-pulse">Cargando datos del usuario...</p>
      </section>
    );
  }
  
  const labelStyle = { color: isDark ? '#9ca3af' : '#6b7280' };
  const inputStyle = {
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    color: isDark ? '#f9fafb' : '#111827',
    borderColor: isDark ? '#374151' : '#d1d5db'
  };
  const readOnlyInputStyle = { ...inputStyle, backgroundColor: isDark ? '#374151' : '#f3f4f6', cursor: 'not-allowed' };
  const secondaryButtonStyle = {
    backgroundColor: isDark ? '#374151' : '#e5e7eb',
    color: isDark ? '#f9fafb' : '#374151'
  };

  return (
    <section 
      className="p-4 md:p-8 min-h-screen"
      style={{ backgroundColor: isDark ? '#111827' : '#f9fafb' }}
    >
      <div 
        className="max-w-4xl mx-auto p-6 md:p-8 rounded-lg shadow-lg border"
        style={{
          backgroundColor: isDark ? '#1f2937' : '#ffffff',
          borderColor: isDark ? '#374151' : '#e5e7eb'
        }}
      >
        <h1 className="text-3xl font-bold mb-2" style={{ color: isDark ? '#f59e0b' : '#d97706' }}>Editar Usuario</h1>
        <p className="mb-8" style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>
          Modificando perfil de: <span className="font-semibold" style={{ color: isDark ? 'white' : 'black' }}>{form.fullName}</span>
        </p>
        
        <form onSubmit={handleSubmit} className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          {/* Columna 1 (5 campos) */}
          <div className="space-y-5">
            <div>
              <label htmlFor="fullName" className="text-sm mb-1 block" style={labelStyle}>Nombre completo</label>
              <input name="fullName" id="fullName" value={form.fullName || ''} placeholder="Nombre completo" onChange={handleChange} className="w-full p-3 border rounded-lg" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="fechaNacimiento" className="text-sm mb-1 block" style={labelStyle}>Fecha de Nacimiento</label>
              <input name="fechaNacimiento" id="fechaNacimiento" value={form.fechaNacimiento || ''} type="date" onChange={handleChange} className="w-full p-3 border rounded-lg" style={{ ...inputStyle, colorScheme: isDark ? 'dark' : 'light' }} />
            </div>
            <div>
              <label htmlFor="sexo" className="text-sm mb-1 block" style={labelStyle}>Sexo</label>
              <select name="sexo" id="sexo" value={form.sexo || ''} onChange={handleChange} className="w-full p-3 border rounded-lg" style={inputStyle}>
                <option value="">Seleccione Sexo</option>
                <option value="Masculino">Masculino</option>
                <option value="Femenino">Femenino</option>
                <option value="Prefiero no decirlo">Prefiero no decirlo</option>
              </select>
            </div>
            <div>
              <label htmlFor="telefono" className="text-sm mb-1 block" style={labelStyle}>Teléfono</label>
              <input name="telefono" id="telefono" value={form.telefono || ''} placeholder="Teléfono (+591...)" onChange={handleChange} className="w-full p-3 border rounded-lg" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="universidad" className="text-sm mb-1 block" style={labelStyle}>Universidad</label>
              <input name="universidad" id="universidad" value={form.universidad || ''} placeholder="Universidad" onChange={handleChange} className="w-full p-3 border rounded-lg" style={inputStyle} />
            </div>
          </div>

          {/* Columna 2 (5 campos para equilibrar altura 1:1) */}
          <div className="space-y-5">
            <div>
              <label htmlFor="profesion" className="text-sm mb-1 block" style={labelStyle}>Profesión / Cargo</label>
              <input name="profesion" id="profesion" value={form.profesion || ''} placeholder="Profesión / Cargo" onChange={handleChange} className="w-full p-3 border rounded-lg" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="email" className="text-sm mb-1 block" style={labelStyle}>Correo Electrónico (no editable)</label>
              <input name="email" id="email" value={form.email || ''} type="email" className="w-full p-3 border rounded-lg" style={readOnlyInputStyle} readOnly />
            </div>
            <div>
              <label htmlFor="password" className="text-sm mb-1 block" style={labelStyle}>Nueva Contraseña</label>
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
            <div>
              <label htmlFor="hasPagoUnicoAccess" className="text-sm mb-1 block" style={labelStyle}>Acceso Pago Único</label>
              <select 
                name="hasPagoUnicoAccess"
                id="hasPagoUnicoAccess"
                value={form.hasPagoUnicoAccess ? 'true' : 'false'}
                onChange={handleChange} 
                className="w-full p-3 border rounded-lg" 
                style={inputStyle}
              >
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            </div>
            <div>
              <label htmlFor="active" className="text-sm mb-1 block" style={labelStyle}>Estado (Activo)</label>
              <select 
                name="active" 
                id="active" 
                value={form.active ? 'true' : 'false'}
                onChange={handleChange} 
                className="w-full p-3 border rounded-lg" 
                style={inputStyle}
              >
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </div>
          </div>

          {/* ✅ FASE 4.B: Vigencia a ancho completo (md:col-span-2) para eliminar huecos entre columnas */}
          <div className="md:col-span-2">
            {(() => {
              const startReference = form.activeFrom || form.createdAt || new Date().toISOString();
              const hasLimit = Boolean(form.activeUntil);
              const expired = isAccountExpired(form);
              const totalDays = hasLimit ? calculateDurationDays(startReference, form.activeUntil) : null;
              const remainingDays = hasLimit ? calculateDurationDays(new Date().toISOString(), form.activeUntil) : null;

              const cardContainerClass = isDark
                ? 'bg-slate-900/90 border-slate-700 text-slate-100'
                : 'bg-slate-50 border-slate-200 text-slate-800';

              const summaryBoxClass = isDark
                ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                : 'bg-white border-slate-200 text-slate-700 shadow-sm';

              const inactiveBtnClass = isDark
                ? 'bg-slate-800 text-slate-200 border-slate-600 hover:bg-slate-700'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100 shadow-xs';

              const activeBtnClass = isDark
                ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                : 'bg-blue-600 text-white border-blue-600 shadow-sm';

              return (
                <div className={`p-5 rounded-xl border space-y-4 transition-colors ${cardContainerClass}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-blue-300' : 'text-blue-800'}`}>
                      <CalendarClock size={18} />
                      Vigencia de la Cuenta
                    </span>

                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                        !form.active
                          ? isDark
                            ? 'bg-rose-950/70 text-rose-300 border-rose-700/60'
                            : 'bg-rose-100 text-rose-800 border-rose-300'
                          : !hasLimit
                            ? isDark
                              ? 'bg-sky-950/70 text-sky-300 border-sky-700/60'
                              : 'bg-sky-100 text-sky-800 border-sky-300'
                            : expired
                              ? isDark
                                ? 'bg-red-950/70 text-red-300 border-red-700/60'
                                : 'bg-red-100 text-red-800 border-red-300'
                              : isDark
                                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60'
                                : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      }`}
                    >
                      {!form.active
                        ? expired
                          ? `Inactivo · Venció ${formatExpirationDisplay(form.activeUntil)}`
                          : 'Cuenta Inactiva'
                        : !hasLimit
                          ? 'Sin vencimiento'
                          : expired
                            ? `Vencido (${formatExpirationDisplay(form.activeUntil)})`
                            : `Vigente hasta ${formatExpirationDisplay(form.activeUntil)}`}
                    </span>
                  </div>

                  {!form.active ? (
                    <div
                      className={`p-3 rounded-lg border text-xs leading-relaxed flex items-start gap-2.5 ${
                        isDark
                          ? 'bg-slate-800/70 border-slate-700 text-slate-300'
                          : 'bg-amber-50 border-amber-200 text-amber-900'
                      }`}
                    >
                      <Lock size={16} className="mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-semibold">La vigencia se habilitará al activar la cuenta.</p>
                        <p className="mt-0.5 opacity-90">
                          Cuando cambies <strong>Estado (Activo)</strong> a <strong>Activo</strong>, el sistema tomará la fecha de hoy y asignará <strong>3 meses por defecto</strong> (podrás personalizar la duración o elegir una fecha exacta).
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {activationNotice && hasLimit && (
                        <div
                          className={`p-3 rounded-lg border text-xs leading-relaxed flex items-start gap-2 ${
                            isDark
                              ? 'bg-blue-950/60 border-blue-700/70 text-blue-200'
                              : 'bg-blue-50 border-blue-200 text-blue-900'
                          }`}
                        >
                          <Sparkles size={16} className="mt-0.5 flex-shrink-0 text-blue-500" />
                          <div>
                            <p className="font-bold">
                              Activación iniciada hoy ({formatDateShortEs(startReference)})
                            </p>
                            <p className="mt-0.5">
                              Por defecto este usuario durará <strong>3 meses</strong> (del{' '}
                              <strong>{formatDateShortEs(startReference)}</strong> al{' '}
                              <strong>{formatDateShortEs(form.activeUntil)}</strong> ·{' '}
                              <strong>{totalDays} días</strong>). ¿Quieres personalizar este plazo?
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                        {/* Izquierda: Resumen claro del rango de fechas */}
                        <div className={`p-3.5 rounded-lg border text-xs space-y-2 ${summaryBoxClass}`}>
                          {hasLimit ? (
                            <>
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Rango de acceso:</span>
                                <span className="font-bold">
                                  Del {formatDateShortEs(startReference)} al {formatDateShortEs(form.activeUntil)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Vencimiento exacto (Bolivia):</span>
                                <span className="font-bold">
                                  {formatDateTimeBolivia(form.activeUntil)} hrs
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Duración asignada:</span>
                                <span className="font-semibold">
                                  {totalDays} días en total
                                  {remainingDays !== null && !expired && ` (${remainingDays} días restantes)`}
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-center justify-between gap-2">
                              <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Acceso configurado:</span>
                              <span className="font-bold">Permanente (sin fecha de caducidad)</span>
                            </div>
                          )}
                          <p className={`text-[11px] pt-1 border-t ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-100 text-slate-500'}`}>
                            Por defecto vence a las <strong>23:59 (Hora Bolivia)</strong> del día límite y pasa automáticamente a Inactivo.
                          </p>
                        </div>

                        {/* Derecha: Botones rápidos + fecha y hora exacta */}
                        <div className="space-y-3">
                          <div>
                            <span className={`text-xs font-semibold mb-2 block ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                              Personalizar duración desde hoy:
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {[1, 3, 6, 12].map((m) => {
                                const isSelected = hasLimit && form.activeDurationMonths === m;
                                return (
                                  <button
                                    key={m}
                                    type="button"
                                    onClick={() => handleRenewMonths(m)}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition cursor-pointer ${
                                      isSelected ? activeBtnClass : inactiveBtnClass
                                    }`}
                                  >
                                    {m} {m === 1 ? 'mes' : 'meses'}
                                    {m === 3 ? ' (Defecto)' : ''}
                                  </button>
                                );
                              })}
                              <button
                                type="button"
                                onClick={handleSetUnlimited}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition cursor-pointer ${
                                  !hasLimit ? activeBtnClass : inactiveBtnClass
                                }`}
                              >
                                Sin vencimiento
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label
                                htmlFor="exactExpirationDate"
                                className={`text-xs font-semibold mb-1.5 block ${isDark ? 'text-slate-300' : 'text-slate-600'}`}
                              >
                                Fecha exacta de vencimiento:
                              </label>
                              <input
                                id="exactExpirationDate"
                                type="date"
                                value={getBoliviaDateParts(form.activeUntil)?.dateStr || ''}
                                onChange={handleExactExpirationChange}
                                className={`w-full p-2.5 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-blue-500 ${
                                  isDark
                                    ? 'bg-slate-800 border-slate-600 text-slate-100'
                                    : 'bg-white border-slate-300 text-slate-900'
                                }`}
                                style={{ colorScheme: isDark ? 'dark' : 'light' }}
                              />
                            </div>
                            <div>
                              <label
                                htmlFor="exactExpirationTime"
                                className={`text-xs font-semibold mb-1.5 block ${isDark ? 'text-slate-300' : 'text-slate-600'}`}
                              >
                                Hora de corte (Hora Bolivia):
                              </label>
                              <input
                                id="exactExpirationTime"
                                type="time"
                                value={getBoliviaDateParts(form.activeUntil)?.timeStr || '23:59'}
                                onChange={handleExactTimeChange}
                                className={`w-full p-2.5 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-blue-500 ${
                                  isDark
                                    ? 'bg-slate-800 border-slate-600 text-slate-100'
                                    : 'bg-white border-slate-300 text-slate-900'
                                }`}
                                style={{ colorScheme: isDark ? 'dark' : 'light' }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="md:col-span-2 mt-6 flex justify-end gap-4">
            <button type="button" onClick={() => router.back()} className="px-6 py-3 font-semibold rounded-lg transition hover:opacity-80" style={secondaryButtonStyle}>
              Cancelar
            </button>
            <button type="submit" disabled={isSubmitting} className="px-6 py-3 font-semibold rounded-lg text-white bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-800 disabled:cursor-wait transition">
              {isSubmitting ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
