import { app, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { EventEmitter } from 'events';
import * as chokidar from 'chokidar';
import { UserDataManager } from './userDataManager';
import { createLogger } from './logger';
import { commandsDir, libraryDir } from './fieldTheoryPaths';
import { hasExistingLibraryContent } from './librarianSetupState';
import { type DocumentSaveResult, type DocumentVersion, readDocumentVersion, writeTextFileWithConflictGuard } from './documentSaveGuard';
import {
  existingPathInsideRoots,
  getLibraryTextDocumentKind,
  isLibraryTextDocumentPath,
  isMarkdownDocumentPath,
  isPathInside,
  markdownFileNameFromUserInput,
  normalizeUserDocumentNameInput,
  normalizeUserDocumentRelPathInput,
  stripMarkdownFileExtension,
} from './pathSafety';
import {
  getMarkdownEditActor,
  parseMarkdownFrontmatter,
  parseMarkdownArchivedState,
  parseMarkdownContentEditedAt,
  parseMarkdownEditActor,
  parseMarkdownTodoState,
  stampMarkdownContentEditIfBodyChanged,
  type MarkdownEditActor,
  type MarkdownTodoState,
} from '../shared/markdownFrontmatter';

const log = createLogger('Librarian');
const RENAME_TRACE_ENABLED = process.env.LIBRARY_RENAME_TRACE === 'true';
let renameTraceSequence = 0;

function nextRenameTraceId(prefix: string): string {
  renameTraceSequence += 1;
  return `${prefix}-${Date.now()}-${renameTraceSequence}`;
}

function traceRename(stage: string, payload: Record<string, unknown>): void {
  if (!RENAME_TRACE_ENABLED) return;
  log.warn('[RenameTrace] %s %o', stage, payload);
}

const TOML_TABLE_HEADER_RE = /^\s*\[/;
const TOML_NOTIFY_LINE_RE = /^\s*notify\s*=.*$\n?/gm;
const TOML_WRITABLE_ROOTS_BLOCK_RE = /^\s*writable_roots\s*=\s*\[[\s\S]*?\]\s*\n?/gm;
const TOML_SANDBOX_WORKSPACE_WRITE_HEADER = '[sandbox_workspace_write]';
const MARKDOWN_HEADER_SCAN_LINE_COUNT = 40;
const WIKI_SKIP_FILE_NAMES = new Set(['md-state.json', 'index.md', 'log.md', 'schema.md']);
const WIKI_RESERVED_FOLDER_NAMES = new Set(['commands']);
const LIBRARIAN_INDEX_VERSION = 2;
const RIVER_SHARED_FOLDER_ID = 'River (shared)';
export const DEFAULT_LIBRARY_FOLDER_IDS = [
  'artifacts',
  'scratchpad',
  RIVER_SHARED_FOLDER_ID,
  'debates',
  'Plans',
  'bookmarks-shortcut',
  'bookmarks-from-x',
  'entries',
  'categories',
  'domains',
  'entities',
] as const;
export type LibraryDefaultFolderId = typeof DEFAULT_LIBRARY_FOLDER_IDS[number];
const DEFAULT_LIBRARY_FOLDER_ID_SET = new Set<string>(DEFAULT_LIBRARY_FOLDER_IDS);
export const DEFAULT_README_FOLDER_IDS = [
  'scratchpad',
  'debates',
  'Plans',
  'entries',
  'categories',
  'domains',
  'entities',
] as const;
export type LibraryReadmeFolderId = typeof DEFAULT_README_FOLDER_IDS[number];
const ARTIFACT_MODEL_SIGNATURE_MARKDOWN_RE = /^\*(?:Model|Signed by):\s*(.+?)\*$/i;
const ARTIFACT_MODEL_SIGNATURE_INSTRUCTION_RE = /\*(?:model|signed by):\s*/i;
const ARTIFACT_TITLE_INSTRUCTION_RE = /\btitle\s*\(#\s*heading\)|\bmarkdown\s+h1\s+title\b/i;
const ARTIFACT_MODEL_SIGNATURE_TEMPLATE = '*Model: <the exact model or assistant name that wrote this artifact>*';
const ARTIFACT_STRUCTURE_GUIDANCE = `Structure:
1. Title (# heading)
2. Signature metadata line: \`${ARTIFACT_MODEL_SIGNATURE_TEMPLATE}\`
3. 1-2 paragraphs connecting the task to engineering history, physics, systems theory, or speculative futures
4. Include at least one concrete technical/historical detail`;
const ARTIFACT_MODEL_SIGNATURE_GUIDANCE =
  `Include an italic metadata line near the top of the artifact in the form \`${ARTIFACT_MODEL_SIGNATURE_TEMPLATE}\`. If the exact model name is unavailable, use the assistant or runtime name you are operating as.`;
const DEFAULT_LIBRARIAN_RULE_CONTENT =
  buildEffectiveArtifactRuleContent(
    'Write a short reflective story (120-200 words) connecting current work to science/history.'
  );
const DEFAULT_LIBRARY_README_HELP = `## Useful Shortcuts

Invoke a portable command from any app with Command+Shift+K, type the command name, then press Enter.
Create or edit portable commands as Markdown files in a watched commands folder such as ~/.fieldtheory/library/Commands/.
Create a scratchpad note from anywhere with Control+Option+Command+Space.
Inside Library, use Command+N to create a page in the selected folder and Command+Shift+N to create a folder.
Use Command+F or / to search, Command+, to switch between rendered and Markdown, and Command+S to save Markdown edits.
`;

function normalizeDefaultReadmeContent(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

function isWikiSkipFileName(fileName: string): boolean {
  return WIKI_SKIP_FILE_NAMES.has(fileName)
    || WIKI_SKIP_FILE_NAMES.has(`${stripMarkdownFileExtension(fileName)}.md`);
}

function isWikiReservedRelPath(relPath: string): boolean {
  const firstPart = relPath.split(/[\\/]/, 1)[0]?.toLowerCase();
  return Boolean(firstPart && WIKI_RESERVED_FOLDER_NAMES.has(firstPart));
}

function buildDefaultReadmeWithHelp(content: string): string {
  return `${normalizeDefaultReadmeContent(content).trimEnd()}\n\n${DEFAULT_LIBRARY_README_HELP}`;
}

function buildDefaultFolderReadme(content: string, legacyContent: string): { content: string; legacyContents: string[] } {
  const normalizedLegacyContent = normalizeDefaultReadmeContent(legacyContent);
  return {
    content: buildDefaultReadmeWithHelp(content),
    legacyContents: [
      normalizedLegacyContent,
      buildDefaultReadmeWithHelp(normalizedLegacyContent),
    ],
  };
}

const CENTRAL_ARTIFACTS_README_CONTENT = normalizeDefaultReadmeContent(`# README: Artifacts

This is the Librarian artifacts folder.
Field Theory and its agent hooks write artifacts here: ~/.fieldtheory/librarian/artifacts/.

Artifacts are normal Markdown files. Right-click the Artifacts folder in Library and choose Show in Finder to inspect or manage them directly.
`);

const DEFAULT_FOLDER_READMES: ReadonlyArray<{
  id: LibraryReadmeFolderId;
  relPath: string;
  content: string;
  legacyContents: string[];
}> = [
  {
    id: 'scratchpad',
    relPath: 'scratchpad',
    ...buildDefaultFolderReadme(`# README: Scratchpad

Create a Scratchpad note from anywhere with Control+Option+Command+Space.
Use Scratchpad for quick notes and rough captures before they become entries.
`, `# Scratchpad

Drop quick notes here.
Use this folder for rough captures before they become entries.
`),
  },
  {
    id: 'debates',
    relPath: 'debates',
    ...buildDefaultFolderReadme(`# README: Debates

Run the portable command at ~/.fieldtheory/library/Commands/debate.md when you want a debate.
It starts a structured comparison between models or approaches, then saves the result so you can come back to the reasoning later.
`, `# Debates

Debates are structured notes for comparing approaches.
Use the portable command at .cursor/commands/debate.md when you want one generated.
`),
  },
  {
    id: 'Plans',
    relPath: 'Plans',
    ...buildDefaultFolderReadme(`# README: Plans

Run the portable command at ~/.fieldtheory/library/Commands/plan.md when you want a plan saved here.
It turns the current proposal or next steps into a Markdown plan with a clear filename, outside any repo, so the plan is easy to find later.
`, `# Plans

Run the portable command at ~/.fieldtheory/library/Commands/plan.md when you want a plan saved here.
It turns the current proposal or next steps into a Markdown plan with a clear filename, outside any repo, so the plan is easy to find later.
`),
  },
  {
    id: 'entries',
    relPath: 'entries',
    ...buildDefaultFolderReadme(`# README: Entries

Entries are durable wiki notes.
Use portable commands from ~/.fieldtheory/library/Commands/ when you want the app or an agent to create one.
`, `# Entries

Entries are durable wiki notes.
Use portable commands from .cursor/commands/ when you want the app or an agent to create one.
`),
  },
  {
    id: 'categories',
    relPath: 'categories',
    ...buildDefaultFolderReadme(`# README: Bookmark Categories

This folder helps power the Bookmarks from x.com view.
It groups synced bookmarks by category.
`, `# Bookmark Categories

This folder helps power the Bookmarks from x.com view.
It groups synced bookmarks by category.
`),
  },
  {
    id: 'domains',
    relPath: 'domains',
    ...buildDefaultFolderReadme(`# README: Bookmark Domains

This folder helps power the Bookmarks from x.com view.
It groups synced bookmarks by source domain.
`, `# Bookmark Domains

This folder helps power the Bookmarks from x.com view.
It groups synced bookmarks by source domain.
`),
  },
  {
    id: 'entities',
    relPath: 'entities',
    ...buildDefaultFolderReadme(`# README: Bookmark Entities

This folder helps power the Bookmarks from x.com view.
It groups synced bookmarks by people, projects, and other named entities.
`, `# Bookmark Entities

This folder helps power the Bookmarks from x.com view.
It groups synced bookmarks by people, projects, and other named entities.
`),
  },
];

type CursorHookEntry = {
  command?: string;
  matcher?: string;
  timeout?: number;
  [key: string]: unknown;
};

type CursorHooksConfig = {
  version?: number;
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
};

type TomlSection = {
  header: string;
  lines: string[];
};

type CodexHookEntry = {
  hooks?: Array<{ type?: string; command?: string; timeout_sec?: number }>;
};

type CodexHooksConfig = {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
};

const LEGACY_CODEX_SESSION_START_SCRIPT = 'codex-session-start.py';
const CODEX_STOP_SCRIPT = 'codex-stop.py';

function splitTomlTopLevel(content: string): { topLevel: string; tables: string } {
  const lines = content.split('\n');
  const firstTableIndex = lines.findIndex(line => TOML_TABLE_HEADER_RE.test(line));

  if (firstTableIndex === -1) {
    return { topLevel: content, tables: '' };
  }

  return {
    topLevel: lines.slice(0, firstTableIndex).join('\n'),
    tables: lines.slice(firstTableIndex).join('\n'),
  };
}

function tidyTomlSpacing(content: string): string {
  const trimmed = content.replace(/\n{3,}/g, '\n\n').trimEnd();
  return trimmed ? `${trimmed}\n` : '';
}

function normalizeHiddenLibraryFolderId(folderId: string): string | null {
  const normalized = folderId.trim().replace(/\\/g, '/').split('/').filter(Boolean).join('/');
  if (!normalized) return null;
  if (normalized.split('/').some((part) => part === '.' || part === '..')) return null;
  return normalized;
}

export function normalizeHiddenDefaultFolders(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const requested = new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeHiddenLibraryFolderId)
      .filter((item): item is string => item !== null)
  );
  return [
    ...DEFAULT_LIBRARY_FOLDER_IDS.filter((folderId) => folderId !== RIVER_SHARED_FOLDER_ID && requested.has(folderId)),
    ...[...requested].filter((folderId) => folderId !== RIVER_SHARED_FOLDER_ID && !DEFAULT_LIBRARY_FOLDER_ID_SET.has(folderId)),
  ];
}

export function normalizeSeededReadmes(value: unknown): LibraryReadmeFolderId[] {
  if (!Array.isArray(value)) return [];
  const requested = new Set(value.filter((item): item is string => typeof item === 'string'));
  return DEFAULT_README_FOLDER_IDS.filter((folderId) => requested.has(folderId));
}

function upsertTopLevelTomlBlock(content: string, block: string): string {
  const { topLevel, tables } = splitTomlTopLevel(content);
  const trimmedTopLevel = topLevel.trimEnd();
  const trimmedTables = tables.replace(/^\n+/, '').trimEnd();

  if (!trimmedTopLevel && !trimmedTables) {
    return `\n${block}\n`;
  }

  if (!trimmedTables) {
    return trimmedTopLevel ? `${trimmedTopLevel}\n${block}\n` : `\n${block}\n`;
  }

  if (!trimmedTopLevel) {
    return `${block}\n\n${trimmedTables}\n`;
  }

  return `${trimmedTopLevel}\n${block}\n\n${trimmedTables}\n`;
}

function splitTomlSections(content: string): { topLevelLines: string[]; sections: TomlSection[] } {
  const lines = content.split('\n');
  const topLevelLines: string[] = [];
  const sections: TomlSection[] = [];
  let currentSection: TomlSection | null = null;

  for (const line of lines) {
    if (TOML_TABLE_HEADER_RE.test(line)) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = { header: line.trimEnd(), lines: [] };
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    } else {
      topLevelLines.push(line);
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return { topLevelLines, sections };
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start] === '') {
    start += 1;
  }

  while (end > start && lines[end - 1] === '') {
    end -= 1;
  }

  return lines.slice(start, end);
}

function serializeTomlSections(topLevelLines: string[], sections: TomlSection[]): string {
  const parts: string[] = [];
  const topLevel = trimBlankLines(topLevelLines).join('\n');

  if (topLevel) {
    parts.push(topLevel);
  }

  for (const section of sections) {
    const body = trimBlankLines(section.lines).join('\n');
    parts.push(body ? `${section.header}\n${body}` : section.header);
  }

  return parts.length ? `${parts.join('\n\n')}\n` : '';
}

function collectWritableRoots(content: string): string[] {
  const blocks = [...content.matchAll(/^\s*writable_roots\s*=\s*\[([\s\S]*?)\]\s*$/gm)];
  return blocks.flatMap(([, items]) =>
    [...items.matchAll(/"([^"]+)"/g)].map(match => match[1])
  );
}

// ===========================================================================
// Pure TOML editing helpers (exported for testing)
// ===========================================================================

/**
 * Add a `notify` command to TOML content. Replaces existing notify line
 * or inserts it at the top level if absent. Returns updated content.
 */
export function tomlSetNotify(content: string, commandParts: string[]): string {
  const notifyLine = `notify = [${commandParts.map(part => JSON.stringify(part)).join(', ')}]`;
  const { topLevel, tables } = splitTomlTopLevel(content);

  if (topLevel.split('\n').some(line => line.trim() === notifyLine) && !tables.match(/^\s*notify\s*=/m)) {
    return content;
  }

  const withoutNotify = content.replace(TOML_NOTIFY_LINE_RE, '');
  return upsertTopLevelTomlBlock(withoutNotify, notifyLine);
}

/**
 * Remove a `notify` line that matches the given script name from TOML content.
 */
export function tomlRemoveNotify(content: string, scriptName: string): string {
  const escaped = scriptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tidyTomlSpacing(content.replace(new RegExp(`^\\s*notify\\s*=.*${escaped}.*$\\n?`, 'gm'), ''));
}

/**
 * Add a path to the `writable_roots` array in TOML content.
 * Creates the array if absent, appends to it if present, and keeps it
 * in the current Codex `[sandbox_workspace_write]` table.
 */
export function tomlAddWritableRoot(content: string, dirPath: string): string {
  const roots = [...new Set(collectWritableRoots(content))];
  const normalizedRoots = roots.includes(dirPath) ? roots : [...roots, dirPath];
  const withoutWritableRoots = tidyTomlSpacing(content.replace(TOML_WRITABLE_ROOTS_BLOCK_RE, ''));
  const { topLevelLines, sections } = splitTomlSections(withoutWritableRoots);
  const sandboxSection = sections.find(section => section.header.trim() === TOML_SANDBOX_WORKSPACE_WRITE_HEADER);
  const sandboxLines = trimBlankLines(sandboxSection?.lines ?? []);
  const writableRootsBlockLines = [
    'writable_roots = [',
    ...normalizedRoots.map(root => `  "${root}"${root === normalizedRoots[normalizedRoots.length - 1] ? '' : ','}`),
    ']',
  ];

  if (roots.includes(dirPath) && sandboxSection && sandboxLines.some(line => line.includes(dirPath))) {
    return content;
  }

  if (sandboxSection) {
    sandboxSection.lines = sandboxLines.length > 0
      ? [...sandboxLines, '', ...writableRootsBlockLines]
      : writableRootsBlockLines;
  } else {
    sections.unshift({
      header: TOML_SANDBOX_WORKSPACE_WRITE_HEADER,
      lines: writableRootsBlockLines,
    });
  }

  return serializeTomlSections(topLevelLines, sections);
}

/**
 * Remove a path from the `writable_roots` array in TOML content.
 * Cleans up empty arrays and keeps remaining roots in `[sandbox_workspace_write]`.
 */
export function tomlRemoveWritableRoot(content: string, dirPath: string): string {
  const hadWritableRoots = TOML_WRITABLE_ROOTS_BLOCK_RE.test(content);
  TOML_WRITABLE_ROOTS_BLOCK_RE.lastIndex = 0;

  if (!hadWritableRoots) {
    return content;
  }

  const remainingRoots = [...new Set(collectWritableRoots(content))].filter(root => root !== dirPath);
  const withoutWritableRoots = tidyTomlSpacing(content.replace(TOML_WRITABLE_ROOTS_BLOCK_RE, ''));
  const { topLevelLines, sections } = splitTomlSections(withoutWritableRoots);
  const sandboxIndex = sections.findIndex(section => section.header.trim() === TOML_SANDBOX_WORKSPACE_WRITE_HEADER);

  if (remainingRoots.length === 0) {
    if (sandboxIndex === -1) {
      return withoutWritableRoots;
    }

    const sandboxLines = trimBlankLines(sections[sandboxIndex].lines);
    if (sandboxLines.length === 0) {
      sections.splice(sandboxIndex, 1);
    } else {
      sections[sandboxIndex].lines = sandboxLines;
    }

    return serializeTomlSections(topLevelLines, sections);
  }

  const writableRootsBlockLines = [
    'writable_roots = [',
    ...remainingRoots.map(root => `  "${root}"${root === remainingRoots[remainingRoots.length - 1] ? '' : ','}`),
    ']',
  ];

  if (sandboxIndex === -1) {
    sections.unshift({
      header: TOML_SANDBOX_WORKSPACE_WRITE_HEADER,
      lines: writableRootsBlockLines,
    });
    return serializeTomlSections(topLevelLines, sections);
  }

  const sandboxLines = trimBlankLines(sections[sandboxIndex].lines);
  sections[sandboxIndex].lines = sandboxLines.length > 0
    ? [...sandboxLines, '', ...writableRootsBlockLines]
    : writableRootsBlockLines;

  return serializeTomlSections(topLevelLines, sections);
}

/**
 * Add or remove a managed section in markdown content, delimited by HTML comments.
 */
export function managedSectionUpsert(content: string, marker: string, section: string): string {
  if (content.includes(marker)) return content;
  return content.trimEnd() + '\n' + section;
}

export function managedSectionRemove(content: string, startMarker: string, endMarker: string): string {
  const startEscaped = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const endEscaped = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.replace(
    new RegExp(`\\n?${startEscaped}[\\s\\S]*?${endEscaped}\\n?`),
    ''
  );
}

function getCursorNestedHookEntries(config: CursorHooksConfig, eventName: string): CursorHookEntry[] {
  if (!config.hooks || typeof config.hooks !== 'object') {
    config.hooks = {};
  }

  const hooks = config.hooks as Record<string, unknown>;
  if (!Array.isArray(hooks[eventName])) {
    hooks[eventName] = [];
  }

  return hooks[eventName] as CursorHookEntry[];
}

function cursorHookMatchesScript(entry: unknown, scriptName: string): boolean {
  return typeof (entry as CursorHookEntry | undefined)?.command === 'string'
    && ((entry as CursorHookEntry).command as string).includes(scriptName);
}

export function hasCursorCommandHook(config: CursorHooksConfig, eventName: string, scriptName: string): boolean {
  const nestedHooks = config.hooks && typeof config.hooks === 'object'
    ? (config.hooks as Record<string, unknown>)[eventName]
    : undefined;
  const legacyHooks = config[eventName];

  return (Array.isArray(nestedHooks) && nestedHooks.some(entry => cursorHookMatchesScript(entry, scriptName)))
    || (Array.isArray(legacyHooks) && legacyHooks.some(entry => cursorHookMatchesScript(entry, scriptName)));
}

export function upsertCursorCommandHook(
  config: CursorHooksConfig,
  eventName: string,
  entry: CursorHookEntry,
  scriptName: string,
): CursorHooksConfig {
  if (!config.version) {
    config.version = 1;
  }

  const hooks = config.hooks && typeof config.hooks === 'object'
    ? config.hooks as Record<string, unknown>
    : (config.hooks = {});
  const existingNested = Array.isArray(hooks[eventName]) ? hooks[eventName] as CursorHookEntry[] : [];
  hooks[eventName] = existingNested.filter(existing => !cursorHookMatchesScript(existing, scriptName));
  (hooks[eventName] as CursorHookEntry[]).push(entry);

  if (Array.isArray(config[eventName])) {
    const filteredLegacy = (config[eventName] as CursorHookEntry[])
      .filter(existing => !cursorHookMatchesScript(existing, scriptName));
    if (filteredLegacy.length > 0) {
      config[eventName] = filteredLegacy;
    } else {
      delete config[eventName];
    }
  }

  return config;
}

export function removeCursorCommandHook(
  config: CursorHooksConfig,
  eventName: string,
  scriptName: string,
): CursorHooksConfig {
  if (config.hooks && typeof config.hooks === 'object') {
    const hooks = config.hooks as Record<string, unknown>;
    if (Array.isArray(hooks[eventName])) {
      const filtered = (hooks[eventName] as CursorHookEntry[])
        .filter(existing => !cursorHookMatchesScript(existing, scriptName));
      if (filtered.length > 0) {
        hooks[eventName] = filtered;
      } else {
        delete hooks[eventName];
      }
    }

    if (Object.keys(hooks).length === 0) {
      delete config.hooks;
    }
  }

  if (Array.isArray(config[eventName])) {
    const filteredLegacy = (config[eventName] as CursorHookEntry[])
      .filter(existing => !cursorHookMatchesScript(existing, scriptName));
    if (filteredLegacy.length > 0) {
      config[eventName] = filteredLegacy;
    } else {
      delete config[eventName];
    }
  }

  return config;
}

export function generateCursorBeforeSubmitHookScript(version = '2.0'): string {
  return `#!/usr/bin/env python3
# Field Theory Librarian Cursor Hook v${version}
"""
Field Theory Librarian Hook for Cursor (beforeSubmitPrompt)

Counts prompts and creates project-scoped job files when threshold is reached.
If the current project already has a pending job, or one is created now, the
prompt is blocked with explicit instructions before any tool runs.
"""
import json
import os
import sys
import fcntl
from pathlib import Path
from datetime import datetime

DEFAULT_THRESHOLD = 7
DEFAULT_RULE_CONTENT = ${JSON.stringify(DEFAULT_LIBRARIAN_RULE_CONTENT)}


def load_stdin():
    try:
        import select
        if select.select([sys.stdin], [], [], 0.0)[0]:
            return json.load(sys.stdin)
    except:
        pass
    return {}


def resolve_project_root(input_data):
    workspace_roots = input_data.get("workspace_roots") or input_data.get("workspaceRoots") or []
    if isinstance(workspace_roots, list):
        for root in workspace_roots:
            if root:
                try:
                    return Path(root).resolve()
                except:
                    pass

    env_root = os.environ.get("CURSOR_PROJECT_DIR") or os.getcwd()
    return Path(env_root).resolve()


def paths_match(left, right):
    if not left or not right:
        return False
    try:
        return Path(left).resolve() == Path(right).resolve()
    except:
        return False


def find_pending_job(jobs_dir, project_root):
    if not jobs_dir.exists():
        return None

    for job_file in sorted(jobs_dir.glob("job_*.json"), reverse=True):
        try:
            job = json.loads(job_file.read_text())
            if job.get("status") != "pending":
                continue
            if not paths_match(job.get("project_path"), project_root):
                continue
            return job_file, job
        except:
            continue

    return None


def load_rule_content(config_path):
    if not config_path.exists():
        return DEFAULT_RULE_CONTENT
    try:
        cfg = json.loads(config_path.read_text())
        return cfg.get("rule_content", DEFAULT_RULE_CONTENT)
    except:
        return DEFAULT_RULE_CONTENT


def emit_block(job_file, output_path, rule_content):
    message = f"""[LIBRARIAN] Pending artifact job must be completed first.

Job file: {job_file}
Output path: {output_path}

Rule: {rule_content}

Steps:
1. Write the artifact to the output path following the rule above
2. Update the job file, setting "status" to "done"
3. Retry your original prompt"""
    print(json.dumps({
        "continue": False,
        "user_message": message
    }))


def main():
    input_data = load_stdin()
    project_root = resolve_project_root(input_data)
    project_name = project_root.name

    central_dir = Path.home() / ".fieldtheory" / "librarian"
    config_path = central_dir / "config.json"
    state_file = central_dir / "state.json"
    jobs_dir = central_dir / "jobs"
    artifacts_dir = central_dir / "artifacts"
    rules_dir = central_dir / "rules"
    rule_file = rules_dir / "history_reading.md"
    lock_file = central_dir / ".lock"
    seq_file = central_dir / ".seq"

    if not config_path.exists():
        return

    with open(config_path) as f:
        cfg = json.load(f)

    if not cfg.get("enabled", False):
        return

    if state_file.exists():
        try:
            import time
            state_data = json.loads(state_file.read_text())
            muted_until = state_data.get("mutedUntil", 0)
            if muted_until and time.time() * 1000 < muted_until:
                return
        except:
            pass

    rule_content = load_rule_content(config_path)
    pending_job = find_pending_job(jobs_dir, project_root)
    if pending_job:
        job_file, job = pending_job
        emit_block(job_file, job.get("output"), rule_content)
        return

    jobs_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    rules_dir.mkdir(parents=True, exist_ok=True)

    with open(lock_file, "w") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)

        state = {"count": 0, "threshold": DEFAULT_THRESHOLD}
        if state_file.exists():
            try:
                state = json.loads(state_file.read_text())
            except:
                pass

        count = state.get("count", 0) + 1
        threshold = state.get("threshold", DEFAULT_THRESHOLD)
        triggered = count >= threshold

        state["count"] = 0 if triggered else count
        state_file.write_text(json.dumps(state, indent=2))

        if not triggered:
            return

        seq = 0
        if seq_file.exists():
            try:
                seq = int(seq_file.read_text().strip())
            except:
                seq = 0
        seq += 1
        while (jobs_dir / f"job_{seq}.json").exists():
            seq += 1
        seq_file.write_text(str(seq))

        timestamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        job_file = jobs_dir / f"job_{seq}.json"
        out_file = artifacts_dir / f"{project_name}-{timestamp}-artifact.md"

        for old_job_file in list(jobs_dir.glob("job_*.json")) + list(jobs_dir.glob("cursor-job_*.json")):
            if old_job_file == job_file:
                continue
            try:
                old_job = json.loads(old_job_file.read_text())
                if old_job.get("status") == "pending":
                    old_job["status"] = "abandoned"
                    old_job["abandoned_at"] = datetime.now().isoformat()
                    old_job_file.write_text(json.dumps(old_job, indent=2) + "\\n")
            except:
                continue

        if not job_file.exists():
            job_file.write_text(json.dumps({
                "schema_version": 1,
                "id": seq,
                "type": "history_artifact",
                "status": "pending",
                "project": project_name,
                "project_path": str(project_root),
                "output": str(out_file),
                "rule_file": str(rule_file),
                "created_at": datetime.now().isoformat()
            }, indent=2) + "\\n")

        emit_block(job_file, out_file, rule_content)


if __name__ == "__main__":
    main()
`;
}

export function generateCursorPreToolHookScript(version = '2.0'): string {
  return `#!/usr/bin/env python3
# Field Theory Librarian PreToolUse Hook v${version}
"""
Field Theory Librarian PreToolUse Hook for Cursor

Fallback gate for tool use when the current project still has a pending
artifact job. Allows direct operations in the librarian directory so the
artifact can be written and the job marked done.
"""
import json
import os
import sys
from pathlib import Path

LIBRARIAN_DIR = Path.home() / ".fieldtheory" / "librarian"
CONFIG_PATH = LIBRARIAN_DIR / "config.json"
DEFAULT_RULE_CONTENT = ${JSON.stringify(DEFAULT_LIBRARIAN_RULE_CONTENT)}


def load_stdin():
    try:
        import select
        if select.select([sys.stdin], [], [], 0.0)[0]:
            return json.load(sys.stdin)
    except:
        pass
    return {}


def extract_file_path(input_data):
    if "arguments" in input_data and isinstance(input_data["arguments"], dict):
        args = input_data["arguments"]
        for key in ("file_path", "path", "filePath"):
            if args.get(key):
                return args.get(key)

    if "tool_input" in input_data and isinstance(input_data["tool_input"], dict):
        tool_input = input_data["tool_input"]
        for key in ("file_path", "path", "filePath"):
            if tool_input.get(key):
                return tool_input.get(key)

    return ""


def resolve_project_root(input_data, file_path):
    workspace_roots = input_data.get("workspace_roots") or input_data.get("workspaceRoots") or []
    if isinstance(workspace_roots, list):
        for root in workspace_roots:
            if root:
                try:
                    return Path(root).resolve()
                except:
                    pass

    env_root = os.environ.get("CURSOR_PROJECT_DIR")
    if env_root:
        try:
            return Path(env_root).resolve()
        except:
            pass

    if file_path:
        try:
            candidate = Path(file_path).resolve()
            return candidate if candidate.is_dir() else candidate.parent
        except:
            pass

    return Path(os.getcwd()).resolve()


def paths_match(left, right):
    if not left or not right:
        return False
    try:
        return Path(left).resolve() == Path(right).resolve()
    except:
        return False


def find_pending_job(project_root):
    jobs_dir = LIBRARIAN_DIR / "jobs"
    if not jobs_dir.exists():
        return None

    for job_file in sorted(jobs_dir.glob("job_*.json"), reverse=True):
        try:
            job = json.loads(job_file.read_text())
            if job.get("status") != "pending":
                continue
            if not paths_match(job.get("project_path"), project_root):
                continue
            return job_file, job
        except:
            continue

    return None


def load_rule_content():
    if not CONFIG_PATH.exists():
        return DEFAULT_RULE_CONTENT
    try:
        cfg = json.loads(CONFIG_PATH.read_text())
        return cfg.get("rule_content", DEFAULT_RULE_CONTENT)
    except:
        return DEFAULT_RULE_CONTENT


def main():
    input_data = load_stdin()
    file_path = extract_file_path(input_data)

    if file_path and file_path.startswith(str(LIBRARIAN_DIR)):
        print(json.dumps({"decision": "allow"}))
        return

    project_root = resolve_project_root(input_data, file_path)
    pending_job = find_pending_job(project_root)
    if not pending_job:
        print(json.dumps({"decision": "allow"}))
        return

    job_file, job = pending_job
    rule_content = load_rule_content()
    reason = f"""[LIBRARIAN] Pending artifact job must be completed first.

Job file: {job_file}
Output path: {job.get('output')}

Rule: {rule_content}

Steps:
1. Write the artifact to the output path following the rule above
2. Update the job file, setting "status" to "done"
3. Retry your original tool operation"""

    print(json.dumps({"decision": "deny", "reason": reason}))
    sys.exit(2)


if __name__ == "__main__":
    main()
`;
}

function codexHookMatchesScript(entry: unknown, scriptName: string): boolean {
  return typeof (entry as CodexHookEntry | undefined)?.hooks !== 'undefined'
    && Array.isArray((entry as CodexHookEntry | undefined)?.hooks)
    && (entry as CodexHookEntry).hooks!.some(hook => typeof hook.command === 'string' && hook.command.includes(scriptName));
}

export function hasCodexCommandHook(config: CodexHooksConfig, eventName: string, scriptName: string): boolean {
  const eventHooks = config.hooks && typeof config.hooks === 'object'
    ? (config.hooks as Record<string, unknown>)[eventName]
    : undefined;

  return Array.isArray(eventHooks) && eventHooks.some(entry => codexHookMatchesScript(entry, scriptName));
}

export function upsertCodexCommandHook(
  config: CodexHooksConfig,
  eventName: string,
  entry: CodexHookEntry,
  scriptName: string,
): CodexHooksConfig {
  if (!config.hooks || typeof config.hooks !== 'object') {
    config.hooks = {};
  }

  const hooks = config.hooks as Record<string, unknown>;
  const existing = Array.isArray(hooks[eventName]) ? hooks[eventName] as CodexHookEntry[] : [];
  hooks[eventName] = existing.filter(existingEntry => !codexHookMatchesScript(existingEntry, scriptName));
  (hooks[eventName] as CodexHookEntry[]).push(entry);

  return config;
}

export function removeCodexCommandHook(
  config: CodexHooksConfig,
  eventName: string,
  scriptName: string,
): CodexHooksConfig {
  if (!config.hooks || typeof config.hooks !== 'object') {
    return config;
  }

  const hooks = config.hooks as Record<string, unknown>;
  if (!Array.isArray(hooks[eventName])) {
    return config;
  }

  const filtered = (hooks[eventName] as CodexHookEntry[]).filter(entry => !codexHookMatchesScript(entry, scriptName));
  if (filtered.length > 0) {
    hooks[eventName] = filtered;
  } else {
    delete hooks[eventName];
  }

  if (Object.keys(hooks).length === 0) {
    delete config.hooks;
  }

  return config;
}

function generateCodexHookSharedPython(): string {
  return `
import json
from pathlib import Path

LIBRARIAN_DIR = Path.home() / ".fieldtheory" / "librarian"
CONFIG_PATH = LIBRARIAN_DIR / "config.json"
JOBS_DIR = LIBRARIAN_DIR / "jobs"
SENTINEL_FILE = LIBRARIAN_DIR / ".codex-pending"
CODEX_DIR = Path.home() / ".codex"
CODEX_HOOKS_PATH = CODEX_DIR / "hooks.json"
CODEX_STOP_SCRIPT = LIBRARIAN_DIR / "codex-stop.py"
DEFAULT_RULE_CONTENT = ${JSON.stringify(DEFAULT_LIBRARIAN_RULE_CONTENT)}


def load_config():
    if not CONFIG_PATH.exists():
        return None
    try:
        cfg = json.loads(CONFIG_PATH.read_text())
        if not cfg.get("enabled", False):
            return None
        return cfg
    except:
        return None


def should_stop_on_pending(cfg):
    return cfg.get("stop_on_pending") is True


def is_muted():
    state_file = LIBRARIAN_DIR / "state.json"
    if not state_file.exists():
        return False
    try:
        import time
        state_data = json.loads(state_file.read_text())
        muted_until = state_data.get("mutedUntil", 0)
        return bool(muted_until and time.time() * 1000 < muted_until)
    except:
        return False


def find_pending_job():
    if not JOBS_DIR.exists():
        return None

    for job_file in sorted(JOBS_DIR.glob("job_*.json"), reverse=True):
        try:
            job = json.loads(job_file.read_text())
            if job.get("status") == "pending":
                return job_file, job
        except:
            continue

    return None


def abandon_pending_job(job_file, job, reason):
    try:
        next_job = dict(job) if isinstance(job, dict) else {}
        next_job["status"] = "abandoned"
        next_job["abandoned_reason"] = reason
        from datetime import datetime
        next_job["abandoned_at"] = datetime.now().isoformat()
        job_file.write_text(json.dumps(next_job, indent=2) + "\\n")
    except:
        pass


def get_rule_file_path(job):
    rule_file = job.get("rule_file") if isinstance(job, dict) else None
    if isinstance(rule_file, str) and rule_file.strip():
        return rule_file
    return str(LIBRARIAN_DIR / "rules" / "history_reading.md")


def build_stop_reason(job_file, job):
    output_path = job.get("output", "") if isinstance(job, dict) else ""
    rule_file = get_rule_file_path(job)
    return f"""[LIBRARIAN] Complete the pending artifact before replying.

Job file: {job_file}
Output path: {output_path}
Rule file: {rule_file}

Steps:
1. Write the artifact to the output path
2. Follow the rule file for the required format
3. Update the job file, setting "status" to "done"
4. Then you may complete"""


def load_codex_hooks_config():
    if not CODEX_HOOKS_PATH.exists():
        return {"hooks": {}}
    try:
        config = json.loads(CODEX_HOOKS_PATH.read_text())
        return config if isinstance(config, dict) else {"hooks": {}}
    except:
        return {"hooks": {}}


def ensure_codex_hooks_root(config):
    hooks = config.get("hooks")
    if not isinstance(hooks, dict):
        hooks = {}
        config["hooks"] = hooks
    return hooks


def codex_hook_matches_script(entry, script_path):
    hooks = entry.get("hooks") if isinstance(entry, dict) else None
    if not isinstance(hooks, list):
        return False
    for hook in hooks:
        command = hook.get("command") if isinstance(hook, dict) else None
        if isinstance(command, str) and str(script_path) in command:
            return True
    return False


def sync_stop_hook(enabled):
    config = load_codex_hooks_config()
    hooks = ensure_codex_hooks_root(config)
    stop_entries = hooks.get("Stop")
    if not isinstance(stop_entries, list):
        stop_entries = []

    stop_entries = [
        entry for entry in stop_entries
        if not codex_hook_matches_script(entry, CODEX_STOP_SCRIPT)
    ]

    if enabled:
        stop_entries.append({
            "hooks": [{
                "type": "command",
                "command": f"python3 {CODEX_STOP_SCRIPT}",
                "timeout_sec": 10
            }]
        })

    if stop_entries:
        hooks["Stop"] = stop_entries
    elif "Stop" in hooks:
        del hooks["Stop"]

    if not hooks:
        config.pop("hooks", None)

    CODEX_DIR.mkdir(parents=True, exist_ok=True)
    CODEX_HOOKS_PATH.write_text(json.dumps(config, indent=2))
`;
}

export function generateCodexNotifyHookScript(): string {
  return `#!/usr/bin/env python3
"""
Field Theory Librarian Notify Hook for Codex CLI (AfterAgent)

Counts agent turns and creates job files when threshold is reached.
Registers the Stop hook only while a Librarian artifact is pending.

State is GLOBAL at ~/.fieldtheory/librarian/state.json
"""
${generateCodexHookSharedPython()}
import os
import fcntl
from datetime import datetime

DEFAULT_THRESHOLD = 7


def main():
    cfg = load_config()
    if not cfg:
        SENTINEL_FILE.unlink(missing_ok=True)
        sync_stop_hook(False)
        return

    central_dir = LIBRARIAN_DIR
    jobs_dir = central_dir / "jobs"
    artifacts_dir = central_dir / "artifacts"
    rules_dir = central_dir / "rules"
    rule_file = rules_dir / "history_reading.md"
    state_file = central_dir / "state.json"
    lock_file = central_dir / ".lock"
    seq_file = central_dir / ".seq"

    if is_muted():
        return

    pending_job = find_pending_job()
    if pending_job:
        job_file, job = pending_job
        if should_stop_on_pending(cfg):
            SENTINEL_FILE.write_text(json.dumps({
                "job_file": str(job_file),
                "output": job.get("output", ""),
                "created_at": datetime.now().isoformat()
            }, indent=2))
            sync_stop_hook(True)
            return

        abandon_pending_job(job_file, job, "codex_non_blocking_superseded")
        SENTINEL_FILE.unlink(missing_ok=True)
        sync_stop_hook(False)

    jobs_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    rules_dir.mkdir(parents=True, exist_ok=True)

    project_root = Path(os.getcwd())
    project_name = project_root.name

    with open(lock_file, "w") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)

        state = {"count": 0, "threshold": DEFAULT_THRESHOLD}
        if state_file.exists():
            try:
                state = json.loads(state_file.read_text())
            except:
                pass

        count = state.get("count", 0) + 1
        threshold = state.get("threshold", DEFAULT_THRESHOLD)
        triggered = count >= threshold

        state["count"] = 0 if triggered else count
        state_file.write_text(json.dumps(state, indent=2))

        if not triggered:
            SENTINEL_FILE.unlink(missing_ok=True)
            sync_stop_hook(False)
            return

        seq = 0
        if seq_file.exists():
            try:
                seq = int(seq_file.read_text().strip())
            except:
                seq = 0
        seq += 1
        while (jobs_dir / f"job_{seq}.json").exists():
            seq += 1
        seq_file.write_text(str(seq))

        timestamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        job_file = jobs_dir / f"job_{seq}.json"
        out_file = artifacts_dir / f"{project_name}-{timestamp}-artifact.md"

        for old_job_file in sorted(jobs_dir.glob("job_*.json")):
            if old_job_file == job_file:
                continue
            try:
                old_job = json.loads(old_job_file.read_text())
                if old_job.get("status") == "pending":
                    old_job["status"] = "abandoned"
                    old_job["abandoned_at"] = datetime.now().isoformat()
                    old_job_file.write_text(json.dumps(old_job, indent=2) + "\\n")
            except:
                continue

        if not job_file.exists():
            job_file.write_text(json.dumps({
                "schema_version": 1,
                "id": seq,
                "type": "history_artifact",
                "status": "pending",
                "project": project_name,
                "project_path": str(project_root),
                "output": str(out_file),
                "rule_file": str(rule_file),
                "created_at": datetime.now().isoformat()
            }, indent=2) + "\\n")

        SENTINEL_FILE.write_text(json.dumps({
            "job_file": str(job_file),
            "output": str(out_file),
            "created_at": datetime.now().isoformat()
        }, indent=2))
        sync_stop_hook(should_stop_on_pending(cfg))


if __name__ == "__main__":
    main()
`;
}

export function generateCodexStopScript(): string {
  return `#!/usr/bin/env python3
"""
Field Theory Librarian Stop Hook for Codex CLI

Blocks agent from completing when any Librarian artifact job is
pending. The model must write the artifact and mark the job done
before proceeding.
"""
${generateCodexHookSharedPython()}

def main():
    cfg = load_config()
    if not cfg:
        SENTINEL_FILE.unlink(missing_ok=True)
        sync_stop_hook(False)
        return

    pending_job = find_pending_job()
    if not pending_job:
        SENTINEL_FILE.unlink(missing_ok=True)
        sync_stop_hook(False)
        return

    job_file, job = pending_job

    # Job still pending - keep the current pending job pinned for same-session flow.
    SENTINEL_FILE.write_text(json.dumps({
        "job_file": str(job_file),
        "output": job.get("output", "")
    }, indent=2))

    if not should_stop_on_pending(cfg):
        sync_stop_hook(False)
        return

    rule_file = Path(get_rule_file_path(job)).expanduser()
    if not rule_file.exists():
        sync_stop_hook(False)
        return

    sync_stop_hook(True)

    # Job still pending - block with structured stop-hook output
    print(json.dumps({
        "decision": "block",
        "reason": build_stop_reason(job_file, job)
    }))


if __name__ == "__main__":
    main()
`;
}

/**
 * Parse markdown content to extract metadata (title, context, reading time,
 * model signature). Only reads the first ~40 lines for efficiency.
 */
export interface ParsedMarkdownHeader {
  title: string;
  context: string | null;
  readingTime: string | null;
  modelSignature: string | null;
  editActor: MarkdownEditActor | null;
}

export { parseMarkdownTodoState, type MarkdownTodoState };

export function extractArtifactModelSignature(line: string): string | null {
  const match = line.trim().match(ARTIFACT_MODEL_SIGNATURE_MARKDOWN_RE);
  return match ? match[1].trim() : null;
}

export function hasArtifactModelSignatureInstruction(content: string): boolean {
  return ARTIFACT_MODEL_SIGNATURE_INSTRUCTION_RE.test(content);
}

export function hasArtifactTitleInstruction(content: string): boolean {
  return ARTIFACT_TITLE_INSTRUCTION_RE.test(content);
}

export function hasArtifactStructureInstruction(content: string): boolean {
  return hasArtifactTitleInstruction(content) && hasArtifactModelSignatureInstruction(content);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export function defaultScratchpadName(date: Date): string {
  const day = date.getDate();
  return `${DAY_NAMES[date.getDay()]} ${MONTH_ABBREVS[date.getMonth()]} ${day}${ordinalSuffix(day)}`;
}

export function defaultScratchpadNameWithTime(date: Date): string {
  const base = defaultScratchpadName(date);
  const hr12 = ((date.getHours() + 11) % 12) + 1;
  const min = String(date.getMinutes()).padStart(2, '0');
  const ampm = date.getHours() < 12 ? 'am' : 'pm';
  return `${base} at ${hr12}:${min}${ampm}`;
}

export function isHiddenWikiFolderName(name: string): boolean {
  return name === 'Codex Context' || name.startsWith('.') || name.startsWith('_') || /\.assets$/i.test(name);
}

export function isHiddenWikiFileName(name: string): boolean {
  return name.startsWith('.') || name.startsWith('_');
}

export function buildEffectiveArtifactRuleContent(baseRule: string, expertise?: string): string {
  const normalizedExpertise = expertise?.trim();
  const additions: string[] = [];

  if (!hasArtifactStructureInstruction(baseRule)) {
    additions.push(`Required artifact format:
${ARTIFACT_STRUCTURE_GUIDANCE}

${ARTIFACT_MODEL_SIGNATURE_GUIDANCE}`);
  } else if (!hasArtifactModelSignatureInstruction(baseRule)) {
    additions.push(`Required metadata: ${ARTIFACT_MODEL_SIGNATURE_GUIDANCE}`);
  }

  if (normalizedExpertise) {
    additions.push(`Context about the reader: ${normalizedExpertise}`);
  }

  return additions.length > 0
    ? `${baseRule}\n\n${additions.join('\n\n')}`
    : baseRule;
}

export function buildFieldTheoryMarkdownCommandContent(): string {
  return `# Write Field Theory Markdown

Use this when writing Markdown that will be read or edited in Field Theory.
This applies to normal notes, scratchpads, entries, README pages, and command-written docs.
It does not apply to Librarian artifacts; keep the existing artifact design and artifact-specific rules.

## Goal

Write clean source Markdown that already feels tidy in raw mode.
Rendered mode should be a light presentation layer, not a rescue operation.

## Voice

Write in plain, practical English.
Lead with the main point.
Use concrete words and exact numbers when they matter.
Be comprehensive when the topic needs it, but do not add filler scaffolding.

## Structure

Use one H1 title at the top.
For normal notes, prefer bold section labels instead of more heading levels.

Example:

**Decision**

Use a single shared paste target resolver.

**Why**

The bug was duplicated target detection, not paste timing.

Avoid H2/H3 unless the document is long enough that real navigation matters.
Avoid H4 and deeper.
Keep most text at the same visual size; create hierarchy with order, spacing, and bold labels.

## Spacing

Use one blank line between blocks.
Do not use repeated blank lines for visual spacing.
Do not put blank lines between simple list items.

## Lists

Prefer prose.
Use bullets only when the items are parallel or genuinely easier to scan.
Use ordered lists only for real sequence, priority, or steps.
Keep lists short. If a list needs explanation, write prose under a bold label instead.

## Tasks

Use clear Markdown tasks:

- [ ] One action per line
- [x] Finished action

Do not hide decisions or explanations inside task text.
Put context in prose, then tasks underneath.

## Links

Use Field Theory backlinks for internal pages:

[[Page Name]]

Use embedded Markdown links when the link carries the sentence:

[source title](https://example.com)

For sourced notes, repeat important sources at the bottom:

**Sources**

- [Readable source title](https://example.com)

Do not dump unsorted URLs.
Do not repeat sources at the bottom if the note is private, unsourced scratch work, or the link is incidental.

## Formatting

Use bold sparingly for labels, decisions, and important terms.
Do not bold whole paragraphs.
Use blockquotes only for actual quoted text.
Use code formatting only for commands, paths, keys, symbols, and identifiers.

## Avoid

Avoid generic AI headings like "Overview", "Key Takeaways", "Conclusion", and "Final Thoughts" unless they add real structure.
Avoid decorative callouts.
Avoid excessive bullets.
Avoid multiple heading sizes in short notes.
Avoid writing for the renderer instead of the source file.`;
}

export function parseMarkdownHeader(content: string): ParsedMarkdownHeader {
  const lines = content.split('\n').slice(0, MARKDOWN_HEADER_SCAN_LINE_COUNT);
  let title = 'Untitled Reading';
  let context: string | null = null;
  let readingTime: string | null = null;
  let modelSignature: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract title from first heading (H1, H2, or H3)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch && title === 'Untitled Reading') {
      title = headingMatch[2].trim();
      continue;
    }

    // Extract reading time (e.g., *Reading time: ~4 minutes*)
    const readingTimeMatch = trimmed.match(/^\*Reading time:\s*(.+?)\*$/i);
    if (readingTimeMatch) {
      readingTime = readingTimeMatch[1].trim();
      continue;
    }

    // Extract context (e.g., *Context: Auth architecture refactoring*)
    const contextMatch = trimmed.match(/^\*Context:\s*(.+?)\*$/i);
    if (contextMatch) {
      context = contextMatch[1].trim();
      continue;
    }

    // Extract model signature (e.g., *Model: GPT-5 Codex*)
    const parsedModelSignature = extractArtifactModelSignature(trimmed);
    if (parsedModelSignature) {
      modelSignature = parsedModelSignature;
      continue;
    }
  }

  return { title, context, readingTime, modelSignature, editActor: parseMarkdownEditActor(content) };
}

