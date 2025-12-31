import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Global Error Guard: Suppress benign ResizeObserver loop errors
const IGNORED_ERRORS = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded'
];

// Strategy 1: Window Event Listener
window.addEventListener('error', (e: ErrorEvent) => {
  const msg = e.message;
  if (typeof msg === 'string' && IGNORED_ERRORS.some(err => msg.includes(err))) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

// Strategy 2: Global Error Handler (Legacy/Robust Fallback)
const originalOnError = window.onerror;
window.onerror = (msg, source, lineno, colno, error) => {
  // Check if the message matches our ignored errors
  if (typeof msg === 'string' && IGNORED_ERRORS.some(err => msg.includes(err))) {
    return true; // Returning true tells the browser "we handled this, don't report it"
  }
  // Pass through other errors
  return originalOnError ? originalOnError(msg, source, lineno, colno, error) : false;
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
// Removed StrictMode to prevent double-invocation of effects/renders 
// which exacerbates ResizeObserver race conditions in React Flow.
root.render(
    <App />
);