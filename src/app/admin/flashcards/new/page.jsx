"use client";
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getCachedCategories, getCachedSubcategories } from '@/lib/catalogCache';
import { invalidateFlashcardCache } from '@/lib/flashcardServices';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/context/ThemeContext';
import { formatDriveUrl } from '@/lib/driveUtils';
import Swal from 'sweetalert2';
import { ArrowLeft, Save, BookOpen, Tag, Image as ImageIcon, PlusCircle } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

export default function NewFlashcardPage() {
  const router = useRouter();
  const { isDark, isLoaded } = useTheme();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [subthemes, setSubthemes] = useState([]);
  const [loadingSubthemes, setLoadingSubthemes] = useState(false);
  
  // Estados para link de drive y previsualización
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
    tipo: 'Pregunta'
  });

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const categoriesData = await getCachedCategories();
        setCategories(categoriesData);
        
        if (categoriesData.length > 0) {
          const firstCat = categoriesData[0];
          setFormData(prev => ({ 
            ...prev, 
            especialidad: firstCat.id,
            especialidadNombre: firstCat.name 
          }));
          fetchSubthemes(firstCat.id);
        }
      } catch (error) {
        console.error("Error fetching categories:", error);
      }
    };
    fetchCategories();
  }, []);

  const fetchSubthemes = async (catId) => {
    setLoadingSubthemes(true);
    try {
      const subData = await getCachedSubcategories(catId);
      setSubthemes(subData);
      
      if (subData.length > 0) {
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
    
    // Validación preventiva para evitar caídas de Next.js Image
    if (!value || !value.startsWith('http') || value.length < 12) {
      setPreview('');
      return;
    }

    try {
      const formatted = formatDriveUrl(value);
      // Solo actualizamos el preview si la URL resultante es válida
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

    // Validación del link de Drive si existe
    if (newDriveLink && !newDriveLink.startsWith('http')) {
      await Swal.fire({
        icon: 'error',
        title: 'Link inválido',
        text: 'Por favor, introduce un enlace válido de Google Drive (debe empezar con http/https).',
        background: isDark ? '#1f2937' : '#ffffff',
        color: isDark ? '#f9fafb' : '#111827',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }
    
    const confirmResult = await Swal.fire({
      title: '¿Registrar tarjeta?',
      text: `Se asignará al identificador: ${formData.subtema}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, guardar',
      cancelButtonText: 'Cancelar',
      background: isDark ? '#1f2937' : '#ffffff',
      color: isDark ? '#f9fafb' : '#111827',
      confirmButtonColor: '#3b82f6',
      cancelButtonColor: '#ef4444',
    });

    if (!confirmResult.isConfirmed) return;

    setLoading(true);
    try {
      const tagsArray = formData.tags
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag !== '');

      const finalDriveUrl = preview || newDriveLink;

      // Limpieza de data para Cloze Deletion
      const finalData = { ...formData };
      if (finalData.tipo === 'Completar Espacios') {
        finalData.respuesta = ''; // En Cloze, la data está en la pregunta
      }

      await addDoc(collection(db, 'flashcards'), {
        ...finalData,
        driveUrl: finalDriveUrl,
        tags: tagsArray,
        createdAt: serverTimestamp(),
      });
      invalidateFlashcardCache();

      await Swal.fire({
        icon: 'success',
        title: '¡Guardado!',
        text: 'La flashcard se ha creado y asignado correctamente.',
        background: isDark ? '#1f2937' : '#ffffff',
        color: isDark ? '#f9fafb' : '#111827',
        confirmButtonColor: '#3b82f6',
      });

      router.push('/admin/flashcards');
    } catch (error) {
      console.error("Error al crear:", error);
      Swal.fire({ 
        icon: 'error', 
        title: 'Error', 
        text: 'Hubo un problema al guardar la tarjeta.',
        background: isDark ? '#1f2937' : '#ffffff',
        color: isDark ? '#f9fafb' : '#111827'
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isLoaded) return null;

  // Colores dinámicos
  const textColor = isDark ? 'text-white' : 'text-gray-900';
  const labelColor = isDark ? 'text-gray-300' : 'text-gray-700';
  const inputBg = isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-300';
  const swalTheme = { background: isDark ? '#1f2937' : '#ffffff', color: isDark ? '#f9fafb' : '#111827' };

  return (
    <div className="p-4 sm:p-8 min-h-screen transition-colors duration-300" style={{ backgroundColor: isDark ? '#111827' : '#f8fafc' }}>
      <div className="max-w-6xl mx-auto">
        <Link href="/admin/flashcards" className={`flex items-center gap-2 mb-6 transition-colors ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-blue-600'}`}>
          <ArrowLeft className="w-5 h-5" /> Volver al listado
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Formulario */}
          <div className={`p-6 rounded-2xl shadow-sm border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <h1 className="text-2xl font-bold mb-6 flex items-center gap-2" style={{ color: isDark ? '#60a5fa' : '#1e40af' }}>
              <PlusCircle className="w-6 h-6" /> Nueva Flashcard
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
                <textarea 
                  name="explicacion" 
                  rows="2" 
                  className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-500 ${inputBg} ${textColor}`} 
                  value={formData.explicacion} 
                  onChange={handleChange} 
                  placeholder="Detalles adicionales para reforzar el aprendizaje..." 
                />
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
                  <label className={`block text-sm font-semibold mb-1 ${labelColor}`}>Tags (separados por coma)</label>
                  <div className="relative">
                    <input 
                      name="tags" 
                      type="text" 
                      className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-500 ${inputBg} ${textColor}`} 
                      placeholder="amir, enarm, neurologia..." 
                      value={formData.tags} 
                      onChange={handleChange} 
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className={`block text-sm font-semibold mb-1 ${labelColor}`}>Link Google Drive (Imagen)</label>
                <input 
                  type="text" 
                  value={newDriveLink} 
                  onChange={handleLinkChange} 
                  className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-500 ${inputBg} ${textColor}`} 
                  placeholder="https://drive.google.com/file/d/..." 
                />
              </div>

              <button 
                type="submit" 
                disabled={loading} 
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold shadow-lg disabled:bg-gray-400 transition-all transform hover:scale-[1.01]"
              >
                <Save className="w-5 h-5" /> {loading ? 'Guardando...' : 'Guardar Tarjeta'}
              </button>
            </form>
          </div>

          <div className="space-y-6">
            {/* Previsualización de Imagen */}
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
