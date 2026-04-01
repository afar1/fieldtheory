import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureDir, pathExists } from './fs.js';
import { getBookmarkById, type BookmarkTimelineItem } from './bookmarks-db.js';
import { getTheoryItem, normalizeTheoryId, type TheoryItem } from './theories.js';
import { loadTimelineState, patchBookmarkState, patchTheoryState } from './timeline-state.js';
import { localStateDir, workspaceRoot } from './paths.js';
import {
  assessTheoryIssue,
  buildAssessmentMarkdown,
  inferGitHubRepoForTheory,
  lookupTheoryGitHubState,
} from './github-theory-state.js';
import { loadEnv } from './config.js';
import { withGitHubAccessHint } from './github-access.js';
import { parseGitHubRepoFromUrl } from './repo-resolution.js';

export interface ActionLogger {
  onLog?: (line: string) => void;
}

export interface IssueCreationResult {
  command: string;
  repo: string;
  title: string;
  body: string;
  url?: string;
  dryRun?: boolean;
  created?: boolean;
  alreadyExists?: boolean;
  prUrl?: string;
  mergedAt?: string | null;
}

export interface DebateResult {
  command: string;
  transcriptPath?: string;
  consensusPath?: string;
  stdout: string;
  stderr: string;
}

export interface BookmarkIssueOptions extends ActionLogger {
  repo?: string;
  dryRun?: boolean;
  cwd?: string;
}

export interface TheoryIssueOptions extends ActionLogger {
  repo?: string;
  dryRun?: boolean;
  cwd?: string;
  theoriesRootDir?: string;
}

export interface DebateOptions extends ActionLogger {
  maxTurns?: number;
  cwd?: string;
  theoriesRootDir?: string;
}

function truncate(value: string, max = 88): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function cliRoot(cwd = process.cwd()): string {
  return workspaceRoot(cwd);
}

function repoRoot(cwd = process.cwd()): string {
  return path.resolve(cliRoot(cwd), '..', '..');
}

function councilScriptPath(cwd = process.cwd()): string {
  return path.join(repoRoot(cwd), 'mac-app', 'scripts', 'council.sh');
}

function quoteArg(value: string): string {
  return /[\s"'`$]/.test(value) ? JSON.stringify(value) : value;
}

function emit(logger: ActionLogger | undefined, line: string): void {
  logger?.onLog?.(line);
}

function inferGitHubRepoFromBookmark(item: BookmarkTimelineItem): string | null {
  for (const url of [...item.githubUrls, ...item.links]) {
    const repo = parseGitHubRepoFromUrl(url);
    if (repo) return repo;
  }
  return null;
}

function createIssueBody(title: string, sections: Array<{ label: string; body?: string | null }>): string {
  const lines = [`# ${title}`, ''];
  for (const section of sections) {
    if (!section.body?.trim()) continue;
    lines.push(`## ${section.label}`, '', section.body.trim(), '');
  }
  return lines.join('\n').trim();
}

async function createGitHubIssue(
  repo: string,
  title: string,
  body: string,
  options: { dryRun?: boolean } & ActionLogger = {}
): Promise<IssueCreationResult> {
  const command = `gh issue create --repo ${quoteArg(repo)} --title ${quoteArg(title)} --body ${quoteArg(body)}`;
  loadEnv(process.cwd());
  const env = { ...process.env };
  if (options.dryRun) {
    emit(options, `[dry-run] ${command}`);
    return { command, repo, title, body, dryRun: true, created: false };
  }

  emit(options, `Running ${command}`);
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['issue', 'create', '--repo', repo, '--title', title, '--body', body], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      for (const line of chunk.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
        emit(options, line);
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      for (const line of chunk.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
        emit(options, line);
      }
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(withGitHubAccessHint(stderr.trim() || stdout.trim() || `gh issue create exited with code ${code}`, env)));
        return;
      }
      const url = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .find((line) => /^https:\/\/github\.com\//.test(line));
      resolve({ command, repo, title, body, url, created: true });
    });
  });
}

