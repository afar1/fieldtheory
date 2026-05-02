export async function copyBookmarkContent(bookmarkId: string): Promise<boolean> {
  const result = await window.bookmarksAPI?.copyForAgent(bookmarkId);
  return !!result?.success;
}
