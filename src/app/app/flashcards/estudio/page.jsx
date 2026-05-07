"use client";

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { getDueFlashcards, saveFlashcardProgress, getAllFlashcardsBySubtema, getWeakFlashcards } from '@/lib/flashcardServices';
import { calculateNextReview } from '@/lib/spacedRepetition';
import { 
  ArrowLeft, 
  RotateCcw, 
  CheckCircle2, 
  BrainCircuit,
  Info,
  Trophy,
  AlertCircle,
  HelpCircle,
  Zap,
  Check,
  RotateCw,
  Flame,
  ChevronRight,
  Layers,
  Loader2,
  EyeOff
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import Swal from 'sweetalert2';

function getDriveImageUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    // 1. Si ya es una miniatura de Drive, devolverla
    if (rawUrl.includes('drive.google.com/thumbnail')) return rawUrl;

    // 2. Si es un link de 'uc' (directo), convertir a miniatura para mejor rendimiento
    if (rawUrl.includes('drive.google.com/uc')) {
      const urlObj = new URL(rawUrl);
      const id = urlObj.searchParams.get('id');
      if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w800`;
    }

    // 3. Si es un link estándar de archivo /file/d/
    if (rawUrl.includes('/file/d/')) {
      const id = rawUrl.split('/file/d/')[1].split('/')[0].split('?')[0];
      if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w800`;
    }

    // 4. Si es una URL de imagen estándar (no de Drive)
    if (rawUrl.startsWith('http') && !rawUrl.includes('drive.google.com')) {
      return rawUrl;
    }

    return null;
  } catch { return null; }
}

