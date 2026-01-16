/**
 * Image caching utility for Field Theory.
 *
 * Stores fetched images as blob URLs to avoid re-downloading.
 * Uses localStorage for persistence across sessions.
 */

const IMAGE_CACHE_KEY = 'fieldImageCache';
const IMAGE_CACHE_MAX_SIZE = 100; // Maximum number of images to cache.

// In-memory cache for blob URLs (faster than localStorage for rendering).
const blobUrlCache = new Map<string, string>();

// Load cache metadata from localStorage on init.
function getImageCacheMetadata(): Map<string, { timestamp: number; base64: string }> {
  try {
    const stored = localStorage.getItem(IMAGE_CACHE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return new Map(Object.entries(parsed));
    }
  } catch (e) {
    // Ignore parse errors.
  }
  return new Map();
}

// Save cache metadata to localStorage.
function saveImageCacheMetadata(cache: Map<string, { timestamp: number; base64: string }>) {
  try {
    // Limit cache size by removing oldest entries.
    const entries = Array.from(cache.entries());
    if (entries.length > IMAGE_CACHE_MAX_SIZE) {
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toKeep = entries.slice(-IMAGE_CACHE_MAX_SIZE);
      cache = new Map(toKeep);
    }
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch (e) {
    // Ignore storage errors (quota exceeded, etc.).
  }
}

/**
 * Get cached image URL or fetch and cache it.
 */
export async function getCachedImageUrl(imageUrl: string | null, itemId: string): Promise<string> {
  if (!imageUrl) {
    return '';
  }

  // Check in-memory cache first.
  if (blobUrlCache.has(itemId)) {
    return blobUrlCache.get(itemId)!;
  }

  // Check localStorage cache.
  const metadata = getImageCacheMetadata();
  const cached = metadata.get(itemId);
  if (cached?.base64) {
    // Convert base64 to blob URL and store in memory cache.
    const blobUrl = `data:image/png;base64,${cached.base64}`;
    blobUrlCache.set(itemId, blobUrl);
    return blobUrl;
  }

  // Fetch from URL and cache.
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error('Failed to fetch image');

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    blobUrlCache.set(itemId, blobUrl);

    // Also store as base64 in localStorage for persistence.
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      if (base64) {
        metadata.set(itemId, { timestamp: Date.now(), base64 });
        saveImageCacheMetadata(metadata);
      }
    };
    reader.readAsDataURL(blob);

    return blobUrl;
  } catch (e) {
    // Fall back to original URL on error.
    console.warn('[ImageCache] Fetch failed:', e);
    return imageUrl;
  }
}

/**
 * Get cached image URL synchronously (for initial state).
 * Returns cached URL if available, empty string if needs async fetch.
 */
export function getCachedImageUrlSync(imageUrl: string | null, itemId: string): string {
  if (!imageUrl) {
    return '';
  }

  // Check in-memory cache (fast).
  if (blobUrlCache.has(itemId)) {
    return blobUrlCache.get(itemId)!;
  }

  // Check localStorage cache (medium - sync but involves parsing).
  const metadata = getImageCacheMetadata();
  const cached = metadata.get(itemId);
  if (cached?.base64) {
    const blobUrl = `data:image/png;base64,${cached.base64}`;
    blobUrlCache.set(itemId, blobUrl); // Promote to memory cache.
    return blobUrl;
  }

  // Not cached - needs async fetch.
  return '';
}
