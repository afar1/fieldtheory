import Hero from '@/components/Hero';
import FeatureSection from '@/components/FeatureSection';

export default function Home() {
  return (
    <div>
      <Hero />
      
      <FeatureSection
        title="Local Transcription"
        problem="Cloud transcription services see everything you say. That's a privacy nightmare for sensitive work."
        description="Field Theory runs Whisper locally on your Mac and iPhone. Your voice data never leaves your device. No cloud processing, no data mining, no monthly API bills."
        visual={
          <div className="text-[var(--muted)]">
            <div className="mb-2 text-xs text-muted">whisper.local</div>
            <div>→ Audio captured</div>
            <div>→ Processed on-device</div>
            <div>→ Text stored locally</div>
            <div className="mt-2 text-[var(--accent)]">✓ Never leaves your Mac</div>
          </div>
        }
      />

      <FeatureSection
        title="Clipboard History"
        problem="You copied something important an hour ago. Now it's gone forever."
        description="Every text snippet, link, and image you copy is indexed and searchable. Recall that one link from three weeks ago in milliseconds. It's Total Recall for your clipboard."
        reversed
        visual={
          <div className="text-[var(--muted)]">
            <div className="mb-2 text-xs text-muted">clipboard.db</div>
            <div>001: https://example.com/...</div>
            <div>002: const data = fetch(...</div>
            <div>003: Meeting notes from...</div>
            <div className="mt-2">⌘+Shift+V to search</div>
          </div>
        }
      />

      <FeatureSection
        title="Prompt Stacking"
        problem="Building context for AI prompts is tedious. Screenshots, code, notes—scattered everywhere."
        description="Stack screenshots, code snippets, and text to create rich prompts for your AI workflows. Select multiple items, combine them, paste into Cursor or ChatGPT. Context window management, reimagined."
        visual={
          <div className="text-[var(--muted)]">
            <div className="mb-2 text-xs text-muted">stack.json</div>
            <div>[1] screenshot.png</div>
            <div>[2] error_log.txt</div>
            <div>[3] "Fix this bug..."</div>
            <div className="mt-2">→ Combined prompt ready</div>
          </div>
        }
      />

      <FeatureSection
        title="Mac ↔ iPhone Sync"
        problem="Voice notes on your phone. Work on your Mac. No easy way to connect them."
        description="Capture voice notes on your iPhone during your commute. They appear in your Mac clipboard history automatically. End-to-end encrypted—we can't read your data even if we wanted to."
        reversed
        visual={
          <div className="text-[var(--muted)]">
            <div className="mb-2 text-xs text-muted">sync</div>
            <div>iPhone → encrypted → Mac</div>
            <div className="mt-2 text-[var(--accent)]">✓ E2E encrypted</div>
            <div className="text-[var(--accent)]">✓ Automatic</div>
          </div>
        }
      />
    </div>
  );
}
