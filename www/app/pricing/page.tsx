import { Check } from 'lucide-react';

export default function Pricing() {
  return (
    <div className="py-24 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold text-white mb-4">Simple, transparent pricing</h1>
        <p className="text-xl text-gray-400">Choose the plan that fits your workflow.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {/* Free Tier */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 hover:border-white/20 transition-colors">
          <h2 className="text-2xl font-bold text-white mb-2">Free</h2>
          <p className="text-gray-400 mb-6">Essential tools for local productivity.</p>
          <div className="text-4xl font-bold text-white mb-8">$0<span className="text-lg text-gray-500 font-normal">/mo</span></div>
          
          <ul className="space-y-4 mb-8">
            <li className="flex items-start text-gray-300">
              <Check className="w-5 h-5 text-green-500 mr-3 shrink-0" />
              Local Whisper Transcription
            </li>
            <li className="flex items-start text-gray-300">
              <Check className="w-5 h-5 text-green-500 mr-3 shrink-0" />
              Clipboard History (7 days)
            </li>
            <li className="flex items-start text-gray-300">
              <Check className="w-5 h-5 text-green-500 mr-3 shrink-0" />
              Basic Prompt Stacking
            </li>
            <li className="flex items-start text-gray-300">
              <Check className="w-5 h-5 text-green-500 mr-3 shrink-0" />
              macOS Application
            </li>
          </ul>
          
          <button className="w-full py-3 rounded-full border border-white/20 text-white font-medium hover:bg-white/10 transition-colors">
            Download Free
          </button>
        </div>

        {/* Pro Tier */}
        <div className="relative rounded-2xl border border-purple-500/50 bg-gradient-to-b from-purple-500/10 to-transparent p-8">
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-purple-600 rounded-full text-xs font-bold text-white uppercase tracking-wider">
            Most Popular
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Pro</h2>
          <p className="text-gray-400 mb-6">Power features for serious workflows.</p>
          <div className="text-4xl font-bold text-white mb-8">$10<span className="text-lg text-gray-500 font-normal">/mo</span></div>
          
          <ul className="space-y-4 mb-8">
            <li className="flex items-start text-white">
              <Check className="w-5 h-5 text-purple-400 mr-3 shrink-0" />
              Unlimited Clipboard History
            </li>
            <li className="flex items-start text-white">
              <Check className="w-5 h-5 text-purple-400 mr-3 shrink-0" />
              iOS Sync & Mobile App
            </li>
            <li className="flex items-start text-white">
              <Check className="w-5 h-5 text-purple-400 mr-3 shrink-0" />
              Advanced Vision Models
            </li>
            <li className="flex items-start text-white">
              <Check className="w-5 h-5 text-purple-400 mr-3 shrink-0" />
              Priority Support
            </li>
          </ul>
          
          <button className="w-full py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition-colors">
            Get Pro
          </button>
        </div>
      </div>
    </div>
  );
}
