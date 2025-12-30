import { BrowserWindow, screen, nativeImage, app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

/**
 * ToastWindow - A simple centered toast notification with Field Theory branding.
 * Used for showing messages when the main window may not be visible.
 * Clicking the toast opens the main window.
 */
export class ToastWindow {
  private window: BrowserWindow | null = null;
  private dismissTimeout: NodeJS.Timeout | null = null;
  private showWindowCallback: (() => void) | null = null;
  private isHovering: boolean = false;

  constructor() {
    // Listen for click events from the toast renderer.
    ipcMain.on('toast-clicked', () => {
      this.handleClick();
    });
    
    // Pause dismiss timer while hovering.
    ipcMain.on('toast-hover-start', () => {
      this.isHovering = true;
      if (this.dismissTimeout) {
        clearTimeout(this.dismissTimeout);
        this.dismissTimeout = null;
      }
    });
    
    // Resume dismiss timer when hover ends.
    ipcMain.on('toast-hover-end', () => {
      this.isHovering = false;
      this.startDismissTimer(2000); // Give 2 more seconds after hover ends.
    });
  }

  /**
   * Set the callback to show the main window when toast is clicked.
   */
  setShowWindowCallback(callback: () => void): void {
    this.showWindowCallback = callback;
  }

  /**
   * Show a toast message centered on screen.
   */
  show(message: string, duration: number = 4000): void {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/3ea40dd5-7ebe-4b7f-a951-45855cee9c03',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'toastWindow.ts:show',message:'ToastWindow.show() called',data:{message,duration},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    // Close existing toast if any.
    this.dismiss();

    // Use the display where the cursor is (for multi-monitor support).
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const { width: screenWidth, height: screenHeight } = display.workAreaSize;
    const { x: displayX, y: displayY } = display.bounds;
    
    const toastWidth = 340;
    const toastHeight = 100;
    // Center on the current display (not just primary).
    const x = displayX + Math.round((screenWidth - toastWidth) / 2);
    const y = displayY + Math.round((screenHeight - toastHeight) / 2);

    this.window = new BrowserWindow({
      width: toastWidth,
      height: toastHeight,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../toast-preload.js'),
      },
    });

    // Prevent the window from being focused.
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Get logo as base64 data URL (file:// URLs don't work in inline HTML due to security).
    let logoDataUrl = '';
    try {
      let logoPath: string;
      if (app.isPackaged) {
        logoPath = path.join(process.resourcesPath, 'app.asar', 'dist', 'field-theory-logo.png');
      } else {
        logoPath = path.join(app.getAppPath(), 'public', 'field-theory-logo.png');
      }
      const logoBuffer = fs.readFileSync(logoPath);
      logoDataUrl = `data:image/png;base64,${logoBuffer.toString('base64')}`;
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/3ea40dd5-7ebe-4b7f-a951-45855cee9c03',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'toastWindow.ts:logoPath',message:'Logo loaded as base64',data:{logoPath,base64Length:logoDataUrl.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H7-logo'})}).catch(()=>{});
      // #endregion
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/3ea40dd5-7ebe-4b7f-a951-45855cee9c03',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'toastWindow.ts:logoError',message:'Failed to load logo',data:{error:String(err)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H7-logo'})}).catch(()=>{});
      // #endregion
    }

    // Load inline HTML with Field Theory styling.
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body {
            width: 100%;
            height: 100%;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
            background: transparent;
            -webkit-app-region: no-drag;
          }
          .toast {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px 16px;
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-radius: 16px;
            cursor: pointer;
            transition: all 0.15s ease;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15), 0 0 0 0.5px rgba(0, 0, 0, 0.08);
          }
          .toast:hover {
            transform: scale(1.02);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 0 0 0.5px rgba(0, 0, 0, 0.1);
          }
          .toast:active {
            transform: scale(0.98);
          }
          .header {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .icon {
            width: 18px;
            height: 18px;
            object-fit: contain;
            filter: brightness(0);
            opacity: 0.7;
          }
          .app-name {
            color: rgba(0, 0, 0, 0.5);
            font-size: 12px;
            font-weight: 500;
            letter-spacing: -0.1px;
          }
          .body {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .title {
            color: rgba(0, 0, 0, 0.85);
            font-size: 13px;
            font-weight: 600;
            letter-spacing: -0.2px;
          }
          .subtitle {
            color: rgba(0, 0, 0, 0.55);
            font-size: 12px;
            font-weight: 400;
          }
          .footer {
            display: flex;
            justify-content: flex-end;
            margin-top: auto;
          }
          .hint {
            color: rgba(0, 0, 0, 0.4);
            font-size: 11px;
            font-weight: 400;
            font-style: italic;
          }
        </style>
        <script>
          document.addEventListener('DOMContentLoaded', () => {
            const toast = document.querySelector('.toast');
            toast.addEventListener('mouseenter', () => window.toastAPI?.hoverStart());
            toast.addEventListener('mouseleave', () => window.toastAPI?.hoverEnd());
          });
        </script>
      </head>
      <body>
        <div class="toast" onclick="window.toastAPI?.clicked()">
          <div class="header">
            <span class="app-name">Field Theory</span>
          </div>
          <div class="body">
            <div class="title">No target input field</div>
            <div class="subtitle">Context copied to your clipboard</div>
          </div>
          <div class="footer">
            <span class="hint">Click to open -or- ⌘V to paste</span>
          </div>
        </div>
      </body>
      </html>
    `;

    this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    this.window.showInactive();
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/3ea40dd5-7ebe-4b7f-a951-45855cee9c03',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'toastWindow.ts:show-after',message:'ToastWindow shown',data:{isVisible:this.window?.isVisible(),bounds:this.window?.getBounds()},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
    // #endregion

    // Auto-dismiss after duration.
    this.startDismissTimer(duration);

    console.log('[ToastWindow] Showing toast:', message);
  }

  /**
   * Start or restart the dismiss timer.
   */
  private startDismissTimer(duration: number): void {
    if (this.dismissTimeout) {
      clearTimeout(this.dismissTimeout);
    }
    this.dismissTimeout = setTimeout(() => {
      if (!this.isHovering) {
        this.dismiss();
      }
    }, duration);
  }

  /**
   * Handle click on the toast.
   */
  private handleClick(): void {
    console.log('[ToastWindow] Toast clicked');
    this.dismiss();
    if (this.showWindowCallback) {
      this.showWindowCallback();
    }
  }

  /**
   * Dismiss the toast.
   */
  dismiss(): void {
    if (this.dismissTimeout) {
      clearTimeout(this.dismissTimeout);
      this.dismissTimeout = null;
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
      this.window = null;
    }
  }

  /**
   * Escape HTML to prevent XSS.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.dismiss();
    ipcMain.removeAllListeners('toast-clicked');
  }
}
