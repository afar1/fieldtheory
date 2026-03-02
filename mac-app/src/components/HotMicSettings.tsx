// =============================================================================
// HotMicSettings - Continuous voice input for Claude/Codex terminals.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';
import { buildHotkeyString, isModifierOnly } from '../utils/hotkeys';

interface IslandGeometrySettings {
  notchWidthOverride: number;
  pillWidth: number;
  pillHeight: number;
  offsetX: number;
  offsetY: number;
}

type HotMicRuntimeStatus = Awaited<
  ReturnType<NonNullable<Window['hotMicAPI']>['getRuntimeStatus']>
>;

const DEFAULT_ISLAND_GEOMETRY: IslandGeometrySettings = {
  notchWidthOverride: 0,
  pillWidth: 72,
  pillHeight: 38,
  offsetX: 0,
  offsetY: 0,
};

const ISLAND_GEOMETRY_LIMITS = {
  notchWidthOverride: { min: 0, max: 320, step: 1 },
  pillWidth: { min: 72, max: 120, step: 1 },
  pillHeight: { min: 24, max: 120, step: 1 },
  offsetX: { min: -240, max: 240, step: 1 },
  offsetY: { min: -160, max: 160, step: 1 },
} as const;
const DRAWER_TEXT_SIZE_LIMITS = { min: 11, max: 22, step: 1 } as const;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