async function runCouncil(topic: string, options: { repoPath?: string } & DebateOptions = {}): Promise<DebateResult> {
  const cwd = options.cwd ?? process.cwd();
  const scriptPath = councilScriptPath(cwd);
  if (!(await pathExists(scriptPath))) {
    throw new Error(`Missing council script at ${scriptPath}`);
  }

  const transcriptDir = path.join(localStateDir(cwd), 'council-transcripts');
  await ensureDir(transcriptDir);

  const args = ['--json-events', '--transcript-dir', transcriptDir];
  if (options.maxTurns) {
    args.push('--max-turns', String(options.maxTurns));
  }
  if (options.repoPath) {
    args.push('--repo', options.repoPath);
  }
  args.push(topic);

  const command = [scriptPath, ...args.map((arg) => quoteArg(arg))].join(' ');
  emit(options, `Running ${command}`);

  return new Promise((resolve, reject) => {
    const child = spawn(scriptPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: repoRoot(cwd),
    });

    let stdout = '';
    let stderr = '';
    let transcriptPath: string | undefined;
    let consensusPath: string | undefined;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const flushLines = (
      nextChunk: string,
      current: string,
      onLine: (line: string) => void
    ): string => {
      const combined = current + nextChunk;
      const lines = combined.split('\n');
      const remainder = lines.pop() ?? '';
      for (const line of lines) onLine(line);
      return remainder;
    };

    const onStdoutLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      emit(options, trimmed);
      try {
        const event = JSON.parse(trimmed) as Record<string, string>;
        if (event.type === 'transcript_written' && event.path) transcriptPath = event.path;
        if (event.type === 'consensus_written' && event.path) consensusPath = event.path;
      } catch {
        // council stderr/output can include plain text before JSON mode fully settles
      }
    };

    const onStderrLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      emit(options, trimmed);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      stdoutBuffer = flushLines(chunk, stdoutBuffer, onStdoutLine);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      stderrBuffer = flushLines(chunk, stderrBuffer, onStderrLine);
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (stdoutBuffer.trim()) onStdoutLine(stdoutBuffer);
      if (stderrBuffer.trim()) onStderrLine(stderrBuffer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `council exited with code ${code}`));
        return;
      }
      resolve({ command, transcriptPath, consensusPath, stdout, stderr });
    });
  });
}

function buildTheoryIssue(item: TheoryItem, assessmentMarkdown?: string): { title: string; body: string } {
  const title = `${item.displayId}: ${item.title}`;
  const bookmarkList = item.transcriptMeta.bookmarkUrls.length
    ? item.transcriptMeta.bookmarkUrls.map((url) => `- ${url}`).join('\n')
    : item.bookmarksLabel ?? '';

  const body = createIssueBody(title, [
    {
      label: 'Summary',
      body: [
        item.transcriptMeta.githubRepo ? `Repo: ${item.transcriptMeta.githubRepo}` : item.transcriptMeta.repoName ? `Repo: ${item.transcriptMeta.repoName}` : '',
        item.sectionTitle ? `Section: ${item.sectionTitle}` : '',
        item.confidence ? `Confidence: ${item.confidence}` : '',
        item.valueDollars != null ? `Value: $${item.valueDollars}` : '',
      ].filter(Boolean).join('\n'),
    },
    { label: 'Assessment', body: assessmentMarkdown },
    { label: 'What We Found', body: item.whatWeFound },
    { label: 'What To Do', body: item.whatToDo },
    { label: 'Bookmarks', body: bookmarkList },
    {
      label: 'Artifacts',
      body: [
        item.sourceMessageId ? `Source cache: ${item.digestPath}` : `Digest: ${item.digestPath}`,
        item.transcriptPath ? `Transcript: ${item.transcriptPath}` : '',
      ].filter(Boolean).join('\n'),
    },
  ]);

  return { title, body };
}

