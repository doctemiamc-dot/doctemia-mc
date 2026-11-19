"use client";
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { 
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  serverTimestamp 
} from 'firebase/firestore';
import { useTheme } from '@/context/ThemeContext';
import { 
  Plus, 
  Edit2, 
  Trash2, 
  Search, 
  Layers, 
  BookOpen, 
  ChevronRight,
  Loader2,
  Save,
  X
} from 'lucide-react';
import Swal from 'sweetalert2';

export default function CategoriasTemasPage() {
  const { isDark, isLoaded } = useTheme();
  const [categories, setCategories] = useState([]);
  const [subcategories, setSubcategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCat, setSelectedCat] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Estados para modales/edición
  const [isAddingCat, setIsAddingCat] = useState(false);
  const [isAddingSub, setIsAddingSub] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newSubName, setNewSubName] = useState('');
  const [editingItem, setEditingItem] = useState(null); // { id, name, type: 'cat'|'sub' }

  const swalConfig = {
    background: isDark ? '#1f2937' : '#ffffff',
    color: isDark ? '#f9fafb' : '#111827',
    confirmButtonColor: '#3b82f6',
    cancelButtonColor: '#ef4444',
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'course_categories'), orderBy('name', 'asc'));
      const querySnapshot = await getDocs(q);
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCategories(data);
      if (data.length > 0 && !selectedCat) {
        handleSelectCategory(data[0]);
      }
    } catch (error) {
      console.error("Error fetching categories:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubcategories = async (catId) => {
    try {
      const subRef = collection(db, 'course_categories', catId, 'subcategories');
      const q = query(subRef, orderBy('name', 'asc'));
      const querySnapshot = await getDocs(q);
      setSubcategories(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) {
      console.error("Error fetching subcategories:", error);
    }
  };

  const handleSelectCategory = (cat) => {
    setSelectedCat(cat);
    fetchSubcategories(cat.id);
  };

  // --- Operaciones de Especialidad (Categoría) ---
  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    try {
      await addDoc(collection(db, 'course_categories'), {
        name: newCatName.trim(),
        createdAt: serverTimestamp()
      });
      setNewCatName('');
      setIsAddingCat(false);
      fetchCategories();
      Swal.fire({ 
        icon: 'success', 
        title: '¡Especialidad Creada!', 
        text: `La especialidad "${newCatName}" ha sido registrada.`,
        timer: 2000, 
        showConfirmButton: false,
        ...swalConfig 
      });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo añadir la especialidad', ...swalConfig });
    }
  };

  const handleUpdateCategory = async () => {
    if (!newCatName.trim() || !editingItem) return;
    try {
      await updateDoc(doc(db, 'course_categories', editingItem.id), {
        name: newCatName.trim()
      });
      const oldName = editingItem.name;
      setEditingItem(null);
      setNewCatName('');
      fetchCategories();
      Swal.fire({ 
        icon: 'success', 
        title: 'Actualizado', 
        text: `Especialidad modificada correctamente.`,
        timer: 1500,
        showConfirmButton: false,
        ...swalConfig 
      });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar', ...swalConfig });
    }
  };

  const handleDeleteCategory = async (id, name) => {
    const result = await Swal.fire({
      title: '¿Eliminar especialidad?',
      text: `Se eliminará "${name}" y TODOS sus subtemas asociados. Esta acción no se puede deshacer.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar todo',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
      ...swalConfig
    });

    if (result.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'course_categories', id));
        if (selectedCat?.id === id) setSelectedCat(null);
        fetchCategories();
        Swal.fire({ icon: 'success', title: 'Eliminado', text: 'La especialidad ha sido borrada.', timer: 1500, showConfirmButton: false, ...swalConfig });
      } catch (error) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo eliminar', ...swalConfig });
      }
    }
  };

  // --- Operaciones de Temas (Subcategoría) ---
  const handleAddSubcategory = async () => {
    if (!newSubName.trim() || !selectedCat) return;
    try {
      const subRef = collection(db, 'course_categories', selectedCat.id, 'subcategories');
      await addDoc(subRef, {
        name: newSubName.trim(),
        createdAt: serverTimestamp()
      });
      const savedName = newSubName;
      setNewSubName('');
      setIsAddingSub(false);
      fetchSubcategories(selectedCat.id);
      Swal.fire({ 
        icon: 'success', 
        title: 'Tema Registrado', 
        text: `"${savedName}" asignado a ${selectedCat.name}`,
        timer: 2000,
        showConfirmButton: false,
        ...swalConfig 
      });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo registrar el tema', ...swalConfig });
    }
  };

  const handleUpdateSubcategory = async () => {
    if (!newSubName.trim() || !editingItem || !selectedCat) return;
    try {
      const subDocRef = doc(db, 'course_categories', selectedCat.id, 'subcategories', editingItem.id);
      await updateDoc(subDocRef, {
        name: newSubName.trim()
      });
      setEditingItem(null);
      setNewSubName('');
      fetchSubcategories(selectedCat.id);
      Swal.fire({ icon: 'success', title: 'Tema Actualizado', timer: 1500, showConfirmButton: false, ...swalConfig });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar el tema', ...swalConfig });
    }
  };

  const handleDeleteSubcategory = async (id, name) => {
    const result = await Swal.fire({
      title: '¿Eliminar tema?',
      text: `¿Estás seguro de eliminar el subtema "${name}"?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
      ...swalConfig
    });

    if (result.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'course_categories', selectedCat.id, 'subcategories', id));
        fetchSubcategories(selectedCat.id);
        Swal.fire({ icon: 'success', title: 'Eliminado', text: 'El tema ha sido borrado.', timer: 1500, showConfirmButton: false, ...swalConfig });
      } catch (error) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo eliminar el tema', ...swalConfig });
      }
    }
  };

  if (!isLoaded) return null;

  const filteredCategories = categories.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className={`p-4 sm:p-8 min-h-[calc(100vh-4rem)] transition-colors duration-300 ${isDark ? 'bg-[#1a2639] text-white' : 'bg-[#FFF9F0] text-[#1a2639]'}`}>
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3" style={{ color: isDark ? '#24B0BA' : '#014ba0' }}>
            <Layers className="w-8 h-8" /> Gestión de Especialidades y Temas
          </h1>
          <p className={`mt-2 ${isDark ? 'text-blue-200/80' : 'text-[#2E4A70]'}`}>
            Organiza las especialidades médicas y sus respectivos temas para el banco de preguntas y flashcards.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* COLUMNA IZQUIERDA: ESPECIALIDADES */}
          <div className="lg:col-span-4 space-y-4">
            <div className={`p-4 rounded-2xl shadow-sm border ${isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15'}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-blue-500" /> Especialidades
                </h2>
                <button 
                  onClick={() => { setIsAddingCat(true); setEditingItem(null); setNewCatName(''); }}
                  className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>

              {/* Buscador */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input 
                  type="text" 
                  placeholder="Buscar especialidad..." 
                  className={`w-full pl-10 pr-4 py-2 rounded-xl text-sm border outline-none focus:ring-2 focus:ring-blue-500 transition-all ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-300'}`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {/* Formulario rápido para añadir/editar Especialidad */}
              {(isAddingCat || (editingItem && editingItem.type === 'cat')) && (
                <div className="mb-4 p-3 rounded-xl border-2 border-blue-500/30 bg-blue-500/5 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex gap-2">
                    <input 
                      autoFocus
                      type="text" 
                      placeholder="Nombre especialidad..."
                      className={`flex-1 px-3 py-1.5 rounded-lg text-sm border outline-none ${isDark ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'}`}
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (editingItem ? handleUpdateCategory() : handleAddCategory())}
                    />
                    <button 
                      onClick={editingItem ? handleUpdateCategory : handleAddCategory}
                      className="p-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => { setIsAddingCat(false); setEditingItem(null); }}
                      className="p-1.5 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Lista de especialidades */}
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {loading ? (
                  <div className="flex justify-center py-8"><Loader2 className="animate-spin text-blue-500" /></div>
                ) : filteredCategories.map(cat => (
                  <div 
                    key={cat.id}
                    onClick={() => handleSelectCategory(cat)}
                    className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all border ${
                      selectedCat?.id === cat.id 
                        ? 'bg-blue-600 border-blue-500 text-white shadow-md' 
                        : isDark ? 'bg-gray-900/50 border-gray-700 hover:border-gray-500' : 'bg-gray-50 border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <span className="font-medium truncate">{cat.name}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setEditingItem({ ...cat, type: 'cat' }); setNewCatName(cat.name); }}
                        className={`p-1 rounded-md ${selectedCat?.id === cat.id ? 'hover:bg-blue-500' : isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id, cat.name); }}
                        className={`p-1 rounded-md ${selectedCat?.id === cat.id ? 'hover:bg-red-500' : 'hover:bg-red-100 text-red-400'}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ChevronRight className={`w-4 h-4 ${selectedCat?.id === cat.id ? 'text-white' : 'text-gray-400'}`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* COLUMNA DERECHA: TEMAS (SUBCATEGORÍAS) */}
          <div className="lg:col-span-8 space-y-4">
            <div className={`p-6 rounded-2xl shadow-sm border min-h-[400px] ${isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-[#2E4A70]/15'}`}>
              {selectedCat ? (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                      <h3 className="text-xl font-bold flex items-center gap-2">
                        Subtemas Flashcards de:<span className="text-blue-500">{selectedCat.name}</span>
                      </h3>
                      <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Gestiona los subtemas específicos para esta especialidad.
                      </p>
                    </div>
                    <button 
                      onClick={() => { setIsAddingSub(true); setEditingItem(null); setNewSubName(''); }}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/20"
                    >
                      <Plus className="w-5 h-5" /> Nuevo Tema
                    </button>
                  </div>

                  {/* Formulario añadir/editar Tema */}
                  {(isAddingSub || (editingItem && editingItem.type === 'sub')) && (
                    <div className="mb-6 p-4 rounded-xl border-2 border-indigo-500/30 bg-indigo-500/5 animate-in zoom-in-95 duration-200">
                      <div className="flex flex-col sm:flex-row gap-3">
                        <input 
                          autoFocus
                          type="text" 
                          placeholder="Nombre del tema (ej: Neumonía, Diabetes Mellitus...)"
                          className={`flex-1 px-4 py-2 rounded-xl border outline-none focus:ring-2 focus:ring-indigo-500 ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-300'}`}
                          value={newSubName}
                          onChange={(e) => setNewSubName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && (editingItem ? handleUpdateSubcategory() : handleAddSubcategory())}
                        />
                        <div className="flex gap-2">
                          <button 
                            onClick={editingItem ? handleUpdateSubcategory : handleAddSubcategory}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold"
                          >
                            <Save className="w-4 h-4" /> {editingItem ? 'Actualizar' : 'Guardar'}
                          </button>
                          <button 
                            onClick={() => { setIsAddingSub(false); setEditingItem(null); }}
                            className="px-4 py-2 bg-gray-500 text-white rounded-xl hover:bg-gray-600"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Grid de Temas */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {subcategories.length === 0 ? (
                      <div className="col-span-full flex flex-col items-center justify-center py-12 opacity-50">
                        <Layers className="w-12 h-12 mb-2" />
                        <p>No hay temas registrados para esta especialidad.</p>
                      </div>
                    ) : subcategories.map(sub => (
                      <div 
                        key={sub.id}
                        className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                          isDark ? 'bg-gray-900/30 border-gray-700 hover:border-indigo-500/50' : 'bg-gray-50 border-gray-200 hover:border-indigo-300 shadow-sm'
                        }`}
                      >
                        <span className="font-semibold">{sub.name}</span>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => { setEditingItem({ ...sub, type: 'sub' }); setNewSubName(sub.name); setIsAddingSub(false); }}
                            className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteSubcategory(sub.id, sub.name)}
                            className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center py-20 opacity-40">
                  <ChevronRight className="w-16 h-16 mb-4 rotate-180" />
                  <p className="text-xl font-medium">Selecciona una especialidad de la izquierda para ver sus temas.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: ${isDark ? '#374151' : '#d1d5db'};
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: ${isDark ? '#4b5563' : '#9ca3af'};
        }
      `}</style>
    </div>
  );
}
