'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { singlePaymentCoursesCollectionRef } from '@/lib/db';
import Swal from 'sweetalert2';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { formatDriveUrl } from '@/lib/driveUtils';
import { getCachedCategories, invalidateCatalogCache } from '@/lib/catalogCache';
import {
  ArrowLeft,
  Image as ImageIcon,
  Layers,
  Video,
  Plus,
  Trash2,
  UploadCloud,
  ChevronDown,
  ChevronUp,
  Loader2,
  Save,
  X,
} from 'lucide-react';
import { validateMaterialFile } from '@/lib/materialUtils';
import { cleanYouTubeUrl } from '@/lib/youtubeUtils';
import { toast, Toaster } from 'react-hot-toast';
import MaterialAttachPanel from './MaterialAttachPanel';

let clientCounter = 0;
function nextClientId(prefix = 'id') {
  clientCounter += 1;
  return `${prefix}_${Date.now()}_${clientCounter}`;
}

function createEmptyVideo() {
  return {
    clientId: nextClientId('vid'),
    title: '',
    url: '',
    originalUrl: '',
    driveLink: '',
  };
}

function createEmptyModule() {
  return {
    clientId: nextClientId('mod'),
    originalIndex: null,
    title: '',
    summaryDriveLink: '',
    isExpanded: true,
    videos: [],
  };
}

function convertCoverPreviewUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:') || trimmed.startsWith('/')) {
    return trimmed;
  }
  if (trimmed.includes('drive.google.com/thumbnail')) {
    return trimmed;
  }
  if (trimmed.includes('drive.google.com/uc') || trimmed.includes('drive.google.com/open')) {
    try {
      const id = new URL(trimmed).searchParams.get('id');
      if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w800`;
    } catch {
      // ignore malformed URL
    }
  }
  if (trimmed.includes('drive.google.com')) {
    const fileIdMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (fileIdMatch?.[1]) {
      return `https://drive.google.com/thumbnail?id=${fileIdMatch[1]}&sz=w800`;
    }
  }
  return trimmed;
}

