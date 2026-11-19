'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import {
  getCachedContactInfo,
  getCachedPendingAccessRequest,
  setCachedPendingAccessRequest,
} from '@/lib/catalogCache';
import { formatDriveUrl } from '@/lib/driveUtils';
import Swal from 'sweetalert2';
import { LockKeyhole, Send, Hourglass, MessageCircle, Loader2 } from 'lucide-react';

const DEFAULT_BUSINESS_NAME = 'DOCTEMIA MC';

function resolveQrPreviewUrl(url, useFallback = false) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.includes('drive.google.com') || trimmed.includes('lh3.googleusercontent.com')) {
    if (useFallback) {
      return formatDriveUrl(trimmed);
    }
    const pathMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const fileId = pathMatch?.[1] || queryMatch?.[1];
    if (fileId) {
      return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400-h400`;
    }
  }
  return trimmed;
}

/**
 * Pantalla homologada de Acceso Restringido para módulos que requieren `hasPagoUnicoAccess`.
 * Muestra estado de solicitud pendiente, QR de pago, contacto WhatsApp y formulario de solicitud.
 */
export default function PagoUnicoAccessDenied({
  user,
  isDark = false,
  title = 'Acceso Restringido',
  description = 'Para acceder a este contenido necesitas contar con el acceso de Pago Único habilitado en tu cuenta.',
  whatsappSubject = 'el acceso de Pago Único',
  requestType = 'pago_unico_access',
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkingRequest, setCheckingRequest] = useState(Boolean(user?.uid));
  const [requestSent, setRequestSent] = useState(false);
  const [contactInfo, setContactInfo] = useState({
    qrUrl: '',
    adminPhone: '',
    businessName: DEFAULT_BUSINESS_NAME,
  });
  const [phoneInput, setPhoneInput] = useState('');
  const [qrFallback, setQrFallback] = useState(false);
  const [qrError, setQrError] = useState(false);

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f8fafc' : '#1a2639',
      confirmButtonColor: isDark ? '#24B0BA' : '#014ba0',
      cancelButtonColor: '#dc2626',
    }),
    [isDark]
  );

  useEffect(() => {
    let cancelled = false;

    const loadAccessGateInfo = async () => {
      if (!user?.uid) {
        setCheckingRequest(false);
        return;
      }
      setCheckingRequest(true);
      try {
        const [hasPending, info] = await Promise.all([
          getCachedPendingAccessRequest(user.uid),
          getCachedContactInfo(),
        ]);
        if (cancelled) return;
        if (hasPending) setRequestSent(true);
        if (info) {
          setContactInfo((prev) => ({
            ...prev,
            ...info,
            businessName: info.businessName || DEFAULT_BUSINESS_NAME,
          }));
        }
      } catch (err) {
        console.error('Error cargando información de solicitud de acceso:', err);
      } finally {
        if (!cancelled) setCheckingRequest(false);
      }
    };

    loadAccessGateInfo();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    setQrFallback(false);
    setQrError(false);
  }, [contactInfo.qrUrl]);

  const qrPreviewUrl = resolveQrPreviewUrl(contactInfo.qrUrl, qrFallback);
  const businessName = contactInfo.businessName || DEFAULT_BUSINESS_NAME;
  const studentDisplayName =
    user?.fullName || user?.name || user?.displayName || user?.email || 'Estudiante';

  const handleSubmitRequest = async (e) => {
    e.preventDefault();
    const cleanedPhone = phoneInput.trim();
    if (!cleanedPhone) {
      Swal.fire({
        title: 'Número requerido',
        text: 'Por favor, ingresa tu número de WhatsApp.',
        icon: 'warning',
        ...swalTheme,
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'pagoUnico_solicitudes'), {
        userId: user.uid,
        userName: studentDisplayName,
        userEmail: user.email || '',
        userPhone: cleanedPhone,
        requestDate: serverTimestamp(),
        status: 'pendiente',
        type: requestType,
      });
      setRequestSent(true);
      setCachedPendingAccessRequest(user.uid, true);
      Swal.fire({
        title: '¡Solicitud Enviada!',
        text: 'Te contactaremos pronto.',
        icon: 'success',
        ...swalTheme,
      });
    } catch (error) {
      console.error('Error al crear solicitud de acceso:', error);
      Swal.fire({
        title: 'Error',
        text: 'No se pudo enviar tu solicitud. Intenta de nuevo.',
        icon: 'error',
        ...swalTheme,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const pageBg = isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]';
  const cardSurface = isDark
    ? 'bg-[#1e293b] border-white/10 text-white shadow-xl'
    : 'bg-white border-[#2E4A70]/15 text-[#1a2639] shadow-sm';
  const mutedText = isDark ? 'text-slate-300' : 'text-[#2E4A70]';

  return (
    <div className={`min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 sm:p-6 ${pageBg}`}>
      <div className={`w-full max-w-lg rounded-2xl border p-6 sm:p-8 text-center ${cardSurface}`}>
        <div
          className={`w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center ${
            isDark ? 'bg-[#24B0BA]/15 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
          }`}
        >
          <LockKeyhole className="h-8 w-8" />
        </div>

        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{title}</h1>
        <p className={`mt-2.5 text-sm sm:text-base leading-relaxed ${mutedText}`}>
          {description}
        </p>

        {checkingRequest ? (
          <div className={`mt-6 flex items-center justify-center gap-2.5 py-4 text-sm font-semibold ${mutedText}`}>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Verificando estado de solicitud...</span>
          </div>
        ) : requestSent ? (
          <div
            className={`mt-6 flex items-center justify-center gap-3 p-4 rounded-xl border text-sm font-bold ${
              isDark
                ? 'bg-amber-500/15 border-amber-400/30 text-amber-200'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            <Hourglass className="h-5 w-5 shrink-0" />
            <span>Tu solicitud de acceso está pendiente de revisión.</span>
          </div>
        ) : (
          <div className="mt-6 space-y-5 text-left">
            {qrPreviewUrl && !qrError && (
              <div
                className={`rounded-xl border p-4 flex flex-col items-center gap-3 ${
                  isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FAF5EB] border-[#2E4A70]/10'
                }`}
              >
                <div className="w-44 h-44 rounded-xl overflow-hidden bg-white border border-[#2E4A70]/15">
                  <img
                    src={qrPreviewUrl}
                    alt="Código QR de Pago"
                    referrerPolicy={qrPreviewUrl.startsWith('http') ? 'no-referrer' : undefined}
                    onError={() => {
                      if (!qrFallback && contactInfo.qrUrl) {
                        setQrFallback(true);
                      } else {
                        setQrError(true);
                      }
                    }}
                    className="w-full h-full object-contain"
                  />
                </div>
                <p className={`text-xs text-center ${mutedText}`}>
                  Escanea el QR para completar tu pago y luego envíanos tu comprobante.
                </p>
              </div>
            )}

            {contactInfo.adminPhone && (
              <a
                href={`https://api.whatsapp.com/send?phone=${String(contactInfo.adminPhone).trim()}&text=${encodeURIComponent(
                  `Hola ${businessName}, soy ${studentDisplayName}. Acabo de realizar el pago para ${whatsappSubject}. Adjunto mi comprobante.`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 min-h-[44px] text-sm font-bold transition-colors ${
                  isDark
                    ? 'bg-[#24B0BA] hover:bg-[#1d9aa3] text-slate-950'
                    : 'bg-[#24B0BA] hover:bg-[#1d9aa3] text-white'
                }`}
              >
                <MessageCircle className="h-4 w-4 shrink-0" />
                <span>Contactar por WhatsApp</span>
              </a>
            )}

            <form onSubmit={handleSubmitRequest} className="space-y-3 pt-1">
              <label
                htmlFor="pago-unico-access-phone"
                className={`block text-xs font-extrabold uppercase tracking-wide ${mutedText}`}
              >
                O solicita activación directa
              </label>
              <input
                id="pago-unico-access-phone"
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="Tu número de WhatsApp (ej: +591...)"
                style={{ colorScheme: isDark ? 'dark' : 'light' }}
                className={`w-full px-3.5 py-2.5 min-h-[44px] rounded-xl border text-sm font-medium outline-none transition-colors ${
                  isDark
                    ? 'bg-[#162235] border-white/15 text-white placeholder:text-slate-400 focus:border-[#24B0BA]'
                    : 'bg-white border-[#2E4A70]/25 text-[#1a2639] placeholder:text-slate-400 focus:border-[#014ba0]'
                }`}
              />
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 min-h-[44px] text-sm font-bold text-white bg-[#014ba0] hover:bg-[#013b80] disabled:opacity-50 cursor-pointer transition-colors"
              >
                <Send className="h-4 w-4 shrink-0" />
                <span>{isSubmitting ? 'Enviando solicitud...' : 'Solicitar Acceso Ahora'}</span>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
