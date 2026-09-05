export const LAUNCHER_SECTIONS = ['recents', 'clipboard', 'bookmarks', 'river'] as const;
export type LauncherSection = typeof LAUNCHER_SECTIONS[number];

export function normalizeLauncherSections(value: unknown): LauncherSection[] {
  if (!Array.isArray(value)) return [...LAUNCHER_SECTIONS];
  const sections = [...new Set(value.filter((item): item is LauncherSection => LAUNCHER_SECTIONS.includes(item)))];
  return sections.length ? sections : ['recents'];
}

export function nextLauncherSection(current: LauncherSection, sections: LauncherSection[]): LauncherSection {
  const enabled = normalizeLauncherSections(sections);
  return enabled[(enabled.indexOf(current) + 1) % enabled.length];
}
