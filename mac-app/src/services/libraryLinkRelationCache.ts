import { getRawMarkdownLinkHits } from '../../electron/shared/wikiLinkParser';
import {
  linkRelationSourceKey,
  type LinkRelationDocument,
  type LinkRelationRequest,
  type LinkRelationSnapshot,
  type LinkRelationTarget,
} from '../../electron/shared/libraryLinkRelations';
import {
  resolveMarkdownEditorLinkHits,
  type MarkdownLinkRelationDocument,
  type WikiIndex,
  type WikiIndexInput,
} from '../utils/wikiLinks';

type CachedDocument = {
  version?: string;
  document: LinkRelationDocument | null;
  rawHits?: ReturnType<typeof getRawMarkdownLinkHits>;
  resolved?: MarkdownLinkRelationDocument;
  indexVersion?: string;
};

/** A complete snapshot is replaced atomically; failed repairs use the old loader. */
export class LibraryLinkRelationCache {
  private readonly clientId = crypto.randomUUID();
  private generation = 0;
  private scope?: string;
  private documents = new Map<string, CachedDocument>();
  private lastResult: MarkdownLinkRelationDocument[] = [];
  private lastIndex?: WikiIndex;
  private indexVersion = '';

  async load(
    targets: LinkRelationTarget[],
    index: WikiIndex,
    read: ((request: LinkRelationRequest) => Promise<LinkRelationSnapshot>) | undefined,
    isCurrent: () => boolean,
  ): Promise<MarkdownLinkRelationDocument[] | null> {
    const generation = ++this.generation;
    if (!read) return null;
    const sources = targets.map((target) => ({
      target,
      version: this.documents.get(linkRelationSourceKey(target))?.version,
    }));
    try {
      const result = await read({ clientId: this.clientId, scope: this.scope, sources });
      if (generation !== this.generation || !isCurrent() || !result.complete) return null;
      const next = result.scope === this.scope ? new Map(this.documents) : new Map<string, CachedDocument>();
      for (const change of result.changes) {
        next.set(change.key, { version: change.version, document: change.document });
      }
      // A bridge that omits a source cannot silently turn an incomplete cache
      // into a complete index. Missing files have explicit null records.
      if (targets.some((target) => !next.has(linkRelationSourceKey(target)))) return null;
      const requested = new Set(targets.map(linkRelationSourceKey));
      for (const key of next.keys()) if (!requested.has(key)) next.delete(key);
      if (index !== this.lastIndex) {
        this.indexVersion = JSON.stringify([
          [...index.byTitle], [...index.byRelPath], [...(index.byFilePath ?? [])],
        ]);
        this.lastIndex = index;
      }
      const resolved = targets.flatMap((target) => {
        const cached = next.get(linkRelationSourceKey(target))!;
        if (!cached.document) return [];
        if (!cached.resolved || cached.indexVersion !== this.indexVersion) {
          cached.rawHits ??= getRawMarkdownLinkHits(cached.document.content);
          cached.resolved = {
            ...cached.document,
            linkHits: resolveMarkdownEditorLinkHits(cached.rawHits, index),
          };
          cached.indexVersion = this.indexVersion;
        }
        return [cached.resolved];
      });
      this.documents = next;
      this.scope = result.scope;
      if (resolved.length !== this.lastResult.length || resolved.some((doc, i) => doc !== this.lastResult[i])) {
        this.lastResult = resolved;
      }
      return this.lastResult;
    } catch {
      return null;
    }
  }
}

export function linkRelationTargetsFromPages(
  wikiPages: WikiIndexInput[],
  readings: Array<{ path: string }>,
  commands: WikiIndexInput[],
): LinkRelationTarget[] {
  return [
    ...wikiPages.map((page): LinkRelationTarget => ({ kind: 'wiki', relPath: page.relPath })),
    ...readings.map((reading): LinkRelationTarget => ({ kind: 'artifact', path: reading.path })),
    ...[...new Set(commands.map((command) => command.commandPath).filter((value): value is string => !!value))]
      .map((path): LinkRelationTarget => ({ kind: 'command', path })),
  ];
}
