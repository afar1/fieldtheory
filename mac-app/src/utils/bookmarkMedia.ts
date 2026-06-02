function localBookmarkMediaUrl(filename: string): string {
  if (typeof window !== 'undefined') {
    const url = window.fieldTheoryBookmarkMediaAPI?.mediaUrl(filename);
    if (url) return url;
  }
  return `ftmedia://media/${encodeURIComponent(filename)}`;
}

export function localMediaUrls(images: BookmarkImage[] | undefined): string[] {
  if (!images?.length) return [];
  return images.flatMap((img) => (img.localFilename ? [localBookmarkMediaUrl(img.localFilename)] : []));
}

export function localVideoUrl(img: BookmarkImage | undefined): string | null {
  if (!img?.localVideoFilename) return null;
  return localBookmarkMediaUrl(img.localVideoFilename);
}

export function localMediaUrl(img: BookmarkImage | undefined): string | null {
  return localMediaUrls(img ? [img] : undefined)[0] ?? null;
}

export function localAvatarUrl(source: { localAvatarFilename?: string } | undefined): string | null {
  if (!source?.localAvatarFilename) return null;
  return localBookmarkMediaUrl(source.localAvatarFilename);
}
