'use client';

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import {
  getDueFlashcards,
  peekDueFlashcards,
  saveFlashcardProgress,
  getAllFlashcardsBySubtema,
  getWeakFlashcards,
} from '@/lib/flashcardServices';
import { calculateNextReview } from '@/lib/spacedRepetition';
import {
  ArrowLeft,
  CheckCircle2,
  BrainCircuit,
  Info,
  Trophy,
  AlertCircle,
  Flame,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Layers,
  Loader2,
  EyeOff,
  LayoutGrid,
  List,
  X,
  ZoomIn,
  ImageOff,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { formatDriveUrl } from '@/lib/driveUtils';
import { toast } from 'react-hot-toast';
import Swal from 'sweetalert2';

function extractDriveFileId(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const trimmed = rawUrl.trim();
    if (!trimmed.includes('drive.google.com') && !trimmed.includes('googleusercontent.com')) {
      return null;
    }
    const dMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (dMatch?.[1]) return dMatch[1];

    const urlObj = new URL(trimmed);
    const idParam = urlObj.searchParams.get('id');
    if (idParam) return idParam;
  } catch {
    const fallbackMatch = String(rawUrl).match(/(?:\/d\/|[?&]id=)([a-zA-Z0-9_-]+)/);
    if (fallbackMatch?.[1]) return fallbackMatch[1];
  }
  return null;
}

function getDriveImageCandidates(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return [];
  const trimmed = rawUrl.trim();
  const driveId = extractDriveFileId(trimmed);

  if (driveId) {
    const candidates = [
      `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`,
      `https://lh3.googleusercontent.com/d/${driveId}=w1000`,
      `https://drive.google.com/uc?export=view&id=${driveId}`,
    ];
    // Si el admin guardó una URL thumbnail personalizada distinta, conservarla primero
    if (trimmed.includes('drive.google.com/thumbnail') && !candidates.includes(trimmed)) {
      candidates.unshift(trimmed);
    }
    return candidates;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return [trimmed];
  }

  return [];
}

function getAdaptiveTextClass(text = '') {
  const len = String(text || '').length;
  if (len > 220) return 'text-base sm:text-xl leading-relaxed';
  if (len > 100) return 'text-lg sm:text-2xl leading-snug';
  return 'text-xl sm:text-3xl leading-snug';
}

const SM2_RATINGS = [
  { value: 1, emoji: '😭', label: 'Olvido', cls: 'bg-red-500 hover:bg-red-600' },
  { value: 2, emoji: '😠', label: 'Difícil', cls: 'bg-orange-500 hover:bg-orange-600' },
  { value: 3, emoji: '😐', label: 'Normal', cls: 'bg-slate-600 hover:bg-slate-700' },
  { value: 4, emoji: '🙂', label: 'Fácil', cls: 'bg-emerald-600 hover:bg-emerald-700' },
  { value: 5, emoji: '🤩', label: 'Perfecto', cls: 'bg-[#014ba0] hover:bg-[#013b80]' },
];

