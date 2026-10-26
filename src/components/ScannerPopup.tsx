import React, { useCallback, useRef } from 'react';
import { BarcodeScanner } from './BarcodeScanner';

// Shown in the separate pop-out window opened from the item form (?scanner=1).
// It sends the scanned value back to the form window and closes itself.
export const BARCODE_MESSAGE_TYPE = 'autosupply-barcode';

export const ScannerPopup: React.FC = () => {
  const sentRef = useRef(false);

  const handleScanSuccess = useCallback((value: string) => {
    if (sentRef.current) return;
    sentRef.current = true;

    window.opener?.postMessage({ type: BARCODE_MESSAGE_TYPE, value }, window.location.origin);
    window.close();
  }, []);

  return (
    <div style={{ minHeight: '100vh', padding: '16px', boxSizing: 'border-box', background: '#C5C4BF' }}>
      <h3 style={{ margin: '0 0 12px', textAlign: 'center', letterSpacing: '0.08em' }}>SCAN BARCODE</h3>
      <BarcodeScanner onScanSuccess={handleScanSuccess} />
    </div>
  );
};
