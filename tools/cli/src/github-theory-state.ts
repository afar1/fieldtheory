import { spawn } from 'node:child_process';
import { loadEnv } from './config.js';
import { withGitHubAccessHint } from './github-access.js';
import type { TheoryItem } from './theories.js';
import { formatTheoryId, normalizeTheoryId } from './theories.js';
import { resolveRepoReference } from './repo-resolution.js';
import { loadTimelineState, patchTheoryState, type TimelineTheoryState } from './timeline-state.js';

export interface GitHubIssueListItem {
  number: number;
  title: string;
  url: string;
  state: string;
  closedAt?: string | null;
}

export interface GitHubPullRequestListItem extends GitHubIssueListItem {
  mergedAt?: string | null;
  isDraft?: boolean;
}

export interface TheoryIssueAssessment {
  summary: string;
  validity: string;
  scope: string;
  proposedSolution: string;
  breakingChanges: string;
  userImpact: string;
  caution: string;
  isActuallyIssue: boolean;
  isBroaderIssue: boolean;
  hasBreakingChangeRisk: boolean;
}

export interface TheoryGitHubMatch {
  repo: string | null;
  repoPath: string | null;
  issue?: GitHubIssueListItem;
  pullRequest?: GitHubPullRequestListItem;
}

export interface ActionLogger {
  onLog?: (line: string) => void;
}

export interface RefreshTheoryGitHubStateOptions extends ActionLogger {
  cwd?: string;
  repo?: string;
  staleMs?: number;
}

export interface GitHubCliLike {
  issueList: (repo: string, search: string, options?: ActionLogger & { cwd?: string; limit?: number }) => Promise<GitHubIssueListItem[]>;
  prList: (repo: string, search: string, options?: ActionLogger & { cwd?: string; limit?: number }) => Promise<GitHubPullRequestListItem[]>;
}

export const DEFAULT_GITHUB_REFRESH_STALE_MS = 15 * 60 * 1000;

let githubCli: GitHubCliLike | null = null;

function emit(logger: ActionLogger | undefined, line: string): void {
  logger?.onLog?.(line);
}

