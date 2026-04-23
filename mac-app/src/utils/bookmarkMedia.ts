export function localMediaUrls(images: BookmarkImage[] | undefined): string[] {
  if (!images?.length) return [];
  return images.flatMap((img) => (img.localFilename ? [`ftmedia://media/${img.localFilename}`] : []));
}

export function localVideoUrl(img: BookmarkImage | undefined): string | null {
  if (!img?.localVideoFilename) return null;
  return `ftmedia://media/${img.localVideoFilename}`;
}

export function localMediaUrl(img: BookmarkImage | undefined): string | null {
  return localMediaUrls(img ? [img] : undefined)[0] ?? null;
}

export function localAvatarUrl(source: { localAvatarFilename?: string } | undefined): string | null {
  if (!source?.localAvatarFilename) return null;
  return `ftmedia://media/${source.localAvatarFilename}`;
}
