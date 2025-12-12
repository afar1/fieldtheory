import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="py-8 border-t border-subtle">
      <div className="max-w-5xl mx-auto px-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted">
          <p>© {new Date().getFullYear()} Field Theory</p>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-[var(--foreground)] transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[var(--foreground)] transition-colors">
              Terms
            </Link>
            <Link href="/theories" className="hover:text-[var(--foreground)] transition-colors">
              Theories
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
