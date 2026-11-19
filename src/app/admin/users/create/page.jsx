'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Swal from 'sweetalert2';
import { useTheme } from '@/context/ThemeContext';
import {
  buildExpirationFields,
  calculateDurationDays,
  formatDateShortEs,
  getBoliviaDateParts,
} from '@/lib/accountExpiration';
import {
  UserPlus,
  ArrowLeft,
  CalendarClock,
  User,
  Calendar,
  UserCheck,
  Phone,
  Building,
  Briefcase,
  GraduationCap,
  Mail,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  Loader2,
} from 'lucide-react';

const VALIDITY_OPTIONS = [
  { value: '1', label: '1 mes' },
  { value: '3', label: '3 meses (Defecto)' },
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
  { value: 'exact', label: 'Fecha exacta' },
  { value: 'unlimited', label: 'Sin vencimiento' },
];

const REQUIRED_FIELDS = [
  { key: 'fullName', label: 'Nombre completo' },
  { key: 'fechaNacimiento', label: 'Fecha de nacimiento' },
  { key: 'sexo', label: 'Sexo' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'universidad', label: 'Universidad' },
  { key: 'profesion', label: 'Profesión / Cargo' },
  { key: 'email', label: 'Correo electrónico' },
  { key: 'password', label: 'Contraseña' },
];

