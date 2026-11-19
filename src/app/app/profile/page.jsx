'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { db, auth } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import {
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import {
  calculateDurationDays,
  formatDateShortEs,
  formatDateTimeBolivia,
  formatExpirationDisplay,
  getBoliviaDateParts,
  isAccountExpired,
  parseExpirationMs,
} from '@/lib/accountExpiration';
import Swal from 'sweetalert2';
import { toast, Toaster } from 'react-hot-toast';
import {
  User,
  Lock,
  Save,
  Eye,
  EyeOff,
  Calendar,
  Phone,
  Building,
  Briefcase,
  GraduationCap,
  UserCheck,
  Mail,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  BookOpen,
  CalendarClock,
  Loader2,
} from 'lucide-react';

const EMPTY_PROFILE = {
  fullName: '',
  fechaNacimiento: '',
  sexo: '',
  telefono: '',
  universidad: '',
  profesion: '',
  fechaExamen: '',
};

function toInputDateString(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().split('T')[0];
  }
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
  }
  if (typeof value?.seconds === 'number') {
    const d = new Date(value.seconds * 1000);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
  }
  return '';
}

function extractProfileSnapshot(user) {
  if (!user) return { ...EMPTY_PROFILE };
  return {
    fullName: (user.fullName || user.name || user.displayName || '').trim(),
    fechaNacimiento: toInputDateString(user.fechaNacimiento),
    sexo: user.sexo || '',
    telefono: user.telefono || '',
    universidad: user.universidad || '',
    profesion: user.profesion || '',
    fechaExamen: toInputDateString(user.fechaExamen),
  };
}

function getExamCountdown(fechaExamenStr) {
  if (!fechaExamenStr || !/^\d{4}-\d{2}-\d{2}$/.test(fechaExamenStr)) return null;
  const todayParts = getBoliviaDateParts(new Date());
  if (!todayParts?.dateStr) return null;

  const targetMs = Date.parse(`${fechaExamenStr}T00:00:00Z`);
  const todayMs = Date.parse(`${todayParts.dateStr}T00:00:00Z`);
  if (!Number.isFinite(targetMs) || !Number.isFinite(todayMs)) return null;

  const daysDiff = Math.round((targetMs - todayMs) / 86400000);
  const [y, m, d] = fechaExamenStr.split('-').map(Number);
  const formattedDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return {
    daysDiff,
    formattedDate,
    status: daysDiff > 0 ? 'upcoming' : daysDiff === 0 ? 'today' : 'past',
  };
}

