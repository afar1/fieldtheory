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
    return { kind: 'selection', content: selectedText };
  }

  return null;
}
