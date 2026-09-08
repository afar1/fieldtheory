import css from "./TrashIcon.module.css";

/** A small round bin with a lid that hops off when you go near it. */
export function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={css.icon}
    >
      {/* Open-topped bucket, rounded at the bottom */}
      <path d="M4.9 7.5v3.9a2.3 2.3 0 0 0 2.3 2.3h1.6a2.3 2.3 0 0 0 2.3-2.3V7.5" />

      <g className={css.lid}>
        <path d="M3.5 5.6h9" />
        <path d="M6.8 5.6V4.5a1.2 1.2 0 0 1 1.2-1.2 1.2 1.2 0 0 1 1.2 1.2v1.1" />
      </g>
    </svg>
  );
}
