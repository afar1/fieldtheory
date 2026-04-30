export function isDocumentSaveOk(result: DocumentSaveResult | boolean | null | undefined): result is { ok: true; version: DocumentVersion } {
  return result === true || (typeof result === 'object' && result !== null && result.ok === true);
}

export function isDocumentSaveConflict(result: DocumentSaveResult | boolean | null | undefined): result is Extract<DocumentSaveResult, { ok: false; reason: 'conflict' }> {
  return typeof result === 'object' && result !== null && result.ok === false && result.reason === 'conflict';
}

export function getDocumentSaveVersion(result: DocumentSaveResult | boolean | null | undefined): DocumentVersion | null {
  return typeof result === 'object' && result !== null && result.ok === true ? result.version : null;
}

