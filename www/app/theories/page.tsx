import Link from 'next/link';

const theories = [
  {
    slug: 'personal-management-system',
    title: 'Building a Second Brain with Local AI',
    date: 'December 12, 2025',
    excerpt: 'How to leverage local transcription and clipboard history to create a frictionless personal management system.',
  },
  {
    slug: 'privacy-first-design',
    title: 'Why We Bet on Local Processing',
    date: 'November 28, 2025',
    excerpt: 'The trade-offs of local vs. cloud AI, and why privacy is the ultimate feature.',
  },
  {
    slug: 'field-theory-manifesto',
    title: 'The Field Theory Manifesto',
    date: 'November 15, 2025',
    excerpt: 'Simplifying the toolchain for the modern creative engineer.',
  },
];

export default function Theories() {
  return (
    <div className="py-24 max-w-5xl mx-auto px-6">
      <div className="mb-16">
        <h1 className="text-4xl font-bold mb-4">Theories</h1>
        <p className="text-xl text-muted">Thoughts on productivity, AI, and design.</p>
      </div>

      <div className="space-y-12">
        {theories.map((theory) => (
          <article key={theory.slug} className="group relative border-b border-subtle pb-12 last:border-0">
            <time className="text-sm text-muted mb-2 block">{theory.date}</time>
            <h2 className="text-2xl font-bold mb-3 group-hover:text-[var(--accent)] transition-colors">
              <Link href={`/theories/${theory.slug}`}>
                {theory.title}
              </Link>
            </h2>
            <p className="text-muted leading-relaxed mb-4">
              {theory.excerpt}
            </p>
            <Link 
              href={`/theories/${theory.slug}`}
              className="text-sm font-medium text-[var(--accent)] hover:opacity-70 transition-opacity"
            >
              Read more →
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
