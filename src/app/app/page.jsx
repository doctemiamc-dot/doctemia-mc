'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import useSWR from 'swr';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { fetcher } from '@/lib/fetcher';

import {
  FileText,
  Video,
  UserCircle,
  Clock,
  Cloud,
  CloudSun,
  Cloudy,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Loader,
  BookMarked,
  Sun,
  ArrowRight,
  Stethoscope,
  Target,
  Zap,
  Award,
  MapPin,
  Linkedin,
  Code2,
  ExternalLink,
  RotateCw,
} from 'lucide-react';

const CUSTOM_COLORS = {
  primary: '#73C7E3',
  background: '#FFF9F0',
  secondary: '#24B0BA',
  neutral: '#F0F2F2',
  dark: '#2E4A70',
  gold: '#CF8A40',
  navy: '#014ba0',
};

// --- Hook y Wrapper ligero de animación al hacer scroll (GPU-only, una sola vez) ---
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  return reduced;
}

function RevealOnScroll({ children, className = '', delayMs = 0, distance = 20 }) {
  const ref = useRef(null);
  const reducedMotion = usePrefersReducedMotion();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (reducedMotion || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return undefined;
    }

    const el = ref.current;
    if (!el) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [reducedMotion]);

  const show = reducedMotion || isVisible;

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: show ? 1 : 0,
        transform: show ? 'translate3d(0, 0, 0)' : `translate3d(0, ${distance}px, 0)`,
        transitionProperty: reducedMotion ? 'none' : 'opacity, transform',
        transitionDuration: '600ms',
        transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
        transitionDelay: show && !reducedMotion ? `${delayMs}ms` : '0ms',
      }}
    >
      {children}
    </div>
  );
}

