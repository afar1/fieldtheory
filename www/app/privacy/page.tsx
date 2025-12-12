export default function Privacy() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
      <h1 className="text-4xl font-bold text-white mb-8">Privacy Policy</h1>
      
      <div className="prose prose-invert prose-lg">
        <p className="lead text-xl text-gray-300 mb-8">
          Field Theory is designed to be private by default. We believe your thoughts, conversations, and clipboard history belong to you, and only you.
        </p>

        <section className="mb-12">
          <h2 className="text-2xl font-bold text-white mb-4">1. Local Processing</h2>
          <p className="text-gray-400">
            All voice transcription happens locally on your device using the Whisper model. Your audio recordings are never sent to our servers for transcription. They are processed on your Mac or iPhone.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-bold text-white mb-4">2. Clipboard Data</h2>
          <p className="text-gray-400">
            Your clipboard history is stored in a local database on your device. We do not have access to this database. If you use the sync feature, your data is end-to-end encrypted before being synced between your devices.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-bold text-white mb-4">3. Data Collection</h2>
          <p className="text-gray-400">
            We collect minimal, anonymous usage data to help us improve the app (e.g., "app crashed" or "feature X used"). You can opt out of this at any time in the settings. We do not collect any personal content.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-bold text-white mb-4">4. AI Models</h2>
          <p className="text-gray-400">
            We do not use your data to train our models. The models we use are either pre-trained open-source models (like Whisper) or run locally. If you choose to use third-party LLM features (like Anthropic), your data is sent to them only when you explicitly trigger the feature, and is subject to their privacy policies.
          </p>
        </section>
        
        <div className="border-t border-white/10 pt-8 mt-16">
          <p className="text-sm text-gray-500">
            Last updated: December 12, 2025
          </p>
        </div>
      </div>
    </div>
  );
}
