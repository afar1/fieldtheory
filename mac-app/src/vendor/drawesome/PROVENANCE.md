# Drawesome source provenance

Vendored `packages/draw/src` from https://github.com/benjitaylor/drawesome
commit `8fb08e93433e2cda32e265280371a0551b3c13a7` (package 0.1.1).
Vendored to pin the exact reviewed source; React 18 peers, no runtime dependencies.
MIT copyright notice is retained in LICENSE. Field Theory integration lives outside this directory.

Compatibility patch: Tooltip.tsx timer parameter uses MutableRefObject for React 18 type definitions (no runtime change).

Formatting-only patch: removed trailing whitespace on one DrawSurface.tsx blank line.
