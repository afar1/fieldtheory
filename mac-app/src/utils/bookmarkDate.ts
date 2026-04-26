export function formatShortBookmarkDate(postedAt: string | undefined | null): string {
  const date = parseBookmarkDate(postedAt);
  if (!date) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

export function formatLongBookmarkDate(postedAt: string | undefined | null): string {
  const date = parseBookmarkDate(postedAt);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function parseBookmarkDate(postedAt: string | undefined | null): Date | null {
  if (!postedAt) return null;
  const date = new Date(postedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}
