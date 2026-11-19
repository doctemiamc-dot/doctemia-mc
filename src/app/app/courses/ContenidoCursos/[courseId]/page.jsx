// src/app/app/courses/ContenidoCursos/[courseId]/page.jsx
'use client';
import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import Swal from 'sweetalert2';
import ProtectedVideoPlayer from '@/app/components/video/ProtectedVideoPlayer';

// --- Icono para el enlace ---
const LinkIcon = (props) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/>
    </svg>
);

export default function ContenidoCursoPage() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const router = useRouter();
  const params = useParams();
  const courseId = params.courseId;

  const [courseDetails, setCourseDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoProgress, setVideoProgress] = useState({});

  // Protección adicional: deshabilitar inspección de elementos
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.keyCode === 123) { e.preventDefault(); showSecurityWarning(); return false; }
      if (e.ctrlKey && e.shiftKey && e.keyCode === 73) { e.preventDefault(); showSecurityWarning(); return false; }
      if (e.ctrlKey && e.shiftKey && e.keyCode === 67) { e.preventDefault(); showSecurityWarning(); return false; }
      if (e.ctrlKey && e.keyCode === 85) { e.preventDefault(); showSecurityWarning(); return false; }
    };
    const handleContextMenu = (e) => { e.preventDefault(); showSecurityWarning(); return false; };
    const showSecurityWarning = () => {
      Swal.fire({
        title: 'Contenido Protegido',
        text: 'Este contenido está protegido y no puede ser copiado o descargado.',
        icon: 'warning',
        timer: 3000,
        showConfirmButton: false
      });
    };
    const detectDevTools = () => {
      const threshold = 160;
      const widthThreshold = window.outerWidth - window.innerWidth > threshold;
      const heightThreshold = window.outerHeight - window.innerHeight > threshold;
      if (widthThreshold || heightThreshold) {
        showSecurityWarning();
        console.clear();
        console.log('%cContenido Protegido - Acceso no autorizado detectado', 'color: red; font-size: 16px; font-weight: bold;');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  // Protección contra selección de texto
  useEffect(() => {
    const disableSelection = (e) => { e.preventDefault(); return false; };
    const disableDrag = (e) => { e.preventDefault(); return false; };
    document.addEventListener('selectstart', disableSelection);
    document.addEventListener('dragstart', disableDrag);
    return () => {
      document.removeEventListener('selectstart', disableSelection);
      document.removeEventListener('dragstart', disableDrag);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    if (courseId) {
      const fetchCourseDetails = async () => {
        setLoading(true);
        setError(null);
        try {
          // Reutilizar user.cursosPagados desde AuthContext (0 lecturas extra a users/{uid})
          const isCoursePaid = user.cursosPagados?.some(c => c.idCurso === courseId);
          if (!isCoursePaid) {
            Swal.fire('Acceso Denegado', 'No tienes este curso activo o ya lo has completado.', 'warning');
            router.push('/app/courses/cursosPagados');
            return;
          }
          const courseDocRef = doc(db, 'courses', courseId);
          const courseDocSnap = await getDoc(courseDocRef);
          if (courseDocSnap.exists()) {
            const courseData = { id: courseDocSnap.id, ...courseDocSnap.data() };
            if (courseData.videos && Array.isArray(courseData.videos)) {
              courseData.videos.sort((a, b) => (a.order || 0) - (b.order || 0));
            }
            setCourseDetails(courseData);
            if (courseData.videos && courseData.videos.length > 0) {
              setSelectedVideo(courseData.videos[0]);
            }
          } else {
            setError('Curso no encontrado.');
            Swal.fire('Error', 'El curso que intentas ver no existe.', 'error');
          }
        } catch (err) {
          console.error("Error fetching course content:", err);
          setError('Error al cargar el contenido del curso.');
          Swal.fire('Error', `Hubo un problema al cargar el curso: ${err.message}`, 'error');
        } finally {
          setLoading(false);
        }
      };
      fetchCourseDetails();
    } else {
      setLoading(false);
      setError('ID de curso no proporcionado.');
    }
  }, [courseId, user, router]);

  const handleVideoProgress = (state) => {
    if (selectedVideo) {
      setVideoProgress(prev => ({
        ...prev,
        [selectedVideo.url]: {
          played: state.played,
          playedSeconds: state.playedSeconds,
          loadedSeconds: state.loadedSeconds
        }
      }));
    }
  };

  const renderVideoContent = (video) => {
    if (!video || !video.url) {
      return (
        <div
          className={`flex justify-center items-center rounded-lg shadow-inner aspect-video ${
            isDark ? 'bg-gray-700' : 'bg-gray-200'
          }`}
        >
          <p className={`text-lg ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Selecciona un video para verlo.
          </p>
        </div>
      );
    }
    return (
      <div className="w-full h-[500px] bg-black rounded-lg shadow-lg overflow-hidden">
        <ProtectedVideoPlayer
          url={video.url}
          width="100%"
          height="100%"
          onProgress={handleVideoProgress}
          onDuration={(duration) => {
            console.log(`Duración del video: ${duration} segundos`);
          }}
        />
      </div>
    );
  };

  if (loading) {
    return (
      <div className={`flex justify-center items-center h-screen ${
        isDark ? 'bg-gray-900' : 'bg-gray-50'
      }`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className={`text-xl ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
            Cargando contenido del curso...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={`flex flex-col justify-center items-center h-screen ${
        isDark ? 'bg-gray-900' : 'bg-gray-100'
      }`}>
        <div className={`${isDark ? 'bg-gray-800' : 'bg-white'} p-8 rounded-lg shadow-lg text-center`}>
          <p className={`text-xl mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
            Debes iniciar sesión para ver este contenido.
          </p>
          <button
            onClick={() => router.push('/auth/login')}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition duration-200"
          >
            Ir a Iniciar Sesión
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-4 text-center">
        <div className={`${isDark ? 'bg-gray-800' : 'bg-white'} p-8 rounded-lg shadow-lg max-w-md mx-auto`}>
          <h1 className="text-2xl font-bold text-red-600 mb-4">Error</h1>
          <p className={`text-lg mb-6 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{error}</p>
          <button
            onClick={() => router.back()}
            className={`px-6 py-2 font-semibold rounded-lg transition duration-200 ${
              isDark
                ? 'bg-gray-600 hover:bg-gray-700 text-white'
                : 'bg-gray-500 hover:bg-gray-600 text-white'
            }`}
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  if (!courseDetails) {
    return (
      <div className={`flex justify-center items-center h-screen ${
        isDark ? 'bg-gray-900' : 'bg-gray-50'
      }`}>
        <p className={`text-xl ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
          No se encontraron detalles del curso.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen ${
        isDark ? 'bg-gray-900 text-gray-100' : 'bg-gray-100 text-gray-900'
      }`}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none'
      }}
    >
      <header className={`${isDark ? 'bg-gray-800' : 'bg-white'} shadow-md`}>
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <button
            onClick={() => router.push('/app/courses/cursosPagados')}
            className={`font-medium flex items-center transition duration-200 ${
              isDark
                ? 'text-blue-400 hover:text-blue-300'
                : 'text-blue-600 hover:text-blue-800'
            }`}
          >
            &larr; Volver a Mis Cursos
          </button>
          <h1 className={`text-2xl md:text-3xl font-bold text-center flex-grow px-4 truncate ${
            isDark ? 'text-gray-100' : 'text-gray-800'
          }`}>
            {courseDetails.name}
          </h1>
          <div className="w-8 invisible" />
        </div>
      </header>

      <main className="container mx-auto p-4 md:p-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Área del video principal */}
          <div className="lg:w-3/4">
            {selectedVideo ? (
              <div className="mb-6">
                {renderVideoContent(selectedVideo)}
                <div
                  className={`mt-4 p-4 rounded-lg shadow-md ${
                    isDark ? 'bg-gray-800' : 'bg-white'
                  }`}
                >
                  <h2 className={`text-xl font-semibold mb-2 ${
                    isDark ? 'text-gray-200' : 'text-gray-700'
                  }`}>
                    {selectedVideo.description || 'Video'}
                  </h2>
                  {videoProgress[selectedVideo.url] && (
                    <div className={`text-sm ${
                      isDark ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                      Progreso: {Math.round(videoProgress[selectedVideo.url].played * 100)}%
                    </div>
                  )}
                </div>
              </div>
            ) : (
              renderVideoContent(null)
            )}

            <div
              className={`p-6 rounded-lg shadow-md ${
                isDark ? 'bg-gray-800' : 'bg-white'
              }`}
            >
              <h3 className={`text-xl font-semibold mb-3 ${
                isDark ? 'text-gray-100' : 'text-gray-800'
              }`}>
                Descripción del Curso
              </h3>
              <p className={`${isDark ? 'text-gray-400' : 'text-gray-600'} whitespace-pre-line`}>
                {courseDetails.description || 'No hay descripción disponible para este curso.'}
              </p>
              
              {/* --- INICIO DE LA MEJORA: MOSTRAR LINK DE RESUMEN --- */}
              {courseDetails.summaryDriveLink && (
                  <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <h4 className={`text-lg font-semibold mb-3 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                          Recursos Adicionales
                      </h4>
                      <a
                          href={courseDetails.summaryDriveLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'}`}
                      >
                          <LinkIcon className="h-4 w-4" />
                          Resumen del Curso (Drive)
                      </a>
                  </div>
              )}
              {/* --- FIN DE LA MEJORA --- */}

            </div>
          </div>

          {/* Lista de videos */}
          <div className="lg:w-1/4">
            <div
              className={`p-4 rounded-lg shadow-md max-h-[calc(100vh-10rem)] overflow-y-auto ${
                isDark ? 'bg-gray-800' : 'bg-white'
              }`}
            >
              <h3 className={`text-lg font-semibold mb-4 pb-2 border-b ${
                isDark ? 'text-gray-100 border-gray-700' : 'text-gray-800 border-gray-200'
              }`}>
                Contenido del Curso
              </h3>
              {courseDetails.videos && courseDetails.videos.length > 0 ? (
                <ul className="space-y-2">
                  {courseDetails.videos.map((video, index) => {
                    const progress = videoProgress[video.url]?.played || 0;
                    const isSelected = selectedVideo?.url === video.url;
                    return (
                      <li key={video.url + index}>
                        <button
                          onClick={() => setSelectedVideo(video)}
                          className={`w-full text-left p-3 rounded-md transition-all duration-200 flex items-start relative overflow-hidden ${
                            isSelected
                              ? `${
                                  isDark
                                    ? 'bg-blue-900 text-blue-300 ring-2 ring-blue-300'
                                    : 'bg-blue-100 text-blue-700 ring-2 ring-blue-500'
                                }`
                              : `${
                                  isDark
                                    ? 'hover:bg-gray-700 text-gray-300'
                                    : 'hover:bg-gray-200 text-gray-700'
                                }`
                          }`}
                        >
                          <div
                            className={`absolute inset-0 opacity-30 transition-all duration-300 ${
                              isDark ? 'bg-green-800' : 'bg-green-100'
                            }`}
                            style={{ width: `${progress * 100}%` }}
                          />
                          <span className={`mr-2 mt-1 relative z-10 ${
                            isDark ? 'text-blue-300' : 'text-blue-500'
                          }`}>
                            {isSelected ? '▶' : '►'}
                          </span>
                          <div className="relative z-10">
                            <span className={`block font-medium ${
                              isDark ? 'text-gray-100' : 'text-gray-900'
                            }`}>
                              Video {index + 1}
                            </span>
                            <span className={`${isDark ? 'text-gray-400' : 'text-gray-700'} text-sm`}>
                              {video.description || `Clase ${index + 1}`}
                            </span>
                            {progress > 0 && (
                              <div className={`mt-1 text-xs ${
                                isDark ? 'text-green-300' : 'text-green-600'
                              }`}>
                                {Math.round(progress * 100)}% completado
                              </div>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={`${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  No hay videos disponibles para este curso.
                </p>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Overlay de protección global */}
      <div
        className="fixed inset-0 pointer-events-none z-10"
        style={{
          background: 'linear-gradient(transparent 0%, transparent 100%)',
          mixBlendMode: 'normal'
        }}
      />
    </div>
  );
}