function quoteArg(value: string): string {
  return /[\s"'`$]/.test(value) ? JSON.stringify(value) : value;
}

function canonicalTheoryId(input: string): string {
  return formatTheoryId(normalizeTheoryId(input));
}

function extractTheoryIds(value: string): string[] {
  return [...new Set(
    (value.match(/\bFT-\d+\b/gi) ?? [])
      .map((entry) => canonicalTheoryId(entry))
  )];
}

function normalizeIssueState(value: string | null | undefined): 'open' | 'closed' {
  return String(value ?? '').toLowerCase() === 'closed' ? 'closed' : 'open';
}

function normalizePrState(pr: GitHubPullRequestListItem): 'open' | 'closed' | 'merged' {
  if (pr.mergedAt) return 'merged';
  return normalizeIssueState(pr.state);
}

function buildTheoryNeedle(theory: TheoryItem): string {
  return canonicalTheoryId(theory.displayId || theory.id);
}

function matchesTheoryRecord(
  record: GitHubIssueListItem | GitHubPullRequestListItem,
  theory: TheoryItem,
): boolean {
  const needle = buildTheoryNeedle(theory);
  const ids = extractTheoryIds(record.title);
  if (ids.includes(needle)) return true;
  return record.title.includes(needle);
}

function pickBestIssue(
  records: GitHubIssueListItem[],
  theory: TheoryItem,
): GitHubIssueListItem | undefined {
  return records
    .filter((record) => matchesTheoryRecord(record, theory))
    .sort((a, b) => {
      if (normalizeIssueState(a.state) !== normalizeIssueState(b.state)) {
        return normalizeIssueState(a.state) === 'open' ? -1 : 1;
      }
      return b.number - a.number;
    })[0];
}

function pickBestPullRequest(
  records: GitHubPullRequestListItem[],
  theory: TheoryItem,
): GitHubPullRequestListItem | undefined {
  return records
    .filter((record) => matchesTheoryRecord(record, theory))
    .sort((a, b) => {
      const aState = normalizePrState(a);
      const bState = normalizePrState(b);
      const rank = (state: 'open' | 'closed' | 'merged'): number => (
        state === 'merged' ? 0 : state === 'open' ? 1 : 2
      );
      if (rank(aState) !== rank(bState)) {
        return rank(aState) - rank(bState);
      }
      return b.number - a.number;
    })[0];
}

function issueSectionExcerpt(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= 220 ? text : `${text.slice(0, 219).trimEnd()}…`;
}

export function assessTheoryIssue(theory: TheoryItem): TheoryIssueAssessment {
  const haystack = [
    theory.title,
    theory.sectionTitle ?? '',
    theory.whatWeFound,
    theory.whatToDo,
  ].join('\n');
  const lower = haystack.toLowerCase();
  const fileReferenceCount = (haystack.match(/\]\(\/Users\/[^)#\s]+/g) ?? []).length;
  const isBroaderIssue = fileReferenceCount > 2 || /\b(across|systemic|shared|repo|workflow|all|every|multiple)\b/.test(lower);
  const hasBreakingChangeRisk = /\b(migration|schema|auth|token|public|api|contract|admin-only|backend-only|permission|reject)\b/.test(lower);
  const userImpactLikely = /\b(user|users|admin|bookmark|login|caregiver|client|workflow|interaction|ui|web)\b/.test(lower);

  return {
    summary: `Assessment for ${theory.displayId}: ${issueSectionExcerpt(theory.title)}`,
    validity: theory.confidence?.toLowerCase() === 'low'
      ? 'Likely an issue, but the confidence is low enough that the reproduction path should be checked before landing a fix.'
      : 'Yes. The finding cites concrete code paths and a specific failure mode, so it is issue-worthy as written.',
    scope: isBroaderIssue
      ? 'Broader than a one-file fix. This looks like a system or workflow issue, so the eventual change should be scoped carefully.'
      : 'This looks like a contained issue, though it may still need follow-on cleanup after the first fix lands.',
    proposedSolution: theory.whatToDo || 'The finding does not include a concrete fix yet. The first step is to reduce it to a specific implementation plan.',
    breakingChanges: hasBreakingChangeRisk
      ? 'Possible. The proposed direction touches auth, contracts, or externally visible behavior, so it should be reviewed for rollout risk before merging.'
      : 'No obvious breaking change is implied by the current proposal, though normal regression review still applies.',
    userImpact: userImpactLikely
      ? 'Likely affects user or operator interaction with the system, so UI/UX and workflow expectations should be checked as part of the fix.'
      : 'This looks primarily operational or internal, with limited direct user-facing impact unless the bug escalates.',
    caution: hasBreakingChangeRisk
      ? 'Treat the fix as a potentially sensitive change. Confirm integration behavior, rollout sequencing, and any migration requirements before shipping.'
      : 'The main caution is validating the finding against current behavior so the issue stays specific and actionable.',
    isActuallyIssue: true,
    isBroaderIssue,
    hasBreakingChangeRisk,
  };
}

export function buildAssessmentMarkdown(assessment: TheoryIssueAssessment): string {
  return [
    `Summary: ${assessment.summary}`,
    `Actually an issue: ${assessment.isActuallyIssue ? 'Yes' : 'Unclear'}`,
    `Broader than it first appears: ${assessment.isBroaderIssue ? 'Yes' : 'No'}`,
    '',
    `Validity: ${assessment.validity}`,
    '',
    `Scope: ${assessment.scope}`,
    '',
    `Proposed solution: ${assessment.proposedSolution}`,
    '',
    `Breaking changes: ${assessment.breakingChanges}`,
    '',
    `User interaction impact: ${assessment.userImpact}`,
    '',
    `Caution: ${assessment.caution}`,
  ].join('\n');
}

export async function inferGitHubRepoForTheory(
  theory: TheoryItem,
  cwd = process.cwd(),
): Promise<{ repo: string | null; repoPath: string | null }> {
  const resolved = await resolveRepoReference({
    repoName: theory.transcriptMeta.repoName ?? null,
    repoPath: theory.transcriptMeta.repoPath ?? null,
  });
  return {
    repo: theory.transcriptMeta.githubRepo ?? resolved.githubRepo,
    repoPath: resolved.repoPath,
  };
}

function ensureGitHubEnvironment(cwd = process.cwd()): NodeJS.ProcessEnv {
  loadEnv(cwd);
  return { ...process.env };
}

export function isTheoryGitHubStateFresh(
  state: TimelineTheoryState | undefined,
  staleMs = DEFAULT_GITHUB_REFRESH_STALE_MS,
): boolean {
  const checkedAt = state?.githubCheckedAt ? Date.parse(state.githubCheckedAt) : 0;
  return Boolean(checkedAt) && (Date.now() - checkedAt) < staleMs;
}

async function runGhJson<T>(
  args: string[],
  options: ActionLogger & { cwd?: string } = {},
): Promise<T> {
  const cwd = options.cwd ?? process.cwd();
  const env = ensureGitHubEnvironment(cwd);
  const command = `gh ${args.map((arg) => quoteArg(arg)).join(' ')}`;
  emit(options, `Running ${command}`);

  return new Promise<T>((resolve, reject) => {
    const child = spawn('gh', args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(withGitHubAccessHint(stderr.trim() || stdout.trim() || `gh exited with code ${code}`, env)));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function getDefaultGitHubCli(): GitHubCliLike {
  return {
    issueList: async (repo, search, options = {}) =>
      runGhJson<GitHubIssueListItem[]>(
        ['issue', 'list', '--repo', repo, '--state', 'all', '--limit', String(options.limit ?? 200), '--search', search, '--json', 'number,title,url,state,closedAt'],
        options,
      ),
    prList: async (repo, search, options = {}) =>
      runGhJson<GitHubPullRequestListItem[]>(
        ['pr', 'list', '--repo', repo, '--state', 'all', '--limit', String(options.limit ?? 200), '--search', search, '--json', 'number,title,url,state,closedAt,mergedAt,isDraft'],
        options,
      ),
  };
}

function currentGitHubCli(): GitHubCliLike {
  if (!githubCli) githubCli = getDefaultGitHubCli();
  return githubCli;
}

export function setGitHubCliForTesting(cli: GitHubCliLike | null): void {
  githubCli = cli;
}

export async function lookupTheoryGitHubState(
  theory: TheoryItem,
  options: RefreshTheoryGitHubStateOptions = {},
): Promise<TheoryGitHubMatch> {
  const cwd = options.cwd ?? process.cwd();
  const resolved = await inferGitHubRepoForTheory(theory, cwd);
  const repo = options.repo ?? resolved.repo;
  if (!repo) {
    return { repo: null, repoPath: resolved.repoPath };
  }

  const needle = buildTheoryNeedle(theory);
  const gh = currentGitHubCli();
  const [issues, prs] = await Promise.all([
    gh.issueList(repo, needle, options),
    gh.prList(repo, needle, options),
  ]);

  return {
    repo,
    repoPath: resolved.repoPath,
    issue: pickBestIssue(issues, theory),
    pullRequest: pickBestPullRequest(prs, theory),
  };
}

function buildTheoryStateFromGitHubMatch(
  theory: TheoryItem,
  match: TheoryGitHubMatch,
  existing: TimelineTheoryState | undefined,
): Partial<TimelineTheoryState> {
  const issueSource = match.issue
    ? existing?.issueSource === 'created' && existing.issueUrl === match.issue.url
      ? 'created'
      : 'existing'
    : existing?.issueSource;

  return {
    issueRepo: match.repo ?? existing?.issueRepo,
    issueUrl: match.issue?.url ?? existing?.issueUrl,
    issueNumber: match.issue?.number ?? existing?.issueNumber,
    issueTitle: match.issue?.title ?? existing?.issueTitle,
    issueState: match.issue ? normalizeIssueState(match.issue.state) : existing?.issueState,
    issueSource,
    prUrl: match.pullRequest?.url ?? existing?.prUrl,
    prNumber: match.pullRequest?.number ?? existing?.prNumber,
    prTitle: match.pullRequest?.title ?? existing?.prTitle,
    prState: match.pullRequest ? normalizePrState(match.pullRequest) : existing?.prState,
    mergedAt: match.pullRequest?.mergedAt ?? existing?.mergedAt,
    githubCheckedAt: new Date().toISOString(),
  };
}

export async function refreshTheoryGitHubState(
  theory: TheoryItem,
  options: RefreshTheoryGitHubStateOptions = {},
): Promise<TimelineTheoryState> {
  const cwd = options.cwd ?? process.cwd();
  const current = (await loadTimelineState(cwd)).theories[theory.id];
  const staleMs = options.staleMs ?? DEFAULT_GITHUB_REFRESH_STALE_MS;

  if (isTheoryGitHubStateFresh(current, staleMs)) {
    return current;
  }

  const match = await lookupTheoryGitHubState(theory, options);
  const patch = buildTheoryStateFromGitHubMatch(theory, match, current);
  return patchTheoryState(theory.id, patch, cwd);
}

export async function refreshTheoryGitHubStates(
  theories: TheoryItem[],
  options: RefreshTheoryGitHubStateOptions = {},
): Promise<Record<string, TimelineTheoryState>> {
  const cwd = options.cwd ?? process.cwd();
  const fullState = await loadTimelineState(cwd);
  const staleMs = options.staleMs ?? DEFAULT_GITHUB_REFRESH_STALE_MS;
  const grouped = new Map<string, TheoryItem[]>();
  const unresolved: TheoryItem[] = [];

  for (const theory of theories) {
    const existing = fullState.theories[theory.id];
    if (isTheoryGitHubStateFresh(existing, staleMs)) continue;

    const resolved = await inferGitHubRepoForTheory(theory, cwd);
    if (!resolved.repo) {
      unresolved.push(theory);
      continue;
    }

    const bucket = grouped.get(resolved.repo) ?? [];
    bucket.push({ ...theory, transcriptMeta: { ...theory.transcriptMeta, repoPath: resolved.repoPath ?? theory.transcriptMeta.repoPath ?? null } });
    grouped.set(resolved.repo, bucket);
  }

  const gh = currentGitHubCli();

  for (const [repo, items] of grouped) {
    try {
      const [issues, prs] = await Promise.all([
        gh.issueList(repo, 'FT-', { ...options, cwd, limit: 300 }),
        gh.prList(repo, 'FT-', { ...options, cwd, limit: 300 }),
      ]);

      for (const theory of items) {
        const existing = fullState.theories[theory.id];
        const match: TheoryGitHubMatch = {
          repo,
          repoPath: theory.transcriptMeta.repoPath ?? null,
          issue: pickBestIssue(issues, theory),
          pullRequest: pickBestPullRequest(prs, theory),
        };
        const next = await patchTheoryState(
          theory.id,
          buildTheoryStateFromGitHubMatch(theory, match, existing),
          cwd,
        );
        fullState.theories[theory.id] = next;
      }
    } catch (error) {
      emit(options, `GitHub state sync skipped for ${repo}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const theory of unresolved) {
    const next = await patchTheoryState(theory.id, {
      githubCheckedAt: new Date().toISOString(),
    }, cwd);
    fullState.theories[theory.id] = next;
  }

  const result: Record<string, TimelineTheoryState> = {};
  for (const theory of theories) {
    result[theory.id] = fullState.theories[theory.id] ?? {};
  }
  return result;
}
