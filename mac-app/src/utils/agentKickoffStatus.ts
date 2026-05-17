export type AgentKickoffFooterEvent = {
  runId: string;
  absPath: string;
  model: 'claude' | 'codex';
  status: 'started' | 'done' | 'error';
  message: string;
  error?: string;
};

export type AgentKickoffFooterStatus = {
  status: 'running' | 'success' | 'error' | 'notice';
  message: string;
  detail?: string;
  eventKind?: 'status' | 'model_output' | 'tool_call' | 'file_change' | 'error';
  commandName?: string;
  filePath?: string;
  runId?: string;
  error?: string;
  updatedAt: number;
};

function getAgentModelLabel(model: AgentKickoffFooterEvent['model']): string {
  return model === 'claude' ? 'Claude Code' : 'Codex';
}

function getFileName(absPath: string): string | undefined {
  const trimmed = absPath.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/[\\/]/).filter(Boolean).pop();
}

export function getAgentKickoffFooterStatus(
  event: AgentKickoffFooterEvent,
  updatedAt = Date.now(),
): AgentKickoffFooterStatus {
  const status = event.status === 'started'
    ? 'running'
    : event.status === 'done'
      ? 'success'
      : 'error';
  const fileName = getFileName(event.absPath);

  return {
    status,
    message: `${getAgentModelLabel(event.model)}: ${event.message}`,
    detail: fileName,
    eventKind: event.status === 'error' ? 'error' : 'status',
    commandName: 'agent',
    filePath: event.absPath,
    runId: event.runId,
    error: event.error,
    updatedAt,
  };
}