/**
 * Auto-run frequency for generating readings.
 * @deprecated Kept only for migration. State-enforced mode is now the only option.
 */
export type AutoRunFrequency = 'off' | 'occasionally' | 'regularly' | 'frequently' | 'always';

/**
 * Discovery frequency for artifact creation cadence.
 * Controls how often discoveries (artifacts) are triggered.
 */
export type DiscoveryFrequency = 'often' | 'sometimes' | 'rarely';

/**
 * Configuration for discovery cadence.
 * Uses center-biased randomness (median of 3) to feel natural.
 */
export const DISCOVERY_CONFIG: Record<DiscoveryFrequency, { min: number; max: number; cap: number }> = {
  often:     { min: 3,  max: 7,  cap: 8 },
  sometimes: { min: 10, max: 18, cap: 20 },
  rarely:    { min: 25, max: 40, cap: 50 },
};

/**
 * Metadata for a reading (cached in index).
 * Path is the identity - no numeric IDs.
 */
// ── Wiki viewer types ──────────────────────────────────────────────────
export interface WikiPageMeta {
  relPath: string;  // e.g. 'entries/2026-04-15-foo' (no .md)
  absPath: string;
  name: string;     // filename without extension
  title: string;    // filename without extension
  lastUpdated: number;
  documentKind?: 'markdown' | 'html' | 'css';
  todoState?: MarkdownTodoState;
  archived?: boolean;
  sharedOriginalSourcePath?: string;
  sharedAuthorCallsign?: string;
  editActor?: MarkdownEditActor;
}

export interface WikiPage extends WikiPageMeta {
  content: string;
  documentVersion: DocumentVersion;
}

export interface WikiFolder {
  name: string;
  files: WikiPageMeta[];
}

export type WikiNode =
  | { kind: 'file'; relPath: string; absPath: string; name: string; title: string; lastUpdated: number; documentKind?: 'markdown' | 'html' | 'css'; todoState?: MarkdownTodoState; archived?: boolean; sharedOriginalSourcePath?: string; sharedAuthorCallsign?: string; editActor?: MarkdownEditActor }
  | { kind: 'dir'; name: string; relPath: string; children: WikiNode[] };

type WikiFileMetadata = Pick<WikiPageMeta, 'title' | 'todoState' | 'archived' | 'sharedOriginalSourcePath' | 'sharedAuthorCallsign' | 'editActor'> & {
  contentEditedAt?: number;
};

export interface LibraryRoot {
  path: string;
  label: string;
  builtin: boolean;
  writable?: boolean;
  tree: WikiNode[];
}

export interface LibraryRenameEvent {
  rootPath: string;
  oldRelPath: string;
  newRelPath: string;
  oldAbsPath: string;
  newAbsPath: string;
  builtin: boolean;
  traceId?: string;
  source?: 'app' | 'watcher' | 'external';
  detectedAt?: number;
  emittedAt?: number;
}

export type LibraryMoveKind = 'file' | 'dir';

export interface ReadingMeta {
  path: string;
  title: string;
  context: string | null;
  readingTime: string | null;
  modelSignature: string | null;
  createdAt: number;
  mtime: number;
  editActor?: MarkdownEditActor;
}

/**
 * A full reading with content (loaded on demand).
 */
export interface Reading extends ReadingMeta {
  content: string;
  documentVersion: DocumentVersion;
}

export interface ReadingRenameEvent {
  oldPath: string;
  reading: ReadingMeta;
  traceId?: string;
  detectedAt?: number;
  emittedAt?: number;
}

/**
 * A watched directory configuration.
 * Path is the identity - no numeric IDs.
 */
export interface WatchedDir {
  path: string;
  enabled: boolean;
}

/**
 * Settings stored in JSON file.
 */
interface LibrarianSettings {
  watchedDirs: string[];
  libraryRoots?: string[];
  hiddenDefaultFolders?: string[];
  readmesSeeded?: LibraryReadmeFolderId[];
  enabled: boolean;                    // Single master toggle
  autoShowEnabled: boolean;
  autoShowStealsFocus?: boolean;
  resumeAfterClose?: boolean;          // If true, reopen to last artifact instead of clipboard
  immersiveHeightPercent?: number;     // Height of immersive library view as a percent of work-area height
  librarianSetupComplete?: boolean;    // True after setup wizard completes
  // State-enforced mode settings (the only mode now)
  stateEnforcedThreshold?: number;     // Prompts before job creation (default: 7 = 'sometimes')
  stateEnforcedRuleContent?: string;   // Custom rule content (the "job language")
  // Discovery cadence settings
  discoveryFrequency?: DiscoveryFrequency;  // Controls discovery timing (default: 'sometimes')
  codexStopOnPending?: boolean;       // If true, Codex Stop hook blocks on pending jobs
  // User expertise context
  userExpertiseContext?: string;       // User's background/interests (max 400 chars)
  // Legacy fields (kept for migration only)
  autoRunFrequency?: AutoRunFrequency; // @deprecated
  triggerMode?: string;                // @deprecated - always state-enforced now
  promptThreshold?: number;            // @deprecated
  customThreshold?: number;            // @deprecated
  customContentGuidance?: string;      // @deprecated
}

/**
 * Index stored in JSON file for fast startup.
 */
interface LibrarianIndex {
  version: number;
  files: Record<string, {
    title: string;
    context: string | null;
    readingTime: string | null;
    modelSignature: string | null;
    createdAt: number;
    mtime: number;
    editActor?: MarkdownEditActor;
  }>;
}

/**
 * LibrarianManager handles watching directories for markdown files
 * and providing access to the reading collection.
 *
 * File-only architecture: .librarian/ directories are the single source of truth.
 * No database, no internal copies. Field Theory is a visibility tool.
 *
 * Named after the AI assistant in Snow Crash that provides contextual
 * intel during missions.
 */
export class LibrarianManager extends EventEmitter {
  private settingsPath: string;
  private indexPath: string;
  private oldDbPath: string;
  private oldLibrarianDir: string;
  private cache: Map<string, ReadingMeta> = new Map();
  private watchers: Map<string, chokidar.FSWatcher> = new Map();
  private libraryRootWatchers: Map<string, chokidar.FSWatcher> = new Map();
  private settings: LibrarianSettings;
  private scanningDirs: Set<string> = new Set();
  private userDataManager: UserDataManager | null = null;
  private wikiTreeCache: WikiNode[] | null = null;
  private libraryRootsCache: LibraryRoot[] | null = null;
  private pendingWikiUnlinks: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private pendingLibraryUnlinks: Map<string, { rootPath: string; timer: ReturnType<typeof setTimeout> }> = new Map();
  private wikiRenameAliases: Map<string, { relPath: string; timer: ReturnType<typeof setTimeout> }> = new Map();

  constructor() {
    super();

    // Initialize paths (legacy - will be updated when user logs in)
    const userDataPath = app.getPath('userData');
    this.settingsPath = path.join(userDataPath, 'librarian-settings.json');
    this.indexPath = path.join(userDataPath, 'librarian-index.json');
    this.oldDbPath = path.join(userDataPath, 'librarian.db');
    this.oldLibrarianDir = path.join(userDataPath, 'librarian');

    // Migrate from old database if needed
    this.migrateFromDatabase();

    // Load settings
    this.settings = this.loadSettings();

    // Ensure central artifacts directory exists and is watched by default
    this.ensureCentralArtifactsDir();
    this.ensureDefaultFolderReadmes();

    // Load index (cached metadata)
    this.loadIndex();

    // Start watching configured directories
    this.startWatching();
    this.startLibraryRootWatchers();

    // Log current status for all projects with .librarian directories
    this.logAllProjectStatuses();
  }

  emit(eventName: string | symbol, ...args: any[]): boolean {
    if (eventName === 'wiki:changed') {
      this.invalidateWikiTreeCache();
    } else if (eventName === 'library:changed') {
      this.invalidateLibraryRootsCache();
    }
    return super.emit(eventName, ...args);
  }

  /**
   * Set the UserDataManager for per-user paths.
   */
  setUserDataManager(manager: UserDataManager): void {
    this.userDataManager = manager;
    if (!manager.isLoggedIn()) return;
    this.updatePathsForUser();
    this.settings = this.loadSettings();
    this.loadIndex();
    this.invalidateWikiTreeCache();
    this.invalidateLibraryRootsCache();
  }

  /**
   * Update paths for the current user.
   */
  private updatePathsForUser(): void {
    if (this.userDataManager?.isLoggedIn()) {
      this.settingsPath = this.userDataManager.getUserDataPath('librarian-settings.json');
      this.indexPath = this.userDataManager.getUserDataPath('librarian-index.json');
    }
  }

  private ensureUserScopedSettingsLoaded(): void {
    if (!this.userDataManager?.isLoggedIn()) return;

    const expectedSettingsPath = this.userDataManager.getUserDataPath('librarian-settings.json');
    if (this.settingsPath === expectedSettingsPath) return;

    this.updatePathsForUser();
    this.settings = this.loadSettings();
    this.loadIndex();
    this.invalidateWikiTreeCache();
    this.invalidateLibraryRootsCache();
  }

  /**
   * Get the central librarian directory (user-specific).
   */
  getCentralLibrarianDir(): string {
    if (this.userDataManager?.isLoggedIn()) {
      return this.userDataManager.getFieldTheoryPath('librarian');
    }
    // Fallback to legacy path
    return path.join(os.homedir(), '.fieldtheory', 'librarian');
  }

  /**
   * Get the central artifacts directory (user-specific).
   */
  getCentralArtifactsDir(): string {
    return path.join(this.getCentralLibrarianDir(), 'artifacts');
  }

  /**
   * Get the concepts index for story/lesson deduplication.
   * Returns null if the index doesn't exist.
   * Note: Always reads from global path since hook.py writes there (no user context).
   */
  getConceptsIndex(): {
    schema_version: number;
    description?: string;
    indexed_at: string | null;
    artifacts: Record<string, { title: string; stories: string[]; lessons: string[] }>;
    stories_used: string[];
    lessons_used: string[];
  } | null {
    // Hook writes to global path (no user context), so always read from there
    const globalLibrarianDir = path.join(os.homedir(), '.fieldtheory', 'librarian');
    const indexPath = path.join(globalLibrarianDir, 'concepts_index.json');
    if (!fs.existsSync(indexPath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      log.error('Failed to read concepts index:', error);
      return null;
    }
  }

  /**
   * Reinitialize for the current user. Call after setUserDataManager when user changes.
   */
  async reinitializeForUser(): Promise<void> {
    // Stop existing watchers
    for (const watcher of this.watchers.values()) {
      await watcher.close();
    }
    this.watchers.clear();
    for (const watcher of this.libraryRootWatchers.values()) {
      await watcher.close();
    }
    this.libraryRootWatchers.clear();
    this.clearPendingRenameTimers();
    this.cache.clear();

    // Update paths
    this.updatePathsForUser();

    // Reload settings and index for new user
    this.settings = this.loadSettings();
    this.ensureCentralArtifactsDir();
    this.ensureDefaultFolderReadmes();
    this.loadIndex();
    this.startWatching();
    this.startLibraryRootWatchers();

    // Sync user's settings to global config for hooks
    this.syncToGlobalConfig(false);
  }

  /**
   * Clear state on logout.
   */
  async onUserLoggedOut(): Promise<void> {
    // Stop watchers
    for (const watcher of this.watchers.values()) {
      await watcher.close();
    }
    this.watchers.clear();
    for (const watcher of this.libraryRootWatchers.values()) {
      await watcher.close();
    }
    this.libraryRootWatchers.clear();
    this.cache.clear();

    // Disable hooks in global config (hooks should not fire when logged out)
    const globalConfigPath = path.join(os.homedir(), '.fieldtheory', 'librarian', 'config.json');
    if (fs.existsSync(globalConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
        config.enabled = false;
        fs.writeFileSync(globalConfigPath, JSON.stringify(config, null, 2));
      } catch (error) {
        log.error('Failed to disable hooks in global config:', error);
      }
    }
  }

  /**
   * Log global status at startup.
   * Resets for offline-created artifacts are handled by scanForNewReadings()
   * which emits reading-added events for files not in cache.
   */
  private logAllProjectStatuses(): void {
    this.logStatus('startup');
  }

  // ===========================================================================
  // Path Utilities
  // ===========================================================================

  /**
   * Normalize a path to prevent duplicates from ../, ./, etc.
   */
  private normalizePath(filePath: string): string {
    return path.resolve(filePath);
  }

  /**
   * Expand ~ to home directory.
   */
  private expandPath(filePath: string): string {
    if (filePath.startsWith('~')) {
      return filePath.replace('~', app.getPath('home'));
    }
    return filePath;
  }

  private resolveWatchedReadingPath(filePath: string): string | null {
    const normalizedPath = this.normalizePath(this.expandPath(filePath));
    if (!isMarkdownDocumentPath(normalizedPath)) return null;

    const watchedRoots = this.settings.watchedDirs.map(dirPath => this.normalizePath(this.expandPath(dirPath)));
    return existingPathInsideRoots(normalizedPath, watchedRoots) ? normalizedPath : null;
  }

  private clearPendingRenameTimers(): void {
    for (const timer of this.pendingWikiUnlinks?.values() ?? []) clearTimeout(timer);
    this.pendingWikiUnlinks?.clear();
    for (const pending of this.pendingLibraryUnlinks?.values() ?? []) clearTimeout(pending.timer);
    this.pendingLibraryUnlinks?.clear();
    for (const alias of this.wikiRenameAliases?.values() ?? []) clearTimeout(alias.timer);
    this.wikiRenameAliases?.clear();
  }

  // ===========================================================================
  // Settings Management
  // ===========================================================================

  /**
   * Load settings from JSON file with migration from v1 format.
   */
  private loadSettings(): LibrarianSettings {
    const defaults: LibrarianSettings = {
      watchedDirs: [],
      libraryRoots: [],
      hiddenDefaultFolders: [],
      readmesSeeded: [],
      enabled: true,
      autoShowEnabled: true,
      autoShowStealsFocus: true,
      immersiveHeightPercent: 85,
      librarianSetupComplete: undefined,
      stateEnforcedThreshold: 7,  // Default to 'sometimes' frequency (7-13 prompts)
      stateEnforcedRuleContent: undefined,
      codexStopOnPending: false,
    };

    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));

