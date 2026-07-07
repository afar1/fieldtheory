# Typedown Viability Plan

## Goal

Typedown is a gated native/AppKit Markdown editor experiment for Field Theory. It is a candidate replacement for the current CodeMirror rendered presentation, not a direct replacement yet.

The first slice only proves mode plumbing and assessment quality. It does not clone `swift-markdown-engine`, add a Swift dependency, or switch user editing behavior.

## Upstream Assessment

- Repository: https://github.com/nodes-app/swift-markdown-engine
- Current GitHub API state checked on 2026-05-17: public repo, default branch `main`, created 2026-04-28, pushed 2026-05-16, latest release `0.4.0` published 2026-05-12.
- Main license: Apache-2.0, which permits commercial use with notice/license obligations.
- Core package product: `MarkdownEngine`, macOS 14+, TextKit 2/AppKit-backed Swift Markdown editor.
- Core dependency claim verified from `Package.swift`: the core target has no external target dependencies.
- Optional products:
  - `MarkdownEngineCodeBlocks` depends on `HighlighterSwift`.
  - `MarkdownEngineLatex` depends on `SwiftMath`.

## Dependency License Notes

- `HighlighterSwift`: MIT plus bundled Highlight.js BSD-3-Clause notices.
- `SwiftMath`: MIT, with bundled math font notices in its package.
- Recommendation for the first Field Theory spike: use only the core `MarkdownEngine` product. Do not include `MarkdownEngineCodeBlocks`, `MarkdownEngineLatex`, `HighlighterSwift`, or `SwiftMath` until the base editing contract is proven.

## Security Notes

Checks performed before integration:

- GitHub security advisories API returned zero advisories for `nodes-app/swift-markdown-engine`, `smittytone/HighlighterSwift`, and `mgriebling/SwiftMath`.
- OSV queries returned no known vulnerability records for `swift-markdown-engine` `0.4.0`, `HighlighterSwift` `3.0.3`, and `SwiftMath` `1.7.3`.
- Static raw-file inspection found no shell/process launching, Keychain use, `URLSession`, `WKWebView`, or network-fetch path in `swift-markdown-engine`.
- Risky behavior to decide explicitly: its paste handler can read pasted local `.md` and `.txt` file URLs into the editor. Field Theory should either adopt that behavior deliberately or override paste handling at the host adapter layer.
- Optional syntax highlighting uses HighlighterSwift, which bundles Highlight.js and runs through JavaScriptCore. That is not needed for the first Typedown viability pass.

## Field Theory Surfaces

Current surfaces inspected:

- `mac-app/src/components/LibrarianView.tsx`: Library editor orchestration, persisted editor session, launcher-open content mode handling, keyboard mode cycling.
- `mac-app/src/components/ContentModeToggleButton.tsx`: shared rendered/markdown toggle, now typed for three modes while `typedown` remains hidden.
- `mac-app/src/components/MarkdownCodeEditor.tsx`: current CodeMirror source editor and rendered presentation owner.
- `mac-app/src/commandLauncherUtils.ts`: launcher/open-target content mode type.
- `mac-app/electron/preload.ts`, `mac-app/electron/main/index.ts`, `mac-app/src/types/window.d.ts`: IPC/open-target type surfaces.
- `mac-app/electron/native/Package.swift`: native Swift package surface. No Typedown dependency was added.

## Current Spike State

- Added a shared `MarkdownContentMode` union: `rendered`, `markdown`, `typedown`.
- Added mode helpers that keep `typedown` unavailable unless a hidden flag enables it.
- Added `FEATURE_TYPEDOWN_ENABLED = false`.
- Updated the shared toggle and keyboard cycle to understand Typedown without exposing it by default.
- Updated persisted editor session and open-target types to recognize `typedown`.
- Added focused tests for mode cycling and persisted Typedown session parsing.

## Viability Checklist

| Contract | CodeMirror rendered v2 today | Typedown must prove |
| --- | --- | --- |
| Source of truth | Markdown string owned by React/CodeMirror path | Same markdown string, no rich-text-only state |
| Wiki links | Field Theory link classification and command-click/open behavior | Native resolver maps Field Theory wiki/artifact/command/external targets exactly |
| Tasks | Source-line task toggles and checked-state rendering | Checkbox clicks update source markdown line safely |
| Local images | `ftlocalfile`/local media path rules and paste archive flow | Host image adapter only resolves approved local/library media |
| Paste | Event payload-first image paste in current renderer | Native paste adapter must not reread or import unexpected file contents without policy |
| Undo | CodeMirror/editor undo plus Field Theory save state | Per-document native undo must not leak across file switches |
| Save conflicts | Existing conflict guard remains product policy | Native text changes still go through the same save/conflict path |
| Scroll room | Linked section and bottom scroll room behavior preserved | Native scroll container matches Library layout contract |
| Source editing | Markdown mode remains available and unchanged | Typedown cannot remove or weaken source mode |
| Performance | Current renderer has diagnostics and fps sampling | Native spike must compare long-note typing, paste, and scroll latency |

## Next Slice

Build a standalone native proof before wiring the Electron app to it:

1. Add a separate Swift Package or native sample target outside the production app bundle.
2. Pin `swift-markdown-engine` to an exact tag or revision.
3. Import only `MarkdownEngine`.
4. Load a fixed local markdown fixture set covering frontmatter, blank lines, wiki links, tasks, local images, code fences, and long notes.
5. Implement no-op or cached Field Theory-style service adapters for wiki links and images.
6. Record behavior gaps against the checklist above.
7. Only after the native sample passes the checklist, decide whether Typedown belongs in the Electron app via a native bridge or in the longer-term native app path.
