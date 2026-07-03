#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const args = new Set(process.argv.slice(2));
const markdown = args.has('--markdown');
const runChecks = args.has('--run-checks');
const runLiveBenchmark = args.has('--run-live-benchmark');
const runExternalBenchmark = args.has('--run-external-benchmark');
const runBrowserBenchmark = args.has('--run-browser-benchmark');
const runCommandBenchmark = args.has('--run-command-benchmark');
const runLauncherBenchmark = args.has('--run-launcher-benchmark');
const runLauncherNormalBenchmark = args.has('--run-launcher-normal-focus-benchmark');
const runImmersiveBenchmark = args.has('--run-immersive-benchmark');
const runRecordingBenchmark = args.has('--run-recording-benchmark');
const runRecordingAsrBenchmark = args.has('--run-recording-asr-benchmark');
const runRecordingAsrDeliveryBenchmark = args.has('--run-recording-asr-delivery-benchmark');
const strict = args.has('--strict');
const benchmarkRuns = parseBenchmarkRuns(process.argv.slice(2));
const qualityTier = parseQualityTier(process.argv.slice(2));
const RECENT_EDITOR_WINDOW_MS = 10 * 60 * 1000;
const QUALITY_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-benchmark=';
const QUALITY_EXTERNAL_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-external-benchmark=';
const QUALITY_BROWSER_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-browser-benchmark=';
const QUALITY_COMMAND_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-command-benchmark=';
const QUALITY_LAUNCHER_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-launcher-benchmark=';
const QUALITY_LAUNCHER_NORMAL_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-launcher-normal-focus-benchmark=';
const QUALITY_IMMERSIVE_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-immersive-benchmark=';
const QUALITY_RECORDING_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-recording-benchmark=';
const QUALITY_RECORDING_ASR_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-recording-asr-benchmark=';
const QUALITY_RECORDING_ASR_DELIVERY_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-recording-asr-delivery-benchmark=';
const QUALITY_IMMERSIVE_WIKI_REL_PATH = 'scratchpad/Quality Benchmark Immersive Surface';

const appSupportDir = process.env.FIELD_THEORY_STARTUP_BENCH_USER_DATA_DIR?.trim()
  ? path.resolve(process.env.FIELD_THEORY_STARTUP_BENCH_USER_DATA_DIR.trim())
  : path.join(os.homedir(), 'Library', 'Application Support', 'Field Theory');
const repoRoot = process.cwd();
const paths = {
  launcherTrace: path.join(appSupportDir, 'command-launcher-trace.log'),
  recordingTrace: path.join(appSupportDir, 'recording-trace.log'),
  renderedEditorDebug: path.join(repoRoot, '.logs', 'rendered-editor-debug.jsonl'),
  scrollDiagnostics: path.join(repoRoot, '.logs', 'scroll-diagnostics.jsonl'),
};

const budgets = {
  launcherHotkeyToVisibleP95Ms: 120,
  launcherHotkeyToHiddenP95Ms: 2500,
  launcherFirstInputToResultsP95Ms: 80,
  launcherFirstInputToCloseP95Ms: 2000,
  launcherInvokeToSuccessP95Ms: 1500,
  launcherBenchmarkInvokeToSuccessP95Ms: 50,
  launcherBenchmarkDeliveryP95Ms: 250,
  launcherExternalDeliveryP95Ms: 1500,
  launcherBrowserDeliveryP95Ms: 1800,
  launcherCommandDeliveryP95Ms: 1500,
  launcherCommandOpenTextEditP95Ms: 1500,
  launcherBrowserOpenTextareaP95Ms: 2500,
  launcherCommandPasteDeliveryPhaseP95Ms: 1500,
  launcherCommandNativeHelperP95Ms: 1000,
  launcherCommandVerifyDeliveryP95Ms: 1000,
  launcherFilterP95Ms: 8,
  launcherLoadDataP95Ms: 150,
  clipboardResultsP95Ms: 150,
  scrollDiagnosticsMinFps: 55,
  scrollDiagnosticsLongestFrameMaxMs: 50,
  renderedLinkedDocsP95Ms: 16,
  renderedLinkedDocsMaxMs: 50,
  recordingFinishP95Ms: 1500,
  recordingPasteP95Ms: 500,
  recordingAsrFixtureP95Ms: 15000,
  recordingAsrDeliveryP95Ms: 20000,
  recordingAsrFixtureMinChars: 20,
};

function parseBenchmarkRuns(argv) {
  const arg = argv.find(item => item.startsWith('--benchmark-runs='));
  const value = Number.parseInt(arg?.slice('--benchmark-runs='.length) ?? '1', 10);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(20, value));
}

function parseQualityTier(argv) {
  const arg = argv.find(item => item.startsWith('--quality-tier='));
  const value = arg?.slice('--quality-tier='.length).trim();
  return ['local', 'pr', 'nightly'].includes(value) ? value : 'local';
}

const qualityTierMinimumRuns = {
  local: 1,
  pr: 3,
  nightly: 20,
};

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function percentile(values, p) {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const index = Math.min(nums.length - 1, Math.max(0, Math.ceil((p / 100) * nums.length) - 1));
  return round(nums[index]);
}

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 10) / 10;
}

function summarize(values) {
  const nums = values.filter(Number.isFinite);
  return {
    n: nums.length,
    min: percentile(nums, 0),
    p50: percentile(nums, 50),
    p95: percentile(nums, 95),
    p99: percentile(nums, 99),
    max: percentile(nums, 100),
  };
}

function parseTraceLog(filePath) {
  const rows = [];
  for (const line of readText(filePath).trim().split(/\n/)) {
    if (!line) continue;
    const match = line.match(/^(\S+)\s+(\S+)(?:\s+(\{.*\}))?$/);
    if (!match) continue;
    let data = {};
    if (match[3]) {
      try {
        data = JSON.parse(match[3]);
      } catch {
        data = {};
      }
    }
    const timestamp = new Date(match[1]);
    if (Number.isNaN(timestamp.getTime())) continue;
    rows.push({ timestamp, event: match[2], data });
  }
  return rows;
}

function parseJsonl(filePath) {
  const rows = [];
  for (const line of readText(filePath).trim().split(/\n/)) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && 'entry' in parsed) {
        const entry = parsed.entry && typeof parsed.entry === 'object' ? parsed.entry : { value: parsed.entry };
        rows.push({
          ...entry,
          receivedAt: typeof parsed.receivedAt === 'number' ? parsed.receivedAt : entry.receivedAt,
        });
      } else {
        rows.push(parsed);
      }
    } catch {
      // Ignore malformed diagnostic lines.
    }
  }
  return rows;
}

function elapsedSummary(rows, eventName, field = 'elapsedMs') {
  return summarize(rows
    .filter((row) => row.event === eventName)
    .map((row) => Number(row.data?.[field])));
}

function msBetween(start, end) {
  if (!start || !end) return null;
  return end.timestamp.getTime() - start.timestamp.getTime();
}

