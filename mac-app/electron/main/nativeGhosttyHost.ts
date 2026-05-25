import fs from 'fs';
import path from 'path';

export interface NativeGhosttyHost {
  probe: () => boolean;
  attachPlaceholder: (id: string, nativeWindowHandle: Buffer, x: number, y: number, width: number, height: number) => boolean;
  attachGhostty: (id: string, nativeWindowHandle: Buffer, x: number, y: number, width: number, height: number, cwd: string, command: string) => boolean;
  updateFrame: (id: string, x: number, y: number, width: number, height: number) => boolean;
  sendText: (id: string, text: string) => boolean;
  sendKey: (id: string, action: string, keyCode: number, text: string, unshiftedCodepoint: number, shift: boolean, ctrl: boolean, alt: boolean, meta: boolean, caps: boolean) => boolean;
  readText: (id: string) => string;
  detach: (id: string) => boolean;
}

export interface NativeGhosttyHostLoadResult {
  ok: boolean;
  modulePath: string | null;
  host: NativeGhosttyHost | null;
  error?: string;
}

export function nativeGhosttyHostCandidatePaths(appPath: string, dirname = __dirname): string[] {
  return [
    path.join(appPath, 'electron', 'native', 'build', 'ghostty-host.node'),
    path.resolve(dirname, '..', 'native', 'build', 'ghostty-host.node'),
    path.resolve(dirname, '..', '..', 'electron', 'native', 'build', 'ghostty-host.node'),
    path.join(process.resourcesPath ?? appPath, 'ghostty-host.node'),
  ];
}

export function loadNativeGhosttyHost(appPath: string, dirname = __dirname): NativeGhosttyHostLoadResult {
  const modulePath = nativeGhosttyHostCandidatePaths(appPath, dirname).find((candidate) => fs.existsSync(candidate));
  if (!modulePath) {
    return {
      ok: false,
      modulePath: null,
      host: null,
      error: 'Ghostty native host bridge is not built.',
    };
  }

  try {
    // Native addon is built by scripts/build-ghostty-host.sh.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const host = require(modulePath) as NativeGhosttyHost;
    return {
      ok: host.probe() === true,
      modulePath,
      host,
    };
  } catch (error) {
    return {
      ok: false,
      modulePath,
      host: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
