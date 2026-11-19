'use client';

/**
 * Optimized theme-aware profile emblem shown in student and admin navbars.
 * Uses pre-compressed 128x128 WebP variants (~6.7 KB each) instead of raw PNGs.
 */
export default function NavbarProfileAvatar({
  isDark = false,
  sizeClass = 'w-9 h-9',
  pixelSize = 36,
  alt = 'Ir a mi perfil',
  className = '',
}) {
  const src = isDark
    ? '/images/gallooscuro-avatar.webp'
    : '/images/galloclaro-avatar.webp';

  return (
    <img
      src={src}
      alt={alt}
      width={pixelSize}
      height={pixelSize}
      loading="eager"
      decoding="async"
      draggable={false}
      className={`${sizeClass} object-contain shrink-0 select-none transition-transform duration-200 hover:scale-105 group-hover:scale-105 ${className}`.trim()}
      style={{
        filter: isDark
          ? 'drop-shadow(0 0 8px rgba(36, 176, 186, 0.28))'
          : 'drop-shadow(0 1px 3px rgba(15, 23, 42, 0.16))',
      }}
    />
  );
}
