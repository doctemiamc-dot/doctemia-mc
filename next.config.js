// next.config.js
const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.56.1', '192.168.0.5', '192.168.0.17', 'localhost', '127.0.0.1'],
  // Configuración de Turbopack para Next.js 16+
  turbopack: {
    root: __dirname, // <-- AQUÍ ESTÁ LA MAGIA: Forzamos la raíz del proyecto
  },
  
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 's3.ppllstatics.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'fiverr-res.cloudinary.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'drive.google.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'kinsta.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'tse4.mm.bing.net', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'encrypted-tbn0.gstatic.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'encrypted-tbn1.gstatic.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'encrypted-tbn2.gstatic.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'encrypted-tbn3.gstatic.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'cdn.computerhoy.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: '*.cloudinary.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: '*.amazonaws.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: '*.googleusercontent.com', port: '', pathname: '/**' },
    ],
  },
  webpack(config) {
    // Nota: El alias @ ya está manejado por jsconfig.json en la mayoría de los casos modernos,
    // pero lo mantenemos para compatibilidad si es necesario.
    config.resolve.alias['@'] = path.resolve(__dirname, 'src');
    return config;
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json; charset=utf-8',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;