export default function AdminCreateUserPage() {
  const router = useRouter();
  const { isDark, isLoaded } = useTheme();

  const [form, setForm] = useState({
    fullName: '',
    fechaNacimiento: '',
    sexo: '',
    telefono: '',
    universidad: '',
    profesion: '',
    fechaExamen: '',
    email: '',
    password: '',
  });
  const [validityOption, setValidityOption] = useState('3');
  const [exactDate, setExactDate] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const todayBolivia = useMemo(
    () => getBoliviaDateParts(new Date())?.dateStr || '',
    []
  );

  const computedExpiration = useMemo(() => {
    if (validityOption === 'unlimited') {
      return buildExpirationFields({ durationType: 'unlimited' });
    }
    if (validityOption === 'exact') {
      return buildExpirationFields({ durationType: 'exact', exactDate });
    }
    return buildExpirationFields({
      durationType: 'months',
      activeDurationMonths: Number(validityOption),
    });
  }, [validityOption, exactDate]);

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f8fafc' : '#1a2639',
      confirmButtonColor: isDark ? '#24B0BA' : '#014ba0',
      cancelButtonColor: '#64748b',
    }),
    [isDark]
  );

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return;

    const missingLabels = REQUIRED_FIELDS.filter(
      ({ key }) => !form[key] || String(form[key]).trim() === ''
    ).map(({ label }) => label);

    if (missingLabels.length > 0) {
      await Swal.fire({
        title: 'Campos Incompletos',
        text: `Por favor, completa: ${missingLabels.join(', ')}.`,
        icon: 'warning',
        ...swalTheme,
      });
      return;
    }

    if (form.password.length < 6) {
      await Swal.fire({
        title: 'Contraseña muy corta',
        text: 'La contraseña debe tener al menos 6 caracteres.',
        icon: 'warning',
        ...swalTheme,
      });
      return;
    }

    if (validityOption === 'exact' && !exactDate) {
      await Swal.fire({
        title: 'Fecha requerida',
        text: 'Selecciona una fecha exacta de vencimiento.',
        icon: 'warning',
        ...swalTheme,
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          fechaNacimiento: form.fechaNacimiento,
          sexo: form.sexo,
          telefono: form.telefono.trim(),
          universidad: form.universidad.trim(),
          profesion: form.profesion.trim(),
          fechaExamen: form.fechaExamen || null,
          email: form.email.trim(),
          password: form.password,
          rol: 'user',
          durationType:
            validityOption === 'unlimited'
              ? 'unlimited'
              : validityOption === 'exact'
                ? 'exact'
                : 'months',
          activeDurationMonths: ['1', '3', '6', '12'].includes(validityOption)
            ? Number(validityOption)
            : null,
          exactDate: validityOption === 'exact' ? exactDate : '',
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo registrar el usuario.');
      }

      await Swal.fire({
        title: '¡Usuario Registrado!',
        text: 'La cuenta fue creada correctamente. Puedes habilitarle cursos de pago único desde el listado o al editar su perfil.',
        icon: 'success',
        timer: 2600,
        timerProgressBar: true,
        ...swalTheme,
      });
      router.push('/admin/users');
    } catch (err) {
      await Swal.fire({
        title: 'Error de Registro',
        text: err.message || 'Ocurrió un error al crear la cuenta.',
        icon: 'error',
        ...swalTheme,
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isLoaded) {
    return (
      <div
        className={`min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center gap-3 ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <Loader2
          className={`w-8 h-8 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}
        />
        <p className="text-sm font-semibold">Cargando formulario...</p>
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
  const optionClass = isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]';
  const primaryBtnClass = isDark
    ? 'bg-[#24B0BA] hover:bg-[#1d9aa3] text-slate-950 font-bold'
    : 'bg-[#014ba0] hover:bg-[#013b80] text-white font-bold';

  const colorSchemeStyle = { colorScheme: isDark ? 'dark' : 'light' };
  const passwordOk = form.password.length >= 6;

  return (
    <div className={`min-h-[calc(100vh-4rem)] py-6 sm:py-8 px-3.5 sm:px-6 lg:px-8 transition-colors ${pageBg}`}>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Encabezado */}
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div className="space-y-1">
            <Link
              href="/admin/users"
              className={`inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold transition-colors ${
                isDark
                  ? 'text-[#24B0BA] hover:text-white'
                  : 'text-[#014ba0] hover:text-[#2E4A70]'
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Volver a Usuarios</span>
            </Link>
            <h1
              className={`text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2.5 ${
                isDark ? 'text-white' : 'text-[#014ba0]'
              }`}
            >
              <UserPlus className="w-7 h-7 shrink-0" />
              <span>Registrar Nuevo Usuario</span>
            </h1>
            <p className={`text-sm ${mutedText}`}>
              Completa los datos personales, credenciales de acceso y plazo de vigencia inicial de la cuenta.
            </p>
          </div>
        </header>

        {/* Tarjeta principal del formulario */}
        <form onSubmit={handleSubmit} className={`rounded-2xl border overflow-hidden ${cardSurface}`}>
          <div className="h-1.5 bg-gradient-to-r from-[#014ba0] to-[#24B0BA]" />

          <div className="p-4 sm:p-6 lg:p-8 space-y-7">
            {/* Sección 1: Datos Personales y Académicos */}
            <section className="space-y-4">
              <div className={`pb-2 border-b ${dividerClass}`}>
                <h2 className="text-sm sm:text-base font-extrabold">
                  Datos Personales y Académicos
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="fullName" className={labelClass}>
                    Nombre completo <span className="text-red-500">*</span>
                  </label>
                  <div className={inputWrapperClass}>
                    <User className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                    <input
                      id="fullName"
                      name="fullName"
                      type="text"
                      placeholder="Ej: Juan Pérez"
                      value={form.fullName}
                      onChange={handleChange}
                      required
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="fechaNacimiento" className={labelClass}>
                    Fecha de Nacimiento <span className="text-red-500">*</span>
                  </label>
                  <div className={inputWrapperClass}>
                    <Calendar className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                    <input
                      id="fechaNacimiento"
                      name="fechaNacimiento"
                      type="date"
                      value={form.fechaNacimiento}
                      onChange={handleChange}
                      required
                      style={colorSchemeStyle}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="sexo" className={labelClass}>
                    Sexo <span className="text-red-500">*</span>
                  </label>
                  <div className={inputWrapperClass}>
                    <UserCheck className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                    <select
                      id="sexo"
                      name="sexo"
                      value={form.sexo}
                      onChange={handleChange}
                      required
                      style={colorSchemeStyle}
                      className={`${inputClass} cursor-pointer`}
                    >
                      <option value="" disabled className={optionClass}>
                        Selecciona sexo
                      </option>
                      <option value="Masculino" className={optionClass}>
                        Masculino
                      </option>
                      <option value="Femenino" className={optionClass}>
                        Femenino
                      </option>
                      <option value="Prefiero no decirlo" className={optionClass}>
                        Prefiero no decirlo
                      </option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="telefono" className={labelClass}>
                    Teléfono / WhatsApp <span className="text-red-500">*</span>
                  </label>
                  <div className={inputWrapperClass}>
                    <Phone className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                    <input
                      id="telefono"
                      name="telefono"
                      type="tel"
                      placeholder="Ej: 71234567"
                      value={form.telefono}
                      onChange={handleChange}
                      required
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="universidad" className={labelClass}>
                    Universidad <span className="text-red-500">*</span>
                  </label>
                  <div className={inputWrapperClass}>
                    <Building className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                    <input
                      id="universidad"
                      name="universidad"
                      type="text"
                      placeholder="Ej: UMSA"
                      value={form.universidad}
                      onChange={handleChange}
                      required
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="profesion" className={labelClass}>
                    Profesión / Cargo <span className="text-red-500">*</span>
                  </label>
                  <div className={inputWrapperClass}>
                    <Briefcase className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                    <input
                      id="profesion"
                      name="profesion"
                      type="text"
                      placeholder="Ej: Estudiante de Medicina"
                      value={form.profesion}
                      onChange={handleChange}
                      required
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="fechaExamen" className={labelClass}>
                    Fecha Tentativa de Examen <span className={`font-medium normal-case ${subtleText}`}>(Opcional)</span>
                  </label>
                  <div className={inputWrapperClass}>
                    <GraduationCap className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                    <input
                      id="fechaExamen"
                      name="fechaExamen"
                      type="date"
                      value={form.fechaExamen}
                      onChange={handleChange}
                      style={colorSchemeStyle}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Sección 2: Credenciales de Acceso */}
            <section className="space-y-4">
              <div className={`pb-2 border-b ${dividerClass}`}>
                <h2 className="text-sm sm:text-base font-extrabold">
                  Credenciales de Acceso
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="email" className={labelClass}>
                    Correo electrónico <span className="text-red-500">*</span>
                  </label>
                  <div className={inputWrapperClass}>
                    <Mail className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="off"
                      placeholder="usuario@correo.com"
                      value={form.email}
                      onChange={handleChange}
                      required
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className={labelClass}>
                    Contraseña Inicial <span className="text-red-500">*</span>
                  </label>
                  <div className={inputWrapperClass}>
                    <Lock className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Mínimo 6 caracteres"
                      value={form.password}
                      onChange={handleChange}
                      required
                      minLength={6}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        isDark ? 'text-slate-300 hover:bg-white/10' : 'text-[#014ba0] hover:bg-slate-200/60'
                      }`}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p
                    className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold ${
                      passwordOk
                        ? isDark
                          ? 'text-emerald-300'
                          : 'text-emerald-700'
                        : subtleText
                    }`}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Mínimo 6 caracteres</span>
                  </p>
                </div>
              </div>
            </section>

            {/* Sección 3: Vigencia de Cuenta Activa */}
            <section
              className={`p-4 sm:p-5 rounded-xl border space-y-4 ${
                isDark ? 'bg-[#162235] border-white/10' : 'bg-slate-50/90 border-[#2E4A70]/15'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <span className="text-sm font-extrabold flex items-center gap-2">
                  <CalendarClock
                    className={`w-4 h-4 shrink-0 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}
                  />
                  <span>Vigencia de Cuenta Activa</span>
                </span>

                <span
                  className={`text-xs font-bold px-3 py-1 rounded-full self-start sm:self-auto ${
                    validityOption === 'unlimited'
                      ? isDark
                        ? 'bg-sky-500/20 text-sky-300'
                        : 'bg-sky-100 text-sky-800'
                      : isDark
                        ? 'bg-[#24B0BA]/20 text-[#24B0BA]'
                        : 'bg-[#014ba0]/10 text-[#014ba0]'
                  }`}
                >
                  {validityOption === 'unlimited'
                    ? 'Sin fecha de vencimiento'
                    : validityOption === 'exact' && !exactDate
                      ? 'Selecciona una fecha límite'
                      : `Del ${formatDateShortEs(computedExpiration.activeFrom)} al ${formatDateShortEs(
                          computedExpiration.activeUntil
                        )} (${calculateDurationDays(
                          computedExpiration.activeFrom,
                          computedExpiration.activeUntil
                        )} días)`}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {VALIDITY_OPTIONS.map((opt) => {
                  const active = validityOption === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setValidityOption(opt.value)}
                      className={`px-3 py-2 rounded-xl border text-xs font-bold transition-colors min-h-[38px] cursor-pointer ${
                        active
                          ? isDark
                            ? 'bg-[#24B0BA] border-[#24B0BA] text-slate-950'
                            : 'bg-[#014ba0] border-[#014ba0] text-white'
                          : isDark
                            ? 'bg-[#1e293b] border-white/15 text-slate-200 hover:bg-white/10'
                            : 'bg-white border-[#2E4A70]/20 text-[#2E4A70] hover:bg-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {validityOption === 'exact' && (
                <div className="max-w-xs">
                  <label htmlFor="exactDate" className={labelClass}>
                    Fecha límite de vigencia
                  </label>
                  <div className={inputWrapperClass}>
                    <Calendar className="w-4 h-4 shrink-0 opacity-60 pointer-events-none" />
                    <input
                      id="exactDate"
                      type="date"
                      value={exactDate}
                      min={todayBolivia}
                      onChange={(e) => setExactDate(e.target.value)}
                      style={colorSchemeStyle}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              <p className={`text-xs ${subtleText}`}>
                Al cumplirse la fecha límite (23:59 Hora Bolivia), la cuenta cambiará automáticamente a estado Inactivo.
              </p>
            </section>

            {/* Barra de acciones */}
            <div
              className={`pt-4 border-t flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 ${dividerClass}`}
            >
              <Link
                href="/admin/users"
                className={`inline-flex items-center justify-center px-5 py-2.5 rounded-xl border text-xs sm:text-sm font-bold transition-colors min-h-[44px] ${
                  isDark
                    ? 'border-white/15 text-slate-200 hover:bg-white/5'
                    : 'border-[#2E4A70]/20 text-[#2E4A70] hover:bg-slate-100'
                }`}
              >
                Cancelar
              </Link>

              <button
                type="submit"
                disabled={isLoading}
                className={`inline-flex items-center justify-center gap-2 px-7 py-2.5 rounded-xl text-xs sm:text-sm transition-colors min-h-[44px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${primaryBtnClass}`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Registrando...</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>Registrar Usuario</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