export default function CourseForm({ course, courseId }) {
  const router = useRouter();
  const { isDark } = useTheme();
  const { firebaseAuthUser } = useAuth();
  const coverInputRef = useRef(null);

  const [title, setTitle] = useState(course ? course.title : '');
  const [description, setDescription] = useState(course ? course.description : '');
  const [imageUrl, setImageUrl] = useState(course ? course.imageUrl : '');
  const [summaryDriveLink, setSummaryDriveLink] = useState(
    course ? course.summaryDriveLink || '' : ''
  );
  const [categoryId, setCategoryId] = useState(course ? course.categoryId || '' : '');
  const [isActive, setIsActive] = useState(
    course?.isActive !== undefined ? course.isActive : true
  );
  const [categories, setCategories] = useState([]);

  const [modules, setModules] = useState(() => {
    if (course?.modules && course.modules.length > 0) {
      return course.modules.map((mod, mIdx) => {
        const cleanVideos = Array.isArray(mod.videos)
          ? mod.videos
              .filter((v) =>
                Boolean(v?.url?.trim() || v?.title?.trim() || v?.driveLink?.trim())
              )
              .map((v) => ({
                clientId: nextClientId('vid'),
                title: v.title || '',
                url: v.url || '',
                originalUrl: v.url || '',
                driveLink: v.driveLink || '',
              }))
          : [];
        return {
          clientId: nextClientId('mod'),
          originalIndex: mIdx,
          title: mod.title || '',
          summaryDriveLink: mod.summaryDriveLink || '',
          isExpanded: mIdx === 0,
          videos: cleanVideos,
        };
      });
    }
    return [createEmptyModule()];
  });

  const [loading, setLoading] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [isDraggingCover, setIsDraggingCover] = useState(false);
  const [localCoverPreview, setLocalCoverPreview] = useState('');
  const [coverUseDriveFallback, setCoverUseDriveFallback] = useState(false);
  const [coverPreviewError, setCoverPreviewError] = useState(false);

  const [courseMaterials, setCourseMaterials] = useState([]);
  const [stagedCourseFiles, setStagedCourseFiles] = useState([]);
  const [uploadingMaterialKey, setUploadingMaterialKey] = useState(null);

  const getAuthHeaders = async () => {
    try {
      if (firebaseAuthUser && typeof firebaseAuthUser.getIdToken === 'function') {
        const token = await firebaseAuthUser.getIdToken();
        if (token) return { Authorization: `Bearer ${token}` };
      }
    } catch {
      // fallback to session cookie
    }
    return {};
  };

  const swalTheme = useMemo(
    () => ({
      background: isDark ? '#1f2937' : '#ffffff',
      color: isDark ? '#f9fafb' : '#111827',
      confirmButtonColor: '#4f46e5',
      cancelButtonColor: '#ef4444',
    }),
    [isDark]
  );

  const loadCourseMaterials = async (targetCourseId) => {
    if (!targetCourseId) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `/api/materials?course_id=${encodeURIComponent(targetCourseId)}&include_inactive=true`,
        { headers }
      );
      const data = await res.json();
      if (res.ok) {
        setCourseMaterials(data.materials || []);
      }
    } catch (err) {
      console.error('Error cargando materiales del curso:', err);
    }
  };

  useEffect(() => {
    if (courseId) {
      loadCourseMaterials(courseId);
    }
  }, [courseId]);

  useEffect(() => {
    let cancelled = false;
    const loadCategories = async () => {
      try {
        const categoriesData = await getCachedCategories();
        if (cancelled) return;
        setCategories(categoriesData);
      } catch (err) {
        console.error('Error cargando categorías:', err);
      }
    };
    loadCategories();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCoverPreviewError(false);
    setCoverUseDriveFallback(false);
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      if (localCoverPreview) URL.revokeObjectURL(localCoverPreview);
    };
  }, [localCoverPreview]);

  // --- Subida de Portada ---
  const handleCoverUpload = async (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !/\.(png|jpg|jpeg|webp)$/i.test(file.name)) {
      toast.error('Formato no válido. Usa PNG, JPG, JPEG o WEBP.');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setLocalCoverPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return objectUrl;
    });
    setCoverPreviewError(false);
    setCoverUseDriveFallback(false);
    setUploadingCover(true);

    try {
      const fd = new FormData();
      fd.append('file', file);
      const headers = await getAuthHeaders();
      const res = await fetch('/api/course-covers', {
        method: 'POST',
        headers,
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error subiendo portada');
      setImageUrl(data.url);
      toast.success('Imagen de portada subida.');
    } catch (err) {
      setLocalCoverPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return '';
      });
      Swal.fire({
        title: 'No se pudo subir la portada',
        text: err.message || 'Verifica tu sesión o el formato de la imagen.',
        icon: 'error',
        ...swalTheme,
      });
    } finally {
      setUploadingCover(false);
    }
  };

  // --- Subida y gestión de Materiales (Curso / Módulo / Video) ---
  const uploadItemsToCourse = async ({
    items,
    targetCourseId,
    moduleIndex = null,
    videoUrl = null,
  }) => {
    const formData = new FormData();
    items.forEach((item) => formData.append('files', item.file));
    formData.append(
      'items_meta',
      JSON.stringify(
        items.map((item) => ({
          title: (item.title || '').trim() || item.file.name.replace(/\.[^/.]+$/, ''),
          material_type: item.materialType || 'pdf',
        }))
      )
    );
    if (categoryId) {
      const esp = categories.find((c) => c.id === categoryId);
      formData.append('especialidad_id', categoryId);
      if (esp?.name) formData.append('especialidad_nombre', esp.name);
    }
    formData.append('course_id', targetCourseId);
    if (moduleIndex !== null && moduleIndex !== undefined) {
      formData.append('module_index', String(moduleIndex));
    }
    if (videoUrl) {
      formData.append('video_url', videoUrl);
    }

    const headers = await getAuthHeaders();
    const res = await fetch('/api/materials', { method: 'POST', headers, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error subiendo archivo(s)');
    return data.materials || [];
  };

  const handleAttachFiles = async (
    fileList,
    materialType,
    { scope, targetKey, moduleClientId = null, videoClientId = null, moduleIndex = null, videoUrl = null }
  ) => {
    const incoming = Array.from(fileList || []);
    const validItems = [];
    for (const f of incoming) {
      const check = validateMaterialFile(f.name, f.type);
      if (!check.valid) {
        toast.error(`${f.name}: ${check.error}`);
        continue;
      }
      validItems.push({
        id: nextClientId('staged'),
        file: f,
        title: f.name.replace(/\.[^/.]+$/, ''),
        materialType: materialType || 'pdf',
        scope,
        targetKey,
        moduleClientId,
        videoClientId,
      });
    }
    if (validItems.length === 0) return;

    // En modo creación o en un video nuevo que aún no tiene URL (o módulo nuevo aún sin índice persistido), se encola para subir al guardar
    const canUploadImmediately =
      Boolean(courseId) &&
      (scope === 'course' ||
        (scope === 'module' && moduleIndex !== null) ||
        (scope === 'video' && Boolean(videoUrl?.trim())));

    if (!canUploadImmediately) {
      setStagedCourseFiles((prev) => [...prev, ...validItems]);
      toast.success(
        `${validItems.length} ${validItems.length === 1 ? 'archivo preparado' : 'archivos preparados'} para subirse al guardar.`
      );
      return;
    }

    setUploadingMaterialKey(targetKey);
    try {
      await uploadItemsToCourse({
        items: validItems,
        targetCourseId: courseId,
        moduleIndex: scope === 'course' ? null : moduleIndex,
        videoUrl: scope === 'video' ? videoUrl.trim() : null,
      });
      toast.success('Material(es) subido(s) a Supabase Storage.');
      await loadCourseMaterials(courseId);
    } catch (err) {
      Swal.fire({ title: 'Error', text: err.message, icon: 'error', ...swalTheme });
    } finally {
      setUploadingMaterialKey(null);
    }
  };

  const handleUpdateStagedItem = (id, patch) => {
    setStagedCourseFiles((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const handleRemoveStagedItem = (id) => {
    setStagedCourseFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const handleUpdateSavedMaterial = async (materialId, patch) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/materials/${materialId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo actualizar el material');
      setCourseMaterials((prev) =>
        prev.map((m) => (m.id === materialId ? { ...m, ...data.material } : m))
      );
      toast.success('Material actualizado.');
    } catch (err) {
      toast.error(err.message || 'Error al actualizar material');
    }
  };

  const handleDeleteSavedMaterial = async (materialId) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/materials/${materialId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'No se pudo eliminar');
      }
      setCourseMaterials((prev) => prev.filter((m) => m.id !== materialId));
      toast.success('Material eliminado.');
    } catch (err) {
      Swal.fire({ title: 'Error', text: err.message, icon: 'error', ...swalTheme });
    }
  };

  // --- Manejadores de Módulos y Videos ---
  const handleModuleFieldChange = (moduleIndex, field, value) => {
    setModules((prev) =>
      prev.map((mod, idx) => (idx === moduleIndex ? { ...mod, [field]: value } : mod))
    );
  };

  const toggleModuleExpanded = (moduleIndex) => {
    setModules((prev) =>
      prev.map((mod, idx) =>
        idx === moduleIndex ? { ...mod, isExpanded: !mod.isExpanded } : mod
      )
    );
  };

  const addModule = () => {
    setModules((prev) => [...prev, createEmptyModule()]);
  };

  const removeModule = (moduleIndex) => {
    if (modules.length <= 1) {
      Swal.fire({
        title: 'Aviso',
        text: 'Debe haber al menos un módulo en el curso.',
        icon: 'info',
        ...swalTheme,
      });
      return;
    }
    const targetMod = modules[moduleIndex];
    const videoIds = new Set(targetMod.videos.map((v) => v.clientId));
    setStagedCourseFiles((prev) =>
      prev.filter(
        (s) => s.moduleClientId !== targetMod.clientId && !videoIds.has(s.videoClientId)
      )
    );
    setModules((prev) => prev.filter((_, idx) => idx !== moduleIndex));
  };

  const handleVideoFieldChange = (moduleIndex, videoIndex, field, value) => {
    setModules((prev) =>
      prev.map((mod, mIdx) => {
        if (mIdx !== moduleIndex) return mod;
        return {
          ...mod,
          videos: mod.videos.map((vid, vIdx) =>
            vIdx === videoIndex ? { ...vid, [field]: value } : vid
          ),
        };
      })
    );
  };

  const addVideo = (moduleIndex) => {
    setModules((prev) =>
      prev.map((mod, idx) =>
        idx === moduleIndex
          ? { ...mod, isExpanded: true, videos: [...mod.videos, createEmptyVideo()] }
          : mod
      )
    );
  };

  const removeVideo = (moduleIndex, videoIndex) => {
    const targetVid = modules[moduleIndex].videos[videoIndex];
    if (targetVid) {
      setStagedCourseFiles((prev) =>
        prev.filter((s) => s.videoClientId !== targetVid.clientId)
      );
    }
    setModules((prev) =>
      prev.map((mod, mIdx) =>
        mIdx === moduleIndex
          ? { ...mod, videos: mod.videos.filter((_, vIdx) => vIdx !== videoIndex) }
          : mod
      )
    );
  };

  // --- Envío del Formulario ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      Swal.fire({
        title: 'Campo Obligatorio',
        text: 'El título del curso no puede estar vacío.',
        icon: 'warning',
        ...swalTheme,
      });
      return;
    }

    // Verificar consistencia de videos (opcionales: solo validar si se empezó a llenar un video o tiene archivos en cola)
    for (let mIdx = 0; mIdx < modules.length; mIdx++) {
      const mod = modules[mIdx];
      for (let vIdx = 0; vIdx < mod.videos.length; vIdx++) {
        const vid = mod.videos[vIdx];
        const hasStagedForVideo = stagedCourseFiles.some((s) => s.videoClientId === vid.clientId);
        if (hasStagedForVideo && !vid.url.trim()) {
          setModules((prev) =>
            prev.map((m, idx) => (idx === mIdx ? { ...m, isExpanded: true } : m))
          );
          Swal.fire({
            title: 'Falta la URL del video',
            text: `Adjuntaste materiales al Video ${vIdx + 1} del Módulo ${mIdx + 1}, pero aún no ingresaste la URL del video. Si este módulo solo usa PDFs o diapositivas, adjunta esos archivos en "Material del Módulo".`,
            icon: 'warning',
            ...swalTheme,
          });
          return;
        }
        if (vid.title.trim() && !vid.url.trim() && !vid.driveLink?.trim()) {
          setModules((prev) =>
            prev.map((m, idx) => (idx === mIdx ? { ...m, isExpanded: true } : m))
          );
          Swal.fire({
            title: 'Falta la URL del video',
            text: `El Video ${vIdx + 1} del Módulo ${mIdx + 1} tiene título pero no tiene enlace de YouTube. Ingresa el enlace o elimínalo si el módulo solo contendrá PDFs/diapositivas.`,
            icon: 'warning',
            ...swalTheme,
          });
          return;
        }
      }
    }

    setLoading(true);

    const cleanedModules = modules.map((mod) => {
      const modObj = {
        title: mod.title.trim(),
        videos: mod.videos
          .filter((v) => Boolean(v.title?.trim() || v.url?.trim() || v.driveLink?.trim()))
          .map((v) => {
            const cleanedVideo = {
              title: v.title.trim(),
              url: cleanYouTubeUrl(v.url),
            };
            if (v.driveLink && v.driveLink.trim()) {
              cleanedVideo.driveLink = v.driveLink.trim();
            }
            return cleanedVideo;
          }),
      };
      if (mod.summaryDriveLink && mod.summaryDriveLink.trim()) {
        modObj.summaryDriveLink = mod.summaryDriveLink.trim();
      }
      return modObj;
    });

    const courseData = {
      title: title.trim(),
      description: description.trim(),
      imageUrl: imageUrl.trim(),
      summaryDriveLink: summaryDriveLink.trim(),
      isActive,
      categoryId: categoryId || null,
      modules: cleanedModules,
      updatedAt: serverTimestamp(),
    };

    try {
      let targetCourseId = courseId;

      if (courseId) {
        const courseDoc = doc(singlePaymentCoursesCollectionRef, courseId);
        await updateDoc(courseDoc, courseData);

        // Sincronizar cambios de URL de video o reordenamiento de módulos en materiales ya guardados
        const authHeaders = await getAuthHeaders();
        const syncPatches = [];
        modules.forEach((mod, newModIdx) => {
          if (mod.originalIndex !== null && mod.originalIndex !== newModIdx) {
            courseMaterials
              .filter((m) => !m.video_url && m.module_index === mod.originalIndex)
              .forEach((m) => {
                syncPatches.push(
                  fetch(`/api/materials/${m.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', ...authHeaders },
                    body: JSON.stringify({ module_index: newModIdx }),
                  })
                );
              });
          }

          mod.videos.forEach((vid) => {
            const oldUrl = vid.originalUrl?.trim();
            const newUrl = cleanYouTubeUrl(vid.url);
            if (oldUrl && newUrl && oldUrl !== newUrl) {
              courseMaterials
                .filter((m) => m.video_url === oldUrl)
                .forEach((m) => {
                  syncPatches.push(
                    fetch(`/api/materials/${m.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', ...authHeaders },
                      body: JSON.stringify({ video_url: newUrl, module_index: newModIdx }),
                    })
                  );
                });
            }
          });
        });

        if (syncPatches.length > 0) {
          await Promise.allSettled(syncPatches);
        }
      } else {
        const createdRef = await addDoc(singlePaymentCoursesCollectionRef, {
          ...courseData,
          createdAt: serverTimestamp(),
        });
        targetCourseId = createdRef.id;
      }

      // Subir archivos que quedaron en cola (agrupados por destino)
      if (stagedCourseFiles.length > 0 && targetCourseId) {
        const groups = new Map();

        for (const item of stagedCourseFiles) {
          let resolvedModuleIndex = null;
          let resolvedVideoUrl = null;

          if (item.scope === 'module') {
            const mIdx = modules.findIndex((m) => m.clientId === item.moduleClientId);
            if (mIdx === -1) continue;
            resolvedModuleIndex = mIdx;
          } else if (item.scope === 'video') {
            let foundModIdx = -1;
            let foundVid = null;
            modules.forEach((m, mIdx) => {
              const v = m.videos.find((vid) => vid.clientId === item.videoClientId);
              if (v) {
                foundModIdx = mIdx;
                foundVid = v;
              }
            });
            if (foundModIdx === -1 || !foundVid?.url?.trim()) continue;
            resolvedModuleIndex = foundModIdx;
            resolvedVideoUrl = cleanYouTubeUrl(foundVid.url);
          }

          const groupKey = `${item.scope}::${resolvedModuleIndex ?? 'null'}::${resolvedVideoUrl ?? 'null'}`;
          if (!groups.has(groupKey)) {
            groups.set(groupKey, {
              moduleIndex: resolvedModuleIndex,
              videoUrl: resolvedVideoUrl,
              items: [],
            });
          }
          groups.get(groupKey).items.push(item);
        }

        const groupList = Array.from(groups.values());
        const GROUP_CONCURRENCY = 2;
        for (let i = 0; i < groupList.length; i += GROUP_CONCURRENCY) {
          const chunk = groupList.slice(i, i + GROUP_CONCURRENCY);
          await Promise.all(
            chunk.map((group) =>
              uploadItemsToCourse({
                items: group.items,
                targetCourseId,
                moduleIndex: group.moduleIndex,
                videoUrl: group.videoUrl,
              })
            )
          );
        }
      }

      invalidateCatalogCache('pu_courses_');

      await Swal.fire({
        title: courseId ? 'Actualizado' : 'Creado',
        text: courseId
          ? 'El curso y sus materiales han sido actualizados con éxito.'
          : 'El curso y sus materiales han sido creados con éxito.',
        icon: 'success',
        ...swalTheme,
      });
      router.push('/admin/Cursos_Pago_Unico');
    } catch (error) {
      console.error('Error saving course:', error);
      Swal.fire({
        title: 'Error',
        text: error?.message || 'Hubo un error al guardar el curso.',
        icon: 'error',
        ...swalTheme,
      });
    } finally {
      setLoading(false);
    }
  };

  // --- Métricas resumidas ---
  const totalVideos = modules.reduce(
    (acc, m) => acc + m.videos.filter((v) => Boolean(v.url?.trim())).length,
    0
  );
  const totalMaterials = courseMaterials.length + stagedCourseFiles.length;

  const generalSavedMaterials = courseMaterials.filter(
    (m) => !m.video_url && (m.module_index === null || m.module_index === undefined)
  );
  const generalStagedItems = stagedCourseFiles.filter((s) => s.scope === 'course');

  const inputBaseClasses =
    'w-full rounded-lg border px-3.5 py-2.5 text-sm shadow-sm transition-colors duration-150 focus:outline-none focus:ring-2';
  const inputThemeClasses = isDark
    ? 'bg-gray-700/80 border-gray-600 text-white placeholder:text-gray-400 focus:border-indigo-400 focus:ring-indigo-400/30'
    : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-indigo-600 focus:ring-indigo-600/20';
  const labelClasses = `block text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`;
  const cardClasses = `rounded-xl border shadow-sm ${
    isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
  }`;

  const trimmedImageUrl = imageUrl.trim();
  const isDriveImageUrl =
    trimmedImageUrl.includes('drive.google.com') ||
    trimmedImageUrl.includes('googleusercontent.com');
  const previewImageSrc =
    localCoverPreview ||
    (coverUseDriveFallback && isDriveImageUrl
      ? formatDriveUrl(trimmedImageUrl)
      : convertCoverPreviewUrl(trimmedImageUrl));

  return (
    <div className={`min-h-screen py-5 px-3 sm:px-6 lg:px-8 ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <Toaster
        position="top-right"
        toastOptions={{
          className: isDark ? '!bg-gray-800 !text-white !border !border-gray-700' : '',
        }}
      />
      <form onSubmit={handleSubmit} className="space-y-6 w-full max-w-[1440px] mx-auto">
        {/* Encabezado */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <Link
              href="/admin/Cursos_Pago_Unico"
              className={`inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium transition-colors ${
                isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              Volver a Cursos de Pago Único
            </Link>
            <h1 className={`text-2xl sm:text-3xl font-bold tracking-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {courseId ? 'Editar Curso' : 'Crear Nuevo Curso'}
            </h1>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              {courseId
                ? 'Actualiza los datos, módulos, PDFs/diapositivas y videos opcionales.'
                : 'Completa los datos del curso y sube tus PDFs o diapositivas por módulos (los videos son opcionales).'}
            </p>
          </div>

          <div
            className={`self-start sm:self-center px-3 py-2 rounded-lg border text-xs font-medium flex flex-wrap items-center gap-2 ${
              isDark
                ? 'bg-gray-800 border-gray-700 text-gray-300'
                : 'bg-white border-gray-200 text-gray-700'
            }`}
          >
            <span>{modules.length} {modules.length === 1 ? 'módulo' : 'módulos'}</span>
            <span className="opacity-40">•</span>
            <span>{totalMaterials} {totalMaterials === 1 ? 'material' : 'materiales'}</span>
            <span className="opacity-40">•</span>
            <span>
              {totalVideos > 0
                ? `${totalVideos} ${totalVideos === 1 ? 'video' : 'videos'}`
                : 'Sin videos (Solo documentos)'}
            </span>
          </div>
        </div>

        {/* LAYOUT PRINCIPAL: 1 columna en móvil/tablet, 2 columnas en pantallas grandes (xl+) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* SECCIÓN 1: INFORMACIÓN GENERAL (Izquierda en xl) */}
          <section className={`xl:col-span-5 ${cardClasses} p-4 sm:p-6 space-y-6`}>
          <div className={`border-b pb-3 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <h2 className={`text-base sm:text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Información General
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-6">
            <div className="sm:col-span-6">
              <label htmlFor="title" className={labelClasses}>
                Título del Curso <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="Ej: Cardiología Clínica Integral"
                className={`mt-1.5 ${inputBaseClasses} ${inputThemeClasses}`}
              />
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="category" className={labelClasses}>
                Especialidad / Categoría (Opcional)
              </label>
              <select
                id="category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className={`mt-1.5 ${inputBaseClasses} ${inputThemeClasses}`}
              >
                <option value="">-- Sin categoría --</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="status" className={labelClasses}>
                Estado del Curso
              </label>
              <select
                id="status"
                value={String(isActive)}
                onChange={(e) => setIsActive(e.target.value === 'true')}
                className={`mt-1.5 ${inputBaseClasses} ${inputThemeClasses}`}
              >
                <option value="true">Activo (Visible para estudiantes)</option>
                <option value="false">Inactivo (Oculto para estudiantes)</option>
              </select>
            </div>

            <div className="sm:col-span-6">
              <label htmlFor="description" className={labelClasses}>
                Descripción
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Describe brevemente los objetivos y alcance del curso..."
                className={`mt-1.5 ${inputBaseClasses} ${inputThemeClasses}`}
              />
            </div>

            {/* Portada del Curso: Drag & Drop + URL Opcional + Vista Previa */}
            <div className={`sm:col-span-6 pt-3 border-t space-y-3 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
              <label htmlFor="imageUrl" className={labelClasses}>
                Imagen de Portada del Curso (Opcional)
              </label>
              <div className="grid grid-cols-1 md:grid-cols-12 xl:grid-cols-1 gap-4 items-start">
                <div className="md:col-span-7 xl:col-span-1 space-y-3">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => coverInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        coverInputRef.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingCover(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setIsDraggingCover(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingCover(false);
                      if (e.dataTransfer?.files?.[0]) {
                        handleCoverUpload(e.dataTransfer.files[0]);
                      }
                    }}
                    className={`rounded-xl border-2 border-dashed p-4 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      isDraggingCover
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : isDark
                          ? 'border-gray-600 bg-gray-900/40 hover:border-indigo-400'
                          : 'border-gray-300 bg-gray-50 hover:border-indigo-500'
                    }`}
                  >
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        if (e.target.files?.[0]) handleCoverUpload(e.target.files[0]);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2.5 rounded-lg flex-shrink-0 ${
                          isDark ? 'bg-indigo-950/70 text-indigo-400' : 'bg-indigo-100 text-indigo-600'
                        }`}
                      >
                        {uploadingCover ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <ImageIcon className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                          {uploadingCover ? 'Subiendo portada...' : 'Arrastra la portada o haz clic para subir'}
                        </p>
                        <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          PNG, JPG o WEBP (recomendado 16:9, máx. 10 MB)
                        </p>
                      </div>
                      <UploadCloud className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
                    </div>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      id="imageUrl"
                      value={imageUrl}
                      onChange={(e) => {
                        if (localCoverPreview) {
                          URL.revokeObjectURL(localCoverPreview);
                          setLocalCoverPreview('');
                        }
                        setImageUrl(e.target.value);
                      }}
                      placeholder="O pega una URL externa / Google Drive (opcional)"
                      className={`${inputBaseClasses} ${inputThemeClasses} pr-10`}
                    />
                    {(imageUrl || localCoverPreview) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (localCoverPreview) {
                            URL.revokeObjectURL(localCoverPreview);
                            setLocalCoverPreview('');
                          }
                          setImageUrl('');
                        }}
                        aria-label="Limpiar URL de portada"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-red-500"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Vista previa de portada */}
                <div className="md:col-span-5 xl:col-span-1">
                  <div
                    className={`aspect-video w-full rounded-xl border overflow-hidden flex items-center justify-center relative ${
                      isDark ? 'bg-gray-900 border-gray-700' : 'bg-gray-100 border-gray-200'
                    }`}
                  >
                    {previewImageSrc && !coverPreviewError ? (
                      <img
                        key={previewImageSrc}
                        src={previewImageSrc}
                        alt="Vista previa de portada"
                        referrerPolicy={previewImageSrc.startsWith('http') ? 'no-referrer' : undefined}
                        onError={() => {
                          if (localCoverPreview) {
                            URL.revokeObjectURL(localCoverPreview);
                            setLocalCoverPreview('');
                            return;
                          }
                          if (!coverUseDriveFallback && isDriveImageUrl) {
                            setCoverUseDriveFallback(true);
                            return;
                          }
                          setCoverPreviewError(true);
                        }}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-center px-3 py-4">
                        <ImageIcon className={`w-7 h-7 mx-auto mb-1.5 ${isDark ? 'text-gray-600' : 'text-gray-400'}`} />
                        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                          {coverPreviewError ? 'No se pudo cargar vista previa' : 'Sin portada seleccionada'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Materiales Generales del Curso (PDFs, Diapositivas y URL opcional) */}
            <div className={`sm:col-span-6 pt-3 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
              <MaterialAttachPanel
                scopeTitle="Materiales Generales del Curso"
                scopeHint="Sube PDFs o diapositivas generales del curso por separado. Si prefieres usar un enlace de Drive, agrégalo de forma opcional abajo."
                isDark={isDark}
                isUploading={uploadingMaterialKey === 'course'}
                savedMaterials={generalSavedMaterials}
                stagedItems={generalStagedItems}
                onFilesSelected={(files, materialType) =>
                  handleAttachFiles(files, materialType, {
                    scope: 'course',
                    targetKey: 'course',
                  })
                }
                onUpdateStagedItem={handleUpdateStagedItem}
                onRemoveStagedItem={handleRemoveStagedItem}
                onUpdateSavedMaterial={handleUpdateSavedMaterial}
                onDeleteSavedMaterial={handleDeleteSavedMaterial}
                driveUrl={summaryDriveLink}
                onDriveUrlChange={setSummaryDriveLink}
                driveLabel="Link de Resumen General en Google Drive / URL externa (opcional)"
                drivePlaceholder="https://docs.google.com/... o https://drive.google.com/..."
              />
            </div>
          </div>
        </section>

          {/* SECCIÓN 2: CONTENIDO DEL CURSO (Derecha en xl) */}
          <section className={`xl:col-span-7 ${cardClasses} p-4 sm:p-6 space-y-5`}>
          <div className={`flex flex-wrap items-center justify-between gap-3 border-b pb-3 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <div>
              <h2 className={`text-base sm:text-lg font-semibold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                <Layers className="w-5 h-5 text-indigo-500" />
                Contenido del Curso
              </h2>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Organiza los módulos con sus PDFs/diapositivas. Si aún no cuentas con videos, deja la sección de videos vacía y los alumnos visualizarán los documentos directamente.
              </p>
            </div>

            {modules.length > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setModules((prev) => prev.map((m) => ({ ...m, isExpanded: true })))
                  }
                  className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                    isDark
                      ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Expandir todos
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setModules((prev) => prev.map((m) => ({ ...m, isExpanded: false })))
                  }
                  className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                    isDark
                      ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Contraer todos
                </button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {modules.map((module, moduleIndex) => {
              const moduleSavedMaterials = courseId
                ? courseMaterials.filter(
                    (m) =>
                      !m.video_url &&
                      m.module_index === (module.originalIndex ?? moduleIndex)
                  )
                : [];
              const moduleStagedItems = stagedCourseFiles.filter(
                (s) => s.scope === 'module' && s.moduleClientId === module.clientId
              );
              const moduleMatCount =
                moduleSavedMaterials.length +
                moduleStagedItems.length +
                (module.summaryDriveLink?.trim() ? 1 : 0);

              return (
                <div
                  key={module.clientId}
                  className={`rounded-xl border overflow-hidden ${
                    isDark ? 'border-gray-700 bg-gray-900/30' : 'border-gray-200 bg-gray-50/40'
                  }`}
                >
                  {/* Cabecera colapsable del módulo */}
                  <div
                    className={`flex items-center justify-between gap-2 px-3.5 py-3 sm:px-4 ${
                      isDark ? 'bg-gray-800/80' : 'bg-gray-100/80'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleModuleExpanded(moduleIndex)}
                      className="flex items-center gap-2.5 flex-1 min-w-0 text-left py-1 focus:outline-none"
                    >
                      <span
                        className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-bold flex-shrink-0 ${
                          isDark
                            ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                            : 'bg-indigo-100 text-indigo-700'
                        }`}
                      >
                        Módulo {moduleIndex + 1}
                      </span>
                      <span
                        className={`font-semibold text-sm sm:text-base truncate ${
                          isDark ? 'text-white' : 'text-gray-900'
                        }`}
                      >
                        {module.title.trim() || 'Sin título'}
                      </span>
                      <span
                        className={`hidden sm:inline-flex text-xs flex-shrink-0 ${
                          isDark ? 'text-gray-400' : 'text-gray-500'
                        }`}
                      >
                        ({module.videos.filter((v) => Boolean(v.url?.trim())).length > 0
                          ? `${module.videos.filter((v) => Boolean(v.url?.trim())).length} ${
                              module.videos.filter((v) => Boolean(v.url?.trim())).length === 1 ? 'video' : 'videos'
                            }`
                          : 'Solo documentos'}
                        {moduleMatCount > 0 ? ` · ${moduleMatCount} mat.` : ''})
                      </span>
                      {module.isExpanded ? (
                        <ChevronUp className="w-4 h-4 flex-shrink-0 text-gray-400 ml-auto" />
                      ) : (
                        <ChevronDown className="w-4 h-4 flex-shrink-0 text-gray-400 ml-auto" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => removeModule(moduleIndex)}
                      aria-label={`Eliminar Módulo ${moduleIndex + 1}`}
                      title="Eliminar módulo"
                      className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Cuerpo del módulo */}
                  {module.isExpanded && (
                    <div className={`p-3.5 sm:p-5 space-y-5 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                      <div>
                        <label
                          htmlFor={`mod-title-${module.clientId}`}
                          className={labelClasses}
                        >
                          Título del Módulo
                        </label>
                        <input
                          id={`mod-title-${module.clientId}`}
                          type="text"
                          value={module.title}
                          onChange={(e) =>
                            handleModuleFieldChange(moduleIndex, 'title', e.target.value)
                          }
                          placeholder={`Ej: Módulo ${moduleIndex + 1} - Fisiopatología`}
                          className={`mt-1.5 ${inputBaseClasses} ${inputThemeClasses}`}
                        />
                      </div>

                      {/* Materiales propios del Módulo (PDFs, Diapositivas y URL resumen opcional) */}
                      <div
                        className={`p-3.5 sm:p-4 rounded-xl border ${
                          isDark
                            ? 'bg-gray-800/70 border-gray-700'
                            : 'bg-white border-gray-200'
                        }`}
                      >
                        <MaterialAttachPanel
                          scopeTitle={`PDFs, Diapositivas y Material del Módulo ${moduleIndex + 1}`}
                          scopeHint="Sube aquí los PDFs, diapositivas o guías de este módulo. Si el módulo no tiene videos, los alumnos visualizarán estos archivos directamente."
                          isDark={isDark}
                          compact
                          isUploading={uploadingMaterialKey === `mod:${module.clientId}`}
                          savedMaterials={moduleSavedMaterials}
                          stagedItems={moduleStagedItems}
                          onFilesSelected={(files, materialType) =>
                            handleAttachFiles(files, materialType, {
                              scope: 'module',
                              targetKey: `mod:${module.clientId}`,
                              moduleClientId: module.clientId,
                              moduleIndex: module.originalIndex ?? moduleIndex,
                            })
                          }
                          onUpdateStagedItem={handleUpdateStagedItem}
                          onRemoveStagedItem={handleRemoveStagedItem}
                          onUpdateSavedMaterial={handleUpdateSavedMaterial}
                          onDeleteSavedMaterial={handleDeleteSavedMaterial}
                          driveUrl={module.summaryDriveLink}
                          onDriveUrlChange={(val) =>
                            handleModuleFieldChange(moduleIndex, 'summaryDriveLink', val)
                          }
                          driveLabel={`Enlace de Drive o resumen del Módulo ${moduleIndex + 1} (opcional)`}
                          drivePlaceholder="https://drive.google.com/... (opcional si ya subiste archivos)"
                        />
                      </div>

                      {/* Lista de Videos del Módulo (Opcional) */}
                      <div className="space-y-3 sm:pl-4 sm:border-l-2 sm:border-indigo-500/70">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className={`text-sm font-semibold flex items-center gap-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                            <Video className="w-4 h-4 text-indigo-500" />
                            <span>Videos / Clases del Módulo</span>
                            <span
                              className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                                isDark ? 'bg-gray-800 text-gray-400 border border-gray-700' : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              Opcional
                            </span>
                          </h4>
                        </div>

                        {module.videos.length === 0 ? (
                          <div
                            className={`p-3.5 rounded-xl border border-dashed text-xs leading-relaxed ${
                              isDark
                                ? 'border-gray-700 bg-gray-800/40 text-gray-300'
                                : 'border-gray-300 bg-white text-gray-600'
                            }`}
                          >
                            Este módulo no tiene videos todavía. Se publicará con sus PDFs y diapositivas; si más adelante grabas clases, puedes añadir videos aquí.
                          </div>
                        ) : (
                          module.videos.map((video, videoIndex) => {
                            const lookupVideoUrl = (video.originalUrl || video.url || '').trim();
                            const videoSavedMaterials =
                              courseId && lookupVideoUrl
                                ? courseMaterials.filter((m) => m.video_url === lookupVideoUrl)
                                : [];
                            const videoStagedItems = stagedCourseFiles.filter(
                              (s) => s.scope === 'video' && s.videoClientId === video.clientId
                            );

                            return (
                              <div
                                key={video.clientId}
                                className={`p-3.5 sm:p-4 rounded-xl border space-y-3 ${
                                  isDark
                                    ? 'bg-gray-800 border-gray-700'
                                    : 'bg-white border-gray-200'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    className={`text-xs font-bold uppercase tracking-wider ${
                                      isDark ? 'text-indigo-400' : 'text-indigo-600'
                                    }`}
                                  >
                                    Video {videoIndex + 1}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => removeVideo(moduleIndex, videoIndex)}
                                    aria-label={`Eliminar Video ${videoIndex + 1}`}
                                    title="Eliminar video"
                                    className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div>
                                    <label
                                      htmlFor={`vid-title-${video.clientId}`}
                                      className={`block text-xs font-medium mb-1 ${
                                        isDark ? 'text-gray-300' : 'text-gray-700'
                                      }`}
                                    >
                                      Título de la Clase
                                    </label>
                                    <input
                                      id={`vid-title-${video.clientId}`}
                                      type="text"
                                      value={video.title}
                                      onChange={(e) =>
                                        handleVideoFieldChange(
                                          moduleIndex,
                                          videoIndex,
                                          'title',
                                          e.target.value
                                        )
                                      }
                                      placeholder="Ej: Clase 1 - Anatomía Aplicada"
                                      className={`${inputBaseClasses} ${inputThemeClasses}`}
                                    />
                                  </div>

                                  <div>
                                    <label
                                      htmlFor={`vid-url-${video.clientId}`}
                                      className={`block text-xs font-medium mb-1 ${
                                        isDark ? 'text-gray-300' : 'text-gray-700'
                                      }`}
                                    >
                                      URL del Video (YouTube)
                                    </label>
                                    <input
                                      id={`vid-url-${video.clientId}`}
                                      type="text"
                                      value={video.url}
                                      onChange={(e) =>
                                        handleVideoFieldChange(
                                          moduleIndex,
                                          videoIndex,
                                          'url',
                                          e.target.value
                                        )
                                      }
                                      placeholder="https://www.youtube.com/watch?v=..."
                                      className={`${inputBaseClasses} ${inputThemeClasses}`}
                                    />
                                  </div>
                                </div>

                                {videoStagedItems.length > 0 && !video.url.trim() && (
                                  <p className={`text-xs font-medium ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                                    Ingresa la URL del video arriba antes de guardar para vincular los archivos en cola a esta clase.
                                  </p>
                                )}

                                {/* PDFs, Diapositivas y URL opcional por Video */}
                                <div className={`pt-2 border-t ${isDark ? 'border-gray-700/80' : 'border-gray-100'}`}>
                                  <MaterialAttachPanel
                                    scopeTitle="Material de apoyo de esta clase"
                                    isDark={isDark}
                                    compact
                                    isUploading={uploadingMaterialKey === `vid:${video.clientId}`}
                                    savedMaterials={videoSavedMaterials}
                                    stagedItems={videoStagedItems}
                                    onFilesSelected={(files, materialType) =>
                                      handleAttachFiles(files, materialType, {
                                        scope: 'video',
                                        targetKey: `vid:${video.clientId}`,
                                        moduleClientId: module.clientId,
                                        videoClientId: video.clientId,
                                        moduleIndex: module.originalIndex ?? moduleIndex,
                                        videoUrl: video.url,
                                      })
                                    }
                                    onUpdateStagedItem={handleUpdateStagedItem}
                                    onRemoveStagedItem={handleRemoveStagedItem}
                                    onUpdateSavedMaterial={handleUpdateSavedMaterial}
                                    onDeleteSavedMaterial={handleDeleteSavedMaterial}
                                    driveUrl={video.driveLink}
                                    onDriveUrlChange={(val) =>
                                      handleVideoFieldChange(
                                        moduleIndex,
                                        videoIndex,
                                        'driveLink',
                                        val
                                      )
                                    }
                                    driveLabel="Link de Resumen Drive de esta clase (opcional)"
                                    drivePlaceholder="https://docs.google.com/... (opcional)"
                                  />
                                </div>
                              </div>
                            );
                          })
                        )}

                        <button
                          type="button"
                          onClick={() => addVideo(moduleIndex)}
                          className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors min-h-[44px] w-full sm:w-auto cursor-pointer ${
                            isDark
                              ? 'border-indigo-700/70 bg-indigo-950/30 text-indigo-300 hover:bg-indigo-950/60'
                              : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                          }`}
                        >
                          <Plus className="w-4 h-4" />
                          {module.videos.length === 0
                            ? `Añadir Video al Módulo ${moduleIndex + 1} (Opcional)`
                            : `Añadir Otro Video al Módulo ${moduleIndex + 1}`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={addModule}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 border-dashed transition-colors min-h-[44px] w-full ${
                isDark
                  ? 'border-emerald-700/70 text-emerald-400 hover:bg-emerald-950/30'
                  : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
              }`}
            >
              <Plus className="w-4 h-4" />
              Añadir Nuevo Módulo
            </button>
          </div>
        </section>
        </div>

        {/* BOTONES DE ACCIÓN */}
        <div
          className={`sticky bottom-3 z-10 p-3.5 sm:p-4 rounded-xl border shadow-lg flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 ${
            isDark
              ? 'bg-gray-800/95 border-gray-700 backdrop-blur-sm'
              : 'bg-white/95 border-gray-200 backdrop-blur-sm'
          }`}
        >
          <p className={`text-xs hidden sm:block ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {stagedCourseFiles.length > 0
              ? `${stagedCourseFiles.length} archivo(s) en cola se subirán al guardar.`
              : 'Los cambios de títulos y enlaces se guardan al confirmar.'}
          </p>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              disabled={loading}
              className={`px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors min-h-[44px] ${
                isDark
                  ? 'border-gray-600 text-gray-200 hover:bg-gray-700'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-100'
              }`}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || uploadingCover || Boolean(uploadingMaterialKey)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {courseId ? 'Actualizar Curso' : 'Crear Curso'}
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
