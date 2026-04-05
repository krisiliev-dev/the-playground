/**
 * Application entry point.
 * Mounts the React tree into the DOM.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found. Make sure index.html contains <div id="root"></div>');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
