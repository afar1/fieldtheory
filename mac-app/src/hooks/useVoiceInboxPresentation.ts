import { useEffect, useState } from 'react';
import type { VoiceInboxPresentation } from '../../electron/shared/voiceInboxPresentation';

/** One bounded metadata read on activation and change events; no transcript polling. */
export function useVoiceInboxPresentation(active: boolean): VoiceInboxPresentation | null {
  const [presentation, setPresentation] = useState<VoiceInboxPresentation | null>(null);
  useEffect(() => {
    const api = window.voiceWorkAPI;
    if (!active || !api?.getInboxPresentation) {
      setPresentation(null);
      return;
    }
    let disposed = false;
    let revision = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      const request = ++revision;
      void api.getInboxPresentation().then((next) => {
        if (!disposed && request === revision) setPresentation(next);
      }).catch(() => {
        if (!disposed && request === revision) setPresentation(null);
      });
    };
    const schedule = () => {
      ++revision; // An older in-flight read must not overwrite a newer event.
      clearTimeout(timer);
      timer = setTimeout(refresh, 80);
    };
    const reset = () => {
      setPresentation(null);
      schedule();
    };
    const unsubscribers = [
      api.onInboxChanged?.(schedule),
      api.onStateChanged?.((state) => {
        if (state.status === 'signed_out') reset();
        else schedule();
      }),
      window.authAPI?.onSessionChanged?.(reset),
      window.libraryAPI?.onRootsChanged?.(schedule),
      window.wikiAPI?.onPageChanged?.(schedule),
    ];
    refresh();
    return () => {
      disposed = true;
      ++revision;
      clearTimeout(timer);
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [active]);
  return presentation;
}
