import React from 'react';
import ReactDOM from 'react-dom/client';
import GazeDebugOverlay from './components/GazeDebugOverlay';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <GazeDebugOverlay />
  </React.StrictMode>
);
