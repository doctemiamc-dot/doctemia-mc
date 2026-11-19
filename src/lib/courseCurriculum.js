import { matchesVideoUrl } from '@/lib/youtubeUtils';

/**
 * Cuenta únicamente los videos que tienen una URL válida definida dentro de los módulos de un curso.
 * @param {object|null} course
 * @returns {number}
 */
export function countValidCourseVideos(course) {
  const mods = Array.isArray(course?.modules) ? course.modules : [];
  return mods.reduce((acc, mod) => {
    const vids = Array.isArray(mod?.videos) ? mod.videos : [];
    return acc + vids.filter((v) => Boolean(v?.url && String(v.url).trim())).length;
  }, 0);
}

/**
 * Construye la estructura unificada del currículo de un curso combinando módulos,
 * videos de YouTube y documentos (PDFs, diapositivas, resúmenes y enlaces Drive legacy).
 * Si se eliminan videos de un curso, los materiales previamente vinculados a esos videos
 * se reubican automáticamente como documentos del módulo o recursos generales para que sigan visibles.
 *
 * @param {object|null} courseDetails
 * @param {Array<object>} courseMaterials
 */
export function buildCourseCurriculum(courseDetails, courseMaterials = []) {
  const modules = Array.isArray(courseDetails?.modules) ? courseDetails.modules : [];
  const activeVideoEntries = [];

  modules.forEach((mod, modIdx) => {
    const vids = Array.isArray(mod?.videos) ? mod.videos : [];
    vids.forEach((v, vIdx) => {
      if (v?.url && String(v.url).trim()) {
        activeVideoEntries.push({ modIdx, vIdx, video: v });
      }
    });
  });

  const matchesAnyActiveVideo = (videoUrl) => {
    if (!videoUrl) return false;
    return activeVideoEntries.some((entry) => matchesVideoUrl(videoUrl, entry.video.url));
  };

  const moduleSections = modules.map((mod, modIdx) => {
    const moduleTitle = (mod?.title || '').trim() || `Módulo ${modIdx + 1}`;
    const vids = Array.isArray(mod?.videos) ? mod.videos : [];

    const videos = [];
    const docLessons = [];

    vids.forEach((v, vIdx) => {
      if (v?.url && String(v.url).trim()) {
        const attachments = courseMaterials.filter((m) =>
          matchesVideoUrl(m.video_url, v.url)
        );
        videos.push({
          kind: 'video',
          key: `vid-${modIdx}-${vIdx}`,
          moduleIdx: modIdx,
          moduleTitle,
          videoIdx: vIdx,
          video: v,
          title: (v.title || '').trim() || `Video ${vIdx + 1}`,
          attachments,
        });
      } else if (v?.driveLink && String(v.driveLink).trim()) {
        const matTitle = (v.title || '').trim() || moduleTitle;
        docLessons.push({
          kind: 'material',
          key: `drive-vid-${modIdx}-${vIdx}`,
          moduleIdx: modIdx,
          moduleTitle,
          title: matTitle,
          material: {
            id: `drive-vid-${modIdx}-${vIdx}`,
            title: matTitle,
            material_type: 'summary',
            source_type: 'google_drive_legacy',
            file_url: String(v.driveLink).trim(),
          },
        });
      }
    });

    const modSupaMaterials = courseMaterials.filter(
      (m) => m.module_index === modIdx && (!m.video_url || !matchesAnyActiveVideo(m.video_url))
    );

    modSupaMaterials.forEach((mat) => {
      docLessons.push({
        kind: 'material',
        key: `mat-${mat.id}`,
        moduleIdx: modIdx,
        moduleTitle,
        title: mat.title || 'Documento del módulo',
        material: mat,
      });
    });

    if (mod?.summaryDriveLink && String(mod.summaryDriveLink).trim()) {
      docLessons.push({
        kind: 'material',
        key: `drive-mod-${modIdx}`,
        moduleIdx: modIdx,
        moduleTitle,
        title: `Resumen: ${moduleTitle}`,
        material: {
          id: `drive-mod-${modIdx}`,
          title: `Resumen: ${moduleTitle}`,
          material_type: 'summary',
          source_type: 'google_drive_legacy',
          file_url: String(mod.summaryDriveLink).trim(),
        },
      });
    }

    return {
      moduleIdx: modIdx,
      moduleTitle,
      module: mod,
      videos,
      docLessons,
    };
  });

  const generalLessons = [];
  const generalSupaMaterials = courseMaterials.filter(
    (m) =>
      (m.module_index === null || m.module_index === undefined) &&
      (!m.video_url || !matchesAnyActiveVideo(m.video_url))
  );

  generalSupaMaterials.forEach((mat) => {
    generalLessons.push({
      kind: 'material',
      key: `mat-${mat.id}`,
      moduleIdx: null,
      moduleTitle: 'Recursos Generales del Curso',
      title: mat.title || 'Recurso del curso',
      material: mat,
    });
  });

  if (courseDetails?.summaryDriveLink && String(courseDetails.summaryDriveLink).trim()) {
    generalLessons.push({
      kind: 'material',
      key: `drive-course-${courseDetails.id || 'general'}`,
      moduleIdx: null,
      moduleTitle: 'Recursos Generales del Curso',
      title: 'Resumen General del Curso',
      material: {
        id: `drive-course-${courseDetails.id || 'general'}`,
        title: `Resumen General: ${courseDetails.title || 'Curso'}`,
        material_type: 'summary',
        source_type: 'google_drive_legacy',
        file_url: String(courseDetails.summaryDriveLink).trim(),
      },
    });
  }

  const flatCurriculum = [];
  moduleSections.forEach((sec) => {
    flatCurriculum.push(...sec.videos, ...sec.docLessons);
  });
  flatCurriculum.push(...generalLessons);

  const totalVideos = moduleSections.reduce((acc, s) => acc + s.videos.length, 0);
  const totalDocs =
    moduleSections.reduce((acc, s) => acc + s.docLessons.length, 0) + generalLessons.length;

  return {
    moduleSections,
    generalLessons,
    flatCurriculum,
    totalVideos,
    totalDocs,
  };
}
