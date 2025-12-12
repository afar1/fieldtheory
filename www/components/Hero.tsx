import Link from 'next/link';

export default function Hero() {
  return (
    <section className="py-16 md:py-24">
      <div className="max-w-5xl mx-auto px-6 text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
          Field Theory
        </h1>
        <p className="text-muted text-lg mb-8">
          A privacy-first voice transcription and clipboard manager for Mac and iOS.
        </p>
        
        <p className="text-lg leading-relaxed mb-8">
          If you spend your day talking to AI—Cursor, ChatGPT, Claude—you know the friction. 
          Thoughts get lost between your head and the prompt box. Field Theory captures everything: 
          voice notes, screenshots, clipboard history. All processed locally. All searchable instantly.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link 
            href="/download"
            className="px-6 py-2.5 bg-[var(--foreground)] text-[var(--background)] rounded hover:opacity-80 transition-opacity"
          >
            Download for Mac
          </Link>
          <Link 
            href="/theories"
            className="px-6 py-2.5 border border-[var(--border)] rounded hover:bg-[#eee] transition-colors"
          >
            Read the Theory →
          </Link>
        </div>
      </div>
    </section>
  );
}
