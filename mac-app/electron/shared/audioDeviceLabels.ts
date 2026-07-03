export function formatCompactPriorityMicName(name: string | null | undefined): string {
  return name?.trim().slice(0, 3) || 'Mic';
}
