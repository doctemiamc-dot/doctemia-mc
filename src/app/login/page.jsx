'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../lib/firebase'; // Asegúrate que la ruta sea correcta
import Swal from 'sweetalert2';
import Image from 'next/image';

// --- COMPONENTE PRINCIPAL DEL LOGIN ---
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('expired') === '1') {
      Swal.fire({
        title: 'Vigencia Vencida',
        text: 'Tu periodo activo ha vencido. Contacta al administrador para renovar tu acceso.',
        icon: 'warning',
        background: '#C1E8FF',
        color: '#021024',
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#052659',
      });
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      const idToken = await user.getIdToken();

      // Marcar antes de /api/login para evitar que onIdTokenChanged dispare un POST duplicado
      try {
        window.sessionStorage.setItem('__doctemia_synced_id_token', idToken);
      } catch {
        // Ignorar errores de sessionStorage
      }

      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ token: idToken }),
      });
      const data = await response.json();
      if (!response.ok) {
        try {
          window.sessionStorage.removeItem('__doctemia_synced_id_token');
        } catch {
          // Ignorar errores de sessionStorage
        }
        throw new Error(data.error || 'Error en el servidor durante el login');
      }

      // Aviso no bloqueante para redirección instantánea
      Swal.fire({
        title: '¡Inicio de sesión exitoso!',
        icon: 'success',
        toast: true,
        position: 'top-end',
        timer: 1800,
        timerProgressBar: true,
        background: '#C1E8FF',
        color: '#021024',
        showConfirmButton: false,
      });

      router.replace(data.role === 'admin' ? '/admin' : '/app');

    } catch (err) {
      let errorMessage = 'Ocurrió un error inesperado.';
      if (err.code) {
        switch (err.code) {
          case 'auth/user-not-found':
          case 'auth/wrong-password':
          case 'auth/invalid-credential':
            errorMessage = 'Correo o contraseña incorrectos.';
            break;
          case 'auth/invalid-email':
            errorMessage = 'El formato del correo es inválido.';
            break;
          default:
            errorMessage = 'Error de autenticación. Por favor, intente de nuevo.';
        }
      } else {
        errorMessage = err.message;
      }
      // Alerta de error con el estilo personalizado
      await Swal.fire({
        title: 'Error',
        text: errorMessage,
        icon: 'error',
        background: '#C1E8FF',
        color: '#021024',
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#052659',
        customClass: {
          popup: 'rounded-2xl border border-gray-300',
        }
      });
    } finally {
      setLoading(false);
    }
  };

  const goToRegister = () => {
    router.push('/register');
  };

  return (
    <>
      {/* Estilos para la animación de entrada y el subrayado del input */}
      <style jsx global>{`
        @keyframes slideInFromLeft {
          from { transform: translateX(-50px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideInFromRight {
          from { transform: translateX(50px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slideInLeft {
          animation: slideInFromLeft 0.7s ease-out forwards;
        }
        .animate-slideInRight {
          animation: slideInFromRight 0.7s ease-out forwards;
        }
        .input-underline::after {
          content: '';
          position: absolute;
          left: 0;
          bottom: 0;
          width: 100%;
          height: 2px;
          background-color: #C1E8FF; /* Color base del subrayado */
          transform: scaleX(0);
          transform-origin: left;
          transition: transform 0.4s ease-out;
        }
        .input-wrapper:focus-within .input-underline::after {
          transform: scaleX(1);
          background-image: linear-gradient(to right, #7DA0CA, #5483B3); /* Gradiente al hacer foco */
        }
      `}</style>

      <main className="flex items-center justify-center min-h-screen bg-[#C1E8FF]/40 p-4 md:p-8">
        <div className="relative w-full max-w-4xl flex rounded-2xl shadow-2xl overflow-hidden">
          
          {/* --- PANEL IZQUIERDO: Información --- */}
          <div className="hidden md:flex flex-col justify-center w-1/2 p-12 bg-[#052659] text-white animate-slideInLeft">
            <h1 className="text-5xl font-bold text-[#C1E8FF] mb-4">
              Bienvenido de Nuevo
            </h1>
            <p className="text-[#7DA0CA]">
              Inicia sesión para gestionar tus clases y todas tus actividades.
            </p>
          </div>

          {/* --- PANEL DERECHO: Formulario --- */}
          <div className="w-full md:w-1/2 p-8 sm:p-12 bg-white text-[#052659] animate-slideInRight">
            <div className="text-center mb-8">
              <Image
                src="/icons/1.png"
                alt="DOCTEMIA MC Logo"
                width={350}
                height={80}
                priority
                className="mx-auto"
              />
            </div>

            <form onSubmit={handleSubmit} className="space-y-10">
              {/* Campo de Email con etiqueta y subrayado animado */}
              <div className="relative input-wrapper">
                <label htmlFor="email" className="block text-sm font-medium text-[#5483B3] mb-1">
                  Correo electrónico
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-transparent border-b-2 border-gray-300 pb-2 outline-none text-[#052659] transition-colors duration-300 focus:border-transparent"
                />
                <span className="input-underline"></span>
              </div>

              {/* Campo de Contraseña con etiqueta y subrayado animado */}
              <div className="relative input-wrapper">
                <label htmlFor="password" className="block text-sm font-medium text-[#5483B3] mb-1">
                  Contraseña
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-transparent border-b-2 border-gray-300 pb-2 outline-none text-[#052659] transition-colors duration-300 focus:border-transparent"
                />
                <span className="input-underline"></span>
              </div>

              {/* Botón de Ingresar */}
              <button
                type="submit"
                disabled={loading}
                className="w-full font-bold py-3 rounded-lg shadow-lg transition-all duration-300 transform hover:scale-105 hover:shadow-blue-400/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
                style={{
                  background: 'linear-gradient(to right, #005bb6ff, #7DA0CA)',
                  color: '#C1E8FF',
                }}
              >
                {loading ? 'Verificando...' : 'Ingresar'}
              </button>
            </form>

            <div className="text-center mt-8">
              <p className="text-sm text-[#5483B3]">
                ¿Aún no tienes una cuenta?{' '}
                <button
                  type="button"
                  onClick={goToRegister}
                  className="font-semibold text-[#052659] hover:text-[#021024] transition-colors duration-300"
                >
                  Regístrate
                </button>
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}