import React from 'react';
import ReactDOM from 'react-dom/client';
import CursorStatus from './components/CursorStatus';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <CursorStatus />
  </React.StrictMode>
);
