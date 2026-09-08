import { useEffect, useRef, useState } from "react";
import css from "./Toolbar.module.css";

/** Whether the browser can sample a colour from the screen. */
export function supportsEyeDropper() {
  return typeof window !== "undefined" && "EyeDropper" in window;
}

type Picker = new () => {
  open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }>;
};

/** Whether the native picker is already up, so it can't be opened twice. */
let picking = false;

/** Sample a colour from anywhere on screen. */
export async function pickFromScreen(): Promise<string | null> {
  if (picking) return null;
  const EyeDropper = (window as unknown as { EyeDropper?: Picker }).EyeDropper;
  if (!EyeDropper) return null;

  picking = true;
  const abort = new AbortController();
  const cancel = () => abort.abort();
  window.addEventListener("blur", cancel, { once: true });
  document.addEventListener("visibilitychange", cancel, { once: true });

  try {
    const { sRGBHex } = await new EyeDropper().open({ signal: abort.signal });
    return sRGBHex;
  } catch {
    return null;
  } finally {
    picking = false;
    window.removeEventListener("blur", cancel);
    document.removeEventListener("visibilitychange", cancel);
  }
}

/** Expand `#abc` to `#aabbcc`; returns null for anything that isn't a colour. */
function normalise(input: string): string | null {
  const hex = input.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(hex)) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
  }
  if (/^[\da-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  return null;
}

/** A hex code you can type into. */
export function HexField({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [text, setText] = useState(value);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(value);
  }, [value]);

  return (
    <span className={css.hex}>
      <span aria-hidden>#</span>
      <input
        value={text.replace(/^#/, "").toUpperCase()}
        spellCheck={false}
        autoComplete="off"
        inputMode="text"
        maxLength={6}
        aria-label="Hex colour"
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const parsed = normalise(next);
          if (parsed) onChange(parsed);
        }}
        onBlur={() => {
          editing.current = false;
          setText(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          // The tray listens for single-key tool shortcuts on the window, so a
          // hex code typed in here would also change the pen out from under it.
          e.stopPropagation();
        }}
      />
    </span>
  );
}