function FlashcardContent() {
  const { user, loading: authLoading } = useAuth();
  const { isDark, isLoaded: themeLoaded } = useTheme();
  const searchParams = useSearchParams();
  const router = useRouter();
  const subtema = searchParams.get('subtema');

  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [isIntensiveMode, setIsIntensiveMode] = useState(false);

  // Función para renderizar la pregunta Cloze mental (sin inputs)
  const renderClozeQuestion = (text) => {
    if (!text) return null;
    const parts = text.split(/(\[.*?\])/g);
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-6 leading-relaxed text-center max-w-4xl mx-auto px-2">
        {parts.map((part, index) => {
          if (part.startsWith('[') && part.endsWith(']')) {
            return (
              <span 
                key={index} 
                className="inline-block w-24 h-8 border-b-4 border-[#2E4A70] bg-gray-50/50 mx-1 align-middle rounded-sm"
              ></span>
            );
          }
          return <span key={index} className="text-2xl sm:text-4xl font-black">{part}</span>;
        })}
      </div>
    );
  };

  // Función para renderizar la solución Cloze en el reverso
  const renderClozeAnswer = (text) => {
    if (!text) return null;
    const parts = text.split(/(\[.*?\])/g);
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-8 leading-relaxed text-center max-w-5xl mx-auto">
        {parts.map((part, index) => {
          if (part.startsWith('[') && part.endsWith(']')) {
            const word = part.substring(1, part.length - 1);
            return (
              <span key={index} className="text-2xl sm:text-4xl font-black text-blue-600 bg-blue-500/10 px-4 py-2 rounded-2xl border-2 border-blue-500/30 shadow-sm">
                {word}
              </span>
            );
          }
          return <span key={index} className="text-2xl sm:text-4xl font-black opacity-90">{part}</span>;
        })}
      </div>
    );
  };

  useEffect(() => {
    const mode = searchParams.get('mode');
    if (!authLoading && user && (subtema || mode === 'review_weakness')) {
      loadCards();
    }
  }, [authLoading, user, subtema, searchParams]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (sessionFinished || cards.length === 0 || loading) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsFlipped(prev => !prev);
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (isFlipped && ['1', '2', '3', '4', '5'].includes(e.key)) {
        handleRate(parseInt(e.key));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFlipped, sessionFinished, cards.length, loading, currentIndex]);

  const loadCards = async (forceAll = false) => {
    setLoading(true);
    setSessionFinished(false);
    setIsFlipped(false);
    setCurrentIndex(0);
    try {
      const mode = searchParams.get('mode');
      let fetchedCards = [];
      
      if (mode === 'review_weakness') {
        fetchedCards = await getWeakFlashcards(user.uid);
      } else {
        fetchedCards = forceAll 
          ? await getAllFlashcardsBySubtema(user.uid, subtema)
          : await getDueFlashcards(user.uid, subtema);
      }
      
      setCards(fetchedCards);
      if (forceAll) setIsIntensiveMode(true);
    } catch (error) {
      console.error("Error loading cards:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  const handleNext = () => {
    // Si la tarjeta está volteada pero no ha sido calificada, no permitir avanzar manualmente
    if (isFlipped && !cards[currentIndex]?.isRated) {
      return;
    }
    
    if (currentIndex < cards.length - 1) {
      setIsFlipped(false);
      setTimeout(() => setCurrentIndex(prev => prev + 1), 100);
    } else {
      setSessionFinished(true);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setIsFlipped(false);
      setTimeout(() => setCurrentIndex(prev => prev - 1), 100);
    }
  };

  const handleJumpTo = (index) => {
    setIsFlipped(false);
    setCurrentIndex(index);
  };

  const handleRate = async (rating) => {
    if (!cards[currentIndex]) return;
    const card = cards[currentIndex];
    const prevProgress = card.userProgress || {};
    const nextReviewData = calculateNextReview(
      rating,
      prevProgress.easiness,
      prevProgress.interval,
      prevProgress.repetitions
    );
    try {
      await saveFlashcardProgress(user.uid, card.id, nextReviewData, subtema, rating);
      const updatedCards = [...cards];
      updatedCards[currentIndex].isRated = true;
      updatedCards[currentIndex].userProgress = nextReviewData;
      setCards(updatedCards);
    } catch (err) {
      console.error("Error saving progress:", err);
    }
    
    // Lógica del Botón "Olvido" (1)
    if (rating === 1) {
      setIsFlipped(false);
      // Permanecer en el mismo currentIndex para obligar al re-estudio inmediato
    } else {
      handleNext();
    }
  };

  const handleMarkAsMastered = async () => {
    if (!cards[currentIndex]) return;
    const card = cards[currentIndex];
    
    // Alerta de confirmación con SweetAlert2
    const result = await Swal.fire({
      title: '¿Dominas este concepto?',
      text: "Esta tarjeta se archivará y no aparecerá en tus sesiones de estudio diarias. Podrás restaurarla en cualquier momento desde el panel de selección usando el botón 'Restaurar'.",
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#2E4A70',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Sí, ya la domino',
      cancelButtonText: 'Cancelar',
      background: isDark ? '#1a2639' : '#fff',
      color: isDark ? '#fff' : '#2E4A70',
      borderRadius: '2rem'
    });

    if (result.isConfirmed) {
      const prevProgress = card.userProgress || {};
      const nextReviewData = calculateNextReview(
        5,
        prevProgress.easiness,
        prevProgress.interval,
        prevProgress.repetitions
      );

      try {
        await saveFlashcardProgress(user.uid, card.id, nextReviewData, subtema, 5, true);
        
        // Feedback visual inmediato
        toast.success("¡Dominio registrado!", {
          icon: '🏆',
          style: { borderRadius: '15px', background: '#2E4A70', color: '#fff', fontWeight: 'bold' }
        });

        // Pequeña pausa para que el usuario vea el feedback antes de pasar
        setTimeout(() => {
          handleNext();
        }, 300);
      } catch (err) {
        console.error("Error marking as mastered:", err);
        toast.error("Error al guardar dominio.");
      }
    }
  };

  if (authLoading || !themeLoaded || (loading && cards.length === 0 && !sessionFinished)) {
    return (
      <div className={`flex flex-col items-center justify-center min-h-screen ${isDark ? 'bg-[#1a2639]' : 'bg-[#FDF9F1]'}`}>
        <div className="relative">
          <div className="w-20 h-20 border-4 border-blue-500/20 border-t-blue-600 rounded-full animate-spin"></div>
          <BrainCircuit className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-blue-600 animate-pulse" />
        </div>
        <p className="mt-6 text-sm font-black uppercase tracking-[0.3em] opacity-40">Preparando Sesión</p>
      </div>
    );
  }

  if (user && !user.hasPagoUnicoAccess) {
    router.replace('/app/flashcards');
    return null;
  }

  if (!subtema) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-10 text-center">
        <AlertCircle className="w-16 h-16 text-red-500 mb-6" />
        <h1 className="text-3xl font-black mb-2">Error de Identificador</h1>
        <Link href="/app/flashcards" className="px-10 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl">VOLVER AL PANEL</Link>
      </div>
    );
  }

  if (sessionFinished) {
    return (
      <div className={`flex flex-col items-center justify-center min-h-screen p-6 text-center ${isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FDF9F1] text-[#2E4A70]'}`}>
        <Trophy className="w-20 h-20 text-green-500 mb-8 animate-bounce" />
        <h1 className="text-5xl font-black mb-4 tracking-tighter">¡Objetivo Logrado!</h1>
        <p className="text-xl opacity-60 max-w-md mb-12 font-medium">Has completado el repaso de <span className="text-blue-500 font-bold">{subtema}</span>.</p>
        <div className="flex flex-col sm:flex-row gap-6">
          <button onClick={() => router.push('/app/flashcards')} className="px-10 py-5 bg-[#2E4A70] text-white rounded-[2rem] font-black shadow-2xl hover:scale-105 transition-all">ELEGIR OTRO TEMA</button>
          <button onClick={() => { setSessionFinished(false); setCurrentIndex(0); loadCards(isIntensiveMode); }} className={`px-10 py-5 rounded-[2rem] font-black border-2 hover:scale-105 transition-all ${isDark ? 'border-gray-700 bg-gray-800/50' : 'border-white bg-white shadow-xl'}`}>REPASAR DE NUEVO</button>
        </div>
      </div>
    );
  }

  if (cards.length === 0 && !loading) {
    return (
      <div className={`flex flex-col items-center justify-center min-h-screen p-6 text-center ${isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FDF9F1] text-[#2E4A70]'}`}>
        <CheckCircle2 className="w-16 h-16 text-blue-500 mb-8" />
        <h1 className="text-4xl font-black mb-4">¡Todo al día!</h1>
        <p className="text-lg opacity-60 max-w-md mb-10">Has alcanzado tu Inbox Zero para este tema.</p>
        <div className="flex flex-col gap-4 w-full max-w-xs mx-auto">
          <Link href="/app/flashcards" className="w-full px-10 py-5 bg-blue-600 text-white rounded-[2rem] font-black shadow-2xl text-center uppercase tracking-tighter">Volver al Dashboard</Link>
          <button onClick={() => loadCards(true)} className={`w-full px-10 py-4 rounded-[2rem] font-black border-2 flex items-center justify-center gap-2 ${isDark ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}><Flame className="w-5 h-5 text-orange-500" /> MODO ESTUDIO INTENSIVO</button>
        </div>
      </div>
    );
  }

  const currentCard = cards[currentIndex];
  const isClozeType = currentCard?.tipo?.toLowerCase() === 'completar espacios' || 
                      (currentCard?.pregunta?.includes('[') && currentCard?.pregunta?.includes(']'));
  
  const progress = ((currentIndex + 1) / cards.length) * 100;
  const cardImageUrl = getDriveImageUrl(currentCard?.driveUrl);

  return (
    <div className={`p-2 sm:p-10 min-h-screen transition-all duration-500 flex flex-col ${isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FDF9F1] text-[#2E4A70]'}`}>
      <div className="max-w-7xl mx-auto w-full flex-grow flex flex-col px-1 sm:px-0">

        {/* Header (Clon de Diseño Premium) */}
        <div className="text-center mb-6 sm:mb-10 mt-4 sm:mt-6">
          <h1 className="text-3xl sm:text-5xl font-bold bg-gradient-to-r from-[#2E4A70] to-[#3B82F6] bg-clip-text text-transparent mb-2 sm:mb-4">
            {searchParams.get('mode') === 'review_weakness' ? 'Tus Tarjetas Críticas' : subtema}
          </h1>
          <p className="text-base sm:text-xl text-gray-600 max-w-2xl mx-auto px-4">
            {searchParams.get('mode') === 'review_weakness' 
              ? 'Conceptos que requieren refuerzo inmediato.' 
              : 'Sesión de aprendizaje activa.'}
          </p>
        </div>

        {/* Grid de Estudio */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-10 flex-grow mb-8">
          
          {/* Columna Tarjeta */}
          <div className="lg:col-span-9 flex flex-col">
            <div className={`p-4 sm:p-10 border border-gray-100 rounded-[2rem] shadow-xl shadow-gray-200/50 bg-gradient-to-br from-orange-50 via-white to-blue-50 animate-gradient-shift flex flex-col`}>
              <div className="w-full h-2 bg-black/5 dark:bg-white/5 rounded-full mb-6 sm:mb-8 overflow-hidden p-0.5 border border-white/10 shadow-inner">
                <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-700 ease-out shadow-[0_0_15px_rgba(59,130,246,0.5)]" style={{ width: `${progress}%` }} />
              </div>

              <div className="relative w-full perspective-2000 flex-grow h-[65vh] sm:h-[75vh] min-h-[500px] sm:min-h-[550px] max-h-[950px]">
              <div className={`relative w-full h-full transition-all duration-[800ms] preserve-3d cursor-pointer group-card ${isFlipped ? 'rotate-y-180' : ''}`}>
                
                {/* Cara Frontal */}
                <div 
                  className={`absolute inset-0 w-full h-full backface-hidden p-4 sm:p-10 rounded-[2.5rem] sm:rounded-[3rem] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border-2 flex flex-col items-center justify-center text-center transition-all overflow-y-auto ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-white'}`}
                  onClick={handleFlip}
                >
                  <div className="absolute top-8 left-8 flex items-center gap-3 opacity-20 z-10"><BrainCircuit className="w-6 h-6" /><span className="text-xs font-black uppercase tracking-widest">Pregunta</span></div>
                  
                  {/* Badge de Tipo */}
                  <div className="absolute top-8 right-8 z-10">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border-2 ${
                      isDark ? 'bg-purple-900/20 border-purple-500/30 text-purple-400' : 'bg-purple-50 border-purple-200 text-purple-600'
                    }`}>
                      {currentCard?.tipo || (isClozeType ? 'Completar Espacios' : 'Pregunta')}
                    </span>
                  </div>

                  <div className="max-w-4xl w-full flex flex-col items-center relative z-20 py-20">
                    <div 
                      className="w-full max-h-[350px] overflow-y-auto overflow-x-hidden custom-scrollbar pr-2 mb-6 break-words"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isClozeType ? (
                        renderClozeQuestion(currentCard?.pregunta)
                      ) : (
                        <h3 className="text-2xl sm:text-4xl font-black leading-tight tracking-tight text-center break-words whitespace-pre-wrap">
                          {currentCard?.pregunta}
                        </h3>
                      )}
                    </div>

                    {cardImageUrl && (
                      <div className="flex justify-center bg-black/5 rounded-2xl p-4 w-full shadow-inner border border-gray-200 dark:border-gray-700">
                        <img 
                          src={cardImageUrl} 
                          alt="Referencia" 
                          className="max-h-48 md:max-h-64 w-auto object-contain mx-auto rounded-lg shadow-sm" 
                        />
                      </div>
                    )}
                  </div>
                  <div className="mt-8 relative z-20"><div className="flex items-center gap-3 text-blue-500 font-black text-[10px] uppercase tracking-[0.2em] animate-pulse"><RotateCw className="w-4 h-4" /><span>Click o ENTER para revelar respuesta</span></div></div>
                </div>

                {/* Cara Trasera */}
                <div 
                  className={`absolute inset-0 w-full h-full backface-hidden rotate-y-180 p-6 sm:p-10 rounded-[3rem] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border-2 flex flex-col transition-all overflow-hidden ${isDark ? 'bg-[#1e293b] border-blue-500/30 z-20' : 'bg-[#f8fafc] border-blue-200 z-20'}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-3 mb-6 text-green-500"><div className="p-2 bg-green-500/10 rounded-xl"><CheckCircle2 className="w-6 h-6" /></div><span className="text-sm font-black uppercase tracking-widest">Respuesta y Validación</span></div>
                  
                  {/* Área de contenido con scroll - stopPropagation añadido para permitir scroll sin voltear */}
                  <div 
                    className="flex-1 min-h-0 overflow-y-auto pr-2 custom-scrollbar space-y-10 pb-6"
                    onClick={(e) => e.stopPropagation()}
                  >
                    
                    {/* UI de Respuesta */}
                    <div className="w-full">
                      {isClozeType ? (
                        <div className={`p-6 sm:p-10 rounded-3xl border-2 ${isDark ? 'bg-blue-500/10 border-blue-500/20' : 'bg-blue-50 border-blue-100 shadow-sm'}`}>
                          <span className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-10 block text-blue-600 text-center">Texto Completado</span>
                          {renderClozeAnswer(currentCard?.pregunta)}
                        </div>
                      ) : (
                        <div className={`p-6 sm:p-10 rounded-3xl border-2 flex flex-col items-center justify-start text-center min-h-[250px] ${isDark ? 'bg-blue-500/10 border-blue-500/20' : 'bg-blue-50 border-blue-100 shadow-sm'}`}>
                          <span className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-8 block text-blue-600">Respuesta Correcta</span>
                          <div className="w-full px-2">
                            <p className={`text-2xl sm:text-4xl font-black whitespace-pre-wrap break-words text-center w-full leading-tight ${isDark ? 'text-white' : 'text-[#2E4A70]'}`}>
                              {currentCard?.respuesta}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {currentCard?.explicacion && (
                      <div className={`p-6 sm:p-8 rounded-[2rem] border-2 flex flex-col sm:flex-row gap-5 backdrop-blur-md max-w-5xl mx-auto w-full ${isDark ? 'bg-gray-900/50 border-gray-700 text-gray-300' : 'bg-white border-blue-100 text-gray-600 shadow-xl'}`}>
                        <div className="p-3 bg-blue-500/10 rounded-2xl h-fit w-fit"><Info className="w-6 h-6 text-blue-500" /></div>
                        <div>
                          <span className="block font-black text-[10px] uppercase tracking-[0.2em] text-blue-500 mb-3">Explicación Técnica</span>
                          <p className="text-lg leading-relaxed font-medium italic">
                            {currentCard.explicacion}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Botonera SM-2 (Sticky Footer) */}
                  <div className="mt-6 pt-6 border-t border-blue-500/10 bg-inherit sticky bottom-0 z-10">
                    
                    {/* Botón de Dominio Manual (Opcional/Discreto) */}
                    <div className="flex justify-center mb-6">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleMarkAsMastered(); }}
                        className={`group flex items-center gap-3 px-6 py-3 rounded-2xl border-2 transition-all active:scale-95 ${
                          isDark ? 'bg-gray-900/50 border-gray-700 hover:border-blue-500/50' : 'bg-white border-gray-100 hover:border-blue-200 shadow-sm'
                        }`}
                      >
                        <EyeOff className="w-5 h-5 text-blue-500 transition-transform group-hover:scale-110" />
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-60 group-hover:opacity-100">Ya domino esto</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-5 gap-2 sm:gap-4">
                      {/* Q1: Olvido */}
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleRate(1); }} 
                        className="group/btn flex flex-col items-center gap-2 p-3 sm:p-4 rounded-2xl sm:rounded-[1.5rem] bg-red-500 hover:bg-red-600 text-white transition-all shadow-lg active:scale-95"
                      >
                        <span className="text-xl sm:text-2xl group-hover/btn:scale-125 transition-transform">😭</span>
                        <span className="text-[8px] sm:text-[10px] font-black uppercase">Olvido</span>
                      </button>

                      {/* Q2: Difícil */}
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleRate(2); }} 
                        className="group/btn flex flex-col items-center gap-2 p-3 sm:p-4 rounded-2xl sm:rounded-[1.5rem] bg-orange-500 hover:bg-orange-600 text-white transition-all shadow-lg active:scale-95"
                      >
                        <span className="text-xl sm:text-2xl group-hover/btn:scale-125 transition-transform">😠</span>
                        <span className="text-[8px] sm:text-[10px] font-black uppercase">Difícil</span>
                      </button>

                      {/* Q3: Normal */}
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleRate(3); }} 
                        className="group/btn flex flex-col items-center gap-2 p-3 sm:p-4 rounded-2xl sm:rounded-[1.5rem] bg-gray-500 hover:bg-gray-600 text-white transition-all shadow-lg active:scale-95"
                      >
                        <span className="text-xl sm:text-2xl group-hover/btn:scale-125 transition-transform">😐</span>
                        <span className="text-[8px] sm:text-[10px] font-black uppercase">Normal</span>
                      </button>

                      {/* Q4: Fácil */}
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleRate(4); }} 
                        className="group/btn flex flex-col items-center gap-2 p-3 sm:p-4 rounded-2xl sm:rounded-[1.5rem] bg-green-500 hover:bg-green-600 text-white transition-all shadow-lg active:scale-95"
                      >
                        <span className="text-xl sm:text-2xl group-hover/btn:scale-125 transition-transform">🙂</span>
                        <span className="text-[8px] sm:text-[10px] font-black uppercase">Fácil</span>
                      </button>

                      {/* Q5: Perfecto */}
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleRate(5); }} 
                        className="group/btn flex flex-col items-center gap-2 p-3 sm:p-4 rounded-2xl sm:rounded-[1.5rem] bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-lg active:scale-95"
                      >
                        <span className="text-xl sm:text-2xl group-hover/btn:scale-125 transition-transform">🤩</span>
                        <span className="text-[8px] sm:text-[10px] font-black uppercase">Perfecto</span>
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Controles Navegación */}
            <div className="flex items-center justify-between mt-6 sm:mt-8 gap-2 sm:gap-4 px-1 sm:px-10">
              <button 
                onClick={(e) => { e.stopPropagation(); handlePrev(); }} 
                disabled={currentIndex === 0} 
                className={`flex items-center justify-center gap-1 sm:gap-3 px-3 sm:px-8 py-3 sm:py-4 rounded-xl sm:rounded-2xl font-black transition-all flex-1 sm:flex-none ${currentIndex === 0 ? 'opacity-20 cursor-not-allowed' : 'bg-white dark:bg-gray-800 shadow-xl hover:-translate-x-2'}`}
              >
                <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" /> 
                <span className="text-[10px] sm:text-sm tracking-tighter sm:tracking-normal">ANTERIOR</span>
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); handleFlip(); }} 
                className="p-3 sm:p-4 bg-blue-600 text-white rounded-xl sm:rounded-2xl shadow-xl hover:rotate-12 transition-all active:scale-90 flex-shrink-0"
              >
                <RotateCw className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); handleNext(); }} 
                disabled={isFlipped && !currentCard?.isRated}
                className={`flex items-center justify-center gap-1 sm:gap-3 px-3 sm:px-8 py-3 sm:py-4 bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl font-black shadow-xl transition-all text-blue-500 flex-1 sm:flex-none ${
                  (isFlipped && !currentCard?.isRated) ? 'opacity-20 cursor-not-allowed' : 'hover:translate-x-2'
                }`}
              >
                <span className="text-[10px] sm:text-sm tracking-tighter sm:tracking-normal">SIGUIENTE</span> 
                <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
              </button>
            </div>
          </div>
        </div>

        {/* Selector Lateral */}
          <div className="lg:col-span-3 hidden lg:flex flex-col">
            <div className={`p-6 rounded-[2.5rem] border shadow-2xl flex-grow flex flex-col ${isDark ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-white'}`}>
              <div className="flex items-center gap-3 mb-6"><Layers className="w-5 h-5 text-blue-500" /><h4 className="font-black text-xs uppercase tracking-widest">Mazo de Cartas</h4></div>
              <div className="flex-grow overflow-y-auto pr-2 custom-scrollbar space-y-3">
                {cards.map((card, idx) => (
                  <div key={card.id} onClick={() => handleJumpTo(idx)} className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between group ${currentIndex === idx ? 'bg-blue-600 border-blue-500 text-white scale-[1.05] shadow-lg shadow-blue-500/30' : isDark ? 'bg-gray-900/30 border-transparent hover:border-gray-600' : 'bg-gray-50 border-transparent hover:border-blue-200'}`}>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-black w-6 h-6 rounded-lg flex items-center justify-center ${currentIndex === idx ? 'bg-white text-blue-600' : 'bg-blue-500/10 text-blue-500'}`}>{idx + 1}</span>
                      <span className="text-[10px] font-bold uppercase tracking-tight truncate w-24">{card.pregunta.substring(0, 20)}...</span>
                    </div>
                    {card.isRated && <CheckCircle2 className={`w-4 h-4 ${currentIndex === idx ? 'text-white' : 'text-green-500'}`} />}
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-6 border-t border-blue-500/10 text-center opacity-40">
                <p className="text-[10px] font-black uppercase tracking-widest mb-3">Atajos</p>
                <div className="flex justify-center gap-4 text-[8px]"><kbd>←</kbd><kbd>SPACE</kbd><kbd>→</kbd></div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <style jsx global>{`
        @keyframes gradientAnimation {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient-shift {
          background-size: 400% 400%;
          animation: gradientAnimation 15s ease infinite;
        }
        .perspective-2000 { perspective: 2000px; }
        .preserve-3d { transform-style: preserve-3d; }
        .backface-hidden { backface-visibility: hidden; }
        .rotate-y-180 { transform: rotateY(180deg); }
        .group-card:hover { transform: translateY(-5px) ${isFlipped ? 'rotateY(180deg)' : ''}; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #3b82f6; border-radius: 10px; }
      `}</style>
    </div>
  );
}

export default function FlashcardStudyPage() {
  return (
    <Suspense fallback={<div className="flex justify-center items-center min-h-screen"><Loader2 className="animate-spin text-blue-500 w-12 h-12" /></div>}>
      <FlashcardContent />
    </Suspense>
  );
}