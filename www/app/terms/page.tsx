export default function Terms() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
      <h1 className="text-4xl font-bold text-white mb-8">Terms of Service</h1>
      
      <div className="prose prose-invert prose-lg">
        <p className="lead text-xl text-gray-300 mb-8">
          We want these terms to be fair and easy to understand.
        </p>

        <section className="mb-12">
          <h2 className="text-2xl font-bold text-white mb-4">1. Usage</h2>
          <p className="text-gray-400">
            Field Theory is a productivity tool. You can use it for personal or commercial purposes. You are responsible for the content you process with the tool.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-bold text-white mb-4">2. License</h2>
          <p className="text-gray-400">
            We grant you a limited, non-exclusive, non-transferable license to download and use the software. You may not reverse engineer or redistribute the software without our permission.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-bold text-white mb-4">3. Liability</h2>
          <p className="text-gray-400">
            The software is provided "as is". We are not liable for any damages arising from your use of the software (e.g., data loss). Please backup your data regularly.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-bold text-white mb-4">4. Subscriptions</h2>
          <p className="text-gray-400">
            Pro features require a subscription. You can cancel at any time. Refunds are handled on a case-by-case basis.
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