export default function ProfilePage() {
  const { user, role } = useAuth();
  const { isDark, isLoaded } = useTheme();

  const [activeTab, setActiveTab] = useState('personal'); // 'personal' | 'security'
  const [profileData, setProfileData] = useState(EMPTY_PROFILE);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const loadedUidRef = useRef(null);

  const [passwordData, setPasswordData] = useState({
    newPassword: '',
    confirmNewPassword: '',
  });
  const [showPasswords, setShowPasswords] = useState({
    new: false,
    confirm: false,
  });

  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingPassword, setLoadingPassword] = useState(false);

  const savedSnapshot = useMemo(() => extractProfileSnapshot(user), [user]);

  useEffect(() => {
    if (!user?.uid) {
      loadedUidRef.current = null;
      setInitialLoaded(false);
      return;
    }
    if (loadedUidRef.current !== user.uid) {
      loadedUidRef.current = user.uid;
      setProfileData(savedSnapshot);
      setInitialLoaded(true);
    }
  }, [user?.uid, savedSnapshot]);

  const isDirty = useMemo(
    () =>
      Object.keys(EMPTY_PROFILE).some(
        (key) => String(profileData[key] || '') !== String(savedSnapshot[key] || '')
      ),
    [profileData, savedSnapshot]
  );

  const completedCount = Array.isArray(user?.pagoUnicoCursosCompletados)
    ? user.pagoUnicoCursosCompletados.length
    : 0;
  const effectiveRole = role || user?.rol || 'user';
  const accountActive = user?.active !== false;
  const hasLimit = parseExpirationMs(user?.activeUntil) !== null;
  const expired = isAccountExpired(user);
  const startReference = user?.activeFrom || user?.createdAt || null;
  const totalDays = hasLimit && startReference ? calculateDurationDays(startReference, user.activeUntil) : null;
  const remainingDays = hasLimit ? calculateDurationDays(new Date().toISOString(), user.activeUntil) : null;
  const validityPercent =
    totalDays && totalDays > 0 && remainingDays !== null
      ? Math.min(100, Math.max(0, Math.round((remainingDays / totalDays) * 100)))
      : 100;
  const memberSinceLabel = user?.createdAt ? formatDateShortEs(user.createdAt) : '';
  const expirationLabel = formatExpirationDisplay(user?.activeUntil);
  const examCountdown = useMemo(
    () => getExamCountdown(profileData.fechaExamen),
    [profileData.fechaExamen]
  );

  const displayName =
    profileData.fullName.trim() ||
    user?.fullName ||
    user?.name ||
    user?.displayName ||
    'Estudiante Doctemia';

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setProfileData((prev) => ({ ...prev, [name]: value }));
  };

  const handleResetProfile = () => {
    setProfileData(savedSnapshot);
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    if (!user?.uid) {
      toast.error('Usuario no identificado.');
      return;
    }

    const trimmedName = profileData.fullName.trim();
    if (!trimmedName) {
      toast.error('Tu nombre completo no puede estar vacío.');
      return;
    }

    const payload = {
      fullName: trimmedName,
      fechaNacimiento: profileData.fechaNacimiento || '',
      sexo: profileData.sexo || '',
      telefono: profileData.telefono.trim(),
      universidad: profileData.universidad.trim(),
      profesion: profileData.profesion.trim(),
      fechaExamen: profileData.fechaExamen || '',
    };

    setLoadingProfile(true);
    try {
      const userDocRef = doc(db, 'users', user.uid);
      // AuthContext mantiene onSnapshot activo: sincroniza los cambios sin re-leer con getDoc
      await updateDoc(userDocRef, payload);
      setProfileData(payload);
      toast.success('Perfil actualizado correctamente.');
    } catch (error) {
      console.error('Error actualizando perfil:', error);
      toast.error(`No se pudo actualizar: ${error.message}`);
    } finally {
      setLoadingProfile(false);
    }
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordData((prev) => ({ ...prev, [name]: value }));
  };

  const togglePasswordVisibility = (field) => {
    setShowPasswords((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const passwordMinLengthOk = passwordData.newPassword.length >= 6;
  const passwordsMatch =
    Boolean(passwordData.confirmNewPassword) &&
    passwordData.newPassword === passwordData.confirmNewPassword;
  const passwordsMismatch =
    Boolean(passwordData.confirmNewPassword) &&
    passwordData.newPassword !== passwordData.confirmNewPassword;

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f8fafc' : '#1a2639',
      confirmButtonColor: isDark ? '#24B0BA' : '#014ba0',
      cancelButtonColor: '#64748b',
    }),
    [isDark]
  );

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    const { newPassword, confirmNewPassword } = passwordData;
    if (newPassword !== confirmNewPassword) {
      toast.error('Las contraseñas no coinciden.');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('La contraseña debe tener 6 o más caracteres.');
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      toast.error('No hay sesión activa para actualizar la contraseña.');
      return;
    }

    setLoadingPassword(true);
    try {
      await updatePassword(currentUser, newPassword);
      setPasswordData({ newPassword: '', confirmNewPassword: '' });
      toast.success('Tu contraseña ha sido actualizada.');
    } catch (error) {
      console.error('Error cambiando contraseña:', error);
      if (error.code === 'auth/requires-recent-login') {
        const { value: currentPwd } = await Swal.fire({
          title: 'Confirma tu identidad',
          text: 'Por seguridad, ingresa tu contraseña actual para completar el cambio.',
          input: 'password',
          inputPlaceholder: 'Contraseña actual',
          showCancelButton: true,
          confirmButtonText: 'Confirmar y cambiar',
          cancelButtonText: 'Cancelar',
          ...swalTheme,
        });
        if (currentPwd) {
          try {
            const cred = EmailAuthProvider.credential(currentUser.email, currentPwd);
            await reauthenticateWithCredential(currentUser, cred);
            await updatePassword(currentUser, newPassword);
            setPasswordData({ newPassword: '', confirmNewPassword: '' });
            toast.success('Contraseña actualizada correctamente.');
          } catch (reauthErr) {
            console.error('Error reautenticando:', reauthErr);
            toast.error('No se pudo verificar tu contraseña actual.');
          }
        }
      } else {
        toast.error(`No se pudo cambiar la contraseña: ${error.message}`);
      }
    } finally {
      setLoadingPassword(false);
    }
  };

  if (!isLoaded || !user || !initialLoaded) {
    return (
      <div
        className={`min-h-[calc(100vh-4rem)] flex flex-col justify-center items-center gap-3 ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <Loader2
          className={`w-9 h-9 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}
        />
        <p className={`text-sm font-semibold ${isDark ? 'text-slate-300' : 'text-[#2E4A70]'}`}>
          Cargando perfil...
        </p>
      </div>
    );
  }

  const pageBg = isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]';
  const cardSurface = isDark
    ? 'bg-[#1e293b] border-white/10 text-white shadow-lg shadow-black/20'
    : 'bg-white border-[#2E4A70]/15 text-[#1a2639] shadow-sm';
  const mutedText = isDark ? 'text-slate-300' : 'text-[#2E4A70]';
  const subtleText = isDark ? 'text-slate-400' : 'text-slate-500';
  const dividerClass = isDark ? 'border-white/10' : 'border-[#2E4A70]/12';
  const inputWrapperClass = `flex items-center gap-2.5 px-3.5 rounded-xl border transition-colors min-h-[44px] ${
    isDark
      ? 'bg-[#162235] border-white/15 text-white focus-within:border-[#24B0BA]'
      : 'bg-slate-50/70 border-[#2E4A70]/20 text-[#1a2639] focus-within:border-[#014ba0] focus-within:bg-white'
  }`;
  const inputClass = `w-full min-w-0 py-2.5 bg-transparent text-sm font-medium outline-none ${
    isDark ? 'text-white placeholder:text-slate-400' : 'text-[#1a2639] placeholder:text-slate-400'
  }`;
  const labelClass = `block text-xs font-bold uppercase tracking-wide mb-1.5 ${
    isDark ? 'text-slate-300' : 'text-[#2E4A70]'
  }`;
  const primaryBtnClass = isDark
    ? 'bg-[#24B0BA] hover:bg-[#1d9aa3] text-slate-950 font-bold'
    : 'bg-[#014ba0] hover:bg-[#013b80] text-white font-bold';

  return (
    <div className={`min-h-[calc(100vh-4rem)] py-6 sm:py-8 px-3.5 sm:px-6 lg:px-8 transition-colors ${pageBg}`}>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: isDark ? '#1e293b' : '#ffffff',
            color: isDark ? '#f8fafc' : '#1a2639',
            border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(46,74,112,0.15)',
          },
        }}
      />

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Encabezado limpio de sección */}
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div className="space-y-1">
            <h1 className={`text-2xl sm:text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-[#014ba0]'}`}>
              Mi Perfil y Cuenta
            </h1>
            <p className={`text-sm ${mutedText}`}>
              Administra tus datos académicos, fecha objetivo de examen y seguridad de acceso.
            </p>
          </div>

          <Link
            href="/app/pagoUnicoCourses"
            className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-bold transition-colors self-start sm:self-auto min-h-[42px] ${
              isDark
                ? 'bg-[#1e293b] border-white/15 text-[#24B0BA] hover:bg-white/5'
                : 'bg-white border-[#2E4A70]/20 text-[#014ba0] hover:bg-slate-50'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Ir a Mis Cursos</span>
          </Link>
        </header>

        {/* TARJETA SUPERIOR DE PERFIL (por encima del formulario, sin foto de perfil) */}
        <section className={`rounded-2xl border overflow-hidden ${cardSurface}`}>
          <div className="h-1.5 bg-gradient-to-r from-[#014ba0] to-[#24B0BA]" />
          <div className="p-5 sm:p-6 space-y-5">
            {/* Identidad y meta de examen */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-[11px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                      effectiveRole === 'admin'
                        ? isDark
                          ? 'bg-[#CF8A40]/20 text-[#CF8A40]'
                          : 'bg-amber-100 text-amber-800'
                        : isDark
                          ? 'bg-[#24B0BA]/20 text-[#24B0BA]'
                          : 'bg-[#014ba0]/10 text-[#014ba0]'
                    }`}
                  >
                    {effectiveRole === 'admin' ? 'Administrador' : 'Estudiante'}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                      !accountActive || expired
                        ? isDark
                          ? 'bg-red-500/15 text-red-300'
                          : 'bg-red-50 text-red-700'
                        : isDark
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        !accountActive || expired ? 'bg-red-500' : 'bg-emerald-500'
                      }`}
                    />
                    {!accountActive ? 'Cuenta Inactiva' : expired ? 'Cuenta Vencida' : 'Cuenta Activa'}
                  </span>
                  {memberSinceLabel && memberSinceLabel !== 'Sin fecha' && (
                    <span className={`text-[11px] font-semibold ${subtleText}`}>
                      Miembro desde {memberSinceLabel}
                    </span>
                  )}
                </div>

                <h2 className="text-xl sm:text-2xl font-black leading-tight break-words">
                  {displayName}
                </h2>

                <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs ${subtleText}`}>
                  {user.email && (
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <Mail className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{user.email}</span>
                    </span>
                  )}
                  {profileData.telefono.trim() && (
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      <span>{profileData.telefono.trim()}</span>
                    </span>
                  )}
                  {profileData.universidad.trim() && (
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <Building className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{profileData.universidad.trim()}</span>
                    </span>
                  )}
                  {profileData.profesion.trim() && (
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <Briefcase className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{profileData.profesion.trim()}</span>
                    </span>
                  )}
                </div>
              </div>

              {examCountdown?.status === 'upcoming' && (
                <div
                  className={`px-4 py-3 rounded-xl border shrink-0 sm:text-right ${
                    isDark
                      ? 'bg-[#162235] border-[#24B0BA]/30'
                      : 'bg-[#FFF9F0] border-[#014ba0]/15'
                  }`}
                >
                  <p className={`text-[11px] font-bold uppercase tracking-wider ${subtleText}`}>
                    Meta de Examen
                  </p>
                  <p className={`text-2xl font-black tabular-nums leading-tight ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}>
                    {examCountdown.daysDiff}{' '}
                    <span className={`text-xs font-bold ${mutedText}`}>
                      {examCountdown.daysDiff === 1 ? 'día restante' : 'días restantes'}
                    </span>
                  </p>
                  <p className={`text-[11px] capitalize ${subtleText}`}>
                    {examCountdown.formattedDate}
                  </p>
                </div>
              )}
            </div>

            {/* Bloque de Vigencia de Cuenta (rango, corte Hora Bolivia y días restantes) */}
            <div
              className={`p-4 rounded-xl border space-y-2.5 ${
                isDark ? 'bg-[#162235]/85 border-white/10' : 'bg-slate-50/90 border-slate-200/80'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CalendarClock
                    className={`w-4 h-4 shrink-0 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}
                  />
                  <span className="text-xs sm:text-sm font-extrabold">
                    Vigencia de la Cuenta
                  </span>
                  {hasLimit && user?.activeDurationMonths && (
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        isDark ? 'bg-white/10 text-slate-200' : 'bg-white text-[#2E4A70] border border-slate-200'
                      }`}
                    >
                      Plan {user.activeDurationMonths} {user.activeDurationMonths === 1 ? 'mes' : 'meses'}
                    </span>
                  )}
                </div>

                <span
                  className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full tabular-nums ${
                    !accountActive
                      ? isDark
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-red-100 text-red-800'
                      : !hasLimit
                        ? isDark
                          ? 'bg-sky-500/20 text-sky-300'
                          : 'bg-sky-100 text-sky-800'
                        : expired
                          ? isDark
                            ? 'bg-red-500/20 text-red-300'
                            : 'bg-red-100 text-red-800'
                          : remainingDays !== null && remainingDays <= 7
                            ? isDark
                              ? 'bg-[#CF8A40]/20 text-[#CF8A40]'
                              : 'bg-amber-100 text-amber-800'
                            : isDark
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {!accountActive
                    ? 'Cuenta desactivada'
                    : !hasLimit
                      ? 'Sin vencimiento (Permanente)'
                      : expired
                        ? `Venció el ${expirationLabel}`
                        : `${remainingDays} ${remainingDays === 1 ? 'día restante' : 'días restantes'}`}
                </span>
              </div>

              {hasLimit ? (
                <>
                  <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs ${mutedText}`}>
                    <p>
                      <span className={subtleText}>Periodo activo: </span>
                      <strong className="font-bold">
                        {startReference ? `Del ${formatDateShortEs(startReference)} al ` : 'Hasta el '}
                        {formatDateShortEs(user.activeUntil)}
                      </strong>
                    </p>
                    <p className="sm:text-right">
                      <span className={subtleText}>Vencimiento exacto (Bolivia): </span>
                      <strong className="font-bold tabular-nums">
                        {formatDateTimeBolivia(user.activeUntil)} hrs
                      </strong>
                    </p>
                  </div>
                  {totalDays > 0 && !expired && (
                    <div
                      className={`h-1.5 w-full rounded-full overflow-hidden ${
                        isDark ? 'bg-white/10' : 'bg-slate-200'
                      }`}
                      aria-hidden="true"
                    >
                      <div
                        className={`h-full rounded-full transition-all ${
                          remainingDays <= 7
                            ? 'bg-[#CF8A40]'
                            : isDark
                              ? 'bg-[#24B0BA]'
                              : 'bg-[#014ba0]'
                        }`}
                        style={{ width: `${Math.max(4, validityPercent)}%` }}
                      />
                    </div>
                  )}
                </>
              ) : (
                <p className={`text-xs ${subtleText}`}>
                  Tu cuenta está configurada sin límite de expiración automática.
                </p>
              )}
            </div>

            {/* Indicadores de acceso y progreso */}
            <div className={`pt-1 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs`}>
              <div
                className={`p-3 rounded-xl border ${
                  isDark ? 'bg-[#162235]/80 border-white/10' : 'bg-slate-50/80 border-slate-200/80'
                }`}
              >
                <span className={`font-semibold flex items-center gap-1.5 ${subtleText}`}>
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  Acceso a Cursos Pago Único
                </span>
                <p
                  className={`font-extrabold text-sm mt-1 ${
                    user.hasPagoUnicoAccess
                      ? isDark
                        ? 'text-emerald-300'
                        : 'text-emerald-700'
                      : isDark
                        ? 'text-amber-300'
                        : 'text-amber-700'
                  }`}
                >
                  {user.hasPagoUnicoAccess ? 'Habilitado' : 'Requiere activación'}
                </p>
              </div>

              <div
                className={`p-3 rounded-xl border ${
                  isDark ? 'bg-[#162235]/80 border-white/10' : 'bg-slate-50/80 border-slate-200/80'
                }`}
              >
                <span className={`font-semibold flex items-center gap-1.5 ${subtleText}`}>
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  Cursos completados
                </span>
                <p className="font-extrabold text-sm mt-1 tabular-nums">{completedCount}</p>
              </div>

              <div
                className={`p-3 rounded-xl border ${
                  isDark ? 'bg-[#162235]/80 border-white/10' : 'bg-slate-50/80 border-slate-200/80'
                }`}
              >
                <span className={`font-semibold flex items-center gap-1.5 ${subtleText}`}>
                  <GraduationCap className="w-3.5 h-3.5 shrink-0" />
                  Fecha objetivo de examen
                </span>
                <p className="font-extrabold text-sm mt-1 capitalize truncate">
                  {examCountdown
                    ? examCountdown.status === 'today'
                      ? '¡Hoy es tu examen!'
                      : examCountdown.formattedDate
                    : 'Sin definir'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* FORMULARIO DE EDICIÓN Y SEGURIDAD (debajo de la tarjeta de perfil) */}
        <main className="min-w-0">
          <div className={`rounded-2xl border overflow-hidden ${cardSurface}`}>
            {/* Pestañas */}
            <div
              role="tablist"
              aria-label="Secciones de perfil"
              className={`flex border-b px-4 sm:px-6 pt-3 gap-2 overflow-x-auto ${dividerClass} ${
                isDark ? 'bg-[#162235]/60' : 'bg-slate-50/70'
              }`}
            >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'personal'}
                  onClick={() => setActiveTab('personal')}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                    activeTab === 'personal'
                      ? isDark
                        ? 'border-[#24B0BA] text-[#24B0BA]'
                        : 'border-[#014ba0] text-[#014ba0]'
                      : isDark
                        ? 'border-transparent text-slate-400 hover:text-slate-200'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Información Personal</span>
                  {isDirty && (
                    <span
                      className="w-2 h-2 rounded-full bg-[#CF8A40]"
                      title="Cambios sin guardar"
                    />
                  )}
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'security'}
                  onClick={() => setActiveTab('security')}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                    activeTab === 'security'
                      ? isDark
                        ? 'border-[#24B0BA] text-[#24B0BA]'
                        : 'border-[#014ba0] text-[#014ba0]'
                      : isDark
                        ? 'border-transparent text-slate-400 hover:text-slate-200'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Lock className="w-4 h-4" />
                  <span>Seguridad y Contraseña</span>
                </button>
              </div>

              {activeTab === 'personal' ? (
                <form onSubmit={handleProfileSubmit} className="p-4 sm:p-6 lg:p-7 space-y-6">
                  {/* Bloque 1: Identidad y Contacto */}
                  <div className="space-y-4">
                    <div className={`pb-2 border-b ${dividerClass}`}>
                      <h3 className="text-sm sm:text-base font-extrabold">
                        Identidad y Contacto
                      </h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="fullName" className={labelClass}>
                          Nombre Completo <span className="text-red-500">*</span>
                        </label>
                        <div className={inputWrapperClass}>
                          <User className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                          <input
                            type="text"
                            name="fullName"
                            id="fullName"
                            autoComplete="name"
                            value={profileData.fullName}
                            onChange={handleProfileChange}
                            placeholder="Tu nombre completo"
                            required
                            className={inputClass}
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="accountEmail" className={labelClass}>
                          Correo Electrónico
                        </label>
                        <div
                          className={`flex items-center gap-2.5 px-3.5 rounded-xl border min-h-[44px] opacity-80 ${
                            isDark
                              ? 'bg-[#162235]/50 border-white/10 text-slate-300'
                              : 'bg-slate-100 border-slate-200 text-slate-600'
                          }`}
                        >
                          <Mail className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                          <input
                            type="email"
                            id="accountEmail"
                            value={user.email || ''}
                            readOnly
                            disabled
                            className="w-full min-w-0 py-2.5 bg-transparent text-sm font-medium outline-none cursor-not-allowed"
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="fechaNacimiento" className={labelClass}>
                          Fecha de Nacimiento
                        </label>
                        <div className={inputWrapperClass}>
                          <Calendar className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                          <input
                            type="date"
                            name="fechaNacimiento"
                            id="fechaNacimiento"
                            autoComplete="bday"
                            value={profileData.fechaNacimiento}
                            onChange={handleProfileChange}
                            style={{ colorScheme: isDark ? 'dark' : 'light' }}
                            className={inputClass}
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="sexo" className={labelClass}>
                          Sexo
                        </label>
                        <div className={inputWrapperClass}>
                          <UserCheck className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                          <select
                            name="sexo"
                            id="sexo"
                            autoComplete="sex"
                            value={profileData.sexo}
                            onChange={handleProfileChange}
                            style={{ colorScheme: isDark ? 'dark' : 'light' }}
                            className={`${inputClass} cursor-pointer`}
                          >
                            <option value="" className={isDark ? 'bg-[#1e293b]' : 'bg-white'}>
                              Seleccionar...
                            </option>
                            <option value="Masculino" className={isDark ? 'bg-[#1e293b]' : 'bg-white'}>
                              Masculino
                            </option>
                            <option value="Femenino" className={isDark ? 'bg-[#1e293b]' : 'bg-white'}>
                              Femenino
                            </option>
                            <option
                              value="Prefiero no decirlo"
                              className={isDark ? 'bg-[#1e293b]' : 'bg-white'}
                            >
                              Prefiero no decirlo
                            </option>
                          </select>
                        </div>
                      </div>

                      <div className="sm:col-span-2">
                        <label htmlFor="telefono" className={labelClass}>
                          Teléfono / WhatsApp
                        </label>
                        <div className={inputWrapperClass}>
                          <Phone className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                          <input
                            type="tel"
                            name="telefono"
                            id="telefono"
                            autoComplete="tel"
                            value={profileData.telefono}
                            onChange={handleProfileChange}
                            placeholder="+591 ..."
                            className={inputClass}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bloque 2: Perfil Académico y Objetivo */}
                  <div className="space-y-4">
                    <div className={`pb-2 border-b ${dividerClass}`}>
                      <h3 className="text-sm sm:text-base font-extrabold">
                        Perfil Académico y Meta
                      </h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="universidad" className={labelClass}>
                          Universidad
                        </label>
                        <div className={inputWrapperClass}>
                          <Building className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                          <input
                            type="text"
                            name="universidad"
                            id="universidad"
                            autoComplete="organization"
                            value={profileData.universidad}
                            onChange={handleProfileChange}
                            placeholder="Nombre de tu universidad"
                            className={inputClass}
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="profesion" className={labelClass}>
                          Profesión / Cargo
                        </label>
                        <div className={inputWrapperClass}>
                          <Briefcase className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                          <input
                            type="text"
                            name="profesion"
                            id="profesion"
                            autoComplete="organization-title"
                            value={profileData.profesion}
                            onChange={handleProfileChange}
                            placeholder="Ej: Interno de Medicina / Médico"
                            className={inputClass}
                          />
                        </div>
                      </div>

                      <div className="sm:col-span-2">
                        <label htmlFor="fechaExamen" className={labelClass}>
                          Fecha Tentativa de Examen
                        </label>
                        <div className={inputWrapperClass}>
                          <GraduationCap className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                          <input
                            type="date"
                            name="fechaExamen"
                            id="fechaExamen"
                            value={profileData.fechaExamen}
                            onChange={handleProfileChange}
                            style={{ colorScheme: isDark ? 'dark' : 'light' }}
                            className={inputClass}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Barra de acciones */}
                  <div className={`pt-4 border-t flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 ${dividerClass}`}>
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      {isDirty ? (
                        <span className={isDark ? 'text-[#CF8A40]' : 'text-amber-700'}>
                          Tienes cambios pendientes por guardar.
                        </span>
                      ) : (
                        <span className={subtleText}>
                          Tus datos están al día.
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2.5">
                      {isDirty && (
                        <button
                          type="button"
                          onClick={handleResetProfile}
                          disabled={loadingProfile}
                          className={`inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-bold transition-colors min-h-[44px] cursor-pointer disabled:opacity-50 ${
                            isDark
                              ? 'border-white/15 text-slate-300 hover:bg-white/5'
                              : 'border-[#2E4A70]/20 text-[#2E4A70] hover:bg-slate-100'
                          }`}
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>Descartar</span>
                        </button>
                      )}

                      <button
                        type="submit"
                        disabled={loadingProfile || !isDirty}
                        className={`inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs sm:text-sm transition-colors min-h-[44px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${primaryBtnClass}`}
                      >
                        {loadingProfile ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Guardando...</span>
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" />
                            <span>Guardar Cambios</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <form onSubmit={handlePasswordSubmit} className="p-4 sm:p-6 lg:p-7 space-y-6">
                  <div
                    className={`p-3.5 rounded-xl border flex items-start gap-3 text-xs leading-relaxed ${
                      isDark
                        ? 'bg-[#162235] border-white/10 text-slate-300'
                        : 'bg-slate-50 border-slate-200 text-[#2E4A70]'
                    }`}
                  >
                    <ShieldCheck
                      className={`w-4 h-4 shrink-0 mt-0.5 ${
                        isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                      }`}
                    />
                    <p>
                      Usa una contraseña segura que no utilices en otros sitios. Si tu sesión lleva bastante tiempo abierta, el sistema te pedirá confirmar tu contraseña actual antes de aplicar el cambio.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="newPassword" className={labelClass}>
                        Nueva Contraseña
                      </label>
                      <div className={inputWrapperClass}>
                        <Lock className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                        <input
                          type={showPasswords.new ? 'text' : 'password'}
                          name="newPassword"
                          id="newPassword"
                          autoComplete="new-password"
                          value={passwordData.newPassword}
                          onChange={handlePasswordChange}
                          placeholder="Mínimo 6 caracteres"
                          required
                          minLength={6}
                          className={inputClass}
                        />
                        <button
                          type="button"
                          onClick={() => togglePasswordVisibility('new')}
                          aria-label={showPasswords.new ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            isDark ? 'text-slate-300 hover:bg-white/10' : 'text-[#014ba0] hover:bg-slate-200/60'
                          }`}
                        >
                          {showPasswords.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="confirmNewPassword" className={labelClass}>
                        Confirmar Contraseña
                      </label>
                      <div className={inputWrapperClass}>
                        <Lock className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                        <input
                          type={showPasswords.confirm ? 'text' : 'password'}
                          name="confirmNewPassword"
                          id="confirmNewPassword"
                          autoComplete="new-password"
                          value={passwordData.confirmNewPassword}
                          onChange={handlePasswordChange}
                          placeholder="Repite la nueva contraseña"
                          required
                          minLength={6}
                          className={inputClass}
                        />
                        <button
                          type="button"
                          onClick={() => togglePasswordVisibility('confirm')}
                          aria-label={showPasswords.confirm ? 'Ocultar confirmación' : 'Mostrar confirmación'}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            isDark ? 'text-slate-300 hover:bg-white/10' : 'text-[#014ba0] hover:bg-slate-200/60'
                          }`}
                        >
                          {showPasswords.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Requisitos en tiempo real */}
                  <div className="flex flex-wrap gap-3 text-xs font-semibold">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
                        passwordMinLengthOk
                          ? isDark
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-emerald-50 text-emerald-700'
                          : isDark
                            ? 'bg-white/5 text-slate-400'
                            : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Mínimo 6 caracteres</span>
                    </span>

                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
                        passwordsMatch
                          ? isDark
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-emerald-50 text-emerald-700'
                          : passwordsMismatch
                            ? isDark
                              ? 'bg-red-500/20 text-red-300'
                              : 'bg-red-50 text-red-700'
                            : isDark
                              ? 'bg-white/5 text-slate-400'
                              : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {passwordsMismatch ? (
                        <AlertCircle className="w-3.5 h-3.5" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {passwordsMismatch
                          ? 'Las contraseñas no coinciden'
                          : 'Las contraseñas coinciden'}
                      </span>
                    </span>
                  </div>

                  <div className={`pt-4 border-t flex justify-end ${dividerClass}`}>
                    <button
                      type="submit"
                      disabled={loadingPassword || !passwordMinLengthOk || !passwordsMatch}
                      className={`inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs sm:text-sm transition-colors min-h-[44px] w-full sm:w-auto cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${primaryBtnClass}`}
                    >
                      {loadingPassword ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Actualizando...</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-4 h-4" />
                          <span>Actualizar Contraseña</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </main>
      </div>
    </div>
  );
}
