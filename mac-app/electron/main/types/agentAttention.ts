export type AgentTool = 'claude' | 'codex';

export interface WaitingAgent {
  agentId: string;
  tool: AgentTool;
  pid: number;
  cwd: string;
  ttyTitle: string;
  terminalApp: string;
  waitingSince: number;
}
