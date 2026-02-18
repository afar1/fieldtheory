import { describe, it, expect } from 'vitest';
import { parseSSHDestination } from '../../electron/main/sshDetector';

describe('parseSSHDestination', () => {
  it('parses simple user@host', () => {
    expect(parseSSHDestination('ssh user@example.com')).toBe('user@example.com');
  });

  it('parses hostname without user', () => {
    expect(parseSSHDestination('ssh myserver')).toBe('myserver');
  });

  it('skips -p and -i flags with arguments', () => {
    expect(parseSSHDestination('ssh -p 2222 -i ~/.ssh/key user@host')).toBe('user@host');
  });

  it('skips boolean flags like -v -A', () => {
    expect(parseSSHDestination('ssh -v -A user@host')).toBe('user@host');
  });

  it('skips -o flag with argument', () => {
    expect(parseSSHDestination('ssh -o StrictHostKeyChecking=no user@host')).toBe('user@host');
  });

  it('handles full path to ssh binary', () => {
    expect(parseSSHDestination('/usr/bin/ssh user@host')).toBe('user@host');
  });

  it('parses ssh:// URI', () => {
    expect(parseSSHDestination('ssh ssh://user@host:22')).toBe('user@host');
  });

  it('handles -J jump host and extracts final destination', () => {
    expect(parseSSHDestination('ssh -J jump@bastion user@target')).toBe('user@target');
  });

  it('returns null for -V (no destination)', () => {
    expect(parseSSHDestination('ssh -V')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSSHDestination('')).toBeNull();
  });

  it('returns null for non-ssh commands', () => {
    expect(parseSSHDestination('scp file user@host:/tmp')).toBeNull();
  });

  it('handles multiple -o flags', () => {
    expect(parseSSHDestination('ssh -o BatchMode=yes -o ConnectTimeout=3 user@host')).toBe('user@host');
  });

  it('parses ssh:// URI without user', () => {
    expect(parseSSHDestination('ssh ssh://myhost:22')).toBe('myhost');
  });

  it('extracts destination when remote command follows', () => {
    expect(parseSSHDestination('ssh user@host ls -la')).toBe('user@host');
  });
});
