export async function copyBookmarkContent(bookmarkId: string): Promise<boolean> {
  const result = await window.bookmarksAPI?.copyForAgent(bookmarkId);
  return !!result?.success;
}

export async function sendBookmarkToCodex(bookmarkId: string): Promise<boolean> {
  const result = await window.bookmarksAPI?.sendToCodex?.(bookmarkId)
    ?? await window.bookmarksAPI?.invokeBookmark(bookmarkId);
  return !!result?.success;
}
