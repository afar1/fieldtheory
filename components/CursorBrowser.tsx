import React, { useRef, useState, useCallback, useImperativeHandle, forwardRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  AppState,
  AppStateStatus,
  Keyboard,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';

// Minimal top padding to match other pages in the app.
// The parent container handles safe area, so we just need consistent spacing.
const TOP_PADDING = 12;

// Cursor's agent dashboard URL.
// This is the web interface where users can interact with Cursor's AI.
const CURSOR_AGENT_URL = 'https://www.cursor.com/agent';

// Keep-alive interval: How often to ping the page to keep it fresh (5 minutes).
const KEEP_ALIVE_INTERVAL_MS = 5 * 60 * 1000;

// If page hasn't been refreshed in this time, auto-reload when visited (15 minutes).
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

// How long to wait for the page to be ready before giving up (in ms).
const PAGE_READY_TIMEOUT_MS = 15000;

// How often to check if Cursor's React app is ready (in ms).
const PAGE_READY_POLL_INTERVAL_MS = 500;

// Ref handle exposed to parent components.
// Lets the parent paste text into the Cursor input and focus the browser.
export interface CursorBrowserHandle {
  pasteText: (text: string) => void;
  reload: () => void;
  ensureFresh: () => void;
  isReady: () => boolean;
}

interface CursorBrowserProps {
  // Called when the component is ready and loaded.
  onReady?: () => void;
  // Called when there's an error loading the page.
  onError?: (error: string) => void;
}

/**
 * Persistent WebView browser for Cursor's agent dashboard.
 * 
 * Key features:
 * - Maintains login session across app restarts (cookies persist in WebView).
 * - Exposes a `pasteText` method to inject transcribed text into Cursor's input.
 * - Uses injected JavaScript to interact with the Cursor UI.
 * - Queues paste operations until the page's React app is fully mounted.
 * - Supports recording directly on this page.
 * 
 * The WebView uses the default cache/cookie storage which persists between sessions,
 * so users stay logged in as long as Cursor's session cookies are valid.
 */
export const CursorBrowser = forwardRef<CursorBrowserHandle, CursorBrowserProps>(
  function CursorBrowser({ 
    onReady, 
    onError, 
  }, ref) {
    const webViewRef = useRef<WebView>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [canGoBack, setCanGoBack] = useState(false);
    const [canGoForward, setCanGoForward] = useState(false);
    const [currentUrl, setCurrentUrl] = useState(CURSOR_AGENT_URL);
    const [hasError, setHasError] = useState(false);
    const [isAppReady, setIsAppReady] = useState(false);
    const pendingPasteRef = useRef<string | null>(null);
    
    // Track last successful page load time for keep-alive mechanism
    const lastRefreshRef = useRef<number>(Date.now());
    const keepAliveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    
    const readyPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const checkAppReadyJS = `
      (function() {
        const selectors = [
          'textarea[placeholder*="Ask Cursor"]',
          'textarea[placeholder*="build"]',
          'textarea[placeholder*="explore"]',
          'textarea[placeholder*="message"]',
          'textarea[placeholder*="Message"]',
          '[contenteditable="true"][role="textbox"]',
          '[contenteditable="true"]',
          'textarea',
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'appReady', ready: true }));
            return true;
          }
        }
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'appReady', ready: false }));
        return false;
      })();
    `;

    const startReadyPolling = useCallback(() => {
      if (readyPollIntervalRef.current) {
        clearInterval(readyPollIntervalRef.current);
      }
      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current);
      }

      setIsAppReady(false);

      readyPollIntervalRef.current = setInterval(() => {
        if (webViewRef.current && !hasError) {
          webViewRef.current.injectJavaScript(checkAppReadyJS);
        }
      }, PAGE_READY_POLL_INTERVAL_MS);

      readyTimeoutRef.current = setTimeout(() => {
        if (readyPollIntervalRef.current) {
          clearInterval(readyPollIntervalRef.current);
          readyPollIntervalRef.current = null;
        }
        setIsAppReady(true);
        processPendingPaste();
      }, PAGE_READY_TIMEOUT_MS);
    }, [hasError]);

    const processPendingPaste = useCallback(() => {
      if (pendingPasteRef.current) {
        const text = pendingPasteRef.current;
        pendingPasteRef.current = null;
        performPasteInternal(text);
      }
    }, []);

    const handleMessage = useCallback((event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'appReady' && data.ready) {
          setIsAppReady(true);
          if (readyPollIntervalRef.current) {
            clearInterval(readyPollIntervalRef.current);
            readyPollIntervalRef.current = null;
          }
          if (readyTimeoutRef.current) {
            clearTimeout(readyTimeoutRef.current);
            readyTimeoutRef.current = null;
          }
          processPendingPaste();
        }
      } catch (e) {
        // Ignore non-JSON messages
      }
    }, [processPendingPaste]);

    // Keep-alive mechanism: Periodically inject a simple JS ping to prevent page staling.
    // This runs a lightweight check that keeps the WebView's JS context active.
    const pingPage = useCallback(() => {
      if (webViewRef.current && !hasError) {
        // Inject a lightweight ping that checks if the page is still responsive
        const pingJS = `
          (function() {
            // Just access the document to keep the page active
            return document.readyState;
          })();
        `;
        webViewRef.current.injectJavaScript(pingJS);
      }
    }, [hasError]);

    // Check if page is stale and needs refresh
    const isPageStale = useCallback(() => {
      const timeSinceLastRefresh = Date.now() - lastRefreshRef.current;
      return timeSinceLastRefresh > STALE_THRESHOLD_MS;
    }, []);

    // Ensure the page is fresh before interacting with it
    const ensureFresh = useCallback(() => {
      if (isPageStale() || hasError) {
        console.log('[CursorBrowser] Page is stale, auto-reloading...');
        setHasError(false);
        webViewRef.current?.reload();
      }
    }, [isPageStale, hasError]);

    // Set up keep-alive interval when component mounts
    useEffect(() => {
      // Start the keep-alive interval
      keepAliveIntervalRef.current = setInterval(pingPage, KEEP_ALIVE_INTERVAL_MS);

      // Handle app state changes - refresh if returning from background and page is stale
      const subscription = AppState.addEventListener('change', (nextAppState) => {
        if (
          appStateRef.current.match(/inactive|background/) &&
          nextAppState === 'active'
        ) {
          // App just came to foreground, check if page needs refresh
          if (isPageStale()) {
            console.log('[CursorBrowser] App foregrounded with stale page, refreshing...');
            ensureFresh();
          }
        }
        appStateRef.current = nextAppState;
      });

      return () => {
        // Clean up interval and subscription on unmount
        if (keepAliveIntervalRef.current) {
          clearInterval(keepAliveIntervalRef.current);
        }
        if (readyPollIntervalRef.current) {
          clearInterval(readyPollIntervalRef.current);
        }
        if (readyTimeoutRef.current) {
          clearTimeout(readyTimeoutRef.current);
        }
        subscription.remove();
      };
    }, [pingPage, isPageStale, ensureFresh]);

    useImperativeHandle(ref, () => ({
      pasteText: (text: string) => {
        if (isPageStale() || hasError) {
          pendingPasteRef.current = text;
          setHasError(false);
          setIsAppReady(false);
          webViewRef.current?.reload();
          return;
        }
        
        if (!isAppReady) {
          pendingPasteRef.current = text;
          startReadyPolling();
          return;
        }
        
        performPasteInternal(text);
      },

      reload: () => {
        setHasError(false);
        setIsAppReady(false);
        lastRefreshRef.current = Date.now();
        webViewRef.current?.reload();
      },

      ensureFresh,
      isReady: () => isAppReady && !isPageStale() && !hasError,
    }));

    // Helper function to perform the actual paste operation.
    // Note: We intentionally do NOT focus the input after pasting, so the keyboard
    // stays hidden. User can tap the input field if they want to edit.
    const performPasteInternal = useCallback((text: string) => {
      // Escape the text for safe JavaScript injection.
      const escapedText = text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');

      // JavaScript to find and populate the Cursor input field.
      // We try multiple selectors since the UI might vary.
      const injectedJS = `
        (function() {
          // Try to find the chat input. Cursor uses various input types.
          // Priority order: specific Cursor selectors first, then generic fallbacks.
          const selectors = [
            // Cursor's main input field (placeholder: "Ask Cursor to build, fix bugs, explore")
            'textarea[placeholder*="Ask Cursor"]',
            'textarea[placeholder*="build"]',
            'textarea[placeholder*="explore"]',
            // Generic message inputs
            'textarea[placeholder*="message"]',
            'textarea[placeholder*="Message"]',
            // Test IDs
            'textarea[data-testid="chat-input"]',
            '[data-testid="chat-input"]',
            // Contenteditable elements (React rich text editors)
            '[contenteditable="true"][role="textbox"]',
            '[contenteditable="true"]',
            // Generic fallbacks
            'textarea',
            'input[type="text"]'
          ];
          
          let input = null;
          for (const selector of selectors) {
            input = document.querySelector(selector);
            if (input) break;
          }
          
          if (input) {
            // Scroll the input into view so user can see the pasted text.
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // For textarea or input elements - use native setter to bypass React
            if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
              // Get the native value setter (React overrides this, so we grab the original)
              const nativeSetter = Object.getOwnPropertyDescriptor(
                input.tagName === 'TEXTAREA' 
                  ? window.HTMLTextAreaElement.prototype 
                  : window.HTMLInputElement.prototype,
                'value'
              ).set;
              
              // Call the native setter to actually set the value
              nativeSetter.call(input, '${escapedText}');
              
              // Dispatch input event so React updates its state
              const inputEvent = new Event('input', { bubbles: true });
              input.dispatchEvent(inputEvent);
              
              // Blur the input to ensure keyboard doesn't pop up.
              input.blur();
            } 
            // For contenteditable divs
            else if (input.contentEditable === 'true') {
              // Temporarily focus to insert text, then blur to hide keyboard.
              input.focus();
              document.execCommand('selectAll', false, null);
              document.execCommand('insertText', false, '${escapedText}');
              input.blur();
            }
            
            // Remove focus from any active element to ensure keyboard is hidden.
            if (document.activeElement) {
              document.activeElement.blur();
            }
            
            return true;
          }
          
          // Fallback: copy to clipboard if we can't find the input
          if (navigator.clipboard) {
            navigator.clipboard.writeText('${escapedText}');
          }
          return false;
        })();
      `;

      webViewRef.current?.injectJavaScript(injectedJS);
    }, []);

    // Handle navigation state changes to update back/forward buttons.
    const handleNavigationStateChange = useCallback((navState: any) => {
      setCanGoBack(navState.canGoBack);
      setCanGoForward(navState.canGoForward);
      setCurrentUrl(navState.url || CURSOR_AGENT_URL);
    }, []);

    const handleLoadEnd = useCallback(() => {
      setIsLoading(false);
      setHasError(false);
      lastRefreshRef.current = Date.now();
      startReadyPolling();
      
      onReady?.();
    }, [onReady, startReadyPolling]);

    // Handle page load start.
    const handleLoadStart = useCallback(() => {
      setIsLoading(true);
    }, []);

    // Handle page load error.
    const handleError = useCallback((syntheticEvent: any) => {
      const { nativeEvent } = syntheticEvent;
      setIsLoading(false);
      setHasError(true);
      onError?.(nativeEvent.description || 'Failed to load page');
    }, [onError]);

    // Allow all navigation in WebView - no OAuth interception needed.
    // Users can use the "Login in Safari" button for authentication.
    const handleShouldStartLoadWithRequest = useCallback((_request: any) => {
      return true;
    }, []);

    const handleGoBack = () => webViewRef.current?.goBack();
    const handleGoForward = () => webViewRef.current?.goForward();
    const handleReload = () => {
      setHasError(false);
      lastRefreshRef.current = Date.now();
      webViewRef.current?.reload();
    };
    const handleGoHome = () => {
      setHasError(false);
      webViewRef.current?.injectJavaScript(`window.location.href = '${CURSOR_AGENT_URL}';`);
    };

    // Open current page in external browser.
    const handleOpenExternal = () => {
      Linking.openURL(currentUrl);
    };

    // Open Cursor login in Safari. User completes login there (nonce cookie + OAuth
    // all in one place), then returns. The WebView reloads to pick up the session.
    const handleLoginInSafari = async () => {
      await WebBrowser.openBrowserAsync(CURSOR_AGENT_URL);
      // Reload WebView after Safari closes to pick up session
      webViewRef.current?.reload();
    };

    return (
      <View style={styles.container}>
        {/* Navigation bar */}
        <View style={styles.navBar}>
          <TouchableOpacity
            style={[styles.navButton, !canGoBack && styles.navButtonDisabled]}
            onPress={handleGoBack}
            disabled={!canGoBack}
          >
            <Feather name="chevron-left" size={22} color={canGoBack ? '#111' : '#ccc'} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navButton, !canGoForward && styles.navButtonDisabled]}
            onPress={handleGoForward}
            disabled={!canGoForward}
          >
            <Feather name="chevron-right" size={22} color={canGoForward ? '#111' : '#ccc'} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.navButton} onPress={handleReload}>
            <Feather name="refresh-cw" size={18} color="#111" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.navButton} onPress={handleGoHome}>
            <Feather name="home" size={18} color="#111" />
          </TouchableOpacity>

          <View style={styles.urlContainer}>
            <Text style={styles.urlText} numberOfLines={1}>
              {currentUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </Text>
          </View>

          <TouchableOpacity style={styles.navButton} onPress={handleLoginInSafari}>
            <Feather name="log-in" size={18} color="#111" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.navButton} onPress={handleOpenExternal}>
            <Feather name="external-link" size={18} color="#111" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.navButton} onPress={() => Keyboard.dismiss()}>
            <Feather name="chevron-down" size={18} color="#111" />
          </TouchableOpacity>
        </View>

        {/* WebView */}
        <View style={styles.webViewContainer}>
          {hasError ? (
            <View style={styles.errorContainer}>
              <Feather name="wifi-off" size={48} color="#9CA3AF" />
              <Text style={styles.errorTitle}>Unable to load Cursor</Text>
              <Text style={styles.errorSubtitle}>
                Check your internet connection and try again.
              </Text>
              <TouchableOpacity style={styles.retryButton} onPress={handleReload}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <WebView
              ref={webViewRef}
              source={{ uri: CURSOR_AGENT_URL }}
              style={styles.webView}
              onNavigationStateChange={handleNavigationStateChange}
              onLoadEnd={handleLoadEnd}
              onLoadStart={handleLoadStart}
              onError={handleError}
              onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
              onMessage={handleMessage}
              // Enable JavaScript (required for Cursor's React app).
              javaScriptEnabled={true}
              // Enable DOM storage for session persistence.
              domStorageEnabled={true}
              // Share cookies with the system browser for OAuth.
              sharedCookiesEnabled={true}
              // Enable third-party cookies for authentication flows.
              thirdPartyCookiesEnabled={true}
              // Allow media playback without user gesture.
              mediaPlaybackRequiresUserAction={false}
              // Use desktop user agent so Cursor shows full interface.
              userAgent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              // Start with scale that fits screen.
              scalesPageToFit={true}
              // Allow zooming for better readability.
              allowsInlineMediaPlayback={true}
              // Enable file access for potential uploads.
              allowFileAccess={true}
              // Inject JavaScript to improve mobile experience.
              injectedJavaScript={`
                // Add mobile-friendly viewport if not present.
                if (!document.querySelector('meta[name="viewport"]')) {
                  const meta = document.createElement('meta');
                  meta.name = 'viewport';
                  meta.content = 'width=device-width, initial-scale=1, maximum-scale=3';
                  document.head.appendChild(meta);
                }
                true;
              `}
            />
          )}

          {/* Loading overlay */}
          {isLoading && !hasError && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#2563EB" />
              <Text style={styles.loadingText}>Loading Cursor...</Text>
            </View>
          )}
          
          {/* App ready indicator - subtle dot in corner */}
          {!isLoading && !hasError && (
            <View style={styles.readyIndicator}>
              <View style={[
                styles.readyDot,
                isAppReady ? styles.readyDotReady : styles.readyDotLoading
              ]} />
            </View>
          )}
        </View>

      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: TOP_PADDING,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 4,
  },
  navButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  navButtonDisabled: {
    opacity: 0.5,
  },
  urlContainer: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  urlText: {
    fontSize: 13,
    color: '#6B7280',
  },
  webViewContainer: {
    flex: 1,
    position: 'relative',
  },
  webView: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: '#6B7280',
  },
  readyIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  readyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  readyDotReady: {
    backgroundColor: '#22C55E',
  },
  readyDotLoading: {
    backgroundColor: '#F59E0B',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginTop: 8,
  },
  errorSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
