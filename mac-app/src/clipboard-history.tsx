import React from 'react';
import ReactDOM from 'react-dom/client';
import ClipboardHistory from './components/ClipboardHistory';
import TrialGate from './components/TrialGate';
import { ThemeProvider } from './contexts/ThemeContext';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <TrialGate>
        <ClipboardHistory />
      </TrialGate>
    </ThemeProvider>
  </React.StrictMode>
);

