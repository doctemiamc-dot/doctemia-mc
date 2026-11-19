'use client';

import { useState, useEffect, Suspense, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { db, auth } from '@/lib/firebase';
import {
  doc,
  getDoc,
  addDoc,
  collection,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { useTheme } from '@/context/ThemeContext';
import Swal from 'sweetalert2';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  Send,
  Trophy,
  RotateCcw,
  ListChecks,
  BookOpen,
  AlertCircle,
  Loader2,
  LayoutGrid,
  X,
} from 'lucide-react';

function Timer({ initialMinutes, onTimeUp, isDark, compact = false }) {
  const [timeLeft, setTimeLeft] = useState(() => Math.max(0, Math.round(initialMinutes * 60)));
  const onTimeUpRef = useRef(onTimeUp);
  const triggeredRef = useRef(false);

  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (timeLeft <= 0 && !triggeredRef.current) {
      triggeredRef.current = true;
      onTimeUpRef.current?.();
    }
  }, [timeLeft]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const isUrgent = timeLeft < 300;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs sm:text-sm font-extrabold tabular-nums ${
          isUrgent
            ? isDark
              ? 'bg-rose-500/20 border-rose-400/40 text-rose-300'
              : 'bg-rose-50 border-rose-200 text-rose-700'
            : isDark
            ? 'bg-[#162235] border-white/15 text-[#24B0BA]'
            : 'bg-[#FAF5EB] border-[#2E4A70]/15 text-[#014ba0]'
        }`}
      >
        <Clock className="w-4 h-4 shrink-0" />
        <span>{formatted}</span>
      </div>
    );
  }

  return (
    <div
      className={`text-center p-4 rounded-xl border ${
        isUrgent
          ? isDark
            ? 'bg-rose-500/15 border-rose-400/35'
            : 'bg-rose-50 border-rose-200'
          : isDark
          ? 'bg-[#162235] border-white/10'
          : 'bg-[#FAF5EB] border-[#2E4A70]/12'
      }`}
    >
      <div
        className={`text-[11px] font-extrabold uppercase tracking-wider mb-1 ${
          isUrgent
            ? isDark
              ? 'text-rose-300'
              : 'text-rose-700'
            : isDark
            ? 'text-slate-300'
            : 'text-[#2E4A70]'
        }`}
      >
        Tiempo Restante
      </div>
      <div
        className={`text-3xl font-black tabular-nums ${
          isUrgent
            ? isDark
              ? 'text-rose-300'
              : 'text-rose-600'
            : isDark
            ? 'text-white'
            : 'text-[#014ba0]'
        }`}
      >
        {formatted}
      </div>
    </div>
  );
}

const buildEmptyAnswers = (questions) =>
  questions.map((_, i) => ({
    questionIndex: i,
    selectedOptionIndex: null,
    selectedOptionIndices: [],
    textAnswer: '',
  }));

function ExamenContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const examId = searchParams.get('examId');
  const { isDark } = useTheme();

  const [examData, setExamData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState([]);
  const [examFinished, setExamFinished] = useState(false);
  const [results, setResults] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [isMobileMapOpen, setIsMobileMapOpen] = useState(false);

  useEffect(() => {
    if (!isMobileMapOpen) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setIsMobileMapOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobileMapOpen]);

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1e293b' : '#ffffff',
      color: isDark ? '#f8fafc' : '#1a2639',
      confirmButtonColor: '#014ba0',
      cancelButtonColor: '#dc2626',
    }),
    [isDark]
  );

  const draftKey = examId ? `doctemia_exam_draft_v1_${examId}` : null;

  const handleSubmitExam = useCallback(async () => {
    if (submitting || !examData) return;
    if (!auth.currentUser) {
      Swal.fire({
        icon: 'error',
        title: 'Autenticación Requerida',
        text: 'Debes estar autenticado para enviar el examen.',
        ...swalTheme,
      });
      return;
    }
    setSubmitting(true);

    const questions = Array.isArray(examData.questions) ? examData.questions : [];
    const multipleChoiceQuestions = questions.filter((q) => q.type === 'multiple-choice');
    let correctCount = 0;

    const answersWithDetails = questions.map((q, i) => {
      const userAnswer = userAnswers[i] || {
        questionIndex: i,
        selectedOptionIndex: null,
        selectedOptionIndices: [],
        textAnswer: '',
      };
      let isCorrect = null;

      if (q.type === 'multiple-choice') {
        if (q.correctOptionIndices && q.correctOptionIndices.length > 1) {
          if (userAnswer.selectedOptionIndices && userAnswer.selectedOptionIndices.length > 0) {
            const userSelected = [...userAnswer.selectedOptionIndices].sort((a, b) => a - b);
            const correctSelected = [...q.correctOptionIndices].sort((a, b) => a - b);
            isCorrect =
              userSelected.length === correctSelected.length &&
              userSelected.every((idx, pos) => idx === correctSelected[pos]);
          } else {
            isCorrect = false;
          }
        } else if (q.correctOptionIndices && q.correctOptionIndices.length === 1) {
          isCorrect = userAnswer.selectedOptionIndex === q.correctOptionIndices[0];
        } else {
          isCorrect = userAnswer.selectedOptionIndex === q.correctOptionIndex;
        }

        if (isCorrect) correctCount += 1;
      }

      return {
        questionIndex: i,
        questionText: q.questionText,
        type: q.type,
        options: q.options || [],
        correctOptionIndex: q.correctOptionIndex,
        correctOptionIndices: q.correctOptionIndices || [],
        correctAnswer: q.correctAnswer || '',
        explanation: q.explanation || '',
        selectedOptionIndex: userAnswer.selectedOptionIndex,
        selectedOptionIndices: userAnswer.selectedOptionIndices || [],
        textAnswer: userAnswer.textAnswer || '',
        isCorrect,
      };
    });

    const score =
      multipleChoiceQuestions.length > 0
        ? Math.round((correctCount / multipleChoiceQuestions.length) * 100)
        : 100;
    const resultStatus = score >= 51 ? 'aprobado' : 'reprobado';

    try {
      await addDoc(collection(db, 'examAttempts'), {
        examId: examData.id,
        userId: auth.currentUser.uid,
        userEmail: auth.currentUser.email,
        startedAt: startTime,
        completedAt: serverTimestamp(),
        answers: userAnswers,
        score,
        resultStatus,
      });

      try {
        if (draftKey) window.sessionStorage.removeItem(draftKey);
        window.sessionStorage.removeItem(`doctemia_student_exams_v1_${auth.currentUser.uid}`);
        window.sessionStorage.removeItem(`doctemia_student_exams_pool_v2_${auth.currentUser.uid}`);
      } catch {
        // Ignorar
      }

      setResults({
        score,
        answersWithCorrectness: answersWithDetails,
        resultStatus,
        hasOnlyOpenEnded: multipleChoiceQuestions.length === 0,
      });
      setExamFinished(true);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err) {
      console.error('Error al guardar intento:', err);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Error al guardar tu examen. Intenta de nuevo.',
        ...swalTheme,
      });
    } finally {
      setSubmitting(false);
    }
  }, [examData, userAnswers, startTime, submitting, draftKey, swalTheme]);

  useEffect(() => {
    if (!examId) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'ID de examen no proporcionado.',
        ...swalTheme,
      });
      router.push('/app/examen-test');
      return;
    }

    let cancelled = false;
    const loadExam = async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'exams', examId));
        if (cancelled) return;

        if (!snap.exists() || snap.data().status !== 'active') {
          Swal.fire({
            icon: 'error',
            title: 'No disponible',
            text: 'Este examen no se encuentra o no está activo.',
            ...swalTheme,
          });
          router.push('/app/examen-test');
          return;
        }

        const data = snap.data();
        const questions = Array.isArray(data.questions) ? data.questions : [];
        let initialAnswers = buildEmptyAnswers(questions);
        let initialIndex = 0;

        if (draftKey) {
          try {
            const rawDraft = window.sessionStorage.getItem(draftKey);
            if (rawDraft) {
              const parsed = JSON.parse(rawDraft);
              const isFresh =
                parsed &&
                typeof parsed.ts === 'number' &&
                Date.now() - parsed.ts < 6 * 60 * 60 * 1000;
              if (
                isFresh &&
                Array.isArray(parsed.answers) &&
                parsed.answers.length === questions.length
              ) {
                initialAnswers = parsed.answers;
                if (
                  typeof parsed.currentQuestionIndex === 'number' &&
                  parsed.currentQuestionIndex >= 0 &&
                  parsed.currentQuestionIndex < questions.length
                ) {
                  initialIndex = parsed.currentQuestionIndex;
                }
              }
            }
          } catch {
            // Ignorar borrador corrupto
          }
        }

        setExamData({ id: snap.id, ...data, questions });
        setUserAnswers(initialAnswers);
        setCurrentQuestionIndex(initialIndex);
        setStartTime(Timestamp.now());
      } catch (err) {
        console.error('Error al cargar el examen:', err);
        if (!cancelled) {
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se pudo cargar el examen.',
            ...swalTheme,
          });
          router.push('/app/examen-test');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadExam();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, router]);

  useEffect(() => {
    if (!draftKey || !examData || examFinished || userAnswers.length === 0) return;
    try {
      window.sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          ts: Date.now(),
          answers: userAnswers,
          currentQuestionIndex,
        })
      );
    } catch {
      // Ignorar
    }
  }, [draftKey, examData, examFinished, userAnswers, currentQuestionIndex]);

  const handleAnswerChange = (index, value, isMultiple = false) => {
    const questionType = examData?.questions?.[index]?.type;
    if (!questionType) return;

    setUserAnswers((ans) =>
      ans.map((a) => {
        if (a.questionIndex !== index) return a;
        if (questionType === 'open-ended') {
          return { ...a, textAnswer: value };
        }
        if (isMultiple) {
          const currentIndices = a.selectedOptionIndices || [];
          const newIndices = currentIndices.includes(value)
            ? currentIndices.filter((idx) => idx !== value)
            : [...currentIndices, value].sort((x, y) => x - y);
          return {
            ...a,
            selectedOptionIndices: newIndices,
            selectedOptionIndex: newIndices.length > 0 ? newIndices[0] : null,
          };
        }
        return {
          ...a,
          selectedOptionIndex: value,
          selectedOptionIndices: [value],
        };
      })
    );
  };

  const isQuestionAnswered = useCallback(
    (index) => {
      const answer = userAnswers[index];
      const question = examData?.questions?.[index];
      if (!answer || !question) return false;
      if (question.type === 'multiple-choice') {
        if (question.correctOptionIndices && question.correctOptionIndices.length > 1) {
          return Boolean(answer.selectedOptionIndices && answer.selectedOptionIndices.length > 0);
        }
        return answer.selectedOptionIndex !== null && answer.selectedOptionIndex !== undefined;
      }
      if (question.type === 'open-ended') {
        return Boolean(answer.textAnswer && answer.textAnswer.trim() !== '');
      }
      return false;
    },
    [userAnswers, examData]
  );

  const answeredCount = useMemo(() => {
    if (!examData?.questions?.length) return 0;
    return examData.questions.reduce(
      (acc, _, idx) => (isQuestionAnswered(idx) ? acc + 1 : acc),
      0
    );
  }, [examData, isQuestionAnswered]);

  const finalSubmitConfirmation = async () => {
    const total = examData?.questions?.length || 0;
    const unansweredCount = total - answeredCount;

    if (unansweredCount > 0) {
      const result = await Swal.fire({
        title: '¿Finalizar examen?',
        text: `Tienes ${unansweredCount} ${
          unansweredCount === 1 ? 'pregunta sin responder' : 'preguntas sin responder'
        }. ¿Deseas enviarlo de todas formas?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, finalizar',
        cancelButtonText: 'Seguir respondiendo',
        ...swalTheme,
      });
      if (!result.isConfirmed) return;
    }
    handleSubmitExam();
  };

  const handleRestartAttempt = () => {
    if (!examData?.questions) return;
    if (draftKey) {
      try {
        window.sessionStorage.removeItem(draftKey);
      } catch {
        // Ignorar
      }
    }
    setUserAnswers(buildEmptyAnswers(examData.questions));
    setCurrentQuestionIndex(0);
    setResults(null);
    setExamFinished(false);
    setStartTime(Timestamp.now());
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (loading || examFinished || !examData?.questions?.length) return undefined;
    const total = examData.questions.length;
    const handleKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') {
        setCurrentQuestionIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentQuestionIndex((i) => Math.min(total - 1, i + 1));
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [loading, examFinished, examData]);

  const pageBg = isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]';
  const cardSurface = isDark
    ? 'bg-[#1e293b] border-white/10 text-white'
    : 'bg-white border-[#2E4A70]/15 text-[#1a2639]';
  const innerSurface = isDark
    ? 'bg-[#162235] border-white/10'
    : 'bg-[#FAF5EB] border-[#2E4A70]/12';
  const mutedText = isDark ? 'text-slate-300' : 'text-[#2E4A70]';

  if (loading) {
    return (
      <div className={`min-h-[calc(100dvh-4rem)] flex items-center justify-center p-4 ${pageBg}`}>
        <div className={`rounded-2xl border p-8 text-center max-w-sm w-full ${cardSurface}`}>
          <Loader2
            className={`w-10 h-10 animate-spin mx-auto mb-3 ${
              isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
            }`}
          />
          <p className="text-base font-bold">Cargando examen...</p>
          <p className={`text-xs mt-1 ${mutedText}`}>Preparando preguntas e historial</p>
        </div>
      </div>
    );
  }

  if (!examData || !Array.isArray(examData.questions) || examData.questions.length === 0) {
    return (
      <div className={`min-h-[calc(100dvh-4rem)] flex items-center justify-center p-4 ${pageBg}`}>
        <div className={`rounded-2xl border p-8 text-center max-w-md w-full ${cardSurface}`}>
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-amber-500" />
          <p className="text-base font-bold mb-4">No se encontraron preguntas para este examen.</p>
          <Link
            href="/app/examen-test"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white font-bold text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Volver a Exámenes</span>
          </Link>
        </div>
      </div>
    );
  }

  if (examFinished && results) {
    const mcCorrect = results.answersWithCorrectness.filter(
      (i) => i.type === 'multiple-choice' && i.isCorrect === true
    ).length;
    const mcTotal = results.answersWithCorrectness.filter(
      (i) => i.type === 'multiple-choice'
    ).length;
    const openEndedTotal = results.answersWithCorrectness.length - mcTotal;

    return (
      <div className={`min-h-[calc(100dvh-4rem)] py-6 sm:py-8 px-3 sm:px-6 ${pageBg}`}>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className={`rounded-2xl border p-5 sm:p-8 ${cardSurface}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-current/10">
              <div className="min-w-0">
                <h1
                  className={`text-2xl sm:text-3xl font-black tracking-tight break-words ${
                    isDark ? 'text-white' : 'text-[#014ba0]'
                  }`}
                >
                  Resultados: {examData.title}
                </h1>
                <p className={`text-xs sm:text-sm mt-1 ${mutedText}`}>
                  {results.hasOnlyOpenEnded
                    ? 'Evaluación de desarrollo registrada correctamente.'
                    : 'Nota: Las preguntas abiertas de desarrollo no afectan el cálculo automático.'}
                </p>
              </div>

              <div
                className={`shrink-0 inline-flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border tabular-nums ${
                  results.resultStatus === 'aprobado'
                    ? isDark
                      ? 'bg-emerald-500/20 border-emerald-400/35 text-emerald-300'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : isDark
                    ? 'bg-rose-500/20 border-rose-400/35 text-rose-300'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                <Trophy className="w-5 h-5 shrink-0" />
                <div className="text-left">
                  <div className="text-lg sm:text-xl font-black leading-none">
                    {results.score}/100
                  </div>
                  <div className="text-[11px] font-extrabold uppercase tracking-wide mt-0.5">
                    {results.hasOnlyOpenEnded ? 'Completado' : results.resultStatus}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-5 tabular-nums">
              {mcTotal > 0 && (
                <div className={`rounded-xl border p-3.5 ${innerSurface}`}>
                  <div className={`text-xs font-bold ${mutedText}`}>Opción múltiple</div>
                  <div className="text-xl font-black mt-0.5">
                    {mcCorrect} / {mcTotal}
                  </div>
                </div>
              )}
              {openEndedTotal > 0 && (
                <div className={`rounded-xl border p-3.5 ${innerSurface}`}>
                  <div className={`text-xs font-bold ${mutedText}`}>Preguntas abiertas</div>
                  <div className="text-xl font-black mt-0.5">{openEndedTotal}</div>
                </div>
              )}
              <div className={`rounded-xl border p-3.5 ${innerSurface}`}>
                <div className={`text-xs font-bold ${mutedText}`}>Total evaluadas</div>
                <div className="text-xl font-black mt-0.5">{results.answersWithCorrectness.length}</div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {results.answersWithCorrectness.map((item, idx) => {
              const isMC = item.type === 'multiple-choice';
              const badgeClass = isMC
                ? item.isCorrect
                  ? isDark
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-emerald-100 text-emerald-800'
                  : isDark
                  ? 'bg-rose-500/20 text-rose-300'
                  : 'bg-rose-100 text-rose-800'
                : isDark
                ? 'bg-[#24B0BA]/20 text-[#24B0BA]'
                : 'bg-[#014ba0]/10 text-[#014ba0]';

              return (
                <article
                  key={idx}
                  className={`rounded-2xl border p-4 sm:p-6 ${cardSurface}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-3.5">
                    <h2 className="text-base sm:text-lg font-extrabold leading-snug break-words">
                      <span className="tabular-nums opacity-70 mr-1.5">{idx + 1}.</span>
                      {item.questionText}
                    </h2>
                    <span
                      className={`self-start shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${badgeClass}`}
                    >
                      {isMC ? (item.isCorrect ? 'Correcta' : 'Incorrecta') : 'Desarrollo'}
                    </span>
                  </div>

                  {item.type === 'open-ended' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className={`p-3.5 rounded-xl border ${innerSurface}`}>
                        <h3 className={`text-xs font-extrabold uppercase mb-1.5 ${mutedText}`}>
                          Tu respuesta
                        </h3>
                        <p className="text-sm leading-relaxed break-words">
                          {item.textAnswer?.trim() || (
                            <span className="italic opacity-60">No contestada</span>
                          )}
                        </p>
                      </div>
                      <div
                        className={`p-3.5 rounded-xl border ${
                          isDark
                            ? 'bg-emerald-500/10 border-emerald-500/25'
                            : 'bg-emerald-50 border-emerald-200'
                        }`}
                      >
                        <h3
                          className={`text-xs font-extrabold uppercase mb-1.5 ${
                            isDark ? 'text-emerald-300' : 'text-emerald-800'
                          }`}
                        >
                          Respuesta de referencia
                        </h3>
                        <p className="text-sm leading-relaxed break-words">
                          {item.correctAnswer || (
                            <span className="italic opacity-60">Sin respuesta modelo registrada</span>
                          )}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <ul className="space-y-2 text-sm">
                        {item.options.map((opt, oi) => {
                          const isUserSelected = item.selectedOptionIndices?.length
                            ? item.selectedOptionIndices.includes(oi)
                            : item.selectedOptionIndex === oi;
                          const isCorrectOption =
                            item.correctOptionIndices && item.correctOptionIndices.length > 0
                              ? item.correctOptionIndices.includes(oi)
                              : item.correctOptionIndex === oi;

                          let rowClass = isDark
                            ? 'bg-[#162235] border-white/10 text-slate-300'
                            : 'bg-[#FAF5EB]/70 border-[#2E4A70]/10 text-[#2E4A70]';
                          if (isCorrectOption) {
                            rowClass = isDark
                              ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200 font-bold'
                              : 'bg-emerald-50 border-emerald-300 text-emerald-900 font-bold';
                          } else if (isUserSelected) {
                            rowClass = isDark
                              ? 'bg-rose-500/15 border-rose-400/40 text-rose-200'
                              : 'bg-rose-50 border-rose-300 text-rose-800';
                          }

                          return (
                            <li
                              key={oi}
                              className={`px-3.5 py-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${rowClass}`}
                            >
                              <span className="break-words">
                                <span className="font-extrabold mr-2 uppercase">
                                  {String.fromCharCode(65 + oi)}.
                                </span>
                                {opt}
                              </span>
                              <div className="flex items-center gap-1.5 text-[11px] font-extrabold shrink-0">
                                {isUserSelected && !isCorrectOption && <span>Tu elección</span>}
                                {isCorrectOption && <span>Correcta</span>}
                              </div>
                            </li>
                          );
                        })}
                      </ul>

                      {item.explanation && (
                        <div className={`p-3.5 rounded-xl border ${innerSurface}`}>
                          <h3
                            className={`text-xs font-extrabold uppercase mb-1 ${
                              isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                            }`}
                          >
                            Explicación
                          </h3>
                          <p className={`text-sm leading-relaxed break-words ${mutedText}`}>
                            {item.explanation}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2 pb-4">
            <Link
              href="/app/examen-test"
              className={`flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border font-bold text-sm transition-colors ${
                isDark
                  ? 'bg-[#1e293b] border-white/15 text-white hover:bg-white/10'
                  : 'bg-white border-[#2E4A70]/20 text-[#2E4A70] hover:bg-slate-50'
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Volver a Exámenes</span>
            </Link>

            <button
              type="button"
              onClick={handleRestartAttempt}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm bg-[#014ba0] hover:bg-[#013b80] text-white cursor-pointer transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Repetir Examen</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const totalQuestions = examData.questions.length;
  const question = examData.questions[currentQuestionIndex];
  const answer = userAnswers[currentQuestionIndex] || {
    selectedOptionIndex: null,
    selectedOptionIndices: [],
    textAnswer: '',
  };
  const hasMultipleCorrectOptions =
    question.type === 'multiple-choice' &&
    question.correctOptionIndices &&
    question.correctOptionIndices.length > 1;
  const progressPercent = Math.round(((currentQuestionIndex + 1) / totalQuestions) * 100);
  const isLastQuestion = currentQuestionIndex === totalQuestions - 1;

  return (
    <div className={`min-h-[calc(100dvh-4rem)] py-4 sm:py-6 px-3 sm:px-6 lg:px-10 ${pageBg}`}>
      <div className="max-w-[1440px] mx-auto space-y-5 sm:space-y-6">
        {/* Cabecera integrada */}
        <header
          className={`pb-4 border-b space-y-3 ${
            isDark ? 'border-white/10' : 'border-[#2E4A70]/12'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Link
                href="/app/examen-test"
                aria-label="Volver al listado de exámenes"
                className={`inline-flex items-center justify-center w-10 h-10 rounded-xl border shrink-0 transition-colors ${
                  isDark
                    ? 'bg-[#1e293b] border-white/15 text-slate-200 hover:bg-white/10'
                    : 'bg-white border-[#2E4A70]/15 text-[#2E4A70] hover:bg-slate-50'
                }`}
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl lg:text-3xl font-black tracking-tight leading-snug line-clamp-2 break-words">
                  {examData.title}
                </h1>
                <div
                  className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs sm:text-sm font-semibold tabular-nums mt-0.5 ${mutedText}`}
                >
                  <span>
                    Pregunta {currentQuestionIndex + 1} de {totalQuestions} ({progressPercent}%)
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span>
                      Respondidas: {answeredCount}/{totalQuestions}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {examData.timer ? (
                <div className="lg:hidden">
                  <Timer initialMinutes={examData.timer} onTimeUp={handleSubmitExam} isDark={isDark} compact />
                </div>
              ) : null}

              <button
                type="button"
                onClick={finalSubmitConfirmation}
                disabled={submitting}
                className="lg:hidden inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer transition-colors disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{submitting ? 'Enviando...' : 'Finalizar'}</span>
              </button>
            </div>
          </div>

          <div
            className={`w-full h-1.5 rounded-full overflow-hidden ${
              isDark ? 'bg-[#162235]' : 'bg-[#2E4A70]/10'
            }`}
          >
            <div
              className="h-full bg-[#014ba0] transition-all duration-300 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </header>

        {/* Cuerpo principal equilibrado (mismo alto en ambas columnas en escritorio) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 xl:gap-8 items-stretch">
          {/* Panel de pregunta */}
          <section
            className={`lg:col-span-8 xl:col-span-9 rounded-2xl border p-4 sm:p-8 lg:p-10 flex flex-col justify-between ${cardSurface}`}
          >
            <div>
              <div className="mb-4">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold ${
                    isDark
                      ? 'bg-[#24B0BA]/15 text-[#24B0BA]'
                      : 'bg-[#014ba0]/10 text-[#014ba0]'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>
                    {question.type === 'open-ended'
                      ? 'Pregunta de desarrollo'
                      : hasMultipleCorrectOptions
                      ? 'Selección múltiple'
                      : 'Opción única'}
                  </span>
                </span>
              </div>

              <h2 className="text-lg sm:text-xl lg:text-[22px] font-extrabold leading-relaxed mb-5 sm:mb-6 break-words">
                {question.questionText}
              </h2>

              {hasMultipleCorrectOptions && (
                <div
                  className={`mb-5 px-4 py-3 rounded-xl border text-xs sm:text-sm font-semibold flex items-center gap-2.5 ${
                    isDark
                      ? 'bg-[#24B0BA]/10 border-[#24B0BA]/30 text-[#24B0BA]'
                      : 'bg-[#014ba0]/5 border-[#014ba0]/20 text-[#014ba0]'
                  }`}
                >
                  <ListChecks className="w-4 h-4 shrink-0" />
                  <span>Esta pregunta admite múltiples respuestas. Selecciona todas las que apliquen.</span>
                </div>
              )}

              {question.type === 'open-ended' ? (
                <div className="space-y-2">
                  <label htmlFor={`answer-open-${currentQuestionIndex}`} className="sr-only">
                    Tu respuesta
                  </label>
                  <textarea
                    id={`answer-open-${currentQuestionIndex}`}
                    value={answer.textAnswer || ''}
                    onChange={(e) => handleAnswerChange(currentQuestionIndex, e.target.value)}
                    rows={8}
                    className={`w-full min-h-[180px] sm:min-h-[250px] p-4 sm:p-5 rounded-xl border text-sm sm:text-base leading-relaxed outline-none transition-colors resize-y ${
                      isDark
                        ? 'bg-[#162235] border-white/15 text-white placeholder:text-slate-400 focus:border-[#24B0BA]'
                        : 'bg-[#FAF5EB]/50 border-[#2E4A70]/20 text-[#1a2639] placeholder:text-slate-400 focus:bg-white focus:border-[#014ba0]'
                    }`}
                    placeholder="Escribe tu respuesta aquí..."
                  />
                  <div className={`flex items-center justify-between gap-2 text-xs font-medium tabular-nums ${mutedText}`}>
                    <span className="truncate">
                      <span className="sm:hidden">Borrador guardado</span>
                      <span className="hidden sm:inline">Borrador guardado automáticamente en este dispositivo</span>
                    </span>
                    <span className="shrink-0">{(answer.textAnswer || '').length} caracteres</span>
                  </div>
                </div>
              ) : (
                <ul className="space-y-3">
                  {(question.options || []).map((opt, i) => {
                    const isSelected = hasMultipleCorrectOptions
                      ? Boolean(answer.selectedOptionIndices?.includes(i))
                      : answer.selectedOptionIndex === i;

                    return (
                      <li key={i}>
                        <label
                          className={`flex items-start gap-3.5 p-4 sm:p-5 rounded-xl border cursor-pointer transition-colors ${
                            isSelected
                              ? isDark
                                ? 'bg-[#014ba0]/25 border-[#24B0BA] text-white'
                                : 'bg-[#014ba0]/8 border-[#014ba0] text-[#1a2639]'
                              : isDark
                              ? 'bg-[#162235] border-white/10 text-slate-200 hover:border-white/25'
                              : 'bg-[#FAF5EB]/55 border-[#2E4A70]/15 text-[#1a2639] hover:border-[#014ba0]/40 hover:bg-white'
                          }`}
                        >
                          <input
                            type={hasMultipleCorrectOptions ? 'checkbox' : 'radio'}
                            name={hasMultipleCorrectOptions ? undefined : `q-${currentQuestionIndex}`}
                            checked={isSelected}
                            onChange={() =>
                              handleAnswerChange(currentQuestionIndex, i, hasMultipleCorrectOptions)
                            }
                            className="sr-only"
                          />
                          <span
                            className={`w-8 h-8 rounded-lg text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                              isSelected
                                ? 'bg-[#014ba0] text-white'
                                : isDark
                                ? 'bg-[#1e293b] text-slate-300 border border-white/10'
                                : 'bg-white text-[#2E4A70] border border-[#2E4A70]/15'
                            }`}
                          >
                            {String.fromCharCode(65 + i)}
                          </span>
                          <span className="text-sm sm:text-base font-medium leading-relaxed break-words flex-1 pt-0.5">
                            {opt}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Navegación inferior con botón central de Mapa en móvil */}
            <div
              className={`grid grid-cols-[1fr_auto_1fr] sm:flex sm:items-center sm:justify-between gap-2.5 sm:gap-3 mt-6 sm:mt-7 pt-5 border-t ${
                isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
              }`}
            >
              <button
                type="button"
                onClick={() => setCurrentQuestionIndex((i) => Math.max(0, i - 1))}
                disabled={currentQuestionIndex === 0}
                className={`inline-flex items-center justify-center gap-1.5 px-3 sm:px-5 py-3 rounded-xl border text-xs sm:text-sm font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  isDark
                    ? 'bg-[#162235] border-white/15 text-slate-200 hover:bg-white/10'
                    : 'bg-[#FAF5EB] border-[#2E4A70]/15 text-[#2E4A70] hover:bg-slate-100'
                }`}
              >
                <ChevronLeft className="w-4 h-4 shrink-0" />
                <span>Anterior</span>
              </button>

              <button
                type="button"
                onClick={() => setIsMobileMapOpen(true)}
                aria-label="Abrir mapa de preguntas"
                className={`lg:hidden inline-flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl border text-xs font-extrabold tabular-nums cursor-pointer transition-colors ${
                  isDark
                    ? 'bg-[#162235] border-white/15 text-blue-100 hover:bg-white/10'
                    : 'bg-[#FAF5EB] border-[#2E4A70]/20 text-[#014ba0] hover:bg-slate-100'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {currentQuestionIndex + 1}/{totalQuestions}
                </span>
              </button>

              {isLastQuestion ? (
                <button
                  type="button"
                  onClick={finalSubmitConfirmation}
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-1.5 px-3 sm:px-6 py-3 rounded-xl text-xs sm:text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer transition-colors disabled:opacity-50"
                >
                  <Send className="w-4 h-4 shrink-0" />
                  <span>{submitting ? 'Enviando...' : 'Finalizar'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setCurrentQuestionIndex((i) => Math.min(totalQuestions - 1, i + 1))
                  }
                  className="inline-flex items-center justify-center gap-1.5 px-3 sm:px-6 py-3 rounded-xl text-xs sm:text-sm font-bold bg-[#014ba0] hover:bg-[#013b80] text-white cursor-pointer transition-colors"
                >
                  <span>Siguiente</span>
                  <ChevronRight className="w-4 h-4 shrink-0" />
                </button>
              )}
            </div>
          </section>

          {/* Barra lateral derecha equilibrada en escritorio */}
          <aside
            className={`hidden lg:flex lg:flex-col lg:justify-between lg:col-span-4 xl:col-span-3 rounded-2xl border p-5 sm:p-6 gap-5 ${cardSurface}`}
          >
            <div className="space-y-5">
              {examData.timer ? (
                <Timer initialMinutes={examData.timer} onTimeUp={handleSubmitExam} isDark={isDark} />
              ) : (
                <div
                  className={`p-4 rounded-xl border space-y-2 ${
                    isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FAF5EB] border-[#2E4A70]/12'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold tabular-nums">
                    <span className={mutedText}>Progreso respondido</span>
                    <span className={isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}>
                      {Math.round((answeredCount / totalQuestions) * 100)}%
                    </span>
                  </div>
                  <div
                    className={`w-full h-2 rounded-full overflow-hidden ${
                      isDark ? 'bg-[#1e293b]' : 'bg-white'
                    }`}
                  >
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                      style={{ width: `${Math.round((answeredCount / totalQuestions) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-3.5">
                  <h3 className="text-sm font-extrabold">Navegador de Preguntas</h3>
                  <span className={`text-xs font-bold tabular-nums ${mutedText}`}>
                    {answeredCount}/{totalQuestions}
                  </span>
                </div>

                <div className="grid grid-cols-4 xl:grid-cols-5 gap-2 tabular-nums">
                  {examData.questions.map((_, index) => {
                    const isAnswered = isQuestionAnswered(index);
                    const isActive = currentQuestionIndex === index;
                    let buttonClass = isDark
                      ? 'bg-[#162235] border-white/10 text-slate-300 hover:border-white/25'
                      : 'bg-[#FAF5EB] border-[#2E4A70]/15 text-[#2E4A70] hover:border-[#014ba0]/40';
                    if (isActive) {
                      buttonClass = 'bg-[#014ba0] border-[#014ba0] text-white';
                    } else if (isAnswered) {
                      buttonClass = isDark
                        ? 'bg-emerald-500/20 border-emerald-400/35 text-emerald-300 hover:bg-emerald-500/30'
                        : 'bg-emerald-100 border-emerald-300 text-emerald-800 hover:bg-emerald-200/70';
                    }

                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setCurrentQuestionIndex(index)}
                        aria-current={isActive ? 'step' : undefined}
                        className={`w-full aspect-square max-h-11 flex items-center justify-center rounded-xl border text-xs font-extrabold cursor-pointer transition-colors ${buttonClass}`}
                      >
                        {index + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div
                className={`flex flex-wrap items-center gap-x-3 gap-y-2 pt-4 border-t text-[11px] font-semibold ${
                  isDark ? 'border-white/10 text-slate-300' : 'border-[#2E4A70]/10 text-[#2E4A70]'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#014ba0]" />
                  <span>Actual</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                  <span>Respondida</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-sm border ${
                      isDark ? 'bg-[#162235] border-white/20' : 'bg-[#FAF5EB] border-[#2E4A70]/25'
                    }`}
                  />
                  <span>Pendiente</span>
                </span>
              </div>

              <button
                type="button"
                onClick={finalSubmitConfirmation}
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>{submitting ? 'Enviando...' : 'Finalizar Examen'}</span>
              </button>
            </div>
          </aside>
        </div>
      </div>

      {/* Sheet modal de mapa de preguntas para móvil y tablet */}
      {isMobileMapOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] lg:hidden flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-xs"
            onClick={() => setIsMobileMapOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-question-map-title"
          >
            <div
              className={`w-full sm:max-w-md max-h-[85dvh] rounded-t-3xl sm:rounded-2xl border flex flex-col overflow-hidden ${
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
                className={`px-5 py-3.5 border-b flex items-center justify-between gap-3 shrink-0 ${
                  isDark ? 'border-white/10 bg-[#162235]' : 'border-[#2E4A70]/10 bg-[#FAF5EB]'
                }`}
              >
                <div>
                  <h2 id="mobile-question-map-title" className="text-base font-extrabold">
                    Mapa de Preguntas
                  </h2>
                  <p className={`text-xs font-semibold tabular-nums ${mutedText}`}>
                    Respondidas: {answeredCount} de {totalQuestions}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMobileMapOpen(false)}
                  aria-label="Cerrar mapa de preguntas"
                  className={`w-9 h-9 inline-flex items-center justify-center rounded-xl cursor-pointer transition-colors ${
                    isDark
                      ? 'text-slate-300 hover:bg-white/10 hover:text-white'
                      : 'text-[#2E4A70] hover:bg-[#2E4A70]/10'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto overscroll-contain space-y-4">
                <div className="grid grid-cols-5 gap-2.5 tabular-nums">
                  {examData.questions.map((_, index) => {
                    const isAnswered = isQuestionAnswered(index);
                    const isActive = currentQuestionIndex === index;
                    let buttonClass = isDark
                      ? 'bg-[#162235] border-white/10 text-slate-300'
                      : 'bg-[#FAF5EB] border-[#2E4A70]/15 text-[#2E4A70]';
                    if (isActive) {
                      buttonClass = 'bg-[#014ba0] border-[#014ba0] text-white';
                    } else if (isAnswered) {
                      buttonClass = isDark
                        ? 'bg-emerald-500/20 border-emerald-400/35 text-emerald-300'
                        : 'bg-emerald-100 border-emerald-300 text-emerald-800';
                    }

                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => {
                          setCurrentQuestionIndex(index);
                          setIsMobileMapOpen(false);
                        }}
                        aria-current={isActive ? 'step' : undefined}
                        className={`w-full aspect-square flex items-center justify-center rounded-xl border text-sm font-extrabold cursor-pointer transition-colors ${buttonClass}`}
                      >
                        {index + 1}
                      </button>
                    );
                  })}
                </div>

                <div
                  className={`flex flex-wrap items-center gap-4 pt-3 border-t text-xs font-semibold ${
                    isDark ? 'border-white/10 text-slate-300' : 'border-[#2E4A70]/10 text-[#2E4A70]'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-[#014ba0]" />
                    <span>Actual</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-emerald-500" />
                    <span>Respondida</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`w-3 h-3 rounded-sm border ${
                        isDark ? 'bg-[#162235] border-white/20' : 'bg-[#FAF5EB] border-[#2E4A70]/25'
                      }`}
                    />
                    <span>Pendiente</span>
                  </span>
                </div>
              </div>

              <div
                className={`px-5 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] border-t shrink-0 ${
                  isDark ? 'border-white/10 bg-[#162235]' : 'border-[#2E4A70]/10 bg-[#FAF5EB]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMapOpen(false);
                    finalSubmitConfirmation();
                  }}
                  disabled={submitting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer transition-colors disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>{submitting ? 'Enviando...' : 'Finalizar Examen'}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export default function ExamenPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center p-6 bg-[#FFF9F0] text-[#2E4A70]">
          <div className="inline-flex items-center gap-2 font-bold">
            <Loader2 className="w-5 h-5 animate-spin text-[#014ba0]" />
            <span>Cargando examen...</span>
          </div>
        </div>
      }
    >
      <ExamenContent />
    </Suspense>
  );
}
