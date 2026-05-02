// Port of twitter-bookmarks-grid (Lucas Vocos / @afar1) to React + Field Theory theme.
// Keeps the vanilla DOM-pool masonry + imperative lightbox — battle-tested for 1000+ items.
import { useEffect, useRef } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { localAvatarUrl, localMediaUrl, localMediaUrls, localVideoUrl } from '../utils/bookmarkMedia';
import { estimateTextCardHeight } from '../utils/bookmarkCardHeight';
import { formatLongBookmarkDate, formatShortBookmarkDate } from '../utils/bookmarkDate';

const CONFIG = {
  MIN_COLS: 2,
  MAX_COLS: 6,
  // Target card width before gap — the column count flexes to keep cards at
  // least this wide so the grid doesn't feel cramped at narrower viewports.
  TARGET_COL_WIDTH: 260,
  GAP: 18,
  easingFactor: 0.1,
  POOL_SIZE: 500,
  BUFFER: 600,
};

const easeInOutQuart = (t: number) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

function animateValue(
  from: number,
  to: number,
  duration: number,
  onUpdate: (v: number) => void,
  onDone?: () => void,
  easing: (t: number) => number = easeInOutQuart
): () => void {
  let cancelled = false;
  const start = performance.now();
  const tick = (now: number) => {
    if (cancelled) return;
    const elapsed = Math.min((now - start) / duration, 1);
    onUpdate(from + (to - from) * easing(elapsed));
    if (elapsed < 1) requestAnimationFrame(tick);
    else onDone?.();
  };
  requestAnimationFrame(tick);
  return () => { cancelled = true; };
}

function applyImageGrid(gridEl: HTMLDivElement, sources: string[], alt: string): void {
  const cells = Array.from(gridEl.querySelectorAll('img')) as HTMLImageElement[];
  if (sources.length === 0) {
    gridEl.style.display = 'none';
    for (const img of cells) {
      img.removeAttribute('src');
      img.alt = '';
      img.style.display = 'none';
      img.style.gridColumn = '';
      img.style.gridRow = '';
    }
    return;
  }

  gridEl.style.display = 'grid';
  gridEl.style.gridTemplateColumns = sources.length === 1 ? '1fr' : '1fr 1fr';
  gridEl.style.gridTemplateRows = sources.length <= 2 ? '1fr' : '1fr 1fr';

  for (let i = 0; i < cells.length; i++) {
    const img = cells[i];
    const src = sources[i];
    if (!src) {
      img.removeAttribute('src');
      img.alt = '';
      img.style.display = 'none';
      img.style.gridColumn = '';
      img.style.gridRow = '';
      continue;
    }
    if (img.src !== src) img.src = src;
    img.alt = alt;
    img.style.display = 'block';
    img.style.gridColumn = sources.length === 3 && i === 0 ? '1' : '';
    img.style.gridRow = sources.length === 3 && i === 0 ? '1 / span 2' : '';
  }
}

function localVideoImage(bookmark: Bookmark): BookmarkImage | undefined {
  if (bookmark.images.length !== 1) return undefined;
  return bookmark.images.find(
    (img) => (img.type === 'video' || img.type === 'animated_gif') && !!img.localVideoFilename,
  );
}

function copyableLocalImage(bookmark: Bookmark): BookmarkImage | undefined {
  return bookmark.images.find(
    (img) => !!img.localFilename && img.type !== 'video' && img.type !== 'animated_gif',
  );
}

function resetLightboxVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.style.display = 'none';
}

function applyAvatar(img: HTMLImageElement, url: string | null): void {
  if (url) {
    if (img.src !== url) img.src = url;
    img.style.display = 'block';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
  }
}

interface HandleSource {
  authorHandle: string;
  authorName: string;
  localAvatarFilename?: string;
}

function bookmarkLinkLabel(bookmark: Bookmark): string {
  if (bookmark.sourceType === 'web') return bookmark.domain || bookmark.url;
  return bookmark.authorHandle ? `@${bookmark.authorHandle}` : (bookmark.authorName || '');
}

function bookmarkCaptionText(bookmark: Bookmark): string {
  if (bookmark.sourceType === 'web') return bookmark.excerpt || bookmark.text;
  return bookmark.text;
}

/** Populate a `.bm-text-handle` / `.bm-text-quoted-handle` div with the author's
 * avatar (when downloaded) and `@handle` text, falling back to display name. */
function setHandleContent(handleEl: HTMLDivElement, source: HandleSource): void {
  const avatarEl = handleEl.querySelector('.bm-text-avatar') as HTMLImageElement;
  const textEl = handleEl.querySelector('.bm-text-handle-text') as HTMLSpanElement;
  applyAvatar(avatarEl, localAvatarUrl(source));
  textEl.textContent = source.authorHandle ? `@${source.authorHandle}` : (source.authorName || '');
}

/** Enable vertical scroll on the inner text card only when its content
 * genuinely overflows — the estimator drifts by ~20px, so `overflow:auto`
 * applied unconditionally would show a scrollbar on cards that visually fit. */
function enableScrollIfOverflowing(cloneText: HTMLDivElement): void {
  cloneText.style.overflowY = '';
  cloneText.scrollTop = 0;
  if (cloneText.scrollHeight > cloneText.clientHeight + 1) {
    cloneText.style.overflowY = 'auto';
  }
}

type LayoutItem = {
  key: string;
  bookmark: Bookmark;
  x: number;
  y: number;
  w: number;
  h: number;
};

type ActiveEntry = {
  poolEl: HTMLDivElement;
  layoutItem: LayoutItem;
  screenX: number;
  screenY: number;
};

type LightboxState = {
  clone: HTMLDivElement;
  bookmark: Bookmark;
  sourceEl: HTMLDivElement;
  endX: number;
  endY: number;
  endW: number;
  endH: number;
};

// Imperative controller held in a ref so React prop changes can update the
// running canvas without tearing down the DOM pool + event listeners.
type Controller = {
  setBookmarks: (bookmarks: Bookmark[]) => void;
  destroy: () => void;
};

