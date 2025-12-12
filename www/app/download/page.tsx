import { Download, Package } from 'lucide-react';
import Link from 'next/link';

// Mock releases data
const releases = [
  {
    version: '0.1.18',
    date: 'Dec 12, 2025',
    notes: 'Initial public beta. Includes local Whisper and basic clipboard history.',
    downloadUrl: '#' // Replace with actual GitHub release URL
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
    <div className="py-24 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold text-white mb-4">Download Field Theory</h1>
        <p className="text-xl text-gray-400 mb-8">Get the latest version for macOS.</p>
        
        <Link 
          href="#"
          className="inline-flex items-center px-8 py-4 text-lg font-medium text-black bg-white rounded-full hover:bg-gray-200 transition-colors"
        >
          <Download className="w-6 h-6 mr-3" />
          Download for Mac (Apple Silicon)
        </Link>
        <p className="mt-4 text-sm text-gray-500">Requires macOS 13.0 or later.</p>
      </div>

      <div className="mt-24">
        <h2 className="text-2xl font-bold text-white mb-8 flex items-center">
          <Package className="w-6 h-6 mr-3 text-gray-500" />
          Release History
        </h2>
        
        <div className="space-y-6">
          {releases.map((release) => (
            <div key={release.version} className="bg-white/5 border border-white/10 rounded-xl p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-white">v{release.version}</h3>
                  <time className="text-sm text-gray-500">{release.date}</time>
                </div>
                <Link 
                  href={release.downloadUrl}
                  className="text-sm font-medium text-purple-400 hover:text-purple-300 transition-colors"
                >
                  Download .dmg
                </Link>
              </div>
              <p className="text-gray-300">{release.notes}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
