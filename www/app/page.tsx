import Hero from '@/components/Hero';
import FeatureSection from '@/components/FeatureSection';

export default function Home() {
  return (
    <div className="flex flex-col gap-10">
      <Hero />
      
      <FeatureSection
        title="Privacy by Default"
        description="Your voice data never leaves your device. Field Theory runs a local instance of Whisper on your Mac and iPhone, ensuring your conversations remain private. No cloud processing, no data mining."
        imageLeft={true}
        gradient="from-blue-600 via-purple-600 to-indigo-600"
      >
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
           <span className="text-gray-500 font-mono">Local Processing Visualization</span>
        </div>
      </FeatureSection>

      <FeatureSection
        title="Total Recall"
        description="A clipboard manager that actually remembers. Every text snippet, link, and image you copy is indexed and searchable. Recall that one link from three weeks ago in milliseconds."
        imageLeft={false}
        gradient="from-orange-500 via-red-500 to-pink-500"
      >
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
           <span className="text-gray-500 font-mono">Clipboard Search UI</span>
        </div>
      </FeatureSection>

      <FeatureSection
        title="Encrypted Sync"
        description="Seamlessly hand off between your Mac and iPhone. Your data is end-to-end encrypted, meaning only you hold the keys. We couldn't read your data even if we wanted to."
        imageLeft={true}
        gradient="from-emerald-500 via-teal-500 to-cyan-500"
      >
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
           <span className="text-gray-500 font-mono">Sync Animation</span>
        </div>
      </FeatureSection>

      <FeatureSection
        title="Prompt Stacking"
        description="Build context like a pro. Stack screenshots, code snippets, and text to create rich prompts for your AI workflows. It's context window management, reimagined."
        imageLeft={false}
        gradient="from-rose-500 via-fuchsia-500 to-purple-500"
      >
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
           <span className="text-gray-500 font-mono">Stacking Interface</span>
        </div>
      </FeatureSection>
    </div>
  );
}
