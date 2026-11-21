"use client";
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getCachedCategories, getCachedSubcategories } from '@/lib/catalogCache';
import { invalidateFlashcardCache } from '@/lib/flashcardServices';
import { useRouter, useParams } from 'next/navigation';
import { useTheme } from '@/context/ThemeContext';
import { formatDriveUrl } from '@/lib/driveUtils';
import Swal from 'sweetalert2';
import { ArrowLeft, Save, BookOpen, Tag, Image as ImageIcon, Loader2 } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

export default function EditFlashcardPage() {
  const router = useRouter();
  const { id } = useParams();
  const { isDark, isLoaded } = useTheme();
  const [fetching, setFetching] = useState(true);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [subthemes, setSubthemes] = useState([]);
  const [loadingSubthemes, setLoadingSubthemes] = useState(false);
  
  const [newDriveLink, setNewDriveLink] = useState('');
  const [preview, setPreview] = useState('');

  const [formData, setFormData] = useState({
    pregunta: '',
    respuesta: '',
    explicacion: '',
    especialidad: '', // ID de la especialidad
    especialidadNombre: '',
    subtema: '',      // Nombre del subtema (Identificador de estudio)
    tags: '',
    tipo: 'Caso Clínico Corto'
  });

  const swalTheme = { 
    background: isDark ? '#1f2937' : '#ffffff', 
    color: isDark ? '#f9fafb' : '#111827',
    confirmButtonColor: '#3b82f6',
    cancelButtonColor: '#ef4444'
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const loadCategoriesAndCard = async () => {
      try {
        const [categoriesData, docSnap] = await Promise.all([
          getCachedCategories(),
          getDoc(doc(db, 'flashcards', id)),
        ]);
        if (cancelled) return;
        setCategories(categoriesData);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setFormData({
            pregunta: data.pregunta || '',
            respuesta: data.respuesta || '',
            explicacion: data.explicacion || '',
            especialidad: data.especialidad || '',
            especialidadNombre: data.especialidadNombre || '',
            subtema: data.subtema || '',
            tags: data.tags ? data.tags.join(', ') : '',
            tipo: data.tipo || 'Pregunta-Respuesta',
          });

          const originalLink = data.driveUrl || '';
          setNewDriveLink(originalLink);
          setPreview(formatDriveUrl(originalLink));

          if (data.especialidad) {
            await fetchSubthemes(data.especialidad, data.subtema);
          }
        } else {
          Swal.fire({
            icon: 'error',
            title: 'No encontrada',
            text: 'La tarjeta no existe.',
            ...swalTheme,
          });
          router.push('/admin/flashcards');
        }
      } catch (error) {
        console.error('Error fetching flashcard:', error);
      } finally {
        if (!cancelled) setFetching(false);
      }
    };
    loadCategoriesAndCard();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const fetchSubthemes = async (catId, currentSubtema = '') => {
    setLoadingSubthemes(true);
    try {
      const subData = await getCachedSubcategories(catId);
      setSubthemes(subData);
      
      // Si el subtema actual no está en la nueva lista, seleccionar el primero o vaciarlo
      if (currentSubtema) {
          setFormData(prev => ({ ...prev, subtema: currentSubtema }));
      } else if (subData.length > 0) {
        setFormData(prev => ({ ...prev, subtema: subData[0].name }));
      } else {
        setFormData(prev => ({ ...prev, subtema: '' }));
      }
    } catch (error) {
      console.error("Error fetching subthemes:", error);
    } finally {
      setLoadingSubthemes(false);
    }
  };

  const handleCategoryChange = (e) => {
    const catId = e.target.value;
    const catName = categories.find(c => c.id === catId)?.name || '';
    setFormData(prev => ({ ...prev, especialidad: catId, especialidadNombre: catName }));
    fetchSubthemes(catId);
  };

  const handleLinkChange = (e) => {
    const value = e.target.value;
    setNewDriveLink(value);
    
    if (!value || !value.startsWith('http') || value.length < 12) {
      setPreview('');
      return;
    }

    try {
      const formatted = formatDriveUrl(value);
      new URL(formatted);
      setPreview(formatted);
    } catch (err) {
      setPreview('');
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.subtema) {
      Swal.fire({ icon: 'warning', title: 'Identificador requerido', text: 'Debes seleccionar un subtema para asignar la tarjeta.', ...swalTheme });
      return;
    }

    if (newDriveLink && !newDriveLink.startsWith('http')) {
      await Swal.fire({
        icon: 'error',
        title: 'Link inválido',
        text: 'Por favor, introduce un enlace válido (debe empezar con http/https).',
        ...swalTheme
      });
      return;
    }

    const confirmResult = await Swal.fire({
      title: '¿Actualizar tarjeta?',
      text: `Se asignará al identificador: ${formData.subtema}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, actualizar',
      cancelButtonText: 'Cancelar',
      ...swalTheme
    });

    if (!confirmResult.isConfirmed) return;

    setLoading(true);

    try {
      const tagsArray = formData.tags.split(',').map(tag => tag.trim()).filter(tag => tag !== '');
      const finalDriveUrl = preview || newDriveLink;

      // Limpieza de data para Cloze Deletion
      const finalData = { ...formData };
      if (finalData.tipo === 'Completar Espacios') {
        finalData.respuesta = ''; // En Cloze, la data está en la pregunta
      }

      const docRef = doc(db, 'flashcards', id);
      await updateDoc(docRef, {
        ...finalData,
        driveUrl: finalDriveUrl,
        tags: tagsArray,
        updatedAt: serverTimestamp(),
      });
      invalidateFlashcardCache();

      await Swal.fire({
        icon: 'success', title: '¡Actualizada!', text: 'La flashcard ha sido actualizada correctamente.',
        ...swalTheme
      });

      router.push('/admin/flashcards');
    } catch (error) {
      console.error("Error al actualizar:", error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar la tarjeta.', ...swalTheme });
    } finally {
      setLoading(false);
    }
  };

  if (!isLoaded || fetching) {
    return (
      <div className="flex justify-center items-center min-h-screen" style={{ backgroundColor: isDark ? '#111827' : '#f9fafb' }}>
        <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
      </div>
    );
  }

  const textColor = isDark ? 'text-white' : 'text-gray-900';
  const labelColor = isDark ? 'text-gray-300' : 'text-gray-700';
  const inputBg = isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-300';

  return (
    <div className="p-4 sm:p-8 min-h-screen transition-colors duration-300" style={{ backgroundColor: isDark ? '#111827' : '#f8fafc' }}>
      <div className="max-w-6xl mx-auto">
        <Link href="/admin/flashcards" className={`flex items-center gap-2 mb-6 transition-colors ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-blue-600'}`}>
          <ArrowLeft className="w-5 h-5" /> Volver al listado
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className={`p-6 rounded-2xl shadow-sm border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <h1 className="text-2xl font-bold mb-6 flex items-center gap-2" style={{ color: isDark ? '#60a5fa' : '#1e40af' }}>
              <EditFlashcardIcon className="w-6 h-6" /> Editar Flashcard
            </h1>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-semibold mb-1 ${labelColor}`}>Especialidad</label>
                  <select 
                    name="especialidad" 
                    className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-500 ${inputBg} ${textColor}`} 
                    value={formData.especialidad} 
                    onChange={handleCategoryChange}
                  >
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id} className={isDark ? 'bg-gray-800' : 'bg-white'}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-semibold mb-1 ${labelColor}`}>Subtema (Identificador)</label>
                  <select 
                    name="subtema" 
                    disabled={loadingSubthemes || subthemes.length === 0}
                    className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ${inputBg} ${textColor}`} 
                    value={formData.subtema} 
                    onChange={handleChange}
                  >
                    {subthemes.length === 0 ? (
                      <option value="">No hay temas registrados</option>
                    ) : (
                      subthemes.map(sub => (
                        <option key={sub.id} value={sub.name} className={isDark ? 'bg-gray-800' : 'bg-white'}>
                          {sub.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label className={`block text-sm font-semibold mb-1 ${labelColor}`}>Pregunta</label>
                <textarea 
                  name="pregunta" 
                  required 
                  rows="2" 
                  className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-500 ${inputBg} ${textColor}`} 
                  value={formData.pregunta} 
                  onChange={handleChange} 
                  placeholder={formData.tipo === 'Completar Espacios' ? "Ej: El [fémur] se articula con la [rótula]." : "Escribe la pregunta..."}
                />
                {formData.tipo === 'Completar Espacios' && (
                  <p className="mt-2 text-xs font-medium text-blue-500 italic">
                    Sintaxis Cloze: Encierra entre corchetes [ ] las palabras que el alumno deberá completar.
                  </p>
                )}
              </div>

              {formData.tipo !== 'Completar Espacios' && (
                <div>
                  <label className={`block text-sm font-semibold mb-1 ${labelColor}`}>Respuesta</label>
                  <textarea 
                    name="respuesta" 
                    required={formData.tipo !== 'Completar Espacios'} 
                    rows="2" 
                    className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-500 ${inputBg} ${textColor}`} 
                    value={formData.respuesta} 
                    onChange={handleChange} 
                    placeholder="Escribe la respuesta..."
                  />
                </div>
              )}

              <div>
                <label className={`block text-sm font-semibold mb-1 ${labelColor}`}>Explicación (Opcional)</label>
                <textarea name="explicacion" rows="2" className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-500 ${inputBg} ${textColor}`} value={formData.explicacion} onChange={handleChange} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-semibold mb-1 ${labelColor}`}>Tipo de Tarjeta</label>
                  <select 
                    name="tipo" 
                    className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-500 ${inputBg} ${textColor}`} 
                    value={formData.tipo} 
                    onChange={handleChange}
                    required
                  >
                    <option value="Pregunta">Pregunta</option>
                    <option value="Completar Espacios">Completar Espacios</option>
                    <option value="Caso Clínico Corto">Caso Clínico Corto</option>
                    <option value="Imagen">Imagen</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-semibold mb-1 ${labelColor}`}>Tags</label>
                  <input name="tags" type="text" className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-500 ${inputBg} ${textColor}`} placeholder="enfarm, amir..." value={formData.tags} onChange={handleChange} />
                </div>
              </div>

              <div>
                <label className={`block text-sm font-semibold mb-1 ${labelColor}`}>Link Google Drive (Imagen)</label>
                <input type="text" value={newDriveLink} onChange={handleLinkChange} className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-500 ${inputBg} ${textColor}`} placeholder="https://drive.google.com/file/d/..." />
              </div>

              <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold shadow-lg disabled:bg-gray-400 transition-all transform hover:scale-[1.01]">
                <Save className="w-5 h-5" /> {loading ? 'Actualizando...' : 'Actualizar Flashcard'}
              </button>
            </form>
          </div>

          <div className="space-y-6">
            {preview && (() => {
              try {
                if (preview.startsWith('http')) {
                  const url = new URL(preview);
                  if (!url.hostname) return null;
                }
                return (
                  <div className={`p-6 rounded-xl shadow-lg border ${isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200'}`}>
                      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: isDark ? '#60a5fa' : '#1e40af' }}>
                          <ImageIcon size={20} /> Previsualización de la Imagen
                      </h2>
                      <div className="flex justify-center bg-black/5 rounded-lg p-2">
                          <Image 
                            src={preview} 
                            alt="Previsualización" 
                            width={300} 
                            height={200} 
                            className="border rounded-lg object-contain shadow-sm" 
                          />
                      </div>
                  </div>
                );
              } catch (e) {
                return null;
              }
            })()}

            {/* Vista Previa de la Tarjeta */}
            <div className={`p-6 rounded-xl shadow-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <h2 className="text-lg font-semibold mb-4" style={{ color: isDark ? '#60a5fa' : '#1e40af' }}>Vista Previa de la Tarjeta</h2>
              <div className={`p-6 rounded-xl border-2 border-dashed min-h-[200px] flex flex-col ${isDark ? 'bg-gray-900/50 border-gray-700' : 'bg-blue-50/50 border-blue-100'}`}>
                <div className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                  {formData.subtema || 'TEMA'}
                </div>
                <div className={`text-lg font-bold mb-4 break-words whitespace-pre-wrap max-h-[150px] overflow-y-auto custom-scrollbar ${textColor}`}>
                  {formData.pregunta || '¿Tu pregunta aparecerá aquí?'}
                </div>
                <div className={`h-px w-full mb-4 flex-shrink-0 ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                <div className={`text-sm font-medium break-words whitespace-pre-wrap max-h-[100px] overflow-y-auto custom-scrollbar ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  {formData.respuesta || 'La respuesta se mostrará al girar.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditFlashcardIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