        // Migrate from v1 format if needed
        let enabled = data.enabled;

        // Migration: convert autoRunFrequency to enabled
        if (enabled === undefined && data.autoRunFrequency !== undefined) {
          enabled = data.autoRunFrequency !== 'off';
        }

        return {
          watchedDirs: data.watchedDirs || defaults.watchedDirs,
          libraryRoots: Array.isArray(data.libraryRoots) ? data.libraryRoots : defaults.libraryRoots,
          hiddenDefaultFolders: normalizeHiddenDefaultFolders(data.hiddenDefaultFolders),
          readmesSeeded: normalizeSeededReadmes(data.readmesSeeded),
          enabled: enabled ?? defaults.enabled,
          autoShowEnabled: data.autoShowEnabled ?? defaults.autoShowEnabled,
          autoShowStealsFocus: data.autoShowStealsFocus ?? defaults.autoShowStealsFocus,
          resumeAfterClose: data.resumeAfterClose,
          immersiveHeightPercent: data.immersiveHeightPercent ?? defaults.immersiveHeightPercent,
          librarianSetupComplete: data.librarianSetupComplete,
          // State-enforced mode settings (the only mode now)
          stateEnforcedThreshold: data.stateEnforcedThreshold ?? defaults.stateEnforcedThreshold,
          stateEnforcedRuleContent: data.stateEnforcedRuleContent || undefined,
          // Discovery and expertise settings
          discoveryFrequency: data.discoveryFrequency,
          codexStopOnPending: data.codexStopOnPending ?? true,
          userExpertiseContext: data.userExpertiseContext,
        };
      }
    } catch (error) {
      log.warn('Failed to load settings, using defaults:', error);
    }

    return defaults;
  }

  /**
   * Save settings to JSON file.
   */
  private saveSettings(): void {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    } catch (error) {
      log.error('Failed to save settings:', error);
    }
  }

  // ===========================================================================
  // Index Management (for fast startup)
  // ===========================================================================

  /**
   * Load index from JSON file with corruption fallback.
   */
  private loadIndex(): void {
    try {
      if (fs.existsSync(this.indexPath)) {
        const data: LibrarianIndex = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
        if ((data.version === 1 || data.version === LIBRARIAN_INDEX_VERSION) && data.files) {
          for (const [filePath, meta] of Object.entries(data.files)) {
            this.cache.set(filePath, {
              path: filePath,
              title: meta.title,
              context: meta.context,
              readingTime: meta.readingTime,
              modelSignature: meta.modelSignature ?? null,
              createdAt: meta.createdAt,
              mtime: meta.mtime,
              editActor: meta.editActor,
            });
          }
        }
      }
    } catch (error) {
      log.warn('Index corrupted or invalid, starting fresh:', error);
      this.cache.clear();
    }
  }

  /**
   * Save index to JSON file.
   */
  private saveIndex(): void {
    try {
      const index: LibrarianIndex = {
        version: LIBRARIAN_INDEX_VERSION,
        files: {},
      };
      for (const [filePath, meta] of this.cache.entries()) {
        index.files[filePath] = {
          title: meta.title,
          context: meta.context,
          readingTime: meta.readingTime,
          modelSignature: meta.modelSignature,
          createdAt: meta.createdAt,
          mtime: meta.mtime,
          editActor: meta.editActor,
        };
      }
      fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2));
    } catch (error) {
      log.error('Failed to save index:', error);
    }
  }

  // ===========================================================================
  // Migration from Old Database
  // ===========================================================================

  /**
   * Migrate settings from old SQLite database if it exists.
   */
  private migrateFromDatabase(): void {
    if (!fs.existsSync(this.oldDbPath)) {
      return;
    }

    // Check if we've already migrated
    if (fs.existsSync(this.settingsPath)) {
      return;
    }

    try {
      // Dynamic import to avoid requiring better-sqlite3 if not needed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3');
      const db = new Database(this.oldDbPath, { readonly: true });

      // Extract watched directories
      const watchedDirs: string[] = [];
      try {
        const rows = db.prepare('SELECT path FROM watched_dirs WHERE enabled = 1').all() as { path: string }[];
        for (const row of rows) {
          watchedDirs.push(row.path);
        }
      } catch {
        // Could not read watched_dirs
      }

      // Extract settings
      let autoRunFrequency: AutoRunFrequency = 'frequently';
      let autoShowEnabled = true;
      try {
        const freqRow = db.prepare("SELECT value FROM settings WHERE key = 'librarian_auto_frequency'").get() as { value: string } | undefined;
        if (freqRow?.value && ['off', 'occasionally', 'regularly', 'frequently', 'always'].includes(freqRow.value)) {
          autoRunFrequency = freqRow.value as AutoRunFrequency;
        }
        const showRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_show_on_new_reading'").get() as { value: string } | undefined;
        if (showRow?.value === 'false') {
          autoShowEnabled = false;
        }
      } catch {
        // Could not read settings
      }

      db.close();

      // Save migrated settings (with new v2 fields)
      const settings: LibrarianSettings = {
        watchedDirs,
        enabled: autoRunFrequency !== 'off',
        triggerMode: 'prompt',
        promptThreshold: 5,
        autoShowEnabled,
        // Keep legacy fields for reference
        autoRunFrequency,
      };
      fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));

      // Clean up old files
      try {
        fs.unlinkSync(this.oldDbPath);
      } catch {
        // Could not delete old database
      }

      if (fs.existsSync(this.oldLibrarianDir)) {
        try {
          fs.rmSync(this.oldLibrarianDir, { recursive: true });
        } catch {
          // Could not delete old librarian directory
        }
      }
    } catch (error) {
      log.error('Migration failed:', error);
    }
  }

  // ===========================================================================
  // Markdown Parsing
  // ===========================================================================

  private parseMarkdownHeader(content: string): ParsedMarkdownHeader {
    return parseMarkdownHeader(content);
  }

  /**
   * Parse file metadata from disk.
   */
  private parseFileMetadata(filePath: string): ReadingMeta | null {
    try {
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      const { title, context, readingTime, modelSignature, editActor } = this.parseMarkdownHeader(content);

      return {
        path: filePath,
        title,
        context,
        readingTime,
        modelSignature,
        createdAt: Math.floor(stats.birthtimeMs),
        mtime: Math.floor(stats.mtimeMs),
        editActor: editActor ?? undefined,
      };
    } catch (error) {
      log.error(`Error parsing file ${filePath}:`, error);
      return null;
    }
  }

  // ===========================================================================
  // Directory Scanning
  // ===========================================================================

  /**
   * Scan a directory with mtime-based diffing.
   * Only re-parses files that have changed.
   * Returns true if any files were added/updated.
   */
  scanDirectory(dirPath: string): boolean {
    const normalizedDir = this.normalizePath(dirPath);

    if (!fs.existsSync(normalizedDir)) {
      return false;
    }

    this.scanningDirs.add(normalizedDir);
    let hasChanges = false;

    try {
      const files = fs.readdirSync(normalizedDir).filter(isMarkdownDocumentPath);
      const seenPaths = new Set<string>();

      for (const file of files) {
        const fullPath = this.normalizePath(path.join(normalizedDir, file));
        seenPaths.add(fullPath);

        try {
          const stats = fs.statSync(fullPath);
          const mtime = Math.floor(stats.mtimeMs);
          const cached = this.cache.get(fullPath);

          // Skip if mtime unchanged
          if (cached && cached.mtime === mtime) {
            continue;
          }

          // Parse and cache
          const meta = this.parseFileMetadata(fullPath);
          if (meta) {
            this.cache.set(fullPath, meta);
            hasChanges = true;
          }
        } catch (error) {
          log.error(`Error processing ${file}:`, error);
        }
      }

      // Remove cached entries for files that no longer exist in this directory
      for (const [cachedPath] of this.cache) {
        if (cachedPath.startsWith(normalizedDir + path.sep) && !seenPaths.has(cachedPath)) {
          this.cache.delete(cachedPath);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        this.saveIndex();
      }
    } finally {
      this.scanningDirs.delete(normalizedDir);
    }

    return hasChanges;
  }

  /**
   * Check if a directory is currently being scanned.
   */
  isScanning(dirPath?: string): boolean {
    if (dirPath) {
      return this.scanningDirs.has(this.normalizePath(dirPath));
    }
    return this.scanningDirs.size > 0;
  }

  // ===========================================================================
  // Directory Watching
  // ===========================================================================

  /**
   * Watch a directory for file changes using chokidar for reliability.
   */
  private watchDirectory(dirPath: string): void {
    const normalizedDir = this.normalizePath(dirPath);

    if (this.watchers.has(normalizedDir)) {
      return;
    }

    if (!fs.existsSync(normalizedDir)) {
      return;
    }

    this.scanDirectory(normalizedDir);

    const watcher = chokidar.watch([
      path.join(normalizedDir, '*.md'),
      path.join(normalizedDir, '*.markdown'),
      path.join(normalizedDir, '*.mdx'),
    ], {
      ignoreInitial: true,           // Don't fire for existing files
      awaitWriteFinish: {            // Wait for file to be fully written
        stabilityThreshold: 100,
        pollInterval: 50,
      },
      ignorePermissionErrors: true,
      depth: 0,                      // Only watch immediate directory, not subdirs
    });

    watcher.on('ready', () => {
      // Reconciliation scan to catch files created during initialization
      this.scanForNewReadings(normalizedDir);
    });

    watcher.on('add', (filePath) => {
      this.handleFileChange(filePath, true);
    });

    watcher.on('change', (filePath) => {
      this.handleFileChange(filePath, false);
    });

    watcher.on('unlink', (filePath) => {
      this.handleFileDelete(filePath);
    });

    watcher.on('error', (error) => {
      log.error('Watcher error:', error);
    });

    this.watchers.set(normalizedDir, watcher);
  }

  /**
   * Handle file add or change events.
   */
  private handleFileChange(filePath: string, _isNewFile: boolean): void {
    const normalizedPath = this.normalizePath(filePath);
    const meta = this.parseFileMetadata(normalizedPath);

    if (!meta) return;

    // Check cache to determine if this is truly new or just an update.
    // Don't trust chokidar's isNewFile hint - reconciliation scan may have processed it first.
    const cached = this.cache.get(normalizedPath);
    const isActuallyNew = !cached;
    const isUpdated = cached && meta.mtime > cached.mtime;

    // Skip if file hasn't changed (same mtime as cached)
    if (cached && meta.mtime === cached.mtime) {
      return;
    }

    this.cache.set(normalizedPath, meta);
    this.saveIndex();

    if (isActuallyNew) {
      // Emit event - coordinator in index.ts handles counter reset and auto-show
      const content = fs.readFileSync(normalizedPath, 'utf-8');
      const reading: Reading = { ...meta, content, documentVersion: readDocumentVersion(normalizedPath) };
      this.emit('reading-added', reading);
      log.info(`New artifact: ${meta.title}`);
    } else if (isUpdated) {
      // Existing file was modified - just update UI, no auto-show
      this.emit('reading-updated', meta);
    }
  }

  /**
   * Handle file delete events.
   */
  private handleFileDelete(filePath: string): void {
    const normalizedPath = this.normalizePath(filePath);
    if (this.cache.has(normalizedPath)) {
      this.cache.delete(normalizedPath);
      this.saveIndex();
      this.emit('reading-removed', normalizedPath);
    }
  }

  /**
   * Scan a directory for files not in cache, emit events for any found.
   * Used after watcher ready to catch files created during initialization.
   */
  private scanForNewReadings(dirPath: string): void {
    const normalizedDir = this.normalizePath(dirPath);
    if (!fs.existsSync(normalizedDir)) return;

    const files = fs.readdirSync(normalizedDir).filter(isMarkdownDocumentPath);
    let foundNew = false;

    for (const file of files) {
      const fullPath = this.normalizePath(path.join(normalizedDir, file));

      // Skip if already in cache
      if (this.cache.has(fullPath)) continue;

      const meta = this.parseFileMetadata(fullPath);
      if (meta) {
        this.cache.set(fullPath, meta);
        foundNew = true;

        // Emit event - coordinator in index.ts handles counter reset
        const content = fs.readFileSync(fullPath, 'utf-8');
        const reading: Reading = { ...meta, content, documentVersion: readDocumentVersion(fullPath) };
        this.emit('reading-added', reading);
        log.info(`Reconciliation found artifact: ${meta.title}`);
      }
    }

    if (foundNew) {
      this.saveIndex();
    }
  }

  /**
   * Stop watching a directory.
   */
  private unwatchDirectory(dirPath: string): void {
    const normalizedDir = this.normalizePath(dirPath);
    const watcher = this.watchers.get(normalizedDir);
    if (watcher) {
      watcher.close();
      this.watchers.delete(normalizedDir);
    }
  }

  /**
   * Start watching all configured directories.
   */
  private startWatching(): void {
    for (const dirPath of this.settings.watchedDirs) {
      this.watchDirectory(dirPath);
    }
    // Also watch for newly discovered projects from state-enforced hook
    this.watchDiscoveryFile();
  }

  private watchLibraryRoot(dirPath: string): void {
    const normalizedDir = this.normalizePath(dirPath);
    if (this.libraryRootWatchers.has(normalizedDir) || !fs.existsSync(normalizedDir)) {
      return;
    }

    const watcher = chokidar.watch(normalizedDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      ignorePermissionErrors: true,
    });
    watcher.on('add', (absPath: string) => {
      if (isLibraryTextDocumentPath(absPath)) this.handleLibraryRootAdd(normalizedDir, absPath);
      else this.emit('library:changed', normalizedDir);
    });
    watcher.on('change', () => this.emit('library:changed', normalizedDir));
    watcher.on('unlink', (absPath: string) => {
      if (isLibraryTextDocumentPath(absPath)) this.scheduleLibraryRootUnlink(normalizedDir, absPath);
      else this.emit('library:changed', normalizedDir);
    });
    watcher.on('addDir', () => this.emit('library:changed', normalizedDir));
    watcher.on('unlinkDir', () => this.emit('library:changed', normalizedDir));
    watcher.on('error', (error) => log.error('Library root watcher error:', error));
    this.libraryRootWatchers.set(normalizedDir, watcher);
  }

  private unwatchLibraryRoot(dirPath: string): void {
    const normalizedDir = this.normalizePath(dirPath);
    const watcher = this.libraryRootWatchers.get(normalizedDir);
    if (!watcher) return;
    watcher.close();
    this.libraryRootWatchers.delete(normalizedDir);
  }

  private startLibraryRootWatchers(): void {
    for (const dirPath of this.getSafeLibraryRootPaths()) {
      this.watchLibraryRoot(dirPath);
    }
  }

  /**
   * Watch the discovery file for auto-adding new watched directories.
   * The state-enforced hook writes project paths here when creating artifacts.
   */
  private watchDiscoveryFile(): void {
    const discoveryFile = path.join(this.getCentralLibrarianDir(), 'discovered_projects.json');

    // Process any existing discovered projects
    this.processDiscoveryFile(discoveryFile);

    // Watch for changes
    const parentDir = path.dirname(discoveryFile);
    if (fs.existsSync(parentDir)) {
      fs.watch(parentDir, (eventType, filename) => {
        if (filename === 'discovered_projects.json') {
          this.processDiscoveryFile(discoveryFile);
        }
      });
    }
  }

  /**
   * Process the discovery file and auto-add any new directories.
   */
  private processDiscoveryFile(discoveryFile: string): void {
    if (!fs.existsSync(discoveryFile)) return;

    try {
      const discovered: string[] = JSON.parse(fs.readFileSync(discoveryFile, 'utf-8'));
      for (const dirPath of discovered) {
        if (!this.settings.watchedDirs.includes(dirPath)) {
          this.addWatchedDir(dirPath);
        }
      }
    } catch (error) {
      log.error('Error processing discovery file:', error);
    }
  }

  // ===========================================================================
  // Public API: Readings
  // ===========================================================================

  /**
   * Get all readings (metadata only, sorted by creation date).
   */
  getReadings(): ReadingMeta[] {
    return Array.from(this.cache.values())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get a reading by path (with full content).
   */
  getReading(filePath: string): Reading | null {
    const normalizedPath = this.normalizePath(filePath);
    const meta = this.cache.get(normalizedPath);
    if (!meta) {
      return null;
    }

    try {
      let content = fs.readFileSync(normalizedPath, 'utf-8');
      // Strip STORY/LESSON metadata lines (used for indexing, not display)
      content = content
        .split('\n')
        .filter(line => !line.startsWith('STORY:') && !line.startsWith('LESSON:'))
        .join('\n')
        .trimEnd();
      return { ...meta, content, documentVersion: readDocumentVersion(normalizedPath) };
    } catch (error) {
      log.error(`Error reading file ${normalizedPath}:`, error);
      return null;
    }
  }

  /**
   * Refresh readings by re-scanning all watched directories.
   */
  refreshReadings(): void {
    for (const dirPath of this.settings.watchedDirs) {
      this.scanDirectory(dirPath);
    }
  }

  // ── Wiki viewer ──────────────────────────────────────────────────────────

  private get wikiDir(): string {
    return libraryDir();
  }

  /** Canonical wiki root for substring comparisons against realpath'd paths. */
  getWikiRoot(): string {
    const dir = this.wikiDir;
    try {
      return fs.realpathSync(dir);
    } catch {
      return dir;
    }
  }

  private wikiWatcher: chokidar.FSWatcher | null = null;
  private wikiWatcherPending = false;

  private parseWikiMetadata(content: string, filePath: string): WikiFileMetadata {
    const frontmatter = parseMarkdownFrontmatter(content).meta;
    const isShared = frontmatter.shared === 'true';
    const frontmatterTitle = frontmatter.title?.trim();
    const sharedTitle = isShared && frontmatterTitle ? frontmatterTitle : undefined;
    const sharedUpdatedAt = isShared ? Date.parse(frontmatter.shared_updated_at ?? '') : Number.NaN;
    return {
      title: sharedTitle ?? (isShared ? 'Untitled' : stripMarkdownFileExtension(path.basename(filePath))),
      todoState: parseMarkdownTodoState(content) ?? undefined,
      archived: parseMarkdownArchivedState(content) || undefined,
      sharedOriginalSourcePath: frontmatter.shared_original_source_path,
      sharedAuthorCallsign: frontmatter.shared_author_callsign,
      editActor: getMarkdownEditActor(frontmatter) ?? undefined,
      contentEditedAt: parseMarkdownContentEditedAt(content)
        ?? (Number.isFinite(sharedUpdatedAt) ? sharedUpdatedAt : undefined),
    };
  }

  private parseWikiFileMetadata(filePath: string): WikiFileMetadata {
    if (!isMarkdownDocumentPath(filePath)) {
      return { title: path.basename(filePath) };
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.parseWikiMetadata(content, filePath);
    } catch {}
    return { title: path.basename(filePath, '.md') };
  }

  private toPortableRelPath(relPath: string): string {
    return relPath.split(path.sep).join('/');
  }

  private isInsidePath(parentPath: string, childPath: string): boolean {
    return isPathInside(parentPath, childPath);
  }

  private isSameExistingPath(leftPath: string, rightPath: string): boolean {
    try {
      return fs.realpathSync(leftPath) === fs.realpathSync(rightPath);
    } catch {
      return false;
    }
  }

  private isSameDocumentVersion(left: DocumentVersion, right: DocumentVersion): boolean {
    return left.mtimeMs === right.mtimeMs && left.size === right.size && left.sha256 === right.sha256;
  }

  private libraryRootKey(dirPath: string): string {
    try {
      return fs.realpathSync(dirPath);
    } catch {
      return this.normalizePath(dirPath);
    }
  }

  private canWriteDirectory(dirPath: string): boolean {
    try {
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return false;
      fs.accessSync(dirPath, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private moveLibraryPathSync(sourceAbs: string, targetAbs: string, kind: LibraryMoveKind): void {
    try {
      fs.renameSync(sourceAbs, targetAbs);
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== 'EXDEV' || kind !== 'file') throw error;
    }

    const sourceStats = fs.statSync(sourceAbs);
    let copied = false;
    try {
      fs.copyFileSync(sourceAbs, targetAbs, fs.constants.COPYFILE_EXCL);
      copied = true;
      fs.chmodSync(targetAbs, sourceStats.mode);
      fs.utimesSync(targetAbs, sourceStats.atime, sourceStats.mtime);
      fs.unlinkSync(sourceAbs);
    } catch (error) {
      if (copied) {
        try {
          fs.unlinkSync(targetAbs);
        } catch {}
      }
      throw error;
    }
  }

  private resolveLibraryRootForWrite(rootPath: string): { rootPath: string; builtin: boolean } | null {
    const normalizedPath = this.normalizePath(this.expandPath(rootPath.trim()));
    const targetKey = this.libraryRootKey(normalizedPath);

    if (targetKey === this.libraryRootKey(this.wikiDir)) {
      return { rootPath: this.wikiDir, builtin: true };
    }

    for (const savedRoot of this.settings.libraryRoots ?? []) {
      const normalizedRoot = this.normalizePath(savedRoot);
      if (this.libraryRootKey(normalizedRoot) === targetKey) {
        return { rootPath: normalizedRoot, builtin: false };
      }
    }

    return null;
  }

  private normalizeLibraryRelPath(relPath: string): string | null {
    return normalizeUserDocumentRelPathInput(relPath, { rejectHiddenSegments: true });
  }

  private stripMarkdownFileExtension(fileName: string): string {
    return stripMarkdownFileExtension(fileName);
  }

  private markdownFileNameFromTitle(title: string, extension = '.md'): string | null {
    const normalized = normalizeUserDocumentNameInput(title, { rejectLeadingUnderscore: true });
    if (!normalized) return null;
    const lower = normalized.toLowerCase();
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
      return markdownFileNameFromUserInput(normalized, { rejectLeadingUnderscore: true });
    }
    return markdownFileNameFromUserInput(`${normalized}${extension}`, { rejectLeadingUnderscore: true });
  }

  private slugifyWikiRelPath(relPath: string): string {
    return relPath
      .split('/')
      .map((part) => part.replace(/[^a-z0-9-]/gi, '-').toLowerCase())
      .filter(Boolean)
      .join('/');
  }

  private resolveExistingDirectoryPath(dirPath: string): string | null {
    const expandedPath = this.expandPath(dirPath.trim());
    const normalizedPath = this.normalizePath(expandedPath);
    try {
      if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isDirectory()) {
        return null;
      }
      return fs.realpathSync(normalizedPath);
    } catch {
      return null;
    }
  }

  private getUnsafeBroadDirectoryMessage(dirPath: string): string | null {
    const homePath = this.normalizePath(app.getPath('home'));
    const usersPath = path.dirname(homePath);
    const rootPath = path.parse(homePath).root;
    const dirKey = this.libraryRootKey(dirPath);

    if (dirKey === this.libraryRootKey(homePath)) {
      return 'Choose a specific project or notes folder, not your whole home folder.';
    }
    if (dirKey === this.libraryRootKey(usersPath)) {
      return 'Choose a specific project or notes folder, not the whole Users folder.';
    }
    if (dirKey === this.libraryRootKey(rootPath)) {
      return 'Choose a specific project or notes folder, not the system root.';
    }
    return null;
  }

  private getSafeLibraryRootPaths(): string[] {
    const roots = this.settings.libraryRoots ?? [];
    const safeRoots = roots.filter((rootPath) => {
      const expandedPath = this.expandPath(rootPath.trim());
      const normalizedPath = this.normalizePath(expandedPath);
      const message = this.getUnsafeBroadDirectoryMessage(normalizedPath);
      if (message) log.warn(`Skipping unsafe library root ${normalizedPath}: ${message}`);
      return !message;
    });

    if (safeRoots.length !== roots.length) {
      this.settings.libraryRoots = safeRoots;
      this.saveSettings();
    }

    return safeRoots;
  }

  private ensureFolderReadme(folderId: LibraryReadmeFolderId, absDir: string, content: string, legacyContents: string[] = []): boolean {
    const seeded = normalizeSeededReadmes(this.settings.readmesSeeded);

    try {
      const readmePath = path.join(absDir, 'README.md');
      if (seeded.includes(folderId)) {
        if (legacyContents.length > 0 && fs.existsSync(readmePath)) {
          const current = fs.readFileSync(readmePath, 'utf-8');
          if (legacyContents.some((legacyContent) => current === normalizeDefaultReadmeContent(legacyContent))) {
            fs.writeFileSync(readmePath, normalizeDefaultReadmeContent(content), 'utf-8');
            return true;
          }
        }
        return false;
      }

      fs.mkdirSync(absDir, { recursive: true });
      if (!fs.existsSync(readmePath)) {
        fs.writeFileSync(readmePath, normalizeDefaultReadmeContent(content), 'utf-8');
      } else if (legacyContents.length > 0) {
        const current = fs.readFileSync(readmePath, 'utf-8');
        if (legacyContents.some((legacyContent) => current === normalizeDefaultReadmeContent(legacyContent))) {
          fs.writeFileSync(readmePath, normalizeDefaultReadmeContent(content), 'utf-8');
        }
      }
      const next = new Set([...seeded, folderId]);
      this.settings.readmesSeeded = DEFAULT_README_FOLDER_IDS.filter((id) => next.has(id));
      return true;
    } catch (error) {
      log.warn(`Failed to seed README for ${folderId}:`, error);
      return false;
    }
  }

  private ensureDefaultFolderReadmes(): void {
    let changed = false;
    for (const spec of DEFAULT_FOLDER_READMES) {
      const absDir = path.join(this.wikiDir, spec.relPath);
      changed = this.ensureFolderReadme(spec.id, absDir, spec.content, spec.legacyContents) || changed;
    }
    if (changed) this.saveSettings();
  }

  private ensureCentralArtifactsReadme(artifactsDir: string): void {
    try {
      const readmePath = path.join(artifactsDir, 'README.md');
      if (!fs.existsSync(readmePath)) {
        fs.writeFileSync(readmePath, CENTRAL_ARTIFACTS_README_CONTENT, 'utf-8');
      }
    } catch (error) {
      log.warn('Failed to seed central artifacts README:', error);
    }
  }

  private scanMarkdownTree(
    rootPath: string,
    currentDir = rootPath,
    seenRealPaths = new Set<string>(),
    includeLibraryTextDocuments = false,
    options: { excludeWikiReservedFolders?: boolean } = {},
  ): WikiNode[] {
    if (!fs.existsSync(currentDir)) return [];

    let currentRealPath: string;
    try {
      currentRealPath = fs.realpathSync(currentDir);
    } catch {
      return [];
    }

    if (seenRealPaths.has(currentRealPath)) return [];
    seenRealPaths.add(currentRealPath);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const nodes: WikiNode[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() ? isHiddenWikiFolderName(entry.name) : isHiddenWikiFileName(entry.name)) continue;

      const absPath = path.join(currentDir, entry.name);
      let stats: fs.Stats;
      try {
        stats = fs.statSync(absPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        const relPath = this.toPortableRelPath(path.relative(rootPath, absPath));
        if (options.excludeWikiReservedFolders && rootPath === this.wikiDir && isWikiReservedRelPath(relPath)) continue;
        nodes.push({
          kind: 'dir',
          name: entry.name,
          relPath,
          children: this.scanMarkdownTree(rootPath, absPath, seenRealPaths, includeLibraryTextDocuments, options),
        });
        continue;
      }

      const documentKind = getLibraryTextDocumentKind(entry.name);
      const canShowFile = includeLibraryTextDocuments
        ? documentKind !== null
        : isMarkdownDocumentPath(entry.name);
      if (!stats.isFile() || !canShowFile || isWikiSkipFileName(entry.name)) {
        continue;
      }

      const name = documentKind === 'markdown'
        ? stripMarkdownFileExtension(entry.name)
        : entry.name;
      const relPath = this.toPortableRelPath(path.relative(rootPath, path.join(currentDir, name)));
      const metadata = this.parseWikiFileMetadata(absPath);
      nodes.push({
        kind: 'file',
        relPath,
        absPath,
        name,
        title: metadata.title,
        lastUpdated: metadata.contentEditedAt ?? Math.floor(stats.mtimeMs),
        documentKind: documentKind ?? undefined,
        todoState: metadata.todoState,
        archived: metadata.archived,
        sharedOriginalSourcePath: metadata.sharedOriginalSourcePath,
        sharedAuthorCallsign: metadata.sharedAuthorCallsign,
        editActor: metadata.editActor,
      });
    }

    return nodes.sort((a, b) => {
      const left = a.kind === 'file' && a.name.toLowerCase() === 'readme' ? '\0' : a.name.toLowerCase();
      const right = b.kind === 'file' && b.name.toLowerCase() === 'readme' ? '\0' : b.name.toLowerCase();
      return left.localeCompare(right, undefined, { sensitivity: 'base' });
    });
  }

  private flattenWikiFiles(nodes: WikiNode[]): WikiPageMeta[] {
    return nodes.flatMap((node) => {
      if (node.kind === 'file') {
        return [{
          relPath: node.relPath,
          absPath: node.absPath,
          name: node.name,
          title: node.title,
          lastUpdated: node.lastUpdated,
          documentKind: node.documentKind,
          todoState: node.todoState,
          archived: node.archived,
          sharedOriginalSourcePath: node.sharedOriginalSourcePath,
          sharedAuthorCallsign: node.sharedAuthorCallsign,
          editActor: node.editActor,
        }];
      }
      return this.flattenWikiFiles(node.children);
    });
  }

  private invalidateWikiTreeCache(): void {
    this.wikiTreeCache = null;
    this.invalidateLibraryRootsCache();
  }

  private invalidateLibraryRootsCache(): void {
    this.libraryRootsCache = null;
  }

  private fileNodeFromPath(rootPath: string, absPath: string, includeLibraryTextDocuments = false): Extract<WikiNode, { kind: 'file' }> | null {
    try {
      const stats = fs.statSync(absPath);
      const documentKind = getLibraryTextDocumentKind(absPath);
      if (!stats.isFile() || !(includeLibraryTextDocuments ? documentKind !== null : isMarkdownDocumentPath(absPath))) return null;
      const name = documentKind === 'markdown'
        ? stripMarkdownFileExtension(path.basename(absPath))
        : path.basename(absPath);
      const relPath = this.toPortableRelPath(path.relative(rootPath, path.join(path.dirname(absPath), name)));
      const metadata = this.parseWikiFileMetadata(absPath);
      return {
        kind: 'file',
        relPath,
        absPath,
        name,
        title: metadata.title,
        lastUpdated: metadata.contentEditedAt ?? Math.floor(stats.mtimeMs),
        documentKind: documentKind ?? undefined,
        todoState: metadata.todoState,
        archived: metadata.archived,
        sharedOriginalSourcePath: metadata.sharedOriginalSourcePath,
        sharedAuthorCallsign: metadata.sharedAuthorCallsign,
        editActor: metadata.editActor,
      };
    } catch {
      return null;
    }
  }

  private renameNodeInTree(nodes: WikiNode[], oldRelPath: string, newNode: Extract<WikiNode, { kind: 'file' }>): { nodes: WikiNode[]; changed: boolean } {
    let changed = false;
    const next = nodes.map((node) => {
      if (node.kind === 'file') {
        if (node.relPath !== oldRelPath) return node;
        changed = true;
        return newNode;
      }

      const children = this.renameNodeInTree(node.children, oldRelPath, newNode);
      if (!children.changed) return node;
      changed = true;
      return {
        ...node,
        children: children.nodes.sort((a, b) => {
          const left = a.kind === 'file' && a.name.toLowerCase() === 'readme' ? '\0' : a.name.toLowerCase();
          const right = b.kind === 'file' && b.name.toLowerCase() === 'readme' ? '\0' : b.name.toLowerCase();
          return left.localeCompare(right, undefined, { sensitivity: 'base' });
        }),
      };
    });
    return { nodes: changed ? next : nodes, changed };
  }

  private patchCachedRename(event: LibraryRenameEvent): void {
    const newNode = this.fileNodeFromPath(event.rootPath, event.newAbsPath, true);
    if (!newNode) {
      if (event.builtin) this.invalidateWikiTreeCache();
      else this.invalidateLibraryRootsCache();
      return;
    }

    if (event.builtin && this.wikiTreeCache) {
      const patched = this.renameNodeInTree(this.wikiTreeCache, event.oldRelPath, newNode);
      if (patched.changed) this.wikiTreeCache = patched.nodes;
      else this.invalidateWikiTreeCache();
    }

    if (this.libraryRootsCache) {
      let changed = false;
      const roots = this.libraryRootsCache.map((root) => {
        if (this.libraryRootKey(root.path) !== this.libraryRootKey(event.rootPath)) return root;
        const patched = this.renameNodeInTree(root.tree, event.oldRelPath, newNode);
        if (!patched.changed) return root;
        changed = true;
        return { ...root, tree: patched.nodes };
      });
      if (changed) this.libraryRootsCache = roots;
      else this.invalidateLibraryRootsCache();
    }
  }

  private emitRename(event: LibraryRenameEvent): void {
    const tracedEvent: LibraryRenameEvent = {
      ...event,
      traceId: event.traceId ?? nextRenameTraceId(event.builtin ? 'wiki' : 'library'),
      detectedAt: event.detectedAt ?? Date.now(),
      emittedAt: Date.now(),
    };
    traceRename('emit', {
      traceId: tracedEvent.traceId,
      source: tracedEvent.source,
      builtin: tracedEvent.builtin,
      oldRelPath: tracedEvent.oldRelPath,
      newRelPath: tracedEvent.newRelPath,
      ageMs: (tracedEvent.emittedAt ?? Date.now()) - (tracedEvent.detectedAt ?? Date.now()),
      renameListeners: this.listenerCount(tracedEvent.builtin ? 'wiki:renamed' : 'library:renamed'),
      changedListeners: this.listenerCount(tracedEvent.builtin ? 'wiki:changed' : 'library:changed'),
    });
    const beforePatch = Date.now();
    this.patchCachedRename(tracedEvent);
    this.rememberWikiRenameAlias(tracedEvent);
    traceRename('cache-patched', {
      traceId: tracedEvent.traceId,
      patchMs: Date.now() - beforePatch,
    });
    this.emit(tracedEvent.builtin ? 'wiki:renamed' : 'library:renamed', tracedEvent);
    traceRename('renamed-emitted', {
      traceId: tracedEvent.traceId,
      builtin: tracedEvent.builtin,
      ageMs: Date.now() - (tracedEvent.detectedAt ?? Date.now()),
    });
  }

  private rememberWikiRenameAlias(event: LibraryRenameEvent): void {
    if (!event.builtin) return;
    const aliases = this.wikiRenameAliases ??= new Map();
    const existing = aliases.get(event.oldRelPath);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      aliases.delete(event.oldRelPath);
    }, 15000);
    (timer as { unref?: () => void }).unref?.();
    aliases.set(event.oldRelPath, { relPath: event.newRelPath, timer });
    traceRename('wiki-alias-remembered', {
      traceId: event.traceId,
      oldRelPath: event.oldRelPath,
      newRelPath: event.newRelPath,
      ttlMs: 15000,
    });
  }

  private resolveWikiPageReadRelPath(relPath: string): string {
    if (this.resolveExistingWikiPagePath(relPath)) return relPath;
    const alias = this.wikiRenameAliases?.get(relPath)?.relPath;
    if (alias && this.resolveExistingWikiPagePath(alias)) {
      traceRename('wiki-alias-resolved', { oldRelPath: relPath, newRelPath: alias });
      return alias;
    }
    return relPath;
  }

  recordLibraryRename(event: LibraryRenameEvent): void {
    this.emitRename(event);
  }

  recordWatchedReadingRename(oldAbsPath: string, newAbsPath: string): ReadingMeta | null {
    const detectedAt = Date.now();
    const oldPath = this.normalizePath(oldAbsPath);
    const newPath = this.normalizePath(newAbsPath);
    const oldCached = this.cache.get(oldPath);
    if (!oldCached && !this.resolveWatchedReadingPath(newPath)) return null;
    const newMeta = this.parseFileMetadata(newPath);
    if (!oldCached && !newMeta) return null;

    this.cache.delete(oldPath);
    if (newMeta) this.cache.set(newPath, newMeta);
    this.saveIndex();

    if (newMeta) {
      const event: ReadingRenameEvent = {
        oldPath,
        reading: newMeta,
        traceId: nextRenameTraceId('reading'),
        detectedAt,
        emittedAt: Date.now(),
      };
      traceRename('reading-renamed', {
        traceId: event.traceId,
        oldPath,
        newPath,
        ageMs: event.emittedAt! - detectedAt,
      });
      this.emit('reading-renamed', event);
    }
    else this.emit('reading-removed', oldPath);
    return newMeta;
  }

  private getCachedWikiTree(): WikiNode[] {
    if (!this.wikiTreeCache) {
      this.wikiTreeCache = this.scanMarkdownTree(this.wikiDir, this.wikiDir, new Set<string>(), false, {
        excludeWikiReservedFolders: true,
      });
    }
    return this.wikiTreeCache;
  }

  getWikiTree(): WikiFolder[] {
    const wikiRoot = this.wikiDir;
    if (!fs.existsSync(wikiRoot)) return [];

    if (!this.wikiWatcher) this.startWikiWatcher();

    const tree = this.getCachedWikiTree();
    const folders: WikiFolder[] = [];

    for (const node of tree) {
      if (node.kind !== 'dir') continue;
      const pages = this.flattenWikiFiles(node.children);
      if (pages.length > 0) {
        folders.push({ name: node.name, files: pages });
      }
    }

    return folders;
  }

  getLibraryRoots(): LibraryRoot[] {
    if (!this.wikiWatcher) this.startWikiWatcher();
    if (this.libraryRootsCache) return this.libraryRootsCache;

    const roots: LibraryRoot[] = [
      {
        path: this.wikiDir,
        label: 'Wiki',
        builtin: true,
        writable: true,
        tree: this.scanMarkdownTree(this.wikiDir, this.wikiDir, new Set<string>(), true),
      },
    ];
    const seen = new Set<string>([this.libraryRootKey(this.wikiDir)]);

    for (const savedRoot of this.getSafeLibraryRootPaths()) {
      const normalizedRoot = this.normalizePath(savedRoot);
      const key = this.libraryRootKey(normalizedRoot);
      if (seen.has(key)) continue;
      seen.add(key);
      roots.push({
        path: normalizedRoot,
        label: path.basename(normalizedRoot) || normalizedRoot,
        builtin: false,
        writable: this.canWriteDirectory(normalizedRoot),
        tree: this.scanMarkdownTree(normalizedRoot, normalizedRoot, new Set<string>(), true),
      });
    }

    this.libraryRootsCache = roots;
    return roots;
  }

  getLibraryRootPaths(): string[] {
    const roots: string[] = [];
    const seen = new Set<string>();
    const addRoot = (rootPath: string): void => {
      const normalizedRoot = this.normalizePath(rootPath);
      const key = this.libraryRootKey(normalizedRoot);
      if (seen.has(key)) return;
      seen.add(key);
      roots.push(normalizedRoot);
    };

    addRoot(this.wikiDir);
    for (const savedRoot of this.getSafeLibraryRootPaths()) {
      addRoot(savedRoot);
    }
    return roots;
  }

  addLibraryRoot(dirPath: string): LibraryRoot | null {
    const canonicalPath = this.resolveExistingDirectoryPath(dirPath);
    if (!canonicalPath) return null;

    const unsafeMessage = this.getUnsafeBroadDirectoryMessage(canonicalPath);
    if (unsafeMessage) throw new Error(unsafeMessage);

    const newKey = this.libraryRootKey(canonicalPath);
    if (newKey === this.libraryRootKey(this.wikiDir)) return null;
    if ((this.settings.libraryRoots ?? []).some((rootPath) => this.libraryRootKey(rootPath) === newKey)) {
      return null;
    }

    this.settings.libraryRoots = [...(this.settings.libraryRoots ?? []), canonicalPath];
    this.saveSettings();
    this.watchLibraryRoot(canonicalPath);
    this.emit('library:changed', canonicalPath);

    return {
      path: canonicalPath,
      label: path.basename(canonicalPath) || canonicalPath,
      builtin: false,
      writable: this.canWriteDirectory(canonicalPath),
      tree: this.scanMarkdownTree(canonicalPath, canonicalPath, new Set<string>(), true),
    };
  }

  removeLibraryRoot(dirPath: string): boolean {
    const expandedPath = this.expandPath(dirPath.trim());
    const normalizedPath = this.normalizePath(expandedPath);
    const targetKey = this.libraryRootKey(normalizedPath);
    const roots = this.settings.libraryRoots ?? [];
    const index = roots.findIndex((rootPath) => this.libraryRootKey(rootPath) === targetKey);
    if (index === -1) return false;

    const [removedRoot] = roots.splice(index, 1);
    this.settings.libraryRoots = roots;
    this.saveSettings();
    this.unwatchLibraryRoot(removedRoot);
    this.emit('library:changed', removedRoot);
    return true;
  }

  private resolveExistingWikiPagePath(relPath: string): string | null {
    if (isWikiReservedRelPath(relPath)) return null;
    const candidates = [
      path.resolve(this.wikiDir, `${relPath}.md`),
      path.resolve(this.wikiDir, `${relPath}.markdown`),
      path.resolve(this.wikiDir, `${relPath}.mdx`),
    ];

    for (const candidate of candidates) {
      if (this.isInsidePath(this.wikiDir, candidate) && fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private resolveWikiPageWritePath(relPath: string): string | null {
    const existing = this.resolveExistingWikiPagePath(relPath);
    if (existing) return existing;

    const absPath = path.resolve(this.wikiDir, `${relPath}.md`);
    return this.isInsidePath(this.wikiDir, absPath) ? absPath : null;
  }

  getWikiPage(relPath: string): WikiPage | null {
    const resolvedRelPath = this.resolveWikiPageReadRelPath(relPath);
    const absPath = this.resolveExistingWikiPagePath(resolvedRelPath);
    if (!absPath) return null;

    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      const stats = fs.statSync(absPath);
      const nameWithoutExt = stripMarkdownFileExtension(path.basename(absPath));
      const metadata = this.parseWikiMetadata(content, absPath);
      return {
        relPath: resolvedRelPath,
        absPath,
        name: nameWithoutExt,
        title: metadata.title,
        lastUpdated: metadata.contentEditedAt ?? Math.floor(stats.mtimeMs),
        todoState: metadata.todoState,
        archived: metadata.archived,
        sharedOriginalSourcePath: metadata.sharedOriginalSourcePath,
        sharedAuthorCallsign: metadata.sharedAuthorCallsign,
        editActor: metadata.editActor,
        content,
        documentVersion: readDocumentVersion(absPath),
      };
    } catch (error) {
      log.error(`Error reading wiki page ${relPath}:`, error);
      return null;
    }
  }

  findWikiPageByDocumentVersion(version: DocumentVersion, previousRelPath?: string): WikiPage | null {
    if (!fs.existsSync(this.wikiDir)) return null;
    const pages = this.flattenWikiFiles(this.scanMarkdownTree(this.wikiDir));
    const previousFolder = previousRelPath ? path.posix.dirname(previousRelPath) : null;
    const sortedPages = previousFolder && previousFolder !== '.'
      ? [...pages].sort((left, right) => {
        const leftSameFolder = path.posix.dirname(left.relPath) === previousFolder ? 0 : 1;
        const rightSameFolder = path.posix.dirname(right.relPath) === previousFolder ? 0 : 1;
        return leftSameFolder - rightSameFolder;
      })
      : pages;

    for (const page of sortedPages) {
      if (page.relPath === previousRelPath) continue;
      try {
        if (this.isSameDocumentVersion(readDocumentVersion(page.absPath), version)) {
          return this.getWikiPage(page.relPath);
        }
      } catch {}
    }
    return null;
  }

  private wikiRelPathFromAbsPath(absPath: string): string {
    return stripMarkdownFileExtension(this.toPortableRelPath(path.relative(this.wikiDir, absPath)));
  }

  private libraryRelPathFromAbsPath(rootPath: string, absPath: string): string {
    return stripMarkdownFileExtension(this.toPortableRelPath(path.relative(rootPath, absPath)));
  }

  private takePendingWikiRename(newAbsPath: string): string | null {
    const newDir = path.dirname(newAbsPath);
    for (const [oldAbsPath, timer] of this.pendingWikiUnlinks) {
      if (path.dirname(oldAbsPath) !== newDir) continue;
      clearTimeout(timer);
      this.pendingWikiUnlinks.delete(oldAbsPath);
      return oldAbsPath;
    }
    return null;
  }

  private handleWikiAdd(absPath: string): void {
    const oldAbsPath = this.takePendingWikiRename(absPath);
    if (!oldAbsPath) {
      traceRename('wiki-add-unmatched', { absPath });
      this.emit('wiki:changed');
      return;
    }

    const oldRelPath = this.wikiRelPathFromAbsPath(oldAbsPath);
    const newRelPath = this.wikiRelPathFromAbsPath(absPath);
    traceRename('wiki-add-matched', { oldAbsPath, newAbsPath: absPath, oldRelPath, newRelPath });
    this.emitRename({
      rootPath: this.wikiDir,
      oldRelPath,
      newRelPath,
      oldAbsPath,
      newAbsPath: absPath,
      builtin: true,
      source: 'watcher',
      detectedAt: Date.now(),
    });
    this.emit('wiki:deleted', oldRelPath);
  }

  private scheduleWikiUnlink(absPath: string): void {
    const existing = this.pendingWikiUnlinks.get(absPath);
    if (existing) clearTimeout(existing);
    traceRename('wiki-unlink-pending', { absPath, relPath: this.wikiRelPathFromAbsPath(absPath), waitMs: 350 });
    const timer = setTimeout(() => {
      this.pendingWikiUnlinks.delete(absPath);
      traceRename('wiki-unlink-unmatched', { absPath, relPath: this.wikiRelPathFromAbsPath(absPath) });
      this.emit('wiki:changed');
      const rel = this.wikiRelPathFromAbsPath(absPath);
      if (rel && !rel.startsWith('..')) this.emit('wiki:deleted', rel);
    }, 350);
    this.pendingWikiUnlinks.set(absPath, timer);
  }

  private takePendingLibraryRename(rootPath: string, newAbsPath: string): string | null {
    const newDir = path.dirname(newAbsPath);
    for (const [oldAbsPath, pending] of this.pendingLibraryUnlinks) {
      if (pending.rootPath !== rootPath || path.dirname(oldAbsPath) !== newDir) continue;
      clearTimeout(pending.timer);
      this.pendingLibraryUnlinks.delete(oldAbsPath);
      return oldAbsPath;
    }
    return null;
  }

  private handleLibraryRootAdd(rootPath: string, absPath: string): void {
    const oldAbsPath = this.takePendingLibraryRename(rootPath, absPath);
    if (!oldAbsPath) {
      traceRename('library-add-unmatched', { rootPath, absPath });
      this.emit('library:changed', rootPath);
      return;
    }

    const oldRelPath = this.libraryRelPathFromAbsPath(rootPath, oldAbsPath);
    const newRelPath = this.libraryRelPathFromAbsPath(rootPath, absPath);
    traceRename('library-add-matched', { rootPath, oldAbsPath, newAbsPath: absPath, oldRelPath, newRelPath });
    this.emitRename({
      rootPath,
      oldRelPath,
      newRelPath,
      oldAbsPath,
      newAbsPath: absPath,
      builtin: false,
      source: 'watcher',
      detectedAt: Date.now(),
    });
    this.recordWatchedReadingRename(oldAbsPath, absPath);
  }

  private scheduleLibraryRootUnlink(rootPath: string, absPath: string): void {
    const existing = this.pendingLibraryUnlinks.get(absPath);
    if (existing) clearTimeout(existing.timer);
    traceRename('library-unlink-pending', { rootPath, absPath, relPath: this.libraryRelPathFromAbsPath(rootPath, absPath), waitMs: 350 });
    const timer = setTimeout(() => {
      this.pendingLibraryUnlinks.delete(absPath);
      traceRename('library-unlink-unmatched', { rootPath, absPath, relPath: this.libraryRelPathFromAbsPath(rootPath, absPath) });
      this.emit('library:changed', rootPath);
    }, 350);
    this.pendingLibraryUnlinks.set(absPath, { rootPath, timer });
  }

  startWikiWatcher(): void {
    if (this.wikiWatcher || this.wikiWatcherPending) return;
    const wikiRoot = this.wikiDir;

    if (!fs.existsSync(wikiRoot)) {
      const parent = path.dirname(wikiRoot);
      if (!fs.existsSync(parent)) return;
      this.wikiWatcherPending = true;
      const parentWatcher = chokidar.watch(parent, {
        ignoreInitial: true,
        depth: 0,
      });
      parentWatcher.on('addDir', (dirPath) => {
        if (path.basename(dirPath) === path.basename(wikiRoot)) {
          parentWatcher.close();
          this.wikiWatcherPending = false;
          this.startWikiWatcher();
        }
      });
      return;
    }

    this.wikiWatcher = chokidar.watch([
      path.join(wikiRoot, '**/*.md'),
      path.join(wikiRoot, '**/*.markdown'),
      path.join(wikiRoot, '**/*.mdx'),
      path.join(wikiRoot, '**/*.html'),
      path.join(wikiRoot, '**/*.htm'),
      path.join(wikiRoot, '**/*.css'),
    ], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      ignorePermissionErrors: true,
    });

    this.wikiWatcher.on('add', (absPath: string) => {
      if (getLibraryTextDocumentKind(absPath) === 'markdown') this.handleWikiAdd(absPath);
      else this.emit('library:changed', this.wikiDir);
    });
    this.wikiWatcher.on('change', (absPath: string) => {
      if (getLibraryTextDocumentKind(absPath) === 'markdown') this.emit('wiki:changed');
      else this.emit('library:changed', this.wikiDir);
    });
    // On unlink, also emit `wiki:deleted` with the relPath so downstream
    // consumers (RecentManager) can prune stale entries when the delete
    // happens outside the app — Finder trash, `rm`, `git checkout`, etc.
    this.wikiWatcher.on('unlink', (absPath: string) => {
      if (getLibraryTextDocumentKind(absPath) === 'markdown') this.scheduleWikiUnlink(absPath);
      else this.emit('library:changed', this.wikiDir);
    });
    this.wikiWatcher.on('error', (err) => log.error('Wiki watcher error:', err));
  }

  saveWikiPage(relPath: string, content: string, expectedVersion?: DocumentVersion | null): DocumentSaveResult {
    const absPath = this.resolveWikiPageWritePath(relPath);
    if (!absPath) return { ok: false, reason: 'not-found' };
    try {
      const previousContent = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : '';
      const nextContent = isMarkdownDocumentPath(absPath)
        ? stampMarkdownContentEditIfBodyChanged(previousContent, content)
        : content;
      const result = writeTextFileWithConflictGuard(absPath, nextContent, expectedVersion);
      if (!result.ok) return result;
      this.emit('wiki:changed');
      return result;
    } catch (error) {
      log.error(`Error saving wiki page ${relPath}:`, error);
      return { ok: false, reason: 'error' };
    }
  }

  /** Rename a wiki page in place. Returns the new relPath on success. */
  renameWikiPage(relPath: string, newName: string): string | null {
    const trimmed = newName.trim();
    if (!trimmed) return null;
    const oldAbs = this.resolveExistingWikiPagePath(relPath);
    if (!oldAbs) return null;
    const newFileName = this.markdownFileNameFromTitle(trimmed, path.extname(oldAbs));
    if (!newFileName) return null;
    const folder = path.posix.dirname(relPath);
    const newNameWithoutExt = stripMarkdownFileExtension(newFileName);
    const newRelPath = folder && folder !== '.' ? `${folder}/${newNameWithoutExt}` : newNameWithoutExt;
    const newAbs = path.resolve(this.wikiDir, `${newRelPath}${path.extname(oldAbs)}`);
    if (!this.isInsidePath(this.wikiDir, oldAbs) || !this.isInsidePath(this.wikiDir, newAbs)) return null;
    if (newRelPath === relPath) {
      return relPath;
    }
    const existingTargetAbs = this.resolveExistingWikiPagePath(newRelPath);
    if (existingTargetAbs && !this.isSameExistingPath(existingTargetAbs, oldAbs)) return null;
    try {
      fs.renameSync(oldAbs, newAbs);
      this.emitRename({
        rootPath: this.wikiDir,
        oldRelPath: relPath,
        newRelPath,
        oldAbsPath: oldAbs,
        newAbsPath: newAbs,
        builtin: true,
        source: 'app',
        detectedAt: Date.now(),
      });
      // Let RecentManager prune the stale entry for the old relPath.
      this.emit('wiki:deleted', relPath);
      return newRelPath;
    } catch (error) {
      log.error(`Error renaming wiki page ${relPath} -> ${newRelPath}:`, error);
      return null;
    }
  }

  async deleteWikiPage(relPath: string): Promise<boolean> {
    const absPath = this.resolveExistingWikiPagePath(relPath);
    if (!absPath) return false;
    try {
      await shell.trashItem(absPath);
      this.emit('wiki:changed');
      this.emit('wiki:deleted', relPath);
      return true;
    } catch (error) {
      log.error(`Error trashing wiki page ${relPath}:`, error);
      return false;
    }
  }

  async deleteLibraryDir(rootPath: string, dirRelPath: string): Promise<boolean> {
    const root = this.resolveLibraryRootForWrite(rootPath);
    const normalizedDir = this.normalizeLibraryRelPath(dirRelPath);
    if (!root || !normalizedDir) return false;

    const dirPath = path.resolve(root.rootPath, normalizedDir);
    if (!this.isInsidePath(root.rootPath, dirPath)) return false;
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return false;

    const deletedWikiRelPaths = root.builtin
      ? this.flattenWikiFiles(this.scanMarkdownTree(root.rootPath, dirPath)).map((page) => page.relPath)
      : [];

    try {
      await shell.trashItem(dirPath);
      if (root.builtin) {
        this.emit('wiki:changed');
        for (const relPath of deletedWikiRelPaths) {
          this.emit('wiki:deleted', relPath);
        }
      } else {
        this.emit('library:changed', root.rootPath);
      }
      return true;
    } catch (error) {
      log.error(`Error trashing library dir ${normalizedDir}:`, error);
      return false;
    }
  }

  async deleteExternalLibraryFile(filePath: string): Promise<boolean> {
    const normalizedPath = this.normalizePath(this.expandPath(filePath));

    let canonicalPath: string;
    try {
      canonicalPath = fs.realpathSync(normalizedPath);
    } catch {
      return false;
    }

    const rootPath = [this.wikiDir, ...this.getSafeLibraryRootPaths()].find((savedRoot) => {
      const normalizedRoot = this.normalizePath(this.expandPath(savedRoot));
      const rootKey = this.libraryRootKey(normalizedRoot);
      const relative = path.relative(rootKey, canonicalPath);
      return !!relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    });
    if (!rootPath || !fs.existsSync(canonicalPath) || !fs.statSync(canonicalPath).isFile()) return false;

    try {
      await shell.trashItem(canonicalPath);
      this.emit('library:changed', this.normalizePath(this.expandPath(rootPath)));
      return true;
    } catch (error) {
      log.error(`Error trashing external library file ${canonicalPath}:`, error);
      return false;
    }
  }

  private resolveLibraryFilePathFromRelPath(rootPath: string, relPath: string): string {
    const exact = path.resolve(rootPath, relPath);
    if (isLibraryTextDocumentPath(exact)) return exact;
    const markdownCandidates = [
      path.resolve(rootPath, `${relPath}.md`),
      path.resolve(rootPath, `${relPath}.markdown`),
      path.resolve(rootPath, `${relPath}.mdx`),
    ];
    return markdownCandidates.find((candidate) => fs.existsSync(candidate)) ?? markdownCandidates[0];
  }

  moveLibraryItem(rootPath: string, kind: LibraryMoveKind, sourceRelPath: string, targetDirRelPath: string, targetRootPath = rootPath): string | null {
    const sourceRoot = this.resolveLibraryRootForWrite(rootPath);
    const targetRoot = this.resolveLibraryRootForWrite(targetRootPath);
    const sourceRel = this.normalizeLibraryRelPath(sourceRelPath);
    const targetDirRel = this.normalizeLibraryRelPath(targetDirRelPath);
    if (!sourceRoot || !targetRoot || !sourceRel || targetDirRel === null) return null;
    const crossRoot = this.libraryRootKey(sourceRoot.rootPath) !== this.libraryRootKey(targetRoot.rootPath);
    if (crossRoot && kind !== 'file') return null;
    if (!sourceRoot.builtin && !this.canWriteDirectory(sourceRoot.rootPath)) return null;
    if (!targetRoot.builtin && !this.canWriteDirectory(targetRoot.rootPath)) return null;
    if (sourceRoot.builtin && kind === 'dir' && DEFAULT_LIBRARY_FOLDER_ID_SET.has(sourceRel)) return null;

    const sourceAbs = kind === 'file'
      ? this.resolveLibraryFilePathFromRelPath(sourceRoot.rootPath, sourceRel)
      : path.resolve(sourceRoot.rootPath, sourceRel);
    const targetDirAbs = path.resolve(targetRoot.rootPath, targetDirRel);
    if (!this.isInsidePath(sourceRoot.rootPath, sourceAbs) || !this.isInsidePath(targetRoot.rootPath, targetDirAbs)) return null;
    if (!fs.existsSync(sourceAbs)) return null;
    if (!fs.existsSync(targetDirAbs) || !fs.statSync(targetDirAbs).isDirectory()) return null;

    if (kind === 'file') {
      if (!fs.statSync(sourceAbs).isFile()) return null;
    } else if (!fs.statSync(sourceAbs).isDirectory()) {
      return null;
    }

    if (kind === 'dir' && this.isInsidePath(sourceAbs, targetDirAbs)) return null;

    const name = path.basename(sourceAbs);
    const targetAbs = path.resolve(targetDirAbs, name);
    if (!this.isInsidePath(targetRoot.rootPath, targetAbs)) return null;
    if (sourceAbs === targetAbs) return sourceRel;
    if (fs.existsSync(targetAbs)) return null;

    const sourceIsMarkdownDocument = getLibraryTextDocumentKind(sourceAbs) === 'markdown';
    const sourceIsWikiMove = sourceRoot.builtin && (kind === 'dir' || sourceIsMarkdownDocument);
    const deletedWikiRelPaths = sourceIsWikiMove
      ? kind === 'file'
        ? [sourceRel]
        : this.flattenWikiFiles(this.scanMarkdownTree(sourceRoot.rootPath, sourceAbs)).map((page) => page.relPath)
      : [];

    try {
      this.moveLibraryPathSync(sourceAbs, targetAbs, kind);
      const newRelPath = stripMarkdownFileExtension(this.toPortableRelPath(path.relative(targetRoot.rootPath, targetAbs)));
      if (sourceIsWikiMove) {
        this.emit('wiki:changed');
        for (const relPath of deletedWikiRelPaths) {
          this.emit('wiki:deleted', relPath);
        }
      } else {
        this.emit('library:changed', sourceRoot.rootPath);
      }
      if (crossRoot) {
        if (targetRoot.builtin) {
          if (sourceIsMarkdownDocument) this.emit('wiki:changed');
          else this.emit('library:changed', targetRoot.rootPath);
        } else {
          this.emit('library:changed', targetRoot.rootPath);
        }
      }
      return newRelPath;
    } catch (error) {
      log.error(`Error moving library ${kind} ${sourceRel} -> ${targetDirRel}:`, error);
      return null;
    }
  }

  private createWikiFileWithInitialTitle(folderName: string, fileName: string): WikiPage | null {
    const markdownFileName = this.markdownFileNameFromTitle(fileName);
    if (!markdownFileName) return null;
    const title = this.stripMarkdownFileExtension(markdownFileName).trim();
    const folderRelPath = this.normalizeLibraryRelPath(folderName);
    if (folderRelPath === null || folderRelPath === 'artifacts' || folderRelPath.startsWith('artifacts/')) return null;
    const relPath = folderRelPath ? `${folderRelPath}/${title}` : title;
    const absPath = path.resolve(this.wikiDir, folderRelPath, markdownFileName);
    if (!this.isInsidePath(this.wikiDir, absPath)) return null;
    if (fs.existsSync(absPath)) return null;
    const dirPath = path.dirname(absPath);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    const content = '';
    try {
      fs.writeFileSync(absPath, content, 'utf-8');
      const stats = fs.statSync(absPath);
      // Emit synchronously — chokidar can lag
      // several seconds when the folder didn't exist at watcher setup,
      // which leaves the sidebar stale until the next FS tick.
      this.emit('wiki:changed');
      return { relPath, absPath, name: title, title, lastUpdated: Math.floor(stats.mtimeMs), content, documentVersion: readDocumentVersion(absPath) };
    } catch (error) {
      log.error(`Error creating wiki file ${relPath}:`, error);
      return null;
    }
  }

  createWikiFile(folderName: string, fileName: string): WikiPage | null {
    return this.createWikiFileWithInitialTitle(folderName, fileName);
  }

  createWikiFileWithTitle(folderName: string, title: string): WikiPage | null {
    const trimmed = title.trim();
    if (!trimmed) return null;
    return this.createWikiFileWithInitialTitle(folderName, trimmed);
  }

  createWikiFileWithDefaultTitle(folderName: string): WikiPage | null {
    const now = new Date();
    const firstTitle = defaultScratchpadName(now);
    const first = this.createWikiFileWithTitle(folderName, firstTitle);
    if (first) return first;
    const fallbackTitle = defaultScratchpadNameWithTime(now);
    return this.createWikiFileWithTitle(folderName, fallbackTitle);
  }

  // Scratchpad hotkey flow uses a friendly date title, with a time fallback
  // if today's filename already exists.
  createScratchpadDefault(): WikiPage | null {
    return this.createWikiFileWithDefaultTitle('scratchpad');
  }

  createWikiDir(dirName: string): boolean {
    const relPath = this.normalizeLibraryRelPath(dirName);
    if (!relPath || relPath === 'artifacts' || relPath.startsWith('artifacts/')) return false;
    const dirPath = path.resolve(this.wikiDir, relPath);
    if (!this.isInsidePath(this.wikiDir, dirPath)) return false;
    if (fs.existsSync(dirPath)) return false;
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      this.emit('wiki:changed');
      return true;
    } catch (error) {
      log.error(`Error creating wiki dir ${relPath}:`, error);
      return false;
    }
  }

  createLibraryFile(rootPath: string, folderRelPath: string, fileName: string): WikiPage | null {
    const root = this.resolveLibraryRootForWrite(rootPath);
    const normalizedFolder = this.normalizeLibraryRelPath(folderRelPath);
    if (!root || normalizedFolder === null) return null;

    if (root.builtin) {
      return this.createWikiFile(normalizedFolder, fileName);
    }

    if (!this.canWriteDirectory(root.rootPath)) return null;

    const markdownFileName = this.markdownFileNameFromTitle(fileName);
    if (!markdownFileName) return null;
    const title = this.stripMarkdownFileExtension(markdownFileName).trim();
    const relPath = normalizedFolder ? `${normalizedFolder}/${title}` : title;
    const absPath = path.resolve(root.rootPath, normalizedFolder, markdownFileName);
    if (!this.isInsidePath(root.rootPath, absPath)) return null;
    if (fs.existsSync(absPath)) return null;

    const dirPath = path.dirname(absPath);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    const content = '';
    try {
      fs.writeFileSync(absPath, content, 'utf-8');
      const stats = fs.statSync(absPath);
      this.emit('library:changed', root.rootPath);
      return { relPath, absPath, name: title, title, lastUpdated: Math.floor(stats.mtimeMs), content, documentVersion: readDocumentVersion(absPath) };
    } catch (error) {
      log.error(`Error creating library file ${relPath}:`, error);
      return null;
    }
  }

  createLibraryDir(rootPath: string, dirRelPath: string): boolean {
    const root = this.resolveLibraryRootForWrite(rootPath);
    const normalizedDir = this.normalizeLibraryRelPath(dirRelPath);
    if (!root || !normalizedDir) return false;

    if (root.builtin) {
      return this.createWikiDir(normalizedDir);
    }

    if (!this.canWriteDirectory(root.rootPath)) return false;

    const dirPath = path.resolve(root.rootPath, normalizedDir);
    if (!this.isInsidePath(root.rootPath, dirPath)) return false;
    if (fs.existsSync(dirPath)) return false;

    try {
      fs.mkdirSync(dirPath, { recursive: true });
      this.emit('library:changed', root.rootPath);
      return true;
    } catch (error) {
      log.error(`Error creating library dir ${normalizedDir}:`, error);
      return false;
    }
  }

  /**
   * Save reading content to disk.
   * Updates the file and refreshes the cache.
   */
  saveReading(filePath: string, content: string, expectedVersion?: DocumentVersion | null): DocumentSaveResult {
    const normalizedPath = this.resolveWatchedReadingPath(filePath);
    if (!normalizedPath) return { ok: false, reason: 'not-found' };

    try {
      const previousContent = fs.existsSync(normalizedPath) ? fs.readFileSync(normalizedPath, 'utf-8') : '';
      const nextContent = isMarkdownDocumentPath(normalizedPath)
        ? stampMarkdownContentEditIfBodyChanged(previousContent, content)
        : content;
      const result = writeTextFileWithConflictGuard(normalizedPath, nextContent, expectedVersion);
      if (!result.ok) return result;

      // Re-parse metadata since content may have changed title/context
      const meta = this.parseFileMetadata(normalizedPath);
      if (meta) {
        this.cache.set(normalizedPath, meta);
        this.saveIndex();
        // Emit update event so UI can refresh
        this.emit('reading-updated', meta);
      }

      return result;
    } catch (error) {
      log.error(`Error saving file ${normalizedPath}:`, error);
      return { ok: false, reason: 'error' };
    }
  }

  /**
   * Delete a reading file from disk.
   * Removes the file and updates the cache.
   */
  async deleteReading(filePath: string): Promise<boolean> {
    const normalizedPath = this.resolveWatchedReadingPath(filePath);
    if (!normalizedPath) return false;

    try {
      // Check if file exists
      if (!fs.existsSync(normalizedPath)) {
        return false;
      }

      await shell.trashItem(normalizedPath);

      // Remove from cache
      this.cache.delete(normalizedPath);
      this.saveIndex();

      // Emit removal event so UI can refresh
      this.emit('reading-removed', normalizedPath);

      return true;
    } catch (error) {
      log.error(`Error deleting file ${normalizedPath}:`, error);
      return false;
    }
  }

  // ===========================================================================
  // Public API: Watched Directories
  // ===========================================================================

  /**
   * Get all watched directories.
   */
  getWatchedDirs(): WatchedDir[] {
    return this.settings.watchedDirs.map(dirPath => ({
      path: dirPath,
      enabled: true,
    }));
  }

  /**
   * Add a directory to watch.
   * Returns the WatchedDir if successful, null if not found or already watched.
   */
  addWatchedDir(dirPath: string): WatchedDir | null {
    const expandedPath = this.expandPath(dirPath);
    const normalizedPath = this.normalizePath(expandedPath);

    // Check if directory exists
    if (!fs.existsSync(normalizedPath)) {
      return null;
    }

    // Check if already watched
    if (this.settings.watchedDirs.includes(normalizedPath)) {
      return null;
    }

    // Add to settings
    this.settings.watchedDirs.push(normalizedPath);
    this.saveSettings();

    // Start watching
    this.watchDirectory(normalizedPath);

    return { path: normalizedPath, enabled: true };
  }

  /**
   * Remove a watched directory by path.
   * Also removes all cached readings from that directory.
   */
  removeWatchedDir(dirPath: string): boolean {
    const normalizedPath = this.normalizePath(dirPath);

    const index = this.settings.watchedDirs.indexOf(normalizedPath);
    if (index === -1) {
      return false;
    }

    // Stop watching
    this.unwatchDirectory(normalizedPath);

    // Remove from settings
    this.settings.watchedDirs.splice(index, 1);
    this.saveSettings();

    // Remove cached entries for this directory
    let removedCount = 0;
    for (const [cachedPath] of this.cache) {
      if (cachedPath.startsWith(normalizedPath + path.sep)) {
        this.cache.delete(cachedPath);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      this.saveIndex();
    }

    return true;
  }

  getHiddenDefaultFolders(): string[] {
    return normalizeHiddenDefaultFolders(this.settings.hiddenDefaultFolders);
  }

  setDefaultFolderHidden(folderId: string, hidden: boolean): string[] {
    const current = this.getHiddenDefaultFolders();
    const normalizedFolderId = normalizeHiddenLibraryFolderId(folderId);
    if (!normalizedFolderId) {
      return current;
    }

    const requested = new Set(current);
    if (hidden) {
      requested.add(normalizedFolderId);
    } else {
      requested.delete(normalizedFolderId);
    }

    const next = normalizeHiddenDefaultFolders([...requested]);
    if (next.join('\0') !== current.join('\0')) {
      this.settings.hiddenDefaultFolders = next;
      this.saveSettings();
      this.emit('library:changed', this.wikiDir);
    }
    return next;
  }

  // ===========================================================================
  // Public API: Settings
  // ===========================================================================

  // ===========================================================================
  // New Settings API (v2)
  // ===========================================================================

  /**
   * Check if Librarian is enabled.
   */
  isEnabled(): boolean {
    return this.settings.enabled;
  }

  /**
   * Enable or disable Librarian and update CLAUDE.md.
   * When disabling, also uninstalls hooks to prevent blocking Claude Code/Cursor.
   */
  setEnabled(enabled: boolean): boolean {
    this.settings.enabled = enabled;
    this.saveSettings();

    // Sync enabled state to global config (hook reads this)
    this.syncToGlobalConfig(false);

    if (!enabled) {
      // Uninstall hooks when disabling to prevent blocking user.
      // If hooks point to non-existent scripts, Claude Code fails entirely.
      this.uninstallStateEnforcedHook();
      this.uninstallCursorHook();
      this.uninstallCodexHook();
    }

    const success = this.syncClaudeMd();
    return success;
  }

  /**
   * Check if Librarian setup wizard has been completed.
   */
  isSetupComplete(): boolean {
    this.ensureUserScopedSettingsLoaded();
    return this.settings.librarianSetupComplete === true || hasExistingLibraryContent(this.wikiDir);
  }

  /**
   * Mark Librarian setup as complete.
   */
  setSetupComplete(complete: boolean): void {
    this.ensureUserScopedSettingsLoaded();
    this.settings.librarianSetupComplete = complete;
    this.saveSettings();
  }

  // ===========================================================================
  // State-Enforced Mode Settings
  // ===========================================================================

  /**
   * Default rule content for state-enforced mode artifacts.
   * 120-200 word reflective story format.
   */
  private readonly DEFAULT_RULE_CONTENT =
    `Write a short reflective story (120–200 words) that connects the current work to science, technology, companies, history, biology, chemistry, or physics. Stories are memorable. Don't hallucinate.

Default behavior:
	•	Be grounded, calm, and practical.
	•	Make the connection feel natural but also surprising.
	•	Favor novelty.

Occasionally—but not predictably—shift modes and do one of the following:
	•	Reveal an adjacent historical or technical parallel that reframes the work.
	•	Introduce a concept from another discipline that subtly changes how the problem can be seen.

Avoid forced cleverness.
Avoid maximalism.`;

  /**
   * Get the state-enforced mode threshold (prompts before job creation).
   */
  getStateEnforcedThreshold(): number {
    return this.settings.stateEnforcedThreshold ?? 7;  // Default to 'sometimes' frequency
  }

  /**
   * Set the state-enforced mode threshold.
   * Also updates the global config if hook is installed.
   */
  setStateEnforcedThreshold(threshold: number): boolean {
    this.settings.stateEnforcedThreshold = threshold;
    this.saveSettings();

    // Update global config if it exists
    const configPath = this.getGlobalStateEnforcedConfigPath();
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.threshold = threshold;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      } catch {
        // Ignore errors
      }
    }

    return true;
  }

  /**
   * Get the default rule content for state-enforced mode.
   */
  getDefaultRuleContent(): string {
    return buildEffectiveArtifactRuleContent(this.DEFAULT_RULE_CONTENT);
  }

  /**
   * Get the custom rule content if set.
   */
  getCustomRuleContent(): string | undefined {
    return this.settings.stateEnforcedRuleContent;
  }

  /**
   * Set custom rule content for state-enforced mode.
   * Also syncs to global config for hooks.
   * Pass undefined to reset to default.
   */
  setCustomRuleContent(content: string | undefined): boolean {
    this.settings.stateEnforcedRuleContent = content?.trim() || undefined;
    this.saveSettings();

    // Sync to global config (no threshold recalculation)
    this.syncToGlobalConfig(false);

    return true;
  }

  // ===========================================================================
  // Discovery Frequency Settings
  // ===========================================================================

  /**
   * Get the current discovery frequency setting.
   */
  getDiscoveryFrequency(): DiscoveryFrequency {
    return this.settings.discoveryFrequency || 'sometimes';
  }

  /**
   * Set the discovery frequency and update thresholds.
   */
  setDiscoveryFrequency(frequency: DiscoveryFrequency): boolean {
    this.settings.discoveryFrequency = frequency;
    this.saveSettings();

    // Sync to global config with threshold recalculation
    this.syncToGlobalConfig(true);

    return true;
  }

  isCodexStopOnPendingEnabled(): boolean {
    return this.settings.codexStopOnPending ?? false;
  }

  setCodexStopOnPendingEnabled(enabled: boolean): boolean {
    this.settings.codexStopOnPending = enabled;
    this.saveSettings();
    this.syncToGlobalConfig(false);
    this.syncCodexStopHookRegistration(enabled && this.hasPendingCodexArtifactJob());
    return true;
  }

  // ===========================================================================
  // User Expertise Context
  // ===========================================================================

  /**
   * Get the user's expertise/interests context.
   */
  getUserExpertiseContext(): string | undefined {
    return this.settings.userExpertiseContext;
  }

  /**
   * Set the user's expertise/interests context.
   * Limited to 400 characters.
   */
  setUserExpertiseContext(context: string | undefined): boolean {
    // Enforce 400 char limit
    const trimmed = context?.trim().slice(0, 400) || undefined;
    this.settings.userExpertiseContext = trimmed;
    this.saveSettings();
    this.syncToGlobalConfig(false);
    return true;
  }

  /**
   * Get the effective rule content with user expertise appended.
   */
  getEffectiveRuleContent(): string {
    const baseRule = this.settings.stateEnforcedRuleContent || this.DEFAULT_RULE_CONTENT;
    return buildEffectiveArtifactRuleContent(baseRule, this.settings.userExpertiseContext);
  }

  /**
   * Sync current user's preferences to the global config that hooks read.
   * Called on login and whenever settings change.
   *
   * @param recalculateThreshold - Only true when frequency changes. Other settings
   *                               changes should preserve existing threshold.
   */
  private syncToGlobalConfig(recalculateThreshold: boolean = false): void {
    const globalConfigPath = path.join(os.homedir(), '.fieldtheory', 'librarian', 'config.json');
    const globalStatePath = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');

    // Ensure directory exists
    const dir = path.dirname(globalConfigPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write config with all user preferences
    const effectiveRuleContent = this.getEffectiveRuleContent();
    const config = {
      enabled: this.settings.enabled,
      frequency: this.settings.discoveryFrequency || 'sometimes',
      stop_on_pending: this.settings.codexStopOnPending ?? false,
      rule_content: effectiveRuleContent,  // Includes expertise!
    };
    fs.writeFileSync(globalConfigPath, JSON.stringify(config, null, 2));

    // Codex's stop-hook passes the rule file *path* to the agent (not inline
    // content like Claude's UserPromptSubmit hook), so this file must stay in
    // sync with rule_content or Codex writes artifacts without the required
    // title/signature structure.
    const rulesDir = path.join(dir, 'rules');
    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true });
    }
    fs.writeFileSync(path.join(rulesDir, 'history_reading.md'), effectiveRuleContent);

    // Only update state.json threshold if frequency changed
    if (recalculateThreshold) {
      const threshold = this.pickNextDiscoveryThreshold();
      let state = { count: 0, threshold };
      if (fs.existsSync(globalStatePath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(globalStatePath, 'utf-8'));
          state.count = existing.count || 0;  // Preserve count
          state.threshold = threshold;
        } catch {
          // Use fresh state on parse error
        }
      }
      fs.writeFileSync(globalStatePath, JSON.stringify(state, null, 2));
    }

    // Clean up any legacy duplicate hooks and regenerate if needed
    this.cleanupLegacyHooks();
    this.ensureHookUpToDate();
  }

  /**
   * Remove legacy run-hook.sh based hooks that cause double-counting.
   * Called on every sync to ensure cleanup happens even if app was updated.
   */
  private cleanupLegacyHooks(): void {
    const settingsPath = this.getClaudeSettingsPath();
    if (!fs.existsSync(settingsPath)) return;

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (!settings.hooks) return;

      const legacyPatterns = [
        'run-hook.sh',
        '.fieldtheory/librarian/hook.py',
        '.fieldtheory/librarian/pretool.py',
      ];
      const isLegacyHook = (command?: string): boolean => {
        if (!command) return false;
        return legacyPatterns.some(pattern => command.includes(pattern));
      };

      type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };
      let modified = false;

      if (Array.isArray(settings.hooks.UserPromptSubmit)) {
        const before = settings.hooks.UserPromptSubmit.length;
        settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
          (h: HookEntry) => !h.hooks?.some(hh => isLegacyHook(hh.command))
        );
        if (settings.hooks.UserPromptSubmit.length < before) {
          modified = true;
        }
        if (settings.hooks.UserPromptSubmit.length === 0) {
          delete settings.hooks.UserPromptSubmit;
        }
      }

      if (Array.isArray(settings.hooks.PreToolUse)) {
        const before = settings.hooks.PreToolUse.length;
        settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
          (h: HookEntry) => !h.hooks?.some(hh => isLegacyHook(hh.command))
        );
        if (settings.hooks.PreToolUse.length < before) {
          modified = true;
        }
        if (settings.hooks.PreToolUse.length === 0) {
          delete settings.hooks.PreToolUse;
        }
      }

      if (modified) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }
    } catch (error) {
      log.error('Failed to cleanup legacy hooks:', error);
    }
  }

  /**
   * Hook version for detecting when regeneration is needed.
   */
  private readonly HOOK_VERSION = '2.0';

  /**
   * Ensure hooks are up to date with current template.
   * Checks version marker and regenerates if needed.
   * Only updates the active ~/.claude/ hooks (legacy .fieldtheory/librarian/ hooks are cleaned up).
   */
  private ensureHookUpToDate(): void {
    const hookScript = this.generateStateEnforcedHookScript();

    // Only update the active hook at ~/.claude/
    const hookPath = this.getStateEnforcedHookPath();
    if (fs.existsSync(hookPath)) {
      try {
        const content = fs.readFileSync(hookPath, 'utf-8');
        const versionMatch = content.match(/# Field Theory Librarian Hook v(\d+\.\d+)/);
        const currentVersion = versionMatch?.[1];

        if (currentVersion !== this.HOOK_VERSION) {
          // Regenerate hook with new template
          fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });
        }
      } catch (error) {
        log.error(`Failed to check hook version at ${hookPath}:`, error);
      }
    }

    const cursorHookPath = this.getCursorHookScriptPath();
    if (fs.existsSync(cursorHookPath)) {
      try {
        const content = fs.readFileSync(cursorHookPath, 'utf-8');
        const versionMatch = content.match(/# Field Theory Librarian Cursor Hook v(\d+\.\d+)/);
        const currentVersion = versionMatch?.[1];

        if (currentVersion !== this.HOOK_VERSION) {
          fs.writeFileSync(cursorHookPath, this.generateCursorHookScript(), { mode: 0o755 });
        }
      } catch (error) {
        log.error('Failed to check Cursor hook version:', error);
      }
    }

    // Check Cursor pretool hook
    const cursorPreToolPath = this.getCursorPreToolScriptPath();
    if (fs.existsSync(cursorPreToolPath)) {
      try {
        const content = fs.readFileSync(cursorPreToolPath, 'utf-8');
        const versionMatch = content.match(/# Field Theory Librarian PreToolUse Hook v(\d+\.\d+)/);
        const currentVersion = versionMatch?.[1];

        if (currentVersion !== this.HOOK_VERSION) {
          // Regenerate Cursor pretool with new template
          fs.writeFileSync(cursorPreToolPath, this.generateCursorPreToolScript(), { mode: 0o755 });
        }
      } catch (error) {
        log.error('Failed to check Cursor pretool version:', error);
      }
    }

    const cursorConfigPath = this.getCursorHooksConfigPath();
    if (fs.existsSync(cursorConfigPath)) {
      try {
        const cursorConfig = JSON.parse(fs.readFileSync(cursorConfigPath, 'utf-8'));
        const hasAnyCursorHook = hasCursorCommandHook(cursorConfig, 'beforeSubmitPrompt', 'cursor-hook.py')
          || hasCursorCommandHook(cursorConfig, 'preToolUse', 'cursor-pretool.py');

        if (hasAnyCursorHook && !this.isCursorHookInstalled()) {
          this.installCursorHook();
        }
      } catch (error) {
        log.error('Failed to upgrade Cursor hook config:', error);
      }
    }

    const codexHooksConfigPath = this.getCodexHooksConfigPath();
    const codexConfigTomlPath = this.getCodexConfigPath();
    const codexAgentsMdPath = this.getCodexAgentsMdPath();
    let hasLegacySessionStart = false;
    let hasDynamicStopHook = false;
    let hasManagedCodexInstall = false;

    if (fs.existsSync(codexHooksConfigPath)) {
      try {
        const codexConfig = JSON.parse(fs.readFileSync(codexHooksConfigPath, 'utf-8'));
        hasLegacySessionStart = hasCodexCommandHook(codexConfig, 'SessionStart', LEGACY_CODEX_SESSION_START_SCRIPT);
        hasDynamicStopHook = hasCodexCommandHook(codexConfig, 'Stop', CODEX_STOP_SCRIPT);
        hasManagedCodexInstall = hasLegacySessionStart || hasDynamicStopHook;
      } catch (error) {
        log.error('Failed to read Codex hook config:', error);
      }
    }

    if (fs.existsSync(codexConfigTomlPath)) {
      try {
        hasManagedCodexInstall = this.hasCodexNotifyConfiguration(fs.readFileSync(codexConfigTomlPath, 'utf-8'))
          || hasManagedCodexInstall;
      } catch (error) {
        log.error('Failed to read Codex config.toml:', error);
      }
    }

    if (fs.existsSync(codexAgentsMdPath)) {
      try {
        hasManagedCodexInstall = this.hasCodexManagedSection(fs.readFileSync(codexAgentsMdPath, 'utf-8'))
          || hasManagedCodexInstall;
      } catch (error) {
        log.error('Failed to read Codex AGENTS.md:', error);
      }
    }

    hasManagedCodexInstall = hasManagedCodexInstall
      || fs.existsSync(this.getCodexNotifyScriptPath())
      || fs.existsSync(this.getCodexStopScriptPath());

    const shouldHaveDynamicStop = this.isCodexStopOnPendingEnabled() && this.hasPendingCodexArtifactJob();
    if (hasManagedCodexInstall && (hasLegacySessionStart || !this.isCodexHookInstalled() || hasDynamicStopHook !== shouldHaveDynamicStop)) {
      this.installCodexHook();
    }
  }

  /**
   * Sync CLAUDE.md with current settings.
   * Called whenever enabled, triggerMode, or content guidance changes.
   */
  syncClaudeMd(): boolean {
    if (!this.settings.enabled) {
      // If disabled, remove the Librarian section
      return this.removeLibrarianSection();
    }
    return this.writeLibrarianSection();
  }

  // ===========================================================================
  // Legacy Settings API (deprecated, kept for backward compatibility)
  // ===========================================================================

  /**
   * Get the auto-run frequency setting.
   * @deprecated Use isEnabled() + getTriggerMode() instead
   */
  getAutoRunFrequency(): AutoRunFrequency {
    // Map new settings to legacy frequency for backward compatibility
    if (!this.settings.enabled) return 'off';
    return this.settings.autoRunFrequency || 'always';
  }

  /**
   * Set the auto-run frequency and update CLAUDE.md.
   * @deprecated Use setEnabled() + setTriggerMode() instead
   */
  setAutoRunFrequency(frequency: AutoRunFrequency): boolean {
    // Map legacy frequency to new settings
    this.settings.enabled = frequency !== 'off';
    this.settings.autoRunFrequency = frequency;
    this.saveSettings();
    const success = this.syncClaudeMd();

    // Update threshold in global status file
    this.ensureGlobalStatusExists();
    const statusFile = this.getGlobalStatusPath();
    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      status.nextThreshold = this.pickNextThreshold(frequency);
      status.frequency = frequency;
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
    } catch {
      // Ignore errors updating status file
    }

    return success;
  }

  /**
   * Check if auto-show on new reading is enabled.
   */
  isAutoShowEnabled(): boolean {
    return this.settings.autoShowEnabled;
  }

  /**
   * Set auto-show on new reading setting.
   */
  setAutoShowEnabled(enabled: boolean): void {
    this.settings.autoShowEnabled = enabled;
    this.saveSettings();
  }

  /**
   * Check whether auto-show should activate and focus the Field Theory window.
   */
  doesAutoShowStealFocus(): boolean {
    return this.settings.autoShowStealsFocus ?? true;
  }

  /**
   * Set whether auto-show should activate and focus the Field Theory window.
   */
  setAutoShowStealsFocus(enabled: boolean): void {
    this.settings.autoShowStealsFocus = enabled;
    this.saveSettings();
  }

  /**
   * Check if resume after close is enabled.
   * When true, reopening the window returns to the last artifact instead of clipboard.
   */
  isResumeAfterCloseEnabled(): boolean {
    return this.settings.resumeAfterClose ?? false;
  }

  /**
   * Set resume after close setting.
   */
  setResumeAfterClose(enabled: boolean): void {
    this.settings.resumeAfterClose = enabled;
    this.saveSettings();
  }

  getImmersiveHeightPercent(): number {
    const value = this.settings.immersiveHeightPercent ?? 85;
    return Math.max(50, Math.min(100, Math.round(value)));
  }

  setImmersiveHeightPercent(percent: number): void {
    this.settings.immersiveHeightPercent = Math.max(50, Math.min(100, Math.round(percent)));
    this.saveSettings();
  }

  // ===========================================================================
  // Content Guidance Customization
  // ===========================================================================

  /**
   * Default content guidance for readings.
   * This shapes what type of intellectual content is produced.
   */
  private readonly DEFAULT_CONTENT_GUIDANCE = `${ARTIFACT_STRUCTURE_GUIDANCE}

### Signature Requirement

${ARTIFACT_MODEL_SIGNATURE_GUIDANCE}`;

  /**
   * Get the default content guidance.
   */
  getDefaultContentGuidance(): string {
    return this.DEFAULT_CONTENT_GUIDANCE;
  }

  /**
   * Get the current content guidance (custom if set, otherwise default).
   */
  getContentGuidance(): string {
    return this.settings.customContentGuidance || this.DEFAULT_CONTENT_GUIDANCE;
  }

  /**
   * Get the custom content guidance if set (undefined means using default).
   */
  getCustomContentGuidance(): string | undefined {
    return this.settings.customContentGuidance;
  }

  /**
   * Set custom content guidance and update CLAUDE.md.
   * Pass undefined or empty string to reset to default.
   */
  setCustomContentGuidance(guidance: string | undefined): boolean {
    // Treat empty string as reset to default
    const normalizedGuidance = guidance?.trim() || undefined;
    this.settings.customContentGuidance = normalizedGuidance;
    this.saveSettings();

    // Update CLAUDE.md with new guidance
    const success = this.syncClaudeMd();
    return success;
  }

  /**
   * Reset content guidance to default and update CLAUDE.md.
   */
  resetContentGuidance(): boolean {
    return this.setCustomContentGuidance(undefined);
  }

  /**
   * Force re-sync CLAUDE.md with current settings.
   */
  resyncClaudeMd(): boolean {
    const success = this.syncClaudeMd();
    return success;
  }

  /**
   * Check if Claude Code appears to be installed.
   */
  getClaudeCodeStatus(): 'installed' | 'directory-only' | 'not-installed' {
    const claudeDir = path.join(os.homedir(), '.claude');

    if (!fs.existsSync(claudeDir)) {
      return 'not-installed';
    }

    const typicalFiles = ['settings.json', 'projects', 'statsig'];
    const hasTypicalFiles = typicalFiles.some(file =>
      fs.existsSync(path.join(claudeDir, file))
    );

    if (hasTypicalFiles) {
      return 'installed';
    }

    return 'directory-only';
  }

  // ===========================================================================
  // CLAUDE.md Management
  // ===========================================================================

  private readonly CLAUDE_MD_START_MARKER = '<!-- FIELD_THEORY_LIBRARIAN_START -->';
  private readonly CLAUDE_MD_END_MARKER = '<!-- FIELD_THEORY_LIBRARIAN_END -->';

  /**
   * Generate the core instruction text.
   * Uses custom content guidance if set, otherwise uses default.
   */
  private generateInstructionText(frequency: Exclude<AutoRunFrequency, 'off'>): string {
    const contentGuidance = this.getContentGuidance();

    // For 'always' frequency, frame reading as thinking methodology
    if (frequency === 'always') {
      return `## Librarian (Field Theory)

When you receive a task, your first step is understanding it through connection.

### How to think about tasks
1. Ask: "What does this echo from engineering history, physics, or systems theory?"
2. Write that connection to \`.librarian/YYYY-MM-DD-{slug}.md\`
3. Let the insight shape your implementation approach

This is not a deliverable for the user—it is how you should think about the problem. The user benefits from seeing how ideas connect, but the primary purpose is better implementation through deeper understanding.

### When to create readings
- Before non-trivial implementation work
- When you notice a pattern worth articulating
- When the connection might change your approach

### Project setup (once per project)
Check if \`.claude/settings.json\` contains \`Write(.librarian/*)\` in the allow array. If not, create/update it:
\`\`\`json
{
  "permissions": {
    "allow": ["Write(.librarian/*)"]
  }
}
\`\`\`

### Content
${contentGuidance}

You may find the reading changes what you think matters about the task.`;
    }

    // For other frequencies, frame reading as thinking methodology (less frequent)
    const frequencyDescMap: Record<Exclude<AutoRunFrequency, 'off' | 'always'>, string> = {
      occasionally: 'when tackling particularly interesting problems (~every 5 significant implementations)',
      regularly: 'when the connection feels illuminating (~every 3 significant implementations)',
      frequently: 'for most non-trivial tasks where a pattern emerges',
    };

    return `## Librarian (Field Theory)

Some tasks benefit from understanding them through historical or theoretical connection.

Frequency: ${frequency.charAt(0).toUpperCase() + frequency.slice(1)} — ${frequencyDescMap[frequency as Exclude<AutoRunFrequency, 'off' | 'always'>]}

### How to think about tasks
1. Ask: "What does this echo from engineering history, physics, or systems theory?"
2. If a connection illuminates the problem, write it to \`.librarian/YYYY-MM-DD-{slug}.md\`
3. Let the insight shape your approach

This is not a deliverable—it is how you can think more deeply about the problem.

### Project setup (once per project)
Check if \`.claude/settings.json\` contains \`Write(.librarian/*)\` in the allow array. If not, create or update it:
\`\`\`json
{
  "permissions": {
    "allow": ["Write(.librarian/*)"]
  }
}
\`\`\`

### Content
${contentGuidance}

Field Theory will auto-display readings when created.`;
  }

  /**
   * Generate instruction text based on trigger mode (v2).
   * This is the new method that uses enabled/triggerMode instead of frequency.
   */
  private generateInstructionTextV2(): string {
    const contentGuidance = this.getContentGuidance();
    const mode = this.settings.triggerMode;

    if (mode === 'judgment') {
      // AI judgment mode - AI decides when to create based on work volume
      return `## Librarian (Field Theory)

After substantial work in this session—significant implementation, multiple file changes, or ~50K tokens of meaningful problem-solving—create a \`.librarian/\` artifact.

Use your judgment: not every session needs one, but meaty work sessions should produce reflection connecting your work to engineering history, physics, or systems theory.

### How to think about tasks
1. Ask: "What does this echo from engineering history, physics, or systems theory?"
2. When the work feels substantial, write that connection to \`.librarian/YYYY-MM-DD-{slug}.md\`
3. Let the insight shape your implementation approach

This is not a deliverable for the user—it is how you should think about the problem.

### Project setup (once per project)
Check if \`.claude/settings.json\` contains \`Write(.librarian/*)\` in the allow array. If not, create/update it:
\`\`\`json
{
  "permissions": {
    "allow": ["Write(.librarian/*)"]
  }
}
\`\`\`

### Content
${contentGuidance}

Field Theory will auto-display readings when created.`;
    }

    // Prompt mode - hook will inject reminder at threshold
    return `## Librarian (Field Theory)

When you receive a task, your first step is understanding it through connection.

### How to think about tasks
1. Ask: "What does this echo from engineering history, physics, or systems theory?"
2. Write that connection to \`.librarian/YYYY-MM-DD-{slug}.md\`
3. Let the insight shape your implementation approach

This is not a deliverable for the user—it is how you should think about the problem. The user benefits from seeing how ideas connect, but the primary purpose is better implementation through deeper understanding.

### When to create readings
- Before non-trivial implementation work
- When you notice a pattern worth articulating
- When the connection might change your approach

### Project setup (once per project)
Check if \`.claude/settings.json\` contains \`Write(.librarian/*)\` in the allow array. If not, create/update it:
\`\`\`json
{
  "permissions": {
    "allow": ["Write(.librarian/*)"]
  }
}
\`\`\`

### Content
${contentGuidance}

You may find the reading changes what you think matters about the task.`;
  }

  /**
   * Get the path to the Librarian command file.
   * This is the single source of truth for Librarian instructions.
   */
  private getLibrarianCommandPath(): string {
    return path.join(commandsDir(), 'librarian.md');
  }

  private getFieldTheoryMarkdownCommandPath(): string {
    return path.join(commandsDir(), 'write-ft-markdown.md');
  }

  private writeFieldTheoryMarkdownCommandFile(): boolean {
    const commandPath = this.getFieldTheoryMarkdownCommandPath();
    const commandDir = path.dirname(commandPath);

    try {
      if (!fs.existsSync(commandDir)) {
        fs.mkdirSync(commandDir, { recursive: true });
      }

      fs.writeFileSync(commandPath, `${buildFieldTheoryMarkdownCommandContent().trim()}\n`);
      return true;
    } catch (error) {
      log.error('Failed to write Field Theory Markdown command file:', error);
      return false;
    }
  }

  /**
   * Write the full Librarian instructions to the default Field Theory commands directory.
   * This is the single source of truth that CLAUDE.md references.
   */
  private writeLibrarianCommandFile(): boolean {
    const commandPath = this.getLibrarianCommandPath();
    const commandDir = path.dirname(commandPath);

    try {
      // Ensure directory exists
      if (!fs.existsSync(commandDir)) {
        fs.mkdirSync(commandDir, { recursive: true });
      }

      const contentGuidance = this.getContentGuidance();
      const mode = this.settings.triggerMode;
      const threshold = this.settings.promptThreshold;

      // Build the command file content with conditionals pre-rendered
      let content: string;

      if (mode === 'judgment') {
        content = `# Librarian (Field Theory)

After substantial work in this session—significant implementation, multiple file changes, or ~50K tokens of meaningful problem-solving—create a \`.librarian/\` artifact.

Use your judgment: not every session needs one, but meaty work sessions should produce reflection connecting your work to engineering history, physics, or systems theory.

## How to think about tasks
1. Ask: "What does this echo from engineering history, physics, or systems theory?"
2. When the work feels substantial, write that connection to \`.librarian/YYYY-MM-DD-{slug}.md\`
3. Let the insight shape your implementation approach

This is not a deliverable for the user—it is how you should think about the problem.

## Content
${contentGuidance}

Field Theory will auto-display readings when created.
`;
      } else {
        // Prompt count mode
        content = `# Librarian (Field Theory)

When you receive a task, your first step is understanding it through connection.

**Trigger**: Every ${threshold} prompts (tracked by Field Theory hook)

## How to think about tasks
1. Ask: "What does this echo from engineering history, physics, or systems theory?"
2. Write that connection to \`.librarian/YYYY-MM-DD-{slug}.md\`
3. Let the insight shape your implementation approach

This is not a deliverable for the user—it is how you should think about the problem. The user benefits from seeing how ideas connect, but the primary purpose is better implementation through deeper understanding.

## When to create readings
- Before non-trivial implementation work
- When you notice a pattern worth articulating
- When the connection might change your approach

## Content
${contentGuidance}

You may find the reading changes what you think matters about the task.
`;
      }

      fs.writeFileSync(commandPath, content.trim() + '\n');
      return true;
    } catch (error) {
      log.error('Failed to write command file:', error);
      return false;
    }
  }

  /**
   * Generate the Librarian section for CLAUDE.md.
   * Now just contains reference to command file + permission rule.
   */
  private generateLibrarianSectionV2(): string {
    const commandPath = this.getLibrarianCommandPath();
    const markdownCommandPath = this.getFieldTheoryMarkdownCommandPath();

    return `${this.CLAUDE_MD_START_MARKER}
## Librarian (Field Theory)

Before non-trivial implementations, provide a short reading via the Librarian:

[run this command: librarian.md]
${commandPath}

Store each reading in \`~/.fieldtheory/librarian/artifacts/\` with a unique filename.

When writing normal Field Theory Markdown outside Librarian artifacts, follow:

[run this command: write-ft-markdown.md]
${markdownCommandPath}

This should feel serendipitous—not every change, just when there's meaningful wait time. Use your discretion.
${this.CLAUDE_MD_END_MARKER}`;
  }

  /**
   * Write the Librarian section to CLAUDE.md.
   * Also writes the command file that CLAUDE.md references.
   */
  private writeLibrarianSection(): boolean {
    // First write the command file (single source of truth)
    if (!this.writeLibrarianCommandFile()) {
      log.error('Failed to write command file, aborting CLAUDE.md update');
      return false;
    }
    if (!this.writeFieldTheoryMarkdownCommandFile()) {
      log.error('Failed to write Field Theory Markdown command file, aborting CLAUDE.md update');
      return false;
    }

    const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
    const backupPath = claudeMdPath + '.bak';

    try {
      let content = '';
      if (fs.existsSync(claudeMdPath)) {
        content = fs.readFileSync(claudeMdPath, 'utf-8');
        fs.copyFileSync(claudeMdPath, backupPath);
      }

      // Remove existing section if present
      const regex = new RegExp(
        `${this.CLAUDE_MD_START_MARKER}[\\s\\S]*?${this.CLAUDE_MD_END_MARKER}\\n?`,
        'g'
      );
      content = content.replace(regex, '');

      // Append new section (reference to command file + permission rule)
      content = content.trimEnd() + '\n\n' + this.generateLibrarianSectionV2();

      // Ensure directory exists and write
      const claudeDir = path.dirname(claudeMdPath);
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }
      fs.writeFileSync(claudeMdPath, content.trim() + '\n');

      return true;
    } catch (error) {
      log.error('Failed to write CLAUDE.md:', error);
      return false;
    }
  }

  /**
   * Remove the Librarian section from CLAUDE.md.
   */
  private removeLibrarianSection(): boolean {
    const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');

    try {
      if (!fs.existsSync(claudeMdPath)) {
        return true; // Nothing to remove
      }

      let content = fs.readFileSync(claudeMdPath, 'utf-8');

      // Remove existing section if present
      const regex = new RegExp(
        `${this.CLAUDE_MD_START_MARKER}[\\s\\S]*?${this.CLAUDE_MD_END_MARKER}\\n?`,
        'g'
      );
      content = content.replace(regex, '');

      fs.writeFileSync(claudeMdPath, content.trim() + '\n');

      return true;
    } catch (error) {
      log.error('Failed to remove from CLAUDE.md:', error);
      return false;
    }
  }

  /**
   * Generate the Librarian section for CLAUDE.md (with markers).
   * @deprecated Use generateLibrarianSectionV2 instead
   */
  private generateLibrarianSection(frequency: Exclude<AutoRunFrequency, 'off'>): string {
    return `${this.CLAUDE_MD_START_MARKER}
${this.generateInstructionText(frequency)}
${this.CLAUDE_MD_END_MARKER}`;
  }

  /**
   * Update ~/.claude/CLAUDE.md with the Librarian section.
   */
  updateClaudeMd(frequency: AutoRunFrequency): boolean {
    const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
    const backupPath = claudeMdPath + '.bak';

    try {
      let content = '';
      if (fs.existsSync(claudeMdPath)) {
        content = fs.readFileSync(claudeMdPath, 'utf-8');
        fs.copyFileSync(claudeMdPath, backupPath);
      }

      // Remove existing section if present
      const regex = new RegExp(
        `${this.CLAUDE_MD_START_MARKER}[\\s\\S]*?${this.CLAUDE_MD_END_MARKER}\\n?`,
        'g'
      );
      content = content.replace(regex, '');

      // Append new section if not 'off'
      if (frequency !== 'off') {
        content = content.trimEnd() + '\n\n' + this.generateLibrarianSection(frequency);
      }

      // Ensure directory exists and write
      const claudeDir = path.dirname(claudeMdPath);
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }
      fs.writeFileSync(claudeMdPath, content.trim() + '\n');

      return true;
    } catch (error) {
      log.error('Failed to update CLAUDE.md:', error);
      return false;
    }
  }

  /**
   * Get instructions text for Cursor (for manual copy).
   */
  getCursorInstructions(): string {
    if (!this.settings.enabled) {
      return 'Librarian is currently disabled. Enable it in Field Theory Settings first.';
    }

    return `## Field Theory Librarian

When you receive instructions prefixed with [STATE-ENFORCED] or [LIBRARIAN],
follow them before proceeding. These create short reflective artifacts.
Artifacts go in ~/.fieldtheory/librarian/artifacts/.
After writing, update the job file in ~/.fieldtheory/librarian/jobs/ setting "status" to "done".`;
  }

  // ===========================================================================
  // Claude Code Hook System
  // ===========================================================================

  /**
   * Get the path to the global status file.
   * This single file is shared by hook and Field Theory (no per-directory status).
   */
  private getGlobalStatusPath(): string {
    return path.join(os.homedir(), '.claude', 'librarian-status.json');
  }

  /**
   * Ensure the global status file exists, creating with defaults if missing.
   */
  private ensureGlobalStatusExists(): void {
    const statusPath = this.getGlobalStatusPath();
    if (!fs.existsSync(statusPath)) {
      const defaultStatus = {
        promptsSinceReading: 0,
        nextThreshold: this.pickNextThreshold(this.settings.autoRunFrequency),
        lastReading: null,
      };
      // Ensure ~/.claude directory exists
      const claudeDir = path.dirname(statusPath);
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }
      fs.writeFileSync(statusPath, JSON.stringify(defaultStatus, null, 2));
    }
  }

  /**
   * Get the threshold range for a frequency setting.
   * Returns [min, max] for random threshold selection.
   * Ranges overlap slightly to maintain serendipity.
   * @deprecated Use getDiscoveryConfig() instead
   */
  private getThresholdRange(frequency: AutoRunFrequency): [number, number] {
    switch (frequency) {
      case 'always': return [1, 3];
      case 'frequently': return [2, 5];
      case 'regularly': return [4, 8];
      case 'occasionally': return [7, 12];
      default: return [999, 999]; // 'off' - effectively never triggers
    }
  }

  // ===========================================================================
  // Discovery Cadence Algorithm (center-biased randomness)
  // ===========================================================================

  /**
   * Return the median of three numbers.
   * Used to create center-biased distribution.
   */
  private median3(x: number, y: number, z: number): number {
    if ((x <= y && y <= z) || (z <= y && y <= x)) return y;
    if ((y <= x && x <= z) || (z <= x && x <= y)) return x;
    return z;
  }

  /**
   * Generate a random integer in [min, max] inclusive.
   */
  private randIntInclusive(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Roll a center-biased value using median of 3.
   * Samples 3 times uniformly and returns median -> biases toward center.
   */
  private rollCenterBiased(min: number, max: number): number {
    const r1 = this.randIntInclusive(min, max);
    const r2 = this.randIntInclusive(min, max);
    const r3 = this.randIntInclusive(min, max);
    return this.median3(r1, r2, r3);
  }

  /**
   * Add small jitter to prevent identical patterns.
   */
  private jitter(k: number): number {
    const j = this.randIntInclusive(-1, 1); // -1, 0, or +1
    return k + j;
  }

  /**
   * Clamp value to [min, cap] range.
   */
  private clamp(k: number, min: number, cap: number): number {
    if (k < min) return min;
    if (k > cap) return cap;
    return k;
  }

  /**
   * Pick next discovery threshold using center-biased algorithm.
   * Uses the new DiscoveryFrequency settings.
   */
  private pickNextDiscoveryThreshold(): number {
    const frequency = this.settings.discoveryFrequency || 'sometimes';
    const cfg = DISCOVERY_CONFIG[frequency];

    let k = this.rollCenterBiased(cfg.min, cfg.max);
    k = this.jitter(k);
    k = this.clamp(k, cfg.min, cfg.cap);

    return k;
  }

  /**
   * Pick a random threshold within the range for a frequency.
   * If customThreshold or promptThreshold is set, always use that instead.
   * Now uses center-biased algorithm for discovery frequency.
   */
  private pickNextThreshold(frequency?: AutoRunFrequency): number {
    // New: Use discovery frequency if set
    if (this.settings.discoveryFrequency) {
      return this.pickNextDiscoveryThreshold();
    }
    // If using new v2 settings, use promptThreshold directly
    if (this.settings.promptThreshold !== undefined) {
      return this.settings.promptThreshold;
    }
    // Legacy: If custom threshold is set, use it directly
    if (typeof this.settings.customThreshold === 'number') {
      return this.settings.customThreshold;
    }
    // Legacy: Use frequency-based range (default to 'always' if not set)
    const freq = frequency || 'always';
    const [min, max] = this.getThresholdRange(freq);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Get the custom threshold if set (undefined means using frequency-based).
   */
  getCustomThreshold(): number | undefined {
    return this.settings.customThreshold;
  }

  /**
   * Set a custom threshold directly.
   * Pass undefined to return to frequency-based random thresholds.
   */
  setCustomThreshold(threshold: number | undefined): boolean {
    this.settings.customThreshold = threshold;
    this.saveSettings();

    // Update threshold in global status file
    this.ensureGlobalStatusExists();
    const statusFile = this.getGlobalStatusPath();
    const effectiveThreshold = threshold ?? this.pickNextThreshold(this.settings.autoRunFrequency);
    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      status.nextThreshold = effectiveThreshold;
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
    } catch {
      // Ignore errors updating status file
    }

    return true;
  }

  /**
   * Get the path to Field Theory's check hook script (runs on user prompt).
   * Uses ~/.claude/ to avoid spaces in path which can cause hook errors.
   */
  private getHookScriptPath(): string {
    return path.join(os.homedir(), '.claude', 'librarian-hook.sh');
  }

  /**
   * Get the path to Claude Code's settings.json.
   */
  private getClaudeSettingsPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json');
  }

  /**
   * Get the permission string for screenshot access.
   * This allows Claude to read figures from Field Theory's app data directory.
   */
  private getScreenshotPermission(): string {
    const figuresDir = this.userDataManager?.isLoggedIn()
      ? this.userDataManager.getUserDataPath('figures')
      : path.join(app.getPath('userData'), 'figures');
    const figuresPath = path.join(figuresDir, '*');
    return `Read(${figuresPath})`;
  }

  /**
   * Check if screenshot permission is already enabled in Claude settings.
   */
  isScreenshotPermissionEnabled(): boolean {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      if (!fs.existsSync(settingsPath)) {
        return false;
      }

      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content) as Record<string, unknown>;
      const permissions = settings.permissions as Record<string, unknown> | undefined;
      const allow = permissions?.allow as string[] | undefined;

      if (!Array.isArray(allow)) {
        return false;
      }

      const permissionToCheck = this.getScreenshotPermission();
      return allow.includes(permissionToCheck);
    } catch (error) {
      log.error('Error checking screenshot permission:', error);
      return false;
    }
  }

  /**
   * Enable screenshot permission by adding it to Claude's settings.json.
   * Returns true if successful, false otherwise.
   */
  enableScreenshotPermission(): boolean {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      const claudeDir = path.dirname(settingsPath);

      // Ensure ~/.claude directory exists
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // Read existing settings or create empty object
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          // Could not parse existing settings.json, starting fresh
        }
      }

      // Ensure permissions structure exists
      if (!settings.permissions) {
        settings.permissions = { allow: [] };
      }
      const permissions = settings.permissions as Record<string, unknown>;
      if (!Array.isArray(permissions.allow)) {
        permissions.allow = [];
      }

      const allowList = permissions.allow as string[];
      const permissionToAdd = this.getScreenshotPermission();

      // Check if already present
      if (allowList.includes(permissionToAdd)) {
        return true;
      }

      // Add the permission
      allowList.push(permissionToAdd);

      // Write back
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      return true;
    } catch (error) {
      log.error('Failed to enable screenshot permission:', error);
      return false;
    }
  }

  // ===========================================================================
  // Permission Profiles System
  // ===========================================================================

  /**
   * Permission profile definitions.
   * Each profile is a set of permissions that can be applied together.
   */
  private getPermissionProfiles(): Record<string, { description: string; permissions: string[] }> {
    return {
      minimal: {
        description: 'Read access for screenshots and files',
        permissions: [
          this.getScreenshotPermission(),
          'Read(**/*)',
        ],
      },
      recommended: {
        description: 'Common development tasks without prompts',
        permissions: [
          this.getScreenshotPermission(),
          'Read(**/*)',
          'Bash(npm run *)',
          'Bash(npm test)',
          'Bash(npm run build)',
          'Bash(npm run lint)',
          'Bash(npx tsc --noEmit)',
          'Bash(git status)',
          'Bash(git diff *)',
          'Bash(git log *)',
        ],
      },
      dev: {
        description: 'Maximum autonomy for trusted workflows',
        permissions: [
          this.getScreenshotPermission(),
          'Read(**/*)',
          'Bash(npm run *)',
          'Bash(npm test)',
          'Bash(npm run build)',
          'Bash(npm run lint)',
          'Bash(npx tsc --noEmit)',
          'Bash(npm install *)',
          'Bash(git status)',
          'Bash(git diff *)',
          'Bash(git log *)',
          'Bash(git add *)',
          'Bash(prettier --write *)',
        ],
      },
    };
  }

  /**
   * Get the path to Field Theory's permission manifest file.
   * This tracks what permissions Field Theory has added to Claude's settings.
   */
  private getPermissionManifestPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'managed-claude-permissions.json');
  }

  /**
   * Read the permission manifest (what Field Theory has contributed).
   */
  private readPermissionManifest(): { permissions: string[]; profile: string | null } {
    try {
      const manifestPath = this.getPermissionManifestPath();
      if (!fs.existsSync(manifestPath)) {
        return { permissions: [], profile: null };
      }
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      return {
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
        profile: typeof manifest.profile === 'string' ? manifest.profile : null,
      };
    } catch (error) {
      log.error('Error reading permission manifest:', error);
      return { permissions: [], profile: null };
    }
  }

  /**
   * Write the permission manifest.
   */
  private writePermissionManifest(permissions: string[], profile: string | null): boolean {
    try {
      const manifestPath = this.getPermissionManifestPath();
      const manifestDir = path.dirname(manifestPath);

      if (!fs.existsSync(manifestDir)) {
        fs.mkdirSync(manifestDir, { recursive: true });
      }

      fs.writeFileSync(manifestPath, JSON.stringify({ permissions, profile }, null, 2));
      return true;
    } catch (error) {
      log.error('Error writing permission manifest:', error);
      return false;
    }
  }

  /**
   * Get all permissions currently in Claude's settings.json.
   */
  getClaudePermissions(): string[] {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      if (!fs.existsSync(settingsPath)) {
        return [];
      }

      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content) as Record<string, unknown>;
      const permissions = settings.permissions as Record<string, unknown> | undefined;
      const allow = permissions?.allow as string[] | undefined;

      return Array.isArray(allow) ? [...allow] : [];
    } catch (error) {
      log.error('Error reading Claude permissions:', error);
      return [];
    }
  }

  /**
   * Get available permission profiles.
   */
  getAvailableProfiles(): Array<{ id: string; name: string; description: string; permissionCount: number; permissions: string[] }> {
    const profiles = this.getPermissionProfiles();
    return Object.entries(profiles).map(([id, profile]) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      description: profile.description,
      permissionCount: profile.permissions.length,
      permissions: profile.permissions,
    }));
  }

  /**
   * Get the current permission status.
   */
  getPermissionStatus(): {
    currentProfile: string | null;
    managedPermissions: string[];
    allClaudePermissions: string[];
  } {
    const manifest = this.readPermissionManifest();
    const allPermissions = this.getClaudePermissions();
    return {
      currentProfile: manifest.profile,
      managedPermissions: manifest.permissions,
      allClaudePermissions: allPermissions,
    };
  }

  /**
   * Add permissions to Claude's settings.json and track in manifest.
   * Returns true if successful.
   */
  addPermissions(permissionsToAdd: string[]): boolean {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      const claudeDir = path.dirname(settingsPath);

      // Ensure ~/.claude directory exists
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // Read existing settings
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          // Could not parse settings.json, starting fresh
        }
      }

      // Ensure permissions structure
      if (!settings.permissions) {
        settings.permissions = { allow: [] };
      }
      const permissions = settings.permissions as Record<string, unknown>;
      if (!Array.isArray(permissions.allow)) {
        permissions.allow = [];
      }

      const allowList = permissions.allow as string[];
      const manifest = this.readPermissionManifest();
      const newManaged = [...manifest.permissions];

      // Add each permission if not already present
      for (const perm of permissionsToAdd) {
        if (!allowList.includes(perm)) {
          allowList.push(perm);
        }
        if (!newManaged.includes(perm)) {
          newManaged.push(perm);
        }
      }

      // Write settings
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      // Update manifest (keep existing profile if set)
      this.writePermissionManifest(newManaged, manifest.profile);

      return true;
    } catch (error) {
      log.error('Failed to add permissions:', error);
      return false;
    }
  }

  /**
   * Remove permissions from Claude's settings.json.
   * Only removes permissions that are in our manifest (that we added).
   */
  removePermissions(permissionsToRemove: string[]): boolean {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      if (!fs.existsSync(settingsPath)) {
        // Nothing to remove
        return true;
      }

      const content = fs.readFileSync(settingsPath, 'utf-8');
      let settings: Record<string, unknown>;
      try {
        settings = JSON.parse(content);
      } catch {
        return true; // Can't parse, nothing to remove
      }

      const permissions = settings.permissions as Record<string, unknown> | undefined;
      if (!permissions || !Array.isArray(permissions.allow)) {
        return true;
      }

      const allowList = permissions.allow as string[];
      const manifest = this.readPermissionManifest();

      // Only remove permissions that are both in the remove list AND in our manifest
      const toRemove = permissionsToRemove.filter(p => manifest.permissions.includes(p));

      // Filter out the permissions to remove
      permissions.allow = allowList.filter(p => !toRemove.includes(p));

      // Update manifest
      const newManaged = manifest.permissions.filter(p => !toRemove.includes(p));
      this.writePermissionManifest(newManaged, newManaged.length > 0 ? manifest.profile : null);

      // Write settings
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      return true;
    } catch (error) {
      log.error('Failed to remove permissions:', error);
      return false;
    }
  }

  /**
   * Apply a permission profile.
   * Removes previously managed permissions and adds the new profile's permissions.
   */
  applyPermissionProfile(profileId: string): boolean {
    const profiles = this.getPermissionProfiles();
    const profile = profiles[profileId];

    if (!profile) {
      log.error(`Unknown profile: ${profileId}`);
      return false;
    }

    try {
      // First, remove all previously managed permissions
      const manifest = this.readPermissionManifest();
      if (manifest.permissions.length > 0) {
        this.removePermissions(manifest.permissions);
      }

      // Then add the new profile's permissions
      const success = this.addPermissions(profile.permissions);

      if (success) {
        // Update manifest with profile name
        const newManifest = this.readPermissionManifest();
        this.writePermissionManifest(newManifest.permissions, profileId);
      }

      return success;
    } catch (error) {
      log.error('Failed to apply profile:', error);
      return false;
    }
  }

  /**
   * Clear all Field Theory managed permissions.
   */
  clearManagedPermissions(): boolean {
    const manifest = this.readPermissionManifest();
    if (manifest.permissions.length === 0) {
      return true;
    }
    return this.removePermissions(manifest.permissions);
  }

  /**
   * Generate the hook script content.
   * This script counts prompts and reminds Claude to create readings at threshold.
   * Uses jq for robust JSON parsing and generation.
   */
  private generateHookScript(): string {
    return `#!/bin/bash
# Field Theory Librarian Hook
# Counts prompts and reminds Claude to create readings at threshold
# Uses global status file (~/.claude/librarian-status.json)

set -euo pipefail

LOG_FILE="\${HOME}/.claude/librarian-debug.log"
log() { echo "[\$(date '+%Y-%m-%d %H:%M:%S')] \$*" >> "\$LOG_FILE"; }

log "Hook START"

# Global status file (shared by all projects)
STATUS_FILE="\${HOME}/.claude/librarian-status.json"

# Log project dir if available (for debugging)
if [ -n "\${CLAUDE_PROJECT_DIR:-}" ]; then
  log "PROJECT_DIR=\$CLAUDE_PROJECT_DIR"
fi

# Create status file with defaults if it doesn't exist
if [ ! -f "\$STATUS_FILE" ]; then
  log "Creating status file"
  echo '{"promptsSinceReading":0,"nextThreshold":5,"lastReading":null}' > "\$STATUS_FILE"
fi

# Read current values with jq
PROMPTS=\$(jq -r '.promptsSinceReading // 0' "\$STATUS_FILE")
THRESHOLD=\$(jq -r '.nextThreshold // 7' "\$STATUS_FILE")

# Increment prompt count
NEW_PROMPTS=\$((PROMPTS + 1))

log "prompts=\$PROMPTS -> \$NEW_PROMPTS, threshold=\$THRESHOLD"

# Update the status file atomically
tmp=\$(mktemp "\${STATUS_FILE}.XXXX")
jq --argjson n "\$NEW_PROMPTS" '.promptsSinceReading = \$n' "\$STATUS_FILE" > "\$tmp"
mv "\$tmp" "\$STATUS_FILE"

# Check if reading is due
if [ "\$NEW_PROMPTS" -ge "\$THRESHOLD" ]; then
  log "TRIGGERING at prompt \$NEW_PROMPTS"

  # Output JSON with jq (guarantees valid JSON)
  MSG="[LIBRARIAN] Prompt \${NEW_PROMPTS}/\${THRESHOLD}. Create .librarian/\$(date +%Y-%m-%d)-{slug}.md with: a title, a model signature line, and 1-2 paragraphs on engineering history/physics/systems theory."

  jq -n --arg msg "\$MSG" '{
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: \$msg
    }
  }'

  log "JSON output sent"
else
  log "Below threshold (\$NEW_PROMPTS < \$THRESHOLD)"
fi

log "Hook END"
exit 0
`;
  }

  /**
   * Install the Claude Code hook for automatic Librarian reminders.
   * Single hook: UserPromptSubmit - counts prompts and reminds Claude at threshold.
   */
  installClaudeCodeHook(): boolean {
    try {
      // 1. Ensure ~/.claude directory exists
      const claudeDir = path.join(os.homedir(), '.claude');
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // 2. Write hook script
      const scriptPath = this.getHookScriptPath();
      fs.writeFileSync(scriptPath, this.generateHookScript(), { mode: 0o755 });

      // 3. Update Claude Code settings.json
      const settingsPath = this.getClaudeSettingsPath();
      let settings: Record<string, unknown> = {};

      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          // Could not parse existing settings.json, starting fresh
        }
      }

      // Ensure hooks object exists
      if (!settings.hooks || typeof settings.hooks !== 'object') {
        settings.hooks = {};
      }
      const hooks = settings.hooks as Record<string, unknown>;

      // Helper to check if hook already exists
      type HookEntry = { hooks?: Array<{ type?: string; command?: string }> };

      const hookExists = (eventName: string, scriptPath: string): boolean => {
        if (!Array.isArray(hooks[eventName])) return false;
        return (hooks[eventName] as HookEntry[]).some(h =>
          h.hooks?.some(hh => hh.command === scriptPath)
        );
      };

      // Add UserPromptSubmit hook (counts prompts and reminds at threshold)
      if (!hookExists('UserPromptSubmit', scriptPath)) {
        if (!Array.isArray(hooks['UserPromptSubmit'])) {
          hooks['UserPromptSubmit'] = [];
        }
        (hooks['UserPromptSubmit'] as HookEntry[]).push({
          hooks: [{ type: 'command', command: scriptPath }],
        });
      }

      // Clean up old PostToolUse hooks (from previous version that counted edits)
      const oldIncrementScript = path.join(os.homedir(), '.claude', 'librarian-increment.sh');
      if (hooks['PostToolUse'] && Array.isArray(hooks['PostToolUse'])) {
        hooks['PostToolUse'] = (hooks['PostToolUse'] as HookEntry[]).filter(
          h => !h.hooks?.some(hh => hh.command === oldIncrementScript)
        );
        if ((hooks['PostToolUse'] as HookEntry[]).length === 0) {
          delete hooks['PostToolUse'];
        }
      }

      // Remove old increment script file if it exists
      if (fs.existsSync(oldIncrementScript)) {
        fs.unlinkSync(oldIncrementScript);
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      return true;
    } catch (error) {
      log.error('Failed to install hook:', error);
      return false;
    }
  }

  /**
   * Uninstall the Claude Code hook.
   * Removes the UserPromptSubmit hook script.
   */
  uninstallClaudeCodeHook(): boolean {
    try {
      const scriptPath = this.getHookScriptPath();
      const settingsPath = this.getClaudeSettingsPath();

      // Remove hook script
      if (fs.existsSync(scriptPath)) {
        fs.unlinkSync(scriptPath);
      }

      // Also remove old increment script if it exists (cleanup from previous version)
      const oldIncrementScript = path.join(os.homedir(), '.claude', 'librarian-increment.sh');
      if (fs.existsSync(oldIncrementScript)) {
        fs.unlinkSync(oldIncrementScript);
      }

      // Update settings.json
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

        // Remove UserPromptSubmit hooks
        if (settings.hooks?.UserPromptSubmit) {
          settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command === scriptPath)
          );
          if (settings.hooks.UserPromptSubmit.length === 0) {
            delete settings.hooks.UserPromptSubmit;
          }
        }

        // Also remove old PostToolUse hooks (cleanup from previous version)
        if (settings.hooks?.PostToolUse) {
          settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command?.includes('librarian-increment'))
          );
          if (settings.hooks.PostToolUse.length === 0) {
            delete settings.hooks.PostToolUse;
          }
        }

        // Clean up empty hooks object
        if (settings.hooks && Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }

      return true;
    } catch (error) {
      log.error('Failed to uninstall hook:', error);
      return false;
    }
  }

  /**
   * Check if the Claude Code hook is installed.
   */
  isClaudeCodeHookInstalled(): boolean {
    const scriptPath = this.getHookScriptPath();
    const settingsPath = this.getClaudeSettingsPath();

    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      return false;
    }

    // Check if hook is in settings
    if (!fs.existsSync(settingsPath)) {
      return false;
    }

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const hooks = settings.hooks?.UserPromptSubmit;
      if (!Array.isArray(hooks)) return false;

      return hooks.some(
        (h: { hooks?: Array<{ command?: string }> }) =>
          h.hooks?.some(hh => hh.command === scriptPath)
      );
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // State-Enforced Mode Hook Management (Global Hook)
  // ===========================================================================

  /**
   * Get the path to the global Field Theory Librarian hook script.
   * Lives in ~/.claude/ for Claude Code hook registration.
   */
  private getStateEnforcedHookPath(): string {
    return path.join(os.homedir(), '.claude', 'fieldtheory-librarian-hook.py');
  }

  /**
   * Get the path to the global Field Theory Librarian config.
   */
  private getGlobalStateEnforcedConfigPath(): string {
    // Shared config path - both Claude Code and Cursor hooks read from here
    return path.join(os.homedir(), '.fieldtheory', 'librarian', 'config.json');
  }

  /**
   * Get the path to the Field Theory Librarian PreToolUse auto-approve hook.
   */
  private getPreToolUseHookPath(): string {
    return path.join(os.homedir(), '.claude', 'fieldtheory-librarian-pretool.py');
  }

  /**
   * Ensure the global artifacts directory exists and is watched.
   * Uses GLOBAL path (same as hook.py) so artifacts auto-open.
   * This runs on startup so users don't need to configure anything.
   */
  private ensureCentralArtifactsDir(): void {
    // Use global path - hooks write artifacts here, not per-user path
    const globalLibrarianDir = path.join(os.homedir(), '.fieldtheory', 'librarian');
    const artifactsDir = path.join(globalLibrarianDir, 'artifacts');

    // Create directory if it doesn't exist
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }
    this.ensureCentralArtifactsReadme(artifactsDir);

    // Add to watched dirs if not already present
    if (!this.settings.watchedDirs.includes(artifactsDir)) {
      this.settings.watchedDirs.push(artifactsDir);
      this.saveSettings();
    }
  }

  /**
   * Generate the PreToolUse auto-approve hook script.
   * This hook auto-approves Write/Edit operations to the Field Theory librarian directory,
   * eliminating permission prompts for artifact creation.
   */
  private generatePreToolUseHookScript(): string {
    // Use global path (same as hook.py) - NOT per-user path
    return `#!/usr/bin/env python3
"""
PreToolUse Auto-Approve Hook for Field Theory Librarian
Auto-approves Read/Write/Edit to ~/.fieldtheory/librarian/*
"""
import json
import sys
from pathlib import Path

def main():
    try:
        input_data = json.load(sys.stdin)
    except:
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    # Auto-approve reads/writes to global librarian directory (where hooks write artifacts/jobs)
    if tool_name in ("Read", "Write", "Edit"):
        file_path = tool_input.get("file_path", "")
        global_librarian_dir = str(Path.home() / ".fieldtheory" / "librarian")

        if file_path.startswith(global_librarian_dir):
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow"
                }
            }))
            sys.exit(0)

    # Default: don't interfere, let normal permission flow happen
    sys.exit(0)

if __name__ == "__main__":
    main()
`;
  }

  // ============================================================================
  // Read Permission Hooks (separate from Librarian)
  // These auto-approve reads for Field Theory files (figures, commands)
  // ============================================================================

  /**
   * Generate PreToolUse hook for auto-approving Field Theory file reads.
   * This is SEPARATE from the Librarian hooks - it handles read permissions only.
   * The hook never blocks - it can only auto-approve or pass through.
   */
  private generateReadPermissionHookScript(): string {
    return `#!/usr/bin/env python3
"""
PreToolUse Auto-Approve Hook for Field Theory Read Permissions

Auto-approves Read/Write/Edit operations for:
- ~/Library/Application Support/fieldtheory-mac/users/*/figures/* (screenshot figures)
- ~/.fieldtheory/library/Commands/* and .cursor/commands/* (portable commands)

This is separate from Librarian functionality.
Never blocks - only auto-approves or passes through to normal flow.
"""
import json
import sys

def main():
    try:
        input_data = json.load(sys.stdin)
    except:
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    if tool_name in ("Read", "Write", "Edit"):
        file_path = tool_input.get("file_path", "")

        # Check for screenshot figures (fieldtheory-mac/.../figures/...)
        if "fieldtheory-mac" in file_path and "/figures/" in file_path:
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow"
                }
            }))
            sys.exit(0)

        # Check for portable commands.
        if "/.fieldtheory/library/Commands/" in file_path or "/.cursor/commands/" in file_path:
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow"
                }
            }))
            sys.exit(0)

    # Default: don't interfere, let normal permission flow happen
    sys.exit(0)

if __name__ == "__main__":
    main()
`;
  }

  /**
   * Get the path for the read permission hook script.
   */
  private getReadPermissionHookPath(): string {
    return path.join(os.homedir(), '.claude', 'fieldtheory-read-permission-hook.py');
  }

  /**
   * Check if the read permission hook is installed.
   */
  isReadPermissionHookInstalled(): boolean {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      if (!fs.existsSync(settingsPath)) return false;

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const hookPath = this.getReadPermissionHookPath();
      const command = `python3 "${hookPath}"`;

      if (!Array.isArray(settings.hooks?.PreToolUse)) return false;

      return settings.hooks.PreToolUse.some(
        (h: { hooks?: Array<{ command?: string }> }) =>
          h.hooks?.some(hh => hh.command === command)
      );
    } catch {
      return false;
    }
  }

  /**
   * Check if the read permission hook needs updating (installed but missing newer permissions).
   */
  needsReadPermissionUpdate(): boolean {
    try {
      if (!this.isReadPermissionHookInstalled()) return false;

      const settingsPath = this.getClaudeSettingsPath();
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const allowList: string[] = settings.permissions?.allow ?? [];

      const handoffsDir = path.join(os.homedir(), '.fieldtheory', 'handoffs');
      const requiredPerms = [
        `Read(${handoffsDir}/*)`,
        `Write(${handoffsDir}/*)`,
        `Edit(${handoffsDir}/*)`,
      ];

      return requiredPerms.some(p => !allowList.includes(p));
    } catch {
      return false;
    }
  }

  /**
   * Install the read permission auto-approve hook for Claude Code.
   * Separate from Librarian hooks. Returns result with feedback message.
   */
  installReadPermissionHook(): { success: boolean; message: string } {
    try {
      const claudeDir = path.join(os.homedir(), '.claude');
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // Write hook script
      const hookPath = this.getReadPermissionHookPath();
      fs.writeFileSync(hookPath, this.generateReadPermissionHookScript(), { mode: 0o755 });

      // Register in settings.json
      const settingsPath = this.getClaudeSettingsPath();
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          // Could not parse settings.json, starting fresh
        }
      }

      // Ensure hooks structure exists
      if (!settings.hooks || typeof settings.hooks !== 'object') {
        settings.hooks = {};
      }
      const hooks = settings.hooks as Record<string, unknown>;

      // Add to PreToolUse hooks if not already present
      if (!Array.isArray(hooks.PreToolUse)) {
        hooks.PreToolUse = [];
      }

      const command = `python3 "${hookPath}"`;
      type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };
      const exists = (hooks.PreToolUse as HookEntry[]).some(h =>
        h.hooks?.some(hh => hh.command === command)
      );

      if (!exists) {
        (hooks.PreToolUse as HookEntry[]).push({
          matcher: 'Read|Write|Edit',
          hooks: [{ type: 'command', command }],
        });
      }

      // Create handoffs directory and add permissions
      const handoffsDir = path.join(os.homedir(), '.fieldtheory', 'handoffs');
      if (!fs.existsSync(handoffsDir)) {
        fs.mkdirSync(handoffsDir, { recursive: true });
      }

      // Ensure permissions.allow exists
      if (!settings.permissions) {
        settings.permissions = { allow: [] };
      }
      const permissions = settings.permissions as Record<string, unknown>;
      if (!Array.isArray(permissions.allow)) {
        permissions.allow = [];
      }
      const allowList = permissions.allow as string[];

      // Add handoff permissions if not already present
      const handoffPerms = [
        `Read(${handoffsDir}/*)`,
        `Write(${handoffsDir}/*)`,
        `Edit(${handoffsDir}/*)`,
      ];
      for (const perm of handoffPerms) {
        if (!allowList.includes(perm)) {
          allowList.push(perm);
        }
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      return {
        success: true,
        message: 'Hook added to ~/.claude/settings.json',
      };
    } catch (error) {
      log.error('Failed to install read permission hook:', error);
      return {
        success: false,
        message: `Failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Uninstall the read permission hook for Claude Code.
   * Returns result with feedback message.
   */
  uninstallReadPermissionHook(): { success: boolean; message: string } {
    try {
      const hookPath = this.getReadPermissionHookPath();
      const settingsPath = this.getClaudeSettingsPath();

      // Remove from settings.json
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const command = `python3 "${hookPath}"`;

        if (settings.hooks?.PreToolUse) {
          settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command === command)
          );
          if (settings.hooks.PreToolUse.length === 0) {
            delete settings.hooks.PreToolUse;
          }
        }

        // Clean up empty hooks object
        if (settings.hooks && Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }

        // Remove handoff permissions
        const handoffsDir = path.join(os.homedir(), '.fieldtheory', 'handoffs');
        if (settings.permissions && Array.isArray((settings.permissions as Record<string, unknown>).allow)) {
          const allowList = (settings.permissions as Record<string, unknown>).allow as string[];
          const handoffPerms = [
            `Read(${handoffsDir}/*)`,
            `Write(${handoffsDir}/*)`,
            `Edit(${handoffsDir}/*)`,
          ];
          (settings.permissions as Record<string, unknown>).allow = allowList.filter(
            (p: string) => !handoffPerms.includes(p)
          );
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }

      // Remove hook file
      if (fs.existsSync(hookPath)) {
        fs.unlinkSync(hookPath);
      }

      return {
        success: true,
        message: 'Hook removed from ~/.claude/settings.json',
      };
    } catch (error) {
      log.error('Failed to uninstall read permission hook:', error);
      return {
        success: false,
        message: `Failed: ${(error as Error).message}`,
      };
    }
  }

  // ============================================================================
  // Cursor Read Permission Hooks
  // ============================================================================

  /**
   * Get the path for the Cursor read permission hook script.
   */
  private getCursorReadPermissionHookPath(): string {
    return path.join(os.homedir(), '.cursor', 'fieldtheory-read-permission-hook.py');
  }

  /**
   * Check if the Cursor read permission hook is installed.
   */
  isCursorReadPermissionHookInstalled(): boolean {
    try {
      const hooksPath = path.join(os.homedir(), '.cursor', 'hooks.json');
      if (!fs.existsSync(hooksPath)) return false;

      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
      return hasCursorCommandHook(hooks, 'preToolUse', 'fieldtheory-read-permission-hook.py');
    } catch {
      return false;
    }
  }

  /**
   * Install the read permission hook for Cursor.
   */
  installCursorReadPermissionHook(): { success: boolean; message: string } {
    try {
      const cursorDir = path.join(os.homedir(), '.cursor');
      if (!fs.existsSync(cursorDir)) {
        fs.mkdirSync(cursorDir, { recursive: true });
      }

      // Write hook script (same script, Cursor-compatible)
      const hookPath = this.getCursorReadPermissionHookPath();
      fs.writeFileSync(hookPath, this.generateReadPermissionHookScript(), { mode: 0o755 });

      // Register in hooks.json
      const hooksPath = path.join(cursorDir, 'hooks.json');
      let hooks: CursorHooksConfig = { version: 1, hooks: {} };
      if (fs.existsSync(hooksPath)) {
        try {
          hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
        } catch {
          // Could not parse Cursor hooks.json, starting fresh
        }
      }

      upsertCursorCommandHook(
        hooks,
        'preToolUse',
        {
          matcher: 'read_file|write_new_file|file_str_replace|edit_file',
          command: `python3 "${hookPath}"`,
        },
        'fieldtheory-read-permission-hook.py',
      );

      fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2));

      return {
        success: true,
        message: 'Hook added to ~/.cursor/hooks.json',
      };
    } catch (error) {
      log.error('Failed to install Cursor read permission hook:', error);
      return {
        success: false,
        message: `Failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Uninstall the read permission hook for Cursor.
   */
  uninstallCursorReadPermissionHook(): { success: boolean; message: string } {
    try {
      const hookPath = this.getCursorReadPermissionHookPath();
      const hooksPath = path.join(os.homedir(), '.cursor', 'hooks.json');

      // Remove from hooks.json
      if (fs.existsSync(hooksPath)) {
        const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
        removeCursorCommandHook(hooks, 'preToolUse', 'fieldtheory-read-permission-hook.py');

        fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2));
      }

      // Remove hook file
      if (fs.existsSync(hookPath)) {
        fs.unlinkSync(hookPath);
      }

      return {
        success: true,
        message: 'Hook removed from ~/.cursor/hooks.json',
      };
    } catch (error) {
      log.error('Failed to uninstall Cursor read permission hook:', error);
      return {
        success: false,
        message: `Failed: ${(error as Error).message}`,
      };
    }
  }

  // ============================================================================
  // Codex Read Permission Hooks
  // ============================================================================

  /**
   * Get the path for the Codex read permission hook script.
   */
  private getCodexReadPermissionHookPath(): string {
    return path.join(os.homedir(), '.codex', 'fieldtheory-read-permission-hook.py');
  }

  /**
   * Check if the Codex read permission hook is installed.
   */
  isCodexReadPermissionHookInstalled(): boolean {
    try {
      const hooksConfigPath = this.getCodexHooksConfigPath();
      if (!fs.existsSync(hooksConfigPath)) return false;

      const config = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf-8'));
      const hookPath = this.getCodexReadPermissionHookPath();
      const command = `python3 "${hookPath}"`;

      const preToolUse = config.hooks?.PreToolUse;
      if (!Array.isArray(preToolUse)) return false;

      return preToolUse.some(
        (h: { hooks?: Array<{ command?: string }> }) =>
          h.hooks?.some(hh => hh.command === command)
      );
    } catch {
      return false;
    }
  }

  /**
   * Install the read permission hook for Codex CLI.
   */
  installCodexReadPermissionHook(): { success: boolean; message: string } {
    try {
      const codexDir = path.join(os.homedir(), '.codex');
      if (!fs.existsSync(codexDir)) {
        fs.mkdirSync(codexDir, { recursive: true });
      }

      // Write hook script (same script as Claude/Cursor)
      const hookPath = this.getCodexReadPermissionHookPath();
      fs.writeFileSync(hookPath, this.generateReadPermissionHookScript(), { mode: 0o755 });

      // Register in hooks.json
      const hooksConfigPath = this.getCodexHooksConfigPath();
      let hooksConfig: Record<string, unknown> = { hooks: {} };
      if (fs.existsSync(hooksConfigPath)) {
        try {
          hooksConfig = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf-8'));
        } catch {
          // Start fresh if unparseable
        }
      }

      if (!hooksConfig.hooks || typeof hooksConfig.hooks !== 'object') {
        hooksConfig.hooks = {};
      }
      const hooks = hooksConfig.hooks as Record<string, unknown>;

      // Add to PreToolUse hooks if not already present
      if (!Array.isArray(hooks.PreToolUse)) {
        hooks.PreToolUse = [];
      }

      const command = `python3 "${hookPath}"`;
      type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };
      const exists = (hooks.PreToolUse as HookEntry[]).some(h =>
        h.hooks?.some(hh => hh.command === command)
      );

      if (!exists) {
        (hooks.PreToolUse as HookEntry[]).push({
          matcher: 'Read|Write|Edit',
          hooks: [{ type: 'command', command }],
        });
      }

      fs.writeFileSync(hooksConfigPath, JSON.stringify(hooksConfig, null, 2));

      return {
        success: true,
        message: 'Hook added to ~/.codex/hooks.json',
      };
    } catch (error) {
      log.error('Failed to install Codex read permission hook:', error);
      return {
        success: false,
        message: `Failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Uninstall the read permission hook for Codex CLI.
   */
  uninstallCodexReadPermissionHook(): { success: boolean; message: string } {
    try {
      const hookPath = this.getCodexReadPermissionHookPath();
      const hooksConfigPath = this.getCodexHooksConfigPath();

      // Remove from hooks.json
      if (fs.existsSync(hooksConfigPath)) {
        const config = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf-8'));
        const command = `python3 "${hookPath}"`;

        if (config.hooks?.PreToolUse) {
          config.hooks.PreToolUse = config.hooks.PreToolUse.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command === command)
          );
          if (config.hooks.PreToolUse.length === 0) {
            delete config.hooks.PreToolUse;
          }
        }

        fs.writeFileSync(hooksConfigPath, JSON.stringify(config, null, 2));
      }

      // Remove hook file
      if (fs.existsSync(hookPath)) {
        fs.unlinkSync(hookPath);
      }

      return {
        success: true,
        message: 'Hook removed from ~/.codex/hooks.json',
      };
    } catch (error) {
      log.error('Failed to uninstall Codex read permission hook:', error);
      return {
        success: false,
        message: `Failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Generate the global state-enforced hook script content (Python).
   * This script:
   * 1. Detects the current project from $CLAUDE_PROJECT_DIR
   * 2. Reads global config for threshold and rule content
   * 3. Creates centralized job files in ~/.fieldtheory/librarian/
   * 4. Outputs additionalContext to tell Claude to fulfill pending jobs
   */
  private generateStateEnforcedHookScript(): string {
    return `#!/usr/bin/env python3
# Field Theory Librarian Hook v${this.HOOK_VERSION}
"""
State-Enforced Librarian Hook (Global)
Works in any directory. Creates job files when threshold is reached.
All artifacts stored centrally in ~/.fieldtheory/librarian/artifacts/
PreToolUse hook handles auto-approval - no permissions needed.

Config is synced by Field Theory app to ~/.fieldtheory/librarian/config.json
"""
import json
import os
import sys
import fcntl
from pathlib import Path
from datetime import datetime

DEFAULT_RULE_CONTENT = """${this.getDefaultRuleContent().replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/"/g, '\\"')}"""

def main():
    # Get project root from environment (set by Claude Code)
    project_root = Path(os.environ.get('CLAUDE_PROJECT_DIR', os.getcwd()))
    project_name = project_root.name  # Just the directory name

    # Read global config from ~/.fieldtheory/librarian/ (synced by Field Theory app)
    central_dir = Path.home() / ".fieldtheory" / "librarian"
    config_path = central_dir / "config.json"
    state_path = central_dir / "state.json"

    if not config_path.exists():
        return

    with open(config_path) as f:
        cfg = json.load(f)

    enabled = cfg.get("enabled", False)
    if not enabled:
        return

    # Read rule_content from config (includes user expertise if set)
    rule_content = cfg.get("rule_content", DEFAULT_RULE_CONTENT)

    # Read threshold and mute status from state.json (managed by app's game mechanics)
    threshold = 7  # Default
    muted_until = 0
    if state_path.exists():
        try:
            with open(state_path) as f:
                state = json.load(f)
                threshold = state.get("threshold", 7)
                muted_until = state.get("mutedUntil", 0)
        except:
            pass

    if not isinstance(threshold, int) or threshold <= 0:
        threshold = 7

    # Check if muted for today
    import time
    if muted_until and time.time() * 1000 < muted_until:
        return  # Muted, skip artifact generation

    jobs_dir = central_dir / "jobs"
    artifacts_dir = central_dir / "artifacts"

    # Create directories
    jobs_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    lock_file = central_dir / ".lock"
    seq_file = central_dir / ".seq"

    # Use fcntl for cross-platform file locking
    with open(lock_file, "w") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)

        # Read current count from state.json
        count = 0
        if state_path.exists():
            try:
                with open(state_path) as f:
                    state = json.load(f)
                    count = state.get("count", 0)
            except:
                pass

        count += 1

        # Update count in state.json
        state_data = {"count": count, "threshold": threshold}
        with open(state_path, "w") as f:
            json.dump(state_data, f, indent=2)

        if count < threshold:
            return

        # Reset count
        state_data["count"] = 0
        with open(state_path, "w") as f:
            json.dump(state_data, f, indent=2)

        # Increment global seq
        seq = 0
        if seq_file.exists():
            try:
                seq = int(seq_file.read_text().strip())
            except:
                seq = 0
        seq += 1
        seq_file.write_text(str(seq))

        # Generate timestamp-based filename
        timestamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        job_file = jobs_dir / f"job_{seq}.json"
        out_file = artifacts_dir / f"{project_name}-{timestamp}-artifact.md"

        # 1. Check if job already exists and is done (prevent regression)
        job_is_done = False
        if job_file.exists():
            try:
                existing_job = json.loads(job_file.read_text(encoding="utf-8"))
                if existing_job.get("status") == "done":
                    job_is_done = True
            except (json.JSONDecodeError, OSError):
                pass  # Treat malformed as not-done

        # 2. Create job file if missing (idempotent per seq)
        if not job_file.exists():
            job_data = {
                "schema_version": 1,
                "id": seq,
                "type": "history_artifact",
                "status": "pending",
                "project": project_name,
                "project_path": str(project_root),
                "output": str(out_file),
                "created_at": datetime.now().isoformat()
            }
            job_file.write_text(json.dumps(job_data, indent=2) + "\\n")

        # 3. Output additionalContext with ALL details (no file reads needed)
        if not job_is_done:
            msg = f"""[STATE-ENFORCED] Before responding, write this artifact:

OUTPUT: {out_file}
RULE: {rule_content}
THEN: Update {job_file} setting "status" to "done"

Use the current conversation as context. Write the artifact first, then mark the job done."""
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": msg
                }
            }))