export default function BookmarksCanvas({ bookmarks }: { bookmarks: Bookmark[] }) {
  const { theme } = useTheme();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const infoRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const dateRef = useRef<HTMLDivElement | null>(null);
  const lightboxAvatarRef = useRef<HTMLImageElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const copyBtnRef = useRef<HTMLButtonElement | null>(null);
  const openBtnRef = useRef<HTMLButtonElement | null>(null);
  const agentCopyBtnRef = useRef<HTMLButtonElement | null>(null);
  const controllerRef = useRef<Controller | null>(null);

  // Mount-only setup. Creates the pool, binds listeners, starts the animation loop.
  useEffect(() => {
    const viewport = viewportRef.current;
    const grid = gridRef.current;
    const overlay = overlayRef.current;
    const info = infoRef.current;
    const titleEl = titleRef.current;
    const linkEl = linkRef.current;
    const dateEl = dateRef.current;
    const lightboxAvatarEl = lightboxAvatarRef.current;
    const closeBtn = closeBtnRef.current;
    const copyBtn = copyBtnRef.current;
    const openBtn = openBtnRef.current;
    const agentCopyBtn = agentCopyBtnRef.current;
    if (!viewport || !grid || !overlay || !info || !titleEl || !linkEl || !dateEl || !lightboxAvatarEl || !closeBtn || !copyBtn || !openBtn || !agentCopyBtn) return;

    const openExternalUrl = (url: string) => {
      // Always route through shell.openExternal so URLs open in the user's
      // default browser instead of an Electron BrowserWindow.
      void window.shellAPI?.openExternal(url);
    };

    const state = {
      cameraOffset: { x: 0, y: 0 },
      targetOffset: { x: 0, y: 0 },
      isDragging: false,
      previousMousePosition: { x: 0, y: 0 },
      dragStartPosition: { x: 0, y: 0 },
      hasDragged: false,
      touchStart: null as { x: number; y: number } | null,
      lightbox: null as LightboxState | null,
      lightboxAnimating: false,
    };

    let current: Bookmark[] = [];
    let layoutItems: LayoutItem[] = [];
    let colWidth = 0;
    let totalWidth = 0;
    let maxColHeight = 0;
    let cols = CONFIG.MIN_COLS;

    // Short-circuit key for buildLayout — if neither colWidth/cols nor the
    // bookmarks array identity changed since last build, the existing
    // layoutItems are still correct. Avoids re-running 7k measurements on
    // every resize tick and on StrictMode double-mount.
    let lastBuildColWidth = 0;
    let lastBuildCols = 0;
    let lastBuildCurrent: Bookmark[] | null = null;

    const clampOffset = (offset: { x: number; y: number }) => {
      const maxX = Math.max(0, totalWidth - viewport.clientWidth);
      const maxY = Math.max(0, maxColHeight - viewport.clientHeight);
      offset.x = Math.min(maxX, Math.max(0, offset.x));
      offset.y = Math.min(maxY, Math.max(0, offset.y));
    };

    const clampCamera = () => {
      clampOffset(state.cameraOffset);
      clampOffset(state.targetOffset);
    };

    const buildLayout = () => {
      const vw = viewport.clientWidth;
      if (vw === 0) return; // canvas is hidden; don't waste a layout pass.
      const gap = CONFIG.GAP;
      const newCols = Math.max(
        CONFIG.MIN_COLS,
        Math.min(CONFIG.MAX_COLS, Math.floor((vw - gap) / CONFIG.TARGET_COL_WIDTH)),
      );
      const newColWidth = Math.max(1, Math.floor((vw - gap) / newCols));
      if (
        newColWidth === lastBuildColWidth &&
        newCols === lastBuildCols &&
        current === lastBuildCurrent &&
        layoutItems.length > 0
      ) {
        return;
      }
      lastBuildColWidth = newColWidth;
      lastBuildCols = newCols;
      lastBuildCurrent = current;
      colWidth = newColWidth;
      cols = newCols;
      totalWidth = colWidth * cols;

      const colHeights = new Array(cols).fill(0);
      const columns: LayoutItem[][] = Array.from({ length: cols }, () => []);
      const itemW = colWidth - gap;

      for (const bm of current) {
        let minCol = 0;
        for (let c = 1; c < cols; c++) {
          if (colHeights[c] < colHeights[minCol]) minCol = c;
        }
        let itemH: number;
        // Only treat as an image card when we have the file locally. Image
        // bookmarks without a local file render as text-style — the viewer
        // makes zero network calls, so remote-only media would just be empty.
        const localImages = bm.images?.filter((img) => !!img.localFilename) ?? [];
        const primaryImage = localImages[0];
        if (localImages.length > 0) {
          const aspect = (primaryImage.width || 1) / (primaryImage.height || 1);
          itemH = localImages.length === 1 ? itemW / aspect : itemW;
        } else {
          itemH = estimateTextCardHeight(bm, itemW);
        }
        const x = minCol * colWidth + gap / 2;
        const y = colHeights[minCol] + gap / 2;
        columns[minCol].push({ key: '', bookmark: bm, x, y, w: itemW, h: itemH });
        colHeights[minCol] += itemH + gap;
      }

      maxColHeight = Math.max(1, ...colHeights);

      layoutItems = [];
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < columns[col].length; row++) {
          const item = columns[col][row];
          item.key = `${col}-${row}`;
          layoutItems.push(item);
        }
      }
    };

    // DOM pool
    const pool: HTMLDivElement[] = [];
    const freePool: HTMLDivElement[] = [];
    const activeMap = new Map<string, ActiveEntry>();
    const elToBookmark = new WeakMap<HTMLDivElement, Bookmark>();

    // Text-card colors come from CSS custom properties on the viewport, so
    // theme toggles propagate to existing pool elements without a rebuild.
    const createPool = () => {
      grid.innerHTML = '';
      pool.length = 0;
      freePool.length = 0;
      activeMap.clear();
      for (let i = 0; i < CONFIG.POOL_SIZE; i++) {
        const el = document.createElement('div');
        el.className = 'bm-grid-item';
        el.style.cssText = 'position:absolute;overflow:hidden;will-change:transform;user-select:none;backface-visibility:hidden;border-radius:24px;display:none;';
        const imageGrid = document.createElement('div');
        imageGrid.className = 'bm-image-grid';
        imageGrid.style.cssText = 'position:absolute;inset:0;display:none;gap:4px;padding:0;box-sizing:border-box;pointer-events:none;';
        for (let j = 0; j < 4; j++) {
          const img = document.createElement('img');
          img.alt = '';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:none;pointer-events:none;border-radius:24px;transition:filter 0.3s ease;';
          imageGrid.appendChild(img);
        }
        el.appendChild(imageGrid);

        const textEl = document.createElement('div');
        textEl.className = 'bm-text-card';
        const handleEl = document.createElement('div');
        handleEl.className = 'bm-text-handle';
        const handleAvatar = document.createElement('img');
        handleAvatar.className = 'bm-text-avatar';
        handleAvatar.alt = '';
        handleAvatar.loading = 'lazy';
        handleAvatar.decoding = 'async';
        handleAvatar.style.display = 'none';
        const handleText = document.createElement('span');
        handleText.className = 'bm-text-handle-text';
        handleEl.appendChild(handleAvatar);
        handleEl.appendChild(handleText);
        const bodyEl = document.createElement('div');
        bodyEl.className = 'bm-text-body';
        const quotedEl = document.createElement('div');
        quotedEl.className = 'bm-text-quoted';
        const quotedHandle = document.createElement('div');
        quotedHandle.className = 'bm-text-quoted-handle';
        const quotedAvatar = document.createElement('img');
        quotedAvatar.className = 'bm-text-avatar';
        quotedAvatar.alt = '';
        quotedAvatar.loading = 'lazy';
        quotedAvatar.decoding = 'async';
        quotedAvatar.style.display = 'none';
        const quotedHandleText = document.createElement('span');
        quotedHandleText.className = 'bm-text-handle-text';
        quotedHandle.appendChild(quotedAvatar);
        quotedHandle.appendChild(quotedHandleText);
        const quotedBody = document.createElement('div');
        quotedBody.className = 'bm-text-quoted-body';
        quotedEl.appendChild(quotedHandle);
        quotedEl.appendChild(quotedBody);
        const textDateEl = document.createElement('div');
        textDateEl.className = 'bm-text-date';
        textEl.appendChild(handleEl);
        textEl.appendChild(bodyEl);
        textEl.appendChild(quotedEl);
        textEl.appendChild(textDateEl);
        el.appendChild(textEl);

        const dateBadgeEl = document.createElement('div');
        dateBadgeEl.className = 'bm-date-badge';
        el.appendChild(dateBadgeEl);

        grid.appendChild(el);
        pool.push(el);
        freePool.push(el);
      }
    };

    const acquireEl = (): HTMLDivElement | null => {
      const el = freePool.pop();
      if (!el) return null;
      el.style.display = '';
      return el;
    };

    const releaseEl = (el: HTMLDivElement) => {
      el.style.display = 'none';
      el.style.visibility = '';
      freePool.push(el);
    };

    const clearActive = () => {
      let preservedLightboxEntry: [string, ActiveEntry] | null = null;
      for (const [key, entry] of activeMap) {
        if (entry.poolEl === state.lightbox?.sourceEl) {
          preservedLightboxEntry = [key, entry];
        } else {
          releaseEl(entry.poolEl);
          elToBookmark.delete(entry.poolEl);
        }
      }
      activeMap.clear();
      if (preservedLightboxEntry) activeMap.set(preservedLightboxEntry[0], preservedLightboxEntry[1]);
    };

    const renderVisible = () => {
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      const buf = CONFIG.BUFFER;
      const lightboxEl = state.lightbox?.sourceEl ?? null;
      clampCamera();

      const camX = state.cameraOffset.x;
      const camY = state.cameraOffset.y;

      const visibleThisFrame = new Set<string>();

      for (let i = 0; i < layoutItems.length; i++) {
        const item = layoutItems[i];
        const sx = item.x - camX;
        const sy = item.y - camY;
        const txs = item.x - state.targetOffset.x;
        const tys = item.y - state.targetOffset.y;

        const visibleAtCam =
          sx + item.w >= -buf && sx <= vw + buf &&
          sy + item.h >= -buf && sy <= vh + buf;
        const visibleAtTarget =
          txs + item.w >= -buf && txs <= vw + buf &&
          tys + item.h >= -buf && tys <= vh + buf;
        if (!visibleAtCam && !visibleAtTarget) continue;

        const visKey = item.key;
        visibleThisFrame.add(visKey);

        const existing = activeMap.get(visKey);
        if (existing) {
          if (existing.poolEl !== lightboxEl) {
            existing.poolEl.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
          }
          existing.screenX = sx;
          existing.screenY = sy;
        } else {
          const el = acquireEl();
          if (!el) continue;
          const imageGrid = el.querySelector('.bm-image-grid') as HTMLDivElement;
          const textEl = el.querySelector('.bm-text-card') as HTMLDivElement;
          const localSources = localMediaUrls(item.bookmark.images).slice(0, 4);
          const hasImage = localSources.length > 0;
          const shortDate = formatShortBookmarkDate(item.bookmark.postedAt);
          const dateBadgeEl = el.querySelector('.bm-date-badge') as HTMLDivElement;
          if (hasImage) {
            applyImageGrid(imageGrid, localSources, bookmarkCaptionText(item.bookmark).substring(0, 60));
            textEl.style.display = 'none';
            dateBadgeEl.textContent = shortDate;
            dateBadgeEl.style.display = shortDate ? 'block' : 'none';
          } else {
            applyImageGrid(imageGrid, [], '');
            const handleEl = textEl.querySelector('.bm-text-handle') as HTMLDivElement;
            const bodyEl = textEl.querySelector('.bm-text-body') as HTMLDivElement;
            const quotedEl = textEl.querySelector('.bm-text-quoted') as HTMLDivElement;
            const textDateEl = textEl.querySelector('.bm-text-date') as HTMLDivElement;
            setHandleContent(handleEl, item.bookmark);
            bodyEl.textContent = item.bookmark.text;
            bodyEl.style.display = item.bookmark.text ? 'block' : 'none';
            if (item.bookmark.quotedTweet) {
              const qHandle = quotedEl.querySelector('.bm-text-quoted-handle') as HTMLDivElement;
              const qBody = quotedEl.querySelector('.bm-text-quoted-body') as HTMLDivElement;
              setHandleContent(qHandle, item.bookmark.quotedTweet);
              qBody.textContent = item.bookmark.quotedTweet.text;
              quotedEl.style.display = 'flex';
            } else {
              quotedEl.style.display = 'none';
            }
            textDateEl.textContent = shortDate;
            textDateEl.style.display = shortDate ? 'block' : 'none';
            textEl.style.display = 'flex';
            dateBadgeEl.style.display = 'none';
          }
          el.style.width = `${item.w}px`;
          el.style.height = `${item.h}px`;
          el.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
          elToBookmark.set(el, item.bookmark);
          activeMap.set(visKey, { poolEl: el, layoutItem: item, screenX: sx, screenY: sy });
        }
      }

      for (const [visKey, entry] of activeMap) {
        if (!visibleThisFrame.has(visKey) && entry.poolEl !== lightboxEl) {
          releaseEl(entry.poolEl);
          elToBookmark.delete(entry.poolEl);
          activeMap.delete(visKey);
        }
      }
    };

    // --- Lightbox ---
    const DRAG_THRESHOLD = 5;

    const openLightbox = (el: HTMLDivElement, bookmark: Bookmark) => {
      if (state.lightbox || state.lightboxAnimating) return;
      state.lightboxAnimating = true;

      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const maxW = vw * 0.7;
      const maxH = vh * 0.7;
      const hasImage = localMediaUrls(bookmark.images).length > 0;
      const hasCopyableImage = !!copyableLocalImage(bookmark);
      const shortDate = formatShortBookmarkDate(bookmark.postedAt);
      const longDate = formatLongBookmarkDate(bookmark.postedAt);
      let targetW: number;
      let targetH: number;
      if (hasImage) {
        // Image bookmarks keep their intrinsic aspect ratio when zoomed.
        const aspectRatio = rect.width / rect.height;
        if (maxW / maxH > aspectRatio) {
          targetH = maxH; targetW = targetH * aspectRatio;
        } else {
          targetW = maxW; targetH = targetW / aspectRatio;
        }
      } else {
        // Text-only cards reflow when scaled, so aspect ratio is meaningless —
        // measure actual content at a readable width and clamp to [min, maxH].
        const MIN_TEXT_H = 160;
        targetW = Math.min(maxW, 560);
        const measured = estimateTextCardHeight(bookmark, targetW);
        targetH = Math.min(maxH, Math.max(MIN_TEXT_H, measured));
      }

      const startX = rect.left;
      const startY = rect.top;
      const startW = rect.width;
      const startH = rect.height;
      const endX = (vw - targetW) / 2;
      const endY = (vh - targetH) / 2;

      el.style.visibility = 'hidden';

      const clone = el.cloneNode(true) as HTMLDivElement;
      clone.style.position = 'fixed';
      clone.style.top = '0';
      clone.style.left = '0';
      clone.style.zIndex = '101';
      clone.style.pointerEvents = 'none';
      clone.style.willChange = 'transform, width, height';
      clone.style.width = `${startW}px`;
      clone.style.height = `${startH}px`;
      clone.style.display = '';
      clone.style.visibility = 'visible';
      clone.style.transform = `translate3d(${startX}px, ${startY}px, 0)`;
      // The clone lives under document.body, outside the viewport that owns the
      // --bm-card-* CSS vars. Copy them over so the text-card background shows.
      for (const v of ['--bm-card-bg', '--bm-card-border', '--bm-card-text', '--bm-card-secondary', '--bm-card-quoted-bg']) {
        const val = viewport.style.getPropertyValue(v);
        if (val) clone.style.setProperty(v, val);
      }
      const cloneDateBadge = clone.querySelector('.bm-date-badge') as HTMLDivElement | null;
      const cloneTextDate = clone.querySelector('.bm-text-date') as HTMLDivElement | null;
      if (cloneDateBadge) {
        cloneDateBadge.textContent = shortDate;
        cloneDateBadge.style.display = hasImage && shortDate ? 'block' : 'none';
      }
      if (cloneTextDate) {
        cloneTextDate.textContent = shortDate;
        cloneTextDate.style.display = !hasImage && shortDate ? 'block' : 'none';
      }
      const cloneVideo = document.createElement('video');
      cloneVideo.className = 'bm-lightbox-video';
      cloneVideo.controls = true;
      cloneVideo.preload = 'metadata';
      cloneVideo.playsInline = true;
      cloneVideo.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none;background:#000;border-radius:24px;';
      clone.appendChild(cloneVideo);

      document.body.appendChild(clone);
      overlay.style.opacity = '1';
      overlay.style.pointerEvents = 'auto';

      const videoImage = localVideoImage(bookmark);
      const videoSrc = localVideoUrl(videoImage);
      const hasPlayableVideo = !!videoSrc;
      // For images, show a truncated preview of the caption in the info
      // block below the media. For text-only the card already contains the
      // full text — don't duplicate it in the info block.
      titleEl.textContent = hasImage
        ? (bookmarkCaptionText(bookmark).length > 140 ? bookmarkCaptionText(bookmark).substring(0, 140) + '…' : bookmarkCaptionText(bookmark))
        : '';
      linkEl.textContent = bookmarkLinkLabel(bookmark);
      linkEl.href = bookmark.url;
      dateEl.textContent = longDate;
      dateEl.style.display = longDate ? 'block' : 'none';
      applyAvatar(lightboxAvatarEl, localAvatarUrl(bookmark));
      info.style.top = `${endY + targetH + 20}px`;
      info.style.opacity = '1';
      copyBtn.style.display = hasCopyableImage ? 'flex' : 'none';
      delete agentCopyBtn.dataset.copied;

      state.lightbox = { clone, bookmark, sourceEl: el, endX, endY, endW: targetW, endH: targetH };

      const dx = endX - startX;
      const dy = endY - startY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const duration = 450 + Math.min(distance / 4, 250);
      animateValue(0, 1, duration, (t) => {
        const w = startW + (targetW - startW) * t;
        const h = startH + (targetH - startH) * t;
        const x = startX + (endX - startX) * t;
        const y = startY + (endY - startY) * t;
        clone.style.width = `${w}px`;
        clone.style.height = `${h}px`;
        clone.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }, () => {
        state.lightboxAnimating = false;
        const cloneGrid = clone.querySelector('.bm-image-grid') as HTMLDivElement;
        const cloneVideoEl = clone.querySelector('.bm-lightbox-video') as HTMLVideoElement;
        if (hasPlayableVideo) {
          applyImageGrid(cloneGrid, [], '');
          cloneVideoEl.poster = localMediaUrl(videoImage) ?? '';
          cloneVideoEl.src = videoSrc!;
          cloneVideoEl.style.display = 'block';
          clone.style.pointerEvents = 'auto';
          return;
        }
        // Scroll lives on the inner .bm-text-card (outer clone just sizes; inner
        // card is position:absolute; inset:0 and clips its own overflow).
        if (!hasImage) {
          const cloneText = clone.querySelector('.bm-text-card') as HTMLDivElement | null;
          if (cloneText) enableScrollIfOverflowing(cloneText);
          clone.style.pointerEvents = 'auto';
        }
      });
    };

    const closeLightbox = () => {
      if (!state.lightbox || state.lightboxAnimating) return;
      const lb = state.lightbox;
      state.lightboxAnimating = true;

      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      info.style.opacity = '0';

      const rect = lb.sourceEl.getBoundingClientRect();
      const endX = rect.left;
      const endY = rect.top;
      const endW = rect.width;
      const endH = rect.height;
      const { endX: fromX, endY: fromY, endW: fromW, endH: fromH } = lb;

      animateValue(0, 1, 350, (t) => {
        const w = fromW + (endW - fromW) * t;
        const h = fromH + (endH - fromH) * t;
        const x = fromX + (endX - fromX) * t;
        const y = fromY + (endY - fromY) * t;
        lb.clone.style.width = `${w}px`;
        lb.clone.style.height = `${h}px`;
        lb.clone.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }, () => {
        const video = lb.clone.querySelector('.bm-lightbox-video') as HTMLVideoElement | null;
        if (video) resetLightboxVideo(video);
        lb.clone.remove();
        const sourceStillTracked = Array.from(activeMap.values()).some((entry) => entry.poolEl === lb.sourceEl);
        lb.sourceEl.style.visibility = '';
        state.lightbox = null;
        state.lightboxAnimating = false;
        if (!sourceStillTracked) {
          releaseEl(lb.sourceEl);
          elToBookmark.delete(lb.sourceEl);
        }
        renderVisible();
      });
    };

    // --- Input handlers ---
    const onMouseDown = (e: MouseEvent) => {
      if (state.lightbox) return;
      state.isDragging = true;
      state.hasDragged = false;
      state.dragStartPosition = { x: e.clientX, y: e.clientY };
      state.previousMousePosition = { x: e.clientX, y: e.clientY };
      viewport.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!state.isDragging) return;
      const totalDx = e.clientX - state.dragStartPosition.x;
      const totalDy = e.clientY - state.dragStartPosition.y;
      if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) > DRAG_THRESHOLD) {
        state.hasDragged = true;
      }
      const dx = e.clientX - state.previousMousePosition.x;
      const dy = e.clientY - state.previousMousePosition.y;
      state.targetOffset.x -= dx;
      state.targetOffset.y -= dy;
      clampOffset(state.targetOffset);
      state.previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = (e: MouseEvent) => {
      const wasDragging = state.isDragging;
      state.isDragging = false;
      viewport.style.cursor = 'grab';
      if (wasDragging && !state.hasDragged && !state.lightbox) {
        const target = (e.target as HTMLElement | null)?.closest('.bm-grid-item');
        if (target && elToBookmark.has(target as HTMLDivElement)) {
          const bm = elToBookmark.get(target as HTMLDivElement)!;
          openLightbox(target as HTMLDivElement, bm);
        }
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        state.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && state.touchStart) {
        e.preventDefault();
        const dx = e.touches[0].clientX - state.touchStart.x;
        const dy = e.touches[0].clientY - state.touchStart.y;
        state.targetOffset.x -= dx;
        state.targetOffset.y -= dy;
        clampOffset(state.targetOffset);
        state.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const onTouchEnd = () => { state.touchStart = null; };

    const onWheel = (e: WheelEvent) => {
      if (state.lightbox) return;
      e.preventDefault();
      state.targetOffset.x += e.deltaX;
      state.targetOffset.y += e.deltaY;
      clampOffset(state.targetOffset);
    };

    const onResize = () => {
      if (viewport.clientWidth === 0) return;
      buildLayout();
      clearActive();
      renderVisible();
    };

    // Swap the open lightbox's content to the prev/next bookmark in place.
    // No close/reopen animation — feels instant during rapid arrow-browsing.
    const navigateLightbox = (direction: number) => {
      if (!state.lightbox || state.lightboxAnimating) return;
      if (layoutItems.length === 0) return;
      const currentId = state.lightbox.bookmark.id;
      const currentIdx = layoutItems.findIndex((l) => l.bookmark.id === currentId);
      if (currentIdx === -1) return;
      const nextIdx = (currentIdx + direction + layoutItems.length) % layoutItems.length;
      if (nextIdx === currentIdx) return;
      const nextItem = layoutItems[nextIdx];
      const nextBm = nextItem.bookmark;

      // Center camera on next item so the pool guarantees an element for it.
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      state.cameraOffset.x = nextItem.x + nextItem.w / 2 - vw / 2;
      state.cameraOffset.y = nextItem.y + nextItem.h / 2 - vh / 2;
      state.targetOffset.x = state.cameraOffset.x;
      state.targetOffset.y = state.cameraOffset.y;
      clampCamera();

      // Restore old source visibility, render so new source has a pool element.
      state.lightbox.sourceEl.style.visibility = '';
      renderVisible();

      let nextEl: HTMLDivElement | null = null;
      for (const entry of activeMap.values()) {
        if (entry.layoutItem.bookmark.id === nextBm.id) {
          nextEl = entry.poolEl;
          break;
        }
      }
      if (!nextEl) return;

      // Drop any hi-res overlays from the previous bookmark.
      const clone = state.lightbox.clone;
      const cloneGrid = clone.querySelector('.bm-image-grid') as HTMLDivElement;
      const cloneVideo = clone.querySelector('.bm-lightbox-video') as HTMLVideoElement;
      const cloneText = clone.querySelector('.bm-text-card') as HTMLDivElement;
      const cloneDateBadge = clone.querySelector('.bm-date-badge') as HTMLDivElement | null;
      const cloneTextDate = clone.querySelector('.bm-text-date') as HTMLDivElement | null;
      const localSources = localMediaUrls(nextBm.images).slice(0, 4);
      const hasImage = localSources.length > 0;
      const videoImage = localVideoImage(nextBm);
      const videoSrc = localVideoUrl(videoImage);
      const hasPlayableVideo = !!videoSrc;
      const hasCopyableImage = !!copyableLocalImage(nextBm);
      const shortDate = formatShortBookmarkDate(nextBm.postedAt);
      const longDate = formatLongBookmarkDate(nextBm.postedAt);
      if (hasPlayableVideo) {
        applyImageGrid(cloneGrid, [], '');
        cloneText.style.display = 'none';
        cloneVideo.poster = localMediaUrl(videoImage) ?? '';
        cloneVideo.src = videoSrc!;
        cloneVideo.style.display = 'block';
      } else if (hasImage) {
        applyImageGrid(cloneGrid, localSources, bookmarkCaptionText(nextBm).substring(0, 60));
        cloneText.style.display = 'none';
        resetLightboxVideo(cloneVideo);
      } else {
        applyImageGrid(cloneGrid, [], '');
        cloneText.style.display = 'flex';
        resetLightboxVideo(cloneVideo);
        const handleEl = cloneText.querySelector('.bm-text-handle') as HTMLDivElement;
        const bodyEl = cloneText.querySelector('.bm-text-body') as HTMLDivElement;
        const quotedEl = cloneText.querySelector('.bm-text-quoted') as HTMLDivElement;
        setHandleContent(handleEl, nextBm);
        bodyEl.textContent = nextBm.text;
        bodyEl.style.display = nextBm.text ? 'block' : 'none';
        if (nextBm.quotedTweet) {
          const qHandle = quotedEl.querySelector('.bm-text-quoted-handle') as HTMLDivElement;
          const qBody = quotedEl.querySelector('.bm-text-quoted-body') as HTMLDivElement;
          setHandleContent(qHandle, nextBm.quotedTweet);
          qBody.textContent = nextBm.quotedTweet.text;
          quotedEl.style.display = 'flex';
        } else {
          quotedEl.style.display = 'none';
        }
      }

      titleEl.textContent = hasImage
        ? (bookmarkCaptionText(nextBm).length > 140 ? bookmarkCaptionText(nextBm).substring(0, 140) + '…' : bookmarkCaptionText(nextBm))
        : '';
      linkEl.textContent = bookmarkLinkLabel(nextBm);
      linkEl.href = nextBm.url;
      dateEl.textContent = longDate;
      dateEl.style.display = longDate ? 'block' : 'none';
      if (cloneDateBadge) {
        cloneDateBadge.textContent = shortDate;
        cloneDateBadge.style.display = (hasImage || hasPlayableVideo) && shortDate ? 'block' : 'none';
      }
      if (cloneTextDate) {
        cloneTextDate.textContent = shortDate;
        cloneTextDate.style.display = !hasImage && !hasPlayableVideo && shortDate ? 'block' : 'none';
      }
      applyAvatar(lightboxAvatarEl, localAvatarUrl(nextBm));
      copyBtn.style.display = hasCopyableImage ? 'flex' : 'none';
      delete agentCopyBtn.dataset.copied;

      // Text cards scroll on the inner .bm-text-card (see openLightbox); images
      // fall back to the default non-interactive clone.
      if (!hasImage && !hasPlayableVideo) {
        enableScrollIfOverflowing(cloneText);
      } else {
        cloneText.style.overflowY = '';
        cloneText.scrollTop = 0;
      }
      clone.style.pointerEvents = hasPlayableVideo || !hasImage ? 'auto' : 'none';

      nextEl.style.visibility = 'hidden';
      state.lightbox.sourceEl = nextEl;
      state.lightbox.bookmark = nextBm;
      renderVisible();
    };

    const onKey = (e: KeyboardEvent) => {
      if (!state.lightbox) return;
      if (e.key === 'Escape') {
        closeLightbox();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        navigateLightbox(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        navigateLightbox(1);
      }
    };

    const onOverlayClick = (e: MouseEvent) => {
      if (e.target === overlay) closeLightbox();
    };

    const onCloseClick = (e: MouseEvent) => { e.stopPropagation(); closeLightbox(); };

    const onCopyClick = async (e: MouseEvent) => {
      e.stopPropagation();
      const bm = state.lightbox?.bookmark;
      if (!bm) return;
      const img = copyableLocalImage(bm);
      if (!img) return;
      const src = localMediaUrl(img);
      if (!src) return;
      try {
        const resp = await fetch(src);
        const blob = await resp.blob();
        const image = new Image();
        image.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('image load failed'));
          image.src = URL.createObjectURL(blob);
        });
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d')?.drawImage(image, 0, 0);
        URL.revokeObjectURL(image.src);
        const pngBlob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        copyBtn.dataset.copied = '1';
        setTimeout(() => { delete copyBtn.dataset.copied; }, 1200);
      } catch (err) {
        console.error('[BookmarksCanvas] copy image failed', err);
      }
    };

    const onAgentCopyClick = async (e: MouseEvent) => {
      e.stopPropagation();
      const bm = state.lightbox?.bookmark;
      if (!bm) return;
      try {
        const result = await window.bookmarksAPI?.copyForAgent(bm.id);
        if (!result?.success) throw new Error(result?.error ?? 'Copy failed');
        agentCopyBtn.dataset.copied = '1';
        setTimeout(() => { delete agentCopyBtn.dataset.copied; }, 1200);
      } catch (err) {
        console.error('[BookmarksCanvas] copy for agent failed', err);
      }
    };

    let rafId: number | null = null;
    const loop = () => {
      rafId = requestAnimationFrame(loop);
      const dx = state.targetOffset.x - state.cameraOffset.x;
      const dy = state.targetOffset.y - state.cameraOffset.y;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        state.cameraOffset.x += dx * CONFIG.easingFactor;
        state.cameraOffset.y += dy * CONFIG.easingFactor;
        renderVisible();
      }
    };

    // Initial setup
    createPool();

    viewport.addEventListener('mousedown', onMouseDown);
    viewport.addEventListener('mousemove', onMouseMove);
    viewport.addEventListener('mouseup', onMouseUp);
    viewport.addEventListener('mouseleave', onMouseUp);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('touchstart', onTouchStart);
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd);
    // Capture-phase so lightbox arrow nav preempts LibrarianView's sidebar nav.
    window.addEventListener('keydown', onKey, true);
    const onOpenClick = (e: MouseEvent) => {
      e.stopPropagation();
      const url = state.lightbox?.bookmark.url;
      if (url) openExternalUrl(url);
    };
    const onLinkClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const url = state.lightbox?.bookmark.url;
      if (url) openExternalUrl(url);
    };

    overlay.addEventListener('click', onOverlayClick);
    closeBtn.addEventListener('click', onCloseClick);
    copyBtn.addEventListener('click', onCopyClick);
    agentCopyBtn.addEventListener('click', onAgentCopyClick);
    openBtn.addEventListener('click', onOpenClick);
    linkEl.addEventListener('click', onLinkClick);

    // Reflow immediately on width change. buildLayout is char-count math
    // behind a per-bucket cache (~5ms cold, ~0ms warm), so we no longer need
    // a debounce — firing on every ResizeObserver tick makes canvas-become-
    // visible transitions paint in the current frame instead of 120ms later.
    let lastW = viewport.clientWidth;
    const resizeObserver = new ResizeObserver(() => {
      if (viewport.clientWidth === lastW) return;
      lastW = viewport.clientWidth;
      onResize();
    });
    resizeObserver.observe(viewport);

    loop();

    // Expose controller so subsequent prop changes don't tear this all down
    controllerRef.current = {
      setBookmarks: (list) => {
        current = list;
        state.cameraOffset.x = 0;
        state.cameraOffset.y = 0;
        state.targetOffset.x = 0;
        state.targetOffset.y = 0;
        buildLayout();
        clearActive();
        renderVisible();
      },
      destroy: () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        viewport.removeEventListener('mousedown', onMouseDown);
        viewport.removeEventListener('mousemove', onMouseMove);
        viewport.removeEventListener('mouseup', onMouseUp);
        viewport.removeEventListener('mouseleave', onMouseUp);
        viewport.removeEventListener('wheel', onWheel);
        viewport.removeEventListener('touchstart', onTouchStart);
        viewport.removeEventListener('touchmove', onTouchMove);
        viewport.removeEventListener('touchend', onTouchEnd);
        resizeObserver.disconnect();
        window.removeEventListener('keydown', onKey, true);
        overlay.removeEventListener('click', onOverlayClick);
        closeBtn.removeEventListener('click', onCloseClick);
        copyBtn.removeEventListener('click', onCopyClick);
        agentCopyBtn.removeEventListener('click', onAgentCopyClick);
        openBtn.removeEventListener('click', onOpenClick);
        linkEl.removeEventListener('click', onLinkClick);
        if (state.lightbox) {
          state.lightbox.clone.remove();
          state.lightbox.sourceEl.style.visibility = '';
          state.lightbox = null;
        }
        grid.innerHTML = '';
      },
    };

    return () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, []);

  // Prop-driven updates: push new bookmarks to the running controller.
  useEffect(() => {
    controllerRef.current?.setBookmarks(bookmarks);
  }, [bookmarks]);

  const overlayBg = theme.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.65)';
  const closeBtnBg = theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const closeBtnBorder = theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)';
  const canvasFadeSoft = `color-mix(in srgb, ${theme.bg} 82%, transparent)`;
  const canvasFadeClear = `color-mix(in srgb, ${theme.bg} 0%, transparent)`;

  // Text-card palette — tuned for readability in both themes. Backgrounds are
  // fully opaque so cards don't bleed with the canvas behind them.
  const cardVars = theme.isDark ? {
    '--bm-card-bg': '#1c1c1e',
    '--bm-card-border': 'rgba(255,255,255,0.08)',
    '--bm-card-text': theme.text,
    '--bm-card-secondary': theme.textSecondary,
    '--bm-card-quoted-bg': 'rgba(255,255,255,0.04)',
  } : {
    '--bm-card-bg': '#ffffff',
    '--bm-card-border': 'rgba(0,0,0,0.1)',
    '--bm-card-text': '#111111',
    '--bm-card-secondary': '#555555',
    '--bm-card-quoted-bg': 'rgba(0,0,0,0.035)',
  };

  return (
    <div
      ref={viewportRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        cursor: 'grab',
        backgroundColor: theme.bg,
        ...(cardVars as React.CSSProperties),
      }}
    >
      <style>{`
        .bm-grid-item:hover img { filter: brightness(1.08); }
        .bm-check-icon { opacity: 0; transform: scale(0.7); }
        button[data-copied="1"] .bm-copy-icon { opacity: 0; transform: scale(0.7); }
        button[data-copied="1"] .bm-check-icon { opacity: 1; transform: scale(1); }
        .bm-agent-copied-label { display: none; }
        button[data-copied="1"] .bm-agent-copy-label { display: none; }
        button[data-copied="1"] .bm-agent-copied-label { display: inline; }
        .bm-date-badge {
          position: absolute;
          right: 10px;
          bottom: 10px;
          z-index: 2;
          padding: 3px 7px;
          border-radius: 999px;
          background: rgba(0,0,0,0.48);
          color: rgba(255,255,255,0.88);
          font: 600 10px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0.01em;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          pointer-events: none;
        }
        .bm-text-card {
          position: absolute; inset: 0;
          display: none;
          flex-direction: column;
          gap: 10px;
          padding: 22px;
          box-sizing: border-box;
          overflow: hidden;
          background: var(--bm-card-bg);
          border: 1px solid var(--bm-card-border);
          border-radius: 24px;
          color: var(--bm-card-text);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
          transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
        }
        .bm-text-handle {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          color: var(--bm-card-secondary);
          letter-spacing: 0.01em;
          flex-shrink: 0;
        }
        .bm-text-avatar {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .bm-text-body {
          font-size: 14px;
          line-height: 1.45;
          letter-spacing: -0.005em;
          color: var(--bm-card-text);
          word-break: break-word;
          white-space: pre-wrap;
        }
        .bm-text-quoted {
          display: none;
          flex-direction: column;
          gap: 4px;
          padding: 10px 12px;
          margin-top: 10px;
          background: var(--bm-card-quoted-bg);
          border: 1px solid var(--bm-card-border);
          border-radius: 12px;
          font-size: 13px;
          line-height: 1.4;
          color: var(--bm-card-text);
        }
        .bm-text-quoted-handle {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 600;
          color: var(--bm-card-secondary);
          letter-spacing: 0.01em;
        }
        .bm-text-quoted-body {
          white-space: pre-wrap;
          word-break: break-word;
        }
        .bm-text-date {
          margin-top: auto;
          padding-top: 4px;
          font-size: 11px;
          font-weight: 600;
          color: var(--bm-card-secondary);
          opacity: 0.72;
          flex-shrink: 0;
        }
        .bm-grid-item:hover .bm-text-card { filter: brightness(1.03); }
      `}</style>
      <div
        ref={gridRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '30px',
          zIndex: 3,
          pointerEvents: 'none',
          background: `linear-gradient(to bottom, ${canvasFadeSoft} 0%, ${canvasFadeClear} 100%)`,
        }}
      />

      <div
        ref={overlayRef}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          backgroundColor: overlayBg,
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          pointerEvents: 'none',
          opacity: 0,
          transition: 'opacity 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
        }}
      >
        <button
          ref={closeBtnRef}
          style={{
            position: 'absolute',
            top: '24px',
            right: '24px',
            zIndex: 102,
            width: '48px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: closeBtnBg,
            border: `1px solid ${closeBtnBorder}`,
            borderRadius: '50%',
            color: theme.text,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            transition: 'background 0.2s ease',
          }}
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <button
          ref={copyBtnRef}
          style={{
            position: 'absolute',
            top: '84px',
            right: '24px',
            zIndex: 102,
            width: '48px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: closeBtnBg,
            border: `1px solid ${closeBtnBorder}`,
            borderRadius: '50%',
            color: theme.text,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            transition: 'background 0.2s ease',
          }}
          aria-label="Copy image"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', transition: 'opacity 0.15s ease, transform 0.15s ease' }} className="bm-copy-icon">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', transition: 'opacity 0.15s ease, transform 0.15s ease' }} className="bm-check-icon">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
        <div
          ref={infoRef}
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
            opacity: 0,
            transition: 'opacity 0.4s ease 0.15s, transform 0.4s ease',
            color: theme.text,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
            maxWidth: '640px',
            pointerEvents: 'auto',
          }}
        >
          <div
            ref={titleRef}
            style={{ fontSize: '16px', fontWeight: 500, margin: '0 0 6px', letterSpacing: '-0.01em', lineHeight: 1.4 }}
          />
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <img
              ref={lightboxAvatarRef}
              alt=""
              style={{ width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, display: 'none' }}
            />
            <a
              ref={linkRef}
              target="_blank"
              rel="noreferrer noopener"
              style={{ fontSize: '14px', color: theme.textSecondary, textDecoration: 'none', cursor: 'pointer' }}
            />
          </div>
          <div
            ref={dateRef}
            style={{
              display: 'none',
              marginTop: '4px',
              fontSize: '12px',
              color: theme.textSecondary,
              opacity: 0.82,
            }}
          />
          <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              ref={agentCopyBtnRef}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                minWidth: '128px',
                justifyContent: 'center',
                padding: '8px 16px',
                borderRadius: '100px',
                backgroundColor: closeBtnBg,
                border: `1px solid ${closeBtnBorder}`,
                color: theme.text,
                fontSize: '13px',
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                transition: 'background 0.2s ease',
              }}
              aria-label="Copy for agent"
            >
              <span className="bm-agent-copy-label">Copy for agent</span>
              <span className="bm-agent-copied-label">Copied</span>
            </button>
            <button
              ref={openBtnRef}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '100px',
                backgroundColor: closeBtnBg,
                border: `1px solid ${closeBtnBorder}`,
                color: theme.text,
                fontSize: '13px',
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                transition: 'background 0.2s ease',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M7.53 14.53a.75.75 0 0 1-1.06-1.06L10.94 9H2.75a.75.75 0 0 1 0-1.5h8.19L6.47 2.97a.75.75 0 0 1 1.06-1.06l5.47 5.47a.75.75 0 0 1 0 1.06l-5.47 5.47z" />
              </svg>
              <span>Open on X</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
