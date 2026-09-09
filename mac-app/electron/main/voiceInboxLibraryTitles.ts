import type { LibraryRoot, WikiNode } from './librarianManager';
import type { VoiceInboxPresentation } from '../shared/voiceInboxPresentation';

/** Display metadata only: keep note paths, contents, and the cached Library tree intact. */
export function applyVoiceInboxTitles(roots: LibraryRoot[], presentation: VoiceInboxPresentation | null): LibraryRoot[] {
  if (!presentation?.notes.length) return roots;
  const titles = new Map(presentation.notes.map(note => [note.notePath, note.title]));
  const visit = (node: WikiNode): WikiNode => {
    if (node.kind === 'file') {
      const title = titles.get(node.absPath);
      return title ? { ...node, title } : node;
    }
    return { ...node, children: node.children.map(visit) };
  };
  return roots.map(root => ({ ...root, tree: root.tree.map(visit) }));
}
