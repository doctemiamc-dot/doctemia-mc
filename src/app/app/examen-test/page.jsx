'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  limit,
  startAfter,
  getCountFromServer,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import Link from 'next/link';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import {
  getCachedContactInfo,
  getCachedPendingAccessRequest,
  setCachedPendingAccessRequest,
} from '@/lib/catalogCache';
import Swal from 'sweetalert2';
import {
  LockKeyhole,
  Send,
  Hourglass,
  FileText,
  Clock,
  Eye,
  Search,
  CheckCircle2,
  Play,
  RotateCcw,
  X,
  Trophy,
  ClipboardList,
  MessageCircle,
  Filter,
  ArrowUpDown,
  Grid3X3,
  List,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Loader2,
  Calendar,
} from 'lucide-react';

const DEFAULT_PAGE_SIZE = 6;
const EXAMS_POOL_CACHE_TTL_MS = 5 * 60 * 1000;

const getVisiblePageNumbers = (currentPage, totalPages) => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = [1];
  if (currentPage > 3) pages.push('ellipsis-start');
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  for (let p = start; p <= end; p += 1) {
    pages.push(p);
  }
  if (currentPage < totalPages - 2) pages.push('ellipsis-end');
  pages.push(totalPages);
  return pages;
};

const NOMBRE_NEGOCIO = 'DOCTEMIA MC';