export default function HotMicSettings() {
  const { theme } = useTheme();

  const [selectedWhisperModel, setSelectedWhisperModel] = useState('small');
  const [whisperModelReady, setWhisperModelReady] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [backgroundFilterEnabled, setBackgroundFilterEnabled] = useState(false);
  const [backgroundFilterStrength, setBackgroundFilterStrength] = useState(4);
  const [drawerTextSize, setDrawerTextSize] = useState(14);
  const [currentState, setCurrentState] = useState('idle');
  const [runtimeStatus, setRuntimeStatus] = useState<HotMicRuntimeStatus | null>(null);
  const [currentMuted, setCurrentMuted] = useState(false);
  const [hookInstalled, setHookInstalled] = useState(false);
  const [hookLoading, setHookLoading] = useState(false);
  const [submitWord, setSubmitWord] = useState('');
  const [pasteWords, setPasteWords] = useState('');
  const [cancelWords, setCancelWords] = useState('');
  const [scrapWords, setScrapWords] = useState('');
  const [modeToggleHotkey, setModeToggleHotkey] = useState('');
  const [isCapturingModeToggleHotkey, setIsCapturingModeToggleHotkey] = useState(false);
  const [modeToggleHotkeyError, setModeToggleHotkeyError] = useState<string | null>(null);
  const [switchWords, setSwitchWords] = useState('');
  const [openAppPrefixes, setOpenAppPrefixes] = useState('');
  const [quitAppPrefixes, setQuitAppPrefixes] = useState('');
  const [prevWindowWords, setPrevWindowWords] = useState('');
  const [newWindowWords, setNewWindowWords] = useState('');
  const [closeWindowWords, setCloseWindowWords] = useState('');
  const [minimizePhrases, setMinimizePhrases] = useState('');
  const [hidePhrases, setHidePhrases] = useState('');
  const [quitPhrases, setQuitPhrases] = useState('');
  const [runClaudeWords, setRunClaudeWords] = useState('');
  const [runCodexWords, setRunCodexWords] = useState('');
  const [focusPhrases, setFocusPhrases] = useState('');
  const [cascadePhrases, setCascadePhrases] = useState('');
  const [restartServerWords, setRestartServerWords] = useState('');
  const [restartServerCommand, setRestartServerCommand] = useState('');
  const [showWordCount, setShowWordCount] = useState(false);
  const [islandGeometry, setIslandGeometry] = useState<IslandGeometrySettings>(DEFAULT_ISLAND_GEOMETRY);
  const [islandGeometryExpanded, setIslandGeometryExpanded] = useState(false);

  // App voice aliases
  const [appAliases, setAppAliases] = useState<Array<{ appName: string; aliases: string }>>([]);
  const [newAliasApp, setNewAliasApp] = useState('');
  const [newAliasWords, setNewAliasWords] = useState('');

  // System commands (media, volume, sleep, lock)
  const [systemCmds, setSystemCmds] = useState<Record<string, string>>({});
  const [resettingDefaults, setResettingDefaults] = useState(false);

  const styles = getStyles(theme);
  const canEnableHotMic = whisperModelReady;
  const canToggleHotMic = enabled || canEnableHotMic;

  useEffect(() => {
    if (!window.hotMicAPI) return;

    // Check runtime availability and engine preferences
    Promise.all([
      window.transcribeAPI?.getSelectedModel?.() ?? Promise.resolve('small'),
      window.transcribeAPI?.getModelDownloadStatus?.() ?? Promise.resolve({ small: true } as Record<string, boolean>),
      window.hotMicAPI?.getStatus?.() ?? Promise.resolve({ state: 'idle', muted: false }),
    ]).then(([selectedModel, downloadStatus, hotMicStatus]) => {
      setSelectedWhisperModel(selectedModel);
      setWhisperModelReady(Boolean(downloadStatus?.[selectedModel]));
      setCurrentState(hotMicStatus.state);
      setCurrentMuted(hotMicStatus.muted);
    });

    const load = async () => {
      const [
        en,
        selectedModel,
        downloadStatus,
        bgFilterEnabled,
        bgFilterStrengthValue,
        hotMicStatus,
        hookStatus,
        submit,
        pw,
        cw,
        skw,
        hmk,
        sw,
        openPrefixes,
        quitPrefixes,
        pvw,
        nww,
        cww,
        mp,
        hp,
        qp,
        rcw,
        rcdw,
        fp,
        cp,
        rsw,
        rsc,
        wc,
        geometry,
        drawerTextSizeValue,
      ] = await Promise.all([
        window.hotMicAPI!.getEnabled(),
        window.transcribeAPI!.getSelectedModel(),
        window.transcribeAPI!.getModelDownloadStatus(),
        window.hotMicAPI!.getBackgroundFilterEnabled(),
        window.hotMicAPI!.getBackgroundFilterStrength(),
        window.hotMicAPI!.getStatus?.() ?? Promise.resolve({ state: 'idle', muted: false }),
        window.hotMicAPI!.isHookInstalled(),
        window.hotMicAPI!.getSubmitWord(),
        window.hotMicAPI!.getPasteWords(),
        window.hotMicAPI!.getCancelWords(),
        window.hotMicAPI!.getScrapWords(),
        window.hotMicAPI!.getHotkey(),
        window.hotMicAPI!.getSwitchWords(),
        window.hotMicAPI!.getOpenAppPrefixes(),
        window.hotMicAPI!.getQuitAppPrefixes(),
        window.hotMicAPI!.getPrevWindowWords(),
        window.hotMicAPI!.getNewWindowWords(),
        window.hotMicAPI!.getCloseWindowWords(),
        window.hotMicAPI!.getMinimizePhrases(),
        window.hotMicAPI!.getHidePhrases(),
        window.hotMicAPI!.getQuitPhrases(),
        window.hotMicAPI!.getRunClaudeWords(),
        window.hotMicAPI!.getRunCodexWords(),
        window.hotMicAPI!.getFocusPhrases(),
        window.hotMicAPI!.getCascadePhrases(),
        window.hotMicAPI!.getRestartServerWords(),
        window.hotMicAPI!.getRestartServerCommand(),
        window.hotMicAPI!.getShowWordCount(),
        window.hotMicAPI!.getIslandGeometry(),
        window.hotMicAPI!.getDrawerTextSize(),
      ]);
      setEnabled(en);
      setSelectedWhisperModel(selectedModel);
      setWhisperModelReady(Boolean(downloadStatus?.[selectedModel]));
      setBackgroundFilterEnabled(bgFilterEnabled);
      setBackgroundFilterStrength(Math.max(0, Math.min(100, Math.round(bgFilterStrengthValue))));
      setCurrentState(hotMicStatus.state);
      setCurrentMuted(hotMicStatus.muted);
      setHookInstalled(hookStatus);
      setSubmitWord(submit);
      setPasteWords(pw);
      setCancelWords(cw);
      setScrapWords(skw);
      setModeToggleHotkey(hmk ?? '');
      setSwitchWords(sw);
      setOpenAppPrefixes(openPrefixes);
      setQuitAppPrefixes(quitPrefixes);
      setPrevWindowWords(pvw);
      setNewWindowWords(nww);
      setCloseWindowWords(cww);
      setMinimizePhrases(mp);
      setHidePhrases(hp);
      setQuitPhrases(qp);
      setRunClaudeWords(rcw);
      setRunCodexWords(rcdw);
      setFocusPhrases(fp);
      setCascadePhrases(cp);
      setRestartServerWords(rsw);
      setRestartServerCommand(rsc);
      setShowWordCount(wc);
      setIslandGeometry(geometry ?? DEFAULT_ISLAND_GEOMETRY);
      setDrawerTextSize(clampInt(
        drawerTextSizeValue,
        DRAWER_TEXT_SIZE_LIMITS.min,
        DRAWER_TEXT_SIZE_LIMITS.max
      ));

      // Load system commands
      window.hotMicAPI!.getSystemCommands().then(cmds => {
        setSystemCmds(cmds || {});
      });

      // Load app voice aliases
      window.clipboardAPI?.getAppVoiceAliases?.().then(aliases => {
        setAppAliases(aliases || []);
      });
    };

    load();

    // Fetch initial runtime status.
    window.hotMicAPI!.getRuntimeStatus?.().then((status) => {
      if (status) setRuntimeStatus(status);
    });

    const unsub = window.hotMicAPI!.onStateChanged((state) => {
      setCurrentState(state);
    });
    const unsubStatus = window.hotMicAPI!.onStatusChanged?.((status) => {
      setCurrentState(status.state);
      setCurrentMuted(status.muted);
    }) ?? (() => {});
    const unsubInputMode = window.hotMicAPI!.onInputModeChanged?.((mode) => {
      setEnabled(mode === 'hot-mic');
    }) ?? (() => {});

    const unsubRuntime = window.hotMicAPI!.onRuntimeStatusChanged?.((status) => {
      setRuntimeStatus(status);
    });

    return () => {
      unsub();
      unsubStatus();
      unsubInputMode();
      unsubRuntime?.();
    };
  }, []);

  const handleEnabledChange = useCallback(async (value: boolean) => {
    if (!window.hotMicAPI) return;
    setEnabled(value);
    await window.hotMicAPI.setEnabled(value);
  }, []);

  const handleBackgroundFilterEnabledChange = useCallback(async (value: boolean) => {
    if (!window.hotMicAPI) return;
    setBackgroundFilterEnabled(value);
    await window.hotMicAPI.setBackgroundFilterEnabled(value);
  }, []);

  const handleBackgroundFilterStrengthChange = useCallback(async (value: number) => {
    if (!window.hotMicAPI) return;
    const normalized = Math.max(0, Math.min(100, Math.round(value)));
    setBackgroundFilterStrength(normalized);
    const saved = await window.hotMicAPI.setBackgroundFilterStrength(normalized);
    setBackgroundFilterStrength(Math.max(0, Math.min(100, Math.round(saved))));
  }, []);

  const handleDrawerTextSizeChange = useCallback(async (value: number) => {
    if (!window.hotMicAPI?.setDrawerTextSize) return;
    const normalized = clampInt(value, DRAWER_TEXT_SIZE_LIMITS.min, DRAWER_TEXT_SIZE_LIMITS.max);
    setDrawerTextSize(normalized);
    const saved = await window.hotMicAPI.setDrawerTextSize(normalized);
    setDrawerTextSize(clampInt(saved, DRAWER_TEXT_SIZE_LIMITS.min, DRAWER_TEXT_SIZE_LIMITS.max));
  }, []);

  const handleIslandGeometryChange = useCallback((
    key: keyof IslandGeometrySettings,
    value: number
  ) => {
    const limits = ISLAND_GEOMETRY_LIMITS[key];
    const normalized = clampInt(value, limits.min, limits.max);
    setIslandGeometry((prev) => ({ ...prev, [key]: normalized }));
    void window.hotMicAPI?.setIslandGeometry({ [key]: normalized });
  }, []);

  const handleResetIslandGeometry = useCallback(async () => {
    if (!window.hotMicAPI) return;
    const reset = await window.hotMicAPI.resetIslandGeometry();
    setIslandGeometry(reset ?? DEFAULT_ISLAND_GEOMETRY);
  }, []);

  const handleSubmitWordSave = useCallback(async () => {
    if (!window.hotMicAPI || !submitWord.trim()) return;
    await window.hotMicAPI.setSubmitWord(submitWord.trim());
  }, [submitWord]);

  const handlePasteWordsSave = useCallback(async () => {
    if (!window.hotMicAPI || !pasteWords.trim()) return;
    await window.hotMicAPI.setPasteWords(pasteWords.trim());
  }, [pasteWords]);

  const handleCancelWordsSave = useCallback(async () => {
    if (!window.hotMicAPI || !cancelWords.trim()) return;
    await window.hotMicAPI.setCancelWords(cancelWords.trim());
  }, [cancelWords]);

  const handleScrapWordsSave = useCallback(async () => {
    if (!window.hotMicAPI || !scrapWords.trim()) return;
    await window.hotMicAPI.setScrapWords(scrapWords.trim());
  }, [scrapWords]);

  const handleSetModeToggleHotkey = useCallback(async (newHotkey: string | null) => {
    if (!window.hotMicAPI) return;
    setIsCapturingModeToggleHotkey(false);
    setModeToggleHotkeyError(null);

    const normalized = (newHotkey ?? '').trim();
    const success = await window.hotMicAPI.setHotkey(normalized.length > 0 ? normalized : null);
    if (!success) {
      const current = await window.hotMicAPI.getHotkey();
      setModeToggleHotkey(current ?? '');
      setModeToggleHotkeyError('Failed to register hotkey. It may be in use by another application.');
      return;
    }
    const saved = await window.hotMicAPI.getHotkey();
    setModeToggleHotkey(saved ?? '');
  }, []);

  const handleStartCaptureModeToggleHotkey = useCallback(() => {
    setIsCapturingModeToggleHotkey(true);
    setModeToggleHotkeyError(null);
  }, []);

  useEffect(() => {
    if (!isCapturingModeToggleHotkey) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const hotkeyString = buildHotkeyString(event);
      if (!hotkeyString || isModifierOnly(hotkeyString)) {
        setModeToggleHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
        return;
      }
      void handleSetModeToggleHotkey(hotkeyString);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCapturingModeToggleHotkey, handleSetModeToggleHotkey]);

  const handlePrevWindowWordsSave = useCallback(async () => {
    if (!window.hotMicAPI || !prevWindowWords.trim()) return;
    await window.hotMicAPI.setPrevWindowWords(prevWindowWords.trim());
  }, [prevWindowWords]);

  const handleNewWindowWordsSave = useCallback(async () => {
    if (!window.hotMicAPI || !newWindowWords.trim()) return;
    await window.hotMicAPI.setNewWindowWords(newWindowWords.trim());
  }, [newWindowWords]);

  const handleCloseWindowWordsSave = useCallback(async () => {
    if (!window.hotMicAPI || !closeWindowWords.trim()) return;
    await window.hotMicAPI.setCloseWindowWords(closeWindowWords.trim());
  }, [closeWindowWords]);

  const handleMinimizePhrasesSave = useCallback(async () => {
    if (!window.hotMicAPI || !minimizePhrases.trim()) return;
    await window.hotMicAPI.setMinimizePhrases(minimizePhrases.trim());
  }, [minimizePhrases]);

  const handleHidePhrasesSave = useCallback(async () => {
    if (!window.hotMicAPI || !hidePhrases.trim()) return;
    await window.hotMicAPI.setHidePhrases(hidePhrases.trim());
  }, [hidePhrases]);

  const handleQuitPhrasesSave = useCallback(async () => {
    if (!window.hotMicAPI || !quitPhrases.trim()) return;
    await window.hotMicAPI.setQuitPhrases(quitPhrases.trim());
  }, [quitPhrases]);

  const handleRunClaudeWordsSave = useCallback(async () => {
    if (!window.hotMicAPI || !runClaudeWords.trim()) return;
    await window.hotMicAPI.setRunClaudeWords(runClaudeWords.trim());
  }, [runClaudeWords]);

  const handleRunCodexWordsSave = useCallback(async () => {
    if (!window.hotMicAPI || !runCodexWords.trim()) return;
    await window.hotMicAPI.setRunCodexWords(runCodexWords.trim());
  }, [runCodexWords]);

  const handleFocusPhrasesSave = useCallback(async () => {
    if (!window.hotMicAPI || !focusPhrases.trim()) return;
    await window.hotMicAPI.setFocusPhrases(focusPhrases.trim());
  }, [focusPhrases]);

  const handleCascadePhrasesSave = useCallback(async () => {
    if (!window.hotMicAPI || !cascadePhrases.trim()) return;
    await window.hotMicAPI.setCascadePhrases(cascadePhrases.trim());
  }, [cascadePhrases]);

  const handleRestartServerWordsSave = useCallback(async () => {
    if (!window.hotMicAPI || !restartServerWords.trim()) return;
    await window.hotMicAPI.setRestartServerWords(restartServerWords.trim());
  }, [restartServerWords]);

  const handleRestartServerCommandSave = useCallback(async () => {
    if (!window.hotMicAPI) return;
    await window.hotMicAPI.setRestartServerCommand(restartServerCommand.trim());
  }, [restartServerCommand]);

  const handleSwitchWordsSave = useCallback(async () => {
    if (!window.hotMicAPI || !switchWords.trim()) return;
    await window.hotMicAPI.setSwitchWords(switchWords.trim());
  }, [switchWords]);

  const handleOpenAppPrefixesSave = useCallback(async () => {
    if (!window.hotMicAPI || !openAppPrefixes.trim()) return;
    await window.hotMicAPI.setOpenAppPrefixes(openAppPrefixes.trim());
  }, [openAppPrefixes]);

  const handleQuitAppPrefixesSave = useCallback(async () => {
    if (!window.hotMicAPI || !quitAppPrefixes.trim()) return;
    await window.hotMicAPI.setQuitAppPrefixes(quitAppPrefixes.trim());
  }, [quitAppPrefixes]);

  const handleStop = useCallback(async () => {
    if (!window.hotMicAPI) return;
    await window.hotMicAPI.stop();
  }, []);

  const handleToggleHook = useCallback(async () => {
    if (!window.hotMicAPI) return;
    setHookLoading(true);
    try {
      if (hookInstalled) {
        const result = await window.hotMicAPI.uninstallHook();
        if (result.success) setHookInstalled(false);
      } else {
        const result = await window.hotMicAPI.installHook();
        if (result.success) setHookInstalled(true);
      }
    } finally {
      setHookLoading(false);
    }
  }, [hookInstalled]);

  const handleSystemCmdSave = useCallback(async (action: string) => {
    const phrases = systemCmds[action];
    if (phrases !== undefined) {
      await window.hotMicAPI?.setSystemCommand(action, phrases.trim());
    }
  }, [systemCmds]);

  const handleResetDefaults = useCallback(async () => {
    if (!window.hotMicAPI || resettingDefaults) return;
    setResettingDefaults(true);
    try {
      await window.hotMicAPI.resetCommandDefaults();
      const [submit, pw, cw, skw, sw, openPrefixes, quitPrefixes, pvw, nww, cww, mp, hp, qp, rcw, rcdw, fp, cp, rsw, rsc, wc, cmds] = await Promise.all([
        window.hotMicAPI.getSubmitWord(),
        window.hotMicAPI.getPasteWords(),
        window.hotMicAPI.getCancelWords(),
        window.hotMicAPI.getScrapWords(),
        window.hotMicAPI.getSwitchWords(),
        window.hotMicAPI.getOpenAppPrefixes(),
        window.hotMicAPI.getQuitAppPrefixes(),
        window.hotMicAPI.getPrevWindowWords(),
        window.hotMicAPI.getNewWindowWords(),
        window.hotMicAPI.getCloseWindowWords(),
        window.hotMicAPI.getMinimizePhrases(),
        window.hotMicAPI.getHidePhrases(),
        window.hotMicAPI.getQuitPhrases(),
        window.hotMicAPI.getRunClaudeWords(),
        window.hotMicAPI.getRunCodexWords(),
        window.hotMicAPI.getFocusPhrases(),
        window.hotMicAPI.getCascadePhrases(),
        window.hotMicAPI.getRestartServerWords(),
        window.hotMicAPI.getRestartServerCommand(),
        window.hotMicAPI.getShowWordCount(),
        window.hotMicAPI.getSystemCommands(),
      ]);

      setSubmitWord(submit);
      setPasteWords(pw);
      setCancelWords(cw);
      setScrapWords(skw);
      setSwitchWords(sw);
      setOpenAppPrefixes(openPrefixes);
      setQuitAppPrefixes(quitPrefixes);
      setPrevWindowWords(pvw);
      setNewWindowWords(nww);
      setCloseWindowWords(cww);
      setMinimizePhrases(mp);
      setHidePhrases(hp);
      setQuitPhrases(qp);
      setRunClaudeWords(rcw);
      setRunCodexWords(rcdw);
      setFocusPhrases(fp);
      setCascadePhrases(cp);
      setRestartServerWords(rsw);
      setRestartServerCommand(rsc);
      setShowWordCount(wc);
      setSystemCmds(cmds || {});
    } finally {
      setResettingDefaults(false);
    }
  }, [resettingDefaults]);

  const handleAddAppAlias = useCallback(async () => {
    if (!newAliasApp.trim() || !newAliasWords.trim()) return;
    const updated = [...appAliases, { appName: newAliasApp.trim(), aliases: newAliasWords.trim() }];
    try {
      const success = await window.clipboardAPI?.setAppVoiceAliases?.(updated);
      if (success) {
        setAppAliases(updated);
        setNewAliasApp('');
        setNewAliasWords('');
      }
    } catch (err) {
      console.error('Failed to add app alias:', err);
    }
  }, [appAliases, newAliasApp, newAliasWords]);

  const handleRemoveAppAlias = useCallback(async (index: number) => {
    const updated = appAliases.filter((_, i) => i !== index);
    try {
      const success = await window.clipboardAPI?.setAppVoiceAliases?.(updated);
      if (success) {
        setAppAliases(updated);
      }
    } catch (err) {
      console.error('Failed to remove app alias:', err);
    }
  }, [appAliases]);

  const displayState = currentState !== 'idle' && currentMuted ? 'muted' : currentState;
  const isActive = currentState !== 'idle';

  const handleBrowseAliasApp = useCallback(async () => {
    const appName = await window.clipboardAPI?.browseForApp?.();
    if (appName) {
      setNewAliasApp(appName);
    }
  }, []);

  return (
    <div style={styles.container}>
      {/* Enable toggle */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Enable Hot Mic</span>
        <button
          onClick={() => canToggleHotMic && handleEnabledChange(!enabled)}
          style={{
            ...styles.toggle,
            backgroundColor: enabled ? theme.success : '#d1d5db',
            opacity: canToggleHotMic ? 1 : 0.5,
            cursor: canToggleHotMic ? 'pointer' : 'not-allowed',
          }}
        >
          <span style={{ ...styles.toggleKnob, transform: enabled ? 'translateX(20px)' : 'translateX(2px)' }} />
        </button>
      </div>

      <div style={styles.row}>
        <span style={styles.rowLabel}>Mode Toggle Hotkey</span>
        <div style={styles.rowControls}>
          {isCapturingModeToggleHotkey ? (
            <>
              <button style={{ ...styles.btn, ...styles.btnActive }}>Press keys...</button>
              <button
                onClick={() => {
                  setIsCapturingModeToggleHotkey(false);
                  setModeToggleHotkeyError(null);
                }}
                style={styles.btnGhost}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {modeToggleHotkey && (
                <button
                  onClick={() => void handleSetModeToggleHotkey(null)}
                  style={styles.btnGhost}
                >
                  Clear
                </button>
              )}
              <button
                onClick={handleStartCaptureModeToggleHotkey}
                style={styles.btn}
              >
                {modeToggleHotkey || 'Not set'}
              </button>
            </>
          )}
        </div>
      </div>
      <p style={styles.description}>
        Toggles between hot mic and standard mode.
      </p>
      {modeToggleHotkeyError && <p style={styles.hotkeyError}>{modeToggleHotkeyError}</p>}

      <div style={styles.row}>
        <span style={styles.rowLabel}>Whisper Model</span>
        <span style={{ fontSize: '12px', color: whisperModelReady ? theme.textSecondary : '#ef4444' }}>
          {selectedWhisperModel}
          {whisperModelReady ? '' : ' (not downloaded)'}
        </span>
      </div>
      {whisperModelReady ? (
        <p style={styles.description}>
          Hot Mic follows Voice & Transcription and uses Whisper only.
        </p>
      ) : (
        <p style={{ ...styles.description, color: theme.textSecondary }}>
          Whisper model is missing or incomplete. Download it in Voice & Transcription settings.
        </p>
      )}

      <div style={styles.divider} />

      {/* Background voice filter */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Background Voice Filter</span>
        <button
          onClick={() => handleBackgroundFilterEnabledChange(!backgroundFilterEnabled)}
          style={{ ...styles.toggle, backgroundColor: backgroundFilterEnabled ? theme.success : '#d1d5db' }}
        >
          <span style={{ ...styles.toggleKnob, transform: backgroundFilterEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
        </button>
      </div>
      <div style={{ padding: '4px 0' }}>
        <div style={styles.rangeHeader}>
          <span style={styles.rangeLabel}>Strictness</span>
          <span style={styles.rangeValue}>{backgroundFilterStrength}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={backgroundFilterStrength}
          onChange={(e) => void handleBackgroundFilterStrengthChange(Number(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={{ ...styles.description, marginTop: 6 }}>
          Higher values reject more far-field speech. Set to 0 or disable if your voice is being filtered out.
        </p>
      </div>

      <div style={styles.divider} />

      <div style={{ padding: '4px 0' }}>
        <div style={styles.rangeHeader}>
          <span style={styles.rangeLabel}>Drawer Transcript Text Size</span>
          <span style={styles.rangeValue}>{drawerTextSize}px</span>
        </div>
        <input
          type="range"
          min={DRAWER_TEXT_SIZE_LIMITS.min}
          max={DRAWER_TEXT_SIZE_LIMITS.max}
          step={DRAWER_TEXT_SIZE_LIMITS.step}
          value={drawerTextSize}
          onChange={(e) => void handleDrawerTextSizeChange(Number(e.target.value))}
          style={styles.rangeInput}
        />
        <p style={{ ...styles.description, marginTop: 6 }}>
          Adjust only the live drawer transcript size. The drawer stays fixed and text remains single-line.
        </p>
      </div>

      <div style={styles.divider} />

      {/* Dynamic Island geometry tuning */}
      <div style={{ padding: '4px 0' }}>
        <button
          onClick={() => setIslandGeometryExpanded((prev) => !prev)}
          style={styles.sectionToggle}
          aria-expanded={islandGeometryExpanded}
        >
          <span style={styles.rowLabel}>Dynamic Island Geometry</span>
          <span style={styles.sectionToggleIndicator}>
            {islandGeometryExpanded ? 'Hide' : 'Show'}
          </span>
        </button>
        <p style={styles.description}>
          Tune notch hugging live. Changes apply immediately.
        </p>
      </div>
      {islandGeometryExpanded && (
        <>
          {([
            {
              key: 'notchWidthOverride',
              label: 'Notch Width',
              help: '0 = auto profile',
            },
            {
              key: 'pillWidth',
              label: 'Pill Width',
              help: '',
            },
            {
              key: 'pillHeight',
              label: 'Pill Height',
              help: '',
            },
            {
              key: 'offsetX',
              label: 'Horizontal Offset',
              help: '',
            },
            {
              key: 'offsetY',
              label: 'Vertical Offset',
              help: '',
            },
          ] as Array<{ key: keyof IslandGeometrySettings; label: string; help: string }>).map(({ key, label, help }) => (
            <div key={key} style={{ padding: '4px 0' }}>
              <div style={styles.rangeHeader}>
                <span style={styles.rangeLabel}>{label}</span>
                <span style={styles.rangeValue}>
                  {islandGeometry[key]}
                  {help ? ` (${help})` : ''}
                </span>
              </div>
              <input
                type="range"
                min={ISLAND_GEOMETRY_LIMITS[key].min}
                max={ISLAND_GEOMETRY_LIMITS[key].max}
                step={ISLAND_GEOMETRY_LIMITS[key].step}
                value={islandGeometry[key]}
                onChange={(e) => handleIslandGeometryChange(key, Number(e.target.value))}
                style={styles.rangeInput}
              />
            </div>
          ))}
          <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-start' }}>
            <button
              onClick={() => void handleResetIslandGeometry()}
              style={{
                ...styles.hookButton,
                backgroundColor: theme.surface0,
                color: theme.text,
                border: `1px solid ${theme.border}`,
              }}
            >
              Reset Island Geometry
            </button>
          </div>
        </>
      )}

      <div style={styles.divider} />

      {/* Submit */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Submit</span>
        <input
          type="text"
          value={submitWord}
          onChange={(e) => setSubmitWord(e.target.value)}
          placeholder="go ahead, send it, submit, do it"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleSubmitWordSave}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmitWordSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* Paste */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Paste</span>
        <input
          type="text"
          value={pasteWords}
          onChange={(e) => setPasteWords(e.target.value)}
          placeholder="paste, paste it, transcribe"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handlePasteWordsSave}
          onKeyDown={(e) => e.key === 'Enter' && handlePasteWordsSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* Scrap draft */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Scrap Draft</span>
        <input
          type="text"
          value={scrapWords}
          onChange={(e) => setScrapWords(e.target.value)}
          placeholder="scrap, scrap that"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleScrapWordsSave}
          onKeyDown={(e) => e.key === 'Enter' && handleScrapWordsSave()}
        />
      </div>

      <div style={styles.divider} />

      {/* Cancel */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Cancel</span>
        <input
          type="text"
          value={cancelWords}
          onChange={(e) => setCancelWords(e.target.value)}
          placeholder="stop, abort"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleCancelWordsSave}
          onKeyDown={(e) => e.key === 'Enter' && handleCancelWordsSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* Switch window */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Switch Window</span>
        <input
          type="text"
          value={switchWords}
          onChange={(e) => setSwitchWords(e.target.value)}
          placeholder="next window, switch"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleSwitchWordsSave}
          onKeyDown={(e) => e.key === 'Enter' && handleSwitchWordsSave()}
        />
      </div>

      <div style={styles.divider} />

      {/* App open prefixes */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Open App Prefixes</span>
        <input
          type="text"
          value={openAppPrefixes}
          onChange={(e) => setOpenAppPrefixes(e.target.value)}
          placeholder="open, switch to, go to"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleOpenAppPrefixesSave}
          onKeyDown={(e) => e.key === 'Enter' && handleOpenAppPrefixesSave()}
        />
      </div>

      <div style={styles.divider} />

      {/* App quit prefixes */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Quit App Prefixes</span>
        <input
          type="text"
          value={quitAppPrefixes}
          onChange={(e) => setQuitAppPrefixes(e.target.value)}
          placeholder="quit, close, kill"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleQuitAppPrefixesSave}
          onKeyDown={(e) => e.key === 'Enter' && handleQuitAppPrefixesSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* Previous window */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Previous Window</span>
        <input
          type="text"
          value={prevWindowWords}
          onChange={(e) => setPrevWindowWords(e.target.value)}
          placeholder="previous window"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handlePrevWindowWordsSave}
          onKeyDown={(e) => e.key === 'Enter' && handlePrevWindowWordsSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* New window */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>New Window</span>
        <input
          type="text"
          value={newWindowWords}
          onChange={(e) => setNewWindowWords(e.target.value)}
          placeholder="new window"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleNewWindowWordsSave}
          onKeyDown={(e) => e.key === 'Enter' && handleNewWindowWordsSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* Close window */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Close Window</span>
        <input
          type="text"
          value={closeWindowWords}
          onChange={(e) => setCloseWindowWords(e.target.value)}
          placeholder="close window, close the window, close this window"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleCloseWindowWordsSave}
          onKeyDown={(e) => e.key === 'Enter' && handleCloseWindowWordsSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* Minimize */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Minimize</span>
        <input
          type="text"
          value={minimizePhrases}
          onChange={(e) => setMinimizePhrases(e.target.value)}
          placeholder="minimize, minimize window, minimize the window"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleMinimizePhrasesSave}
          onKeyDown={(e) => e.key === 'Enter' && handleMinimizePhrasesSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* Hide app */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Hide App</span>
        <input
          type="text"
          value={hidePhrases}
          onChange={(e) => setHidePhrases(e.target.value)}
          placeholder="hide, hide app, hide this app, hide the app"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleHidePhrasesSave}
          onKeyDown={(e) => e.key === 'Enter' && handleHidePhrasesSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* Quit */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Quit</span>
        <input
          type="text"
          value={quitPhrases}
          onChange={(e) => setQuitPhrases(e.target.value)}
          placeholder="quit app, quit this app"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleQuitPhrasesSave}
          onKeyDown={(e) => e.key === 'Enter' && handleQuitPhrasesSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* Focus (next-display + center) */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Focus</span>
        <input
          type="text"
          value={focusPhrases}
          onChange={(e) => setFocusPhrases(e.target.value)}
          placeholder="focus"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleFocusPhrasesSave}
          onKeyDown={(e) => e.key === 'Enter' && handleFocusPhrasesSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* Cascade (cascade-active-app + center) */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Cascade</span>
        <input
          type="text"
          value={cascadePhrases}
          onChange={(e) => setCascadePhrases(e.target.value)}
          placeholder="cascade, spread out"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleCascadePhrasesSave}
          onKeyDown={(e) => e.key === 'Enter' && handleCascadePhrasesSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* Run Claude */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Run Claude</span>
        <input
          type="text"
          value={runClaudeWords}
          onChange={(e) => setRunClaudeWords(e.target.value)}
          placeholder="start claude, start cloud, run claude, start clod"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleRunClaudeWordsSave}
          onKeyDown={(e) => e.key === 'Enter' && handleRunClaudeWordsSave()}
        />
      </div>


      <div style={styles.divider} />

      {/* Run Codex */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Run Codex</span>
        <input
          type="text"
          value={runCodexWords}
          onChange={(e) => setRunCodexWords(e.target.value)}
          placeholder="start codex, run codex"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleRunCodexWordsSave}
          onKeyDown={(e) => e.key === 'Enter' && handleRunCodexWordsSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* Restart server */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Restart Server</span>
        <input
          type="text"
          value={restartServerWords}
          onChange={(e) => setRestartServerWords(e.target.value)}
          placeholder="restart server, restart dev, restart dev server"
          style={{ ...styles.input, marginTop: '6px', width: '100%' }}
          onBlur={handleRestartServerWordsSave}
          onKeyDown={(e) => e.key === 'Enter' && handleRestartServerWordsSave()}
        />
      </div>
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>Restart Server Command</span>
        <input
          type="text"
          value={restartServerCommand}
          onChange={(e) => setRestartServerCommand(e.target.value)}
          placeholder="npm run dev"
          style={{ ...styles.input, marginTop: '6px', width: '100%', fontFamily: 'monospace' }}
          onBlur={handleRestartServerCommandSave}
          onKeyDown={(e) => e.key === 'Enter' && handleRestartServerCommandSave()}
        />
      </div>



      <div style={styles.divider} />

      {/* System Commands */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>System Commands</span>
      </div>
      {[
        { action: 'play-pause', label: 'Play / Pause' },
        { action: 'next-track', label: 'Next Track' },
        { action: 'previous-track', label: 'Previous Track' },
        { action: 'volume-up', label: 'Volume Up' },
        { action: 'volume-down', label: 'Volume Down' },
        { action: 'mute', label: 'Mute' },
        { action: 'unmute', label: 'Unmute' },
        { action: 'lock', label: 'Lock Screen' },
        { action: 'sleep', label: 'Sleep' },
      ].map(({ action, label }) => (
        <div key={action} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0' }}>
          <span style={{ fontSize: '12px', color: theme.text, minWidth: '100px', flexShrink: 0 }}>{label}</span>
          <input
            type="text"
            value={systemCmds[action] ?? ''}
            onChange={(e) => setSystemCmds(prev => ({ ...prev, [action]: e.target.value }))}
            style={{ ...styles.input, fontFamily: 'monospace' }}
            onBlur={() => handleSystemCmdSave(action)}
            onKeyDown={(e) => e.key === 'Enter' && handleSystemCmdSave(action)}
          />
        </div>
      ))}

      <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-start' }}>
        <button
          onClick={handleResetDefaults}
          disabled={resettingDefaults}
          style={{
            ...styles.hookButton,
            backgroundColor: theme.surface0,
            color: theme.text,
            border: `1px solid ${theme.border}`,
            opacity: resettingDefaults ? 0.6 : 1,
            cursor: resettingDefaults ? 'default' : 'pointer',
          }}
        >
          {resettingDefaults ? 'Resetting...' : 'Reset Voice Defaults'}
        </button>
      </div>

      <div style={styles.divider} />

      {/* App Voice Aliases */}
      <div style={{ padding: '4px 0' }}>
        <span style={styles.rowLabel}>App Voice Aliases</span>
        <p style={styles.description}>
          Say "open &lt;app&gt;" to switch/launch an app. Example: app "Ghostty" with aliases
          "ghosty, ghost tea" lets you say "open ghosty". Prefix words come from Open App Prefixes.
        </p>
      </div>

      {appAliases.length > 0 && (
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {appAliases.map((alias, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '6px',
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${theme.border}`,
              }}
            >
              <span style={{ fontSize: '12px', color: theme.text, fontWeight: 500, minWidth: '80px' }}>
                {alias.appName}
              </span>
              <span style={{ color: theme.textSecondary, fontSize: '12px' }}>:</span>
              <span style={{ flex: 1, fontSize: '12px', color: theme.textSecondary, fontFamily: 'monospace' }}>
                {alias.aliases}
              </span>
              <button
                onClick={() => handleRemoveAppAlias(index)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: theme.textSecondary,
                  cursor: 'pointer',
                  padding: '4px',
                  fontSize: '14px',
                  lineHeight: 1,
                }}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
        <button
          onClick={() => { void handleBrowseAliasApp(); }}
          style={{
            ...styles.select,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            flex: 0,
            minWidth: '140px',
            textAlign: 'left',
          }}
          title="Select app"
        >
          {newAliasApp || 'Select app...'}
        </button>
        <input
          type="text"
          value={newAliasWords}
          onChange={(e) => setNewAliasWords(e.target.value)}
          placeholder="ghosty, ghost, terminal"
          style={{ ...styles.input, fontFamily: 'monospace' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newAliasApp && newAliasWords.trim()) handleAddAppAlias();
          }}
        />
        <button
          onClick={handleAddAppAlias}
          disabled={!newAliasApp || !newAliasWords.trim()}
          style={{
            fontSize: '12px',
            padding: '4px 12px',
            borderRadius: '6px',
            border: `1px solid ${theme.border}`,
            backgroundColor: theme.surface0,
            color: theme.text,
            cursor: !newAliasApp || !newAliasWords.trim() ? 'default' : 'pointer',
            opacity: !newAliasApp || !newAliasWords.trim() ? 0.5 : 1,
            minWidth: '50px',
          }}
        >
          Add
        </button>
      </div>

      {appAliases.length === 0 && (
        <p style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '6px', fontStyle: 'italic' }}>
          Example: Ghostty → "ghosty, ghost tea, ghost"
        </p>
      )}

      <div style={styles.divider} />

      {/* Current state */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Status</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ ...styles.stateBadge, backgroundColor: getStateColor(displayState) }}>
            {displayState}
          </span>
          {runtimeStatus?.condition && (
            <span style={{ ...styles.stateBadge, backgroundColor: getConditionColor(runtimeStatus.condition), fontSize: '10px' }}>
              {runtimeStatus.condition}
            </span>
          )}
          {isActive ? (
            <button onClick={handleStop} style={styles.stopButton}>Stop</button>
          ) : (
            <button
              onClick={async () => { if (window.hotMicAPI) await window.hotMicAPI.start(); }}
              style={{ ...styles.hookButton, backgroundColor: theme.success, color: '#fff' }}
            >
              Start
            </button>
          )}
        </div>
      </div>

      {/* Runtime health — only shown when active */}
      {isActive && runtimeStatus && (
        <div style={{ ...styles.row, flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
          <span style={{ ...styles.rowLabel, marginBottom: '2px' }}>Health</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '11px', color: theme.textSecondary }}>
            <span>engine: {runtimeStatus.engineReady ? 'ready' : 'loading'}</span>
            {runtimeStatus.engine && (
              <span>
                profile: {formatEngineLabel(runtimeStatus.engine.selectedEngine)} ({runtimeStatus.engine.readiness})
              </span>
            )}
            <span>queue: {runtimeStatus.queueDepth}</span>
            <span>chunks: {runtimeStatus.chunksReceived}</span>
            {runtimeStatus.whisperFallbackActive && (
              <span style={{ color: '#f59e0b' }}>whisper fallback</span>
            )}
            <span style={{ color: runtimeStatus.micHealthy ? '#10b981' : '#ef4444' }}>
              mic: {runtimeStatus.micHealthy ? 'healthy' : 'stale'}
            </span>
            {runtimeStatus.engine?.detail && (
              <span style={{ color: '#f59e0b' }}>{runtimeStatus.engine.detail}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getConditionColor(condition: string): string {
  switch (condition) {
    case 'warming': return '#f59e0b';
    case 'ready': return '#10b981';
    case 'degraded': return '#ef4444';
    case 'yielded': return '#3b82f6';
    case 'muted': return '#6b7280';
    default: return '#6b7280';
  }
}

function formatEngineLabel(engine: 'whisper' | 'qwen' | 'mlx-whisper'): string {
  if (engine === 'mlx-whisper') return 'MLX Whisper (large-v3-turbo)';
  if (engine === 'qwen') return 'Qwen3-ASR';
  return 'Whisper';
}

function getStateColor(state: string): string {
  switch (state) {
    case 'armed': return '#3b82f6';
    case 'listening': return '#10b981';
    case 'muted': return '#f59e0b';
    case 'recording': return '#ef4444';
    default: return '#6b7280';
  }
}

const getStyles = (theme: Theme): Record<string, React.CSSProperties> => ({
  container: {
    padding: 0,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 0',
    minHeight: '32px',
  },
  rowLabel: {
    fontSize: '12px',
    color: theme.text,
    fontWeight: 400,
  },
  rowControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  btn: {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '80px',
    textAlign: 'center' as const,
  },
  btnActive: {
    backgroundColor: theme.info,
    color: '#fff',
    borderColor: theme.info,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.textSecondary,
    minWidth: 'auto',
    padding: '6px 8px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  hotkeyError: {
    fontSize: '11px',
    color: theme.error,
    margin: '4px 0 0 0',
    lineHeight: 1.35,
  },
  sectionToggle: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
  },
  sectionToggleIndicator: {
    fontSize: '11px',
    color: theme.textSecondary,
  },
  toggle: {
    position: 'relative' as const,
    width: '44px',
    minWidth: '44px',
    height: '24px',
    minHeight: '24px',
    borderRadius: '12px',
    cursor: 'pointer',
    border: 'none',
    padding: 0,
    flexShrink: 0,
    transition: 'background-color 0.2s',
  },
  toggleKnob: {
    position: 'absolute' as const,
    top: '2px',
    left: 0,
    width: '20px',
    height: '20px',
    borderRadius: '10px',
    backgroundColor: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.2s',
  },
  divider: {
    height: '1px',
    backgroundColor: theme.border,
    margin: '12px 0',
  },
  description: {
    fontSize: '11px',
    color: theme.textSecondary,
    margin: '4px 0 0 0',
    lineHeight: 1.4,
  },
  select: {
    fontSize: '12px',
    padding: '4px 8px',
    borderRadius: '6px',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface0,
    color: theme.text,
    cursor: 'pointer',
    minWidth: '140px',
  },
  input: {
    fontSize: '12px',
    padding: '4px 8px',
    borderRadius: '6px',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface0,
    color: theme.text,
    flex: 1,
  },
  rangeHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  rangeLabel: {
    fontSize: '11px',
    color: theme.textSecondary,
  },
  rangeValue: {
    fontSize: '11px',
    color: theme.text,
    fontVariantNumeric: 'tabular-nums',
  },
  rangeInput: {
    width: '100%',
    accentColor: theme.success,
  },
  stateBadge: {
    fontSize: '10px',
    color: '#fff',
    padding: '2px 8px',
    borderRadius: '10px',
    fontWeight: 500,
    textTransform: 'uppercase' as const,
  },
  stopButton: {
    fontSize: '11px',
    padding: '2px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface0,
    color: '#ef4444',
    cursor: 'pointer',
  },
  hookButton: {
    fontSize: '11px',
    padding: '4px 14px',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 500,
    flexShrink: 0,
  },
});
