import {
  getMarkdownEditorLinkHits,
  getMarkdownLinkedDocuments,
  getWikiLinkTargetKey,
  type MarkdownLinkRelationDocument,
  type WikiIndex,
  type WikiLinkTarget,
} from './wikiLinks';

/** Reverse edges retain the full loader's document order and first-hit rules. */
export class MarkdownLinkRelationIndex {
  private documents = new Map<string, MarkdownLinkRelationDocument>();
  private positions = new Map<string, number>();
  private outgoing = new Map<string, Set<string>>();
  private incoming = new Map<string, Set<string>>();
  private index?: WikiIndex;
  private lastDocuments?: MarkdownLinkRelationDocument[];

  update(documents: MarkdownLinkRelationDocument[], index: WikiIndex): void {
    if (this.lastDocuments === documents && this.index === index) return;
    this.lastDocuments = documents;
    const next = new Map(documents.map((doc) => [getWikiLinkTargetKey(doc.target), doc]));
    for (const [key, previous] of this.documents) {
      if (!next.has(key) || next.get(key) !== previous || this.index !== index) {
        for (const target of this.outgoing.get(key) ?? []) {
          const sources = this.incoming.get(target);
          sources?.delete(key);
          if (sources?.size === 0) this.incoming.delete(target);
        }
        this.outgoing.delete(key);
      }
    }
    for (const [key, doc] of next) {
      if (this.outgoing.has(key)) continue;
      const targets = new Set<string>();
      for (const hit of doc.linkHits ?? getMarkdownEditorLinkHits(doc.content, index)) {
        const action = hit.action;
        if (action.kind !== 'wiki' && action.kind !== 'artifact' && action.kind !== 'command' && action.kind !== 'bookmarks') continue;
        targets.add(getWikiLinkTargetKey(action));
      }
      this.outgoing.set(key, targets);
      for (const target of targets) {
        let sources = this.incoming.get(target);
        if (!sources) this.incoming.set(target, sources = new Set());
        sources.add(key);
      }
    }
    this.documents = next;
    this.positions = new Map([...next.keys()].map((key, position) => [key, position]));
    this.index = index;
  }

  getLinks(source: WikiLinkTarget | null, content: string, index: WikiIndex) {
    const keys = new Set(source ? this.incoming.get(getWikiLinkTargetKey(source)) : []);
    for (const hit of getMarkdownEditorLinkHits(content, index)) {
      const action = hit.action;
      if (action.kind === 'wiki' || action.kind === 'artifact' || action.kind === 'command' || action.kind === 'bookmarks') {
        keys.add(getWikiLinkTargetKey(action));
      }
    }
    const relevant = [...keys]
      .filter((key) => this.documents.has(key))
      .sort((left, right) => this.positions.get(left)! - this.positions.get(right)!)
      .map((key) => this.documents.get(key)!);
    return getMarkdownLinkedDocuments(source, content, relevant, index);
  }
}