const resolveQrPreviewUrl = (url) => {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.includes('drive.google.com') || trimmed.includes('lh3.googleusercontent.com')) {
    const pathMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const fileId = pathMatch?.[1] || queryMatch?.[1];
    if (fileId) {
      return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400-h400`;
    }
  }
  return trimmed;
};

const formatAttemptDate = (completedAt, withTime = false) => {
  const seconds = completedAt?.seconds;
  if (!seconds) return 'Fecha no disponible';
  const date = new Date(seconds * 1000);
  return withTime
    ? date.toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' })
    : date.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const AccessDeniedScreen = ({ user, isDark, swalTheme }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [contactInfo, setContactInfo] = useState({ qrUrl: '', adminPhone: '' });
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

  const qrPreviewUrl = resolveQrPreviewUrl(contactInfo.qrUrl);

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
        userName: user.name || user.displayName || 'Estudiante',
        userEmail: user.email || '',
        userPhone: cleanedPhone,
        requestDate: serverTimestamp(),
        status: 'pendiente',
        type: 'pago_unico_access',
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
      console.error('Error al crear solicitud:', error);
      Swal.fire({
        title: 'Error',
        text: 'No se pudo enviar tu solicitud.',
        icon: 'error',
        ...swalTheme,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const pageBg = isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]';
  const cardSurface = isDark
    ? 'bg-[#1e293b] border-white/10 text-white'
    : 'bg-white border-[#2E4A70]/15 text-[#1a2639]';
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

        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Acceso Restringido</h1>
        <p className={`mt-2.5 text-sm sm:text-base leading-relaxed ${mutedText}`}>
          Para acceder a los exámenes de test necesitas contar con el acceso de Pago Único.
        </p>

        {requestSent ? (
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
            {qrPreviewUrl && (
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
                href={`https://api.whatsapp.com/send?phone=${contactInfo.adminPhone}&text=${encodeURIComponent(
                  `Hola ${NOMBRE_NEGOCIO}, soy ${user.name || user.displayName || 'estudiante'}. Acabo de realizar el pago para el acceso de PAGO ÚNICO. Adjunto mi comprobante.`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white bg-[#24B0BA] hover:bg-[#1d9aa3] transition-colors"
              >
                <MessageCircle className="h-4 w-4 shrink-0" />
                <span>Contactar por WhatsApp</span>
              </a>
            )}

            <form onSubmit={handleSubmitRequest} className="space-y-3 pt-1">
              <label
                htmlFor="exam-access-phone"
                className={`block text-xs font-extrabold uppercase tracking-wide ${mutedText}`}
              >
                O solicita activación directa
              </label>
              <input
                id="exam-access-phone"
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="Tu número de WhatsApp (ej: +591...)"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-sm font-medium outline-none transition-colors ${
                  isDark
                    ? 'bg-[#162235] border-white/15 text-white placeholder:text-slate-400 focus:border-[#24B0BA]'
                    : 'bg-white border-[#2E4A70]/25 text-[#1a2639] placeholder:text-slate-400 focus:border-[#014ba0]'
                }`}
              />
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white bg-[#014ba0] hover:bg-[#013b80] disabled:opacity-50 cursor-pointer transition-colors"
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
};

function AttemptAnswersModal({ attempt, exam, onClose, isDark }) {
  const [answerFilter, setAnswerFilter] = useState('all');

  useEffect(() => {
    setAnswerFilter('all');
  }, [attempt?.id]);

  useEffect(() => {
    if (!attempt || !exam) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [attempt, exam, onClose]);

  const questions = Array.isArray(exam?.questions) ? exam.questions : [];
  const answers = Array.isArray(attempt?.answers) ? attempt.answers : [];

  const reviewItems = useMemo(
    () =>
      questions.map((question, index) => {
        const userAnswer = answers.find((a) => a.questionIndex === index);
        const options = Array.isArray(question.options) ? question.options : [];

        let answerSummary = 'No contestada';
        if (question.type === 'open-ended') {
          answerSummary = userAnswer?.textAnswer?.trim() || 'No contestada';
        } else if (
          Array.isArray(userAnswer?.selectedOptionIndices) &&
          userAnswer.selectedOptionIndices.length > 0
        ) {
          answerSummary = userAnswer.selectedOptionIndices
            .map((optIdx) => options[optIdx])
            .filter(Boolean)
            .join(', ');
        } else if (
          userAnswer?.selectedOptionIndex !== null &&
          userAnswer?.selectedOptionIndex !== undefined &&
          options[userAnswer.selectedOptionIndex] !== undefined
        ) {
          answerSummary = options[userAnswer.selectedOptionIndex];
        }

        return {
          index,
          question,
          userAnswer,
          answerSummary,
          hasStatus: typeof userAnswer?.isCorrect === 'boolean',
          isCorrect: userAnswer?.isCorrect === true,
        };
      }),
    [questions, answers]
  );

  const gradedCount = useMemo(
    () => reviewItems.filter((item) => item.hasStatus).length,
    [reviewItems]
  );
  const correctCount = useMemo(
    () => reviewItems.filter((item) => item.hasStatus && item.isCorrect).length,
    [reviewItems]
  );
  const incorrectCount = gradedCount - correctCount;

  const filteredItems = useMemo(() => {
    if (answerFilter === 'correct') {
      return reviewItems.filter((item) => item.hasStatus && item.isCorrect);
    }
    if (answerFilter === 'incorrect') {
      return reviewItems.filter((item) => item.hasStatus && !item.isCorrect);
    }
    return reviewItems;
  }, [reviewItems, answerFilter]);

  if (!attempt || !exam || typeof document === 'undefined') return null;

  const score = typeof attempt.score === 'number' ? attempt.score : Number(attempt.score || 0);
  const mutedText = isDark ? 'text-slate-300' : 'text-[#2E4A70]';

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 lg:p-6 bg-slate-950/75 backdrop-blur-xs"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="attempt-modal-title"
    >
      <div
        className={`w-full sm:max-w-2xl lg:max-w-3xl xl:max-w-4xl h-[92dvh] sm:h-auto sm:max-h-[88dvh] rounded-t-3xl sm:rounded-2xl border flex flex-col overflow-hidden ${
          isDark
            ? 'bg-[#1e293b] border-white/15 text-white'
            : 'bg-white border-[#2E4A70]/20 text-[#1a2639]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`sm:hidden flex justify-center pt-2.5 pb-1 shrink-0 ${
            isDark ? 'bg-[#162235]' : 'bg-[#FAF5EB]'
          }`}
          aria-hidden="true"
        >
          <span
            className={`w-10 h-1 rounded-full ${
              isDark ? 'bg-white/25' : 'bg-[#2E4A70]/25'
            }`}
          />
        </div>

        <div
          className={`px-4 sm:px-6 py-3.5 sm:py-4 border-b shrink-0 space-y-3 ${
            isDark ? 'border-white/10 bg-[#162235]' : 'border-[#2E4A70]/10 bg-[#FAF5EB]'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2
                id="attempt-modal-title"
                className="text-base sm:text-xl font-extrabold leading-snug line-clamp-2 break-words"
              >
                {exam.title}
              </h2>
              <div
                className={`mt-1.5 flex flex-wrap items-center gap-2 text-xs font-semibold tabular-nums ${mutedText}`}
              >
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-extrabold ${
                    score >= 70
                      ? isDark
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-emerald-100 text-emerald-800'
                      : score >= 50
                      ? isDark
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-amber-100 text-amber-800'
                      : isDark
                      ? 'bg-rose-500/20 text-rose-300'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  <Trophy className="w-3.5 h-3.5 shrink-0" />
                  <span>Calificación: {score}/100</span>
                </span>
                <span className="truncate max-w-full">
                  {formatAttemptDate(attempt.completedAt, true)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar detalle de respuestas"
              className={`w-10 h-10 inline-flex items-center justify-center rounded-xl cursor-pointer transition-colors shrink-0 ${
                isDark
                  ? 'text-slate-300 hover:bg-white/10 hover:text-white'
                  : 'text-[#2E4A70] hover:bg-[#2E4A70]/10 hover:text-[#1a2639]'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {gradedCount > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5 tabular-nums">
              {[
                { id: 'all', label: `Todas (${reviewItems.length})` },
                { id: 'correct', label: `Correctas (${correctCount})` },
                { id: 'incorrect', label: `Incorrectas (${incorrectCount})` },
              ].map((tab) => {
                const active = answerFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setAnswerFilter(tab.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      active
                        ? 'bg-[#014ba0] text-white'
                        : isDark
                        ? 'bg-[#1e293b] text-slate-300 hover:text-white border border-white/10'
                        : 'bg-white text-[#2E4A70] hover:text-[#014ba0] border border-[#2E4A70]/15'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3.5 sm:p-6 space-y-3 sm:space-y-3.5">
          {questions.length === 0 ? (
            <p className={`text-sm text-center py-8 ${mutedText}`}>
              No hay preguntas disponibles para revisar en este examen.
            </p>
          ) : filteredItems.length === 0 ? (
            <p className={`text-sm text-center py-8 ${mutedText}`}>
              No hay preguntas en esta categoría.
            </p>
          ) : (
            filteredItems.map(({ index, question, userAnswer, answerSummary, hasStatus }) => (
              <div
                key={index}
                className={`p-3.5 sm:p-4 rounded-xl border ${
                  isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FAF5EB]/70 border-[#2E4A70]/12'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2.5">
                  <p className="text-sm sm:text-base font-bold leading-snug break-words min-w-0">
                    <span className="tabular-nums mr-1.5 opacity-75">{index + 1}.</span>
                    {question.questionText}
                  </p>
                  {hasStatus && (
                    <span
                      className={`self-start shrink-0 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full ${
                        userAnswer.isCorrect
                          ? isDark
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-emerald-100 text-emerald-800'
                          : isDark
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {userAnswer.isCorrect ? 'Correcta' : 'Incorrecta'}
                    </span>
                  )}
                </div>

                <div
                  className={`px-3 py-2.5 rounded-lg text-xs sm:text-sm leading-relaxed break-words ${
                    isDark
                      ? 'bg-[#1e293b] text-slate-200 border border-white/5'
                      : 'bg-white text-[#2E4A70] border border-[#2E4A70]/10'
                  }`}
                >
                  <span className="font-bold mr-1">Tu respuesta:</span>
                  <span>{answerSummary}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div
          className={`px-4 sm:px-6 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:py-3.5 border-t shrink-0 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 ${
            isDark ? 'border-white/10 bg-[#162235]' : 'border-[#2E4A70]/10 bg-[#FAF5EB]'
          }`}
        >
          <Link
            href={`/app/examen-test/examen?examId=${exam.id}`}
            onClick={onClose}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 rounded-xl font-bold text-sm transition-colors ${
              isDark
                ? 'bg-white/10 text-blue-100 hover:bg-white/15'
                : 'bg-white border border-[#2E4A70]/20 text-[#014ba0] hover:bg-slate-50'
            }`}
          >
            <RotateCcw className="w-4 h-4" />
            <span>Repetir Examen</span>
          </Link>

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-3 sm:py-2.5 rounded-xl font-bold text-sm bg-[#014ba0] hover:bg-[#013b80] text-white cursor-pointer transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const getScoreBadgeClasses = (score, isDark) => {
  if (score >= 70) {
    return isDark
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
      : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (score >= 50) {
    return isDark
      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
      : 'bg-amber-50 text-amber-700 border-amber-200';
  }
  return isDark
    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
    : 'bg-rose-50 text-rose-700 border-rose-200';
};

export default function ExamenTestPage() {
  const { user, loading: authLoading } = useAuth();
  const [pageExams, setPageExams] = useState([]);
  const [attemptsByExam, setAttemptsByExam] = useState({});
  const [serverTotalCount, setServerTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchingPage, setFetchingPage] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);

  const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [viewingExam, setViewingExam] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [attributeFilter, setAttributeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('default');
  const [viewMode, setViewMode] = useState('grid');

  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreServer, setHasMoreServer] = useState(false);
  const [poolVersion, setPoolVersion] = useState(0);

  const pageCacheRef = useRef({});
  const poolRef = useRef({ items: [], loadedAll: false });
  const reqSeqRef = useRef(0);
  const poolPromiseRef = useRef(null);

  const { isDark } = useTheme();

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f8fafc' : '#1a2639',
      confirmButtonColor: '#014ba0',
      cancelButtonColor: '#dc2626',
    }),
    [isDark]
  );

  const activeExamsBaseQuery = useMemo(
    () => query(collection(db, 'exams'), where('status', '==', 'active')),
    []
  );

  const getPoolCacheKey = useCallback(
    (uid) => `doctemia_student_exams_pool_v2_${uid}`,
    []
  );

  const saveFullPoolCache = useCallback(
    (uid, { items, attemptsMap, totalCount }) => {
      if (!uid) return;
      try {
        window.sessionStorage.setItem(
          getPoolCacheKey(uid),
          JSON.stringify({
            ts: Date.now(),
            items,
            attemptsMap,
            totalCount,
          })
        );
      } catch {
        // Ignorar si excede cuota
      }
    },
    [getPoolCacheKey]
  );

  const fetchUserAttemptsAndCount = useCallback(
    async (uid, { forceRemote = false } = {}) => {
      if (!forceRemote) {
        try {
          const raw = window.sessionStorage.getItem(getPoolCacheKey(uid));
          if (raw) {
            const parsed = JSON.parse(raw);
            if (
              parsed &&
              typeof parsed.ts === 'number' &&
              Date.now() - parsed.ts < EXAMS_POOL_CACHE_TTL_MS &&
              Array.isArray(parsed.items)
            ) {
              return {
                fromFullCache: true,
                items: parsed.items,
                attemptsMap: parsed.attemptsMap || {},
                totalCount:
                  typeof parsed.totalCount === 'number'
                    ? parsed.totalCount
                    : parsed.items.length,
              };
            }
          }
        } catch {
          // Ignorar
        }
      }

      const attemptsQuery = query(
        collection(db, 'examAttempts'),
        where('userId', '==', uid),
        limit(100)
      );

      const [attemptsSnap, countSnap] = await Promise.all([
        getDocs(attemptsQuery),
        getCountFromServer(activeExamsBaseQuery),
      ]);

      const attemptsMap = {};
      attemptsSnap.forEach((docSnap) => {
        const attempt = { id: docSnap.id, ...docSnap.data() };
        if (!attemptsMap[attempt.examId]) {
          attemptsMap[attempt.examId] = [];
        }
        attemptsMap[attempt.examId].push(attempt);
      });
      Object.keys(attemptsMap).forEach((examId) => {
        attemptsMap[examId].sort(
          (a, b) => (b.completedAt?.seconds || 0) - (a.completedAt?.seconds || 0)
        );
      });

      return {
        fromFullCache: false,
        attemptsMap,
        totalCount: countSnap.data().count || 0,
      };
    },
    [activeExamsBaseQuery, getPoolCacheKey]
  );

  const fetchExamPage = useCallback(
    async (targetPage = 1, { targetPageSize = pageSize, forceRemote = false, attemptsOverride = null } = {}) => {
      const safePage = Math.max(1, targetPage);
      if (!forceRemote && poolRef.current.loadedAll) {
        setCurrentPage(safePage);
        setLoading(false);
        return;
      }

      const cacheKey = String(targetPageSize);
      if (!pageCacheRef.current[cacheKey]) {
        pageCacheRef.current[cacheKey] = {
          pages: {},
          lastDocs: {},
          hasMoreByPage: {},
          highestPage: 0,
        };
      }
      const cache = pageCacheRef.current[cacheKey];

      if (!forceRemote && cache.pages[safePage]) {
        setPageExams(cache.pages[safePage]);
        setHasMoreServer(Boolean(cache.hasMoreByPage[safePage]));
        setCurrentPage(safePage);
        setLoading(false);
        return;
      }

      const seq = ++reqSeqRef.current;
      setFetchingPage(true);

      try {
        let startPage = 0;
        for (let p = safePage - 1; p >= 1; p -= 1) {
          if (cache.lastDocs[p]) {
            startPage = p;
            break;
          }
        }

        let cursorDoc = startPage > 0 ? cache.lastDocs[startPage] : null;
        let fillPage = startPage + 1;

        while (fillPage <= safePage) {
          const askLimit = Math.min(50, targetPageSize + 1);
          const q = cursorDoc
            ? query(activeExamsBaseQuery, startAfter(cursorDoc), limit(askLimit))
            : query(activeExamsBaseQuery, limit(askLimit));

          const snap = await getDocs(q);
          if (seq !== reqSeqRef.current) return;

          const docs = snap.docs;
          const pageHasMore =
            targetPageSize < 50 ? docs.length > targetPageSize : docs.length === 50;
          const slicedDocs =
            targetPageSize < 50 && pageHasMore ? docs.slice(0, targetPageSize) : docs;
          const items = slicedDocs.map((d) => ({ id: d.id, ...d.data() }));

          cache.pages[fillPage] = items;
          cache.lastDocs[fillPage] = slicedDocs[slicedDocs.length - 1] || null;
          cache.hasMoreByPage[fillPage] = pageHasMore;
          cache.highestPage = Math.max(cache.highestPage, fillPage);

          if (!pageHasMore) {
            const seen = new Set();
            const merged = [];
            for (let p = 1; p <= cache.highestPage; p += 1) {
              for (const item of cache.pages[p] || []) {
                if (!seen.has(item.id)) {
                  seen.add(item.id);
                  merged.push(item);
                }
              }
            }
            if (merged.length > 0 || fillPage === 1) {
              poolRef.current = { items: merged, loadedAll: true };
              setPoolVersion((v) => v + 1);
              saveFullPoolCache(user?.uid, {
                items: merged,
                attemptsMap: attemptsOverride || attemptsByExam,
                totalCount: merged.length,
              });
              setServerTotalCount(merged.length);
            }
          }

          cursorDoc = cache.lastDocs[fillPage];
          fillPage += 1;
          if (!pageHasMore || !cursorDoc) break;
        }

        const resolvedPage = cache.pages[safePage] ? safePage : Math.max(1, cache.highestPage);
        setPageExams(cache.pages[resolvedPage] || []);
        setHasMoreServer(Boolean(cache.hasMoreByPage[resolvedPage]));
        setCurrentPage(resolvedPage);
      } catch (error) {
        if (seq !== reqSeqRef.current) return;
        console.error('Error cargando página de exámenes:', error);
      } finally {
        if (seq === reqSeqRef.current) {
          setLoading(false);
          setFetchingPage(false);
        }
      }
    },
    [activeExamsBaseQuery, attemptsByExam, pageSize, saveFullPoolCache, user?.uid]
  );

  // Cargar todo el catálogo activo en lotes acotados (50) solo cuando se filtra, busca u ordena globalmente
  const ensureFullPool = useCallback(async () => {
    if (poolRef.current.loadedAll) return poolRef.current.items;
    if (poolPromiseRef.current) return poolPromiseRef.current;

    const run = (async () => {
      setSyncingAll(true);
      try {
        const cache = pageCacheRef.current[String(pageSize)];
        const seen = new Set();
        const merged = [];
        let cursorDoc = null;

        if (cache) {
          let contiguous = 0;
          while (cache.pages[contiguous + 1]) {
            contiguous += 1;
            for (const item of cache.pages[contiguous]) {
              if (!seen.has(item.id)) {
                seen.add(item.id);
                merged.push(item);
              }
            }
            if (cache.lastDocs[contiguous]) {
              cursorDoc = cache.lastDocs[contiguous];
            }
          }
          if (contiguous > 0 && !cache.hasMoreByPage[contiguous]) {
            poolRef.current = { items: merged, loadedAll: true };
            setPoolVersion((v) => v + 1);
            saveFullPoolCache(user?.uid, {
              items: merged,
              attemptsMap: attemptsByExam,
              totalCount: merged.length,
            });
            setServerTotalCount(merged.length);
            return merged;
          }
        }

        for (let batch = 0; batch < 10; batch += 1) {
          const q = cursorDoc
            ? query(activeExamsBaseQuery, startAfter(cursorDoc), limit(50))
            : query(activeExamsBaseQuery, limit(50));
          const snap = await getDocs(q);
          const docs = snap.docs;

          for (const d of docs) {
            if (!seen.has(d.id)) {
              seen.add(d.id);
              merged.push({ id: d.id, ...d.data() });
            }
          }

          if (docs.length < 50) {
            break;
          }
          cursorDoc = docs[docs.length - 1];
        }

        poolRef.current = { items: merged, loadedAll: true };
        setPoolVersion((v) => v + 1);
        setServerTotalCount(merged.length);
        saveFullPoolCache(user?.uid, {
          items: merged,
          attemptsMap: attemptsByExam,
          totalCount: merged.length,
        });
        return merged;
      } catch (err) {
        console.error('Error sincronizando listado completo de exámenes:', err);
        return poolRef.current.items;
      } finally {
        setSyncingAll(false);
        poolPromiseRef.current = null;
      }
    })();

    poolPromiseRef.current = run;
    return run;
  }, [activeExamsBaseQuery, attemptsByExam, pageSize, saveFullPoolCache, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !user?.hasPagoUnicoAccess) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const initLoad = async () => {
      try {
        const meta = await fetchUserAttemptsAndCount(user.uid);
        if (cancelled) return;

        setAttemptsByExam(meta.attemptsMap);
        setServerTotalCount(meta.totalCount);

        if (meta.fromFullCache) {
          poolRef.current = { items: meta.items, loadedAll: true };
          setPoolVersion((v) => v + 1);
          setLoading(false);
          return;
        }

        await fetchExamPage(1, {
          targetPageSize: DEFAULT_PAGE_SIZE,
          attemptsOverride: meta.attemptsMap,
        });
      } catch (err) {
        console.error('Error al inicializar exámenes:', err);
        if (!cancelled) setLoading(false);
      }
    };

    initLoad();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, user?.hasPagoUnicoAccess]);

  const requiresFullPool =
    Boolean(searchTerm.trim()) ||
    statusFilter !== 'all' ||
    attributeFilter !== 'all' ||
    sortBy !== 'default';

  useEffect(() => {
    if (!user?.uid || !user?.hasPagoUnicoAccess || loading) return;
    if (requiresFullPool && !poolRef.current.loadedAll) {
      ensureFullPool();
    }
  }, [requiresFullPool, ensureFullPool, user?.uid, user?.hasPagoUnicoAccess, loading]);

  const handleRefreshCatalog = async () => {
    if (!user?.uid) return;
    try {
      window.sessionStorage.removeItem(getPoolCacheKey(user.uid));
    } catch {
      // Ignorar
    }
    pageCacheRef.current = {};
    poolRef.current = { items: [], loadedAll: false };
    setPoolVersion((v) => v + 1);
    setCurrentPage(1);
    setFetchingPage(true);

    try {
      const meta = await fetchUserAttemptsAndCount(user.uid, { forceRemote: true });
      setAttemptsByExam(meta.attemptsMap);
      setServerTotalCount(meta.totalCount);
      await fetchExamPage(1, {
        targetPageSize: pageSize,
        forceRemote: true,
        attemptsOverride: meta.attemptsMap,
      });
      if (requiresFullPool) {
        await ensureFullPool();
      }
    } finally {
      setFetchingPage(false);
    }
  };

  const handleViewAnswers = (attempt, exam) => {
    setSelectedAttempt(attempt);
    setViewingExam(exam);
  };

  const attachAttempts = useCallback(
    (list) =>
      list.map((exam) => ({
        ...exam,
        attempts: attemptsByExam[exam.id] || [],
      })),
    [attemptsByExam]
  );

  const fullPoolWithAttempts = useMemo(() => {
    void poolVersion;
    return attachAttempts(poolRef.current.items);
  }, [attachAttempts, poolVersion]);

  const pageExamsWithAttempts = useMemo(
    () => attachAttempts(pageExams),
    [attachAttempts, pageExams]
  );

  const isPoolReady = poolRef.current.loadedAll;
  const completedExamsCount = useMemo(() => {
    if (isPoolReady) {
      return fullPoolWithAttempts.filter((e) => (e.attempts?.length || 0) > 0).length;
    }
    return Object.keys(attemptsByExam).length;
  }, [isPoolReady, fullPoolWithAttempts, attemptsByExam]);

  const totalCatalogCount = isPoolReady ? fullPoolWithAttempts.length : serverTotalCount;
  const pendingExamsCount = Math.max(0, totalCatalogCount - completedExamsCount);

  const hasActiveFilters = requiresFullPool;

  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setAttributeFilter('all');
    setSortBy('default');
    setCurrentPage(1);
  };

  const filteredPoolExams = useMemo(() => {
    const source = isPoolReady ? fullPoolWithAttempts : pageExamsWithAttempts;
    const q = searchTerm.trim().toLowerCase();

    const list = source.filter((exam) => {
      const attempts = Array.isArray(exam.attempts) ? exam.attempts : [];
      const hasAttempts = attempts.length > 0;
      const questionCount = Array.isArray(exam.questions) ? exam.questions.length : 0;
      const hasTimer = Boolean(exam.timer && Number(exam.timer) > 0);
      const bestScore = hasAttempts
        ? Math.max(...attempts.map((a) => Number(a.score || 0)))
        : null;

      if (statusFilter === 'completed' && !hasAttempts) return false;
      if (statusFilter === 'pending' && hasAttempts) return false;

      if (attributeFilter === 'timed' && !hasTimer) return false;
      if (attributeFilter === 'untimed' && hasTimer) return false;
      if (attributeFilter === 'short' && questionCount > 6) return false;
      if (attributeFilter === 'long' && questionCount < 7) return false;
      if (attributeFilter === 'passed' && (bestScore === null || bestScore < 70)) return false;
      if (attributeFilter === 'review' && (bestScore === null || bestScore >= 70)) return false;

      if (!q) return true;
      return (
        (exam.title || '').toLowerCase().includes(q) ||
        (exam.description || '').toLowerCase().includes(q)
      );
    });

    if (sortBy === 'default') return list;

    return [...list].sort((a, b) => {
      if (sortBy === 'recent') {
        return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
      }
      if (sortBy === 'oldest') {
        return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
      }
      if (sortBy === 'questions_desc') {
        const lenA = Array.isArray(a.questions) ? a.questions.length : 0;
        const lenB = Array.isArray(b.questions) ? b.questions.length : 0;
        return lenB - lenA;
      }
      if (sortBy === 'score_desc') {
        const bestA = a.attempts?.length
          ? Math.max(...a.attempts.map((x) => Number(x.score || 0)))
          : -1;
        const bestB = b.attempts?.length
          ? Math.max(...b.attempts.map((x) => Number(x.score || 0)))
          : -1;
        return bestB - bestA;
      }
      if (sortBy === 'title_asc') {
        return (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' });
      }
      return 0;
    });
  }, [
    isPoolReady,
    fullPoolWithAttempts,
    pageExamsWithAttempts,
    searchTerm,
    statusFilter,
    attributeFilter,
    sortBy,
  ]);

  const useMemoryPagination = isPoolReady || requiresFullPool;
  const totalMatchingCount = useMemoryPagination
    ? filteredPoolExams.length
    : totalCatalogCount;
  const totalPages = Math.max(1, Math.ceil(totalMatchingCount / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const displayedExams = useMemo(() => {
    if (useMemoryPagination) {
      const start = (safeCurrentPage - 1) * pageSize;
      return filteredPoolExams.slice(start, start + pageSize);
    }
    return pageExamsWithAttempts;
  }, [useMemoryPagination, filteredPoolExams, safeCurrentPage, pageSize, pageExamsWithAttempts]);

  const handleGoToPage = async (targetPage) => {
    const clamped = Math.max(1, Math.min(totalPages, targetPage));
    if (clamped === safeCurrentPage && !fetchingPage) return;

    if (useMemoryPagination) {
      setCurrentPage(clamped);
    } else {
      await fetchExamPage(clamped, { targetPageSize: pageSize });
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePageSizeChange = async (newSize) => {
    setPageSize(newSize);
    setCurrentPage(1);
    if (!poolRef.current.loadedAll) {
      await fetchExamPage(1, { targetPageSize: newSize });
    }
  };

  const visiblePageNumbers = useMemo(
    () => getVisiblePageNumbers(safeCurrentPage, totalPages),
    [safeCurrentPage, totalPages]
  );

  const rangeStart = totalMatchingCount === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(
    totalMatchingCount,
    (safeCurrentPage - 1) * pageSize + displayedExams.length
  );

  const pageBg = isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]';
  const cardSurface = isDark
    ? 'bg-[#1e293b] border-white/10 text-white hover:border-[#24B0BA]/50'
    : 'bg-white border-[#2E4A70]/15 text-[#1a2639] hover:border-[#014ba0]/40';
  const mutedText = isDark ? 'text-slate-300' : 'text-[#2E4A70]';

  if (authLoading || loading) {
    return (
      <div className={`min-h-screen ${pageBg}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8 space-y-2 text-center">
            <div
              className={`h-9 w-64 mx-auto rounded-xl animate-pulse ${
                isDark ? 'bg-white/10' : 'bg-[#2E4A70]/10'
              }`}
            />
            <div
              className={`h-4 w-80 max-w-full mx-auto rounded-lg animate-pulse ${
                isDark ? 'bg-white/10' : 'bg-[#2E4A70]/10'
              }`}
            />
          </div>
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`rounded-2xl border p-6 space-y-4 animate-pulse ${
                  isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15'
                }`}
              >
                <div className={`h-6 rounded-lg w-3/4 ${isDark ? 'bg-white/10' : 'bg-[#2E4A70]/10'}`} />
                <div className={`h-4 rounded-lg w-full ${isDark ? 'bg-white/10' : 'bg-[#2E4A70]/10'}`} />
                <div className={`h-4 rounded-lg w-5/6 ${isDark ? 'bg-white/10' : 'bg-[#2E4A70]/10'}`} />
                <div className={`h-10 rounded-xl w-full mt-4 ${isDark ? 'bg-white/10' : 'bg-[#014ba0]/15'}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={`min-h-screen flex justify-center items-center p-4 ${pageBg}`}>
        <div className={`text-center p-8 rounded-2xl border max-w-md w-full ${cardSurface}`}>
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
  }

  if (!user.hasPagoUnicoAccess) {
    return <AccessDeniedScreen user={user} isDark={isDark} swalTheme={swalTheme} />;
  }

  return (
    <>
      <div className={`min-h-screen ${pageBg}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="text-center mb-7">
            <h1
              className={`text-3xl sm:text-4xl font-black tracking-tight mb-2 ${
                isDark ? 'text-white' : 'text-[#014ba0]'
              }`}
            >
              Exámenes Disponibles
            </h1>
            <p className={`text-sm sm:text-base max-w-2xl mx-auto ${mutedText}`}>
              Evalúa tu preparación médica con simulacros cronometrados y revisa tu historial de intentos
            </p>
          </div>

          {totalCatalogCount > 0 && (
            <div
              className={`rounded-2xl border p-4 sm:p-5 mb-7 space-y-4 ${
                isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15'
              }`}
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-center">
                <div className="lg:col-span-5 min-w-0">
                  <label htmlFor="student-exam-search" className="sr-only">
                    Buscar exámenes
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
                      id="student-exam-search"
                      type="text"
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder="Buscar en todos los exámenes..."
                      style={{ colorScheme: isDark ? 'dark' : 'light' }}
                      className={`w-full min-w-0 bg-transparent py-2.5 text-sm font-medium outline-none ${
                        isDark
                          ? 'text-white placeholder:text-slate-400'
                          : 'text-[#1a2639] placeholder:text-slate-400'
                      }`}
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchTerm('');
                          setCurrentPage(1);
                        }}
                        aria-label="Limpiar búsqueda"
                        className="p-1 rounded-md opacity-60 hover:opacity-100 cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-4 min-w-0">
                  <div
                    className={`grid grid-cols-3 rounded-xl p-1 border tabular-nums ${
                      isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0] border-[#2E4A70]/15'
                    }`}
                  >
                    {[
                      { id: 'all', label: `Todos (${totalCatalogCount})` },
                      {
                        id: 'pending',
                        label: isPoolReady ? `Pendientes (${pendingExamsCount})` : 'Pendientes',
                      },
                      {
                        id: 'completed',
                        label: isPoolReady ? `Hechos (${completedExamsCount})` : 'Hechos',
                      },
                    ].map((tab) => {
                      const active = statusFilter === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => {
                            setStatusFilter(tab.id);
                            setCurrentPage(1);
                          }}
                          className={`px-2.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors text-center truncate ${
                            active
                              ? 'bg-[#014ba0] text-white'
                              : isDark
                              ? 'text-blue-200 hover:text-white'
                              : 'text-[#2E4A70] hover:text-[#014ba0]'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="lg:col-span-3 flex justify-stretch sm:justify-end">
                  <div
                    className={`grid grid-cols-2 sm:inline-flex w-full sm:w-auto rounded-xl p-1 border ${
                      isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0] border-[#2E4A70]/15'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setViewMode('grid')}
                      className={`flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                        viewMode === 'grid'
                          ? 'bg-[#014ba0] text-white'
                          : isDark
                          ? 'text-blue-200 hover:text-white'
                          : 'text-[#2E4A70] hover:text-[#014ba0]'
                      }`}
                    >
                      <Grid3X3 className="h-4 w-4" />
                      <span>Grid</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      className={`flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                        viewMode === 'list'
                          ? 'bg-[#014ba0] text-white'
                          : isDark
                          ? 'text-blue-200 hover:text-white'
                          : 'text-[#2E4A70] hover:text-[#014ba0]'
                      }`}
                    >
                      <List className="h-4 w-4" />
                      <span>Lista</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 pt-1 items-center">
                <div className="lg:col-span-4">
                  <label htmlFor="student-exam-attribute" className="sr-only">
                    Filtrar por características
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
                      id="student-exam-attribute"
                      value={attributeFilter}
                      onChange={(e) => {
                        setAttributeFilter(e.target.value);
                        setCurrentPage(1);
                      }}
                      style={{ colorScheme: isDark ? 'dark' : 'light' }}
                      className="w-full min-w-0 bg-transparent py-2.5 text-xs sm:text-sm font-semibold outline-none cursor-pointer"
                    >
                      <option value="all" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Todas las características
                      </option>
                      <option value="timed" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Con temporizador
                      </option>
                      <option value="untimed" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Sin límite de tiempo
                      </option>
                      <option value="short" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Cortos (1–6 preguntas)
                      </option>
                      <option value="long" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Completos (7+ preguntas)
                      </option>
                      <option value="passed" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Aprobados (70+ pts)
                      </option>
                      <option value="review" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Por reforzar (&lt;70 pts)
                      </option>
                    </select>
                  </div>
                </div>

                <div className="lg:col-span-4">
                  <label htmlFor="student-exam-sort" className="sr-only">
                    Ordenar exámenes
                  </label>
                  <div
                    className={`flex items-center gap-2.5 px-3.5 border rounded-xl transition-colors ${
                      isDark
                        ? 'bg-[#162235] border-white/15 text-white focus-within:border-[#24B0BA]'
                        : 'bg-white border-[#2E4A70]/25 text-[#1a2639] focus-within:border-[#014ba0]'
                    }`}
                  >
                    <ArrowUpDown className="h-4 w-4 shrink-0 opacity-55 pointer-events-none" />
                    <select
                      id="student-exam-sort"
                      value={sortBy}
                      onChange={(e) => {
                        setSortBy(e.target.value);
                        setCurrentPage(1);
                      }}
                      style={{ colorScheme: isDark ? 'dark' : 'light' }}
                      className="w-full min-w-0 bg-transparent py-2.5 text-xs sm:text-sm font-semibold outline-none cursor-pointer"
                    >
                      <option value="default" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Orden: Catálogo
                      </option>
                      <option value="recent" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Orden: Más recientes
                      </option>
                      <option value="oldest" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Orden: Más antiguos
                      </option>
                      <option value="questions_desc" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Orden: Más preguntas
                      </option>
                      <option value="score_desc" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Orden: Mejor calificación
                      </option>
                      <option value="title_asc" className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                        Orden: Título (A–Z)
                      </option>
                    </select>
                  </div>
                </div>

                <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between lg:justify-end gap-2.5 text-xs font-bold tabular-nums">
                  <div className="flex items-center gap-2">
                    <label htmlFor="student-exam-pagesize" className={mutedText}>
                      Por página:
                    </label>
                    <select
                      id="student-exam-pagesize"
                      value={pageSize}
                      onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                      style={{ colorScheme: isDark ? 'dark' : 'light' }}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold outline-none cursor-pointer ${
                        isDark
                          ? 'bg-[#162235] border-white/15 text-white'
                          : 'bg-[#FFF9F0] border-[#2E4A70]/20 text-[#1a2639]'
                      }`}
                    >
                      {[6, 9, 12, 24].map((sz) => (
                        <option key={sz} value={sz} className={isDark ? 'bg-[#1e293b] text-white' : 'bg-white text-[#1a2639]'}>
                          {sz}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleRefreshCatalog}
                    disabled={fetchingPage || syncingAll}
                    title="Actualizar listado"
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 ${
                      isDark
                        ? 'bg-white/10 text-blue-100 hover:bg-white/15'
                        : 'bg-[#F0F2F2] text-[#2E4A70] hover:bg-slate-200/80'
                    }`}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${fetchingPage || syncingAll ? 'animate-spin' : ''}`} />
                    <span>Actualizar</span>
                  </button>

                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                        isDark
                          ? 'bg-white/10 text-blue-100 hover:bg-white/15'
                          : 'bg-[#F0F2F2] text-[#014ba0] hover:bg-slate-200/80'
                      }`}
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Limpiar</span>
                    </button>
                  )}
                </div>
              </div>

              <div
                className={`pt-3 border-t flex flex-wrap items-center justify-between gap-2 text-xs font-semibold tabular-nums ${
                  isDark ? 'border-white/10 text-blue-200' : 'border-[#2E4A70]/10 text-[#2E4A70]'
                }`}
              >
                <span>
                  Mostrando {rangeStart}–{rangeEnd} de {totalMatchingCount}{' '}
                  {totalMatchingCount === 1 ? 'examen' : 'exámenes'} · Página {safeCurrentPage} de {totalPages}
                </span>
                {(syncingAll || fetchingPage) && (
                  <span className="inline-flex items-center gap-1.5 text-[#24B0BA] font-bold">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>{syncingAll ? 'Buscando en todo el catálogo...' : 'Cargando página...'}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {totalCatalogCount === 0 ? (
            <div className="text-center py-14">
              <div className={`max-w-md mx-auto rounded-2xl border p-8 ${cardSurface}`}>
                <div
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
                    isDark ? 'bg-[#162235] text-[#24B0BA]' : 'bg-[#FAF5EB] text-[#014ba0]'
                  }`}
                >
                  <ClipboardList className="h-8 w-8" />
                </div>
                <h2 className="text-xl font-extrabold mb-2">Sin exámenes disponibles</h2>
                <p className={`text-sm leading-relaxed ${mutedText}`}>
                  Aún no hay evaluaciones activas publicadas para tu cuenta.
                </p>
              </div>
            </div>
          ) : syncingAll && displayedExams.length === 0 ? (
            <div className="text-center py-14">
              <div className={`max-w-md mx-auto rounded-2xl border p-8 ${cardSurface}`}>
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-[#24B0BA]" />
                <p className={`text-sm font-bold ${mutedText}`}>
                  Buscando en todos los exámenes disponibles...
                </p>
              </div>
            </div>
          ) : totalMatchingCount === 0 ? (
            <div className="text-center py-14">
              <div className={`max-w-md mx-auto rounded-2xl border p-8 ${cardSurface}`}>
                <div
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
                    isDark ? 'bg-[#162235] text-[#24B0BA]' : 'bg-[#FAF5EB] text-[#014ba0]'
                  }`}
                >
                  <Search className="h-8 w-8" />
                </div>
                <h2 className="text-xl font-extrabold mb-2">No se encontraron exámenes</h2>
                <p className={`text-sm mb-6 leading-relaxed ${mutedText}`}>
                  Prueba cambiando el texto de búsqueda o el filtro de estado.
                </p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="w-full bg-[#014ba0] hover:bg-[#013b80] text-white font-bold py-2.5 px-5 rounded-xl cursor-pointer transition-colors"
                >
                  Mostrar todos los exámenes
                </button>
              </div>
            </div>
          ) : viewMode === 'list' ? (
            <div className="space-y-4">
              {displayedExams.map((exam) => {
                const questionCount = Array.isArray(exam.questions) ? exam.questions.length : 0;
                const attempts = Array.isArray(exam.attempts) ? exam.attempts : [];
                const hasAttempts = attempts.length > 0;
                const bestScore = hasAttempts
                  ? Math.max(...attempts.map((a) => Number(a.score || 0)))
                  : null;
                const latestAttempt = hasAttempts ? attempts[0] : null;

                return (
                  <article
                    key={exam.id}
                    className={`rounded-2xl border p-5 transition-colors ${cardSurface}`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                              hasAttempts
                                ? isDark
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-emerald-100 text-emerald-800'
                                : isDark
                                ? 'bg-[#24B0BA]/15 text-[#24B0BA]'
                                : 'bg-[#014ba0]/10 text-[#014ba0]'
                            }`}
                          >
                            {hasAttempts ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>
                                  {attempts.length} {attempts.length === 1 ? 'intento' : 'intentos'}
                                </span>
                              </>
                            ) : (
                              <>
                                <ClipboardList className="w-3.5 h-3.5" />
                                <span>Pendiente</span>
                              </>
                            )}
                          </span>

                          {bestScore !== null && (
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border tabular-nums ${getScoreBadgeClasses(
                                bestScore,
                                isDark
                              )}`}
                            >
                              <Trophy className="w-3 h-3" />
                              <span>Mejor: {bestScore}/100</span>
                            </span>
                          )}

                          <span className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${mutedText}`}>
                            <FileText className="h-3.5 w-3.5" />
                            <span>
                              {questionCount} {questionCount === 1 ? 'pregunta' : 'preguntas'}
                            </span>
                          </span>

                          {exam.timer ? (
                            <span className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${mutedText}`}>
                              <Clock className="h-3.5 w-3.5" />
                              <span>{exam.timer} min</span>
                            </span>
                          ) : null}

                          {exam.scheduledAt?.seconds ? (
                            <span className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${mutedText}`}>
                              <Calendar className="h-3.5 w-3.5" />
                              <span>{formatAttemptDate(exam.scheduledAt)}</span>
                            </span>
                          ) : null}
                        </div>

                        <h2 className="text-lg sm:text-xl font-extrabold leading-snug">
                          {exam.title}
                        </h2>

                        <p className={`text-sm leading-relaxed line-clamp-2 ${mutedText}`}>
                          {exam.description || 'Este examen pondrá a prueba tus conocimientos.'}
                        </p>
                      </div>

                      <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
                        {latestAttempt && (
                          <button
                            type="button"
                            onClick={() => handleViewAnswers(latestAttempt, exam)}
                            className={`inline-flex items-center justify-center gap-2 font-bold text-xs sm:text-sm py-2.5 px-4 rounded-xl cursor-pointer transition-colors ${
                              isDark
                                ? 'bg-white/10 text-blue-100 hover:bg-white/15'
                                : 'bg-[#F0F2F2] text-[#014ba0] hover:bg-slate-200/80'
                            }`}
                          >
                            <Eye className="w-4 h-4" />
                            <span>Último intento ({Number(latestAttempt.score || 0)}/100)</span>
                          </button>
                        )}
                        <Link
                          href={`/app/examen-test/examen?examId=${exam.id}`}
                          className="inline-flex items-center justify-center gap-2 font-bold text-sm rounded-xl px-5 py-2.5 bg-[#014ba0] hover:bg-[#013b80] text-white transition-colors"
                        >
                          {hasAttempts ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                          <span>{hasAttempts ? 'Repetir Examen' : 'Comenzar Examen'}</span>
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-5 sm:gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {displayedExams.map((exam) => {
                const questionCount = Array.isArray(exam.questions) ? exam.questions.length : 0;
                const attempts = Array.isArray(exam.attempts) ? exam.attempts : [];
                const hasAttempts = attempts.length > 0;
                const bestScore = hasAttempts
                  ? Math.max(...attempts.map((a) => Number(a.score || 0)))
                  : null;

                return (
                  <article
                    key={exam.id}
                    className={`rounded-2xl border flex flex-col justify-between overflow-hidden transition-colors ${cardSurface}`}
                  >
                    <div className="p-5 sm:p-6 flex flex-col flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold ${
                            hasAttempts
                              ? isDark
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-emerald-100 text-emerald-800'
                              : isDark
                              ? 'bg-[#24B0BA]/15 text-[#24B0BA]'
                              : 'bg-[#014ba0]/10 text-[#014ba0]'
                          }`}
                        >
                          {hasAttempts ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>
                                {attempts.length} {attempts.length === 1 ? 'intento' : 'intentos'}
                              </span>
                            </>
                          ) : (
                            <>
                              <ClipboardList className="w-3.5 h-3.5" />
                              <span>Pendiente</span>
                            </>
                          )}
                        </span>

                        {bestScore !== null && (
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border tabular-nums ${getScoreBadgeClasses(
                              bestScore,
                              isDark
                            )}`}
                          >
                            <Trophy className="w-3 h-3" />
                            <span>Mejor: {bestScore}/100</span>
                          </span>
                        )}
                      </div>

                      <h2 className="text-lg sm:text-xl font-extrabold leading-snug mb-2 line-clamp-2">
                        {exam.title}
                      </h2>

                      <p className={`text-sm leading-relaxed mb-5 line-clamp-3 flex-1 ${mutedText}`}>
                        {exam.description || 'Este examen pondrá a prueba tus conocimientos.'}
                      </p>

                      <div
                        className={`flex flex-wrap items-center gap-3 text-xs font-bold tabular-nums mb-5 ${mutedText}`}
                      >
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${
                            isDark ? 'bg-[#162235]' : 'bg-[#FAF5EB]'
                          }`}
                        >
                          <FileText
                            className={`h-4 w-4 shrink-0 ${
                              isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                            }`}
                          />
                          <span>
                            {questionCount} {questionCount === 1 ? 'pregunta' : 'preguntas'}
                          </span>
                        </span>

                        {exam.timer ? (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${
                              isDark ? 'bg-[#162235]' : 'bg-[#FAF5EB]'
                            }`}
                          >
                            <Clock
                              className={`h-4 w-4 shrink-0 ${
                                isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                              }`}
                            />
                            <span>{exam.timer} min</span>
                          </span>
                        ) : null}

                        {exam.scheduledAt?.seconds ? (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${
                              isDark ? 'bg-[#162235]' : 'bg-[#FAF5EB]'
                            }`}
                          >
                            <Calendar
                              className={`h-4 w-4 shrink-0 ${
                                isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                              }`}
                            />
                            <span>{formatAttemptDate(exam.scheduledAt)}</span>
                          </span>
                        ) : null}
                      </div>

                      <Link
                        href={`/app/examen-test/examen?examId=${exam.id}`}
                        className="w-full inline-flex items-center justify-center gap-2 font-bold text-sm rounded-xl px-4 py-3 bg-[#014ba0] hover:bg-[#013b80] text-white transition-colors"
                      >
                        {hasAttempts ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        <span>{hasAttempts ? 'Repetir Examen' : 'Comenzar Examen'}</span>
                      </Link>
                    </div>

                    {hasAttempts && (
                      <div
                        className={`px-5 sm:px-6 py-4 border-t ${
                          isDark
                            ? 'border-white/10 bg-[#162235]/60'
                            : 'border-[#2E4A70]/10 bg-[#FAF5EB]/60'
                        }`}
                      >
                        <h3 className={`text-xs font-extrabold uppercase tracking-wide mb-2.5 ${mutedText}`}>
                          Tus Intentos Anteriores
                        </h3>
                        <ul className="space-y-2 max-h-44 overflow-y-auto pr-1">
                          {attempts.map((attempt) => {
                            const score = Number(attempt.score || 0);
                            return (
                              <li
                                key={attempt.id}
                                className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border ${
                                  isDark
                                    ? 'bg-[#1e293b] border-white/10'
                                    : 'bg-white border-[#2E4A70]/10'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-extrabold border tabular-nums ${getScoreBadgeClasses(
                                        score,
                                        isDark
                                      )}`}
                                    >
                                      {score}/100
                                    </span>
                                    <span className={`text-xs font-medium tabular-nums truncate ${mutedText}`}>
                                      {formatAttemptDate(attempt.completedAt)}
                                    </span>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleViewAnswers(attempt, exam)}
                                  title="Ver tus respuestas"
                                  aria-label={`Ver respuestas del intento del ${formatAttemptDate(
                                    attempt.completedAt
                                  )}`}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors shrink-0 ${
                                    isDark
                                      ? 'bg-white/10 text-blue-100 hover:bg-[#24B0BA]/25 hover:text-[#24B0BA]'
                                      : 'bg-[#F0F2F2] text-[#014ba0] hover:bg-[#014ba0] hover:text-white'
                                  }`}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  <span>Revisar</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {totalCatalogCount > 0 && displayedExams.length > 0 && (totalPages > 1 || hasMoreServer) && (
            <nav
              aria-label="Paginación de exámenes"
              className={`mt-8 rounded-2xl border px-4 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 ${
                isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15'
              }`}
            >
              <span className={`text-xs font-semibold tabular-nums ${mutedText}`}>
                Mostrando {rangeStart}–{rangeEnd} de {totalMatchingCount}{' '}
                {totalMatchingCount === 1 ? 'examen' : 'exámenes'}
              </span>

              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleGoToPage(safeCurrentPage - 1)}
                  disabled={safeCurrentPage <= 1 || fetchingPage}
                  className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    isDark
                      ? 'bg-[#162235] border-white/10 text-blue-100 hover:bg-white/10'
                      : 'bg-[#FFF9F0] border-[#2E4A70]/15 text-[#2E4A70] hover:bg-slate-100'
                  }`}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span>Anterior</span>
                </button>

                {visiblePageNumbers.map((item) =>
                  typeof item === 'string' ? (
                    <span
                      key={item}
                      className={`px-2 py-1 text-xs font-bold ${mutedText}`}
                      aria-hidden="true"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => handleGoToPage(item)}
                      disabled={fetchingPage}
                      aria-current={item === safeCurrentPage ? 'page' : undefined}
                      className={`min-w-9 px-3 py-2 rounded-xl text-xs font-extrabold border tabular-nums transition-colors cursor-pointer disabled:opacity-50 ${
                        item === safeCurrentPage
                          ? 'bg-[#014ba0] border-[#014ba0] text-white'
                          : isDark
                          ? 'bg-[#162235] border-white/10 text-blue-100 hover:bg-white/10'
                          : 'bg-white border-[#2E4A70]/15 text-[#2E4A70] hover:bg-[#FFF9F0]'
                      }`}
                    >
                      {item}
                    </button>
                  )
                )}

                <button
                  type="button"
                  onClick={() => handleGoToPage(safeCurrentPage + 1)}
                  disabled={
                    fetchingPage ||
                    (useMemoryPagination
                      ? safeCurrentPage >= totalPages
                      : !hasMoreServer && safeCurrentPage >= totalPages)
                  }
                  className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    isDark
                      ? 'bg-[#162235] border-white/10 text-blue-100 hover:bg-white/10'
                      : 'bg-[#FFF9F0] border-[#2E4A70]/15 text-[#2E4A70] hover:bg-slate-100'
                  }`}
                >
                  <span>Siguiente</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </nav>
          )}
        </div>
      </div>

      {selectedAttempt && viewingExam && (
        <AttemptAnswersModal
          attempt={selectedAttempt}
          exam={viewingExam}
          onClose={() => setSelectedAttempt(null)}
          isDark={isDark}
        />
      )}
    </>
  );
}
