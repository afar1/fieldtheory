import type { ShapeId } from "../engine/types";

export function ShapeIcon({ kind, size = 20 }: { kind: ShapeId; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "rectangle" ? <rect x="4" y="5" width="16" height="14" rx="1" />
      : kind === "circle" ? <circle cx="12" cy="12" r="8" />
      : <path d="M5 19L19 5" />}
  </svg>;
}
