import { Download, Package } from 'lucide-react';
import Link from 'next/link';

const releases = [
  {
    version: '0.1.18',
    date: 'Dec 12, 2025',
    notes: 'Initial public beta. Includes local Whisper and basic clipboard history.',
    downloadUrl: '#'
  },
  {
    version: '0.1.17',
    date: 'Dec 05, 2025',
    notes: 'Internal alpha release.',
    downloadUrl: '#'
  }
];

export default function DownloadPage() {
  return (
    <div className="py-24 max-w-5xl mx-auto px-6">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold mb-4">Download Field Theory</h1>
        <p className="text-xl text-muted mb-8">Get the latest version for macOS.</p>
        
        <Link 
          href="#"
          className="inline-flex items-center px-8 py-4 text-lg font-medium text-[var(--background)] bg-[var(--foreground)] rounded hover:opacity-80 transition-opacity"
        >
          <Download className="w-6 h-6 mr-3" />
          Download for Mac (Apple Silicon)
        </Link>
        <p className="mt-4 text-sm text-muted">Requires macOS 13.0 or later.</p>
      </div>

      <div className="mt-24">
        <h2 className="text-2xl font-bold mb-8 flex items-center">
          <Package className="w-6 h-6 mr-3 text-muted" />
          Release History
        </h2>
        
        <div className="space-y-6">
          {releases.map((release) => (
            <div key={release.version} className="bg-[#fafafa] border border-subtle rounded p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold">v{release.version}</h3>
                  <time className="text-sm text-muted">{release.date}</time>
                </div>
                <Link 
                  href={release.downloadUrl}
                  className="text-sm font-medium text-[var(--accent)] hover:opacity-70 transition-opacity"
                >
                  Download .dmg
                </Link>
              </div>
              <p className="text-muted">{release.notes}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