if __name__ == "__main__":
    main()
`;
  }

  /**
   * Install the global state-enforced hook.
   * Works in any directory once enabled.
   */
  installStateEnforcedHook(): boolean {
    try {
      // 1. Ensure ~/.claude directory exists
      const claudeDir = path.join(os.homedir(), '.claude');
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // 2. Create central librarian directory structure
      const centralDir = this.getCentralLibrarianDir();
      const dirs = [
        centralDir,
        path.join(centralDir, 'jobs'),
        path.join(centralDir, 'artifacts'),
        path.join(centralDir, 'rules'),
        path.join(centralDir, 'state'),
      ];
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      // 3. Write global hook scripts
      const userPromptHookPath = this.getStateEnforcedHookPath();
      const preToolUseHookPath = this.getPreToolUseHookPath();
      fs.writeFileSync(userPromptHookPath, this.generateStateEnforcedHookScript(), { mode: 0o755 });
      fs.writeFileSync(preToolUseHookPath, this.generatePreToolUseHookScript(), { mode: 0o755 });

      // 4. Write global config (includes user expertise context)
      const configPath = this.getGlobalStateEnforcedConfigPath();
      const config = {
        enabled: true,
        threshold: this.getStateEnforcedThreshold(),
        rule_content: this.getEffectiveRuleContent(),
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      // 5. Register BOTH hooks in ~/.claude/settings.json
      const settingsPath = this.getClaudeSettingsPath();
      let settings: Record<string, unknown> = {};

      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          // Could not parse existing settings.json, starting fresh
        }
      }

      // Ensure hooks object exists
      if (!settings.hooks || typeof settings.hooks !== 'object') {
        settings.hooks = {};
      }
      const hooks = settings.hooks as Record<string, unknown>;

      // Helper type for hook entries
      type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };

      // Clean up legacy run-hook.sh based hooks (these cause double-counting)
      // Only keep the direct Python hook we're about to add
      const legacyPatterns = [
        'run-hook.sh',
        '.fieldtheory/librarian/hook.py',
        '.fieldtheory/librarian/pretool.py',
      ];
      const isLegacyHook = (command?: string): boolean => {
        if (!command) return false;
        return legacyPatterns.some(pattern => command.includes(pattern));
      };

      if (Array.isArray(hooks['UserPromptSubmit'])) {
        hooks['UserPromptSubmit'] = (hooks['UserPromptSubmit'] as HookEntry[]).filter(
          h => !h.hooks?.some(hh => isLegacyHook(hh.command))
        );
      }

      if (Array.isArray(hooks['PreToolUse'])) {
        hooks['PreToolUse'] = (hooks['PreToolUse'] as HookEntry[]).filter(
          h => !h.hooks?.some(hh => isLegacyHook(hh.command))
        );
      }

      // Check if UserPromptSubmit hook already exists
      const userPromptCommand = `python3 "${userPromptHookPath}"`;
      const userPromptHookExists = (): boolean => {
        if (!Array.isArray(hooks['UserPromptSubmit'])) return false;
        return (hooks['UserPromptSubmit'] as HookEntry[]).some(h =>
          h.hooks?.some(hh => hh.command === userPromptCommand)
        );
      };

      // Add UserPromptSubmit hook (global, no matcher)
      if (!userPromptHookExists()) {
        if (!Array.isArray(hooks['UserPromptSubmit'])) {
          hooks['UserPromptSubmit'] = [];
        }
        (hooks['UserPromptSubmit'] as HookEntry[]).push({
          hooks: [{ type: 'command', command: userPromptCommand }],
        });
      }

      // Check if PreToolUse hook already exists
      const preToolUseCommand = `python3 "${preToolUseHookPath}"`;
      const preToolUseHookExists = (): boolean => {
        if (!Array.isArray(hooks['PreToolUse'])) return false;
        return (hooks['PreToolUse'] as HookEntry[]).some(h =>
          h.hooks?.some(hh => hh.command === preToolUseCommand)
        );
      };

      // Add PreToolUse hook (with matcher for Read|Write|Edit)
      if (!preToolUseHookExists()) {
        if (!Array.isArray(hooks['PreToolUse'])) {
          hooks['PreToolUse'] = [];
        }
        (hooks['PreToolUse'] as HookEntry[]).push({
          matcher: 'Read|Write|Edit',
          hooks: [{ type: 'command', command: preToolUseCommand }],
        });
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      // 6. Auto-add GLOBAL artifacts directory to watched dirs so markdown files open in Field Theory
      // Use global path (same as hook.py writes to), not per-user path
      const globalArtifactsDir = path.join(os.homedir(), '.fieldtheory', 'librarian', 'artifacts');
      this.addWatchedDir(globalArtifactsDir);

      log.info('Installed global state-enforced hooks');
      return true;
    } catch (error) {
      log.error('Failed to install state-enforced hook:', error);
      return false;
    }
  }

  /**
   * Uninstall the global state-enforced hooks.
   * Note: We keep hook files on disk but set enabled=false in config.
   * This allows running Claude sessions to gracefully stop (hooks check enabled flag)
   * instead of erroring on missing files.
   */
  uninstallStateEnforcedHook(): boolean {
    try {
      const userPromptHookPath = this.getStateEnforcedHookPath();
      const preToolUseHookPath = this.getPreToolUseHookPath();
      const configPath = this.getGlobalStateEnforcedConfigPath();

      // Disable in config - hooks check this flag and exit silently if false
      // This allows running Claude sessions to gracefully stop without errors
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.enabled = false;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      } else {
        // Create config with enabled=false if it doesn't exist
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false }, null, 2));
      }

      // Remove hook registrations from ~/.claude/settings.json (for new sessions)
      const settingsPath = this.getClaudeSettingsPath();
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const userPromptCommand = `python3 "${userPromptHookPath}"`;
        const preToolUseCommand = `python3 "${preToolUseHookPath}"`;

        // Remove UserPromptSubmit hook
        if (settings.hooks?.UserPromptSubmit) {
          settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command === userPromptCommand)
          );
          if (settings.hooks.UserPromptSubmit.length === 0) {
            delete settings.hooks.UserPromptSubmit;
          }
        }

        // Remove PreToolUse hook
        if (settings.hooks?.PreToolUse) {
          settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command === preToolUseCommand)
          );
          if (settings.hooks.PreToolUse.length === 0) {
            delete settings.hooks.PreToolUse;
          }
        }

        // Clean up empty hooks object
        if (settings.hooks && Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }

      return true;
    } catch (error) {
      log.error('Failed to uninstall state-enforced hooks:', error);
      return false;
    }
  }

  /**
   * Check if the global state-enforced hook is installed.
   */
  isStateEnforcedHookInstalled(): boolean {
    const hookPath = this.getStateEnforcedHookPath();
    const configPath = this.getGlobalStateEnforcedConfigPath();

    if (!fs.existsSync(hookPath) || !fs.existsSync(configPath)) {
      return false;
    }

    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.enabled === true;
    } catch {
      return false;
    }
  }

  /**
   * Get count of pending jobs (from global directory where hooks write).
   */
  getPendingJobCount(): number {
    // Use GLOBAL path (same as hook.py writes to), not per-user path
    const jobsDir = path.join(os.homedir(), '.fieldtheory', 'librarian', 'jobs');

    if (!fs.existsSync(jobsDir)) {
      return 0;
    }

    let count = 0;
    const files = fs.readdirSync(jobsDir).filter(f => f.startsWith('job_') && f.endsWith('.json'));

    for (const file of files) {
      try {
        const jobPath = path.join(jobsDir, file);
        const job = JSON.parse(fs.readFileSync(jobPath, 'utf-8'));
        if (job.status === 'pending') {
          count++;
        }
      } catch {
        // Skip malformed job files
      }
    }

    return count;
  }

  /**
   * @deprecated No longer needed - global status file is auto-created.
   * Kept for API compatibility.
   */
  initializeProjectStatus(_projectPath: string): void {
    // Global status is now used instead of per-project status.
    // Just ensure the global file exists.
    this.ensureGlobalStatusExists();
  }

  /**
   * Log the current global status (for dev visibility).
   */
  private logStatus(_action: string): void {
    // Status logging disabled for cleaner output
  }

  /**
   * Get the current status for debugging.
   * Reads from the GLOBAL state.json file (shared across all projects).
   */
  getEditStatus(): { edits: number; threshold: number; frequency: string } | null {
    try {
      // Read from GLOBAL state file (same location hook writes to)
      const stateFile = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');
      const frequency = this.settings.discoveryFrequency || 'sometimes';

      if (fs.existsSync(stateFile)) {
        const raw = fs.readFileSync(stateFile, 'utf-8');
        const state = JSON.parse(raw);
        return {
          edits: state.count || 0,
          threshold: state.threshold || 7,
          frequency,
        };
      }

      // Initialize global state file
      const initialState = { count: 0, threshold: this.pickNextDiscoveryThreshold() };
      fs.writeFileSync(stateFile, JSON.stringify(initialState, null, 2));
      return { edits: 0, threshold: initialState.threshold, frequency };
    } catch (error) {
      log.error('Failed to get edit status:', error);
      return null;
    }
  }

  /**
   * Get current counter state for UI display.
   * Reset is handled by reading-added event, not here.
   */
  getCounterStatus(): { edits: number; threshold: number } {
    try {
      this.ensureGlobalStatusExists();
      const statusFile = this.getGlobalStatusPath();
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      return {
        edits: status.promptsSinceReading || 0,
        threshold: status.nextThreshold || 5,
      };
    } catch (error) {
      log.error('Failed to get counter status:', error);
      return { edits: 0, threshold: 5 };
    }
  }

  /**
   * @deprecated Use getCounterStatus() instead. Kept for backward compatibility.
   */
  checkAndResetIfNeeded(): { edits: number; threshold: number; didReset: boolean } {
    const status = this.getCounterStatus();
    return { ...status, didReset: false };
  }

  /**
   * Simple check: is count >= threshold?
   * No side effects, just returns the comparison result.
   */
  isOverThreshold(): boolean {
    try {
      this.ensureGlobalStatusExists();
      const statusFile = this.getGlobalStatusPath();
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      return (status.promptsSinceReading || 0) >= (status.nextThreshold || 5);
    } catch {
      return false;
    }
  }

  /**
   * Reset the counter and pick new threshold. Called when a reading is created.
   * Updates the GLOBAL state.json with a fresh game-mechanics threshold.
   */
  resetCounter(): void {
    const newThreshold = this.pickNextDiscoveryThreshold();

    try {
      // Use GLOBAL state file (same location hook writes to)
      const stateFile = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');
      const newState = { count: 0, threshold: newThreshold };
      fs.writeFileSync(stateFile, JSON.stringify(newState, null, 2));
    } catch (error) {
      log.error('Failed to reset counter:', error);
    }
  }

  /**
   * Reset the global prompt counter.
   * Used for debugging/testing when hooks aren't triggering properly.
   */
  resetAllCounters(): boolean {
    try {
      // Use GLOBAL state file (same location hook writes to)
      const stateFile = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');
      const newState = { count: 0, threshold: this.pickNextDiscoveryThreshold() };
      fs.writeFileSync(stateFile, JSON.stringify(newState, null, 2));
      return true;
    } catch (error) {
      log.error('Failed to reset counter:', error);
      return false;
    }
  }

  // ===========================================================================
  // Mute for Today
  // ===========================================================================

  /**
   * Mute the Librarian until end of today (midnight local time).
   * Updates state.json with a mutedUntil timestamp.
   */
  muteForToday(): boolean {
    try {
      const stateFile = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');

      // Calculate midnight tonight (local time)
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
      const mutedUntil = midnight.getTime();

      // Read existing state
      let state: { count: number; threshold: number; mutedUntil?: number } = { count: 0, threshold: 7 };
      if (fs.existsSync(stateFile)) {
        try {
          state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        } catch {
          // Use defaults
        }
      }

      // Add mutedUntil
      state.mutedUntil = mutedUntil;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      return true;
    } catch (error) {
      log.error('Failed to mute:', error);
      return false;
    }
  }

  /**
   * Check if the Librarian is currently muted.
   */
  isMutedForToday(): boolean {
    try {
      const stateFile = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');
      if (!fs.existsSync(stateFile)) {
        return false;
      }

      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      if (!state.mutedUntil) {
        return false;
      }

      return Date.now() < state.mutedUntil;
    } catch (error) {
      log.error('Failed to check mute status:', error);
      return false;
    }
  }

  /**
   * Unmute the Librarian (clear the mutedUntil timestamp).
   */
  unmute(): boolean {
    try {
      const stateFile = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');
      if (!fs.existsSync(stateFile)) {
        return true;
      }

      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      delete state.mutedUntil;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      return true;
    } catch (error) {
      log.error('Failed to unmute:', error);
      return false;
    }
  }

  // ===========================================================================
  // Setup Wizard Support
  // ===========================================================================

  /**
   * Create a welcome artifact in the specified directory.
   * This introduces users to the Librarian format.
   */
  createWelcomeArtifact(dirPath: string): boolean {
    const expandedPath = this.expandPath(dirPath);
    const normalizedPath = this.normalizePath(expandedPath);

    // Ensure directory exists
    if (!fs.existsSync(normalizedPath)) {
      try {
        fs.mkdirSync(normalizedPath, { recursive: true });
      } catch (error) {
        log.error(`Failed to create directory ${normalizedPath}:`, error);
        return false;
      }
    }

    // Generate filename with today's date
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `${dateStr}-welcome-to-librarian.md`;
    const filePath = path.join(normalizedPath, filename);

    // Don't overwrite existing welcome artifact
    if (fs.existsSync(filePath)) {
      return true;
    }

    const content = `# Welcome to Librarian