function DeckBrowserContent({
  cards,
  currentIndex,
  onJump,
  deckLayout,
  setDeckLayout,
  deckFilter,
  setDeckFilter,
  isDark,
}) {
  const activeItemRef = useRef(null);

  const visibleEntries = useMemo(() => {
    return cards
      .map((card, idx) => ({ card, idx }))
      .filter(({ card }) => (deckFilter === 'pending' ? !card.isRated : true));
  }, [cards, deckFilter]);

  const ratedCount = useMemo(() => cards.filter((c) => c.isRated).length, [cards]);

  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentIndex, deckLayout]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Controles del Mazo: Filtro + Vista */}
      <div
        className={`flex items-center justify-between gap-2 pb-3 mb-3 border-b shrink-0 ${
          isDark ? 'border-white/10' : 'border-[#2E4A70]/15'
        }`}
      >
        <div
          className={`inline-flex rounded-xl p-1 text-xs font-bold border ${
            isDark
              ? 'bg-white/10 border-white/10'
              : 'bg-[#F0F2F2] border-[#2E4A70]/15'
          }`}
        >
          <button
            type="button"
            onClick={() => setDeckFilter('all')}
            className={`px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
              deckFilter === 'all'
                ? isDark
                  ? 'bg-[#24B0BA] text-white shadow-xs'
                  : 'bg-[#014ba0] text-white shadow-xs'
                : isDark
                ? 'text-blue-100 hover:text-white'
                : 'text-[#1a2639] hover:text-[#014ba0]'
            }`}
          >
            Todas ({cards.length})
          </button>
          <button
            type="button"
            onClick={() => setDeckFilter('pending')}
            className={`px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
              deckFilter === 'pending'
                ? isDark
                  ? 'bg-[#24B0BA] text-white shadow-xs'
                  : 'bg-[#014ba0] text-white shadow-xs'
                : isDark
                ? 'text-blue-100 hover:text-white'
                : 'text-[#1a2639] hover:text-[#014ba0]'
            }`}
          >
            Pend. ({cards.length - ratedCount})
          </button>
        </div>

        <div
          className={`inline-flex rounded-xl p-1 border ${
            isDark
              ? 'bg-white/10 border-white/10'
              : 'bg-[#F0F2F2] border-[#2E4A70]/15'
          }`}
        >
          <button
            type="button"
            onClick={() => setDeckLayout('grid')}
            title="Vista en cuadrícula numérica"
            aria-label="Vista en cuadrícula numérica"
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              deckLayout === 'grid'
                ? isDark
                  ? 'bg-[#2E4A70] text-white shadow-xs'
                  : 'bg-white text-[#014ba0] shadow-xs'
                : isDark
                ? 'text-blue-200 hover:text-white'
                : 'text-[#2E4A70] hover:text-[#014ba0]'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setDeckLayout('list')}
            title="Vista en lista compacta"
            aria-label="Vista en lista compacta"
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              deckLayout === 'list'
                ? isDark
                  ? 'bg-[#2E4A70] text-white shadow-xs'
                  : 'bg-white text-[#014ba0] shadow-xs'
                : isDark
                ? 'text-blue-200 hover:text-white'
                : 'text-[#2E4A70] hover:text-[#014ba0]'
            }`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Lista o Cuadrícula con scroll contenido */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
        {visibleEntries.length === 0 ? (
          <div className="py-8 text-center text-xs font-semibold opacity-75">
            No quedan tarjetas pendientes en este filtro.
          </div>
        ) : deckLayout === 'grid' ? (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 py-0.5">
            {visibleEntries.map(({ card, idx }) => {
              const isActive = idx === currentIndex;
              return (
                <button
                  key={card.id || idx}
                  ref={isActive ? activeItemRef : null}
                  type="button"
                  onClick={() => onJump(idx)}
                  title={`Tarjeta ${idx + 1}: ${(card.pregunta || '').slice(0, 60)}`}
                  className={`relative h-11 sm:h-10 rounded-xl font-extrabold text-xs transition-all flex items-center justify-center border cursor-pointer ${
                    isActive
                      ? 'bg-[#014ba0] border-[#014ba0] text-white shadow-md ring-2 ring-[#24B0BA]/50'
                      : card.isRated
                      ? isDark
                        ? 'bg-emerald-900/35 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/55'
                        : 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                      : isDark
                      ? 'bg-white/5 border-white/15 text-gray-100 hover:bg-white/10'
                      : 'bg-[#FFF9F0] border-[#2E4A70]/25 text-[#1a2639] hover:border-[#014ba0]'
                  }`}
                >
                  <span>{idx + 1}</span>
                  {card.isRated && !isActive && (
                    <span
                      className={`absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 ${
                        isDark ? 'border-[#1e293b]' : 'border-white'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5 py-0.5">
            {visibleEntries.map(({ card, idx }) => {
              const isActive = idx === currentIndex;
              return (
                <button
                  key={card.id || idx}
                  ref={isActive ? activeItemRef : null}
                  type="button"
                  onClick={() => onJump(idx)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors flex items-center justify-between gap-2.5 cursor-pointer ${
                    isActive
                      ? 'bg-[#014ba0] border-[#014ba0] text-white shadow-sm'
                      : isDark
                      ? 'bg-white/5 border-transparent hover:border-white/15 text-gray-100'
                      : 'bg-[#FFF9F0] border-[#2E4A70]/15 hover:border-[#014ba0]/40 text-[#1a2639]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`text-[11px] font-black w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                        isActive
                          ? 'bg-white text-[#014ba0]'
                          : isDark
                          ? 'bg-white/10 text-blue-200'
                          : 'bg-[#014ba0]/12 text-[#014ba0]'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span className="text-xs font-semibold truncate">
                      {card.pregunta || `Tarjeta ${idx + 1}`}
                    </span>
                  </div>
                  {card.isRated && (
                    <CheckCircle2
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-white' : 'text-emerald-600'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pie informativo con alto contraste */}
      <div
        className={`pt-3 mt-3 border-t flex items-center justify-between text-xs font-bold shrink-0 ${
          isDark ? 'border-white/10' : 'border-[#2E4A70]/15'
        }`}
      >
        <span className={isDark ? 'text-blue-100' : 'text-[#1a2639]'}>
          Completadas:{' '}
          <span className={isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}>
            {ratedCount}/{cards.length}
          </span>
        </span>
        <div
          className={`hidden xl:flex items-center gap-1 text-[10px] font-semibold ${
            isDark ? 'text-blue-200/75' : 'text-[#2E4A70]'
          }`}
        >
          <kbd
            className={`px-1.5 py-0.5 rounded ${
              isDark ? 'bg-white/10 text-blue-100' : 'bg-[#F0F2F2] text-[#1a2639] border border-[#2E4A70]/15'
            }`}
          >
            ←
          </kbd>
          <kbd
            className={`px-1.5 py-0.5 rounded ${
              isDark ? 'bg-white/10 text-blue-100' : 'bg-[#F0F2F2] text-[#1a2639] border border-[#2E4A70]/15'
            }`}
          >
            Space
          </kbd>
          <kbd
            className={`px-1.5 py-0.5 rounded ${
              isDark ? 'bg-white/10 text-blue-100' : 'bg-[#F0F2F2] text-[#1a2639] border border-[#2E4A70]/15'
            }`}
          >
            →
          </kbd>
        </div>
      </div>
    </div>
  );
}

function FlashcardContent() {
  const { user, loading: authLoading } = useAuth();
  const { isDark, isLoaded: themeLoaded } = useTheme();
  const searchParams = useSearchParams();
  const router = useRouter();
  const subtema = searchParams.get('subtema');
  const studyMode = searchParams.get('mode');

  const initialPeekRef = useRef(undefined);
  if (initialPeekRef.current === undefined) {
    initialPeekRef.current =
      typeof window !== 'undefined' &&
      !authLoading &&
      user?.uid &&
      subtema &&
      studyMode !== 'review_weakness'
        ? peekDueFlashcards(user.uid, subtema)
        : null;
  }

  const [cards, setCards] = useState(() => initialPeekRef.current ?? []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [loading, setLoading] = useState(() => initialPeekRef.current === null);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [isIntensiveMode, setIsIntensiveMode] = useState(false);

  // Controles de Mazo responsivo (Cuadrícula compacta por defecto cuando hay varias cartas)
  const [deckLayout, setDeckLayout] = useState(() =>
    (initialPeekRef.current?.length || 0) > 8 ? 'grid' : 'list'
  );
  const [deckFilter, setDeckFilter] = useState('all');
  const [mobileDeckOpen, setMobileDeckOpen] = useState(false);

  // Manejo resiliente de imágenes de Google Drive + zoom
  const [imgAttemptIndex, setImgAttemptIndex] = useState(0);
  const [zoomedImageUrl, setZoomedImageUrl] = useState(null);

  useEffect(() => {
    setImgAttemptIndex(0);
    setZoomedImageUrl(null);
  }, [currentIndex, cards]);

  const currentCard = cards[currentIndex];
  const driveFileId = useMemo(
    () => extractDriveFileId(currentCard?.driveUrl),
    [currentCard?.driveUrl]
  );
  const nextImageDriveSrc = useMemo(() => {
    if (!driveFileId) return null;
    const formatted = formatDriveUrl(currentCard?.driveUrl);
    if (formatted && (formatted.includes('drive.google.com') || formatted.includes('googleusercontent.com'))) {
      return formatted;
    }
    return `https://drive.google.com/uc?export=view&id=${driveFileId}`;
  }, [driveFileId, currentCard?.driveUrl]);

  const cardImageCandidates = useMemo(
    () => getDriveImageCandidates(currentCard?.driveUrl),
    [currentCard?.driveUrl]
  );

  const renderClozeQuestion = (text) => {
    if (!text) return null;
    const parts = text.split(/(\[.*?\])/g);
    const textCls = getAdaptiveTextClass(text);
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-3 text-center max-w-3xl mx-auto px-1">
        {parts.map((part, index) => {
          if (part.startsWith('[') && part.endsWith(']')) {
            return (
              <span
                key={index}
                className={`inline-block w-20 sm:w-24 h-7 border-b-2 mx-1 align-middle ${
                  isDark
                    ? 'border-[#24B0BA] bg-white/10'
                    : 'border-[#014ba0] bg-[#014ba0]/5'
                }`}
              />
            );
          }
          return (
            <span key={index} className={`${textCls} font-extrabold`}>
              {part}
            </span>
          );
        })}
      </div>
    );
  };

  const renderClozeAnswer = (text) => {
    if (!text) return null;
    const parts = text.split(/(\[.*?\])/g);
    const textCls = getAdaptiveTextClass(text);
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3 text-center max-w-3xl mx-auto">
        {parts.map((part, index) => {
          if (part.startsWith('[') && part.endsWith(']')) {
            const word = part.substring(1, part.length - 1);
            return (
              <span
                key={index}
                className={`${textCls} font-black px-3 py-1 rounded-xl border ${
                  isDark
                    ? 'text-[#24B0BA] bg-[#24B0BA]/15 border-[#24B0BA]/40'
                    : 'text-[#014ba0] bg-[#014ba0]/10 border-[#014ba0]/25'
                }`}
              >
                {word}
              </span>
            );
          }
          return (
            <span key={index} className={`${textCls} font-bold opacity-90`}>
              {part}
            </span>
          );
        })}
      </div>
    );
  };

  useEffect(() => {
    if (!authLoading && user?.uid && (subtema || studyMode === 'review_weakness')) {
      if (initialPeekRef.current !== null) {
        initialPeekRef.current = null;
        return;
      }
      loadCards();
    }
  }, [authLoading, user?.uid, subtema, studyMode]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (zoomedImageUrl) {
          setZoomedImageUrl(null);
          return;
        }
        if (mobileDeckOpen) {
          setMobileDeckOpen(false);
          return;
        }
      }
      if (sessionFinished || cards.length === 0 || loading || mobileDeckOpen || zoomedImageUrl) return;

      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        setIsFlipped((prev) => !prev);
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (isFlipped && ['1', '2', '3', '4', '5'].includes(e.key)) {
        handleRate(parseInt(e.key, 10));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFlipped, sessionFinished, cards.length, loading, currentIndex, mobileDeckOpen, zoomedImageUrl]);

  const loadCards = async (forceAll = false, { bypassPeek = false } = {}) => {
    if (!forceAll && !bypassPeek && studyMode !== 'review_weakness' && subtema && user?.uid) {
      const cachedDue = peekDueFlashcards(user.uid, subtema);
      if (cachedDue !== null) {
        setSessionFinished(false);
        setIsFlipped(false);
        setCurrentIndex(0);
        setCards(cachedDue);
        setDeckLayout(cachedDue.length > 8 ? 'grid' : 'list');
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setSessionFinished(false);
    setIsFlipped(false);
    setCurrentIndex(0);
    try {
      let fetchedCards = [];
      if (studyMode === 'review_weakness') {
        fetchedCards = await getWeakFlashcards(user.uid);
      } else {
        fetchedCards = forceAll
          ? await getAllFlashcardsBySubtema(user.uid, subtema)
          : await getDueFlashcards(user.uid, subtema);
      }
      setCards(fetchedCards);
      setDeckLayout(fetchedCards.length > 8 ? 'grid' : 'list');
      if (forceAll) setIsIntensiveMode(true);
    } catch (error) {
      console.error('Error loading cards:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFlip = () => {
    if (typeof window !== 'undefined' && window.getSelection()?.toString()) {
      return;
    }
    setIsFlipped((prev) => !prev);
  };

  const handleNext = (bypassRatedCheck = false) => {
    if (!bypassRatedCheck && isFlipped && !cards[currentIndex]?.isRated) {
      return;
    }
    if (currentIndex < cards.length - 1) {
      setIsFlipped(false);
      setTimeout(() => setCurrentIndex((prev) => prev + 1), 100);
    } else {
      setSessionFinished(true);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setIsFlipped(false);
      setTimeout(() => setCurrentIndex((prev) => prev - 1), 100);
    }
  };

  const handleJumpTo = (index) => {
    setIsFlipped(false);
    setCurrentIndex(index);
    setMobileDeckOpen(false);
  };

  const handleRate = (rating) => {
    const activeIndex = currentIndex;
    const card = cards[activeIndex];
    if (!card) return;

    const prevProgress = card.userProgress || {};
    const nextReviewData = calculateNextReview(
      rating,
      prevProgress.easiness,
      prevProgress.interval,
      prevProgress.repetitions
    );

    setCards((prev) =>
      prev.map((c, idx) =>
        idx === activeIndex ? { ...c, isRated: true, userProgress: nextReviewData } : c
      )
    );

    if (rating === 1) {
      setIsFlipped(false);
    } else {
      handleNext(true);
    }

    const resolvedSubtema =
      subtema || card.subtema || card.userProgress?.subtemaName || 'General';

    saveFlashcardProgress(user.uid, card.id, nextReviewData, resolvedSubtema, rating).catch((err) => {
      console.error('Error saving progress:', err);
      toast.error('No se pudo guardar tu progreso. Revisa tu conexión.');
    });
  };

  const handleMarkAsMastered = async () => {
    if (!cards[currentIndex]) return;
    const activeIndex = currentIndex;
    const card = cards[activeIndex];

    const result = await Swal.fire({
      title: '¿Dominas este concepto?',
      text: "Esta tarjeta se archivará y no aparecerá en tus sesiones diarias. Podrás restaurarla luego desde el panel principal con el botón 'Restaurar'.",
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#014ba0',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Sí, ya la domino',
      cancelButtonText: 'Cancelar',
      background: isDark ? '#1a2639' : '#fff',
      color: isDark ? '#fff' : '#1a2639',
    });

    if (result.isConfirmed) {
      const prevProgress = card.userProgress || {};
      const nextReviewData = calculateNextReview(
        5,
        prevProgress.easiness,
        prevProgress.interval,
        prevProgress.repetitions
      );
      const resolvedSubtema =
        subtema || card.subtema || card.userProgress?.subtemaName || 'General';

      setCards((prev) =>
        prev.map((c, idx) =>
          idx === activeIndex ? { ...c, isRated: true, userProgress: nextReviewData } : c
        )
      );
      toast.success('¡Dominio registrado!', {
        icon: '🏆',
        style: { borderRadius: '14px', background: '#014ba0', color: '#fff', fontWeight: 'bold' },
      });
      handleNext(true);

      saveFlashcardProgress(user.uid, card.id, nextReviewData, resolvedSubtema, 5, true).catch(
        (err) => {
          console.error('Error marking as mastered:', err);
          toast.error('Error al guardar dominio.');
        }
      );
    }
  };

  if (authLoading || !themeLoaded || (loading && cards.length === 0 && !sessionFinished)) {
    return (
      <div
        className={`flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <div className="relative">
          <div className="w-16 h-16 border-4 border-[#014ba0]/20 border-t-[#014ba0] rounded-full animate-spin" />
          <BrainCircuit
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 ${
              isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
            }`}
          />
        </div>
        <p className="mt-4 text-xs font-extrabold uppercase tracking-[0.2em] opacity-60">
          Preparando sesión
        </p>
      </div>
    );
  }

  if (user && !user.hasPagoUnicoAccess) {
    router.replace('/app/flashcards');
    return null;
  }

  if (!subtema && studyMode !== 'review_weakness') {
    return (
      <div
        className={`flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] p-6 text-center ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <AlertCircle className="w-14 h-14 text-red-500 mb-4" />
        <h1 className="text-2xl font-black mb-2">Tema no especificado</h1>
        <p className="text-sm opacity-70 mb-6">Selecciona un subtema válido desde el panel de tarjetas.</p>
        <Link
          href="/app/flashcards"
          className="px-6 py-3 bg-[#014ba0] text-white rounded-xl font-bold shadow-md"
        >
          Volver al panel
        </Link>
      </div>
    );
  }

  if (sessionFinished) {
    return (
      <div
        className={`flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] p-6 text-center ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <div className="w-20 h-20 rounded-3xl bg-emerald-500/15 flex items-center justify-center mb-6">
          <Trophy className="w-11 h-11 text-emerald-500" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-black mb-3 tracking-tight">¡Objetivo logrado!</h1>
        <p className="text-base sm:text-lg opacity-75 max-w-md mb-8 font-medium">
          Has completado el repaso de{' '}
          <span className={`font-bold ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}>
            {studyMode === 'review_weakness' ? 'Tus Tarjetas Críticas' : subtema}
          </span>
          .
        </p>
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md justify-center">
          <button
            type="button"
            onClick={() => router.push('/app/flashcards')}
            className="px-6 py-3.5 bg-[#014ba0] hover:bg-[#013b80] text-white rounded-xl font-bold shadow-md transition-colors cursor-pointer"
          >
            Elegir otro tema
          </button>
          <button
            type="button"
            onClick={() => {
              setSessionFinished(false);
              setCurrentIndex(0);
              loadCards(isIntensiveMode, { bypassPeek: true });
            }}
            className={`px-6 py-3.5 rounded-xl font-bold border transition-colors cursor-pointer ${
              isDark
                ? 'border-white/15 bg-white/5 hover:bg-white/10'
                : 'border-[#2E4A70]/20 bg-white hover:bg-gray-50 shadow-xs'
            }`}
          >
            Repasar de nuevo
          </button>
        </div>
      </div>
    );
  }

  if (cards.length === 0 && !loading) {
    return (
      <div
        className={`flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] p-6 text-center ${
          isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'
        }`}
      >
        <CheckCircle2
          className={`w-14 h-14 mb-5 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}
        />
        <h1 className="text-3xl font-black mb-2">¡Todo al día!</h1>
        <p className="text-base opacity-70 max-w-md mb-8">
          No tienes tarjetas pendientes por revisar en este tema.
        </p>
        <div className="flex flex-col gap-3 w-full max-w-xs mx-auto">
          <Link
            href="/app/flashcards"
            className="w-full px-6 py-3.5 bg-[#014ba0] hover:bg-[#013b80] text-white rounded-xl font-bold text-center shadow-md"
          >
            Volver al Dashboard
          </Link>
          <button
            type="button"
            onClick={() => loadCards(true)}
            className={`w-full px-6 py-3 rounded-xl font-bold border flex items-center justify-center gap-2 cursor-pointer ${
              isDark
                ? 'border-white/15 text-gray-200 hover:bg-white/5'
                : 'border-[#2E4A70]/20 bg-white text-[#2E4A70] hover:bg-gray-50'
            }`}
          >
            <Flame className="w-4 h-4 text-orange-500" />
            <span>Modo estudio intensivo</span>
          </button>
        </div>
      </div>
    );
  }

  const isClozeType =
    currentCard?.tipo?.toLowerCase() === 'completar espacios' ||
    (currentCard?.pregunta?.includes('[') && currentCard?.pregunta?.includes(']'));

  const progress = ((currentIndex + 1) / cards.length) * 100;
  // Si es Drive, intento 0 usa Next <Image> (como admin/flashcards/new); intentos >= 1 usan <img> fallback
  const useNextImagePrimary = Boolean(nextImageDriveSrc) && imgAttemptIndex === 0;
  const fallbackIdx = nextImageDriveSrc ? imgAttemptIndex - 1 : imgAttemptIndex;
  const cardImageUrl = useNextImagePrimary
    ? nextImageDriveSrc
    : cardImageCandidates[fallbackIdx] || null;
  const allImageCandidatesFailed =
    (Boolean(nextImageDriveSrc) || cardImageCandidates.length > 0) &&
    !useNextImagePrimary &&
    fallbackIdx >= cardImageCandidates.length;
  const titleText = studyMode === 'review_weakness' ? 'Tarjetas Críticas' : subtema;

  return (
    <div
      className={`min-h-[calc(100vh-4rem)] transition-colors ${
        isDark ? 'bg-[#1a2639] text-[#FFF9F0]' : 'bg-[#FFF9F0] text-[#1a2639]'
      }`}
    >
      <div className="max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col gap-4">
        {/* Barra Superior Compacta */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/app/flashcards"
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors shrink-0 ${
                isDark
                  ? 'bg-white/5 border-white/10 text-blue-100 hover:bg-white/10'
                  : 'bg-white border-[#2E4A70]/15 text-[#2E4A70] hover:bg-gray-50 shadow-xs'
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Temas</span>
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-extrabold tracking-tight truncate">
                {titleText}
              </h1>
              <p
                className={`text-xs font-medium truncate ${
                  isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                }`}
              >
                {studyMode === 'review_weakness'
                  ? 'Refuerzo de conceptos críticos'
                  : 'Sesión activa de repetición espaciada'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold tabular-nums border ${
                isDark
                  ? 'bg-[#2E4A70]/60 border-white/10 text-white'
                  : 'bg-white border-[#014ba0]/15 text-[#014ba0] shadow-xs'
              }`}
            >
              {currentIndex + 1} / {cards.length}
            </span>

            {/* Botón para abrir el mazo en móvil/tablet */}
            <button
              type="button"
              onClick={() => setMobileDeckOpen(true)}
              className="lg:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#014ba0] hover:bg-[#013b80] text-white text-xs font-bold shadow-xs cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Mazo ({cards.length})</span>
            </button>
          </div>
        </header>

        {/* Grid Principal: Tarjeta + Mazo acotado */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
          {/* Columna de Estudio (9 cols en desktop) */}
          <div className="lg:col-span-9 flex flex-col gap-3">
            {/* Barra de Progreso */}
            <div
              className={`w-full h-2 rounded-full overflow-hidden ${
                isDark ? 'bg-white/10' : 'bg-[#2E4A70]/10'
              }`}
            >
              <div
                className="h-full bg-gradient-to-r from-[#014ba0] to-[#24B0BA] rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Escenario de Tarjeta 3D con altura explícita cómoda en móvil y desktop */}
            <div
              className="relative w-full h-[390px] sm:h-[500px]"
              style={{ perspective: '1600px' }}
            >
              <div
                className="relative w-full h-full"
                style={{
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.65s cubic-bezier(0.22, 1, 0.36, 1)',
                  transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                }}
              >
                {/* Cara Frontal */}
                <div
                  onClick={handleFlip}
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'rotateY(0deg)',
                    pointerEvents: isFlipped ? 'none' : 'auto',
                    zIndex: isFlipped ? 0 : 2,
                  }}
                  className={`absolute inset-0 w-full h-full rounded-3xl border shadow-xl flex flex-col cursor-pointer overflow-hidden ${
                    isDark
                      ? 'bg-[#1e293b] border-white/10 text-white'
                      : 'bg-white border-[#2E4A70]/15 text-[#1a2639]'
                  }`}
                >
                  {/* Encabezado fijo de la tarjeta */}
                  <div className="flex items-center justify-between px-4 sm:px-6 pt-4 pb-2 shrink-0">
                    <div
                      className={`flex items-center gap-2 ${
                        isDark ? 'text-blue-200' : 'text-[#2E4A70]'
                      }`}
                    >
                      <BrainCircuit
                        className={`w-4 h-4 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}
                      />
                      <span className="text-[11px] font-extrabold uppercase tracking-wider">
                        Pregunta #{currentIndex + 1}
                      </span>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${
                        isDark
                          ? 'bg-[#24B0BA]/15 border-[#24B0BA]/30 text-[#24B0BA]'
                          : 'bg-[#014ba0]/10 border-[#014ba0]/20 text-[#014ba0]'
                      }`}
                    >
                      {currentCard?.tipo || (isClozeType ? 'Completar Espacios' : 'Pregunta')}
                    </span>
                  </div>

                  {/* Cuerpo desplazable de la pregunta (my-auto centra sin recortar contenido alto con imagen) */}
                  <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-10 py-4 custom-scrollbar flex flex-col items-center">
                    <div className="w-full max-w-3xl my-auto text-center">
                      {isClozeType ? (
                        renderClozeQuestion(currentCard?.pregunta)
                      ) : (
                        <h2
                          className={`${getAdaptiveTextClass(
                            currentCard?.pregunta
                          )} font-extrabold tracking-tight text-center break-words whitespace-pre-wrap`}
                        >
                          {currentCard?.pregunta}
                        </h2>
                      )}

                      {(nextImageDriveSrc || cardImageCandidates.length > 0) && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            if (cardImageUrl && !allImageCandidatesFailed) {
                              setZoomedImageUrl({ url: cardImageUrl, isNextImage: useNextImagePrimary });
                            }
                          }}
                          className={`mt-4 relative flex flex-col items-center justify-center rounded-2xl p-2.5 sm:p-3 border cursor-zoom-in ${
                            isDark
                              ? 'bg-black/25 border-white/10 hover:border-[#24B0BA]/60'
                              : 'bg-[#F0F2F2] border-[#2E4A70]/15 hover:border-[#014ba0]/50'
                          }`}
                        >
                          {allImageCandidatesFailed ? (
                            <div className="py-4 flex flex-col items-center gap-1.5 text-xs opacity-70 cursor-default">
                              <ImageOff className="w-6 h-6" />
                              <span>No se pudo cargar la imagen de Drive. Verifica los permisos del enlace.</span>
                            </div>
                          ) : (
                            <>
                              {useNextImagePrimary ? (
                                <Image
                                  key={cardImageUrl}
                                  src={cardImageUrl}
                                  alt="Imagen de referencia médica"
                                  width={600}
                                  height={400}
                                  onError={() => setImgAttemptIndex((prev) => prev + 1)}
                                  className="max-h-40 sm:max-h-56 w-auto max-w-full object-contain mx-auto rounded-lg"
                                />
                              ) : (
                                <img
                                  key={cardImageUrl}
                                  src={cardImageUrl}
                                  alt="Imagen de referencia médica"
                                  referrerPolicy="no-referrer"
                                  onError={() => setImgAttemptIndex((prev) => prev + 1)}
                                  className="max-h-40 sm:max-h-56 w-auto max-w-full object-contain mx-auto rounded-lg"
                                />
                              )}
                              <span
                                className={`mt-2 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isDark
                                    ? 'bg-white/10 text-blue-200'
                                    : 'bg-white text-[#2E4A70] border border-[#2E4A70]/10'
                                }`}
                              >
                                <ZoomIn className="w-3 h-3" />
                                <span>Toca la imagen para ampliar</span>
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Pie fijo para voltear */}
                  <div
                    className={`px-4 py-3 border-t text-center shrink-0 ${
                      isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
                    }`}
                  >
                    <span
                      className={`inline-flex items-center gap-2 font-bold text-xs ${
                        isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                      }`}
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>Toca para ver la respuesta</span>
                    </span>
                  </div>
                </div>

                {/* Cara Trasera */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                    pointerEvents: isFlipped ? 'auto' : 'none',
                    zIndex: isFlipped ? 2 : 0,
                  }}
                  className={`absolute inset-0 w-full h-full rounded-3xl border shadow-xl flex flex-col overflow-hidden ${
                    isDark
                      ? 'bg-[#1e293b] border-[#24B0BA]/30 text-white'
                      : 'bg-white border-[#014ba0]/25 text-[#1a2639]'
                  }`}
                >
                  {/* Encabezado fijo de respuesta */}
                  <div className="flex items-center justify-between px-4 sm:px-6 pt-4 pb-2 shrink-0">
                    <div
                      className={`flex items-center gap-2 ${
                        isDark ? 'text-emerald-400' : 'text-emerald-700'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="text-[11px] font-extrabold uppercase tracking-wider">
                        Respuesta y Validación
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMarkAsMastered();
                      }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold transition-colors cursor-pointer ${
                        isDark
                          ? 'bg-white/5 border-white/10 text-blue-200 hover:bg-white/10'
                          : 'bg-[#FFF9F0] border-[#2E4A70]/20 text-[#1a2639] hover:border-[#014ba0]'
                      }`}
                    >
                      <EyeOff
                        className={`w-3.5 h-3.5 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}
                      />
                      <span>Ya domino esto</span>
                    </button>
                  </div>

                  {/* Contenido desplazable de respuesta + explicación */}
                  <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-3 custom-scrollbar space-y-4">
                    {isClozeType ? (
                      <div
                        className={`p-4 sm:p-6 rounded-2xl border ${
                          isDark
                            ? 'bg-[#014ba0]/15 border-[#24B0BA]/25'
                            : 'bg-[#FFF9F0] border-[#014ba0]/15'
                        }`}
                      >
                        <span
                          className={`text-[10px] font-extrabold uppercase tracking-widest mb-3 block text-center ${
                            isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                          }`}
                        >
                          Texto Completado
                        </span>
                        {renderClozeAnswer(currentCard?.pregunta)}
                      </div>
                    ) : (
                      <div
                        className={`p-4 sm:p-6 rounded-2xl border flex flex-col items-center justify-center text-center ${
                          isDark
                            ? 'bg-[#014ba0]/15 border-[#24B0BA]/25'
                            : 'bg-[#FFF9F0] border-[#014ba0]/15'
                        }`}
                      >
                        <span
                          className={`text-[10px] font-extrabold uppercase tracking-widest mb-2 block ${
                            isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                          }`}
                        >
                          Respuesta Correcta
                        </span>
                        <p
                          className={`${getAdaptiveTextClass(
                            currentCard?.respuesta
                          )} font-extrabold whitespace-pre-wrap break-words text-center w-full`}
                        >
                          {currentCard?.respuesta}
                        </p>
                      </div>
                    )}

                    {currentCard?.explicacion && (
                      <div
                        className={`p-4 sm:p-5 rounded-2xl border flex gap-3.5 ${
                          isDark
                            ? 'bg-black/20 border-white/10 text-gray-200'
                            : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}
                      >
                        <div
                          className={`p-2 rounded-xl h-fit shrink-0 ${
                            isDark ? 'bg-[#24B0BA]/15' : 'bg-[#014ba0]/10'
                          }`}
                        >
                          <Info
                            className={`w-4 h-4 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}
                          />
                        </div>
                        <div className="min-w-0">
                          <span
                            className={`block font-extrabold text-[10px] uppercase tracking-widest mb-1 ${
                              isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                            }`}
                          >
                            Explicación técnica
                          </span>
                          <p className="text-sm sm:text-base leading-relaxed whitespace-pre-wrap break-words">
                            {currentCard.explicacion}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Botonera SM-2 fija al pie de la cara trasera */}
                  <div
                    className={`px-3 sm:px-6 py-3 border-t shrink-0 bg-inherit ${
                      isDark ? 'border-white/10' : 'border-[#2E4A70]/10'
                    }`}
                  >
                    <div className="grid grid-cols-5 gap-1.5 sm:gap-2.5">
                      {SM2_RATINGS.map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRate(item.value);
                          }}
                          className={`flex flex-col items-center justify-center gap-1 py-2 sm:py-2.5 px-1 rounded-xl sm:rounded-2xl text-white transition-transform active:scale-95 shadow-sm cursor-pointer ${item.cls}`}
                        >
                          <span className="text-lg sm:text-xl leading-none">{item.emoji}</span>
                          <span className="text-[10px] sm:text-xs font-extrabold tracking-tight">
                            {item.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Controles Anterior / Voltear / Siguiente */}
            <div className="flex items-center justify-between gap-2.5 sm:gap-4 pt-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrev();
                }}
                disabled={currentIndex === 0}
                className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-3 rounded-xl font-bold text-xs sm:text-sm border transition-colors ${
                  currentIndex === 0
                    ? isDark
                      ? 'opacity-35 cursor-not-allowed border-transparent bg-white/5 text-gray-400'
                      : 'opacity-45 cursor-not-allowed border-[#2E4A70]/10 bg-[#F0F2F2] text-[#2E4A70]'
                    : isDark
                    ? 'bg-[#2E4A70] border-white/10 text-white hover:bg-[#365783] cursor-pointer'
                    : 'bg-white border-[#2E4A70]/20 text-[#1a2639] hover:bg-gray-50 shadow-xs cursor-pointer'
                }`}
              >
                <ChevronLeft className="w-4 h-4 shrink-0" />
                <span>Anterior</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleFlip();
                }}
                aria-label="Voltear tarjeta"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#014ba0] hover:bg-[#013b80] text-white rounded-xl font-bold text-xs sm:text-sm shadow-md active:scale-95 transition-all cursor-pointer"
              >
                <RotateCw className="w-4 h-4" />
                <span className="hidden sm:inline">Voltear</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNext();
                }}
                disabled={isFlipped && !currentCard?.isRated}
                className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-3 rounded-xl font-bold text-xs sm:text-sm border transition-colors ${
                  isFlipped && !currentCard?.isRated
                    ? isDark
                      ? 'opacity-35 cursor-not-allowed border-transparent bg-white/5 text-gray-400'
                      : 'opacity-45 cursor-not-allowed border-[#2E4A70]/10 bg-[#F0F2F2] text-[#2E4A70]'
                    : isDark
                    ? 'bg-[#2E4A70] border-white/10 text-[#24B0BA] hover:bg-[#365783] cursor-pointer'
                    : 'bg-white border-[#014ba0]/25 text-[#014ba0] hover:bg-blue-50/50 shadow-xs cursor-pointer'
                }`}
              >
                <span>Siguiente</span>
                <ChevronRight className="w-4 h-4 shrink-0" />
              </button>
            </div>
          </div>

          {/* Selector Lateral Desktop (Altura estrictamente acotada y con scroll interno) */}
          <aside className="lg:col-span-3 hidden lg:block">
            <div
              className={`p-4 rounded-3xl border shadow-lg h-[548px] max-h-[calc(100vh-9rem)] flex flex-col overflow-hidden ${
                isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <Layers
                    className={`w-4 h-4 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}
                  />
                  <h2
                    className={`font-extrabold text-xs uppercase tracking-wider ${
                      isDark ? 'text-white' : 'text-[#1a2639]'
                    }`}
                  >
                    Mazo de Cartas
                  </h2>
                </div>
                <span
                  className={`text-[11px] font-extrabold px-2 py-0.5 rounded-lg ${
                    isDark
                      ? 'bg-[#24B0BA]/20 text-[#24B0BA]'
                      : 'bg-[#014ba0]/10 text-[#014ba0]'
                  }`}
                >
                  #{currentIndex + 1}
                </span>
              </div>

              <DeckBrowserContent
                cards={cards}
                currentIndex={currentIndex}
                onJump={handleJumpTo}
                deckLayout={deckLayout}
                setDeckLayout={setDeckLayout}
                deckFilter={deckFilter}
                setDeckFilter={setDeckFilter}
                isDark={isDark}
              />
            </div>
          </aside>
        </div>
      </div>

      {/* Drawer Móvil/Tablet para navegar el Mazo de 20, 30+ cartas sin scroll infinito */}
      {mobileDeckOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mazo de Cartas"
          className="fixed inset-0 z-50 lg:hidden bg-black/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setMobileDeckOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            className={`w-full sm:max-w-md h-[78dvh] rounded-t-3xl sm:rounded-3xl p-4 sm:p-5 flex flex-col shadow-2xl border ${
              isDark
                ? 'bg-[#1e293b] border-white/15 text-white'
                : 'bg-white border-[#2E4A70]/15 text-[#1a2639]'
            }`}
          >
            <div
              className={`flex items-center justify-between pb-3 mb-3 border-b shrink-0 ${
                isDark ? 'border-white/10' : 'border-[#2E4A70]/15'
              }`}
            >
              <div className="flex items-center gap-2">
                <Layers
                  className={`w-4 h-4 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}
                />
                <h2 className="font-extrabold text-sm">
                  Mazo de Cartas ({cards.length})
                </h2>
                <span
                  className={`text-[11px] font-extrabold px-2 py-0.5 rounded-lg ${
                    isDark
                      ? 'bg-[#24B0BA]/20 text-[#24B0BA]'
                      : 'bg-[#014ba0]/10 text-[#014ba0]'
                  }`}
                >
                  #{currentIndex + 1}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileDeckOpen(false)}
                aria-label="Cerrar mazo"
                className={`p-1.5 rounded-lg cursor-pointer ${
                  isDark
                    ? 'text-blue-200 hover:bg-white/10'
                    : 'text-[#1a2639] hover:bg-black/5'
                }`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <DeckBrowserContent
              cards={cards}
              currentIndex={currentIndex}
              onJump={handleJumpTo}
              deckLayout={deckLayout}
              setDeckLayout={setDeckLayout}
              deckFilter={deckFilter}
              setDeckFilter={setDeckFilter}
              isDark={isDark}
            />
          </div>
        </div>
      )}

      {/* Lightbox para ampliar imagen de referencia médica sin voltear la tarjeta */}
      {zoomedImageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Imagen ampliada"
          onClick={() => setZoomedImageUrl(null)}
          className="fixed inset-0 z-[110] bg-black/85 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <button
            type="button"
            onClick={() => setZoomedImageUrl(null)}
            aria-label="Cerrar imagen ampliada"
            className="absolute top-4 right-4 p-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
          {zoomedImageUrl.isNextImage ? (
            <Image
              src={zoomedImageUrl.url}
              alt="Imagen de referencia ampliada"
              width={1200}
              height={900}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-[88dvh] w-auto object-contain rounded-2xl shadow-2xl"
            />
          ) : (
            <img
              src={zoomedImageUrl.url}
              alt="Imagen de referencia ampliada"
              referrerPolicy="no-referrer"
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-[88dvh] object-contain rounded-2xl shadow-2xl"
            />
          )}
        </div>
      )}

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(1, 75, 160, 0.35);
          border-radius: 9999px;
        }
      `}</style>
    </div>
  );
}

export default function FlashcardStudyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center min-h-screen">
          <Loader2 className="animate-spin text-[#014ba0] w-10 h-10" />
        </div>
      }
    >
      <FlashcardContent />
    </Suspense>
  );
}
