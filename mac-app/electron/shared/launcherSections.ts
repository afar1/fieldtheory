export const LAUNCHER_SECTIONS = ['recents', 'clipboard', 'bookmarks', 'river'] as const;
export type LauncherSection = typeof LAUNCHER_SECTIONS[number] | `folder:${string}`;
export type LauncherFolder = { path: string; label: string };
export function launcherFolderSection(folder: LauncherFolder): LauncherSection {
  return `folder:${encodeURIComponent(JSON.stringify(folder))}`;
}
export function parseLauncherFolder(section: unknown): LauncherFolder | null {
  if (typeof section !== 'string' || !section.startsWith('folder:')) return null;
  try {
    const value = JSON.parse(decodeURIComponent(section.slice(7)));
    return typeof value.path === 'string' && (value.path.startsWith('/') || value.path === 'artifacts')
      && !value.path.split('/').includes('..') && typeof value.label === 'string' && value.label.trim()
      ? { path: value.path.replace(/\/+$/, ''), label: value.label } : null;
  } catch { return null; }
}


export function normalizeLauncherSections(value: unknown): LauncherSection[] {
  if (!Array.isArray(value)) return [...LAUNCHER_SECTIONS];
  const sections = [...new Set(value.filter((item): item is LauncherSection => LAUNCHER_SECTIONS.includes(item as typeof LAUNCHER_SECTIONS[number]) || parseLauncherFolder(item) !== null))];
  return sections.length ? sections : ['recents'];
}

export function nextLauncherSection(current: LauncherSection, sections: LauncherSection[]): LauncherSection {
  const enabled = normalizeLauncherSections(sections);
  return enabled[(enabled.indexOf(current) + 1) % enabled.length];
}
