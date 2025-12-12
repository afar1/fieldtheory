import Link from 'next/link';

export default function Navbar() {
  return (
    <nav className="py-4 border-b border-subtle">
      <div className="max-w-5xl mx-auto px-6 flex items-center justify-between">
        <Link 
          href="/" 
          className="font-bold text-lg tracking-tight hover:opacity-70 transition-opacity"
        >
          Field Theory
        </Link>
        <Link 
          href="/download"
          className="px-4 py-1.5 text-sm bg-[var(--foreground)] text-[var(--background)] rounded hover:opacity-80 transition-opacity"
        >
          Download
        </Link>
      </div>
    </nav>
  );
}
