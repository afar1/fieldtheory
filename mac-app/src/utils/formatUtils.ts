/**
 * Utility functions for formatting display values.
 */

/**
 * Format timestamp to relative time (e.g., "2 minutes ago").
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

/**
 * Format timestamp to compact relative time (e.g., "2m", "3h", "1d").
 */
export function formatCompactTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return 'now';
}

/**
 * Format timestamp to readable compact time (e.g., "2 mins", "3 hrs", "1 day").
 */
export function formatCompactTimeReadable(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hr${hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} min${minutes > 1 ? 's' : ''}`;
  return 'just now';
}

/**
 * Format timestamp to readable time with "ago" suffix (e.g., "2 mins ago", "just now").
 * Handles the "just now" case correctly (doesn't append "ago").
 */
export function formatTimeAgo(timestamp: number): string {
  const time = formatCompactTimeReadable(timestamp);
  return time === 'just now' ? time : `${time} ago`;
}

/**
 * Format word count compactly (e.g., "93w" instead of "93 words").
 */
export function formatCompactWords(count: number | undefined): string {
  if (!count) return '';
  return `${count}w`;
}

/**
 * Format file size for images.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
