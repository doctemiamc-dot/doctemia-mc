'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { invalidateCatalogCache } from '@/lib/catalogCache';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import Swal from 'sweetalert2';
import { toast, Toaster } from 'react-hot-toast';
import {
  Upload,
  Phone,
  Link2,
  Trash2,
  QrCode,
  Loader2,
  Save,
  X,
  Database,
  ExternalLink,
} from 'lucide-react';

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_IMAGE_EXT = /\.(png|jpg|jpeg|webp)$/i;
const MAX_QR_SIZE_BYTES = 10 * 1024 * 1024;

function convertDriveOrHttpUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('drive.google.com/file/d/')) {
    try {
      const id = trimmed.split('/d/')[1].split('/')[0];
      return `https://drive.google.com/uc?export=view&id=${id}`;
    } catch {
      return '';
    }
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

export default function QRGestionPage() {
  const [qrUrl, setQrUrl] = useState('');
  const [qrStoragePath, setQrStoragePath] = useState(null);
  const [adminPhone, setAdminPhone] = useState('');
  const [newAdminPhone, setNewAdminPhone] = useState('');

  // Modo de carga: 'upload' (Supabase Storage) | 'link' (URL externa)
  const [qrSourceMode, setQrSourceMode] = useState('upload');
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState('');
  const [newQrLink, setNewQrLink] = useState('');
  const [linkPreview, setLinkPreview] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingQr, setDeletingQr] = useState(false);
  const fileInputRef = useRef(null);

  const { isDark, isLoaded } = useTheme();
  const { firebaseAuthUser, loading: authLoading } = useAuth();

  const getAuthHeaders = useCallback(
    async (extra = {}) => {
      const headers = { ...extra };
      if (firebaseAuthUser) {
        const token = await firebaseAuthUser.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      return headers;
    },
    [firebaseAuthUser]
  );

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const loadContactInfo = async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'pags', 'infoContacto'));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data();
          setQrUrl(data.qrUrl || '');
          setQrStoragePath(data.qrStoragePath || null);
          setAdminPhone(data.adminPhone || '');
          setNewAdminPhone(data.adminPhone || '');
        }
      } catch (error) {
        console.error('Error cargando la información de contacto:', error);
        toast.error('Error al cargar los datos.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadContactInfo();
    return () => {
      cancelled = true;
    };
  }, [authLoading]);

  // Liberar ObjectURL temporal cuando cambie el archivo seleccionado
  useEffect(() => {
    return () => {
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    };
  }, [filePreviewUrl]);

  const handleFilePick = (fileList) => {
    const file = fileList?.[0];
    if (!file) return;

    const mime = String(file.type || '').toLowerCase();
    const name = String(file.name || '').trim();
    if (!ALLOWED_IMAGE_TYPES.has(mime) && !ALLOWED_IMAGE_EXT.test(name)) {
      toast.error('Formato no válido. Usa PNG, JPG, JPEG o WEBP.');
      return;
    }
    if (file.size > MAX_QR_SIZE_BYTES) {
      toast.error('La imagen supera el límite de 10 MB.');
      return;
    }

    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setSelectedFile(file);
    setFilePreviewUrl(URL.createObjectURL(file));
    setQrSourceMode('upload');
  };

  const clearSelectedFile = () => {
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setSelectedFile(null);
    setFilePreviewUrl('');
  };

  const handleLinkChange = (e) => {
    const value = e.target.value;
    setNewQrLink(value);
    setLinkPreview(convertDriveOrHttpUrl(value));
  };

  const isStoredInSupabase = Boolean(
    qrStoragePath || (qrUrl && qrUrl.startsWith('/api/qr-gestion/'))
  );

  const handleUpdateInfo = async (e) => {
    e?.preventDefault?.();
    if (saving || deletingQr) return;

    const cleanPhone = newAdminPhone.trim();
    if (!cleanPhone) {
      toast.error('El número de teléfono del administrador es obligatorio.');
      return;
    }

    if (qrSourceMode === 'link' && newQrLink.trim() && !linkPreview) {
      toast.error('Por favor, proporciona un enlace válido (https://...) para el QR.');
      return;
    }

    setSaving(true);
    const toastId = toast.loading(
      selectedFile ? 'Subiendo nueva imagen QR a Supabase...' : 'Guardando cambios...'
    );

    try {
      let res;
      if (qrSourceMode === 'upload' && selectedFile) {
        const headers = await getAuthHeaders();
        const fd = new FormData();
        fd.append('file', selectedFile);
        fd.append('adminPhone', cleanPhone);
        res = await fetch('/api/qr-gestion', {
          method: 'POST',
          headers,
          body: fd,
        });
      } else {
        const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
        const payload = { adminPhone: cleanPhone };
        if (qrSourceMode === 'link' && newQrLink.trim()) {
          payload.qrUrl = linkPreview;
        }
        res = await fetch('/api/qr-gestion', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo actualizar la información.');
      }

      setQrUrl(data.qrUrl ?? qrUrl);
      setQrStoragePath(data.qrStoragePath ?? null);
      setAdminPhone(data.adminPhone || cleanPhone);
      clearSelectedFile();
      setNewQrLink('');
      setLinkPreview('');
      invalidateCatalogCache('contact_info');

      toast.success(
        data.deletedOldFile
          ? 'QR actualizado y la imagen anterior fue eliminada de Supabase.'
          : 'Información actualizada correctamente.',
        { id: toastId }
      );
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Error al actualizar la información.', { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCurrentQr = async () => {
    if (!qrUrl || saving || deletingQr) return;

    const confirm = await Swal.fire({
      title: '¿Eliminar imagen QR actual?',
      text: isStoredInSupabase
        ? 'Se borrará la imagen física de Supabase Storage y se limpiará el QR de la base de datos.'
        : 'Se quitará el enlace QR actual de la base de datos.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar QR',
      cancelButtonText: 'Cancelar',
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f8fafc' : '#1a2639',
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#6b7280',
    });

    if (!confirm.isConfirmed) return;

    setDeletingQr(true);
    const toastId = toast.loading('Eliminando imagen QR...');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/qr-gestion', {
        method: 'DELETE',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo eliminar el QR.');
      }

      setQrUrl('');
      setQrStoragePath(null);
      invalidateCatalogCache('contact_info');

      toast.success(
        data.deletedFromStorage
          ? 'QR eliminado de Supabase Storage y BD.'
          : 'QR eliminado de la base de datos.',
        { id: toastId }
      );
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar el QR.', { id: toastId });
    } finally {
      setDeletingQr(false);
    }
  };

  if (!isLoaded || loading) {
    return (
      <section
        className={`min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center gap-3 ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <Loader2 className={`w-8 h-8 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
        <p className="text-sm font-bold">Cargando configuración de contacto y QR...</p>
      </section>
    );
  }

  const pageBg = isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]';
  const surfaceClass = isDark
    ? 'bg-[#1e293b] border-white/10 text-white'
    : 'bg-white border-[#2E4A70]/15 text-[#1a2639]';
  const subSurfaceClass = isDark
    ? 'bg-[#162235] border-white/10'
    : 'bg-[#FFF9F0]/70 border-[#2E4A70]/15';
  const inputClass = isDark
    ? 'bg-[#162235] border-white/15 text-white placeholder:text-slate-400 focus:border-[#24B0BA]'
    : 'bg-white border-[#2E4A70]/25 text-[#1a2639] placeholder:text-slate-400 focus:border-[#014ba0]';

  const hasPendingQrChange =
    (qrSourceMode === 'upload' && Boolean(selectedFile)) ||
    (qrSourceMode === 'link' && Boolean(linkPreview));
  const phoneChanged = newAdminPhone.trim() !== adminPhone.trim();

  return (
    <section className={`min-h-[calc(100vh-4rem)] p-3 sm:p-6 transition-colors ${pageBg}`}>
      <Toaster position="top-right" />

      <div className="max-w-4xl mx-auto space-y-5">
        <header>
          <h1
            className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2.5"
            style={{ color: isDark ? '#24B0BA' : '#014ba0' }}
          >
            <QrCode className="w-7 h-7 shrink-0" />
            <span>Gestión de Contacto y QR de Pagos</span>
          </h1>
          <p className={`text-xs sm:text-sm font-medium mt-1 ${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]'}`}>
            Administra el número de WhatsApp y la imagen QR guardada en Supabase Storage o por enlace externo.
          </p>
        </header>

        <form onSubmit={handleUpdateInfo} className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Columna izquierda: QR Actual guardado */}
          <div className={`lg:col-span-5 p-5 rounded-2xl border shadow-sm space-y-4 ${surfaceClass}`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-extrabold flex items-center gap-2">
                <QrCode className="w-4 h-4 text-[#24B0BA]" />
                <span>QR Actual</span>
              </h2>
              {qrUrl && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-1 rounded-full ${
                    isStoredInSupabase
                      ? isDark
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : isDark
                      ? 'bg-blue-500/20 text-blue-300'
                      : 'bg-blue-50 text-[#014ba0] border border-blue-200'
                  }`}
                >
                  {isStoredInSupabase ? (
                    <>
                      <Database className="w-3 h-3" />
                      <span>Guardado en Supabase</span>
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-3 h-3" />
                      <span>Enlace externo</span>
                    </>
                  )}
                </span>
              )}
            </div>

            {qrUrl ? (
              <div className={`p-4 rounded-2xl border flex flex-col items-center gap-3 ${subSurfaceClass}`}>
                <img
                  src={qrUrl}
                  alt="Código QR actual de pagos"
                  className={`w-52 h-52 sm:w-56 sm:h-56 object-contain rounded-xl border p-2 ${
                    isDark ? 'bg-[#0f172a] border-white/15' : 'bg-white border-[#2E4A70]/15'
                  }`}
                />
                <button
                  type="button"
                  disabled={saving || deletingQr}
                  onClick={handleDeleteCurrentQr}
                  className={`w-full min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 ${
                    isDark
                      ? 'border-red-500/35 bg-red-500/15 hover:bg-red-500/25 text-red-300'
                      : 'border-red-200 bg-red-50 hover:bg-red-100 text-red-600'
                  }`}
                >
                  {deletingQr ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  <span>{deletingQr ? 'Eliminando...' : 'Eliminar imagen QR'}</span>
                </button>
              </div>
            ) : (
              <div className={`p-8 rounded-2xl border-2 border-dashed text-center space-y-2 ${subSurfaceClass}`}>
                <QrCode className="w-10 h-10 mx-auto opacity-40" />
                <p className="text-sm font-bold">Sin código QR registrado</p>
                <p className="text-xs opacity-75">
                  Sube una imagen PNG/JPG o pega un enlace para mostrarlo a los estudiantes.
                </p>
              </div>
            )}
          </div>

          {/* Columna derecha: Formulario de WhatsApp + Subir / Reemplazar QR */}
          <div className={`lg:col-span-7 p-5 sm:p-6 rounded-2xl border shadow-sm space-y-5 ${surfaceClass}`}>
            {/* Teléfono WhatsApp */}
            <div className="space-y-2">
              <label htmlFor="adminPhone" className="text-sm font-extrabold flex items-center gap-2">
                <Phone className="w-4 h-4 text-[#014ba0]" style={isDark ? { color: '#24B0BA' } : undefined} />
                <span>Número de WhatsApp del Admin *</span>
              </label>
              <p className={`text-xs ${isDark ? 'text-slate-300' : 'text-[#2E4A70]'}`}>
                Se usa para que los estudiantes envíen su comprobante. Incluye código de país (ej: +591XXXXXXXX).
              </p>
              <input
                id="adminPhone"
                type="text"
                required
                value={newAdminPhone}
                onChange={(e) => setNewAdminPhone(e.target.value)}
                style={{ colorScheme: isDark ? 'dark' : 'light' }}
                className={`w-full min-h-[44px] rounded-xl border px-3.5 py-2.5 text-sm outline-none transition ${inputClass}`}
                placeholder="+59168706660"
              />
            </div>

            {/* Selector de origen del nuevo QR */}
            <div className={`pt-4 border-t space-y-3.5 ${isDark ? 'border-white/10' : 'border-[#2E4A70]/10'}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <span className="text-sm font-extrabold">
                  {qrUrl ? 'Reemplazar imagen QR (opcional)' : 'Subir o vincular imagen QR'}
                </span>

                <div
                  className={`grid grid-cols-2 sm:inline-flex rounded-xl p-1 border w-full sm:w-auto ${
                    isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0] border-[#2E4A70]/15'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setQrSourceMode('upload')}
                    className={`inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      qrSourceMode === 'upload'
                        ? 'bg-[#014ba0] text-white'
                        : isDark
                        ? 'text-slate-300 hover:text-white'
                        : 'text-[#2E4A70] hover:text-[#014ba0]'
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Subir a BD</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setQrSourceMode('link')}
                    className={`inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      qrSourceMode === 'link'
                        ? 'bg-[#014ba0] text-white'
                        : isDark
                        ? 'text-slate-300 hover:text-white'
                        : 'text-[#2E4A70] hover:text-[#014ba0]'
                    }`}
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Pegar enlace</span>
                  </button>
                </div>
              </div>

              {qrSourceMode === 'upload' ? (
                <div className="space-y-3">
                  {selectedFile ? (
                    <div className={`p-3.5 rounded-2xl border space-y-3 ${subSurfaceClass}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">{selectedFile.name}</p>
                          <p className="text-[11px] opacity-75 tabular-nums">
                            {(selectedFile.size / 1024).toFixed(0)} KB · Listo para guardar en Supabase
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={clearSelectedFile}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-500 hover:bg-red-500/25 text-xs font-bold cursor-pointer shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Quitar</span>
                        </button>
                      </div>

                      {filePreviewUrl && (
                        <div className="flex justify-center">
                          <img
                            src={filePreviewUrl}
                            alt="Previsualización del nuevo QR"
                            className={`w-44 h-44 object-contain rounded-xl border p-2 ${
                              isDark ? 'bg-[#0f172a] border-white/15' : 'bg-white border-[#2E4A70]/15'
                            }`}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          fileInputRef.current?.click();
                        }
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleFilePick(e.dataTransfer?.files);
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      className={`rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                        isDark
                          ? 'border-white/20 hover:border-[#24B0BA] hover:bg-white/5'
                          : 'border-[#2E4A70]/25 hover:border-[#014ba0] hover:bg-[#FFF9F0]/60'
                      }`}
                    >
                      <Upload className="w-6 h-6 mx-auto opacity-75 mb-2" />
                      <p className="text-xs sm:text-sm font-bold">
                        {qrUrl
                          ? 'Arrastra aquí la nueva imagen QR o haz clic para reemplazar'
                          : 'Arrastra aquí tu imagen QR o haz clic para seleccionarla'}
                      </p>
                      <p className="text-[11px] opacity-70 mt-1">
                        PNG, JPG, JPEG o WEBP (máx. 10 MB)
                      </p>
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    onChange={(e) => {
                      handleFilePick(e.target.files);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />

                  {isStoredInSupabase && selectedFile && (
                    <p className="text-[11px] text-amber-500 font-semibold">
                      Al guardar se subirá la nueva imagen y la anterior se eliminará automáticamente de Supabase Storage.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="newQrLink" className="block text-xs font-bold mb-1 opacity-80">
                      Enlace directo de imagen QR o Google Drive
                    </label>
                    <input
                      id="newQrLink"
                      type="text"
                      value={newQrLink}
                      onChange={handleLinkChange}
                      style={{ colorScheme: isDark ? 'dark' : 'light' }}
                      className={`w-full min-h-[44px] rounded-xl border px-3.5 py-2.5 text-sm outline-none transition ${inputClass}`}
                      placeholder="https://drive.google.com/file/d/... o URL de imagen"
                    />
                  </div>

                  {linkPreview && (
                    <div className={`p-3.5 rounded-2xl border flex flex-col items-center gap-2 ${subSurfaceClass}`}>
                      <p className="text-xs font-bold opacity-80">Previsualización del enlace:</p>
                      <img
                        src={linkPreview}
                        alt="Previsualización QR externo"
                        className={`w-44 h-44 object-contain rounded-xl border p-2 ${
                          isDark ? 'bg-[#0f172a] border-white/15' : 'bg-white border-[#2E4A70]/15'
                        }`}
                      />
                    </div>
                  )}

                  {isStoredInSupabase && linkPreview && (
                    <p className="text-[11px] text-amber-500 font-semibold">
                      Al guardar con enlace externo, el archivo QR anterior se eliminará automáticamente de Supabase Storage.
                    </p>
                  )}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={
                saving ||
                deletingQr ||
                !newAdminPhone.trim() ||
                (qrSourceMode === 'link' && Boolean(newQrLink.trim()) && !linkPreview) ||
                (!phoneChanged && !hasPendingQrChange)
              }
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 text-white px-6 py-3 rounded-xl transition bg-[#014ba0] hover:bg-[#013b80] disabled:opacity-45 font-bold text-sm cursor-pointer"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{saving ? 'Guardando...' : 'Guardar Cambios'}</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
