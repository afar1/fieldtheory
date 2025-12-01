import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

console.log('[main.tsx] Script loaded, attempting to mount React...');

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('[main.tsx] Root element not found!');
} else {
  console.log('[main.tsx] Root element found, creating React root...');
  try {
    const root = ReactDOM.createRoot(rootElement);
    console.log('[main.tsx] React root created, rendering App...');
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
    console.log('[main.tsx] App rendered successfully');
  } catch (error) {
    console.error('[main.tsx] Error rendering App:', error);
  }
}
