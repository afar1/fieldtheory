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

/** Animate a numeric value with rAF. Returns a cancel fn. */
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

export default function BookmarksCanvas({ bookmarks }: { bookmarks: Bookmark[] }) {
  const { theme } = useTheme();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const infoRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const grid = gridRef.current;
    const overlay = overlayRef.current;
    const info = infoRef.current;
    const titleEl = titleRef.current;
    const linkEl = linkRef.current;
    const closeBtn = closeBtnRef.current;
    if (!viewport || !grid || !overlay || !info || !titleEl || !linkEl || !closeBtn) return;

    // Only bookmarks with images are laid out in the grid
    const withImages = bookmarks.filter((b) => b.images && b.images.length > 0);

    // --- State ---
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

    let layoutItems: LayoutItem[] = [];
    let colWidth = 0;
    let totalWidth = 0;
    let maxColHeight = 0;

    // --- Masonry layout (data only) ---
    const buildLayout = () => {
      const vw = viewport.clientWidth;
      const gap = CONFIG.GAP;
      colWidth = Math.max(1, Math.floor((vw - gap) / CONFIG.COLS));
      totalWidth = colWidth * CONFIG.COLS;

      const colHeights = new Array(CONFIG.COLS).fill(0);
      const columns: LayoutItem[][] = Array.from({ length: CONFIG.COLS }, () => []);

      for (const bm of withImages) {
        let minCol = 0;
        for (let c = 1; c < CONFIG.COLS; c++) {
          if (colHeights[c] < colHeights[minCol]) minCol = c;
        }
        const img = bm.images[0];
        const aspect = (img.width || 1) / (img.height || 1);
        const itemW = colWidth - gap;
        const itemH = itemW / aspect;
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

    // --- DOM pool ---
    const pool: HTMLDivElement[] = [];
    const freePool: HTMLDivElement[] = [];
    const activeMap = new Map<string, ActiveEntry>();
    const elToBookmark = new WeakMap<HTMLDivElement, Bookmark>();

    const createPool = () => {
      grid.innerHTML = '';
      pool.length = 0;
      freePool.length = 0;
      activeMap.clear();
      for (let i = 0; i < CONFIG.POOL_SIZE; i++) {
        const el = document.createElement('div');
        el.style.position = 'absolute';
        el.style.overflow = 'hidden';
        el.style.willChange = 'transform';
        el.style.userSelect = 'none';
        el.style.backfaceVisibility = 'hidden';
        el.style.borderRadius = '24px';
        el.style.display = 'none';
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.display = 'block';
        img.style.pointerEvents = 'none';
        img.style.borderRadius = '24px';
        el.appendChild(img);
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

    // --- Renderer ---
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
              const img = el.querySelector('img')!;
              const src = twitterImageUrl(item.bookmark.images[0].url, 'medium');
              if (img.src !== src) {
                img.src = src;
                img.alt = item.bookmark.text.substring(0, 60);
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
      const aspectRatio = rect.width / rect.height;
      let targetW: number; let targetH: number;
      if (maxW / maxH > aspectRatio) {
        targetH = maxH; targetW = targetH * aspectRatio;
      } else {
        targetW = maxW; targetH = targetW / aspectRatio;
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

      // High-res layer
      const hiRes = document.createElement('img');
      hiRes.src = twitterImageUrl(bookmark.images[0].url, '4096x4096');
      hiRes.alt = '';
      hiRes.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:24px;opacity:0;transition:opacity 0.3s ease;';
      hiRes.onload = () => { hiRes.style.opacity = '1'; };
      clone.appendChild(hiRes);

      // Videos/gifs → show "Open on X" button instead of inline player (Stage 1)
      if (bookmark.images[0].type === 'video' || bookmark.images[0].type === 'animated_gif') {
        const playBtn = document.createElement('button');
        playBtn.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;z-index:2;pointer-events:auto;';
        const pill = document.createElement('span');
        pill.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:100px;background:rgba(0,0,0,0.55);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.18);color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;font-size:14px;font-weight:500;';
        pill.textContent = '▶  Open on X';
        playBtn.appendChild(pill);
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.open(bookmark.url, '_blank', 'noopener');
        });
        clone.appendChild(playBtn);
      }

      document.body.appendChild(clone);
      overlay.style.opacity = '1';
      overlay.style.pointerEvents = 'auto';

      titleEl.textContent = bookmark.text.length > 120 ? bookmark.text.substring(0, 120) + '…' : bookmark.text;
      linkEl.textContent = bookmark.authorHandle ? `@${bookmark.authorHandle}` : '';
      linkEl.href = bookmark.url;
      info.style.top = `${endY + targetH + 16}px`;
      info.style.opacity = '1';

      state.lightbox = { clone, bookmark, sourceEl: el, endX, endY, endW: targetW, endH: targetH };

      // Scaled-duration tween from grid-cell rect to centered target
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
        const target = (e.target as HTMLElement | null)?.closest('div');
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
      for (const [visKey, entry] of activeMap) {
        releaseEl(entry.poolEl);
        activeMap.delete(visKey);
      }
      renderVisible();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.lightbox) closeLightbox();
    };

    const onOverlayClick = (e: MouseEvent) => {
      if (e.target === overlay) closeLightbox();
    };

    // --- Animation loop ---
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

    // --- Init ---
    buildLayout();
    createPool();
    renderVisible();

    const onCloseClick = (e: MouseEvent) => { e.stopPropagation(); closeLightbox(); };

    viewport.addEventListener('mousedown', onMouseDown);
    viewport.addEventListener('mousemove', onMouseMove);
    viewport.addEventListener('mouseup', onMouseUp);
    viewport.addEventListener('mouseleave', onMouseUp);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('touchstart', onTouchStart);
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    overlay.addEventListener('click', onOverlayClick);
    closeBtn.addEventListener('click', onCloseClick);

    loop();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      viewport.removeEventListener('mousedown', onMouseDown);
      viewport.removeEventListener('mousemove', onMouseMove);
      viewport.removeEventListener('mouseup', onMouseUp);
      viewport.removeEventListener('mouseleave', onMouseUp);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      overlay.removeEventListener('click', onOverlayClick);
      closeBtn.removeEventListener('click', onCloseClick);
      if (state.lightbox) {
        state.lightbox.clone.remove();
        state.lightbox.sourceEl.style.visibility = '';
        state.lightbox = null;
      }
      grid.innerHTML = '';
    };
  }, [bookmarks]);

  // Theme-adaptive palette for the canvas
  const overlayBg = theme.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.65)';
  const closeBtnBg = theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const closeBtnBorder = theme.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';
  const infoText = theme.text;
  const infoSecondary = theme.textSecondary;

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
      }}
    >
      <div
        ref={gridRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />

      {/* Lightbox overlay — hosted inside viewport so it stays scoped to the pane */}
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
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: closeBtnBg,
            border: `1px solid ${closeBtnBorder}`,
            borderRadius: '50%',
            color: infoText,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="3" y1="3" x2="13" y2="13" />
            <line x1="13" y1="3" x2="3" y2="13" />
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
            transition: 'opacity 0.3s ease',
            color: infoText,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
            maxWidth: '640px',
            pointerEvents: 'auto',
          }}
        >
          <div
            ref={titleRef}
            style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 6px', letterSpacing: '-0.01em', lineHeight: 1.4 }}
          />
          <a
            ref={linkRef}
            target="_blank"
            rel="noreferrer noopener"
            style={{ fontSize: '13px', color: infoSecondary, textDecoration: 'none' }}
          />
        </div>
      </div>
    </div>
  );
}
