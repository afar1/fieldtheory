import React from 'react';
import ReactDOM from 'react-dom/client';
import GazeScreenOverlay from './components/GazeScreenOverlay';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <GazeScreenOverlay />
  </React.StrictMode>
);
