
'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../../lib/firebase';
import { collection, doc, addDoc, serverTimestamp, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { useAuth } from '../../../context/AuthContext';
import { useTheme } from '../../../context/ThemeContext';
import {
  getCachedCategories,
  getCachedPagoUnicoCourses,
  getCachedCourseMaterials,
  getCachedContactInfo,
  getCachedPendingAccessRequest,
  setCachedPendingAccessRequest,
} from '@/lib/catalogCache';
import { countValidCourseVideos } from '@/lib/courseCurriculum';
import Swal from 'sweetalert2';
import { LockKeyhole, Send, Hourglass, BookOpen, Search, CheckCircle2, Bookmark, Filter, Grid3X3, List, Layers, PlayCircle, FileText, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const NOMBRE_NEGOCIO = 'DOCTEMIA MC';

const extractDriveFileId = (url) => {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  const pathMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (pathMatch) return pathMatch[1];
  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch) return queryMatch[1];
  return '';
};

const resolveCourseCoverUrl = (url, useFallback = false) => {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.includes('drive.google.com') || trimmed.includes('lh3.googleusercontent.com')) {
    const fileId = extractDriveFileId(trimmed);
    if (fileId) {
      return useFallback
        ? `https://drive.google.com/uc?export=view&id=${fileId}`
        : `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
    }
  }
  return trimmed;
};

// Componente de Pantalla de Acceso Denegado
const AccessDeniedScreen = ({ user, isDark, swalTheme }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [requestSent, setRequestSent] = useState(false);
    const [contactInfo, setContactInfo] = useState({ qrUrl: '', adminPhone: '' });
    const [showModal, setShowModal] = useState(false);
    const [phoneInput, setPhoneInput] = useState('');
    
    useEffect(() => {
        const checkRequestAndLoadInfo = async () => {
            if (user?.uid) {
                const [hasPending, info] = await Promise.all([
                    getCachedPendingAccessRequest(user.uid),
                    getCachedContactInfo(),
                ]);
                if (hasPending) setRequestSent(true);
                if (info) setContactInfo(info);
            }
        };
        checkRequestAndLoadInfo();
    }, [user?.uid]);

    const handleRequestAccessPopup = () => {
        setShowModal(true);
    };

    const handleSubmitRequest = async () => {
        if (!phoneInput) {
            Swal.fire({ 
                title: 'Error', 
                text: 'Por favor, ingresa tu número de WhatsApp', 
                icon: 'error', 
                ...swalTheme 
            });
            return;
        }

        setIsSubmitting(true);
        try {
            await addDoc(collection(db, "pagoUnico_solicitudes"), { 
                userId: user.uid, 
                userName: user.name || user.displayName, 
                userEmail: user.email, 
                userPhone: phoneInput, 
                requestDate: serverTimestamp(), 
                status: 'pendiente', 
                type: 'pago_unico_access' 
            });
            setRequestSent(true);
            setCachedPendingAccessRequest(user.uid, true);
            setShowModal(false);
            Swal.fire({ 
                title: '¡Solicitud Enviada!', 
                text: 'Te contactaremos pronto.', 
                icon: 'success', 
                ...swalTheme 
            });
        } catch (error) {
            console.error("Error al crear solicitud:", error);
            Swal.fire({ 
                title: 'Error', 
                text: 'No se pudo enviar tu solicitud.', 
                icon: 'error', 
                ...swalTheme 
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-orange-50 to-blue-50 flex flex-col items-center justify-center p-4">
            <div className="max-w-lg w-full bg-white rounded-2xl shadow-2xl p-8 text-center transform hover:scale-105 transition-all duration-300">
                <div className="w-24 h-24 bg-gradient-to-r from-teal-400 to-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
                    <LockKeyhole className="h-12 w-12 text-white" />
                </div>
                
                <h1 className="text-3xl font-bold text-gray-800 mb-4">Acceso Restringido</h1>
                <p className="text-gray-600 text-lg mb-8 leading-relaxed">
                    Para acceder al catálogo exclusivo de cursos de pago único, necesitas la aprobación de nuestro equipo.
                </p>

                <div className="space-y-4">
                    {requestSent ? (
                        <div className="flex items-center justify-center gap-3 p-4 bg-amber-50 rounded-xl border border-amber-300">
                            <Hourglass className="h-6 w-6 text-amber-600 animate-spin" />
                            <span className="font-semibold text-amber-800">Tu solicitud está en proceso</span>
                        </div>
                    ) : (
                        <button 
                            onClick={handleRequestAccessPopup} 
                            disabled={isSubmitting} 
                            className="w-full bg-gradient-to-r from-teal-500 to-blue-600 text-white font-bold py-4 px-8 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:transform-none"
                        >
                            {isSubmitting ? (
                                <span className="flex items-center justify-center gap-2">
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                    Procesando...
                                </span>
                            ) : (
                                <span className="flex items-center justify-center gap-2">
                                    <Send className="h-5 w-5" />
                                    Solicitar Acceso Ahora
                                </span>
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* Modal Mejorado */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50 backdrop-blur-sm">
                    <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl transform scale-100 transition-all duration-300">
                        <div className="flex items-center justify-between p-6 border-b border-gray-200">
                            <h3 className="text-2xl font-extrabold text-[#014ba0]">
                                ¡Obtén tu Acceso!
                            </h3>
                            <button 
                                onClick={() => setShowModal(false)} 
                                className="text-gray-400 hover:text-gray-600 transition-colors p-2 hover:bg-gray-100 rounded-full"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            <p className="text-center text-gray-700 leading-relaxed">
                                Realiza el pago usando el código QR y contáctanos vía WhatsApp para activación inmediata.
                            </p>

                            {/* QR Code */}
                            <div className="flex justify-center">
                                {contactInfo.qrUrl ? (
                                    <div className="w-56 h-56 rounded-2xl border-4 border-gradient-to-r from-teal-400 to-blue-500 overflow-hidden shadow-lg">
                                        <img 
                                            src={(() => {
                                                if (contactInfo.qrUrl.includes('drive.google.com/uc?export=view&id=')) {
                                                    const fileId = contactInfo.qrUrl.split('id=')[1];
                                                    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400-h400`;
                                                }
                                                return contactInfo.qrUrl;
                                            })()} 
                                            alt="Código QR de Pago" 
                                            referrerPolicy={contactInfo.qrUrl?.startsWith('http') ? 'no-referrer' : undefined}
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                ) : (
                                    <div className="w-56 h-56 bg-gray-100 rounded-2xl flex items-center justify-center">
                                        <p className="text-gray-500">QR no disponible</p>
                                    </div>
                                )}
                            </div>

                            <div className="text-center">
                                <p className="font-semibold text-gray-800 mb-4">¿Ya completaste el pago?</p>
                                
                                <a 
                                    href={`https://api.whatsapp.com/send?phone=${contactInfo.adminPhone}&text=${encodeURIComponent(`Hola ${NOMBRE_NEGOCIO}, soy ${user.name || user.displayName}. He realizado el pago para acceso a cursos premium. Adjunto comprobante.`)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center gap-3 w-full bg-green-500 text-white font-bold py-3 px-6 rounded-xl hover:bg-green-600 transition-colors shadow-lg hover:shadow-xl"
                                >
                                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.488"/>
                                    </svg>
                                    Contactar por WhatsApp
                                </a>
                            </div>

                            <div className="relative my-6">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t border-gray-300"></span>
                                </div>
                                <div className="relative flex justify-center text-sm uppercase font-semibold">
                                    <span className="px-4 bg-white text-gray-500">O solicita contacto</span>
                                </div>
                            </div>

                            <input
                                type="tel"
                                value={phoneInput}
                                onChange={(e) => setPhoneInput(e.target.value)}
                                placeholder="Tu número de WhatsApp (+591...)"
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                            />
                        </div>

                        <div className="flex gap-3 p-6 border-t border-gray-200">
                            <button 
                                onClick={() => setShowModal(false)} 
                                className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors font-medium"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={handleSubmitRequest}
                                disabled={isSubmitting || !phoneInput}
                                className="flex-1 px-6 py-3 bg-gradient-to-r from-teal-500 to-blue-600 text-white rounded-xl hover:from-teal-600 hover:to-blue-700 transition-all disabled:opacity-50 font-medium"
                            >
                                {isSubmitting ? 'Enviando...' : 'Enviar Solicitud'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Componente de Tarjeta de Curso (Cuadrícula y Lista; si no hay imagen, no muestra caja vacía/negra)
const CourseCard = ({
  course,
  categoryName = '',
  isCompleted,
  isOpening = false,
  isToggling = false,
  onToggleComplete,
  onViewContent,
  onPrefetchCourse,
  isDark = false,
  layout = 'grid',
}) => {
  const [imgError, setImgError] = useState(false);
  const [useDriveFallback, setUseDriveFallback] = useState(false);
  const [coverShape, setCoverShape] = useState('standard');
  const coverUrl = resolveCourseCoverUrl(course.imageUrl, useDriveFallback);
  const fallbackCoverUrl = resolveCourseCoverUrl(course.imageUrl, true);

  useEffect(() => {
    setImgError(false);
    setUseDriveFallback(false);
    setCoverShape('standard');
  }, [course.imageUrl]);

  const handleImageError = () => {
    if (!useDriveFallback && fallbackCoverUrl && fallbackCoverUrl !== coverUrl) {
      setUseDriveFallback(true);
      return;
    }
    setImgError(true);
  };

  const handleImageLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (!naturalWidth || !naturalHeight) return;
    if (naturalHeight > naturalWidth * 1.05) {
      setCoverShape('portrait');
    } else if (naturalWidth > naturalHeight * 1.35) {
      setCoverShape('landscape');
    } else {
      setCoverShape('standard');
    }
  };

  const isPortraitCover = coverShape === 'portrait';
  const isWideLandscape = coverShape === 'landscape';

  const showCover = Boolean(coverUrl && !imgError);
  const mods = Array.isArray(course.modules) ? course.modules : [];
  const moduleCount = mods.length;
  const videoCount = countValidCourseVideos(course);

  const cardSurface = isDark
    ? 'bg-[#1e293b] border-white/10 text-white hover:border-[#24B0BA]/55'
    : 'bg-white border-[#2E4A70]/15 text-[#1a2639] hover:border-[#014ba0]/45';

  const mutedText = isDark ? 'text-slate-300' : 'text-[#2E4A70]';
  const categoryBadgeClass = isDark
    ? 'bg-[#24B0BA]/15 text-[#24B0BA]'
    : 'bg-[#014ba0]/10 text-[#014ba0]';
  const coverSurfaceClass = isDark ? 'bg-[#162235]' : 'bg-[#FAF5EB]';

  if (layout === 'list') {
    const listCoverHeightClass = isWideLandscape
      ? 'h-52 sm:h-52 md:h-56'
      : 'h-56 sm:h-72 md:h-[300px] lg:h-[320px]';

    return (
      <article className={`rounded-2xl border overflow-hidden transition-colors ${cardSurface}`}>
        <div className="flex flex-col sm:flex-row sm:items-stretch">
          {showCover && (
            <div
              className={`w-full sm:w-56 md:w-64 lg:w-72 ${listCoverHeightClass} relative shrink-0 overflow-hidden border-b sm:border-b-0 sm:border-r ${
                isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
              } ${coverSurfaceClass}`}
            >
              <img
                src={coverUrl}
                alt={course.title || 'Portada del curso'}
                loading="lazy"
                referrerPolicy={coverUrl.startsWith('http') ? 'no-referrer' : undefined}
                onLoad={handleImageLoad}
                onError={handleImageError}
                className="w-full h-full object-cover object-center"
              />
              {isCompleted && (
                <div className="absolute top-3 right-3 bg-emerald-600 text-white rounded-full p-1.5">
                  <CheckCircle2 size={16} />
                </div>
              )}
            </div>
          )}

          <div className="flex-1 min-w-0 p-5 sm:p-6 flex flex-col justify-between gap-4">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className={`flex flex-wrap items-center gap-2 text-xs font-bold ${mutedText}`}>
                  {!showCover && (
                    <span
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${categoryBadgeClass}`}
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                    </span>
                  )}
                  {categoryName && (
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${categoryBadgeClass}`}>
                      {categoryName}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Layers className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {moduleCount} {moduleCount === 1 ? 'módulo' : 'módulos'}
                    </span>
                  </span>
                  {videoCount > 0 ? (
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <PlayCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {videoCount} {videoCount === 1 ? 'clase' : 'clases'}
                      </span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>PDFs / Diapositivas</span>
                    </span>
                  )}
                </div>

                {!showCover && isCompleted && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-600 text-white">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Completado</span>
                  </span>
                )}
              </div>

              <h4 className="text-lg sm:text-xl font-extrabold leading-snug line-clamp-2">
                {course.title}
              </h4>

              {course.description && (
                <p className={`text-sm leading-relaxed line-clamp-4 ${mutedText}`}>
                  {course.description}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                disabled={isToggling}
                onClick={() => onToggleComplete(course.id, isCompleted)}
                className={`w-full inline-flex items-center justify-center gap-2 font-bold text-xs sm:text-sm py-2.5 px-4 rounded-xl cursor-pointer transition-colors disabled:opacity-75 disabled:cursor-wait ${
                  isCompleted
                    ? isDark
                      ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                    : isDark
                    ? 'bg-white/10 text-blue-100 hover:bg-white/15'
                    : 'bg-[#F0F2F2] text-[#2E4A70] hover:bg-slate-200/80'
                }`}
              >
                {isToggling ? (
                  <>
                    <Loader2 size={17} className="animate-spin" />
                    <span>{isCompleted ? 'Completado' : 'Guardando...'}</span>
                  </>
                ) : isCompleted ? (
                  <>
                    <CheckCircle2 size={17} />
                    <span>Completado</span>
                  </>
                ) : (
                  <>
                    <Bookmark size={17} />
                    <span>Marcar Completado</span>
                  </>
                )}
              </button>

              <Link
                href={`/app/pagoUnicoCourses/ContenidoCursos/${course.id}`}
                prefetch={true}
                onMouseEnter={() => onPrefetchCourse?.(course.id)}
                onFocus={() => onPrefetchCourse?.(course.id)}
                onTouchStart={() => onPrefetchCourse?.(course.id)}
                onClick={() => onViewContent(course.id)}
                aria-busy={isOpening}
                className={`w-full inline-flex items-center justify-center gap-2 bg-[#014ba0] hover:bg-[#013b80] text-white font-bold text-xs sm:text-sm py-2.5 px-4 rounded-xl cursor-pointer transition-all ${
                  isOpening ? 'opacity-85 pointer-events-none scale-[0.99]' : ''
                }`}
              >
                {isOpening ? (
                  <>
                    <Loader2 size={17} className="animate-spin" />
                    <span>Abriendo curso...</span>
                  </>
                ) : (
                  <>
                    <BookOpen size={17} />
                    <span>Ver Contenido</span>
                  </>
                )}
              </Link>
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className={`group rounded-2xl border overflow-hidden flex flex-col justify-between transition-colors ${cardSurface}`}
    >
      <div>
        {showCover ? (
          <div
            className={`relative overflow-hidden h-56 sm:h-60 w-full border-b ${
              isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
            } ${coverSurfaceClass}`}
          >
            <img
              src={coverUrl}
              alt={course.title || 'Portada del curso'}
              loading="lazy"
              referrerPolicy={coverUrl.startsWith('http') ? 'no-referrer' : undefined}
              onLoad={handleImageLoad}
              onError={handleImageError}
              className={`w-full h-full transition-transform duration-300 ${
                isPortraitCover
                  ? 'object-contain p-2 group-hover:scale-[1.03]'
                  : 'object-cover object-center group-hover:scale-105'
              }`}
            />
            {isCompleted && (
              <div className="absolute top-3 right-3 bg-emerald-600 text-white rounded-full p-1.5">
                <CheckCircle2 size={16} />
              </div>
            )}
          </div>
        ) : (
          <div className="px-5 pt-5 pb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-xl ${categoryBadgeClass}`}>
                <BookOpen className="w-4 h-4" />
              </span>
              {categoryName && (
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${categoryBadgeClass}`}>
                  {categoryName}
                </span>
              )}
            </div>
            {isCompleted && (
              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                <CheckCircle2 className="w-3 h-3" />
                <span>Completado</span>
              </span>
            )}
          </div>
        )}

        <div className={`p-5 ${showCover ? 'pt-4' : 'pt-3'} space-y-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {showCover && categoryName && (
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${categoryBadgeClass}`}>
                {categoryName}
              </span>
            )}
            <span className={`inline-flex items-center gap-1.5 text-xs font-bold tabular-nums ${mutedText}`}>
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>
                {moduleCount} {moduleCount === 1 ? 'módulo' : 'módulos'}
                {videoCount > 0
                  ? ` · ${videoCount} ${videoCount === 1 ? 'clase' : 'clases'}`
                  : ' · PDFs / Diapositivas'}
              </span>
            </span>
          </div>

          <h4 className="text-lg font-extrabold leading-snug line-clamp-2">
            {course.title}
          </h4>

          {course.description && (
            <p className={`text-sm leading-relaxed line-clamp-2 ${mutedText}`}>
              {course.description}
            </p>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 pt-1 flex flex-col gap-2">
        <Link
          href={`/app/pagoUnicoCourses/ContenidoCursos/${course.id}`}
          prefetch={true}
          onMouseEnter={() => onPrefetchCourse?.(course.id)}
          onFocus={() => onPrefetchCourse?.(course.id)}
          onTouchStart={() => onPrefetchCourse?.(course.id)}
          onClick={() => onViewContent(course.id)}
          aria-busy={isOpening}
          className={`w-full inline-flex items-center justify-center gap-2 bg-[#014ba0] hover:bg-[#013b80] text-white font-bold text-xs sm:text-sm py-2.5 px-4 rounded-xl cursor-pointer transition-all ${
            isOpening ? 'opacity-85 pointer-events-none scale-[0.99]' : ''
          }`}
        >
          {isOpening ? (
            <>
              <Loader2 size={17} className="animate-spin" />
              <span>Abriendo curso...</span>
            </>
          ) : (
            <>
              <BookOpen size={17} />
              <span>Ver Contenido</span>
            </>
          )}
        </Link>

        <button
          type="button"
          disabled={isToggling}
          onClick={() => onToggleComplete(course.id, isCompleted)}
          className={`w-full inline-flex items-center justify-center gap-2 font-bold text-xs sm:text-sm py-2 px-4 rounded-xl cursor-pointer transition-colors disabled:opacity-75 disabled:cursor-wait ${
            isCompleted
              ? isDark
                ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
              : isDark
              ? 'bg-white/10 text-blue-100 hover:bg-white/15'
              : 'bg-[#F0F2F2] text-[#2E4A70] hover:bg-slate-200/80'
          }`}
        >
          {isToggling ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>{isCompleted ? 'Curso Completado' : 'Guardando...'}</span>
            </>
          ) : isCompleted ? (
            <>
              <CheckCircle2 size={16} />
              <span>Curso Completado</span>
            </>
          ) : (
            <>
              <Bookmark size={16} />
              <span>Marcar como Completado</span>
            </>
          )}
        </button>
      </div>
    </article>
  );
};

// Componente Principal
export default function CoursesPagoUnicoPage() {
    const { user, firebaseAuthUser, loading: authLoading } = useAuth();
    const { isDark } = useTheme();
    const router = useRouter(); 
    const [courses, setCourses] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');
    const [viewMode, setViewMode] = useState('list');
    const [openingCourseId, setOpeningCourseId] = useState(null);
    const [togglingCourseId, setTogglingCourseId] = useState(null);
    const [optimisticOverrides, setOptimisticOverrides] = useState({});
    const completedCourses = useMemo(() => {
        const base = new Set(user?.pagoUnicoCursosCompletados || []);
        Object.entries(optimisticOverrides).forEach(([id, val]) => {
            if (val) base.add(id);
            else base.delete(id);
        });
        return Array.from(base);
    }, [user?.pagoUnicoCursosCompletados, optimisticOverrides]);

    const swalTheme = {
        background: isDark ? '#1f2937' : '#ffffff', 
        color: isDark ? '#f9fafb' : '#111827',
        confirmButtonColor: '#14B8A6', 
        cancelButtonColor: '#F59E0B',
    };

    useEffect(() => {
        if (!user?.uid || !user?.hasPagoUnicoAccess) {
            setLoading(false);
            return;
        }

        let cancelled = false;
        const loadCatalog = async () => {
            try {
                const [allCourses, cats] = await Promise.all([
                    getCachedPagoUnicoCourses({ onlyActive: true }),
                    getCachedCategories(),
                ]);
                if (cancelled) return;
                setCourses(allCourses);
                setCategories(cats);
            } catch (err) {
                console.error('Error cargando cursos de pago único:', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadCatalog();
        return () => {
            cancelled = true;
        };
    }, [user?.uid, user?.hasPagoUnicoAccess]);

    // Filtrar cursos
    const filteredCourses = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        return courses.filter(course => {
            const matchesSearchTerm =
                !q ||
                (course.title || '').toLowerCase().includes(q) ||
                (course.description || '').toLowerCase().includes(q);
            const matchesCategory = selectedCategory ? course.categoryId === selectedCategory : true;
            return matchesSearchTerm && matchesCategory;
        });
    }, [courses, searchTerm, selectedCategory]);

    const categoryMap = useMemo(
        () => new Map(categories.map(cat => [cat.id, cat.name])),
        [categories]
    );

    const sortedCourses = useMemo(
        () => [...filteredCourses].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)),
        [filteredCourses]
    );

    useEffect(() => {
        if (!openingCourseId) return undefined;
        const timer = setTimeout(() => setOpeningCourseId(null), 8000);
        return () => clearTimeout(timer);
    }, [openingCourseId]);

    // Función para marcar/desmarcar como completado (optimista)
    const handleToggleComplete = async (courseId, isCompleted) => {
        if (!user || togglingCourseId === courseId) return;
        const nextVal = !isCompleted;
        setTogglingCourseId(courseId);
        setOptimisticOverrides((prev) => ({ ...prev, [courseId]: nextVal }));
        const userDocRef = doc(db, 'users', user.uid);
        try {
            await updateDoc(userDocRef, {
                pagoUnicoCursosCompletados: isCompleted ? arrayRemove(courseId) : arrayUnion(courseId)
            });
            Swal.fire({
                toast: true,
                icon: 'success',
                title: isCompleted ? 'Marcado como pendiente' : '¡Curso completado!',
                position: 'top-end',
                showConfirmButton: false,
                timer: 2000,
                timerProgressBar: true,
                ...swalTheme
            });
        } catch (error) {
            console.error("Error updating completed status:", error);
            setOptimisticOverrides((prev) => {
                const copy = { ...prev };
                delete copy[courseId];
                return copy;
            });
            Swal.fire({ 
                title: 'Error', 
                text: 'No se pudo actualizar el estado del curso.', 
                icon: 'error', 
                ...swalTheme 
            });
        } finally {
            setTogglingCourseId((prev) => (prev === courseId ? null : prev));
        }
    };

    const handlePrefetchCourse = (courseId) => {
        if (!courseId) return;
        router.prefetch(`/app/pagoUnicoCourses/ContenidoCursos/${courseId}`);
        getCachedCourseMaterials(courseId, () => firebaseAuthUser?.getIdToken?.()).catch(() => {});
    };

    const handleViewContent = (courseId) => {
        setOpeningCourseId(courseId);
        getCachedCourseMaterials(courseId, () => firebaseAuthUser?.getIdToken?.()).catch(() => {});
    };

    if (authLoading || loading) return (
        <div
            className={`min-h-screen flex justify-center items-center ${
                isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
            }`}
        >
            <div className="text-center">
                <div
                    className={`animate-spin rounded-full h-14 w-14 border-b-2 mx-auto mb-4 ${
                        isDark ? 'border-[#24B0BA]' : 'border-[#014ba0]'
                    }`}
                ></div>
                <p className="text-lg font-bold">Cargando Cursos...</p>
            </div>
        </div>
    );
    
    if (!user) return (
        <div
            className={`min-h-screen flex justify-center items-center p-4 ${
                isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
            }`}
        >
            <div
                className={`text-center p-8 rounded-2xl border ${
                    isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15 shadow-sm'
                }`}
            >
                <p className="text-lg font-semibold mb-4">Por favor, inicia sesión para continuar.</p>
                <Link
                    href="/login"
                    className="inline-block bg-[#014ba0] hover:bg-[#013b80] text-white font-bold py-3 px-8 rounded-xl transition-colors"
                >
                    Iniciar Sesión
                </Link>
            </div>
        </div>
    );
    
    if (!user.hasPagoUnicoAccess) return <AccessDeniedScreen user={user} isDark={isDark} swalTheme={swalTheme} />;
    
    return (
        <div className={`min-h-screen ${isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'}`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
                {/* Header */}
                <div className="text-center mb-7">
                    <h1 className={`text-3xl sm:text-4xl font-black tracking-tight mb-2 ${isDark ? 'text-white' : 'text-[#014ba0]'}`}>
                        Catálogo de Cursos
                    </h1>
                    <p className={`text-sm sm:text-base max-w-2xl mx-auto ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                        Accede a nuestros cursos exclusivos de pago único y potencia tu aprendizaje
                    </p>
                </div>

                {/* Barra de búsqueda y filtros */}
                <div
                    className={`rounded-2xl border p-4 sm:p-5 mb-7 ${
                        isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15'
                    }`}
                >
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                        {/* Búsqueda */}
                        <div className="md:col-span-6 lg:col-span-5">
                            <label
                                htmlFor="student-course-search"
                                className={`block text-xs font-extrabold uppercase tracking-wide mb-2 ${
                                    isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                                }`}
                            >
                                Buscar Cursos
                            </label>
                            <div
                                className={`flex items-center gap-2.5 px-3.5 border rounded-xl transition-colors ${
                                    isDark
                                        ? 'bg-[#162235] border-white/15 text-white focus-within:border-[#24B0BA]'
                                        : 'bg-white border-[#2E4A70]/25 text-[#1a2639] focus-within:border-[#014ba0]'
                                }`}
                            >
                                <Search className="h-4 w-4 shrink-0 opacity-55 pointer-events-none" />
                                <input
                                    id="student-course-search"
                                    type="text"
                                    placeholder="Buscar por título o descripción..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                                    className={`w-full min-w-0 bg-transparent py-2.5 text-sm font-medium outline-none ${
                                        isDark ? 'text-white placeholder:text-slate-400' : 'text-[#1a2639] placeholder:text-slate-400'
                                    }`}
                                />
                            </div>
                        </div>

                        {/* Filtro por categoría */}
                        <div className="md:col-span-6 lg:col-span-4">
                            <label
                                htmlFor="student-course-cat"
                                className={`block text-xs font-extrabold uppercase tracking-wide mb-2 ${
                                    isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                                }`}
                            >
                                Filtrar por Categoría
                            </label>
                            <div
                                className={`flex items-center gap-2.5 px-3.5 border rounded-xl transition-colors ${
                                    isDark
                                        ? 'bg-[#162235] border-white/15 text-white focus-within:border-[#24B0BA]'
                                        : 'bg-white border-[#2E4A70]/25 text-[#1a2639] focus-within:border-[#014ba0]'
                                }`}
                            >
                                <Filter className="h-4 w-4 shrink-0 opacity-55 pointer-events-none" />
                                <select
                                    id="student-course-cat"
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    style={{ colorScheme: isDark ? 'dark' : 'light' }}
                                    className="w-full min-w-0 bg-transparent py-2.5 text-sm font-semibold outline-none cursor-pointer"
                                >
                                    <option value="" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                                        Todas las categorías
                                    </option>
                                    {categories.map(cat => (
                                        <option
                                            key={cat.id}
                                            value={cat.id}
                                            className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}
                                        >
                                            {cat.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Controles de vista */}
                        <div className="md:col-span-12 lg:col-span-3 flex justify-stretch sm:justify-end">
                            <div
                                className={`grid grid-cols-2 sm:inline-flex w-full sm:w-auto rounded-xl p-1 border ${
                                    isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0] border-[#2E4A70]/15'
                                }`}
                            >
                                <button
                                    type="button"
                                    onClick={() => setViewMode('grid')}
                                    className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                                        viewMode === 'grid'
                                            ? 'bg-[#014ba0] text-white'
                                            : isDark
                                            ? 'text-blue-200 hover:text-white'
                                            : 'text-[#2E4A70] hover:text-[#014ba0]'
                                    }`}
                                >
                                    <Grid3X3 size={16} />
                                    Grid
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewMode('list')}
                                    className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                                        viewMode === 'list'
                                            ? 'bg-[#014ba0] text-white'
                                            : isDark
                                            ? 'text-blue-200 hover:text-white'
                                            : 'text-[#2E4A70] hover:text-[#014ba0]'
                                    }`}
                                >
                                    <List size={16} />
                                    Lista
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Estadísticas */}
                    <div
                        className={`mt-5 pt-4 border-t flex flex-wrap gap-4 text-xs sm:text-sm font-semibold tabular-nums ${
                            isDark ? 'border-white/10 text-blue-200' : 'border-[#2E4A70]/10 text-[#2E4A70]'
                        }`}
                    >
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 bg-[#24B0BA] rounded-full"></span>
                            <span>Total: {filteredCourses.length} curso{filteredCourses.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                            <span>Completados: {completedCourses.length}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 bg-[#014ba0] rounded-full"></span>
                            <span>Pendientes: {filteredCourses.length - completedCourses.filter(id => filteredCourses.some(course => course.id === id)).length}</span>
                        </div>
                    </div>
                </div>

                {/* Contenido de cursos */}
                {sortedCourses.length > 0 ? (
                    <div
                        className={
                            viewMode === 'grid'
                                ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6'
                                : 'space-y-5'
                        }
                    >
                        {sortedCourses.map((course) => {
                            const isCompleted = completedCourses.includes(course.id);
                            const categoryName = categoryMap.get(course.categoryId) || '';

                            return (
                                <CourseCard
                                    key={course.id}
                                    course={course}
                                    categoryName={categoryName}
                                    isCompleted={isCompleted}
                                    isOpening={openingCourseId === course.id}
                                    isToggling={togglingCourseId === course.id}
                                    onToggleComplete={handleToggleComplete}
                                    onViewContent={handleViewContent}
                                    onPrefetchCourse={handlePrefetchCourse}
                                    isDark={isDark}
                                    layout={viewMode === 'list' ? 'list' : 'grid'}
                                />
                            );
                        })}
                    </div>
                ) : (
                    // Estado vacío
                    <div className="text-center py-16">
                        <div
                            className={`max-w-md mx-auto rounded-2xl border p-8 ${
                                isDark
                                    ? 'bg-[#1e293b] border-white/10 text-white'
                                    : 'bg-white border-[#2E4A70]/15 text-[#1a2639] shadow-sm'
                            }`}
                        >
                            <div
                                className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 ${
                                    isDark ? 'bg-[#162235] text-[#24B0BA]' : 'bg-[#FFF9F0] text-[#014ba0]'
                                }`}
                            >
                                <Search className="h-9 w-9" />
                            </div>
                            
                            <h3 className="text-xl sm:text-2xl font-extrabold mb-3">
                                No se encontraron cursos
                            </h3>
                            
                            <p className={`text-sm mb-7 leading-relaxed ${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]'}`}>
                                {searchTerm || selectedCategory 
                                    ? 'Intenta ajustar tu búsqueda o filtro de categoría para encontrar más cursos.'
                                    : 'Aún no hay cursos disponibles en el catálogo.'
                                }
                            </p>

                            {(searchTerm || selectedCategory) && (
                                <div className="space-y-3">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearchTerm('');
                                            setSelectedCategory('');
                                        }}
                                        className="w-full bg-[#014ba0] hover:bg-[#013b80] text-white font-bold py-3 px-6 rounded-xl cursor-pointer transition-colors"
                                    >
                                        Limpiar Filtros
                                    </button>
                                    
                                    <div className="flex flex-wrap gap-2 justify-center">
                                        {searchTerm && (
                                            <span
                                                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                                                    isDark ? 'bg-white/10 text-blue-100' : 'bg-[#F0F2F2] text-[#2E4A70]'
                                                }`}
                                            >
                                                Búsqueda: &ldquo;{searchTerm}&rdquo;
                                                <button 
                                                    type="button"
                                                    onClick={() => setSearchTerm('')}
                                                    className="opacity-70 hover:opacity-100 cursor-pointer"
                                                >
                                                    ✕
                                                </button>
                                            </span>
                                        )}
                                        {selectedCategory && (
                                            <span
                                                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                                                    isDark ? 'bg-white/10 text-blue-100' : 'bg-[#F0F2F2] text-[#2E4A70]'
                                                }`}
                                            >
                                                Categoría: {categories.find(cat => cat.id === selectedCategory)?.name}
                                                <button 
                                                    type="button"
                                                    onClick={() => setSelectedCategory('')}
                                                    className="opacity-70 hover:opacity-100 cursor-pointer"
                                                >
                                                    ✕
                                                </button>
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Footer con estadísticas adicionales */}
                {sortedCourses.length > 0 && (
                    <div
                        className={`mt-10 rounded-2xl border p-6 sm:p-8 ${
                            isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15'
                        }`}
                    >
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center tabular-nums">
                            <div className="space-y-1">
                                <div className={`text-3xl font-black ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}>
                                    {filteredCourses.length}
                                </div>
                                <p className={`text-sm font-semibold ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                                    Cursos Disponibles
                                </p>
                            </div>
                            
                            <div className="space-y-1">
                                <div className="text-3xl font-black text-emerald-500">
                                    {completedCourses.filter(id => filteredCourses.some(course => course.id === id)).length}
                                </div>
                                <p className={`text-sm font-semibold ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                                    Cursos Completados
                                </p>
                            </div>
                            
                            <div className="space-y-1">
                                <div className={`text-3xl font-black ${isDark ? 'text-white' : 'text-[#1a2639]'}`}>
                                    {Math.round((completedCourses.filter(id => filteredCourses.some(course => course.id === id)).length / filteredCourses.length) * 100) || 0}%
                                </div>
                                <p className={`text-sm font-semibold ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                                    Progreso General
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}