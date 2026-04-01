import { ensureDir, pathExists, readJson, writeJson } from './fs.js';
import { localStateDir, timelineStatePath } from './paths.js';

export interface TimelineBookmarkState {
  issueUrl?: string;
  issueRepo?: string;
  lastIssueAt?: string;
  debateTranscriptPath?: string;
  debateConsensusPath?: string;
  lastDebateAt?: string;
}

export interface TimelineTheoryState {
  issueUrl?: string;
  issueRepo?: string;
  issueNumber?: number;
  issueTitle?: string;
  issueState?: 'open' | 'closed';
  issueSource?: 'created' | 'existing';
  lastIssueAt?: string;
  prUrl?: string;
  prNumber?: number;
  prTitle?: string;
  prState?: 'open' | 'closed' | 'merged';
  mergedAt?: string;
  githubCheckedAt?: string;
  debateTranscriptPath?: string;
  debateConsensusPath?: string;
  lastDebateAt?: string;
}

export interface TimelineState {
  bookmarks: Record<string, TimelineBookmarkState>;
  theories: Record<string, TimelineTheoryState>;
}

const EMPTY_STATE: TimelineState = {
  bookmarks: {},
  theories: {},
};

export async function loadTimelineState(cwd = process.cwd()): Promise<TimelineState> {
  const filePath = timelineStatePath(cwd);
  if (!(await pathExists(filePath))) return structuredClone(EMPTY_STATE);

  const raw = await readJson<Partial<TimelineState>>(filePath);
  return {
    bookmarks: raw.bookmarks ?? {},
    theories: raw.theories ?? {},
  };
}

export async function saveTimelineState(state: TimelineState, cwd = process.cwd()): Promise<string> {
  await ensureDir(localStateDir(cwd));
  const filePath = timelineStatePath(cwd);
  await writeJson(filePath, state);
  return filePath;
}

export async function patchBookmarkState(
  id: string,
  patch: Partial<TimelineBookmarkState>,
  cwd = process.cwd()
): Promise<TimelineBookmarkState> {
  const state = await loadTimelineState(cwd);
  const next = { ...(state.bookmarks[id] ?? {}), ...patch };
  state.bookmarks[id] = next;
  await saveTimelineState(state, cwd);
  return next;
}

export async function patchTheoryState(
  id: string,
  patch: Partial<TimelineTheoryState>,
  cwd = process.cwd()
): Promise<TimelineTheoryState> {
  const state = await loadTimelineState(cwd);
  const next = { ...(state.theories[id] ?? {}), ...patch };
  state.theories[id] = next;
  await saveTimelineState(state, cwd);
  return next;
}