function buildBookmarkIssue(item: BookmarkTimelineItem): { title: string; body: string } {
  const author = item.authorHandle ? `@${item.authorHandle}` : 'unknown author';
  const title = `Bookmark: ${author} — ${truncate(item.text.replace(/\s+/g, ' '), 72)}`;
  const body = createIssueBody(title, [
    {
      label: 'Source',
      body: [
        `URL: ${item.url}`,
        item.postedAt ? `Posted: ${item.postedAt}` : '',
        item.bookmarkedAt ? `Bookmarked: ${item.bookmarkedAt}` : '',
      ].filter(Boolean).join('\n'),
    },
    { label: 'Bookmark Text', body: item.text },
    {
      label: 'Metadata',
      body: [
        item.categories.length ? `Categories: ${item.categories.join(', ')}` : '',
        item.domains.length ? `Domains: ${item.domains.join(', ')}` : '',
      ].filter(Boolean).join('\n'),
    },
    {
      label: 'Linked URLs',
      body: item.links.length ? item.links.map((url) => `- ${url}`).join('\n') : '',
    },
  ]);
  return { title, body };
}

export async function createTheoryIssue(
  theoryId: string,
  options: TheoryIssueOptions = {}
): Promise<IssueCreationResult & { theory: TheoryItem }> {
  const cwd = options.cwd ?? process.cwd();
  const theory = await getTheoryItem(theoryId, options.theoriesRootDir);
  if (!theory) {
    throw new Error(`Unknown theory: ${normalizeTheoryId(theoryId)}`);
  }

  const resolved = await inferGitHubRepoForTheory(theory, cwd);
  const repo = options.repo ?? resolved.repo;
  if (!repo) {
    throw new Error('Could not infer a GitHub repo for this theory. Pass --repo owner/name.');
  }

  emit(options, `Assessing ${theory.displayId} before issue creation…`);
  const assessment = assessTheoryIssue(theory);
  emit(options, `Assessment complete: ${assessment.isBroaderIssue ? 'broader/systemic issue' : 'contained issue'}${assessment.hasBreakingChangeRisk ? ' · possible breaking-change risk' : ''}`);

  const currentState = (await loadTimelineState(cwd)).theories[theory.id] ?? {};
  if (currentState.issueUrl || currentState.prUrl) {
    emit(options, currentState.mergedAt
      ? `Work already merged: ${currentState.prUrl}`
      : currentState.prUrl
        ? `Pull request already exists: ${currentState.prUrl}`
        : `Issue already exists: ${currentState.issueUrl}`);
    return {
      command: `ft theories issue ${theory.id}`,
      repo,
      title: `${theory.displayId}: ${theory.title}`,
      body: buildTheoryIssue(theory, buildAssessmentMarkdown(assessment)).body,
      url: currentState.issueUrl,
      prUrl: currentState.prUrl,
      mergedAt: currentState.mergedAt,
      created: false,
      alreadyExists: true,
      theory,
    };
  }

  const existing = await lookupTheoryGitHubState(theory, { ...options, cwd, repo });
  if (existing.issue || existing.pullRequest) {
    const nextState = await patchTheoryState(theory.id, {
      issueRepo: repo,
      issueUrl: existing.issue?.url,
      issueNumber: existing.issue?.number,
      issueTitle: existing.issue?.title,
      issueState: existing.issue ? (String(existing.issue.state).toLowerCase() === 'closed' ? 'closed' : 'open') : undefined,
      issueSource: existing.issue ? 'existing' : undefined,
      prUrl: existing.pullRequest?.url,
      prNumber: existing.pullRequest?.number,
      prTitle: existing.pullRequest?.title,
      prState: existing.pullRequest
        ? (existing.pullRequest.mergedAt ? 'merged' : String(existing.pullRequest.state).toLowerCase() === 'closed' ? 'closed' : 'open')
        : undefined,
      mergedAt: existing.pullRequest?.mergedAt ?? undefined,
      githubCheckedAt: new Date().toISOString(),
    }, cwd);
    const duplicateUrl = existing.pullRequest?.url ?? existing.issue?.url;
    emit(options, existing.pullRequest?.mergedAt
      ? `Work already merged: ${existing.pullRequest.url}`
      : existing.pullRequest
        ? `Pull request already exists: ${existing.pullRequest.url}`
        : `Issue already exists: ${existing.issue?.url}`);
    return {
      command: `ft theories issue ${theory.id}`,
      repo,
      title: `${theory.displayId}: ${theory.title}`,
      body: buildTheoryIssue(theory, buildAssessmentMarkdown(assessment)).body,
      url: duplicateUrl,
      prUrl: nextState.prUrl,
      mergedAt: nextState.mergedAt,
      created: false,
      alreadyExists: true,
      theory,
    };
  }

  const issue = buildTheoryIssue(theory, buildAssessmentMarkdown(assessment));
  const result = await createGitHubIssue(repo, issue.title, issue.body, options);
  if (result.url) {
    await patchTheoryState(theory.id, {
      issueUrl: result.url,
      issueRepo: repo,
      issueTitle: issue.title,
      issueState: 'open',
      issueSource: 'created',
      lastIssueAt: new Date().toISOString(),
      githubCheckedAt: new Date().toISOString(),
    }, cwd);
  }
  return { ...result, theory };
}

