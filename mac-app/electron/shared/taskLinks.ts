const CODEX_TASK_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function codexTaskUrl(threadId: string): string | null {
  return CODEX_TASK_ID.test(threadId) ? `codex://threads/${threadId}` : null;
}

export function isCodexTaskUrl(value: string): boolean {
  const prefix = 'codex://threads/';
  return value.startsWith(prefix) && CODEX_TASK_ID.test(value.slice(prefix.length));
}
