import React, { useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';

// Status bar height for modern iPhones with notch/Dynamic Island.
// This pushes the nav bar below the status bar area.
const STATUS_BAR_HEIGHT = Platform.OS === 'ios' ? 54 : 0;

// Cursor's agent dashboard URL.
// This is the web interface where users can interact with Cursor's AI.
const CURSOR_AGENT_URL = 'https://www.cursor.com/agent';

// Ref handle exposed to parent components.
// Lets the parent paste text into the Cursor input and focus the browser.
export interface CursorBrowserHandle {
  pasteText: (text: string) => void;
  reload: () => void;
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
 * 
 * The WebView uses the default cache/cookie storage which persists between sessions,
 * so users stay logged in as long as Cursor's session cookies are valid.
 */
export const CursorBrowser = forwardRef<CursorBrowserHandle, CursorBrowserProps>(
  function CursorBrowser({ onReady, onError }, ref) {
    const webViewRef = useRef<WebView>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [canGoBack, setCanGoBack] = useState(false);
    const [canGoForward, setCanGoForward] = useState(false);
    const [currentUrl, setCurrentUrl] = useState(CURSOR_AGENT_URL);
    const [hasError, setHasError] = useState(false);

    // Expose methods to parent component via ref.
    useImperativeHandle(ref, () => ({
      /**
       * Paste text into Cursor's chat input field.
       * This uses JavaScript injection to find the input and set its value.
       */
      pasteText: (text: string) => {
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
              input.focus();
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
              } 
              // For contenteditable divs
              else if (input.contentEditable === 'true') {
                // Use execCommand for contenteditable (works better with frameworks)
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, '${escapedText}');
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
      },

      reload: () => {
        setHasError(false);
        webViewRef.current?.reload();
      },
    }));

    // Handle navigation state changes to update back/forward buttons.
    const handleNavigationStateChange = useCallback((navState: any) => {
      setCanGoBack(navState.canGoBack);
      setCanGoForward(navState.canGoForward);
      setCurrentUrl(navState.url || CURSOR_AGENT_URL);
    }, []);

    // Handle page load complete.
    const handleLoadEnd = useCallback(() => {
      setIsLoading(false);
      setHasError(false);
      onReady?.();
    }, [onReady]);

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
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: STATUS_BAR_HEIGHT,
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