// --- Reloj en vivo aislado ---
function LiveClock({ color }) {
  const [currentTime, setCurrentTime] = useState(() =>
    typeof window !== 'undefined'
      ? new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      : ''
  );

  useEffect(() => {
    const updateClock = () => {
      setCurrentTime(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 tabular-nums">
      <Clock size={16} style={{ color }} />
      <span style={{ color }}>{currentTime}</span>
    </div>
  );
}

// --- Fondo sutil optimizado (ligero en GPU para no competir con el video Hero) ---
const AnimatedBackground = React.memo(function AnimatedBackground({ isDark }) {
  const backgroundStyle = useMemo(() => {
    if (isDark) {
      return {
        background: `linear-gradient(135deg,
          #060A13 0%,
          rgba(36, 176, 186, 0.06) 35%,
          rgba(1, 75, 160, 0.09) 65%,
          #060A13 100%)`,
      };
    }
    return {
      background: `linear-gradient(135deg,
        #FFF9F0 0%,
        rgba(240, 242, 242, 0.85) 35%,
        rgba(115, 199, 227, 0.12) 65%,
        #FFF9F0 100%)`,
    };
  }, [isDark]);

  const lineColor = isDark ? 'rgba(115, 199, 227, 0.08)' : 'rgba(36, 176, 186, 0.07)';
  const orb1 = isDark ? 'rgba(115, 199, 227, 0.16)' : 'rgba(115, 199, 227, 0.14)';
  const orb2 = isDark ? 'rgba(207, 138, 64, 0.12)' : 'rgba(207, 138, 64, 0.10)';

  return (
    <div
      className="fixed inset-0 -z-50 overflow-hidden pointer-events-none"
      style={backgroundStyle}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 opacity-75"
        style={{
          backgroundImage: `linear-gradient(to right, ${lineColor} 1px, transparent 1px), linear-gradient(to bottom, ${lineColor} 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
        }}
      />

      <div
        className="hidden md:block absolute w-96 h-96 rounded-full blur-3xl animate-float-slow opacity-50"
        style={{
          background: `radial-gradient(circle, ${orb1} 0%, transparent 70%)`,
          top: '14%',
          left: '8%',
        }}
      />
      <div
        className="hidden md:block absolute w-80 h-80 rounded-full blur-3xl animate-float-slow opacity-45"
        style={{
          background: `radial-gradient(circle, ${orb2} 0%, transparent 70%)`,
          bottom: '16%',
          right: '10%',
          animationDelay: '4s',
        }}
      />
    </div>
  );
});

// --- Tarjeta de Equipo Médico con giro 3D accesible ---
function TeamMemberCard({ name, role, imageSrc, description, Icon, isDark }) {
  const [isFlipped, setIsFlipped] = useState(false);

  const frontSurface = isDark
    ? 'bg-[#152238]/95 border-white/10 text-white hover:border-[#24B0BA]/55'
    : 'bg-white/95 border-[#2E4A70]/15 text-[#1a2639] hover:border-[#73C7E3]';
  const backSurface = isDark
    ? 'bg-[#0A111F] border-[#24B0BA]/35 text-slate-200'
    : 'bg-[#FAF5EB] border-[#73C7E3]/45 text-[#2E4A70]';

  const handleToggle = () => setIsFlipped((prev) => !prev);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isFlipped}
      aria-label={`${name}, ${role}. ${isFlipped ? 'Volver al frente' : 'Ver biografía'}`}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      className="w-full max-w-sm mx-auto [perspective:1100px] cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#24B0BA] rounded-2xl"
    >
      <div
        className={`relative w-full h-[22rem] sm:h-96 rounded-2xl transition-transform duration-700 [transform-style:preserve-3d] ${
          isFlipped ? '[transform:rotateY(180deg)]' : 'group-hover:-translate-y-1.5'
        }`}
      >
        {/* Cara Frontal */}
        <div
          className={`absolute inset-0 w-full h-full [backface-visibility:hidden] rounded-2xl border p-6 flex flex-col items-center justify-center text-center transition-colors ${frontSurface}`}
        >
          <div
            className="w-28 h-28 sm:w-32 sm:h-32 rounded-full overflow-hidden border-[3px] mb-4 transition-transform duration-500 group-hover:scale-105 shrink-0"
            style={{ borderColor: CUSTOM_COLORS.primary }}
          >
            <Image
              src={imageSrc}
              alt={`Foto de ${name}`}
              width={128}
              height={128}
              className="object-cover w-full h-full"
              onError={(e) => {
                e.currentTarget.src = `https://placehold.co/128x128/${
                  isDark ? '1e293b/cbd5e1' : 'FAF5EB/2E4A70'
                }?text=${name.charAt(0)}`;
              }}
            />
          </div>

          <h3 className="text-xl sm:text-2xl font-extrabold leading-snug">{name}</h3>

          <div className="flex items-center gap-2 mt-2">
            {Icon && <Icon className="w-4 h-4 shrink-0" style={{ color: CUSTOM_COLORS.secondary }} />}
            <p className="text-sm font-bold" style={{ color: CUSTOM_COLORS.secondary }}>
              {role}
            </p>
          </div>

          <div
            className={`mt-5 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${
              isDark
                ? 'bg-[#73C7E3]/15 text-[#73C7E3] group-hover:bg-[#73C7E3]/25'
                : 'bg-[#73C7E3]/15 text-[#014ba0] group-hover:bg-[#73C7E3]/25'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Toca para saber más</span>
          </div>
        </div>

        {/* Cara Trasera */}
        <div
          className={`absolute inset-0 w-full h-full [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-2xl border p-6 sm:p-7 flex flex-col items-center justify-between text-center ${backSurface}`}
        >
          <div className="space-y-3 my-auto">
            <h4
              className="text-lg sm:text-xl font-extrabold"
              style={{ color: isDark ? CUSTOM_COLORS.primary : CUSTOM_COLORS.navy }}
            >
              Sobre {name.split(' ')[0]}
            </h4>
            <p className="text-sm sm:text-base leading-relaxed">{description}</p>
          </div>

          <div
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold ${
              isDark ? 'bg-white/10 text-slate-200' : 'bg-white text-[#2E4A70] border border-[#2E4A70]/15'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Toca para volver</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Tarjeta de Acceso Rápido (contraste corregido en modo oscuro) ---
function AccessCard({ href, title, description, Icon, isDark }) {
  const cardSurface = isDark
    ? 'bg-[#152238]/95 border-white/10 hover:border-[#24B0BA]/55'
    : 'bg-white/95 border-[#2E4A70]/15 hover:border-[#014ba0]/45';

  return (
    <Link
      href={href}
      className={`block border rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1.5 group relative overflow-hidden ${cardSurface}`}
    >
      <div className="flex items-center gap-3.5 mb-3.5 relative z-10">
        {Icon && (
          <div
            className={`p-2.5 rounded-xl transition-transform duration-300 group-hover:scale-110 shrink-0 ${
              isDark ? 'bg-[#24B0BA]/15 text-[#24B0BA]' : 'bg-[#014ba0]/10 text-[#014ba0]'
            }`}
          >
            <Icon className="w-5 h-5" />
          </div>
        )}
        <h3 className={`text-lg font-extrabold ${isDark ? 'text-white' : 'text-[#1a2639]'}`}>
          {title}
        </h3>
      </div>

      <p className={`text-sm leading-relaxed relative z-10 ${isDark ? 'text-slate-300' : 'text-[#2E4A70]'}`}>
        {description}
      </p>

      <div
        className={`mt-4 inline-flex items-center gap-1 text-xs font-bold ${
          isDark ? 'text-[#73C7E3]' : 'text-[#014ba0]'
        }`}
      >
        <span>Ir ahora</span>
        <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

// --- Tarjeta de Características DORADAS ---
function FeatureCard({ Icon, title, description, isDark }) {
  const cardSurface = isDark
    ? 'bg-[#152238]/95 border-white/10 hover:border-[#CF8A40]/60'
    : 'bg-white/95 border-[#2E4A70]/15 hover:border-[#CF8A40]/70';

  return (
    <div
      className={`border rounded-2xl p-7 sm:p-8 text-center flex flex-col items-center h-full transition-all duration-300 hover:-translate-y-1.5 group relative overflow-hidden ${cardSurface}`}
    >
      <div
        className="mb-5 p-4 rounded-2xl transition-transform duration-300 group-hover:scale-110"
        style={{ backgroundColor: `${CUSTOM_COLORS.gold}20` }}
      >
        <Icon className="w-9 h-9" style={{ color: CUSTOM_COLORS.gold }} />
      </div>
      <h3 className={`text-xl sm:text-2xl font-extrabold mb-3 ${isDark ? 'text-white' : 'text-[#1a2639]'}`}>
        {title}
      </h3>
      <p className={`text-sm sm:text-base leading-relaxed ${isDark ? 'text-slate-300' : 'text-[#2E4A70]'}`}>
        {description}
      </p>
    </div>
  );
}

export default function UserHomePage() {
  const { user } = useAuth();
  const { isDark, isLoaded } = useTheme();
  const [location, setLocation] = useState({ latitude: -17.39, longitude: -66.16, city: 'Cochabamba' });

  const heroSectionRef = useRef(null);
  const heroVideoRef = useRef(null);
  const reducedMotion = usePrefersReducedMotion();
  const [saveDataMode, setSaveDataMode] = useState(false);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.connection?.saveData) {
      setSaveDataMode(true);
    }
  }, []);

  const shouldRenderVideo = !reducedMotion && !saveDataMode;

  // Pausar video automáticamente cuando el Hero no es visible o la pestaña pasa a segundo plano
  useEffect(() => {
    if (!shouldRenderVideo) return undefined;
    const sectionEl = heroSectionRef.current;
    const videoEl = heroVideoRef.current;
    if (!sectionEl || !videoEl) return undefined;

    let heroInView = true;

    const syncPlayback = () => {
      if (!videoEl) return;
      if (heroInView && !document.hidden) {
        videoEl.play().catch(() => {
          // Ignorar bloqueo de autoplay si ocurre
        });
      } else {
        videoEl.pause();
      }
    };

    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              const entry = entries[0];
              if (!entry) return;
              heroInView = entry.isIntersecting;
              syncPlayback();
            },
            { threshold: 0.05 }
          )
        : null;

    observer?.observe(sectionEl);
    document.addEventListener('visibilitychange', syncPlayback);

    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', syncPlayback);
    };
  }, [shouldRenderVideo, isLoaded]);

  const handleRequestLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          city: 'Tu ubicación',
        });
      },
      () => {
        // Mantiene Cochabamba por defecto
      }
    );
  };

  const weatherUrl =
    location.latitude && location.longitude
      ? `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,weather_code`
      : null;

  const { data: weatherData } = useSWR(weatherUrl, fetcher);

  const getWeatherDetails = (code) => {
    if (code === 0) return { icon: <Sun size={18} />, description: 'Despejado' };
    if (code >= 1 && code <= 3) return { icon: <CloudSun size={18} />, description: 'Parcialmente nublado' };
    if (code >= 45 && code <= 48) return { icon: <Cloudy size={18} />, description: 'Niebla' };
    if (code >= 51 && code <= 67) return { icon: <CloudRain size={18} />, description: 'Lluvia' };
    if (code >= 71 && code <= 77) return { icon: <CloudSnow size={18} />, description: 'Nieve' };
    if (code >= 95 && code <= 99) return { icon: <CloudLightning size={18} />, description: 'Tormenta' };
    return { icon: <Cloudy size={18} />, description: 'Brumoso' };
  };

  const weatherDetails = weatherData?.current
    ? getWeatherDetails(weatherData.current.weather_code)
    : null;

  const textColor = isDark ? 'text-white' : 'text-[#1a2639]';
  const secondaryTextColor = isDark ? 'text-slate-300' : 'text-[#2E4A70]';

  const userAccessLinks = useMemo(
    () => [
      {
        href: '/app/pagoUnicoCourses',
        title: 'Cursos',
        description: 'Descubre cursos de acceso permanente.',
        Icon: BookMarked,
      },
      {
        href: '/app/examen-test',
        title: 'Exámenes',
        description: 'Pon a prueba tus conocimientos.',
        Icon: FileText,
      },
      {
        href: '/app/clases-en-vivo',
        title: 'Clases en Vivo',
        description: 'Participa en sesiones interactivas.',
        Icon: Video,
      },
      {
        href: '/app/profile',
        title: 'Mi Perfil',
        description: 'Tu información personal y progreso.',
        Icon: UserCircle,
      },
    ],
    []
  );

  const creators = useMemo(
    () => [
      {
        name: 'Victor Hugo Saldaña Ortiz',
        initials: 'VS',
        imageSrc: '/images/DevVictor.png',
        role: 'Full-Stack Developer',
        href: 'https://www.linkedin.com/in/victor-hugo-saldana-ortiz-372a35271',
      },
      {
        name: 'Daniel Mancilla Tejerina',
        initials: 'DM',
        role: 'Full-Stack Developer',
        href: 'http://www.linkedin.com/in/daniel-mancilla-tejerina-126b07307',
      },
    ],
    []
  );

  if (!isLoaded) {
    return (
      <section
        className="min-h-[calc(100dvh-4rem)] flex items-center justify-center"
        style={{ backgroundColor: CUSTOM_COLORS.background }}
      >
        <div className="flex flex-col items-center gap-4">
          <Loader className="w-12 h-12 animate-spin" style={{ color: CUSTOM_COLORS.primary }} />
          <p className="font-semibold" style={{ color: CUSTOM_COLORS.dark }}>
            Cargando experiencia...
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className={`relative ${textColor}`}>
      <AnimatedBackground isDark={isDark} />

      <div className="relative z-10">
        {/* --- SECCIÓN 1: HERO CINEMATOGRÁFICO OPTIMIZADO --- */}
        <section
          ref={heroSectionRef}
          className="md:min-h-[calc(100dvh-4rem)] w-full flex flex-col items-center justify-center text-center text-white relative overflow-hidden px-4 py-10 sm:py-14 md:py-16"
          style={{
            background: isDark
              ? 'radial-gradient(circle at 30% 25%, #014ba0 0%, #121E34 55%, #060A13 100%)'
              : 'radial-gradient(circle at 30% 25%, #014ba0 0%, #1a2639 55%, #0f172a 100%)',
          }}
        >
          {shouldRenderVideo && (
            <video
              ref={heroVideoRef}
              src="/videos/video1.mp4"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              disablePictureInPicture
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover object-center z-0 pointer-events-none"
            />
          )}

          <div
            className={`absolute inset-0 z-10 ${
              isDark
                ? 'bg-gradient-to-b from-[#060A13]/70 via-[#121E34]/55 to-[#060A13]/92'
                : 'bg-gradient-to-b from-[#0f172a]/70 via-[#0f172a]/60 to-[#0f172a]/85'
            }`}
            aria-hidden="true"
          />

          <div className="relative z-20 max-w-5xl mx-auto flex flex-col items-center animate-fade-in">
            <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-2 mb-5 sm:mb-7 py-2 px-4 sm:px-5 rounded-full text-xs sm:text-sm bg-slate-950/60 md:bg-slate-950/45 md:backdrop-blur-md border border-white/20">
              {weatherDetails && (
                <>
                  <div className="flex items-center gap-2" title={weatherDetails.description}>
                    <span style={{ color: CUSTOM_COLORS.gold }}>{weatherDetails.icon}</span>
                    <span className="tabular-nums font-semibold">
                      {Math.round(weatherData.current.temperature_2m)}°C
                    </span>
                  </div>
                  <div className="w-px h-4 bg-white/25 hidden sm:block" />
                </>
              )}
              <button
                type="button"
                onClick={handleRequestLocation}
                title="Actualizar con mi ubicación actual"
                className="flex items-center gap-1.5 hover:opacity-90 cursor-pointer bg-transparent border-0 p-0 font-semibold"
              >
                <MapPin size={15} style={{ color: CUSTOM_COLORS.primary }} />
                <span style={{ color: CUSTOM_COLORS.primary }}>{location.city}</span>
              </button>
              <div className="w-px h-4 bg-white/25 hidden sm:block" />
              <LiveClock color={CUSTOM_COLORS.secondary} />
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-black tracking-tight leading-[1.08] mb-5 text-shadow-lg animate-slide-up-delay-1">
              BIENVENIDO A DOCTEMIA MC
              <br />
              <span
                className="bg-clip-text text-transparent animate-gradient inline-block mt-1"
                style={{
                  backgroundImage: `linear-gradient(45deg, ${CUSTOM_COLORS.primary}, ${CUSTOM_COLORS.secondary}, ${CUSTOM_COLORS.gold})`,
                  backgroundSize: '200% 200%',
                }}
              >
                Aprendizaje Médico
              </span>
              .
            </h1>

            <p className="text-base sm:text-lg md:text-xl max-w-2xl mx-auto text-slate-200 mb-8 leading-relaxed animate-slide-up-delay-2">
              Hola,{' '}
              <span
                className="font-bold text-white px-2.5 py-0.5 rounded-lg inline-block"
                style={{ backgroundColor: `${CUSTOM_COLORS.primary}38` }}
              >
                {user?.fullName || user?.email || 'Usuario'}
              </span>
              . listo para prepararte...
            </p>

            <a
              href="#introduccion"
              className="inline-flex items-center justify-center gap-2 px-7 py-3 rounded-full text-base sm:text-lg font-bold text-white transition-transform duration-300 hover:scale-105 animate-slide-up-delay-3 group"
              style={{
                background: `linear-gradient(45deg, ${CUSTOM_COLORS.primary}, ${CUSTOM_COLORS.secondary})`,
                boxShadow: '0 10px 25px rgba(115, 199, 227, 0.28)',
              }}
            >
              <span>Descubre Más</span>
              <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
          </div>

          <div
            className="hidden sm:flex absolute bottom-6 left-1/2 -translate-x-1/2 z-20"
            aria-hidden="true"
          >
            <div className="w-6 h-10 border-2 border-white/45 rounded-full flex justify-center">
              <div className="w-1 h-3 bg-white/75 rounded-full mt-2 animate-pulse" />
            </div>
          </div>
        </section>

        {/* --- SECCIÓN 2: INTRODUCCIÓN --- */}
        <section id="introduccion" className="w-full py-12 sm:py-16 md:py-24 bg-transparent">
          <div className="max-w-4xl mx-auto text-center px-4 sm:px-6">
            <RevealOnScroll>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight leading-tight">
                Tu vocación. Necesita una buena prepararación.
              </h2>
            </RevealOnScroll>
            <RevealOnScroll delayMs={120}>
              <p className={`mt-5 text-base sm:text-lg md:text-xl leading-relaxed ${secondaryTextColor} max-w-3xl mx-auto`}>
                Clases claras. Casos reales. Simulacros tipo examen. Hecho por médicos jóvenes, para
                quienes se preparan con vocación. Estudia lo que cae. Aprende lo que importa. Desde
                donde quieras, cuando quieras.
              </p>
            </RevealOnScroll>
          </div>
        </section>

        {/* --- SECCIÓN 3: METODOLOGÍA --- */}
        <section id="metodologia" className="py-16 md:py-24 bg-transparent">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 sm:mb-14">
              <RevealOnScroll>
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight">
                  Una Metodología Diseñada para Ti
                </h2>
              </RevealOnScroll>
              <RevealOnScroll delayMs={100}>
                <p className={`mt-3.5 text-base sm:text-lg md:text-xl max-w-3xl mx-auto ${secondaryTextColor}`}>
                  Combinamos ciencia, tecnología y pedagogía para asegurar tu éxito.
                </p>
              </RevealOnScroll>
            </div>

            <div className="grid gap-6 sm:gap-8 md:grid-cols-2 lg:grid-cols-3">
              <RevealOnScroll delayMs={80}>
                <FeatureCard
                  Icon={Target}
                  title="Aprendizaje Enfocado"
                  description="Contenido directo y relevante. Cada clase está diseñada para maximizar tu comprensión y retención de información clave."
                  isDark={isDark}
                />
              </RevealOnScroll>
              <RevealOnScroll delayMs={160}>
                <FeatureCard
                  Icon={Zap}
                  title="Tecnología Interactiva"
                  description="Una plataforma moderna con clases en vivo, exámenes simulados y herramientas que se adaptan a tu ritmo de aprendizaje."
                  isDark={isDark}
                />
              </RevealOnScroll>
              <RevealOnScroll delayMs={240}>
                <FeatureCard
                  Icon={Award}
                  title="Calidad Comprobada"
                  description="Clases impartidas por expertos de alta calidad para darte la confianza que necesitas para superar cualquier reto."
                  isDark={isDark}
                />
              </RevealOnScroll>
            </div>
          </div>
        </section>

        {/* --- SECCIÓN 4: CONOCE AL EQUIPO Y CREADORES --- */}
        <section id="equipo" className="py-16 md:py-24 bg-transparent">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 sm:mb-14">
              <RevealOnScroll>
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight">
                  Guiado por Expertos
                </h2>
              </RevealOnScroll>
              <RevealOnScroll delayMs={100}>
                <p className={`mt-3.5 text-base sm:text-lg md:text-xl max-w-3xl mx-auto ${secondaryTextColor}`}>
                  Profesionales apasionados y dedicados a potenciar tu carrera médica.
                </p>
              </RevealOnScroll>
            </div>

            <div className="grid gap-8 sm:gap-10 md:grid-cols-2 lg:grid-cols-3">
              <RevealOnScroll delayMs={80}>
                <TeamMemberCard
                  name="Maria Jose Loaiza Marquez."
                  role="Medico"
                  imageSrc="/images/majo.png"
                  description="Médico especialista y educadora por vocación. Transforma temas médicos complejos en lecciones claras y memorables, preparándote para los desafíos del mundo real."
                  Icon={Stethoscope}
                  isDark={isDark}
                />
              </RevealOnScroll>
              <RevealOnScroll delayMs={160}>
                <TeamMemberCard
                  name="Pablo Aparicio Verdun"
                  role="Medico"
                  imageSrc="/images/chompi.png"
                  description="Médico con formación en educación superior. Combino la práctica clínica con la docencia, ayudando a estudiantes a prepararse para el examen de grado con enfoque en criterio, claridad y confianza."
                  Icon={Stethoscope}
                  isDark={isDark}
                />
              </RevealOnScroll>
              <RevealOnScroll delayMs={240}>
                <TeamMemberCard
                  name="Carolina Paz Rojas"
                  role="Medico"
                  imageSrc="/images/ciru.png"
                  description="Médico cirujano con experiencia clínica y vocación docente. Me dedico a la formación de pregrado y preparación para el Examen de Grado, con un enfoque claro, estructurado y centrado en el razonamiento clínico."
                  Icon={Stethoscope}
                  isDark={isDark}
                />
              </RevealOnScroll>

              {/* Tarjeta mejorada de Creadores y Desarrolladores */}
              <RevealOnScroll
                delayMs={120}
                className="col-span-1 md:col-span-2 lg:col-span-3 flex justify-center mt-2"
              >
                <div
                  className={`w-full max-w-4xl rounded-2xl border p-6 sm:p-8 transition-colors ${
                    isDark
                      ? 'bg-[#152238]/95 border-white/10 hover:border-[#24B0BA]/50'
                      : 'bg-white/95 border-[#2E4A70]/15 hover:border-[#014ba0]/35'
                  }`}
                >
                  <div className="flex flex-col md:flex-row items-center md:items-start gap-6 text-center md:text-left">
                    <div className="shrink-0">
                      <div
                        className={`w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden border-2 p-1 ${
                          isDark ? 'bg-[#0A111F]' : 'bg-[#FAF5EB]'
                        }`}
                        style={{ borderColor: CUSTOM_COLORS.primary }}
                      >
                        <Image
                          src="/images/logo.jpg"
                          alt="Logo del equipo de desarrollo"
                          width={112}
                          height={112}
                          className="object-cover w-full h-full rounded-xl"
                        />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5 mb-2">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold ${
                            isDark
                              ? 'bg-[#24B0BA]/15 text-[#24B0BA]'
                              : 'bg-[#014ba0]/10 text-[#014ba0]'
                          }`}
                        >
                          <Code2 className="w-3.5 h-3.5" />
                          <span>Ingeniería de Plataforma</span>
                        </span>
                      </div>

                      <h3
                        className={`text-2xl font-black tracking-tight ${
                          isDark ? 'text-white' : 'text-[#1a2639]'
                        }`}
                      >
                        Creadores y Desarrolladores
                      </h3>

                      <p
                        className={`mt-2 text-sm sm:text-base leading-relaxed ${
                          isDark ? 'text-slate-300' : 'text-[#2E4A70]'
                        }`}
                      >
                        La plataforma fue creada por Victor Hugo Saldaña Ortiz y Daniel Mancilla
                        Tejerina, desarrolladores Full-Stack responsables de diseñar e implementar
                        una experiencia de aprendizaje en línea intuitiva, eficiente y de alto nivel
                        tecnológico.
                      </p>

                      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                        {creators.map((dev) => (
                          <Link
                            key={dev.name}
                            href={dev.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`group flex items-center justify-between gap-3 p-3.5 rounded-xl border transition-all duration-200 hover:-translate-y-0.5 ${
                              isDark
                                ? 'bg-[#0A111F] border-white/10 hover:border-[#24B0BA]/55 text-white'
                                : 'bg-[#FAF5EB]/80 border-[#2E4A70]/15 hover:border-[#014ba0]/45 hover:bg-white text-[#1a2639]'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {dev.imageSrc ? (
                                <div
                                  className={`w-11 h-11 rounded-xl overflow-hidden border shrink-0 ${
                                    isDark ? 'border-[#73C7E3]/40' : 'border-[#014ba0]/25'
                                  }`}
                                >
                                  <Image
                                    src={dev.imageSrc}
                                    alt={`Foto de ${dev.name}`}
                                    width={44}
                                    height={44}
                                    className="object-cover object-top w-full h-full"
                                  />
                                </div>
                              ) : (
                                <span
                                  className={`w-11 h-11 rounded-xl font-black text-xs flex items-center justify-center shrink-0 ${
                                    isDark
                                      ? 'bg-[#24B0BA]/20 text-[#73C7E3]'
                                      : 'bg-[#014ba0]/10 text-[#014ba0]'
                                  }`}
                                >
                                  {dev.initials}
                                </span>
                              )}
                              <div className="min-w-0">
                                <div className="text-sm font-extrabold truncate">{dev.name}</div>
                                <div
                                  className={`text-xs font-semibold ${
                                    isDark ? 'text-slate-300' : 'text-[#2E4A70]'
                                  }`}
                                >
                                  {dev.role}
                                </div>
                              </div>
                            </div>

                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${
                                isDark
                                  ? 'bg-[#014ba0]/30 text-[#73C7E3] group-hover:bg-[#014ba0] group-hover:text-white'
                                  : 'bg-[#014ba0]/10 text-[#014ba0] group-hover:bg-[#014ba0] group-hover:text-white'
                              }`}
                            >
                              <Linkedin className="w-3.5 h-3.5" />
                              <ExternalLink className="w-3 h-3" />
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </RevealOnScroll>
            </div>
          </div>
        </section>

        {/* --- SECCIÓN 5: ACCESOS RÁPIDOS --- */}
        <section id="explora" className="py-16 md:py-24 relative overflow-hidden bg-transparent">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="text-center mb-12 sm:mb-14">
              <RevealOnScroll>
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight">
                  Tu Centro de Mando
                </h2>
              </RevealOnScroll>
              <RevealOnScroll delayMs={100}>
                <p className={`mt-3.5 text-base sm:text-lg md:text-xl max-w-2xl mx-auto ${secondaryTextColor}`}>
                  Accede a todas las herramientas que necesitas para triunfar.
                </p>
              </RevealOnScroll>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {userAccessLinks.map((linkItem, index) => (
                <RevealOnScroll key={linkItem.href} delayMs={index * 80}>
                  <AccessCard {...linkItem} isDark={isDark} />
                </RevealOnScroll>
              ))}
            </div>
          </div>
        </section>
      </div>

      <style jsx global>{`
        :root {
          --custom-primary: ${CUSTOM_COLORS.primary};
          --custom-background: ${CUSTOM_COLORS.background};
          --custom-secondary: ${CUSTOM_COLORS.secondary};
          --custom-neutral: ${CUSTOM_COLORS.neutral};
          --custom-dark: ${CUSTOM_COLORS.dark};
          --custom-gold: ${CUSTOM_COLORS.gold};
        }

        @keyframes fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translate3d(0, 22px, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        @keyframes gradient {
          0%,
          100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }

        @keyframes float-slow {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(12px, -18px, 0);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.8s ease-out;
        }

        .animate-slide-up-delay-1 {
          animation: slide-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
        }

        .animate-slide-up-delay-2 {
          animation: slide-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.3s both;
        }

        .animate-slide-up-delay-3 {
          animation: slide-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.45s both;
        }

        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient 4s ease infinite;
        }

        .animate-float-slow {
          animation: float-slow 16s ease-in-out infinite;
        }

        .text-shadow-lg {
          text-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        }

        html {
          scroll-behavior: smooth;
        }

        @media (prefers-reduced-motion: reduce) {
          .animate-fade-in,
          .animate-slide-up-delay-1,
          .animate-slide-up-delay-2,
          .animate-slide-up-delay-3,
          .animate-gradient,
          .animate-float-slow {
            animation: none !important;
          }
          html {
            scroll-behavior: auto;
          }
        }
      `}</style>
    </div>
  );
}
