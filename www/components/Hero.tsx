'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, Download } from 'lucide-react';

export default function Hero() {
  return (
    <section className="relative overflow-hidden pt-20 pb-16 md:pt-32 md:pb-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Your mind, <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">transcribed.</span>
          </h1>
          <p className="mt-4 text-xl text-gray-400 max-w-2xl mx-auto mb-10">
            Field Theory is a privacy-first AI companion for your Mac and iPhone. 
            Capture thoughts, conversations, and screens without sacrificing your data.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link 
              href="/download"
              className="inline-flex items-center px-8 py-3 text-lg font-medium text-black bg-white rounded-full hover:bg-gray-200 transition-colors w-full sm:w-auto justify-center"
            >
              <Download className="w-5 h-5 mr-2" />
              Download for Mac
            </Link>
            <Link 
              href="/theories"
              className="inline-flex items-center px-8 py-3 text-lg font-medium text-white border border-white/20 rounded-full hover:bg-white/10 transition-colors w-full sm:w-auto justify-center"
            >
              Read the Theory
              <ArrowRight className="w-5 h-5 ml-2" />
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.7 }}
          className="mt-16 relative mx-auto max-w-5xl"
        >
          <div className="relative rounded-xl overflow-hidden shadow-2xl border border-white/10 bg-gray-900/50 backdrop-blur aspect-video group">
            <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/10 via-transparent to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            {/* Placeholder for the "moving demo" */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-gray-600 font-mono text-sm">[ Demo Video Placeholder ]</span>
              {/* <video autoPlay loop muted playsInline className="w-full h-full object-cover">
                 <source src="/demo.mp4" type="video/mp4" />
              </video> */}
            </div>
          </div>
          
          {/* Decorative glows */}
          <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl blur opacity-20 -z-10" />
        </motion.div>
      </div>
    </section>
  );
}
