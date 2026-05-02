import React from 'react';

interface TrialGateProps {
  children: React.ReactNode;
}

export default function TrialGate({ children }: TrialGateProps) {
  return <>{children}</>;
}
