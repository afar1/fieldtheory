import crypto from 'crypto';
import fs from 'fs';
import type { DocumentVersion } from './documentSaveGuard';
import {
  isLinkRelationRequest,
  linkRelationSourceKey,
  type LinkRelationDocument,
  type LinkRelationSnapshot,
  type LinkRelationTarget,
} from '../shared/libraryLinkRelations';

export type LinkRelationSource = {
  path: string;
  metadataVersion: string;
  displayContent?: (raw: string) => string;
  load: () => (LinkRelationDocument & { documentVersion: DocumentVersion }) | null
    | Promise<(LinkRelationDocument & { documentVersion: DocumentVersion }) | null>;
};

function sourceVersion(source: LinkRelationSource, version: Pick<DocumentVersion, 'size' | 'sha256'>): string {
  return JSON.stringify([source.path, source.metadataVersion, version.size, version.sha256]);
}

function bytesVersion(source: LinkRelationSource, bytes: Buffer): string {
  return sourceVersion(source, { size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}

/** Read bytes at every repair boundary; only changed bodies cross the bridge. */
export class LibraryLinkRelationReader {
  private pending = new Map<string, object>();

  constructor(private readonly options: {
    scope: () => string;
    resolve: (target: LinkRelationTarget) => LinkRelationSource | null;
  }) {}

  async read(value: unknown, caller: string): Promise<LinkRelationSnapshot> {
    if (!isLinkRelationRequest(value)) throw new Error('Invalid link relation request');
    const key = `${caller}:${value.clientId}`;
    const job = {};
    this.pending.set(key, job);
    const scope = this.options.scope();
    const current = () => this.pending.get(key) === job && this.options.scope() === scope;
    const changes: Extract<LinkRelationSnapshot, { complete: true }>['changes'] = [];
    try {
      for (let index = 0; index < value.sources.length; index += 1) {
        // Yield so newer repairs can cancel obsolete work before it is submitted.
        if (index % 32 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
          if (!current()) return { complete: false };
        }
        const requested = value.sources[index];
        const sourceKey = linkRelationSourceKey(requested.target);
        const source = this.options.resolve(requested.target);
        if (!source) {
          changes.push({ key: sourceKey, document: null });
          continue;
        }
        try {
          // Cold, unfiltered documents can validate the original reader's
          // content against its byte hash without an additional disk read.
          const bytes = source.displayContent || (value.scope === scope && requested.version !== undefined)
            ? fs.readFileSync(source.path)
            : undefined;
          const before = bytes ? bytesVersion(source, bytes) : undefined;
          if (before !== undefined && value.scope === scope && requested.version === before) continue;
          const loaded = await source.load();
          if (!loaded) {
            changes.push({ key: sourceKey, document: null });
            continue;
          }
          const { documentVersion, ...document } = loaded;
          // A changing file may still be displayed by the original reader, but
          // that ambiguous snapshot must not be reused on the next repair.
          const after = sourceVersion(source, documentVersion);
          const raw = bytes?.toString('utf8');
          const contentMatches = raw === undefined
            ? bytesVersion(source, Buffer.from(document.content)) === after
            : document.content === (source.displayContent?.(raw) ?? raw);
          const stable = (before === undefined || before === after) && contentMatches;
          changes.push({ key: sourceKey, document, version: stable ? after : undefined });
        } catch {
          changes.push({ key: sourceKey, document: null });
        }
      }
      return current() ? { complete: true, scope, changes } : { complete: false };
    } finally {
      if (this.pending.get(key) === job) this.pending.delete(key);
    }
  }
}
