'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface FeatureSectionProps {
  title: string;
  description: string;
  imageLeft?: boolean;
  icon?: LucideIcon;
  gradient: string;
  videoSrc?: string; // Optional video
  children?: React.ReactNode; // Optional custom content for the visual side
}

export default function FeatureSection({ 
  title, 
  description, 
  imageLeft = false, 
  gradient,
  videoSrc,
  children
}: FeatureSectionProps) {
  return (
    <section className="py-24 overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={cn(
          "flex flex-col md:items-center gap-12 md:gap-24",
          imageLeft ? "md:flex-row" : "md:flex-row-reverse"
        )}>
          {/* Visual Side */}
          <motion.div 
            initial={{ opacity: 0, x: imageLeft ? -50 : 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="flex-1 w-full"
          >
            <div className={cn(
              "relative rounded-2xl p-1 bg-gradient-to-br",
              gradient
            )}>
              <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3] border border-white/5">
                {videoSrc ? (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-700">
                    [Video: {videoSrc}]
                  </div>
                ) : children ? (
                  children
                ) : (
                   <div className="absolute inset-0 bg-gray-900/50" />
                )}
              </div>
            </div>
          </motion.div>

          {/* Text Side */}
          <motion.div 
            initial={{ opacity: 0, x: imageLeft ? 50 : -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="flex-1"
          >
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
              {title}
            </h2>
            <p className="text-lg text-gray-400 leading-relaxed">
              {description}
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
