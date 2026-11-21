"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '@/lib/firebase';

import { useRouter } from 'next/navigation';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import {
  getFlashcardMetrics,
  peekCachedFlashcardMetrics,
  restoreMasteredFlashcards,
  getMasteredCount,
  getCategoryFlashcardCounts,
  peekCachedCategoryFlashcardCounts,
  getSubthemeFlashcardCounts,
  peekCachedSubthemeFlashcardCounts,
  prefetchSubthemeStudy,
} from '@/lib/flashcardServices';
import {
  getCachedCategories,
  peekCachedCategories,
  getCachedSubcategories,
  peekCachedSubcategories,
  getCachedContactInfo,
  getCachedPendingAccessRequest,
  setCachedPendingAccessRequest,
} from '@/lib/catalogCache';
import { 
  BookOpen, 
  ChevronRight, 
  ChevronDown,
  Layers, 
  GraduationCap, 
  Search,
  Loader2,
  Sparkles,
  ArrowRightCircle,
  Calendar,
  Zap,
  Activity,
  AlertTriangle,
  RotateCcw,
  TrendingUp,
  Target,
  LockKeyhole,
  Send,
  Hourglass
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import Swal from 'sweetalert2';
import CardRadiographyModal from './components/CardRadiographyModal';

const NOMBRE_NEGOCIO = 'DOCTEMIA MC';

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
            const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
            await addDoc(collection(db, "pagoUnico_solicitudes"), { 
                userId: user.uid, 
                userName: user.name || user.displayName, 
                userEmail: user.email, 
                userPhone: phoneInput, 
                requestDate: serverTimestamp(), 
                status: 'pendiente', 
                type: 'flashcards_access' 
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
        <div
            className={`min-h-screen flex flex-col items-center justify-center p-4 transition-colors ${
                isDark
                    ? 'bg-[#060A13] text-white'
                    : 'bg-gradient-to-br from-orange-50 to-blue-50 text-gray-800'
            }`}
        >
            <div
                className={`max-w-lg w-full rounded-2xl shadow-2xl p-8 text-center border transform hover:scale-[1.01] transition-all duration-300 ${
                    isDark ? 'bg-[#152238] border-white/10 text-white' : 'bg-white border-blue-50 text-gray-800'
                }`}
            >
                <div className="w-24 h-24 bg-gradient-to-r from-teal-400 to-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
                    <LockKeyhole className="h-12 w-12 text-white" />
                </div>
                
                <h1 className={`text-3xl font-bold mb-4 ${isDark ? 'text-white' : 'text-gray-800'}`}>Acceso Restringido</h1>
                <p className={`text-lg mb-8 leading-relaxed ${isDark ? 'text-slate-300' : 'text-gray-600'}`}>
                    Para acceder al sistema de Flashcards inteligentes, necesitas la aprobación de nuestro equipo.
                </p>

                <div className="space-y-4">
                    {requestSent ? (
                        <div
                            className={`flex items-center justify-center gap-3 p-4 rounded-xl border ${
                                isDark
                                    ? 'bg-amber-500/15 border-amber-400/30 text-amber-200'
                                    : 'bg-amber-50 border-amber-300 text-amber-800'
                            }`}
                        >
                            <Hourglass className={`h-6 w-6 animate-spin ${isDark ? 'text-amber-300' : 'text-amber-600'}`} />
                            <span className="font-semibold">Tu solicitud está en proceso</span>
                        </div>
                    ) : (
                        <button 
                            onClick={handleRequestAccessPopup} 
                            disabled={isSubmitting} 
                            className="w-full bg-gradient-to-r from-teal-500 to-blue-600 text-white font-bold py-4 px-8 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-300 disabled:opacity-50 disabled:transform-none cursor-pointer"
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
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div
                        className={`relative w-full max-w-md rounded-2xl shadow-2xl border transform scale-100 transition-all duration-300 ${
                            isDark ? 'bg-[#152238] border-white/15 text-white' : 'bg-white border-gray-200 text-gray-800'
                        }`}
                    >
                        <div className={`flex items-center justify-between p-6 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                            <h3 className={`text-2xl font-bold ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`}>
                                ¡Obtén tu Acceso!
                            </h3>
                            <button 
                                onClick={() => setShowModal(false)} 
                                className={`transition-colors p-2 rounded-full cursor-pointer ${
                                    isDark ? 'text-slate-300 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                }`}
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            <p className={`text-center leading-relaxed ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                                Realiza el pago usando el código QR y contáctanos vía WhatsApp para activación inmediata.
                            </p>

                            {/* QR Code */}
                            <div className="flex justify-center">
                                {contactInfo.qrUrl ? (
                                    <div className="w-56 h-56 rounded-2xl border-4 border-teal-400/60 overflow-hidden shadow-lg bg-white">
                                        <img 
                                            src={(() => {
                                                if (contactInfo.qrUrl.includes('drive.google.com/uc?export=view&id=')) {
                                                    const fileId = contactInfo.qrUrl.split('id=')[1];
                                                    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400-h400`;
                                                }
                                                return contactInfo.qrUrl;
                                            })()} 
                                            alt="Código QR de Pago" 
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                ) : (
                                    <div className={`w-56 h-56 rounded-2xl flex items-center justify-center ${isDark ? 'bg-[#0A111F] text-slate-400' : 'bg-gray-100 text-gray-500'}`}>
                                        <p>QR no disponible</p>
                                    </div>
                                )}
                            </div>

                            <div className="text-center">
                                <p className={`font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-800'}`}>¿Ya completaste el pago?</p>
                                
                                <a 
                                    href={`https://api.whatsapp.com/send?phone=${contactInfo.adminPhone}&text=${encodeURIComponent(`Hola ${NOMBRE_NEGOCIO}, soy ${user.name || user.displayName}. He realizado el pago para acceso a las Flashcards. Adjunto comprobante.`)}`}
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
                                    <span className={`w-full border-t ${isDark ? 'border-white/15' : 'border-gray-300'}`}></span>
                                </div>
                                <div className="relative flex justify-center text-sm uppercase font-semibold">
                                    <span className={`px-4 ${isDark ? 'bg-[#152238] text-slate-400' : 'bg-white text-gray-500'}`}>O solicita contacto</span>
                                </div>
                            </div>

                            <input
                                type="tel"
                                value={phoneInput}
                                onChange={(e) => setPhoneInput(e.target.value)}
                                placeholder="Tu número de WhatsApp (+591...)"
                                className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all ${
                                    isDark
                                        ? 'bg-[#0A111F] border-white/15 text-white placeholder:text-slate-400'
                                        : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400'
                                }`}
                            />
                        </div>

                        <div className={`flex gap-3 p-6 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                            <button 
                                onClick={() => setShowModal(false)} 
                                className={`flex-1 px-6 py-3 border rounded-xl transition-colors font-medium cursor-pointer ${
                                    isDark ? 'border-white/15 text-slate-200 hover:bg-white/10' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={handleSubmitRequest}
                                disabled={isSubmitting || !phoneInput}
                                className="flex-1 px-6 py-3 bg-gradient-to-r from-teal-500 to-blue-600 text-white rounded-xl hover:from-teal-600 hover:to-blue-700 transition-all disabled:opacity-50 font-medium cursor-pointer"
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

export default function StudentFlashcardsPage() {
  const { isDark, isLoaded } = useTheme();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [categories, setCategories] = useState([]);
  const [catCardCounts, setCatCardCounts] = useState({});
  const [selectedCat, setSelectedCat] = useState(null);
  const [subthemes, setSubthemes] = useState([]);
  const [globalCounts, setGlobalCounts] = useState({});
  const [masteredCounts, setMasteredCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingSub, setLoadingSub] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [subthemeSearch, setSubthemeSearch] = useState('');
  const [metrics, setMetrics] = useState({ 
    dueToday: 0, 
    totalLearning: 0, 
    performanceBySubtheme: [],
    criticalCards: []
  });
  const [criticalQuestions, setCriticalQuestions] = useState({});
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const masteredMapRef = useRef({});
  const subthemesPanelRef = useRef(null);
  const prefetchedSubthemesRef = useRef(new Set());
  
  // Estado para la Radiografía
  const [selectedCardForRadiography, setSelectedCardForRadiography] = useState(null);
  const [showCriticalCards, setShowCriticalCards] = useState(false);
  const [openingSubtheme, setOpeningSubtheme] = useState(null);

  useEffect(() => {
    router.prefetch('/app/flashcards/estudio');
  }, [router]);

  const prewarmSubtheme = useCallback(
    (subtemaName) => {
      const cleanName = subtemaName?.trim();
      if (!cleanName) return;
      const cacheKey = `${user?.uid || 'anon'}::${cleanName}`;
      if (!prefetchedSubthemesRef.current.has(cacheKey)) {
        prefetchedSubthemesRef.current.add(cacheKey);
        router.prefetch(`/app/flashcards/estudio?subtema=${encodeURIComponent(subtemaName)}`);
      }
      prefetchSubthemeStudy(user?.uid, cleanName);
    },
    [router, user?.uid]
  );

  useEffect(() => {
    if (!openingSubtheme) return undefined;
    const timer = setTimeout(() => setOpeningSubtheme(null), 8000);
    return () => clearTimeout(timer);
  }, [openingSubtheme]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      setShowCriticalCards(true);
    }
  }, []);

  const swalTheme = {
    background: isDark ? '#1e293b' : '#ffffff', 
    color: isDark ? '#f9fafb' : '#1a2639',
    confirmButtonColor: '#014ba0', 
    cancelButtonColor: '#CF8A40',
  };

  const handleSelectCategory = async (cat, scrollOnMobile = false) => {
    setSelectedCat(cat);
    setSubthemeSearch('');

    const cachedSubs = peekCachedSubcategories(cat.id);
    const cachedSubCounts = peekCachedSubthemeFlashcardCounts(cat.id);
    const hasInstantCache = cachedSubs !== null && cachedSubCounts !== null;
    if (!hasInstantCache) {
      setLoadingSub(true);
    }

    if (scrollOnMobile && typeof window !== 'undefined' && window.innerWidth < 1024) {
      setTimeout(() => {
        subthemesPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    }
    try {
      const allSubthemes = cachedSubs ?? (await getCachedSubcategories(cat.id));
      const subCounts = cachedSubCounts ?? (await getSubthemeFlashcardCounts(cat.id, allSubthemes));
      const masteredMap = masteredMapRef.current || {};

      const mastered = {};
      for (const sub of allSubthemes) {
        const cleanName = sub.name?.trim();
        if (cleanName) {
          mastered[cleanName] = masteredMap[cleanName] || 0;
        }
      }
      setMasteredCounts((prev) => ({ ...prev, ...mastered }));
      setGlobalCounts((prev) => ({ ...prev, ...subCounts }));

      const activeSubthemes = allSubthemes
        .map((sub) => ({
          ...sub,
          cardCount: subCounts[sub.name?.trim()] || 0,
        }))
        .filter((sub) => sub.cardCount > 0);

      setSubthemes(activeSubthemes);
    } catch (error) {
      console.error('Error fetching subthemes:', error);
    } finally {
      setLoadingSub(false);
    }
  };

  useEffect(() => {
    if (!user?.uid || !user?.hasPagoUnicoAccess) {
      setLoading(false);
      setLoadingMetrics(false);
      return;
    }
    let cancelled = false;

    const loadDashboardData = async () => {
      const cachedMetrics = peekCachedFlashcardMetrics(user.uid);
      const cachedCats = peekCachedCategories();
      const cachedCatCounts = peekCachedCategoryFlashcardCounts();

      if (cachedMetrics) {
        masteredMapRef.current = cachedMetrics.masteredCountsMap || {};
        setCriticalQuestions(cachedMetrics.criticalQuestions || {});
        setMetrics(cachedMetrics);
        setLoadingMetrics(false);
      } else {
        setLoadingMetrics(true);
      }

      if (cachedCats && cachedCatCounts) {
        const instantFiltered = cachedCats.filter((cat) => (cachedCatCounts[cat.id] || 0) > 0);
        setCategories(instantFiltered);
        setCatCardCounts(cachedCatCounts);
        setLoading(false);
      } else {
        setLoading(true);
      }

      try {
        // 1. Cargar especialidades desde caché y métricas del alumno en paralelo (SIN descargar toda la colección flashcards)
        const [allCategories, stats] = await Promise.all([
          cachedCats ? Promise.resolve(cachedCats) : getCachedCategories(),
          cachedMetrics ? Promise.resolve(cachedMetrics) : getFlashcardMetrics(user.uid),
        ]);
        if (cancelled) return;

        masteredMapRef.current = stats.masteredCountsMap || {};
        setCriticalQuestions(stats.criticalQuestions || {});
        setMetrics(stats);
        setLoadingMetrics(false);

        // 2. Obtener conteos por especialidad mediante getCountFromServer cacheado en sesión
        const perCatCounts =
          cachedCatCounts || (await getCategoryFlashcardCounts(allCategories));
        if (cancelled) return;

        const filtered = allCategories.filter((cat) => (perCatCounts[cat.id] || 0) > 0);
        setCategories(filtered);
        setCatCardCounts(perCatCounts);
        setLoading(false);

        // 3. Preseleccionar la primera especialidad activa y cargar sus subtemas
        if (filtered.length > 0) {
          const firstCat = filtered[0];
          setSelectedCat(firstCat);
          const cachedFirstSubs = peekCachedSubcategories(firstCat.id);
          const cachedFirstSubCounts = peekCachedSubthemeFlashcardCounts(firstCat.id);

          if (!cachedFirstSubs || !cachedFirstSubCounts) {
            setLoadingSub(true);
          }
          try {
            const allSubs = cachedFirstSubs ?? (await getCachedSubcategories(firstCat.id));
            const subCounts =
              cachedFirstSubCounts ?? (await getSubthemeFlashcardCounts(firstCat.id, allSubs));
            if (cancelled) return;

            const mastered = {};
            for (const sub of allSubs) {
              const cleanName = sub.name?.trim();
              if (cleanName) {
                mastered[cleanName] = masteredMapRef.current[cleanName] || 0;
              }
            }
            setMasteredCounts(mastered);
            setGlobalCounts(subCounts);
            setSubthemes(
              allSubs
                .map((sub) => ({ ...sub, cardCount: subCounts[sub.name?.trim()] || 0 }))
                .filter((sub) => sub.cardCount > 0)
            );
          } catch (subErr) {
            console.error('Error preloading first category:', subErr);
          } finally {
            if (!cancelled) setLoadingSub(false);
          }
        }
      } catch (error) {
        console.error('Error loading flashcards dashboard:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingMetrics(false);
        }
      }
    };

    loadDashboardData();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, user?.hasPagoUnicoAccess]);

  const handleRestore = async (e, subtemaName) => {
    e.stopPropagation();
    try {
      await restoreMasteredFlashcards(user.uid, subtemaName);
      toast.success(`Tarjetas de ${subtemaName} restauradas.`);
      const newCount = await getMasteredCount(user.uid, subtemaName);
      masteredMapRef.current = { ...masteredMapRef.current, [subtemaName]: newCount };
      setMasteredCounts((prev) => ({ ...prev, [subtemaName]: newCount }));

      const stats = await getFlashcardMetrics(user.uid, null, { forceRefresh: true });
      masteredMapRef.current = stats.masteredCountsMap || {};
      setCriticalQuestions(stats.criticalQuestions || {});
      setMetrics(stats);
    } catch (error) {
      console.error("Error restoring cards:", error);
      toast.error("No se pudieron restaurar las tarjetas.");
    }
  };

  const startStudy = (subtemaName) => {
    if (!subtemaName || openingSubtheme) return;
    setOpeningSubtheme(subtemaName);
    router.push(`/app/flashcards/estudio?subtema=${encodeURIComponent(subtemaName)}`);
  };

  if (!isLoaded || authLoading || !user) {
    return (
      <div
        className={`min-h-screen flex flex-col items-center justify-center gap-3 ${
          isDark ? 'bg-[#060A13] text-slate-200' : 'bg-[#FDF9F1] text-[#2E4A70]'
        }`}
      >
        <Loader2 className={`w-8 h-8 animate-spin ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
        <span className="text-xs font-extrabold uppercase tracking-wider opacity-75">
          Cargando tarjetas...
        </span>
      </div>
    );
  }

  if (!user.hasPagoUnicoAccess) return <AccessDeniedScreen user={user} isDark={isDark} swalTheme={swalTheme} />;

  const filteredCategories = categories.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredSubthemes = subthemes.filter(sub =>
    (sub.name || '').toLowerCase().includes(subthemeSearch.toLowerCase())
  );

  return (
    <div className={`p-6 sm:p-10 min-h-screen transition-all duration-500 ${isDark ? 'bg-[#1a2639]' : 'bg-[#FDF9F1]'}`}>
      <div className="max-w-7xl mx-auto">
        
        {/* Cabecera Estilo Apple/Moderno */}
        <header className="mb-12 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6 mb-4">
            <div>
              <h1 className={`text-5xl font-black tracking-tighter ${isDark ? 'text-white' : 'text-[#2E4A70]'}`}>
                Flashcards
              </h1>
              <p className={`text-xl font-medium opacity-60 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                Repetición espaciada inteligente para dominar cada tema médico.
              </p>
            </div>
          </div>
        </header>

        {/* Dashboard de Métricas Analíticas Evolucionado */}
        <section className="mb-12 space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* Columna Izquierda: KPIs */}
            <div className="lg:col-span-4 space-y-8">
                {/* Tarjeta 1: Pendientes Hoy */}
                <div className={`p-8 rounded-[2rem] border shadow-2xl shadow-blue-500/5 transition-all hover:scale-[1.02] ${isDark ? 'bg-gray-800/40 border-gray-700' : 'bg-white border-blue-50'}`}>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-500">
                      <Calendar className="w-8 h-8" />
                    </div>
                    <h3 className={`font-black text-sm uppercase tracking-widest opacity-60 ${isDark ? 'text-gray-300' : 'text-[#2E4A70]'}`}>Repasos para Hoy</h3>
                  </div>
                  {loadingMetrics ? (
                    <div className="h-10 w-20 bg-gray-200/20 animate-pulse rounded-lg"></div>
                  ) : (
                    <div className="flex items-baseline gap-2">
                      <span className={`text-6xl font-black ${isDark ? 'text-white' : 'text-blue-600'}`}>{metrics.dueToday}</span>
                      <span className="text-sm font-black opacity-40 uppercase tracking-tighter">Tarjetas</span>
                    </div>
                  )}
                </div>

                {/* Tarjeta 2: Aprendizaje Activo */}
                <div className={`p-8 rounded-[2rem] border shadow-2xl shadow-blue-500/5 transition-all hover:scale-[1.02] ${isDark ? 'bg-gray-800/40 border-gray-700' : 'bg-white border-blue-50'}`}>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-500">
                      <Target className="w-8 h-8" />
                    </div>
                    <h3 className={`font-black text-sm uppercase tracking-widest opacity-60 ${isDark ? 'text-gray-300' : 'text-[#2E4A70]'}`}>En Aprendizaje</h3>
                  </div>
                  {loadingMetrics ? (
                    <div className="h-10 w-20 bg-gray-200/20 animate-pulse rounded-lg"></div>
                  ) : (
                    <div className="flex items-baseline gap-2">
                      <span className={`text-6xl font-black ${isDark ? 'text-white' : 'text-blue-700'}`}>{metrics.totalLearning}</span>
                      <span className="text-sm font-black opacity-40 uppercase tracking-tighter">Temas</span>
                    </div>
                  )}
                </div>
            </div>

            {/* Columna Derecha: Gráfica de Rendimiento */}
            <div className="lg:col-span-8">
              <div className={`p-10 h-full rounded-[2rem] border shadow-2xl shadow-blue-500/5 ${isDark ? 'bg-gray-800/40 border-gray-700' : 'bg-white border-blue-50'}`}>
                <div className="flex items-center justify-between mb-8">
                  <h3 className={`text-2xl font-black flex items-center gap-3 ${isDark ? 'text-white' : 'text-[#2E4A70]'}`}>
                    <TrendingUp className="w-6 h-6 text-green-500" /> Rendimiento por Especialidad
                  </h3>
                  <span className="text-[10px] font-black opacity-40 uppercase tracking-widest">Aciertos vs Fallos</span>
                </div>

                <div className="space-y-6 max-h-[300px] overflow-y-auto pr-4 custom-scrollbar">
                  {loadingMetrics ? (
                    [1,2,3].map(i => <div key={i} className="h-12 w-full bg-gray-200/10 animate-pulse rounded-xl"></div>)
                  ) : metrics.performanceBySubtheme.length === 0 ? (
                    <div className="text-center py-10 opacity-30 italic font-medium">No hay suficientes datos analíticos aún.</div>
                  ) : metrics.performanceBySubtheme.map((item, idx) => (
                    <div key={idx} className="space-y-2">
                      <div className="flex justify-between items-end">
                        <span className="text-sm font-black truncate max-w-[200px]">{item.name}</span>
                        <span className={`text-xs font-black ${item.percentage > 70 ? 'text-green-500' : item.percentage > 40 ? 'text-orange-500' : 'text-red-500'}`}>
                          {item.percentage}% Dominio
                        </span>
                      </div>
                      <div className="w-full h-4 bg-gray-200/10 rounded-full overflow-hidden flex">
                        <div 
                          className="h-full bg-gradient-to-r from-green-400 to-green-600 transition-all duration-1000" 
                          style={{ width: `${item.percentage}%` }}
                        />
                        <div 
                          className="h-full bg-gradient-to-r from-orange-400 to-red-600 opacity-30 transition-all duration-1000" 
                          style={{ width: `${100 - item.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Sección de Tarjetas Críticas - Desplegable en móvil para evitar scroll largo */}
          <div className={`w-full p-6 sm:p-10 rounded-[2rem] border shadow-xl animate-gradient-shift ${
            isDark 
              ? 'bg-gray-900/40 border-gray-800 shadow-gray-900/20' 
              : 'border-blue-900/20 bg-gradient-to-br from-[#1a2e4d] via-[#2E4A70] to-[#3b82f6] shadow-blue-500/20'
          }`}>
            <div className={`text-center ${showCriticalCards || metrics.criticalCards.length === 0 ? 'mb-8 sm:mb-10' : 'mb-2'}`}>
              <h3 className={`text-3xl sm:text-5xl font-bold mb-3 sm:mb-4 ${isDark ? 'text-white' : 'text-white'}`}>
                Tus Tarjetas Críticas
              </h3>
              <p className={`text-base sm:text-xl max-w-2xl mx-auto ${metrics.criticalCards.length > 0 ? 'mb-6' : 'mb-8'} ${isDark ? 'text-gray-300' : 'text-blue-100/80'}`}>
                Conceptos que requieren refuerzo inmediato
              </p>

              {!loadingMetrics && metrics.criticalCards.length > 0 && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setShowCriticalCards((prev) => !prev)}
                    aria-expanded={showCriticalCards}
                    className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                  >
                    <span>
                      {showCriticalCards
                        ? `Ocultar tarjetas (${metrics.criticalCards.length})`
                        : `Desplegar tarjetas críticas (${metrics.criticalCards.length})`}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 transition-transform duration-200 ${
                        showCriticalCards ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </div>
              )}
            </div>

            {loadingMetrics ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {[1,2,3].map(i => <div key={i} className="h-40 w-full bg-gray-100 animate-pulse rounded-[2rem]"></div>)}
              </div>
            ) : metrics.criticalCards.length === 0 ? (
              <div className="py-10 flex flex-col items-center justify-center opacity-60 text-center">
                <Activity className="w-12 h-12 mb-4 text-green-400" />
                <p className="text-lg font-bold uppercase tracking-widest text-white">¡Felicidades! No tienes debilidades críticas.</p>
              </div>
            ) : showCriticalCards && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 max-h-[65vh] overflow-y-auto pr-1 custom-scrollbar">
                {metrics.criticalCards.map((card, idx) => (
                  <div 
                    key={idx} 
                    onClick={() => setSelectedCardForRadiography({
                      ...card,
                      pregunta: criticalQuestions[card.id] || 'Cargando pregunta...'
                    })}
                    className={`group p-6 rounded-[2rem] border flex flex-col justify-between transition-all hover:shadow-2xl cursor-pointer min-h-[180px] ${
                    isDark ? 'bg-gray-800 border-gray-700 hover:border-blue-500/50' : 'bg-white border-gray-100 shadow-sm hover:border-blue-200'
                  }`}>
                    <div className="space-y-4">
                      <div className="flex justify-between items-start gap-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-50 text-gray-500'}`}>
                          {card.subtema}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] font-black bg-red-50 text-red-500 px-3 py-1 rounded-full border border-red-100 shrink-0">
                          {card.totalFallos} FALLOS
                        </span>
                      </div>
                      <p className={`text-lg font-black leading-tight line-clamp-3 ${isDark ? 'text-white' : 'text-[#2E4A70]'}`}>
                        &ldquo;{criticalQuestions[card.id] || 'Cargando pregunta...'}&rdquo;
                      </p>
                    </div>
                    
                    <div className="mt-4 flex items-center justify-between text-[10px] font-black uppercase tracking-widest opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <span className="text-blue-500">Ver Radiografía</span>
                      <ArrowRightCircle className="w-4 h-4 text-blue-500" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Explorador Responsivo (Abajo): Especialidad (Paso 1) -> Subtemas (Paso 2) */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
          
          {/* PASO 1: ESPECIALIDADES (Chips compactos en móvil, lista vertical acotada en desktop) */}
          <div className="lg:col-span-4">
            <div
              className={`p-4 sm:p-5 rounded-2xl sm:rounded-3xl border shadow-sm ${
                isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-3.5">
                <h2 className={`text-base sm:text-lg font-extrabold flex items-center gap-2 ${isDark ? 'text-white' : 'text-[#1a2639]'}`}>
                  <BookOpen className={`w-4 h-4 sm:w-5 sm:h-5 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
                  <span>Especialidades</span>
                </h2>
                <span
                  className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                    isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
                  }`}
                >
                  Paso 1
                </span>
              </div>

              <div className="relative mb-3.5">
                <Search
                  className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                    isDark ? 'text-blue-200/70' : 'text-[#2E4A70]/70'
                  }`}
                />
                <input
                  type="text"
                  placeholder="Buscar área médica..."
                  aria-label="Buscar especialidad médica"
                  className={`w-full pl-10 pr-4 py-2.5 rounded-xl text-sm border outline-none transition-colors ${
                    isDark
                      ? 'bg-[#162235] border-white/15 focus:border-[#24B0BA] text-white placeholder:text-blue-200/50'
                      : 'bg-[#FFF9F0] border-[#2E4A70]/20 focus:border-[#014ba0] focus:bg-white text-[#1a2639] placeholder:text-[#2E4A70]/55'
                  }`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8 gap-2.5">
                  <Loader2 className={`animate-spin w-5 h-5 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
                  <span className={`text-xs font-bold ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                    Cargando áreas...
                  </span>
                </div>
              ) : filteredCategories.length === 0 ? (
                <div className={`text-center py-6 text-xs font-semibold ${isDark ? 'text-blue-200/70' : 'text-[#2E4A70]'}`}>
                  No se encontraron áreas médicas.
                </div>
              ) : (
                <>
                  {/* Móvil/Tablet: Chips táctiles envolventes que no roban altura vertical */}
                  <div className="flex flex-wrap gap-2 lg:hidden">
                    {filteredCategories.map((cat) => {
                      const isActive = selectedCat?.id === cat.id;
                      const totalCatCards = catCardCounts[cat.id] || 0;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => handleSelectCategory(cat, true)}
                          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                            isActive
                              ? 'bg-[#014ba0] border-[#014ba0] text-white shadow-sm'
                              : isDark
                              ? 'bg-[#162235] border-white/15 text-blue-100 hover:border-[#24B0BA]'
                              : 'bg-[#FFF9F0] border-[#2E4A70]/20 text-[#1a2639] hover:border-[#014ba0]'
                          }`}
                        >
                          <span>{cat.name}</span>
                          {totalCatCards > 0 && (
                            <span
                              className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold tabular-nums ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : isDark
                                  ? 'bg-white/10 text-[#24B0BA]'
                                  : 'bg-[#014ba0]/10 text-[#014ba0]'
                              }`}
                            >
                              {totalCatCards}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Desktop: Lista vertical compacta y acotada */}
                  <div className="hidden lg:block space-y-2 max-h-[420px] overflow-y-auto pr-1 custom-scrollbar">
                    {filteredCategories.map((cat) => {
                      const isActive = selectedCat?.id === cat.id;
                      const totalCatCards = catCardCounts[cat.id] || 0;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => handleSelectCategory(cat, false)}
                          className={`w-full text-left flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                            isActive
                              ? 'bg-[#014ba0] border-[#014ba0] text-white shadow-md'
                              : isDark
                              ? 'bg-[#162235]/80 border-white/10 text-blue-50 hover:border-[#24B0BA]/60'
                              : 'bg-[#FFF9F0]/80 border-[#2E4A70]/15 text-[#1a2639] hover:border-[#014ba0]/40 hover:bg-white'
                          }`}
                        >
                          <div className="min-w-0">
                            <span className="font-bold text-sm block truncate">{cat.name}</span>
                            {totalCatCards > 0 && (
                              <span
                                className={`text-[11px] font-semibold ${
                                  isActive
                                    ? 'text-blue-100'
                                    : isDark
                                    ? 'text-blue-200/70'
                                    : 'text-[#2E4A70]'
                                }`}
                              >
                                {totalCatCards} tarjetas
                              </span>
                            )}
                          </div>
                          <ChevronRight
                            className={`w-4 h-4 shrink-0 transition-transform ${
                              isActive ? 'text-white translate-x-0.5' : isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* PASO 2: SUBTEMAS / MAZOS DE ESTUDIO */}
          <div ref={subthemesPanelRef} className="lg:col-span-8">
            <div
              className={`p-4 sm:p-6 rounded-2xl sm:rounded-3xl border shadow-sm min-h-[340px] flex flex-col ${
                isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15'
              }`}
            >
              {selectedCat ? (
                <div className="flex flex-col h-full gap-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/10" style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(46,74,112,0.14)' }}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                            isDark ? 'bg-[#24B0BA]/20 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
                          }`}
                        >
                          Paso 2 · Área Seleccionada
                        </span>
                        {!loadingSub && (
                          <span className={`text-xs font-bold ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                            {subthemes.length} {subthemes.length === 1 ? 'tema' : 'temas'}
                          </span>
                        )}
                      </div>
                      <h3 className={`text-xl sm:text-3xl font-black tracking-tight truncate ${isDark ? 'text-white' : 'text-[#1a2639]'}`}>
                        {selectedCat.name}
                      </h3>
                    </div>

                    {subthemes.length > 4 && (
                      <div className="relative w-full sm:w-56 shrink-0">
                        <Search
                          className={`absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${
                            isDark ? 'text-blue-200/70' : 'text-[#2E4A70]/70'
                          }`}
                        />
                        <input
                          type="text"
                          value={subthemeSearch}
                          onChange={(e) => setSubthemeSearch(e.target.value)}
                          placeholder="Filtrar subtema..."
                          aria-label="Filtrar subtemas"
                          className={`w-full pl-8 pr-3 py-2 rounded-xl text-xs border outline-none ${
                            isDark
                              ? 'bg-[#162235] border-white/15 focus:border-[#24B0BA] text-white placeholder:text-blue-200/50'
                              : 'bg-[#FFF9F0] border-[#2E4A70]/20 focus:border-[#014ba0] focus:bg-white text-[#1a2639]'
                          }`}
                        />
                      </div>
                    )}
                  </div>

                  {loadingSub ? (
                    <div className="flex-grow flex flex-col items-center justify-center py-14 gap-3">
                      <Loader2 className={`animate-spin w-9 h-9 ${isDark ? 'text-[#24B0BA]' : 'text-[#014ba0]'}`} />
                      <p className={`font-bold text-xs uppercase tracking-wider ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`}>
                        Cargando temas...
                      </p>
                    </div>
                  ) : filteredSubthemes.length === 0 ? (
                    <div className="flex-grow flex flex-col items-center justify-center text-center py-12">
                      <Layers className={`w-12 h-12 mb-3 opacity-40 ${isDark ? 'text-blue-200' : 'text-[#2E4A70]'}`} />
                      <p className={`text-base font-bold ${isDark ? 'text-blue-100' : 'text-[#1a2639]'}`}>
                        {subthemes.length === 0 ? 'Sin temas registrados en esta área' : 'Ningún subtema coincide con la búsqueda'}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
                      {filteredSubthemes.map((sub) => {
                        const cleanName = sub.name?.trim();
                        const masteredCount = masteredCounts[cleanName] || 0;
                        const isOpening = openingSubtheme === sub.name;
                        return (
                          <div
                            key={sub.id}
                            onClick={() => startStudy(sub.name)}
                            onMouseEnter={() => prewarmSubtheme(sub.name)}
                            onFocus={() => prewarmSubtheme(sub.name)}
                            onTouchStart={() => prewarmSubtheme(sub.name)}
                            role="button"
                            tabIndex={0}
                            aria-busy={isOpening}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                startStudy(sub.name);
                              }
                            }}
                            className={`group flex flex-col justify-between p-4 rounded-2xl border transition-all cursor-pointer ${
                              isOpening ? 'opacity-85 pointer-events-none scale-[0.99]' : ''
                            } ${
                              isDark
                                ? 'bg-[#162235] border-white/10 hover:border-[#24B0BA] text-white'
                                : 'bg-[#FFF9F0] border-[#2E4A70]/15 hover:border-[#014ba0] hover:bg-white hover:shadow-md text-[#1a2639]'
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <div
                                  className={`p-2.5 rounded-xl border ${
                                    isDark
                                      ? 'bg-[#2E4A70]/60 border-white/10 text-[#24B0BA]'
                                      : 'bg-white border-[#2E4A70]/10 text-[#014ba0]'
                                  }`}
                                >
                                  <GraduationCap className="w-5 h-5" />
                                </div>

                                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-[#014ba0] bg-[#014ba0]/10 px-2.5 py-1 rounded-full" style={isDark ? { backgroundColor: 'rgba(36,176,186,0.18)', color: '#24B0BA' } : undefined}>
                                  {isOpening ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      <span>Abriendo...</span>
                                    </>
                                  ) : (
                                    <>
                                      <span>Estudiar</span>
                                      <ArrowRightCircle className="w-3.5 h-3.5" />
                                    </>
                                  )}
                                </span>
                              </div>

                              <h4 className="font-extrabold text-base leading-snug mb-3 break-words">
                                {sub.name}
                              </h4>
                            </div>

                            <div className="flex items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(46,74,112,0.1)' }}>
                              <span className="text-[11px] bg-[#014ba0] text-white px-2.5 py-1 rounded-full font-bold tabular-nums">
                                {sub.cardCount} {sub.cardCount === 1 ? 'tarjeta' : 'tarjetas'}
                              </span>

                              {masteredCount > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => handleRestore(e, cleanName)}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold transition-colors cursor-pointer ${
                                    isDark
                                      ? 'border-white/15 text-blue-200 hover:border-[#24B0BA] hover:text-white'
                                      : 'border-[#2E4A70]/25 bg-white text-[#2E4A70] hover:border-[#014ba0] hover:text-[#014ba0]'
                                  }`}
                                  title="Restaurar tarjetas dominadas"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Restaurar ({masteredCount})</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center text-center py-12">
                  <div
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
                      isDark ? 'bg-[#24B0BA]/15 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
                    }`}
                  >
                    <Sparkles className="w-8 h-8" />
                  </div>
                  <p className={`text-base font-extrabold max-w-xs ${isDark ? 'text-blue-100' : 'text-[#1a2639]'}`}>
                    Elige una especialidad para ver sus temas disponibles
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Modal de Radiografía */}
        <CardRadiographyModal 
          isOpen={!!selectedCardForRadiography}
          onClose={() => setSelectedCardForRadiography(null)}
          card={selectedCardForRadiography}
          isDark={isDark}
        />
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
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: ${isDark ? '#374151' : '#d1d5db'}; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: ${isDark ? '#4b5563' : '#9ca3af'}; }
      `}</style>
    </div>
  );
}


