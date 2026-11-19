// src/app/layout.js
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import PwaSupport from '@/app/components/pwa/PwaSupport';

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#014ba0' },
    { media: '(prefers-color-scheme: dark)', color: '#121E34' },
  ],
};

export const metadata = {
  applicationName: 'DOCTEMIA MC',
  title: {
    default: 'DOCTEMIA MC',
    template: '%s | DOCTEMIA MC',
  },
  description: 'Plataforma médica de formación, cursos, materiales protegidos, flashcards y exámenes.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'DOCTEMIA MC',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/pwa/favicon-48x48.png', sizes: '48x48', type: 'image/png' },
      { url: '/pwa/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/pwa/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/pwa/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head />
      <body className="min-h-screen bg-white dark:bg-[#060A13] text-gray-900 dark:text-[#F1F5F9] transition-colors duration-200">
        <ThemeProvider>
          <AuthProvider>
            {children}
            <PwaSupport />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
