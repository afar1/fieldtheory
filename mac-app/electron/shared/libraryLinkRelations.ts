export type LinkRelationTarget =
  | { kind: 'wiki'; relPath: string }
  | { kind: 'artifact'; path: string }
  | { kind: 'command'; path: string };

export type LinkRelationDocument = {
  target: LinkRelationTarget;
  title: string;
  content: string;
};

export type LinkRelationRequest = {
  clientId: string;
  scope?: string;
  sources: Array<{ target: LinkRelationTarget; version?: string }>;
};

export type LinkRelationSnapshot =
  | { complete: false }
  | {
    complete: true;
    scope: string;
    changes: Array<{ key: string; version?: string; document: LinkRelationDocument | null }>;
  };

export function linkRelationSourceKey(target: LinkRelationTarget): string {
  return JSON.stringify(target.kind === 'wiki'
    ? [target.kind, target.relPath]
    : [target.kind, target.path]);
}

export function isLinkRelationRequest(value: unknown): value is LinkRelationRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as LinkRelationRequest;
  return typeof request.clientId === 'string'
    && (request.scope === undefined || typeof request.scope === 'string')
    && Array.isArray(request.sources)
    && request.sources.every((source) => source && typeof source === 'object'
      && (source.version === undefined || typeof source.version === 'string')
      && source.target && typeof source.target === 'object'
      && (source.target.kind === 'wiki'
        ? typeof source.target.relPath === 'string'
        : (source.target.kind === 'artifact' || source.target.kind === 'command')
          && typeof source.target.path === 'string'));
}
