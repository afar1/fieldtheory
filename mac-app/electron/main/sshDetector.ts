import { execFile } from 'child_process';
import os from 'os';
import path from 'path';
import { createLogger } from './logger';

const log = createLogger('sshDetector');

export interface SSHTarget {
  destination: string; // user@host or just host
  pid: number;
}

// Flags that consume the next argument
const SSH_FLAGS_WITH_ARGS = new Set([
  '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L',
  '-l', '-m', '-O', '-o', '-p', '-Q', '-R', '-S', '-W', '-w',
]);

export function parseSSHDestination(cmdLine: string): string | null {
  const parts = cmdLine.trim().split(/\s+/);
  if (parts.length === 0) return null;

  // First part should be ssh or /path/to/ssh
  const binary = parts[0];
  const baseName = binary.includes('/') ? binary.split('/').pop() : binary;
  if (baseName !== 'ssh') return null;

  let i = 1;
  while (i < parts.length) {
    const arg = parts[i];

    // Handle ssh:// URIs
    if (arg.startsWith('ssh://')) {
      try {
        const url = new URL(arg);
        const host = url.hostname;
        const user = url.username;
        return user ? `${user}@${host}` : host;
      } catch {
        return null;
      }
    }

    // Flags with arguments: skip the flag and its value
    if (SSH_FLAGS_WITH_ARGS.has(arg)) {
      i += 2;
      continue;
    }

    // Boolean flags (single dash + letters, no argument consumed)
    if (arg.startsWith('-')) {
      i++;
      continue;
    }

    // First non-flag argument is the destination
    return arg;
  }

  return null;
}

// BFS through process tree from terminalPid to find a descendant SSH process
export async function detectSSHSession(terminalPid: number): Promise<SSHTarget | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 2000);

    execFile('ps', ['-eo', 'pid=,ppid=,command='], { maxBuffer: 1024 * 1024 }, (err: Error | null, stdout: string) => {
      clearTimeout(timeout);
      if (err) {
        log.error('Failed to list processes:', err);
        resolve(null);
        return;
      }

      try {
        // Build parent→children map
        const children = new Map<number, number[]>();
        const commands = new Map<number, string>();

        for (const line of stdout.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
          if (!match) continue;

          const pid = parseInt(match[1], 10);
          const ppid = parseInt(match[2], 10);
          const cmd = match[3];

          if (!children.has(ppid)) children.set(ppid, []);
          children.get(ppid)!.push(pid);
          commands.set(pid, cmd);
        }

        // BFS from terminalPid to find SSH processes
        const queue = children.get(terminalPid) || [];
        const visited = new Set<number>([terminalPid]);

        while (queue.length > 0) {
          const pid = queue.shift()!;
          if (visited.has(pid)) continue;
          visited.add(pid);

          const cmd = commands.get(pid);
          if (cmd) {
            const dest = parseSSHDestination(cmd);
            if (dest !== null) {
              resolve({ destination: dest, pid });
              return;
            }
          }

          const childPids = children.get(pid) || [];
          for (const childPid of childPids) {
            if (!visited.has(childPid)) {
              queue.push(childPid);
            }
          }
        }

        resolve(null);
      } catch (e) {
        log.error('Error parsing process tree:', e);
        resolve(null);
      }
    });
  });
}

// SCP file to remote /tmp/. Returns remote path or null on failure.
export async function scpToRemote(localPath: string, sshDestination: string): Promise<string | null> {
  const timestamp = Date.now();
  const ext = path.extname(localPath) || '.png';
  const remotePath = `/tmp/ft-${timestamp}${ext}`;

  // If destination has no user@, default to current user (matches ssh behavior)
  const scpDest = sshDestination.includes('@')
    ? sshDestination
    : `${os.userInfo().username}@${sshDestination}`;

  return new Promise((resolve) => {
    execFile('scp', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=3',
      localPath,
      `${scpDest}:${remotePath}`,
    ], { timeout: 5000 }, (err: Error | null) => {
      if (err) {
        log.warn('SCP failed for', scpDest, err.message);
        resolve(null);
        return;
      }
      resolve(remotePath);
    });
  });
}
