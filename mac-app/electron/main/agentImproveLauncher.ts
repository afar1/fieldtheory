import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type AgentImproveTool = 'codex' | 'claude';
export type AgentImproveContextKind = 'selection' | 'markdown-file';

export interface AgentImproveLaunchRequest {
  tool: AgentImproveTool;
  instruction: string;
  content: string;
  contextKind: AgentImproveContextKind;
  filePath?: string | null;
  title?: string | null;
  cwd?: string | null;
}

export interface AgentImproveLaunchResult {
  promptPath: string;
  command: string;
}

export function buildAgentImprovePrompt(request: AgentImproveLaunchRequest): string {
  const instruction = request.instruction.trim() || 'Improve this content.';
  const title = request.title?.trim();
  const filePath = request.filePath?.trim();
  const contextLabel = request.contextKind === 'markdown-file' ? 'Markdown file' : 'Selected text';

  return [
    instruction,
    '',
    'Context:',
    `- Type: ${contextLabel}`,
    ...(title ? [`- Title: ${title}`] : []),
    ...(filePath ? [`- File: ${filePath}`] : []),
    '',
    'Content:',
    '```markdown',
    request.content,
    '```',
    '',
    filePath
      ? 'Apply the requested improvement to the file when that is the right outcome. Otherwise explain what should change.'
      : 'Return the improved text or explain the edit clearly.',
  ].join('\n');
}

export function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildAgentImproveShellCommand(request: AgentImproveLaunchRequest, promptPath: string): string {
  const cwd = request.cwd?.trim() || (request.filePath ? path.dirname(request.filePath) : os.homedir());
  const toolCommand = request.tool === 'claude' ? 'claude' : 'codex';
  return [
    `cd ${quoteShellArg(cwd)}`,
    `${toolCommand} "$(cat ${quoteShellArg(promptPath)})"`,
  ].join(' && ');
}

export function buildTerminalAppleScript(command: string): string {
  return [
    'tell application "Terminal"',
    '  activate',
    `  do script ${JSON.stringify(command)}`,
    'end tell',
  ].join('\n');
}

export async function launchAgentImproveInTerminal(
  request: AgentImproveLaunchRequest,
): Promise<AgentImproveLaunchResult> {
  const prompt = buildAgentImprovePrompt(request);
  const promptPath = path.join(os.tmpdir(), `fieldtheory-agent-improve-${Date.now()}.md`);
  await fs.writeFile(promptPath, prompt, 'utf8');

  const command = buildAgentImproveShellCommand(request, promptPath);
  await execFileAsync('osascript', ['-e', buildTerminalAppleScript(command)], { timeout: 5000 });
  return { promptPath, command };
}