export async function createBookmarkIssue(
  bookmarkId: string,
  options: BookmarkIssueOptions = {}
): Promise<IssueCreationResult & { bookmark: BookmarkTimelineItem }> {
  const cwd = options.cwd ?? process.cwd();
  const bookmark = await getBookmarkById(bookmarkId, cwd);
  if (!bookmark) {
    throw new Error(`Unknown bookmark: ${bookmarkId}`);
  }

  const repo = options.repo ?? inferGitHubRepoFromBookmark(bookmark);
  if (!repo) {
    throw new Error('Could not infer a GitHub repo from this bookmark. Pass --repo owner/name.');
  }

  const issue = buildBookmarkIssue(bookmark);
  const result = await createGitHubIssue(repo, issue.title, issue.body, options);
  if (result.url) {
    await patchBookmarkState(bookmark.id, {
      issueUrl: result.url,
      issueRepo: repo,
      lastIssueAt: new Date().toISOString(),
    }, cwd);
  }
  return { ...result, bookmark };
}

export async function debateTheory(
  theoryId: string,
  options: DebateOptions = {}
): Promise<DebateResult & { theory: TheoryItem }> {
  const cwd = options.cwd ?? process.cwd();
  const theory = await getTheoryItem(theoryId, options.theoriesRootDir);
  if (!theory) {
    throw new Error(`Unknown theory: ${normalizeTheoryId(theoryId)}`);
  }

  const topic = [
    `Debate this Field Theory finding and decide the highest-value next move.`,
    `${theory.displayId}: ${theory.title}`,
    `What we found:\n${theory.whatWeFound}`,
    `What to do:\n${theory.whatToDo}`,
    theory.confidence ? `Confidence: ${theory.confidence}` : '',
    theory.bookmarksLabel ? `Bookmarks: ${theory.bookmarksLabel}` : '',
  ].filter(Boolean).join('\n\n');

  const result = await runCouncil(topic, {
    ...options,
    cwd,
    repoPath: theory.transcriptMeta.repoPath ?? undefined,
  });
  await patchTheoryState(theory.id, {
    debateTranscriptPath: result.transcriptPath,
    debateConsensusPath: result.consensusPath,
    lastDebateAt: new Date().toISOString(),
  }, cwd);
  return { ...result, theory };
}

export async function debateBookmark(
  bookmarkId: string,
  options: DebateOptions = {}
): Promise<DebateResult & { bookmark: BookmarkTimelineItem }> {
  const cwd = options.cwd ?? process.cwd();
  const bookmark = await getBookmarkById(bookmarkId, cwd);
  if (!bookmark) {
    throw new Error(`Unknown bookmark: ${bookmarkId}`);
  }

  const topic = [
    'Debate this bookmark and turn it into concrete, worthwhile next steps.',
    `Source: ${bookmark.url}`,
    `Author: ${bookmark.authorHandle ? `@${bookmark.authorHandle}` : 'unknown'}`,
    bookmark.text,
    bookmark.links.length ? `Linked URLs:\n${bookmark.links.map((url) => `- ${url}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const result = await runCouncil(topic, {
    ...options,
    cwd,
  });
  await patchBookmarkState(bookmark.id, {
    debateTranscriptPath: result.transcriptPath,
    debateConsensusPath: result.consensusPath,
    lastDebateAt: new Date().toISOString(),
  }, cwd);
  return { ...result, bookmark };
}