function groupLauncherSessions(rows) {
  const groups = new Map();
  const invocationSuccessEvents = new Set([
    'invoke-command-success',
    'invoke-command-integrated-terminal-success',
    'invoke-command-field-theory-markdown-success',
  ]);
  for (const row of rows) {
    const id = row.data?.launcherSessionId;
    if (typeof id !== 'string' || !id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return [...groups.entries()].map(([launcherSessionId, sessionRows]) => {
    const first = (eventName) => sessionRows.find((row) => row.event === eventName);
    const firstAfter = (eventName, startRow) => sessionRows.find((row) => (
      row.event === eventName && (!startRow || row.timestamp >= startRow.timestamp)
    ));
    const hotkey = first('hotkey-trigger');
    const visible = first('show-complete') ?? first('hotkey-show-complete');
    const reset = first('renderer-launcher-reset');
    const firstInput = first('renderer-first-input');
    const firstResults = firstAfter('renderer-filter-results', firstInput);
    const closeRequest = first('renderer-close-request');
    const hidden = firstAfter('hide', hotkey) ?? firstAfter('hide-skip-activation', hotkey) ?? closeRequest;
    const closedAfterInput = firstAfter('renderer-close-request', firstInput)
      ?? firstAfter('hide', firstInput)
      ?? firstAfter('hide-skip-activation', firstInput);
    const invokeItem = first('renderer-invoke-item');
    const invokeStart = first('invoke-command-start');
    const invokeSuccess = sessionRows.find((row) => invocationSuccessEvents.has(row.event));
    const invokeError = first('invoke-command-error') ?? first('invoke-command-renderer-error');
    const benchmark = sessionRows.some((row) => row.data?.benchmark === true);
    const benchmarkId = sessionRows.find((row) => typeof row.data?.benchmarkId === 'string')?.data?.benchmarkId ?? null;
    const benchmarkDelivery = sessionRows.find((row) => (
      row.event === 'invoke-command-benchmark-delivery-success'
      && (
        row.data?.delivery === 'controlled-electron-textarea'
        || row.data?.delivery === 'controlled-textedit'
        || row.data?.delivery === 'controlled-safari-textarea'
        || row.data?.delivery === 'command-textedit'
      )
    ));
    return {
      launcherSessionId,
      benchmark,
      benchmarkId,
      qualityScenario: sessionRows.find((row) => typeof row.data?.qualityScenario === 'string')?.data?.qualityScenario ?? null,
      controlledBenchmark: benchmark && sessionRows.some((row) => row.data?.delivery === 'controlled-electron-textarea'),
      externalBenchmark: benchmark && sessionRows.some((row) => row.data?.delivery === 'controlled-textedit'),
      browserBenchmark: benchmark && sessionRows.some((row) => row.data?.delivery === 'controlled-safari-textarea'),
      commandBenchmark: benchmark && sessionRows.some((row) => row.data?.delivery === 'command-textedit'),
      launcherBenchmark: benchmark && sessionRows.some((row) => row.data?.delivery === 'launcher-interaction-focus-protected' || row.data?.delivery === 'launcher-interaction'),
      launcherNormalBenchmark: benchmark && sessionRows.some((row) => row.data?.delivery === 'launcher-interaction-normal'),
      startedAt: sessionRows[0]?.timestamp?.toISOString() ?? null,
      rowCount: sessionRows.length,
      hasHotkey: Boolean(hotkey),
      hasFirstInput: Boolean(firstInput),
      hasInvocation: Boolean(invokeItem || invokeStart),
      completedInvocation: Boolean(invokeSuccess),
      failedInvocation: Boolean(invokeError),
      verifiedDelivery: Boolean(invokeSuccess?.data?.deliveryVerified === true || benchmarkDelivery),
      hotkeyToVisibleMs: msBetween(hotkey, visible),
      hotkeyToHiddenMs: msBetween(hotkey, hidden),
      hotkeyToRendererResetMs: msBetween(hotkey, reset),
      firstInputToResultsMs: Number.isFinite(Number(firstResults?.data?.firstInputToResultsMs))
        ? Number(firstResults.data.firstInputToResultsMs)
        : msBetween(firstInput, firstResults),
      firstInputToCloseMs: msBetween(firstInput, closedAfterInput),
      rendererInvokeToMainStartMs: msBetween(invokeItem, invokeStart),
      rendererInvokeToSuccessMs: benchmark && Number.isFinite(Number(invokeSuccess?.data?.elapsedMs))
        ? Number(invokeSuccess?.data?.elapsedMs)
        : msBetween(invokeItem, invokeSuccess),
      benchmarkDeliveryMs: benchmark && Number.isFinite(Number(benchmarkDelivery?.data?.deliveryElapsedMs))
        ? Number(benchmarkDelivery?.data?.deliveryElapsedMs)
        : null,
      hotkeyToInvokeSuccessMs: msBetween(hotkey, invokeSuccess),
    };
  });
}

function fieldSummary(rows, predicate, fieldSelector) {
  return summarize(rows
    .filter(predicate)
    .map(fieldSelector)
    .map(Number));
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    const key = value === null || value === undefined || value === '' ? 'unknown' : String(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function scenarioCounts(rows) {
  return countBy(rows.map((row) => row.data?.qualityScenario));
}

function diagnosticTimestampMs(row) {
  const value = Number(row.timestamp ?? row.receivedAt);
  if (!Number.isFinite(value)) return null;
  if (value > 1_000_000_000_000) return value;
  const receivedAt = Number(row.receivedAt);
  return Number.isFinite(receivedAt) ? receivedAt : value;
}

function isRecentDiagnostic(row, nowMs = Date.now()) {
  const timestampMs = diagnosticTimestampMs(row);
  return timestampMs !== null && timestampMs >= nowMs - RECENT_EDITOR_WINDOW_MS && timestampMs <= nowMs + 1000;
}

function commandResult(command, commandArgs, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs,
    killSignal: 'SIGKILL',
  });
  return {
    command: [command, ...commandArgs].join(' '),
    status: result.status,
    ok: result.status === 0,
    durationMs: Date.now() - startedAt,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  };
}

function appendRunTrace(runUserDataDir, traceName) {
  const source = path.join(runUserDataDir, traceName);
  const text = readText(source);
  if (!text) return;
  fs.mkdirSync(appSupportDir, { recursive: true });
  fs.appendFileSync(path.join(appSupportDir, traceName), text.endsWith('\n') ? text : `${text}\n`);
}

function prepareImmersiveFixtureLibrary(runUserDataDir) {
  const libraryDir = path.join(runUserDataDir, 'quality-library');
  const fixturePath = path.join(libraryDir, `${QUALITY_IMMERSIVE_WIKI_REL_PATH}.md`);
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  const paragraphs = Array.from({ length: 36 }, (_, index) => (
    `Quality benchmark paragraph ${index + 1}. This document gives the renderer enough real markdown to scroll, edit, and measure without touching the user's library.`
  ));
  fs.writeFileSync(fixturePath, [
    '# Quality Benchmark Immersive Surface',
    '',
    ...paragraphs.flatMap(paragraph => [paragraph, '']),
  ].join('\n'), 'utf8');
  return { libraryDir, relPath: QUALITY_IMMERSIVE_WIKI_REL_PATH };
}

function runBenchmarkCommand(kind = 'controlled') {
  const benchmarkId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const argPrefix = kind === 'command'
    ? QUALITY_COMMAND_BENCHMARK_ARG_PREFIX
    : kind === 'browser'
    ? QUALITY_BROWSER_BENCHMARK_ARG_PREFIX
    : kind === 'launcher-normal'
    ? QUALITY_LAUNCHER_NORMAL_BENCHMARK_ARG_PREFIX
    : kind === 'immersive'
    ? QUALITY_IMMERSIVE_BENCHMARK_ARG_PREFIX
    : kind === 'recording-asr-delivery'
    ? QUALITY_RECORDING_ASR_DELIVERY_BENCHMARK_ARG_PREFIX
    : kind === 'recording-asr'
    ? QUALITY_RECORDING_ASR_BENCHMARK_ARG_PREFIX
    : kind === 'recording'
    ? QUALITY_RECORDING_BENCHMARK_ARG_PREFIX
    : kind === 'launcher'
    ? QUALITY_LAUNCHER_BENCHMARK_ARG_PREFIX
    : kind === 'external'
    ? QUALITY_EXTERNAL_BENCHMARK_ARG_PREFIX
    : QUALITY_BENCHMARK_ARG_PREFIX;
  const electronBin = path.join(repoRoot, 'node_modules', '.bin', 'electron');
  const timeoutMs = kind === 'recording-asr' || kind === 'recording-asr-delivery' ? 30000 : 12000;
  const runUserDataDir = path.join(appSupportDir, 'quality-benchmark-runs', benchmarkId);
  fs.rmSync(runUserDataDir, { recursive: true, force: true });
  const immersiveFixture = kind === 'immersive'
    ? prepareImmersiveFixtureLibrary(runUserDataDir)
    : null;
  const result = {
    ...commandResult(electronBin, ['.', '-ApplePersistenceIgnoreState', 'YES', `${argPrefix}${benchmarkId}`], {
      timeoutMs,
      env: {
        ...process.env,
        FIELD_THEORY_STARTUP_BENCH_USER_DATA_DIR: runUserDataDir,
        ...(immersiveFixture ? {
          FT_LIBRARY_DIR: immersiveFixture.libraryDir,
          FIELD_THEORY_QUALITY_IMMERSIVE_WIKI_REL_PATH: immersiveFixture.relPath,
        } : {}),
      },
    }),
    command: kind === 'command'
      ? 'live launcher command delivery benchmark'
      : kind === 'browser'
      ? 'live launcher browser textarea delivery benchmark'
      : kind === 'launcher-normal'
      ? 'live launcher normal focus benchmark'
      : kind === 'immersive'
      ? 'live immersive surface benchmark'
      : kind === 'recording-asr-delivery'
      ? 'live recording ASR delivery benchmark'
      : kind === 'recording-asr'
      ? 'live recording ASR fixture benchmark'
      : kind === 'recording'
      ? 'live recording delivery benchmark'
      : kind === 'launcher'
      ? 'live launcher interaction benchmark'
      : kind === 'external'
      ? 'live launcher external delivery benchmark'
      : 'live launcher quality benchmark',
    benchmarkId,
    kind,
    runUserDataDir,
  };
  appendRunTrace(runUserDataDir, 'command-launcher-trace.log');
  appendRunTrace(runUserDataDir, 'recording-trace.log');
  return result;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function hasBenchmarkTrace(benchmarkId) {
  const launcherHasTrace = parseTraceLog(paths.launcherTrace).some((row) => (
    (
      row.data?.benchmarkId === benchmarkId
      && (
      (
        row.event === 'invoke-command-success'
        && row.data?.deliveryVerified === true
      )
      || row.event === 'invoke-command-benchmark-delivery-success'
      || row.event === 'launcher-interaction-benchmark-success'
      || row.event === 'immersive-surface-benchmark-success'
      )
    )
    || (
      row.event === 'renderer-filter-results'
      && row.data?.launcherSessionId === `benchmark-${benchmarkId}`
    )
  ));
  if (launcherHasTrace) return true;
  return parseTraceLog(paths.recordingTrace).some((row) => (
    row.data?.benchmarkId === benchmarkId
    && (
      row.event === 'finish.done'
      || row.event === 'benchmark.delivery-success'
      || row.event === 'benchmark.asr-success'
      || row.event === 'benchmark.asr-error'
      || row.event === 'benchmark.asr-delivery-success'
      || row.event === 'benchmark.asr-delivery-error'
    )
  ));
}

function waitForBenchmarkTrace(benchmarkId, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasBenchmarkTrace(benchmarkId)) return true;
    sleepMs(50);
  }
  return hasBenchmarkTrace(benchmarkId);
}

function getBenchmarkSession(benchmarkId) {
  return groupLauncherSessions(parseTraceLog(paths.launcherTrace))
    .find((session) => session.benchmarkId === benchmarkId) ?? null;
}

function getRecordingBenchmarkRows(benchmarkId) {
  return parseTraceLog(paths.recordingTrace)
    .filter((row) => row.data?.benchmarkId === benchmarkId);
}

function verifyBenchmarkResult(result) {
  if (!waitForBenchmarkTrace(result.benchmarkId)) {
    return `No verified ${result.kind} benchmark delivery trace was recorded.`;
  }
  if (result.kind === 'recording') {
    const rows = getRecordingBenchmarkRows(result.benchmarkId);
    const done = rows.find((row) => row.event === 'finish.done');
    const delivery = rows.find((row) => row.event === 'benchmark.delivery-success');
    const error = rows.find((row) => /error/i.test(row.event));
    if (error) return `Recording benchmark recorded ${error.event}.`;
    if (!done) return 'Recording benchmark did not record finish.done.';
    if (!delivery) return 'Recording benchmark did not verify delivered text.';
    return null;
  }
  if (result.kind === 'recording-asr') {
    const rows = getRecordingBenchmarkRows(result.benchmarkId);
    const success = rows.find((row) => row.event === 'benchmark.asr-success');
    const error = rows.find((row) => row.event === 'benchmark.asr-error');
    if (error) return `Recording ASR benchmark recorded ${error.event}.`;
    if (!success) return 'Recording ASR benchmark did not record benchmark.asr-success.';
    if (Number(success.data?.textChars) < budgets.recordingAsrFixtureMinChars) {
      return `Recording ASR benchmark returned only ${success.data?.textChars ?? 0} characters.`;
    }
    return null;
  }
  if (result.kind === 'recording-asr-delivery') {
    const rows = getRecordingBenchmarkRows(result.benchmarkId);
    const done = rows.find((row) => row.event === 'finish.done');
    const success = rows.find((row) => row.event === 'benchmark.asr-delivery-success');
    const error = rows.find((row) => row.event === 'benchmark.asr-delivery-error');
    if (error) return `Recording ASR delivery benchmark recorded ${error.event}.`;
    if (!done) return 'Recording ASR delivery benchmark did not record finish.done.';
    if (!success) return 'Recording ASR delivery benchmark did not verify delivered text.';
    if (Number(success.data?.textChars) < budgets.recordingAsrFixtureMinChars) {
      return `Recording ASR delivery benchmark returned only ${success.data?.textChars ?? 0} characters.`;
    }
    return null;
  }
  const session = getBenchmarkSession(result.benchmarkId);
  if (!session) {
    return `No grouped ${result.kind} benchmark session was recorded.`;
  }
  if (result.kind === 'immersive') {
    const rows = parseJsonl(paths.scrollDiagnostics)
      .filter((row) => row.benchmarkId === result.benchmarkId);
    const syntheticRows = rows.filter((row) => String(row.qualityScenario ?? '').startsWith('synthetic-'));
    if (syntheticRows.length) {
      return 'Immersive benchmark recorded synthetic rows; strict immersive evidence must be renderer-driven.';
    }
    const rendererRows = rows.filter((row) => row.qualityScenario === 'renderer-driven-immersive-surface');
    if (rendererRows.length === 0) {
      return 'Immersive benchmark did not record renderer-driven quality rows.';
    }
    const sources = new Set(rows.map((row) => row.source));
    for (const source of ['markdown', 'rendered', 'launcher-input', 'markdown-editor-input', 'rendered-editor-input']) {
      if (!sources.has(source)) return `Immersive benchmark did not record ${source}.`;
    }
    const renderedScroll = rendererRows.find((row) => row.kind === 'scroll' && row.source === 'rendered');
    const markdownScroll = rendererRows.find((row) => row.kind === 'scroll' && row.source === 'markdown');
    const renderedInput = rendererRows.find((row) => row.kind === 'interaction' && row.source === 'rendered-editor-input');
    const markdownInput = rendererRows.find((row) => row.kind === 'interaction' && row.source === 'markdown-editor-input');
    if ((!renderedScroll?.targetFound || Number(renderedScroll.scrollDelta) === 0) && !(Number(renderedScroll?.fps) > 0)) {
      return 'Immersive benchmark did not move the rendered scroll surface.';
    }
    if ((!markdownScroll?.targetFound || Number(markdownScroll.scrollDelta) === 0) && !(Number(markdownScroll?.fps) > 0)) {
      return 'Immersive benchmark did not move the markdown scroll surface.';
    }
    if (!renderedInput?.targetFound || !(Number(renderedInput.fps) > 0)) {
      return 'Immersive benchmark did not record rendered editor interaction.';
    }
    if (!markdownInput?.targetFound || Number(markdownInput.inputDelta) === 0) {
      return 'Immersive benchmark did not mutate the markdown editor input.';
    }
    return null;
  }
  if (result.kind === 'launcher' || result.kind === 'launcher-normal') {
    if (!session.hasHotkey) return 'Launcher benchmark did not record a hotkey trigger.';
    if (!session.hotkeyToVisibleMs && session.hotkeyToVisibleMs !== 0) return 'Launcher benchmark did not record window visibility.';
    if (!session.hasFirstInput) return 'Launcher benchmark did not record renderer input.';
    if (!session.firstInputToResultsMs && session.firstInputToResultsMs !== 0) return 'Launcher benchmark did not record renderer results after input.';
    if (!session.firstInputToCloseMs && session.firstInputToCloseMs !== 0) return 'Launcher benchmark did not record close after input.';
    return null;
  }
  if (!session.verifiedDelivery) return `${result.kind} benchmark did not verify delivered text.`;
  if (!session.benchmarkDeliveryMs && session.benchmarkDeliveryMs !== 0) return `${result.kind} benchmark did not record delivery latency.`;
  return null;
}

function tail(value, max = 2000) {
  const text = value || '';
  return text.length > max ? text.slice(text.length - max) : text;
}

function statusFor(summary, budgetKey, direction = 'under') {
  const budget = budgets[budgetKey];
  if (!summary || summary.n === 0 || summary.p95 === null || budget === undefined) return 'unknown';
  if (direction === 'under') return summary.p95 <= budget ? 'pass' : 'risk';
  return summary.p95 >= budget ? 'pass' : 'risk';
}

const launcherRows = parseTraceLog(paths.launcherTrace);
const recordingRows = parseTraceLog(paths.recordingTrace);
const editorRows = parseJsonl(paths.renderedEditorDebug);
const scrollRows = parseJsonl(paths.scrollDiagnostics);
const selectedBenchmarkKinds = [
  ...(runLiveBenchmark ? ['controlled'] : []),
  ...(runExternalBenchmark ? ['external'] : []),
  ...(runBrowserBenchmark ? ['browser'] : []),
  ...(runCommandBenchmark ? ['command'] : []),
  ...(runLauncherBenchmark ? ['launcher'] : []),
  ...(runLauncherNormalBenchmark ? ['launcher-normal'] : []),
  ...(runImmersiveBenchmark ? ['immersive'] : []),
  ...(runRecordingBenchmark ? ['recording'] : []),
  ...(runRecordingAsrBenchmark ? ['recording-asr'] : []),
  ...(runRecordingAsrDeliveryBenchmark ? ['recording-asr-delivery'] : []),
];
const benchmarkResults = [];
for (const kind of selectedBenchmarkKinds) {
  for (let runIndex = 0; runIndex < benchmarkRuns; runIndex += 1) {
    const result = runBenchmarkCommand(kind);
    if (benchmarkRuns > 1) {
      result.command = `${result.command} ${runIndex + 1}/${benchmarkRuns}`;
    }
    const verificationError = verifyBenchmarkResult(result);
    if (verificationError) {
      result.ok = false;
      result.status = result.status === 0 ? 1 : result.status;
      result.stderrTail = [
        result.stderrTail,
        verificationError,
      ].filter(Boolean).join('\n');
    } else if (!result.ok) {
      result.ok = true;
      result.status = 0;
      result.stderrTail = [
        result.stderrTail,
        'Process did not exit cleanly, but the requested benchmark trace was verified.',
      ].filter(Boolean).join('\n');
    }
    benchmarkResults.push(result);
  }
}
const launcherRowsForReport = benchmarkResults.length ? parseTraceLog(paths.launcherTrace) : launcherRows;
const recordingRowsForReport = benchmarkResults.length ? parseTraceLog(paths.recordingTrace) : recordingRows;
const scrollRowsForReport = benchmarkResults.length ? parseJsonl(paths.scrollDiagnostics) : scrollRows;
const launcherSessions = groupLauncherSessions(launcherRowsForReport);
const currentBenchmarkIds = new Set(benchmarkResults
  .filter((result) => result.kind !== 'recording' && result.kind !== 'recording-asr' && result.kind !== 'recording-asr-delivery')
  .map((result) => result.benchmarkId));
const currentRecordingBenchmarkIds = new Set(benchmarkResults
  .filter((result) => result.kind === 'recording' || result.kind === 'recording-asr' || result.kind === 'recording-asr-delivery')
  .map((result) => result.benchmarkId));
const currentBenchmarkSessions = currentBenchmarkIds.size
  ? launcherSessions.filter((session) => currentBenchmarkIds.has(session.benchmarkId))
  : [];
const currentBenchmarkSessionIds = new Set(currentBenchmarkSessions.map((session) => session.launcherSessionId));
const launcherRowsForCurrentMetrics = currentBenchmarkIds.size
  ? launcherRowsForReport.filter((row) => currentBenchmarkSessionIds.has(row.data?.launcherSessionId))
  : launcherRowsForReport;
const recordingRowsForCurrentMetrics = currentRecordingBenchmarkIds.size
  ? recordingRowsForReport.filter((row) => currentRecordingBenchmarkIds.has(row.data?.benchmarkId))
  : recordingRowsForReport;
const launcherSessionsForCurrentMetrics = currentBenchmarkIds.size ? currentBenchmarkSessions : launcherSessions;
const launcherSessionsForBenchmarkMetrics = currentBenchmarkIds.size ? currentBenchmarkSessions : launcherSessions;
const launcherBenchmarkResults = benchmarkResults.filter((result) => result.kind !== 'recording' && result.kind !== 'recording-asr' && result.kind !== 'recording-asr-delivery');
if (launcherBenchmarkResults.length && currentBenchmarkSessions.length === 0) {
  for (const result of launcherBenchmarkResults) {
    result.ok = false;
    result.status = result.status === 0 ? 1 : result.status;
    result.stderrTail = [
      result.stderrTail,
    'No new launcher benchmark invocation trace was recorded. The running app may be stale or unavailable.',
    ].filter(Boolean).join('\n');
  }
}

const launcher = {
  tracePath: paths.launcherTrace,
  rowCount: launcherRowsForReport.length,
  qualityScenarios: scenarioCounts(launcherRowsForCurrentMetrics),
  lastEventAt: launcherRowsForReport.at(-1)?.timestamp?.toISOString() ?? null,
  loadLauncherData: elapsedSummary(launcherRowsForCurrentMetrics, 'renderer-load-launcher-data'),
  loadCommands: elapsedSummary(launcherRowsForCurrentMetrics, 'renderer-load-commands'),
  loadRecents: elapsedSummary(launcherRowsForCurrentMetrics, 'renderer-load-recents'),
  filterResults: elapsedSummary(launcherRowsForCurrentMetrics, 'renderer-filter-results'),
  warmSearchCache: elapsedSummary(launcherRowsForCurrentMetrics, 'renderer-warm-search-cache'),
  warmSearchCacheChunk: elapsedSummary(launcherRowsForCurrentMetrics, 'renderer-warm-search-cache-chunk'),
  loadClipboardResults: elapsedSummary(launcherRowsForCurrentMetrics, 'renderer-load-clipboard-results'),
  commandPhases: {
    openTextEditDocument: fieldSummary(
      launcherRowsForCurrentMetrics,
      (row) => row.event === 'invoke-command-benchmark-phase' && row.data?.phase === 'open-textedit-document',
      (row) => row.data?.elapsedMs,
    ),
    openSafariTextarea: fieldSummary(
      launcherRowsForCurrentMetrics,
      (row) => row.event === 'invoke-command-benchmark-phase' && row.data?.phase === 'open-safari-textarea',
      (row) => row.data?.elapsedMs,
    ),
    clipboardWrite: fieldSummary(
      launcherRowsForCurrentMetrics,
      (row) => row.event === 'invoke-command-benchmark-phase' && row.data?.phase === 'clipboard-write',
      (row) => row.data?.elapsedMs,
    ),
    pasteDelivery: fieldSummary(
      launcherRowsForCurrentMetrics,
      (row) => row.event === 'invoke-command-benchmark-phase' && String(row.data?.phase ?? '').startsWith('paste-delivery'),
      (row) => row.data?.elapsedMs,
    ),
    verifyTextEditDelivery: fieldSummary(
      launcherRowsForCurrentMetrics,
      (row) => row.event === 'invoke-command-benchmark-phase' && String(row.data?.phase ?? '').startsWith('verify-textedit-delivery'),
      (row) => row.data?.elapsedMs,
    ),
    nativeActivate: fieldSummary(
      launcherRowsForCurrentMetrics,
      (row) => row.event === 'invoke-command-native-type-phase',
      (row) => row.data?.activateMs,
    ),
    nativeHide: fieldSummary(
      launcherRowsForCurrentMetrics,
      (row) => row.event === 'invoke-command-native-type-phase',
      (row) => row.data?.hideMs,
    ),
    nativeHelper: fieldSummary(
      launcherRowsForCurrentMetrics,
      (row) => row.event === 'invoke-command-native-type-phase',
      (row) => row.data?.nativeMs,
    ),
    nativeTotal: fieldSummary(
      launcherRowsForCurrentMetrics,
      (row) => row.event === 'invoke-command-native-type-phase',
      (row) => row.data?.totalMs,
    ),
  },
  sessions: {
    count: launcherSessions.length,
    currentBenchmarkCount: currentBenchmarkSessions.length,
    completedInvocations: launcherSessions.filter((session) => session.completedInvocation).length,
    failedInvocations: launcherSessions.filter((session) => session.failedInvocation).length,
    benchmarkInvocations: launcherSessionsForBenchmarkMetrics.filter((session) => session.controlledBenchmark && session.hasInvocation).length,
    benchmarkDeliveries: launcherSessionsForBenchmarkMetrics.filter((session) => session.controlledBenchmark && session.verifiedDelivery).length,
    externalBenchmarkInvocations: launcherSessionsForBenchmarkMetrics.filter((session) => session.externalBenchmark && session.hasInvocation).length,
    externalBenchmarkDeliveries: launcherSessionsForBenchmarkMetrics.filter((session) => session.externalBenchmark && session.verifiedDelivery).length,
    browserBenchmarkInvocations: launcherSessionsForBenchmarkMetrics.filter((session) => session.browserBenchmark && session.hasInvocation).length,
    browserBenchmarkDeliveries: launcherSessionsForBenchmarkMetrics.filter((session) => session.browserBenchmark && session.verifiedDelivery).length,
    commandBenchmarkInvocations: launcherSessionsForBenchmarkMetrics.filter((session) => session.commandBenchmark && session.hasInvocation).length,
    commandBenchmarkDeliveries: launcherSessionsForBenchmarkMetrics.filter((session) => session.commandBenchmark && session.verifiedDelivery).length,
    launcherBenchmarkSessions: launcherSessionsForBenchmarkMetrics.filter((session) => session.launcherBenchmark).length,
    launcherNormalBenchmarkSessions: launcherSessionsForBenchmarkMetrics.filter((session) => session.launcherNormalBenchmark).length,
    hotkeyToVisible: summarize(launcherSessionsForCurrentMetrics.map((session) => session.hotkeyToVisibleMs)),
    hotkeyToHidden: summarize(launcherSessionsForCurrentMetrics.map((session) => session.hotkeyToHiddenMs)),
    hotkeyToRendererReset: summarize(launcherSessionsForCurrentMetrics.map((session) => session.hotkeyToRendererResetMs)),
    firstInputToResults: summarize(launcherSessionsForCurrentMetrics.map((session) => session.firstInputToResultsMs)),
    firstInputToClose: summarize(launcherSessionsForCurrentMetrics.map((session) => session.firstInputToCloseMs)),
    rendererInvokeToMainStart: summarize(launcherSessionsForCurrentMetrics.map((session) => session.rendererInvokeToMainStartMs)),
    rendererInvokeToSuccess: summarize(launcherSessions.filter((session) => !session.benchmark).map((session) => session.rendererInvokeToSuccessMs)),
    benchmarkInvokeToSuccess: summarize(launcherSessionsForBenchmarkMetrics.filter((session) => session.controlledBenchmark).map((session) => session.rendererInvokeToSuccessMs)),
    benchmarkDelivery: summarize(launcherSessionsForBenchmarkMetrics.filter((session) => session.controlledBenchmark).map((session) => session.benchmarkDeliveryMs)),
    externalBenchmarkDelivery: summarize(launcherSessionsForBenchmarkMetrics.filter((session) => session.externalBenchmark).map((session) => session.benchmarkDeliveryMs)),
    browserBenchmarkDelivery: summarize(launcherSessionsForBenchmarkMetrics.filter((session) => session.browserBenchmark).map((session) => session.benchmarkDeliveryMs)),
    commandBenchmarkDelivery: summarize(launcherSessionsForBenchmarkMetrics.filter((session) => session.commandBenchmark).map((session) => session.benchmarkDeliveryMs)),
    hotkeyToInvokeSuccess: summarize(launcherSessions.map((session) => session.hotkeyToInvokeSuccessMs)),
    recent: launcherSessions.slice(-5),
  },
};

const recording = {
  tracePath: paths.recordingTrace,
  rowCount: recordingRowsForReport.length,
  qualityScenarios: scenarioCounts(recordingRowsForCurrentMetrics),
  currentBenchmarkCount: currentRecordingBenchmarkIds.size,
  lastEventAt: recordingRowsForReport.at(-1)?.timestamp?.toISOString() ?? null,
  finishDone: fieldSummary(
    recordingRowsForCurrentMetrics,
    (row) => row.event === 'finish.done',
    (row) => row.data?.totalMs ?? row.data?.elapsedMs,
  ),
  paste: fieldSummary(
    recordingRowsForCurrentMetrics,
    (row) => row.event === 'finish.done' || row.event === 'finish.prep',
    (row) => row.data?.pasteMs,
  ),
  asr: fieldSummary(
    recordingRowsForCurrentMetrics,
    (row) => (
      row.event === 'benchmark.asr-success'
      || (
        row.event === 'finish.done'
        && Number(row.data?.asrMs ?? row.data?.transcribeMs) > 0
      )
    ),
    (row) => row.data?.asrMs ?? row.data?.transcribeMs,
  ),
  asrDeliveryFinish: fieldSummary(
    recordingRowsForCurrentMetrics,
    (row) => row.event === 'benchmark.asr-delivery-success',
    (row) => row.data?.totalMs,
  ),
  asrDeliveryPaste: fieldSummary(
    recordingRowsForCurrentMetrics,
    (row) => row.event === 'benchmark.asr-delivery-success',
    (row) => row.data?.deliveryElapsedMs,
  ),
  errorishCount: recordingRowsForCurrentMetrics.filter((row) => /error|fail|timeout|denied/i.test(`${row.event} ${JSON.stringify(row.data)}`)).length,
};

const editor = {
  tracePath: paths.renderedEditorDebug,
  rowCount: editorRows.length,
  recentWindowMs: RECENT_EDITOR_WINDOW_MS,
  linkedDocumentsComputeRecent: fieldSummary(
    editorRows,
    (row) => isRecentDiagnostic(row) && row.stage === 'typing-hotpath' && row.details?.stage === 'linked-documents-compute',
    (row) => row.details?.durationMs,
  ),
  linkedDocumentsCompute: fieldSummary(
    editorRows,
    (row) => row.stage === 'typing-hotpath' && row.details?.stage === 'linked-documents-compute',
    (row) => row.details?.durationMs,
  ),
  renderedEditorTiming: fieldSummary(
    editorRows,
    (row) => row.stage === 'rendered-editor-timing',
    (row) => row.details?.durationMs,
  ),
  slowOver50Count: editorRows.filter((row) => Number(row.details?.durationMs) > 50).length,
};

const recentScrollRows = scrollRowsForReport.filter((row) => isRecentDiagnostic(row));
const scroll = {
  tracePath: paths.scrollDiagnostics,
  rowCount: scrollRowsForReport.length,
  recentWindowMs: RECENT_EDITOR_WINDOW_MS,
  recentRowCount: recentScrollRows.length,
  scrollFpsRecent: fieldSummary(
    recentScrollRows,
    (row) => row.kind === 'scroll',
    (row) => row.fps,
  ),
  interactionFpsRecent: fieldSummary(
    recentScrollRows,
    (row) => row.kind === 'interaction',
    (row) => row.fps,
  ),
  longestFrameRecent: fieldSummary(
    recentScrollRows,
    (row) => row.kind === 'scroll' || row.kind === 'interaction',
    (row) => row.longestFrameMs,
  ),
  longTaskRecent: fieldSummary(
    recentScrollRows,
    (row) => row.kind === 'longtask',
    (row) => row.duration,
  ),
  scrollSourcesRecent: [...new Set(recentScrollRows
    .filter((row) => row.kind === 'scroll' && typeof row.source === 'string')
    .map((row) => row.source))].sort(),
  interactionSourcesRecent: [...new Set(recentScrollRows
    .filter((row) => row.kind === 'interaction' && typeof row.source === 'string')
    .map((row) => row.source))].sort(),
};

const checks = runChecks
  ? [
      commandResult('npm', ['run', 'typecheck']),
      commandResult('npm', ['run', 'guard:package-safety']),
      commandResult('npm', ['run', 'guard:tracked-sources']),
      commandResult('npm', ['run', 'test', '--', '--run',
        'electron/main/appQuitGuard.test.ts',
        'electron/main/releaseSyncPolicy.test.ts',
        'electron/main/commandLauncherWindow.test.ts',
        'electron/main/diagnosticsCollector.test.ts',
        'src/__tests__/scrollDiagnostics.test.ts',
      ]),
    ]
  : [];

checks.push(...benchmarkResults);

const risks = [];
function addRisk(condition, message) {
  if (condition) risks.push(message);
}

const selectedBenchmarkMinimumRuns = qualityTierMinimumRuns[qualityTier] ?? 1;

const shouldEvaluateLauncherRisks = benchmarkResults.length === 0 || launcherBenchmarkResults.length > 0;
const shouldEvaluateRecordingRisks = benchmarkResults.length === 0 || runRecordingBenchmark || runRecordingAsrBenchmark || runRecordingAsrDeliveryBenchmark;

function addRequiredMetricRisk(summary, label, minimumCount = 1) {
  addRisk(strict && (!summary || summary.n < minimumCount),
    `${label} is required in strict mode, but only ${summary?.n ?? 0} sample(s) were recorded.`);
}

function addRequiredBenchmarkRisk(kind, label) {
  if (!strict) return;
  const expected = benchmarkRuns;
  const observed = benchmarkResults.filter((result) => result.kind === kind && result.ok).length;
  addRisk(observed < expected,
    `${label} requires ${expected} successful benchmark run(s), but only ${observed} passed.`);
}

addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.loadLauncherData, 'launcherLoadDataP95Ms') === 'risk',
  `Launcher load p95 ${launcher.loadLauncherData.p95}ms exceeds ${budgets.launcherLoadDataP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.sessions.hotkeyToVisible, 'launcherHotkeyToVisibleP95Ms') === 'risk',
  `Launcher hotkey-to-visible p95 ${launcher.sessions.hotkeyToVisible.p95}ms exceeds ${budgets.launcherHotkeyToVisibleP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.sessions.hotkeyToHidden, 'launcherHotkeyToHiddenP95Ms') === 'risk',
  `Launcher hotkey-to-hidden p95 ${launcher.sessions.hotkeyToHidden.p95}ms exceeds ${budgets.launcherHotkeyToHiddenP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.sessions.firstInputToResults, 'launcherFirstInputToResultsP95Ms') === 'risk',
  `Launcher first-input-to-results p95 ${launcher.sessions.firstInputToResults.p95}ms exceeds ${budgets.launcherFirstInputToResultsP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.sessions.firstInputToClose, 'launcherFirstInputToCloseP95Ms') === 'risk',
  `Launcher first-input-to-close p95 ${launcher.sessions.firstInputToClose.p95}ms exceeds ${budgets.launcherFirstInputToCloseP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.sessions.rendererInvokeToSuccess, 'launcherInvokeToSuccessP95Ms') === 'risk',
  `Launcher invoke-to-success p95 ${launcher.sessions.rendererInvokeToSuccess.p95}ms exceeds ${budgets.launcherInvokeToSuccessP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.sessions.benchmarkInvokeToSuccess, 'launcherBenchmarkInvokeToSuccessP95Ms') === 'risk',
  `Launcher benchmark invoke-to-success p95 ${launcher.sessions.benchmarkInvokeToSuccess.p95}ms exceeds ${budgets.launcherBenchmarkInvokeToSuccessP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.sessions.benchmarkDelivery, 'launcherBenchmarkDeliveryP95Ms') === 'risk',
  `Launcher benchmark delivery p95 ${launcher.sessions.benchmarkDelivery.p95}ms exceeds ${budgets.launcherBenchmarkDeliveryP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.sessions.externalBenchmarkDelivery, 'launcherExternalDeliveryP95Ms') === 'risk',
  `Launcher external delivery p95 ${launcher.sessions.externalBenchmarkDelivery.p95}ms exceeds ${budgets.launcherExternalDeliveryP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.sessions.browserBenchmarkDelivery, 'launcherBrowserDeliveryP95Ms') === 'risk',
  `Launcher browser textarea delivery p95 ${launcher.sessions.browserBenchmarkDelivery.p95}ms exceeds ${budgets.launcherBrowserDeliveryP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.sessions.commandBenchmarkDelivery, 'launcherCommandDeliveryP95Ms') === 'risk',
  `Launcher command delivery p95 ${launcher.sessions.commandBenchmarkDelivery.p95}ms exceeds ${budgets.launcherCommandDeliveryP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.commandPhases.openTextEditDocument, 'launcherCommandOpenTextEditP95Ms') === 'risk',
  `Launcher command open TextEdit p95 ${launcher.commandPhases.openTextEditDocument.p95}ms exceeds ${budgets.launcherCommandOpenTextEditP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.commandPhases.openSafariTextarea, 'launcherBrowserOpenTextareaP95Ms') === 'risk',
  `Launcher browser open textarea p95 ${launcher.commandPhases.openSafariTextarea.p95}ms exceeds ${budgets.launcherBrowserOpenTextareaP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.commandPhases.pasteDelivery, 'launcherCommandPasteDeliveryPhaseP95Ms') === 'risk',
  `Launcher command paste-delivery phase p95 ${launcher.commandPhases.pasteDelivery.p95}ms exceeds ${budgets.launcherCommandPasteDeliveryPhaseP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.commandPhases.nativeHelper, 'launcherCommandNativeHelperP95Ms') === 'risk',
  `Launcher command native-helper p95 ${launcher.commandPhases.nativeHelper.p95}ms exceeds ${budgets.launcherCommandNativeHelperP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.commandPhases.verifyTextEditDelivery, 'launcherCommandVerifyDeliveryP95Ms') === 'risk',
  `Launcher command verify-delivery p95 ${launcher.commandPhases.verifyTextEditDelivery.p95}ms exceeds ${budgets.launcherCommandVerifyDeliveryP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.filterResults, 'launcherFilterP95Ms') === 'risk',
  `Launcher filter p95 ${launcher.filterResults.p95}ms exceeds ${budgets.launcherFilterP95Ms}ms.`);
