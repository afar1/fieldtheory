// Port of twitter-bookmarks-grid (Lucas Vocos / @afar1) to React + Field Theory theme.
// Keeps the vanilla DOM-pool masonry + imperative lightbox — battle-tested for 1000+ items.
import { useEffect, useRef } from 'react';
import { useTheme } from '../contexts/ThemeContext';

const CONFIG = {
  COLS: 5,
  GAP: 18,
  easingFactor: 0.1,
  POOL_SIZE: 500,
  BUFFER: 600,
};

function twitterImageUrl(url: string, size: string = 'small'): string {
  const base = url.split('?')[0];
  const ext = base.match(/\.(jpg|jpeg|png)$/i);
  const format = ext ? ext[1].toLowerCase() : 'jpg';
  return `${base}?format=${format}&name=${size}`;
}

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
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const copyBtnRef = useRef<HTMLButtonElement | null>(null);
  const openBtnRef = useRef<HTMLButtonElement | null>(null);
  const controllerRef = useRef<Controller | null>(null);

  // Mount-only setup. Creates the pool, binds listeners, starts the animation loop.
  useEffect(() => {
    const viewport = viewportRef.current;
    const grid = gridRef.current;
    const overlay = overlayRef.current;
    const info = infoRef.current;
    const titleEl = titleRef.current;
    const linkEl = linkRef.current;
    const closeBtn = closeBtnRef.current;
    const copyBtn = copyBtnRef.current;
    const openBtn = openBtnRef.current;
    if (!viewport || !grid || !overlay || !info || !titleEl || !linkEl || !closeBtn || !copyBtn || !openBtn) return;

    const openExternalUrl = (url: string) => {
      if (window.shellAPI?.openExternal) {
        void window.shellAPI.openExternal(url);
      } else {
        window.open(url, '_blank', 'noopener');
      }
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

    // Offscreen measurement node: same class tree as real cards so computed
    // styles match. Used to derive each text-only card's natural height.
    const measureRoot = document.createElement('div');
    measureRoot.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
    // Copy the card CSS vars so var() references resolve.
    for (const v of ['--bm-card-bg', '--bm-card-border', '--bm-card-text', '--bm-card-secondary', '--bm-card-quoted-bg']) {
      const val = viewport.style.getPropertyValue(v);
      if (val) measureRoot.style.setProperty(v, val);
    }
    const measureCard = document.createElement('div');
    measureCard.className = 'bm-text-card';
    measureCard.style.position = 'static';
    measureCard.style.display = 'flex';
    measureCard.style.inset = 'auto';
    const measureHandle = document.createElement('div');
    measureHandle.className = 'bm-text-handle';
    const measureBody = document.createElement('div');
    measureBody.className = 'bm-text-body';
    const measureQuoted = document.createElement('div');
    measureQuoted.className = 'bm-text-quoted';
    const measureQuotedHandle = document.createElement('div');
    measureQuotedHandle.className = 'bm-text-quoted-handle';
    const measureQuotedBody = document.createElement('div');
    measureQuotedBody.className = 'bm-text-quoted-body';
    measureQuoted.appendChild(measureQuotedHandle);
    measureQuoted.appendChild(measureQuotedBody);
    measureCard.appendChild(measureHandle);
    measureCard.appendChild(measureBody);
    measureCard.appendChild(measureQuoted);
    measureRoot.appendChild(measureCard);
    document.body.appendChild(measureRoot);

    const heightCache = new Map<string, number>();

    const measureTextCardHeight = (bm: Bookmark, width: number): number => {
      const key = `${bm.id}:${width}`;
      const cached = heightCache.get(key);
      if (cached !== undefined) return cached;
      measureCard.style.width = `${width}px`;
      measureHandle.textContent = bm.authorHandle ? `@${bm.authorHandle}` : (bm.authorName || '');
      measureBody.textContent = bm.text;
      measureBody.style.display = bm.text ? 'block' : 'none';
      if (bm.quotedTweet) {
        measureQuotedHandle.textContent = bm.quotedTweet.authorHandle
          ? `@${bm.quotedTweet.authorHandle}`
          : (bm.quotedTweet.authorName || '');
        measureQuotedBody.textContent = bm.quotedTweet.text;
        measureQuoted.style.display = 'flex';
      } else {
        measureQuoted.style.display = 'none';
      }
      const h = measureCard.offsetHeight;
      heightCache.set(key, h);
      return h;
    };

    const buildLayout = () => {
      const vw = viewport.clientWidth;
      const gap = CONFIG.GAP;
      colWidth = Math.max(1, Math.floor((vw - gap) / CONFIG.COLS));
      totalWidth = colWidth * CONFIG.COLS;

      const colHeights = new Array(CONFIG.COLS).fill(0);
      const columns: LayoutItem[][] = Array.from({ length: CONFIG.COLS }, () => []);
      const itemW = colWidth - gap;

      for (const bm of current) {
        let minCol = 0;
        for (let c = 1; c < CONFIG.COLS; c++) {
          if (colHeights[c] < colHeights[minCol]) minCol = c;
        }
        let itemH: number;
        if (bm.images && bm.images.length > 0) {
          const img = bm.images[0];
          const aspect = (img.width || 1) / (img.height || 1);
          itemH = itemW / aspect;
        } else {
          // Text-only card: measure actual rendered height so the card fits
          // its content exactly (including quoted-tweet block).
          itemH = measureTextCardHeight(bm, itemW);
        }
        const x = minCol * colWidth + gap / 2;
        const y = colHeights[minCol] + gap / 2;
        columns[minCol].push({ key: '', bookmark: bm, x, y, w: itemW, h: itemH });
        colHeights[minCol] += itemH + gap;
      }

      maxColHeight = Math.max(1, ...colHeights);

      layoutItems = [];
      for (let col = 0; col < CONFIG.COLS; col++) {
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
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;border-radius:24px;transition:filter 0.3s ease;';
        el.appendChild(img);

        const textEl = document.createElement('div');
        textEl.className = 'bm-text-card';
        const handleEl = document.createElement('div');
        handleEl.className = 'bm-text-handle';
        const bodyEl = document.createElement('div');
        bodyEl.className = 'bm-text-body';
        const quotedEl = document.createElement('div');
        quotedEl.className = 'bm-text-quoted';
        const quotedHandle = document.createElement('div');
        quotedHandle.className = 'bm-text-quoted-handle';
        const quotedBody = document.createElement('div');
        quotedBody.className = 'bm-text-quoted-body';
        quotedEl.appendChild(quotedHandle);
        quotedEl.appendChild(quotedBody);
        textEl.appendChild(handleEl);
        textEl.appendChild(bodyEl);
        textEl.appendChild(quotedEl);
        el.appendChild(textEl);

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
      for (const [, entry] of activeMap) {
        if (entry.poolEl !== state.lightbox?.sourceEl) {
          releaseEl(entry.poolEl);
          elToBookmark.delete(entry.poolEl);
        }
      }
      activeMap.clear();
    };

    const renderVisible = () => {
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      const buf = CONFIG.BUFFER;
      const lightboxEl = state.lightbox?.sourceEl ?? null;

      const camX = state.cameraOffset.x;
      const camY = state.cameraOffset.y;
      const minCullX = Math.min(camX, state.targetOffset.x);
      const maxCullX = Math.max(camX, state.targetOffset.x);
      const minCullY = Math.min(camY, state.targetOffset.y);
      const maxCullY = Math.max(camY, state.targetOffset.y);

      const startTileX = Math.floor((minCullX - buf) / totalWidth);
      const endTileX = Math.floor((maxCullX + vw + buf) / totalWidth);
      const startTileY = Math.floor((minCullY - buf) / maxColHeight);
      const endTileY = Math.floor((maxCullY + vh + buf) / maxColHeight);

      const visibleThisFrame = new Set<string>();

      for (let i = 0; i < layoutItems.length; i++) {
        const item = layoutItems[i];
        for (let ty = startTileY; ty <= endTileY; ty++) {
          for (let tx = startTileX; tx <= endTileX; tx++) {
            const worldX = item.x + tx * totalWidth;
            const worldY = item.y + ty * maxColHeight;
            const sx = worldX - camX;
            const sy = worldY - camY;
            const txs = worldX - state.targetOffset.x;
            const tys = worldY - state.targetOffset.y;

            const visibleAtCam =
              sx + item.w >= -buf && sx <= vw + buf &&
              sy + item.h >= -buf && sy <= vh + buf;
            const visibleAtTarget =
              txs + item.w >= -buf && txs <= vw + buf &&
              tys + item.h >= -buf && tys <= vh + buf;
            if (!visibleAtCam && !visibleAtTarget) continue;

            const visKey = `${item.key}_${tx}_${ty}`;
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
              const img = el.querySelector('img') as HTMLImageElement;
              const textEl = el.querySelector('.bm-text-card') as HTMLDivElement;
              const hasImage = !!(item.bookmark.images && item.bookmark.images.length > 0);
              if (hasImage) {
                const src = twitterImageUrl(item.bookmark.images[0].url, 'medium');
                if (img.src !== src) {
                  img.src = src;
                  img.alt = item.bookmark.text.substring(0, 60);
                }
                img.style.display = 'block';
                textEl.style.display = 'none';
              } else {
                img.removeAttribute('src');
                img.style.display = 'none';
                const handleEl = textEl.querySelector('.bm-text-handle') as HTMLDivElement;
                const bodyEl = textEl.querySelector('.bm-text-body') as HTMLDivElement;
                const quotedEl = textEl.querySelector('.bm-text-quoted') as HTMLDivElement;
                handleEl.textContent = item.bookmark.authorHandle ? `@${item.bookmark.authorHandle}` : (item.bookmark.authorName || '');
                bodyEl.textContent = item.bookmark.text;
                bodyEl.style.display = item.bookmark.text ? 'block' : 'none';
                if (item.bookmark.quotedTweet) {
                  const qHandle = quotedEl.querySelector('.bm-text-quoted-handle') as HTMLDivElement;
                  const qBody = quotedEl.querySelector('.bm-text-quoted-body') as HTMLDivElement;
                  qHandle.textContent = item.bookmark.quotedTweet.authorHandle
                    ? `@${item.bookmark.quotedTweet.authorHandle}`
                    : (item.bookmark.quotedTweet.authorName || '');
                  qBody.textContent = item.bookmark.quotedTweet.text;
                  quotedEl.style.display = 'flex';
                } else {
                  quotedEl.style.display = 'none';
                }
                textEl.style.display = 'flex';
              }
              el.style.width = `${item.w}px`;
              el.style.height = `${item.h}px`;
              el.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
              elToBookmark.set(el, item.bookmark);
              activeMap.set(visKey, { poolEl: el, layoutItem: item, screenX: sx, screenY: sy });
            }
          }
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
      const hasImage = !!(bookmark.images && bookmark.images.length > 0);
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
        const measured = measureTextCardHeight(bookmark, targetW);
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
      for (const v of ['--bm-card-bg', '--bm-card-border', '--bm-card-text', '--bm-card-secondary']) {
        const val = viewport.style.getPropertyValue(v);
        if (val) clone.style.setProperty(v, val);
      }

      if (hasImage) {
        const hiRes = document.createElement('img');
        hiRes.src = twitterImageUrl(bookmark.images[0].url, '4096x4096');
        hiRes.alt = '';
        hiRes.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:24px;opacity:0;transition:opacity 0.3s ease;';
        hiRes.onload = () => { hiRes.style.opacity = '1'; };
        clone.appendChild(hiRes);
      }

      document.body.appendChild(clone);
      overlay.style.opacity = '1';
      overlay.style.pointerEvents = 'auto';

      // For images, show a truncated preview of the caption in the info
      // block below the media. For text-only the card already contains the
      // full text — don't duplicate it in the info block.
      titleEl.textContent = hasImage
        ? (bookmark.text.length > 140 ? bookmark.text.substring(0, 140) + '…' : bookmark.text)
        : '';
      linkEl.textContent = bookmark.authorHandle ? `@${bookmark.authorHandle}` : '';
      linkEl.href = bookmark.url;
      info.style.top = `${endY + targetH + 20}px`;
      info.style.opacity = '1';
      copyBtn.style.display = hasImage ? 'flex' : 'none';

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
        lb.clone.remove();
        lb.sourceEl.style.visibility = '';
        state.lightbox = null;
        state.lightboxAnimating = false;
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
        state.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const onTouchEnd = () => { state.touchStart = null; };

    const onWheel = (e: WheelEvent) => {
      if (state.lightbox) return;
      e.preventDefault();
      state.targetOffset.x += e.deltaX;
      state.targetOffset.y += e.deltaY;
    };

    const onResize = () => {
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
      const cloneImg = clone.querySelector('img') as HTMLImageElement;
      const cloneText = clone.querySelector('.bm-text-card') as HTMLDivElement;
      Array.from(clone.querySelectorAll('img')).forEach((el) => {
        if (el !== cloneImg) el.remove();
      });

      const hasImage = !!(nextBm.images && nextBm.images.length > 0);
      if (hasImage) {
        cloneImg.src = twitterImageUrl(nextBm.images[0].url, 'medium');
        cloneImg.style.display = 'block';
        cloneText.style.display = 'none';
        const hiRes = document.createElement('img');
        hiRes.src = twitterImageUrl(nextBm.images[0].url, '4096x4096');
        hiRes.alt = '';
        hiRes.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:24px;opacity:0;transition:opacity 0.3s ease;';
        hiRes.onload = () => { hiRes.style.opacity = '1'; };
        clone.appendChild(hiRes);
      } else {
        cloneImg.removeAttribute('src');
        cloneImg.style.display = 'none';
        cloneText.style.display = 'flex';
        const handleEl = cloneText.querySelector('.bm-text-handle') as HTMLDivElement;
        const bodyEl = cloneText.querySelector('.bm-text-body') as HTMLDivElement;
        const quotedEl = cloneText.querySelector('.bm-text-quoted') as HTMLDivElement;
        handleEl.textContent = nextBm.authorHandle ? `@${nextBm.authorHandle}` : (nextBm.authorName || '');
        bodyEl.textContent = nextBm.text;
        bodyEl.style.display = nextBm.text ? 'block' : 'none';
        if (nextBm.quotedTweet) {
          const qHandle = quotedEl.querySelector('.bm-text-quoted-handle') as HTMLDivElement;
          const qBody = quotedEl.querySelector('.bm-text-quoted-body') as HTMLDivElement;
          qHandle.textContent = nextBm.quotedTweet.authorHandle
            ? `@${nextBm.quotedTweet.authorHandle}`
            : (nextBm.quotedTweet.authorName || '');
          qBody.textContent = nextBm.quotedTweet.text;
          quotedEl.style.display = 'flex';
        } else {
          quotedEl.style.display = 'none';
        }
      }

      titleEl.textContent = hasImage
        ? (nextBm.text.length > 140 ? nextBm.text.substring(0, 140) + '…' : nextBm.text)
        : '';
      linkEl.textContent = nextBm.authorHandle ? `@${nextBm.authorHandle}` : '';
      linkEl.href = nextBm.url;
      copyBtn.style.display = hasImage ? 'flex' : 'none';

      nextEl.style.visibility = 'hidden';
      state.lightbox.sourceEl = nextEl;
      state.lightbox.bookmark = nextBm;
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
      const img = bm.images[0];
      if (img.type === 'video' || img.type === 'animated_gif') return;
      try {
        const resp = await fetch(twitterImageUrl(img.url, '4096x4096'));
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
    openBtn.addEventListener('click', onOpenClick);
    linkEl.addEventListener('click', onLinkClick);

    // Reflow when the viewport itself resizes (includes sidebar drags, immersive toggle, window resize).
    let lastW = viewport.clientWidth;
    const resizeObserver = new ResizeObserver(() => {
      if (viewport.clientWidth !== lastW) {
        lastW = viewport.clientWidth;
        onResize();
      }
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
        openBtn.removeEventListener('click', onOpenClick);
        linkEl.removeEventListener('click', onLinkClick);
        if (state.lightbox) {
          state.lightbox.clone.remove();
          state.lightbox.sourceEl.style.visibility = '';
          state.lightbox = null;
        }
        grid.innerHTML = '';
        measureRoot.remove();
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
          font-size: 12px;
          font-weight: 600;
          color: var(--bm-card-secondary);
          letter-spacing: 0.01em;
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
          font-size: 11px;
          font-weight: 600;
          color: var(--bm-card-secondary);
          letter-spacing: 0.01em;
        }
        .bm-text-quoted-body {
          white-space: pre-wrap;
          word-break: break-word;
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
          <a
            ref={linkRef}
            target="_blank"
            rel="noreferrer noopener"
            style={{ fontSize: '14px', color: theme.textSecondary, textDecoration: 'none', cursor: 'pointer' }}
          />
          <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'center' }}>
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
