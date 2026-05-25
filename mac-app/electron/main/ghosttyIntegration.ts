import fs from 'fs';
import os from 'os';
import path from 'path';

export type GhosttyIntegrationStatus = 'ready' | 'missing-source' | 'missing-header' | 'missing-library' | 'missing-license';

export interface GhosttyIntegrationProbe {
  status: GhosttyIntegrationStatus;
  sourceDir: string | null;
  includeDir: string | null;
  vtHeaderPath: string | null;
  embeddingHeaderPath: string | null;
  kitFrameworkPath: string | null;
  kitMacosHeaderDir: string | null;
  kitMacosLibraryPath: string | null;
  libraryPath: string | null;
  licensePath: string | null;
  warnings: string[];
}

interface GhosttyIntegrationProbeOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

const GHOSTTY_VT_LIBRARY_NAMES = [
  'libghostty-vt.dylib',
  'libghostty-vt.0.dylib',
  'libghostty-vt.0.1.0.dylib',
];

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function firstExistingFile(candidates: string[]): string | null {
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function firstExistingDirectory(candidates: string[]): string | null {
  return candidates.find((candidate) => isDirectory(candidate)) ?? null;
}

function readHeaderWarnings(headerPath: string | null): string[] {
  if (!headerPath) return [];
  try {
    const header = fs.readFileSync(headerPath, 'utf8');
    const warnings: string[] = [];
    if (header.includes('not yet stable')) {
      warnings.push('libghostty-vt API is not yet stable; expect breaking changes.');
    }
    if (header.includes("isn't meant to be a general purpose embedding API")) {
      warnings.push('Full libghostty embedding API is not documented as general-purpose yet.');
    }
    return warnings;
  } catch {
    return [];
  }
}

export function probeGhosttyIntegration(options: GhosttyIntegrationProbeOptions = {}): GhosttyIntegrationProbe {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const sourceDir = firstExistingDirectory([
    env.GHOSTTY_SOURCE_DIR ?? '',
    path.join(homeDir, 'dev', 'ghostty'),
  ].filter(Boolean));

  if (!sourceDir) {
    return {
      status: 'missing-source',
      sourceDir: null,
      includeDir: null,
      vtHeaderPath: null,
      embeddingHeaderPath: null,
      kitFrameworkPath: null,
      kitMacosHeaderDir: null,
      kitMacosLibraryPath: null,
      libraryPath: null,
      licensePath: null,
      warnings: ['Set GHOSTTY_SOURCE_DIR to a local Ghostty checkout.'],
    };
  }

  const includeDir = firstExistingDirectory([
    path.join(sourceDir, 'zig-out', 'include'),
    path.join(sourceDir, 'include'),
  ]);
  const vtHeaderPath = includeDir ? path.join(includeDir, 'ghostty', 'vt.h') : null;
  const embeddingHeaderPath = firstExistingFile([
    path.join(sourceDir, 'zig-out', 'include', 'ghostty.h'),
    path.join(sourceDir, 'include', 'ghostty.h'),
    path.join(sourceDir, 'macos', 'GhosttyKit.xcframework', 'macos-arm64_x86_64', 'Headers', 'ghostty.h'),
  ]);
  const kitFrameworkPath = firstExistingDirectory([
    path.join(sourceDir, 'macos', 'GhosttyKit.xcframework'),
  ]);
  const kitMacosHeaderDir = kitFrameworkPath
    ? firstExistingDirectory([path.join(kitFrameworkPath, 'macos-arm64_x86_64', 'Headers')])
    : null;
  const kitMacosLibraryPath = kitFrameworkPath
    ? firstExistingFile([path.join(kitFrameworkPath, 'macos-arm64_x86_64', 'libghostty.a')])
    : null;
  const libraryPath = firstExistingFile(GHOSTTY_VT_LIBRARY_NAMES.map((name) => path.join(sourceDir, 'zig-out', 'lib', name)));
  const licensePath = firstExistingFile([
    path.join(sourceDir, 'LICENSE'),
    path.join(sourceDir, 'LICENSE.md'),
  ]);
  const warnings = [
    ...readHeaderWarnings(vtHeaderPath),
    ...readHeaderWarnings(embeddingHeaderPath),
  ];

  if (!includeDir || !vtHeaderPath || !fs.existsSync(vtHeaderPath)) {
    return { status: 'missing-header', sourceDir, includeDir, vtHeaderPath, embeddingHeaderPath, kitFrameworkPath, kitMacosHeaderDir, kitMacosLibraryPath, libraryPath, licensePath, warnings };
  }
  if (!libraryPath) {
    return { status: 'missing-library', sourceDir, includeDir, vtHeaderPath, embeddingHeaderPath, kitFrameworkPath, kitMacosHeaderDir, kitMacosLibraryPath, libraryPath, licensePath, warnings };
  }
  if (!licensePath) {
    return { status: 'missing-license', sourceDir, includeDir, vtHeaderPath, embeddingHeaderPath, kitFrameworkPath, kitMacosHeaderDir, kitMacosLibraryPath, libraryPath, licensePath, warnings };
  }

  return { status: 'ready', sourceDir, includeDir, vtHeaderPath, embeddingHeaderPath, kitFrameworkPath, kitMacosHeaderDir, kitMacosLibraryPath, libraryPath, licensePath, warnings };
}