addRisk(shouldEvaluateLauncherRisks && statusFor(launcher.loadClipboardResults, 'clipboardResultsP95Ms') === 'risk',
  `Clipboard launcher result p95 ${launcher.loadClipboardResults.p95}ms exceeds ${budgets.clipboardResultsP95Ms}ms.`);
const linkedDocsContractSummary = editor.linkedDocumentsComputeRecent.n > 0
  ? editor.linkedDocumentsComputeRecent
  : editor.linkedDocumentsCompute;
addRisk(statusFor(linkedDocsContractSummary, 'renderedLinkedDocsP95Ms') === 'risk',
  `Rendered linked-doc compute p95 ${linkedDocsContractSummary.p95}ms exceeds ${budgets.renderedLinkedDocsP95Ms}ms.`);
addRisk(linkedDocsContractSummary.max !== null && linkedDocsContractSummary.max > budgets.renderedLinkedDocsMaxMs,
  `Rendered linked-doc compute max ${linkedDocsContractSummary.max}ms exceeds ${budgets.renderedLinkedDocsMaxMs}ms.`);
addRisk(scroll.scrollFpsRecent.n > 0 && scroll.scrollFpsRecent.min < budgets.scrollDiagnosticsMinFps,
  `Recent scroll FPS min ${scroll.scrollFpsRecent.min} is below ${budgets.scrollDiagnosticsMinFps}.`);
