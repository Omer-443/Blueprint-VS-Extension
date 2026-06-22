import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// eslint-disable-next-line no-console
console.log('[webview] main.tsx loaded');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
