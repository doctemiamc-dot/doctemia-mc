export default function manifest() {
  return {
    id: '/app',
    name: 'DOCTEMIA MC',
    short_name: 'DOCTEMIA MC',
    description: 'Plataforma médica de formación, cursos, materiales protegidos, flashcards y exámenes.',
    start_url: '/app?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#FFF9F0',
    theme_color: '#014ba0',
    lang: 'es-ES',
    dir: 'ltr',
    categories: ['education', 'medical'],
    icons: [
      {
        src: '/pwa/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa/icon-maskable-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/pwa/icon-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Mis Cursos',
        short_name: 'Cursos',
        description: 'Acceder directamente a tus cursos de Doctemia MC',
        url: '/app/pagoUnicoCourses',
        icons: [
          {
            src: '/pwa/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
        ],
      },
      {
        name: 'Materiales de Estudio',
        short_name: 'Materiales',
        description: 'Abrir PDFs y diapositivas por curso',
        url: '/app/materiales',
        icons: [
          {
            src: '/pwa/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
        ],
      },
      {
        name: 'Exámenes',
        short_name: 'Exámenes',
        description: 'Practicar en el banco de preguntas',
        url: '/app/examen-test',
        icons: [
          {
            src: '/pwa/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
        ],
      },
    ],
  };
}
