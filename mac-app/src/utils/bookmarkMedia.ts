export function localMediaUrl(img: BookmarkImage | undefined): string | null {
  if (!img?.localFilename) return null;
  return `ftmedia://media/${img.localFilename}`;
}
