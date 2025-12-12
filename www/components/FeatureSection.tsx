interface FeatureSectionProps {
  title: string;
  problem?: string;
  description: string;
  visual?: React.ReactNode;
  reversed?: boolean;
}

export default function FeatureSection({ 
  title, 
  problem,
  description, 
  visual,
  reversed = false
}: FeatureSectionProps) {
  return (
    <section className="py-12 border-t border-subtle">
      <div className="max-w-5xl mx-auto px-6">
        <div className={`flex flex-col ${reversed ? 'md:flex-row-reverse' : 'md:flex-row'} gap-8 md:gap-12 items-start`}>
          
          {/* Text side. */}
          <div className="flex-1">
            <h2 className="text-2xl font-bold mb-4">{title}</h2>
            
            {problem && (
              <div className="callout mb-4">
                <p className="text-sm font-semibold text-muted mb-1">Problem</p>
                <p>{problem}</p>
              </div>
            )}
            
            <p className="text-muted leading-relaxed">{description}</p>
          </div>

          {/* Visual side. */}
          {visual && (
            <div className="flex-1 w-full">
              <div className="bg-[#fafafa] border border-subtle rounded p-4 font-mono text-sm">
                {visual}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
