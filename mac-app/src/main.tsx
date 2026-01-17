import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Onboarding from './components/Onboarding';
import { ThemeProvider } from './contexts/ThemeContext';
import './styles.css';

/**
 * Simple hash-based router for the main window.
 * Routes:
 *   - #/onboarding - First-run wizard
 *   - (default) - Main settings app
 */
function Router() {
  const [route, setRoute] = React.useState(window.location.hash);

  React.useEffect(() => {
    const handleHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Route to onboarding wizard if hash starts with #/onboarding.
  if (route.startsWith('#/onboarding')) {
    return <Onboarding />;
  }

  // Default: show main settings app.
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <Router />
    </ThemeProvider>
  </React.StrictMode>,
);