*Model: Field Theory Librarian*

Librarian connects your coding sessions to the deeper history of engineering thought. Each artifact captures not just what you're building, but why it matters—drawing threads to physics, systems theory, and the accumulated wisdom of those who built before us.

This is your first artifact. As you work with Claude Code, Librarian will prompt you to create more, building a collection of insights that contextualize your work within the broader story of technology.

Your readings will accumulate here in \`.librarian/\` directories, one per meaningful session. Let them be serendipitous—not every session needs one, but substantial work deserves reflection.
`;

    try {
      fs.writeFileSync(filePath, content, 'utf-8');

      // If this directory is watched, the watcher will pick it up
      // If not, add it to the cache manually for immediate visibility
      if (this.settings.watchedDirs.includes(normalizedPath)) {
        const meta = this.parseFileMetadata(filePath);
        if (meta) {
          this.cache.set(filePath, meta);
          this.saveIndex();
          this.emit('reading-added', meta);
        }
      }

      return true;
    } catch (error) {
      log.error('Failed to create welcome artifact:', error);
      return false;
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Stop all watchers.
   */
  async destroy(): Promise<void> {
    await Promise.allSettled(Array.from(this.watchers.values(), (watcher) => watcher.close()));
    this.watchers.clear();
    await Promise.allSettled(Array.from(this.libraryRootWatchers.values(), (watcher) => watcher.close()));
    this.libraryRootWatchers.clear();
    this.clearPendingRenameTimers();
  }

  // ===========================================================================
  // Auto-Discovery of Existing Readings
  // ===========================================================================

  /**
   * Discover existing .librarian directories that contain readings.
   * Searches common development directories for .librarian folders with .md files.
   * Returns paths that are not already being watched.
   */
  async discoverLibrarianDirs(): Promise<string[]> {
    const discovered: string[] = [];
    const alreadyWatched = new Set(this.settings.watchedDirs);

    // Common development directories to search
    const searchRoots = [
      path.join(os.homedir(), 'dev'),
      path.join(os.homedir(), 'Developer'),
      path.join(os.homedir(), 'projects'),
      path.join(os.homedir(), 'src'),
      path.join(os.homedir(), 'code'),
      path.join(os.homedir(), 'workspace'),
      path.join(os.homedir(), 'repos'),
      path.join(os.homedir(), 'git'),
      path.join(os.homedir(), 'Documents', 'dev'),
      path.join(os.homedir(), 'Documents', 'projects'),
    ];

    // Helper to check if a .librarian dir has any Markdown files
    const hasReadings = (librarianDir: string): boolean => {
      try {
        const files = fs.readdirSync(librarianDir);
        return files.some(isMarkdownDocumentPath);
      } catch {
        return false;
      }
    };

    // Recursively search for .librarian directories (max depth 4)
    const searchDir = (dir: string, depth: number): void => {
      if (depth > 4) return;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const fullPath = path.join(dir, entry.name);

          // Skip common non-project directories
          if (entry.name === 'node_modules' ||
              entry.name === '.git' ||
              entry.name === 'vendor' ||
              entry.name === 'build' ||
              entry.name === 'dist' ||
              entry.name === '__pycache__' ||
              entry.name === '.venv' ||
              entry.name === 'venv') {
            continue;
          }

          // Found a .librarian directory
          if (entry.name === '.librarian') {
            const normalizedPath = this.normalizePath(fullPath);
            if (!alreadyWatched.has(normalizedPath) && hasReadings(fullPath)) {
              discovered.push(normalizedPath);
            }
            continue;
          }

          // Recurse into subdirectories
          searchDir(fullPath, depth + 1);
        }
      } catch {
        // Ignore permission errors, etc.
      }
    };

    // Search each root that exists
    for (const root of searchRoots) {
      if (fs.existsSync(root)) {
        searchDir(root, 0);
      }
    }

    // Deduplicate and sort by path
    const unique = [...new Set(discovered)].sort();

    return unique;
  }

  // ===========================================================================
  // Shared Hook Install Helpers
  // ===========================================================================

  /**
   * Ensure central librarian directories, rule file, config, and watched dirs
   * exist and are properly configured. Shared by all platform install methods.
   * Returns the central directory path.
   */
  private ensureCentralLibrarianSetup(): string {
    const centralDir = this.getCentralLibrarianDir();
    const dirs = [
      centralDir,
      path.join(centralDir, 'jobs'),
      path.join(centralDir, 'artifacts'),
      path.join(centralDir, 'rules'),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Always rewrite the rule file so it reflects the current
    // getEffectiveRuleContent() — Codex reads this file directly.
    const ruleFile = path.join(centralDir, 'rules', 'history_reading.md');
    fs.writeFileSync(ruleFile, this.getEffectiveRuleContent());

    // Ensure config file exists and is enabled
    const configFile = path.join(centralDir, 'config.json');
    if (!fs.existsSync(configFile)) {
      fs.writeFileSync(configFile, JSON.stringify({ enabled: true, stop_on_pending: this.isCodexStopOnPendingEnabled() }, null, 2));
    } else {
      try {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        config.enabled = true;
        config.stop_on_pending = config.stop_on_pending ?? this.isCodexStopOnPendingEnabled();
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
      } catch {
        fs.writeFileSync(configFile, JSON.stringify({ enabled: true, stop_on_pending: this.isCodexStopOnPendingEnabled() }, null, 2));
      }
    }

    // Auto-add GLOBAL artifacts directory to watched dirs
    const globalArtifactsDir = path.join(os.homedir(), '.fieldtheory', 'librarian', 'artifacts');
    this.addWatchedDir(globalArtifactsDir);

    return centralDir;
  }

  // ===========================================================================
  // Cursor Hook Management
  // ===========================================================================

  /**
   * Get the path to the global Cursor hooks config file.
   */
  private getCursorHooksConfigPath(): string {
    return path.join(os.homedir(), '.cursor', 'hooks.json');
  }

  /**
   * Get the path to the Field Theory Cursor beforeSubmitPrompt hook script.
   */
  private getCursorHookScriptPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'librarian', 'cursor-hook.py');
  }

  /**
   * Get the path to the Field Theory Cursor preToolUse hook script.
   */
  private getCursorPreToolScriptPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'librarian', 'cursor-pretool.py');
  }

  /**
   * Get the path to the Field Theory Cursor hook config.
   * @deprecated - now uses central librarian config
   */
  private getCursorHookConfigPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'hooks', 'cursor-config.json');
  }

  /**
   * Generate the Cursor beforeSubmitPrompt hook script content (Python).
   * This script counts prompts, creates jobs at threshold, and blocks the
   * prompt with instructions before any tool runs.
   */
  private generateCursorHookScript(): string {
    return generateCursorBeforeSubmitHookScript(this.HOOK_VERSION);
  }

  /**
   * Generate the Cursor preToolUse hook script content (Python).
   * This script acts as a fallback gate when the current project still has a
   * pending Librarian job.
   */
  private generateCursorPreToolScript(): string {
    return generateCursorPreToolHookScript(this.HOOK_VERSION);
  }

  /**
   * Check if the Cursor hooks are installed.
   * Checks both the prompt gate and the fallback pre-tool gate.
   */
  isCursorHookInstalled(): boolean {
    const hookPath = this.getCursorHookScriptPath();
    const preToolPath = this.getCursorPreToolScriptPath();
    const cursorConfigPath = this.getCursorHooksConfigPath();

    if (!fs.existsSync(hookPath) || !fs.existsSync(preToolPath) || !fs.existsSync(cursorConfigPath)) {
      return false;
    }

    try {
      const cursorConfig = JSON.parse(fs.readFileSync(cursorConfigPath, 'utf-8'));
      return hasCursorCommandHook(cursorConfig, 'beforeSubmitPrompt', 'cursor-hook.py')
        && hasCursorCommandHook(cursorConfig, 'preToolUse', 'cursor-pretool.py');
    } catch {
      return false;
    }
  }

  /**
   * Install the Cursor hooks.
   * Installs both beforeSubmitPrompt (primary artifact enforcement) and
   * preToolUse (fallback tool gate).
   */
  installCursorHook(): boolean {
    try {
      // 1. Shared setup: directories, rule file, config, watched dirs
      this.ensureCentralLibrarianSetup();

      // 2. Ensure ~/.cursor directory exists
      const cursorDir = path.dirname(this.getCursorHooksConfigPath());
      if (!fs.existsSync(cursorDir)) {
        fs.mkdirSync(cursorDir, { recursive: true });
      }

      // 3. Write the Cursor hook scripts.
      const hookPath = this.getCursorHookScriptPath();
      fs.writeFileSync(hookPath, this.generateCursorHookScript(), { mode: 0o755 });
      const preToolPath = this.getCursorPreToolScriptPath();
      fs.writeFileSync(preToolPath, this.generateCursorPreToolScript(), { mode: 0o755 });

      // 4. Register hooks in Cursor's ~/.cursor/hooks.json
      const cursorConfigPath = this.getCursorHooksConfigPath();
      let cursorConfig: CursorHooksConfig = { version: 1, hooks: {} };

      if (fs.existsSync(cursorConfigPath)) {
        try {
          cursorConfig = JSON.parse(fs.readFileSync(cursorConfigPath, 'utf-8'));
        } catch {
          // Could not parse existing Cursor hooks.json, starting fresh
        }
      }

      upsertCursorCommandHook(
        cursorConfig,
        'beforeSubmitPrompt',
        { type: 'command', command: `python3 ${hookPath}`, timeout: 10 },
        'cursor-hook.py',
      );
      upsertCursorCommandHook(
        cursorConfig,
        'preToolUse',
        { type: 'command', command: `python3 ${preToolPath}`, timeout: 5 },
        'cursor-pretool.py',
      );

      // Write updated Cursor config
      fs.writeFileSync(cursorConfigPath, JSON.stringify(cursorConfig, null, 2));

      // 5. Add librarian paths to Cursor's permissions allow list
      const cursorCliConfigPath = path.join(os.homedir(), '.cursor', 'cli-config.json');
      try {
        let cliConfig: Record<string, unknown> = { version: 1, permissions: { allow: [], deny: [] } };

        if (fs.existsSync(cursorCliConfigPath)) {
          cliConfig = JSON.parse(fs.readFileSync(cursorCliConfigPath, 'utf-8'));
        }

        // Ensure permissions.allow exists
        if (!cliConfig.permissions) cliConfig.permissions = { allow: [], deny: [] };
        if (!Array.isArray((cliConfig.permissions as Record<string, unknown>).allow)) {
          (cliConfig.permissions as Record<string, unknown>).allow = [];
        }

        const allowList = (cliConfig.permissions as Record<string, unknown>).allow as string[];
        // Use tilde notation for portable paths that work for any user
        const librarianPatterns = [
          'Read(~/.fieldtheory/librarian/**)',
          'Edit(~/.fieldtheory/librarian/**)',
          'Write(~/.fieldtheory/librarian/**)',
        ];

        for (const pattern of librarianPatterns) {
          if (!allowList.includes(pattern)) {
            allowList.push(pattern);
          }
        }

        fs.writeFileSync(cursorCliConfigPath, JSON.stringify(cliConfig, null, 2));
      } catch {
        // Could not update Cursor cli-config.json
      }

      log.info('Installed Cursor hooks');
      return true;
    } catch (error) {
      log.error('Failed to install Cursor hooks:', error);
      return false;
    }
  }

  /**
   * Uninstall the Cursor hooks.
   */
  uninstallCursorHook(): boolean {
    try {
      const hookPath = this.getCursorHookScriptPath();
      const preToolPath = this.getCursorPreToolScriptPath();

      // Remove hook scripts
      if (fs.existsSync(hookPath)) {
        fs.unlinkSync(hookPath);
      }
      if (fs.existsSync(preToolPath)) {
        fs.unlinkSync(preToolPath);
      }

      // Remove from Cursor's hooks.json
      const cursorConfigPath = this.getCursorHooksConfigPath();
      if (fs.existsSync(cursorConfigPath)) {
        const cursorConfig = JSON.parse(fs.readFileSync(cursorConfigPath, 'utf-8'));

        removeCursorCommandHook(cursorConfig, 'beforeSubmitPrompt', 'cursor-hook.py');
        removeCursorCommandHook(cursorConfig, 'preToolUse', 'cursor-pretool.py');

        fs.writeFileSync(cursorConfigPath, JSON.stringify(cursorConfig, null, 2));
      }

      // Remove librarian paths from Cursor's permissions allow list
      const cursorCliConfigPath = path.join(os.homedir(), '.cursor', 'cli-config.json');
      try {
        if (fs.existsSync(cursorCliConfigPath)) {
          const cliConfig = JSON.parse(fs.readFileSync(cursorCliConfigPath, 'utf-8'));

          if (cliConfig.permissions?.allow && Array.isArray(cliConfig.permissions.allow)) {
            // Use tilde notation to match what we added during install
            const librarianPatterns = [
              'Read(~/.fieldtheory/librarian/**)',
              'Edit(~/.fieldtheory/librarian/**)',
              'Write(~/.fieldtheory/librarian/**)',
            ];

            cliConfig.permissions.allow = cliConfig.permissions.allow.filter(
              (p: string) => !librarianPatterns.includes(p)
            );

            fs.writeFileSync(cursorCliConfigPath, JSON.stringify(cliConfig, null, 2));
          }
        }
      } catch {
        // Could not update Cursor cli-config.json
      }

      return true;
    } catch (error) {
      log.error('Failed to uninstall Cursor hooks:', error);
      return false;
    }
  }

  // ===========================================================================
  // Codex CLI Hook Management
  // ===========================================================================

  /**
   * Get the path to the Codex hooks config file.
   */
  private getCodexHooksConfigPath(): string {
    return path.join(os.homedir(), '.codex', 'hooks.json');
  }

  /**
   * Get the path to the Codex config file.
   */
  private getCodexConfigPath(): string {
    return path.join(os.homedir(), '.codex', 'config.toml');
  }

  /**
   * Get the path to the Codex AGENTS.md file.
   */
  private getCodexAgentsMdPath(): string {
    return path.join(os.homedir(), '.codex', 'AGENTS.md');
  }

  /**
   * Get the path to the Codex notify hook script.
   */
  private getCodexNotifyScriptPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'librarian', 'codex-notify.py');
  }

  /**
   * Get the path to the legacy Codex session-start hook script.
   * Kept for cleanup/migration of older installs.
   */
  private getLegacyCodexSessionStartScriptPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'librarian', 'codex-session-start.py');
  }

  /**
   * Get the path to the Codex stop hook script.
   */
  private getCodexStopScriptPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'librarian', 'codex-stop.py');
  }

  /**
   * Generate the Codex notify hook script (Python).
   * Receives AfterAgent payload as argv, increments shared state.json counter,
   * creates jobs at threshold, and installs the Stop hook only while a job
   * remains pending.
   */
  private generateCodexNotifyScript(): string {
    return generateCodexNotifyHookScript();
  }

  /**
   * Generate the Codex stop hook script (Python).
   * Blocks agent completion when a sentinel file exists (job was just created
   * in this session. Returns the current Codex stop-hook block response.
   * Once the artifact is written and job marked done, allows completion.
   */
  private generateCodexStopScript(): string {
    return generateCodexStopScript();
  }

  private hasPendingCodexArtifactJob(): boolean {
    const jobsDir = path.join(this.getCentralLibrarianDir(), 'jobs');
    if (!fs.existsSync(jobsDir)) {
      return false;
    }

    try {
      for (const fileName of fs.readdirSync(jobsDir)) {
        if (!fileName.endsWith('.json')) {
          continue;
        }
        const job = JSON.parse(fs.readFileSync(path.join(jobsDir, fileName), 'utf-8')) as { status?: string };
        if (job.status === 'pending') {
          return true;
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  private hasCodexNotifyConfiguration(configToml: string): boolean {
    const librarianDir = path.join(os.homedir(), '.fieldtheory', 'librarian');
    return configToml.includes('notify = [')
      && configToml.includes('codex-notify.py')
      && configToml.includes(TOML_SANDBOX_WORKSPACE_WRITE_HEADER)
      && configToml.includes(librarianDir);
  }

  private hasCodexManagedSection(agentsMd: string): boolean {
    return agentsMd.includes('Field Theory Librarian - managed section');
  }

  private syncCodexStopHookRegistration(installStop: boolean): void {
    const hooksConfigPath = this.getCodexHooksConfigPath();
    let hooksConfig: CodexHooksConfig = { hooks: {} };

    if (fs.existsSync(hooksConfigPath)) {
      try {
        hooksConfig = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf-8'));
      } catch {
        hooksConfig = { hooks: {} };
      }
    }

    removeCodexCommandHook(hooksConfig, 'SessionStart', LEGACY_CODEX_SESSION_START_SCRIPT);

    if (installStop) {
      upsertCodexCommandHook(
        hooksConfig,
        'Stop',
        {
          hooks: [{
            type: 'command',
            command: `python3 ${this.getCodexStopScriptPath()}`,
            timeout_sec: 10,
          }],
        },
        CODEX_STOP_SCRIPT,
      );
    } else {
      removeCodexCommandHook(hooksConfig, 'Stop', CODEX_STOP_SCRIPT);
    }

    fs.writeFileSync(hooksConfigPath, JSON.stringify(hooksConfig, null, 2));
  }

  /**
   * Check if Codex CLI appears to be installed.
   */
  getCodexStatus(): 'installed' | 'not-installed' {
    const codexDir = path.join(os.homedir(), '.codex');
    return fs.existsSync(codexDir) ? 'installed' : 'not-installed';
  }

  /**
   * Check if the Codex hooks are installed.
   * Checks the notify wiring, stop script availability, and required config.
   * Stop registration is dynamic and may be absent when no job is pending.
   */
  isCodexHookInstalled(): boolean {
    const notifyPath = this.getCodexNotifyScriptPath();
    const stopPath = this.getCodexStopScriptPath();
    const hooksConfigPath = this.getCodexHooksConfigPath();
    const configTomlPath = this.getCodexConfigPath();

    // Check that at least the main scripts exist
    if (!fs.existsSync(notifyPath) || !fs.existsSync(stopPath)) {
      return false;
    }

    if (!fs.existsSync(hooksConfigPath)) {
      return false;
    }

    try {
      JSON.parse(fs.readFileSync(hooksConfigPath, 'utf-8'));
    } catch {
      return false;
    }

    if (!fs.existsSync(configTomlPath)) {
      return false;
    }

    try {
      const configToml = fs.readFileSync(configTomlPath, 'utf-8');
      return this.hasCodexNotifyConfiguration(configToml);
    } catch {
      return false;
    }
  }

  /**
   * Install all Codex hooks.
   * 1. Ensure directories exist
   * 2. Write the notify and stop scripts
   * 3. Reconcile ~/.codex/hooks.json
   * 4. Add notify line to ~/.codex/config.toml
   * 5. Add writable_roots for librarian dir to config.toml
   * 6. Append Librarian section to ~/.codex/AGENTS.md
   * 7. Add global artifacts dir to watched dirs
   */
  installCodexHook(): boolean {
    try {
      // 1. Shared setup: directories, rule file, config, watched dirs
      this.ensureCentralLibrarianSetup();
      if (!this.writeFieldTheoryMarkdownCommandFile()) {
        log.error('Failed to write Field Theory Markdown command file, aborting Codex hook install');
        return false;
      }

      // 2. Ensure ~/.codex directory exists
      const codexDir = path.join(os.homedir(), '.codex');
      if (!fs.existsSync(codexDir)) {
        fs.mkdirSync(codexDir, { recursive: true });
      }

      // 3. Write the active Codex scripts and remove the legacy session-start hook.
      const notifyPath = this.getCodexNotifyScriptPath();
      const sessionStartPath = this.getLegacyCodexSessionStartScriptPath();
      const stopPath = this.getCodexStopScriptPath();

      fs.writeFileSync(notifyPath, this.generateCodexNotifyScript(), { mode: 0o755 });
      fs.writeFileSync(stopPath, this.generateCodexStopScript(), { mode: 0o755 });
      if (fs.existsSync(sessionStartPath)) {
        fs.unlinkSync(sessionStartPath);
      }

      // 4. Reconcile ~/.codex/hooks.json. Stop is opt-in and only installed
      // while a pending Librarian job exists.
      this.syncCodexStopHookRegistration(this.isCodexStopOnPendingEnabled() && this.hasPendingCodexArtifactJob());

      // 6. Add notify line and writable_roots to ~/.codex/config.toml
      const configTomlPath = this.getCodexConfigPath();
      let tomlContent = '';
      if (fs.existsSync(configTomlPath)) {
        tomlContent = fs.readFileSync(configTomlPath, 'utf-8');
      }

      const notifyCommand = ['python3', notifyPath];
      const librarianDir = path.join(os.homedir(), '.fieldtheory', 'librarian');
      tomlContent = tomlSetNotify(tomlContent, notifyCommand);
      tomlContent = tomlAddWritableRoot(tomlContent, librarianDir);
      fs.writeFileSync(configTomlPath, tomlContent);

      // 7. Append Librarian section to ~/.codex/AGENTS.md (if not present)
      const agentsMdPath = this.getCodexAgentsMdPath();
      let agentsMd = '';
      if (fs.existsSync(agentsMdPath)) {
        agentsMd = fs.readFileSync(agentsMdPath, 'utf-8');
      }

      const librarianSection = `
<!-- Field Theory Librarian - managed section, do not edit -->
## Field Theory Librarian
When you receive instructions prefixed with [STATE-ENFORCED] or [LIBRARIAN],
follow them before proceeding. These create short reflective artifacts.
Artifacts go in ~/.fieldtheory/librarian/artifacts/.
After writing, update the job file in ~/.fieldtheory/librarian/jobs/ setting "status" to "done".

When writing normal Field Theory Markdown outside Librarian artifacts, follow:

[run this command: write-ft-markdown.md]
${this.getFieldTheoryMarkdownCommandPath()}
<!-- End Field Theory Librarian -->
`;
      agentsMd = managedSectionUpsert(agentsMd, 'Field Theory Librarian - managed section', librarianSection);
      fs.writeFileSync(agentsMdPath, agentsMd);

      log.info('Installed Codex hooks');
      return true;
    } catch (error) {
      log.error('Failed to install Codex hooks:', error);
      return false;
    }
  }

  /**
   * Uninstall all Codex hooks.
   */
  uninstallCodexHook(): boolean {
    try {
      // Remove hook scripts
      const scripts = [
        this.getCodexNotifyScriptPath(),
        this.getLegacyCodexSessionStartScriptPath(),
        this.getCodexStopScriptPath(),
      ];
      for (const scriptPath of scripts) {
        if (fs.existsSync(scriptPath)) {
          fs.unlinkSync(scriptPath);
        }
      }

      // Remove sentinel file
      const sentinelFile = path.join(os.homedir(), '.fieldtheory', 'librarian', '.codex-pending');
      if (fs.existsSync(sentinelFile)) {
        fs.unlinkSync(sentinelFile);
      }

      // Remove from ~/.codex/hooks.json
      const hooksConfigPath = this.getCodexHooksConfigPath();
      if (fs.existsSync(hooksConfigPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf-8')) as CodexHooksConfig;
          removeCodexCommandHook(config, 'SessionStart', LEGACY_CODEX_SESSION_START_SCRIPT);
          removeCodexCommandHook(config, 'Stop', CODEX_STOP_SCRIPT);

          fs.writeFileSync(hooksConfigPath, JSON.stringify(config, null, 2));
        } catch {
          // Could not update hooks.json
        }
      }

      // Remove notify line and writable_roots from ~/.codex/config.toml
      const configTomlPath = this.getCodexConfigPath();
      if (fs.existsSync(configTomlPath)) {
        try {
          let tomlContent = fs.readFileSync(configTomlPath, 'utf-8');
          const librarianDir = path.join(os.homedir(), '.fieldtheory', 'librarian');
          tomlContent = tomlRemoveNotify(tomlContent, 'codex-notify.py');
          tomlContent = tomlRemoveWritableRoot(tomlContent, librarianDir);
          fs.writeFileSync(configTomlPath, tomlContent);
        } catch {
          // Could not update config.toml
        }
      }

      // Remove managed section from ~/.codex/AGENTS.md
      const agentsMdPath = this.getCodexAgentsMdPath();
      if (fs.existsSync(agentsMdPath)) {
        try {
          let agentsMd = fs.readFileSync(agentsMdPath, 'utf-8');
          agentsMd = managedSectionRemove(
            agentsMd,
            '<!-- Field Theory Librarian - managed section, do not edit -->',
            '<!-- End Field Theory Librarian -->'
          );
          fs.writeFileSync(agentsMdPath, agentsMd);
        } catch {
          // Could not update AGENTS.md
        }
      }

      log.info('Uninstalled Codex hooks');
      return true;
    } catch (error) {
      log.error('Failed to uninstall Codex hooks:', error);
      return false;
    }
  }
}
