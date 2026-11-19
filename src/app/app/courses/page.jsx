'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, limit, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import {
  getCachedContactInfo,
  getCachedPendingAccessRequest,
  setCachedPendingAccessRequest,
} from '@/lib/catalogCache';
import Swal from 'sweetalert2';
import { LockKeyhole, Send, Hourglass, BookOpen, Search, CheckCircle2, Bookmark } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// Ya no necesitamos estas constantes aquí, se obtendrán de Firebase
// const NUMERO_WHATSAPP_MAJO = '+59168706660';
// const NOMBRE_NEGOCIO_MAJO = 'DOCTEMIA MC'; // Se usará un valor por defecto si no se encuentra en Firebase

// El componente AccessDeniedScreen no necesita cambios, pero lo incluyo para contexto
// y para asegurar que el NOMBRE_NEGOCIO se obtenga de forma consistente.
const AccessDeniedScreen = ({ user, isDark, swalTheme }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [requestSent, setRequestSent] = useState(false);
    // ✅ CAMBIO: contactInfo ahora incluye adminPhone y businessName
    const [contactInfo, setContactInfo] = useState({ qrUrl: '', adminPhone: '', businessName: 'DOCTEMIA MC' }); 
    
    useEffect(() => {
        const checkRequestAndLoadInfo = async () => {
            if (user?.uid) {
                const [hasPending, info] = await Promise.all([
                    getCachedPendingAccessRequest(user.uid),
                    getCachedContactInfo(),
                ]);
                if (hasPending) setRequestSent(true);
                if (info) setContactInfo(prev => ({ ...prev, ...info }));
            }
        };
        checkRequestAndLoadInfo();
    }, [user?.uid]);

    const handleRequestAccessPopup = () => {
        Swal.fire({
            title: '<h3 class="text-2xl font-bold text-indigo-500">¡Solicita tu Acceso!</h3>',
            html: `
                <div class="text-left space-y-4 p-4 ${isDark ? 'text-gray-300' : 'text-gray-700'}">
                    <p class="text-center">Completa el pago usando el QR y luego contáctanos por WhatsApp para una activación inmediata.</p>
                    <div class="flex justify-center my-4">
                        ${contactInfo.qrUrl ? `<img src="${contactInfo.qrUrl}" alt="Código QR de Pago" class="w-48 h-48 rounded-lg border-2 ${isDark ? 'border-gray-600' : 'border-gray-300'}"/>` : '<p>Código QR no disponible.</p>'}
                    </div>
                    <p class="text-center font-semibold">¿Ya pagaste?</p>
                    <a id="whatsapp-link" href="https://api.whatsapp.com/send?phone=${contactInfo.adminPhone}&text=${encodeURIComponent(`Hola ${contactInfo.businessName}, soy ${user.name || user.displayName || user.email}. Acabo de realizar el pago para el acceso a los cursos de pago único. Adjunto mi comprobante.`)}" target="_blank" class="flex items-center justify-center gap-2 w-full bg-green-500 text-white font-bold py-3 px-4 rounded-lg transition hover:bg-green-600">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                        Contactar por WhatsApp
                    </a>
                    <div class="relative my-4">
                        <div class="absolute inset-0 flex items-center"><span class="w-full border-t ${isDark ? 'border-gray-600' : 'border-gray-300'}"></span></div>
                        <div class="relative flex justify-center text-xs uppercase"><span class="bg-${isDark ? 'gray-800' : 'white'} px-2 text-gray-500"> O </span></div>
                    </div>
                    <p class="text-center">Si prefieres, envía una solicitud y te contactaremos.</p>
                    <input id="swal-input-phone" class="swal2-input" placeholder="Tu número de WhatsApp (ej: +591...)" type="tel">
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Enviar Solicitud',
            cancelButtonText: 'Cancelar',
            ...swalTheme,
            customClass: { popup: isDark ? 'bg-gray-800' : 'bg-white' },
            preConfirm: () => {
                const phone = Swal.getPopup().querySelector('#swal-input-phone').value;
                if (!phone) { Swal.showValidationMessage(`Por favor, ingresa tu número de WhatsApp`); }
                return { phone };
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                setIsSubmitting(true);
                try {
                    await addDoc(collection(db, "pagoUnico_solicitudes"), { userId: user.uid, userName: user.name || user.displayName || user.email, userEmail: user.email, userPhone: result.value.phone, requestDate: serverTimestamp(), status: 'pendiente', type: 'pago_unico_access' });
                    setRequestSent(true);
                    setCachedPendingAccessRequest(user.uid, true);
                    Swal.fire({ title: '¡Solicitud Enviada!', text: 'Te contactaremos pronto.', icon: 'success', ...swalTheme });
                } catch (error) {
                    console.error("Error al crear solicitud:", error);
                    Swal.fire({ title: 'Error', text: 'No se pudo enviar tu solicitud.', icon: 'error', ...swalTheme });
                } finally {
                    setIsSubmitting(false);
                }
            }
        });
    };

    return (
        <div className={`flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center p-6 ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
            <LockKeyhole className={`h-20 w-20 mb-6 ${isDark ? 'text-indigo-400' : 'text-indigo-500'}`} />
            <h1 className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Acceso Restringido</h1>
            <p className={`mt-4 max-w-md text-lg ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Para ver el catálogo de cursos de pago único, necesitas la aprobación de un administrador.</p>
            <div className="mt-8">
                {requestSent ? (
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow-400/20 text-yellow-700 dark:text-yellow-300"><Hourglass className="h-6 w-6" /> <span className="font-semibold">Tu solicitud está pendiente.</span></div>
                ) : (
                    <button onClick={handleRequestAccessPopup} disabled={isSubmitting} className="inline-flex items-center gap-3 rounded-md bg-indigo-600 px-6 py-3 text-lg font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:bg-gray-400">{isSubmitting ? 'Procesando...' : 'Solicitar Acceso Ahora'} <Send className="h-5 w-5" /></button>
                )}
            </div>
        </div>
    );
};


export default function UserListCoursesPage() {
  const { user, loading: authLoading } = useAuth();
  const { isDark } = useTheme();
  const router = useRouter(); 
  const [availableCourses, setAvailableCourses] = useState([]);
  const [pendingCourses, setPendingCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourseForPurchase, setSelectedCourseForPurchase] = useState(null);
  const [examDate, setExamDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userPhone, setUserPhone] = useState('');
  // ✅ CAMBIO: contactInfo para almacenar QR y número de admin
  const [contactInfo, setContactInfo] = useState({ qrUrl: '', adminPhone: '', businessName: 'DOCTEMIA MC' }); 

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        // Reutilizar teléfono desde user de AuthContext y contactInfo cacheado (0 lecturas extra)
        setUserPhone(user.telefono || '');

        const [info, coursesSnapshot, solicitudesSnapshot] = await Promise.all([
          getCachedContactInfo(),
          getDocs(query(collection(db, 'courses'), where('isActive', '==', true), limit(50))),
          getDocs(query(collection(db, 'solicitudes'), where('userId', '==', user.uid), limit(50))),
        ]);

        if (info) {
          setContactInfo((prev) => ({ ...prev, ...info }));
        }

        const activeCourses = coursesSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        const userSolicitudes = solicitudesSnapshot.docs.map((d) => d.data());
        const pendingCourseIds = userSolicitudes.map((solicitud) => solicitud.courseId);

        const filteredCourses = activeCourses.filter(
          (course) => !user.cursosPagados?.some((p) => p.idCurso === course.id)
        );

        setPendingCourses(filteredCourses.filter((course) => pendingCourseIds.includes(course.id)));
        setAvailableCourses(
          filteredCourses.filter((course) => !pendingCourseIds.includes(course.id))
        );
      } catch (error) {
        console.error('Error loading courses or solicitudes:', error);
        Swal.fire('Error', 'No se pudieron cargar los cursos.', 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.uid, user?.telefono, user?.cursosPagados]);

  const handleOpenPurchaseModal = course => {
    setSelectedCourseForPurchase(course);
    setExamDate('');
  };

  const handleClosePurchaseModal = () => {
    setSelectedCourseForPurchase(null);
  };

  const handlePurchaseConfirmation = async () => {
    if (isSubmitting) return;
    if (!selectedCourseForPurchase || !examDate) {
      Swal.fire('Error', 'Por favor, selecciona una fecha para tu examen.', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'solicitudes'), {
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName || user.email, // Usar email si displayName no está disponible
        userPhone,
        courseId: selectedCourseForPurchase.id,
        courseName: selectedCourseForPurchase.name,
        paymentDate: serverTimestamp(),
        examDate,
        status: 'pendiente',
      });

      Swal.fire(
        '¡Solicitud Enviada!',
        `Tu solicitud para el curso "${selectedCourseForPurchase.name}" ha sido registrada.`,
        'success'
      );

      setPendingCourses(prev => [...prev, selectedCourseForPurchase]);
      setAvailableCourses(prev => prev.filter(c => c.id !== selectedCourseForPurchase.id));

      // ✅ CAMBIO: Usar contactInfo.adminPhone y contactInfo.businessName
      const mensaje = `Hola ${contactInfo.businessName}, soy ${user.displayName || user.email}. He pagado por el curso: "${selectedCourseForPurchase.name}".`;
      window.open(
        `https://api.whatsapp.com/send?phone=${contactInfo.adminPhone}&text=${encodeURIComponent(mensaje)}`,
        '_blank'
      );
      handleClosePurchaseModal();
    } catch (error) {
      console.error('Error creating solicitud:', error);
      Swal.fire('Error', 'No se pudo procesar tu solicitud.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePendingClick = course => {
    // ✅ CAMBIO: Usar contactInfo.adminPhone y contactInfo.businessName
    const mensaje = `Hola ${contactInfo.businessName}, mi solicitud al curso "${course.name}" está tardando mucho.`;
    Swal.fire({
      title: '¿Tu solicitud está tardando mucho?',
      html: `<a href="https://api.whatsapp.com/send?phone=${contactInfo.adminPhone}?text=${encodeURIComponent(
        mensaje
      )}" target="_blank" class="underline">Contactar por WhatsApp</a>`,
      icon: 'info',
    });
  };

  if (authLoading || loading) {
    return (
      <div
        className={`flex justify-center items-center h-screen ${
          isDark ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'
        }`}
      >
        Cargando cursos...
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className={`flex justify-center items-center h-screen ${
          isDark ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'
        }`}
      >
        Por favor, inicia sesión para ver los cursos.
      </div>
    );
  }

  return (
    <div className={`container mx-auto p-4 ${isDark ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'}`}> 
      <h1 className={`text-3xl font-bold mb-6 text-center ${
        isDark ? 'text-gray-100' : 'text-gray-900'
      }`}>Cursos Premiun Disponibles</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...pendingCourses, ...availableCourses].map(course => (
          <div
            key={course.id}
            className={`flex flex-col shadow-lg rounded-lg overflow-hidden ${
              isDark ? 'bg-gray-800' : 'bg-white'
            }`}
          >
            <img
              src={course.image || '/placeholder-image.jpg'}
              alt={course.name}
              className="w-full h-48 object-cover"
            />
            <div className="p-4 flex flex-col flex-grow">
              <h2 className={`${
                isDark ? 'text-gray-100' : 'text-gray-900'
              } text-xl font-semibold mb-2`}>{course.name}</h2>
              <p className={`${
                isDark ? 'text-gray-300' : 'text-gray-700'
              } mb-1 text-sm flex-grow`}>{course.description.substring(0, 100)}...</p>
              <p className={`${
                isDark ? 'text-blue-400' : 'text-blue-600'
              } text-lg font-bold mb-3`}>Bs {course.price.toFixed(2)}</p>
              {pendingCourses.some(p => p.id === course.id) ? (
                <button
                  onClick={() => handlePendingClick(course)}
                  className={`mt-auto w-full font-bold py-2 px-4 rounded transition duration-300 ${
                    isDark ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-yellow-400 hover:bg-yellow-500 text-black'
                  }`}
                >
                  Pendiente
                </button>
              ) : (
                <button
                  onClick={() => handleOpenPurchaseModal(course)}
                  className={`mt-auto w-full font-bold py-2 px-4 rounded transition duration-300 ${
                    isDark ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-700 text-white'
                  }`}
                >
                  Comprar Curso Premiun
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {selectedCourseForPurchase && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
          <div
            className={`p-6 rounded-lg shadow-xl w-full max-w-md ${
              isDark ? 'bg-gray-700 text-gray-100' : 'bg-white text-gray-900'
            }`}
          >
            <h2 className={`text-2xl font-bold mb-4 ${
              isDark ? 'text-gray-100' : 'text-gray-900'
            }`}>Confirmar Compra: {selectedCourseForPurchase.name}</h2>
            <p className={`${
              isDark ? 'text-gray-100' : 'text-gray-900'
            } mb-2`}>Precio: Bs {selectedCourseForPurchase.price.toFixed(2)}</p>
            <div className="mb-4 text-center">
              <p className={`font-semibold mb-2 ${
                isDark ? 'text-gray-100' : 'text-gray-900'
              }`}>1. Realiza el pago escaneando el siguiente QR:</p>
              <div className="flex justify-center my-2">
                {contactInfo.qrUrl ? (
                  <img
                    src={contactInfo.qrUrl} // ✅ CAMBIO: Usar contactInfo.qrUrl
                    alt="Código QR para pago"
                    width={200}
                    height={200}
                  />
                ) : (
                  <p className={`${
                    isDark ? 'text-gray-400' : 'text-gray-500'
                  } text-sm`}>Cargando QR...</p>
                )}
              </div>
              <p className={`text-sm mb-2 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                O realiza una transferencia a la cuenta de {contactInfo.businessName}. {/* ✅ CAMBIO: Usar contactInfo.businessName */}
              </p>
              <p className={`font-semibold mb-2 ${
                isDark ? 'text-gray-100' : 'text-gray-900'
              }`}>2. Envía el comprobante de pago a nuestro WhatsApp:</p>
              <a
                href={`https://wa.me/${contactInfo.adminPhone}?text=${encodeURIComponent( // ✅ CAMBIO: Usar contactInfo.adminPhone
                  `Hola ${contactInfo.businessName}, quiero enviar mi comprobante para el curso "${selectedCourseForPurchase.name}".` // ✅ CAMBIO: Usar contactInfo.businessName
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`font-bold my-1 inline-block ${
                  isDark ? 'text-green-400 hover:text-green-300' : 'text-green-500 hover:text-green-700'
                }`}
              >
                Contactar por WhatsApp ({contactInfo.adminPhone}) {/* ✅ CAMBIO: Usar contactInfo.adminPhone */}
              </a>
            </div>

            <div className="mb-4">
              <label
                htmlFor="examDate"
                className={`block text-sm mb-1 ${
                  isDark ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                3. Ingresa la fecha de tu examen:
              </label>
              <input
                type="date"
                id="examDate"
                value={examDate}
                onChange={e => setExamDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className={`mt-1 block w-full px-3 py-2 rounded-md shadow-sm ${
                  isDark ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                }`}
                required
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={handleClosePurchaseModal}
                className={`font-bold py-2 px-4 rounded ${
                  isDark
                    ? 'bg-gray-600 hover:bg-gray-500 text-gray-100'
                    : 'bg-gray-300:hover:bg-gray-400 text-gray-800'
                }`}
              >
                Cancelar
              </button>
              <button
                onClick={handlePurchaseConfirmation}
                disabled={!examDate || isSubmitting}
                className={`font-bold py-2 px-4 rounded ${
                  !examDate || isSubmitting
                    ? isDark
                      ? 'bg-blue-400 cursor-not-allowed'
                      : 'bg-blue-300 cursor-not-allowed'
                    : isDark
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-blue-500 hover:bg-blue-700 text-white'
                }`}
              >
                Hecho, Enviar Solicitud
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
