import React from 'react';
import ReactDOM from 'react-dom/client';
import Onboarding from './components/Onboarding';

/**
 * Entry point for the onboarding wizard window.
 * This is loaded when the app detects first-run.
 */
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <Onboarding />
  </React.StrictMode>
);