addRisk(scroll.interactionFpsRecent.n > 0 && scroll.interactionFpsRecent.min < budgets.scrollDiagnosticsMinFps,
  `Recent interaction FPS min ${scroll.interactionFpsRecent.min} is below ${budgets.scrollDiagnosticsMinFps}.`);
addRisk(scroll.longestFrameRecent.max !== null && scroll.longestFrameRecent.max > budgets.scrollDiagnosticsLongestFrameMaxMs,
  `Recent interaction/scroll longest frame ${scroll.longestFrameRecent.max}ms exceeds ${budgets.scrollDiagnosticsLongestFrameMaxMs}ms.`);
addRisk(shouldEvaluateRecordingRisks && statusFor(recording.finishDone, 'recordingFinishP95Ms') === 'risk',
  `Recording finish p95 ${recording.finishDone.p95}ms exceeds ${budgets.recordingFinishP95Ms}ms.`);
addRisk(shouldEvaluateRecordingRisks && statusFor(recording.paste, 'recordingPasteP95Ms') === 'risk',
  `Recording paste p95 ${recording.paste.p95}ms exceeds ${budgets.recordingPasteP95Ms}ms.`);
addRisk(shouldEvaluateRecordingRisks && statusFor(recording.asr, 'recordingAsrFixtureP95Ms') === 'risk',
  `Recording ASR fixture p95 ${recording.asr.p95}ms exceeds ${budgets.recordingAsrFixtureP95Ms}ms.`);
