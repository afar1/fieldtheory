/**
 * CachedImage Component - Renders an image using the shared cache.
 * Uses lazy state initialization to show cached images instantly.
 */

import { useState, useEffect } from 'react';
import { getCachedImageUrl, getCachedImageUrlSync } from '../utils/imageCache';

interface CachedImageProps {
  imageUrl: string | null;
  itemId: string;
  alt: string;
  style?: React.CSSProperties;
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
}

export default function CachedImage({
  imageUrl,
  itemId,
  alt,
  style,
  onError,
}: CachedImageProps) {
  // Lazy initialization: check cache synchronously on first render.
  const [src, setSrc] = useState<string>(() =>
    getCachedImageUrlSync(imageUrl, itemId)
  );

  // Only fetch async if we didn't have a cached value.
  useEffect(() => {
    if (src) return; // Already have cached image.

    let cancelled = false;
    getCachedImageUrl(imageUrl, itemId).then(url => {
      if (!cancelled && url) {
        setSrc(url);
      }
    });

    return () => { cancelled = true; };
  }, [imageUrl, itemId, src]);

  if (!src) {
    // Could show a placeholder here if needed.
    return null;
  }

  return (
    <img
      src={src}
      alt={alt}
      style={style}
      onError={onError}
    />
  );
}
