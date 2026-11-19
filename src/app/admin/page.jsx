'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { fetcher } from '@/lib/fetcher';
import {
    Home, FileText, Users, Wallet, Video, QrCode, Star, 
    ShoppingBag, Tags, KeyRound, Gem, BookKey, Clock, Sun, 
    Cloud, CloudSun, Cloudy, CloudRain, CloudSnow, CloudLightning, Loader, MapPin
} from 'lucide-react';

// --- Reloj aislado para no re-renderizar todo el dashboard cada segundo ---
function AdminLiveClock({ isDark }) {
    const [currentTime, setCurrentTime] = useState('');

    useEffect(() => {
        const update = () => {
            setCurrentTime(
                new Date().toLocaleTimeString('es-ES', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                })
            );
        };
        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <span className={`font-semibold text-md tabular-nums ${isDark ? 'text-white' : 'text-gray-800'}`}>
            {currentTime}
        </span>
    );
}

// --- Componente para Tarjeta de Estadística ---
function StatCard({ title, value, icon, isLoading, colorClass }) {
    const { isDark } = useTheme();
    return (
        <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#162235] border-white/10' : 'bg-[#FFF9F0]/70 border-[#2E4A70]/15'}`}>
            <div className="flex items-center gap-4">
                <div className={`p-2 rounded-lg ${colorClass}`}>
                    {icon}
                </div>
                <div>
                    <div className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {isLoading ? <div className={`h-8 w-12 rounded-md animate-pulse ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`}></div> : value}
                    </div>
                    <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                        {title}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function AdminHomePage() {
    const { user } = useAuth();
    const { isDark, isLoaded } = useTheme();

    const { data: statsData, isLoading: usersLoading } = useSWR(
        '/api/users?paginated=1&action=stats',
        fetcher,
        { revalidateOnFocus: false, revalidateOnReconnect: false }
    );
    const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=-21.53&longitude=-64.72&current=temperature_2m,weather_code';
    const { data: weatherData, isLoading: weatherLoading } = useSWR(weatherUrl, fetcher, {
        revalidateOnFocus: false,
    });

    const stats = useMemo(() => ({
        total: statsData?.total || 0,
        premium: statsData?.premium || 0,
        pagoUnico: statsData?.pagoUnico || 0,
    }), [statsData]);

    const getWeatherDetails = (code) => {
        if (code === 0) return { icon: <Sun size={20}/>, description: "Despejado" };
        if (code === 1) return { icon: <CloudSun size={20}/>, description: "Principalmente despejado" };
        if (code === 2) return { icon: <Cloud size={20}/>, description: "Parcialmente nublado" };
        if (code === 3) return { icon: <Cloudy size={20}/>, description: "Nublado" };
        if (code >= 51 && code <= 67) return { icon: <CloudRain size={20}/>, description: "Lluvia" };
        if (code >= 71 && code <= 77) return { icon: <CloudSnow size={20}/>, description: "Nieve" };
        if (code >= 95 && code <= 99) return { icon: <CloudLightning size={20}/>, description: "Tormenta" };
        return { icon: <Cloudy size={20}/>, description: "Brumoso" };
    };
    
    const weatherDetails = weatherData ? getWeatherDetails(weatherData.current.weather_code) : null;

    const cardItems = [
        { href: '/admin/users', title: 'Usuarios', desc: 'Administra los usuarios registrados', icon: <Users/> },
        { href: '/admin/courses', title: 'Cursos Premium', desc: 'Gestiona el catálogo de suscripción', icon: <Star/> },
        { href: '/admin/Cursos_Pago_Unico', title: 'Cursos Pago Único', desc: 'Gestiona los cursos de acceso permanente', icon: <ShoppingBag/> },
        { href: '/admin/Cursos_Pago_Unico/categoria', title: 'Categorías', desc: 'Organiza los cursos en categorías', icon: <Tags/> },
        { href: '/admin/bank-preguntas', title: 'Exámenes', desc: 'Gestiona el banco de preguntas y exámenes', icon: <FileText/> },
        { href: '/admin/solicitudes', title: 'Solicitudes Premium', desc: 'Revisa y aprueba las suscripciones', icon: <Wallet/> },
        { href: '/admin/solicitudes-pago-unico', title: 'Solicitudes de Acceso', desc: 'Aprueba el acceso a cursos de pago único', icon: <KeyRound/> },
        { href: '/admin/live-classes', title: 'Clases en Vivo', desc: 'Administra las clases en tiempo real', icon: <Video/> },
        { href: '/admin/qr-gestion', title: 'Gestión de QR', desc: 'Administra los códigos QR para pagos', icon: <QrCode/> },
    ];

    if (!isLoaded) {
        return (
            <section className="min-h-[calc(100vh-4rem)] flex items-center justify-center" style={{ backgroundColor: isDark ? '#1a2639' : '#FFF9F0' }}>
                <p className={`text-lg animate-pulse ${isDark ? 'text-white' : 'text-[#1a2639]'}`}>Cargando...</p>
            </section>
        );
    }

    return (
        <section className="px-4 py-6 md:px-6 min-h-[calc(100vh-4rem)] transition-all duration-300" style={{ backgroundColor: isDark ? '#1a2639' : '#FFF9F0' }}>
            <div className={`mb-8 p-6 rounded-2xl shadow-sm border transition-all duration-300 ${isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15'}`}>
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div>
                        <h1 className={`text-3xl md:text-4xl font-bold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>Panel de Administración</h1>
                        <p className={`text-lg ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                            Bienvenido, <span className="font-semibold">{user?.displayName || user?.email}</span>
                        </p>
                    </div>
                    <div className={`flex items-center flex-wrap justify-end gap-x-6 gap-y-2 p-3 rounded-lg border ${isDark ? 'bg-gray-900/50 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                        <div className="flex items-center gap-2" title={new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}>
                            <span className={`font-semibold text-md ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
                            </span>
                        </div>
                         <div className={`w-px h-6 self-stretch ${isDark ? 'bg-gray-600' : 'bg-gray-300'} hidden sm:block`}></div>
                        <div className="flex items-center gap-2">
                            <Clock className={isDark ? 'text-blue-400' : 'text-blue-600'} size={20}/>
                            <AdminLiveClock isDark={isDark} />
                        </div>
                        <div className={`w-px h-6 self-stretch ${isDark ? 'bg-gray-600' : 'bg-gray-300'} hidden sm:block`}></div>
                        {weatherLoading ? <Loader className="animate-spin" size={20}/> : weatherDetails && (
                            <div className="flex items-center gap-2" title={weatherDetails.description}>
                                <span className={isDark ? 'text-yellow-400' : 'text-yellow-500'}>{weatherDetails.icon}</span>
                                <span className={`font-semibold text-md ${isDark ? 'text-white' : 'text-gray-800'}`}>{Math.round(weatherData.current.temperature_2m)}°C</span>
                                <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>(Tarija, BO)</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="mb-10">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <StatCard title="Total de Usuarios" value={stats.total} icon={<Users size={24} className="text-blue-500"/>} isLoading={usersLoading} colorClass={isDark ? 'bg-blue-900/40' : 'bg-blue-100'}/>
                    <StatCard title="Usuarios Premium" value={stats.premium} icon={<Gem size={24} className="text-amber-500"/>} isLoading={usersLoading} colorClass={isDark ? 'bg-amber-900/40' : 'bg-amber-100'}/>
                    <StatCard title="Acceso Pago Único" value={stats.pagoUnico} icon={<BookKey size={24} className="text-green-500"/>} isLoading={usersLoading} colorClass={isDark ? 'bg-green-900/40' : 'bg-green-100'}/>
                </div>
            </div>

            <div>
                <h2 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>Herramientas de Gestión</h2>
                <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {cardItems.map(({ href, title, desc, icon }) => (
                        <Link key={href} href={href} className="group block transform transition-all duration-300 hover:scale-105">
                            <div className={`p-6 rounded-2xl shadow-sm border h-full flex flex-col transition-all duration-300 hover:shadow-xl ${isDark ? 'bg-[#1e293b] border-white/10 hover:border-[#24B0BA]/50' : 'bg-white border-[#2E4A70]/15 hover:border-[#014ba0]'}`}>
                                <div className="flex items-center mb-3">
                                    <span className={`text-2xl mr-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{icon}</span>
                                    <h2 className={`text-xl font-semibold ${isDark ? 'text-white group-hover:text-blue-400' : 'text-gray-900 group-hover:text-blue-600'}`}>{title}</h2>
                                </div>
                                <p className={`text-sm leading-relaxed flex-grow ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{desc}</p>
                                <div className={`mt-4 text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                                    Acceder →
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </section>
    );
}