addRisk(runRecordingAsrDeliveryBenchmark && statusFor(recording.asrDeliveryFinish, 'recordingAsrDeliveryP95Ms') === 'risk',
  `Recording ASR delivery p95 ${recording.asrDeliveryFinish.p95}ms exceeds ${budgets.recordingAsrDeliveryP95Ms}ms.`);
addRisk(checks.some((check) => !check.ok), 'One or more requested verification checks failed.');
addRisk(strict && selectedBenchmarkKinds.length > 0 && benchmarkRuns < selectedBenchmarkMinimumRuns,
  `Quality tier ${qualityTier} requires at least ${selectedBenchmarkMinimumRuns} benchmark run(s) per selected probe, but --benchmark-runs=${benchmarkRuns}.`);

if (benchmarkResults.length === 0 || runLiveBenchmark || runLauncherBenchmark) {
  addRequiredMetricRisk(launcher.loadLauncherData, 'Launcher load data');
}
if (runLauncherBenchmark) {
  addRequiredBenchmarkRisk('launcher', 'Launcher interaction benchmark');
  addRequiredMetricRisk(launcher.sessions.hotkeyToVisible, 'Launcher hotkey-to-visible', benchmarkRuns);
  addRequiredMetricRisk(launcher.sessions.firstInputToResults, 'Launcher first-input-to-results', benchmarkRuns);
  addRequiredMetricRisk(launcher.sessions.firstInputToClose, 'Launcher first-input-to-close', benchmarkRuns);
}
if (runLauncherNormalBenchmark) {
  addRequiredBenchmarkRisk('launcher-normal', 'Launcher normal focus benchmark');
  addRequiredMetricRisk(launcher.sessions.hotkeyToVisible, 'Launcher normal-focus hotkey-to-visible', benchmarkRuns);
  addRequiredMetricRisk(launcher.sessions.firstInputToResults, 'Launcher normal-focus first-input-to-results', benchmarkRuns);
  addRequiredMetricRisk(launcher.sessions.firstInputToClose, 'Launcher normal-focus first-input-to-close', benchmarkRuns);
}
if (runImmersiveBenchmark) {
  addRequiredBenchmarkRisk('immersive', 'Immersive surface benchmark');
  addRequiredMetricRisk(scroll.scrollFpsRecent, 'Recent immersive scroll FPS', 2 * benchmarkRuns);
  addRequiredMetricRisk(scroll.interactionFpsRecent, 'Recent immersive interaction FPS', 3 * benchmarkRuns);
}
if (runLiveBenchmark) {
  addRequiredBenchmarkRisk('controlled', 'Controlled launcher delivery benchmark');
  addRequiredMetricRisk(launcher.sessions.benchmarkDelivery, 'Launcher controlled benchmark delivery', benchmarkRuns);
}
if (runExternalBenchmark) {
  addRequiredBenchmarkRisk('external', 'External launcher delivery benchmark');
  addRequiredMetricRisk(launcher.sessions.externalBenchmarkDelivery, 'Launcher external delivery', benchmarkRuns);
}
if (runBrowserBenchmark) {
  addRequiredBenchmarkRisk('browser', 'Browser textarea delivery benchmark');
  addRequiredMetricRisk(launcher.sessions.browserBenchmarkDelivery, 'Launcher browser textarea delivery', benchmarkRuns);
  addRequiredMetricRisk(launcher.commandPhases.openSafariTextarea, 'Launcher browser open textarea phase', benchmarkRuns);
}
if (runCommandBenchmark) {
  addRequiredBenchmarkRisk('command', 'Ordinary command delivery benchmark');
  addRequiredMetricRisk(launcher.sessions.commandBenchmarkDelivery, 'Launcher command delivery', benchmarkRuns);
  addRequiredMetricRisk(launcher.commandPhases.pasteDelivery, 'Launcher command paste-delivery phase', benchmarkRuns);
  addRequiredMetricRisk(launcher.commandPhases.verifyTextEditDelivery, 'Launcher command verify-delivery phase', benchmarkRuns);
}
if (runRecordingBenchmark) {
  addRequiredBenchmarkRisk('recording', 'Recording delivery benchmark');
  addRequiredMetricRisk(recording.finishDone, 'Recording finish', benchmarkRuns);
  addRequiredMetricRisk(recording.paste, 'Recording paste', benchmarkRuns);
}
if (runRecordingAsrBenchmark) {
  addRequiredBenchmarkRisk('recording-asr', 'Recording ASR fixture benchmark');
  addRequiredMetricRisk(recording.asr, 'Recording ASR fixture', benchmarkRuns);
}
if (runRecordingAsrDeliveryBenchmark) {
  addRequiredBenchmarkRisk('recording-asr-delivery', 'Recording ASR delivery benchmark');
  addRequiredMetricRisk(recording.asrDeliveryFinish, 'Recording ASR delivery finish', benchmarkRuns);
  addRequiredMetricRisk(recording.asrDeliveryPaste, 'Recording ASR delivery paste', benchmarkRuns);
  addRequiredMetricRisk(recording.asr, 'Recording ASR delivery transcription', benchmarkRuns);
}

