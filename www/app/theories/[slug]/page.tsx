import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

const theories = {
  'personal-management-system': {
    title: 'Building a Second Brain with Local AI',
    date: 'December 12, 2025',
    content: `
      <p class="mb-6">The modern knowledge worker is drowning in context. We switch between Slack, Zoom, code editors, and browsers hundreds of times a day. We lose thoughts in the cracks between apps.</p>
      <p class="mb-6">Field Theory attempts to solve this by creating a unified layer of memory across your operating system. By indexing your clipboard and transcribing your voice notes locally, we create a searchable archive of your digital life.</p>
      <h3 class="text-2xl font-bold mt-8 mb-4">The Local Advantage</h3>
      <p class="mb-6">Processing this data locally isn't just a privacy feature—it's a performance feature. Latency is zero. Availability is 100%. You don't need an internet connection to recall what you copied three hours ago.</p>
    `
  },
  'privacy-first-design': {
    title: 'Why We Bet on Local Processing',
    date: 'November 28, 2025',
    content: `
      <p class="mb-6">In an era where every keystroke is seemingly sent to the cloud, we chose a different path. We believe that the most personal data—your voice, your clipboard—should never leave your device without your explicit consent.</p>
      <p class="mb-6">With Apple Silicon's Neural Engine, we can now run powerful models like Whisper and Llama locally with minimal battery impact. This enables "AI" features without the "surveillance" baggage.</p>
    `
  },
  'field-theory-manifesto': {
    title: 'The Field Theory Manifesto',
    date: 'November 15, 2025',
    content: `
      <p class="mb-6">Tools should be extensions of the mind, not attention vampires. We are building Field Theory to be calm, fast, and invisible until you need it.</p>
    `
  }
};

export default async function TheoryPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const theory = theories[slug as keyof typeof theories];

  if (!theory) {
    notFound();
  }

  return (
    <div className="py-24 max-w-5xl mx-auto px-6">
      <Link 
        href="/theories"
        className="inline-flex items-center text-sm text-muted hover:text-[var(--foreground)] transition-colors mb-8"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Theories
      </Link>
      
      <article>
        <header className="mb-12">
          <time className="text-sm text-muted mb-4 block">{theory.date}</time>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
            {theory.title}
          </h1>
        </header>
        
        <div 
          className="text-muted leading-relaxed"
          dangerouslySetInnerHTML={{ __html: theory.content }}
        />
      </article>
    </div>
  );
}
