// @vitest-environment node
import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

it('uses the configured userData at write time even when launched from /', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-resize-persistence-'));
  let userData = '/not-yet-configured';
  try {
    const snippets = [
      source.match(/const getRenderedEditorDebugLogPath = .*;/)![0],
      source.slice(source.indexOf('function writeJsonlDiagnosticLog('), source.indexOf('function clearJsonlDiagnosticLog(')),
      source.slice(source.indexOf('function writeRenderedEditorDebugLog('), source.indexOf('function clearRenderedEditorDebugLog(')),
    ].join('\n');
    const context = vm.createContext({ fs, path, app: { getPath: () => userData }, process: { cwd: () => '/' } });
    vm.runInContext(ts.transpile(snippets), context);
    userData = directory;
    const result = vm.runInContext('writeRenderedEditorDebugLog({ stage: "resize-capture" })', context);
    expect(result.ok).toBe(true);
    expect(result.path).toBe(path.join(directory, 'diagnostics', 'rendered-editor-debug.jsonl'));
    expect(JSON.parse(fs.readFileSync(result.path, 'utf8')).entry.stage).toBe('resize-capture');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