const report = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  budgets,
  benchmarkRuns,
  qualityTier,
  qualityTierMinimumRuns,
  launcher,
  recording,
  editor,
  scroll,
  checks,
  risks,
  limits: [
    launcher.sessions.count
      ? 'Launcher operation ids are present; controlled external delivery is separated from normal user invocations.'
      : 'Launcher trace rows do not yet include operation ids from a live app run with the new instrumentation.',
    'Controlled delivery proves text arrival in an isolated Electron textarea; external delivery uses a disposable TextEdit document.',
    'Rendered editor diagnostics are local forensic JSONL, not deterministic fixture runs.',
    'Scroll and interaction FPS samples are persisted only when scroll diagnostics are explicitly enabled; normal runs keep the sampler at an early return.',
    runLiveBenchmark
      ? 'The live benchmark uses an isolated Electron textarea, restores the clipboard, and does not paste into user apps or documents.'
      : 'This script summarizes available evidence; pass --run-live-benchmark to request an isolated controlled benchmark from a running app.',
    runExternalBenchmark
      ? 'The external benchmark uses a disposable TextEdit document, closes it without saving, and restores the clipboard.'
      : 'Pass --run-external-benchmark to request opt-in controlled TextEdit delivery evidence.',
    runBrowserBenchmark
      ? 'The browser benchmark opens a disposable Safari data URL with an autofocus textarea, pastes through System Events, verifies by copying the textarea content back, closes the window, and restores the clipboard.'
      : 'Pass --run-browser-benchmark to request opt-in Safari textarea delivery evidence.',
    runCommandBenchmark
      ? 'The command benchmark uses the ordinary external command paste path against a disposable TextEdit document, then verifies delivered text.'
      : 'Pass --run-command-benchmark to request opt-in ordinary external command delivery evidence.',
    runLauncherBenchmark
      ? 'The launcher benchmark shows the real launcher window with synthetic focus protection, injects a query into the renderer input, waits for existing renderer filter traces, then hides it.'
      : 'Pass --run-launcher-benchmark to request opt-in launcher open/search/close evidence.',
    runLauncherNormalBenchmark
      ? 'The launcher normal-focus benchmark shows the real launcher window without synthetic blur-hide suppression; it is the focus/blur reality check for the focus-protected launcher benchmark.'
      : 'Pass --run-launcher-normal-focus-benchmark to request opt-in launcher open/search/close evidence without synthetic focus protection.',
    runImmersiveBenchmark
      ? 'The immersive benchmark drives renderer DOM surfaces, records sparse labeled scroll/typing summaries, and rejects synthetic-only immersive evidence.'
      : 'Pass --run-immersive-benchmark to request opt-in scroll/interaction diagnostic evidence.',
    runRecordingBenchmark
      ? 'The recording benchmark sends a synthetic transcript through the real transcript paste stack into a disposable TextEdit document; it does not record microphone audio or run ASR.'
      : 'Pass --run-recording-benchmark to request opt-in transcript finish/paste evidence without microphone capture.',
    runRecordingAsrBenchmark
      ? 'The recording ASR benchmark transcribes a fixture WAV through the configured transcription engine; it does not record live microphone audio or verify paste delivery.'
      : 'Pass --run-recording-asr-benchmark to request opt-in fixture audio transcription evidence without microphone capture.',
    runRecordingAsrDeliveryBenchmark
      ? 'The recording ASR delivery benchmark transcribes a fixture WAV, sends the transcript through the real transcript paste stack, and verifies TextEdit delivery without recording live microphone audio.'
      : 'Pass --run-recording-asr-delivery-benchmark to request opt-in audio fixture to delivered transcript evidence without microphone capture.',
  ],
};

