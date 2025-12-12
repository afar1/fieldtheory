import { Check } from 'lucide-react';
import Link from 'next/link';

export default function Pricing() {
  return (
    <div className="py-24 max-w-5xl mx-auto px-6">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold mb-4">Simple, transparent pricing</h1>
        <p className="text-xl text-muted">Choose the plan that fits your workflow.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        <div className="rounded border border-subtle bg-[#fafafa] p-8">
          <h2 className="text-2xl font-bold mb-2">Free</h2>
          <p className="text-muted mb-6">Essential tools for local productivity.</p>
          <div className="text-4xl font-bold mb-8">$0<span className="text-lg text-muted font-normal">/mo</span></div>
          
          <ul className="space-y-4 mb-8">
            <li className="flex items-start">
              <Check className="w-5 h-5 text-[var(--accent)] mr-3 shrink-0" />
              Local Whisper Transcription
            </li>
            <li className="flex items-start">
              <Check className="w-5 h-5 text-[var(--accent)] mr-3 shrink-0" />
              Clipboard History (7 days)
            </li>
            <li className="flex items-start">
              <Check className="w-5 h-5 text-[var(--accent)] mr-3 shrink-0" />
              Basic Prompt Stacking
            </li>
            <li className="flex items-start">
              <Check className="w-5 h-5 text-[var(--accent)] mr-3 shrink-0" />
              macOS Application
            </li>
          </ul>
          
          <Link 
            href="/download"
            className="block w-full py-3 text-center rounded border border-subtle font-medium hover:bg-[#eee] transition-colors"
          >
            Download Free
          </Link>
        </div>

        <div className="rounded border-2 border-[var(--accent)] bg-[#fafafa] p-8">
          <div className="inline-block px-3 py-1 bg-[var(--accent)] text-[var(--background)] rounded text-xs font-bold uppercase tracking-wider mb-4">
            Most Popular
          </div>
          <h2 className="text-2xl font-bold mb-2">Pro</h2>
          <p className="text-muted mb-6">Power features for serious workflows.</p>
          <div className="text-4xl font-bold mb-8">$10<span className="text-lg text-muted font-normal">/mo</span></div>
          
          <ul className="space-y-4 mb-8">
            <li className="flex items-start">
              <Check className="w-5 h-5 text-[var(--accent)] mr-3 shrink-0" />
              Unlimited Clipboard History
            </li>
            <li className="flex items-start">
              <Check className="w-5 h-5 text-[var(--accent)] mr-3 shrink-0" />
              iOS Sync & Mobile App
            </li>
            <li className="flex items-start">
              <Check className="w-5 h-5 text-[var(--accent)] mr-3 shrink-0" />
              Advanced Vision Models
            </li>
            <li className="flex items-start">
              <Check className="w-5 h-5 text-[var(--accent)] mr-3 shrink-0" />
              Priority Support
            </li>
          </ul>
          
          <button className="w-full py-3 rounded bg-[var(--foreground)] text-[var(--background)] font-medium hover:opacity-80 transition-opacity">
            Get Pro
          </button>
        </div>
      </div>
    </div>
  );
}
