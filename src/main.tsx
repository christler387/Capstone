import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { ScannerPopup } from './components/ScannerPopup';
import './style.css';

// The barcode camera opens in its own window using the same app with ?scanner=1.
const isScannerWindow = new URLSearchParams(window.location.search).get('scanner') === '1';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isScannerWindow ? <ScannerPopup /> : <App />}
  </React.StrictMode>,
);