if (markdown) {
  printMarkdown(report);
} else {
  console.log(JSON.stringify(report, null, 2));
}

if (strict && risks.length > 0) {
  process.exitCode = 1;
}

function printMarkdown(data) {
  const lines = [
    '# Field Theory Mac Quality Baseline',
    '',
    `Generated: ${data.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Risks: ${data.risks.length ? data.risks.length : 'none'}`,
    `- Quality tier: ${data.qualityTier} (minimum ${data.qualityTierMinimumRuns[data.qualityTier] ?? 1} run(s) per selected probe in strict mode)`,
    `- Benchmark runs per selected probe: ${data.benchmarkRuns}`,
    `- Launcher trace rows: ${data.launcher.rowCount}`,
    `- Launcher traced sessions: ${data.launcher.sessions.count}`,
    `- Launcher current benchmark sessions: ${data.launcher.sessions.currentBenchmarkCount}`,
    `- Launcher benchmark invocations: ${data.launcher.sessions.benchmarkInvocations}`,
    `- Launcher benchmark deliveries: ${data.launcher.sessions.benchmarkDeliveries}`,
    `- Launcher external benchmark invocations: ${data.launcher.sessions.externalBenchmarkInvocations}`,
    `- Launcher external benchmark deliveries: ${data.launcher.sessions.externalBenchmarkDeliveries}`,
    `- Launcher browser benchmark invocations: ${data.launcher.sessions.browserBenchmarkInvocations}`,
    `- Launcher browser benchmark deliveries: ${data.launcher.sessions.browserBenchmarkDeliveries}`,
    `- Launcher command benchmark invocations: ${data.launcher.sessions.commandBenchmarkInvocations}`,
    `- Launcher command benchmark deliveries: ${data.launcher.sessions.commandBenchmarkDeliveries}`,
    `- Launcher interaction benchmark sessions: ${data.launcher.sessions.launcherBenchmarkSessions}`,
    `- Launcher normal-focus benchmark sessions: ${data.launcher.sessions.launcherNormalBenchmarkSessions}`,
    `- Recording trace rows: ${data.recording.rowCount}`,
    `- Recording current benchmark runs: ${data.recording.currentBenchmarkCount}`,
    `- Rendered editor debug rows: ${data.editor.rowCount}`,
    `- Scroll diagnostics rows: ${data.scroll.rowCount}`,
    `- Recent scroll diagnostics rows: ${data.scroll.recentRowCount}`,
    `- Recent scroll sources: ${data.scroll.scrollSourcesRecent.length ? data.scroll.scrollSourcesRecent.join(', ') : 'none'}`,
    `- Recent interaction sources: ${data.scroll.interactionSourcesRecent.length ? data.scroll.interactionSourcesRecent.join(', ') : 'none'}`,
    '',
    '## Metrics',
    '',
    '| Area | n | p50 | p95 | max | Status |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    metricRow('Launcher load data', data.launcher.loadLauncherData, 'launcherLoadDataP95Ms'),
    metricRow('Launcher hotkey to visible', data.launcher.sessions.hotkeyToVisible, 'launcherHotkeyToVisibleP95Ms'),
    metricRow('Launcher hotkey to hidden', data.launcher.sessions.hotkeyToHidden, 'launcherHotkeyToHiddenP95Ms'),
    metricRow('Launcher first input to results', data.launcher.sessions.firstInputToResults, 'launcherFirstInputToResultsP95Ms'),
    metricRow('Launcher first input to close', data.launcher.sessions.firstInputToClose, 'launcherFirstInputToCloseP95Ms'),
    metricRow('Launcher invoke to success', data.launcher.sessions.rendererInvokeToSuccess, 'launcherInvokeToSuccessP95Ms'),
    metricRow('Launcher benchmark invoke to success', data.launcher.sessions.benchmarkInvokeToSuccess, 'launcherBenchmarkInvokeToSuccessP95Ms'),
    metricRow('Launcher benchmark delivery', data.launcher.sessions.benchmarkDelivery, 'launcherBenchmarkDeliveryP95Ms'),
    metricRow('Launcher external delivery', data.launcher.sessions.externalBenchmarkDelivery, 'launcherExternalDeliveryP95Ms'),
    metricRow('Launcher browser textarea delivery', data.launcher.sessions.browserBenchmarkDelivery, 'launcherBrowserDeliveryP95Ms'),
    metricRow('Launcher command delivery', data.launcher.sessions.commandBenchmarkDelivery, 'launcherCommandDeliveryP95Ms'),
    metricRow('Launcher command open TextEdit', data.launcher.commandPhases.openTextEditDocument, 'launcherCommandOpenTextEditP95Ms'),
    metricRow('Launcher browser open textarea', data.launcher.commandPhases.openSafariTextarea, 'launcherBrowserOpenTextareaP95Ms'),
    metricRow('Launcher command clipboard write', data.launcher.commandPhases.clipboardWrite, null),
    metricRow('Launcher command native activate', data.launcher.commandPhases.nativeActivate, null),
    metricRow('Launcher command hide before paste', data.launcher.commandPhases.nativeHide, null),
    metricRow('Launcher command native helper', data.launcher.commandPhases.nativeHelper, 'launcherCommandNativeHelperP95Ms'),
    metricRow('Launcher command native total', data.launcher.commandPhases.nativeTotal, null),
    metricRow('Launcher command paste-delivery phase', data.launcher.commandPhases.pasteDelivery, 'launcherCommandPasteDeliveryPhaseP95Ms'),
    metricRow('Launcher command verify delivery', data.launcher.commandPhases.verifyTextEditDelivery, 'launcherCommandVerifyDeliveryP95Ms'),
    metricRow('Launcher filter results', data.launcher.filterResults, 'launcherFilterP95Ms'),
    metricRow('Launcher warm cache', data.launcher.warmSearchCache, null),
    metricRow('Launcher warm cache chunk', data.launcher.warmSearchCacheChunk, null),
    metricRow('Clipboard launcher results', data.launcher.loadClipboardResults, 'clipboardResultsP95Ms'),
    metricRow(`Rendered linked-doc compute recent (${Math.round(data.editor.recentWindowMs / 60000)}m)`, data.editor.linkedDocumentsComputeRecent, 'renderedLinkedDocsP95Ms'),
    metricRow('Rendered linked-doc compute historical', data.editor.linkedDocumentsCompute, null),
    metricRow('Rendered editor timing', data.editor.renderedEditorTiming, null),
    metricRow(`Scroll FPS recent (${Math.round(data.scroll.recentWindowMs / 60000)}m)`, data.scroll.scrollFpsRecent, 'scrollDiagnosticsMinFps', 'over', 'fps'),
    metricRow(`Interaction FPS recent (${Math.round(data.scroll.recentWindowMs / 60000)}m)`, data.scroll.interactionFpsRecent, 'scrollDiagnosticsMinFps', 'over', 'fps'),
    metricRow('Scroll/interaction longest frame recent', data.scroll.longestFrameRecent, 'scrollDiagnosticsLongestFrameMaxMs'),
    metricRow('Long task duration recent', data.scroll.longTaskRecent, null),
    metricRow('Recording finish', data.recording.finishDone, 'recordingFinishP95Ms'),
    metricRow('Recording paste', data.recording.paste, 'recordingPasteP95Ms'),
    metricRow('Recording ASR', data.recording.asr, 'recordingAsrFixtureP95Ms'),
    metricRow('Recording ASR delivery finish', data.recording.asrDeliveryFinish, 'recordingAsrDeliveryP95Ms'),
    metricRow('Recording ASR delivery paste', data.recording.asrDeliveryPaste, 'recordingPasteP95Ms'),
    '',
  ];

  lines.push('## Quality Scenarios', '', '| Trace | Scenario | Rows |', '| --- | --- | ---: |');
  for (const [scenario, count] of Object.entries(data.launcher.qualityScenarios)) {
    lines.push(`| Launcher | ${scenario} | ${count} |`);
  }
  for (const [scenario, count] of Object.entries(data.recording.qualityScenarios)) {
    lines.push(`| Recording | ${scenario} | ${count} |`);
  }
  lines.push('');

  if (data.checks.length) {
    lines.push('## Checks', '', '| Command | Status | Duration |', '| --- | ---: | ---: |');
    for (const check of data.checks) {
      lines.push(`| \`${check.command}\` | ${check.ok ? 'pass' : 'fail'} | ${check.durationMs}ms |`);
    }
    lines.push('');
    const failed = data.checks.filter((check) => !check.ok);
    if (failed.length) {
      lines.push('### Check Failure Details', '');
      for (const check of failed) {
        const detail = (check.stderrTail || check.stdoutTail || '').trim();
        lines.push(`**${check.command}**`, '');
        lines.push(detail ? fenced(detail) : 'No output captured.', '');
      }
    }
  }

  if (data.risks.length) {
    lines.push('## Risks', '', ...data.risks.map((risk) => `- ${risk}`), '');
  }

  lines.push('## Limits', '', ...data.limits.map((limit) => `- ${limit}`));
  console.log(lines.join('\n'));
}

function metricRow(label, summary, budgetKey, direction = 'under', unit = 'ms') {
  const status = budgetKey ? statusFor(summary, budgetKey, direction) : (summary.n ? 'sample' : 'unknown');
  return `| ${label} | ${summary.n} | ${format(summary.p50, unit)} | ${format(summary.p95, unit)} | ${format(summary.max, unit)} | ${status} |`;
}

function format(value, unit = 'ms') {
  return value === null || value === undefined ? 'n/a' : `${value}${unit}`;
}

function fenced(value) {
  return ['```text', value, '```'].join('\n');
}
