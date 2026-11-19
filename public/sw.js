// public/sw.js - Service Worker para DOCTEMIA MC
const CACHE_VERSION = 'doctemia-mc-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = '/offline';

const PRECACHE_ASSETS = [
  OFFLINE_URL,
  '/pwa/icon-192x192.png',
  '/pwa/icon-512x512.png',
  '/pwa/apple-touch-icon.png',
  '/pwa/favicon-48x48.png',
  '/icons/udemy.png',
  '/pdf.worker.min.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_ASSETS.map((asset) =>
            cache.add(new Request(asset, { cache: 'reload' }))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo interceptar GET del mismo origen
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Seguridad y tiempo real: NUNCA cachear APIs protegidas, PDFs (/api/materials/file/*), ni HMR dev
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/webpack-hmr') ||
    url.pathname === '/sw.js'
  ) {
    return;
  }

  // Navegación entre páginas: Network-First con fallback limpio a /offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cachedOffline = await cache.match(OFFLINE_URL);
        return (
          cachedOffline ||
          new Response(
            '<!doctype html><html lang="es"><meta charset="utf-8"><title>Sin conexión | DOCTEMIA MC</title><body style="font-family:sans-serif;text-align:center;padding:3rem;background:#FFF9F0;color:#1a2639"><h1>DOCTEMIA MC</h1><p>No tienes conexión a internet en este momento.</p></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          )
        );
      })
    );
    return;
  }

  // Chunks de Next.js: Network-First para no servir código antiguo cuando cambia el build/dev, con respaldo offline
  if (url.pathname.startsWith('/_next/static/')) {
    const isLocalHost =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname.startsWith('192.168.');

    if (isLocalHost) return;

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Iconos PWA y worker de PDF: Cache-First
  const isStaticAsset =
    url.pathname.startsWith('/pwa/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/pdf.worker.min.mjs';

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
