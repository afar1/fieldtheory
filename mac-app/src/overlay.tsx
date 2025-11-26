import React from 'react';
import ReactDOM from 'react-dom/client';
import RecordingOverlay from './components/RecordingOverlay';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <RecordingOverlay />
  </React.StrictMode>
);

