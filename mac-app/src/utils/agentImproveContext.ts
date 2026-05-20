export type AgentImproveContextKind = 'selection' | 'markdown-file';

export interface AgentImproveContext {
  kind: AgentImproveContextKind;
  content: string;
  filePath?: string | null;
  title?: string | null;
}

function textareaSelection(textarea: HTMLTextAreaElement): string {
  return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
}

function closestAgentContextElement(node: Node | null): HTMLElement | null {
  const element = node instanceof HTMLElement
    ? node
    : node?.parentElement ?? null;
  return element?.closest<HTMLElement>('[data-ft-agent-file-path]') ?? null;
}

export function getAgentImproveContext(doc: Document = document): AgentImproveContext | null {
  const active = doc.activeElement;
  const TextAreaCtor = doc.defaultView?.HTMLTextAreaElement;

  if (TextAreaCtor && active instanceof TextAreaCtor) {
    const selectedText = textareaSelection(active).trim();
    if (selectedText) {
      return {
        kind: 'selection',
        content: textareaSelection(active),
        filePath: active.dataset.ftAgentFilePath || null,
        title: active.dataset.ftAgentTitle || null,
      };
    }

    if (active.dataset.ftAgentContext === 'markdown' && active.value.trim()) {
      return {
        kind: 'markdown-file',
        content: active.value,
        filePath: active.dataset.ftAgentFilePath || null,
        title: active.dataset.ftAgentTitle || null,
      };
    }
  }

  const selectedText = doc.getSelection?.()?.toString();
  if (selectedText?.trim()) {
    const selection = doc.getSelection?.();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const contextElement = closestAgentContextElement(range?.commonAncestorContainer ?? null)
      ?? closestAgentContextElement(selection?.anchorNode ?? null)
      ?? closestAgentContextElement(selection?.focusNode ?? null);
    return {
      kind: 'selection',
      content: selectedText,
      filePath: contextElement?.dataset.ftAgentFilePath || null,
      title: contextElement?.dataset.ftAgentTitle || null,
    };
  }

  return null;
}
