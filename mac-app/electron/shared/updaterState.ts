export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'
  | 'uptodate';

export function isUpdateStatusSticky(status: UpdateStatus | null | undefined): boolean {
  return status === 'ready' || status === 'installing';
}

export function resolveUpdaterStatusTransition(
  current: UpdateStatus,
  next: UpdateStatus,
  options: { force?: boolean } = {},
): UpdateStatus {
  if (options.force) return next;
  if (current === 'installing') return next === 'installing' || next === 'ready' || next === 'error' ? next : current;
  if (current === 'ready') return next === 'installing' || next === 'ready' ? next : current;
  return next;
}
