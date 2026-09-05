import React, { useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

interface BarcodeScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanFailure?: (error: string) => void;
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onScanSuccess, onScanFailure }) => {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    // delay a bit to ensure the element is in the DOM
    const timer = setTimeout(() => {
      const scanner = new Html5QrcodeScanner(
        "reader",
        { 
          fps: 10, 
          qrbox: { width: 260, height: 120 },
          aspectRatio: 1.777778
        },
        /* verbose= */ false
      );

      scanner.render((decodedText) => {
        onScanSuccess(decodedText);
      }, (error) => {
        if (onScanFailure) {
          onScanFailure(error);
        }
      });

      scannerRef.current = scanner;
    }, 100);

    return () => {
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current.clear().catch(error => {
          console.error("Failed to clear html5QrcodeScanner", error);
        });
      }
    };
  }, [onScanSuccess, onScanFailure]);

  return (
    <div id="reader" style={{ width: '100%', maxWidth: '480px', margin: '0 auto', border: '1px solid var(--line-soft)', borderRadius: '8px', overflow: 'hidden' }}></div>
  );
};
