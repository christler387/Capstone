import React, { useEffect, useRef } from 'react';
import { Html5QrcodeScanType, Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface BarcodeScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanFailure?: (error: string) => void;
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onScanSuccess, onScanFailure }) => {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const callbacksRef = useRef({ onScanSuccess, onScanFailure });
  callbacksRef.current = { onScanSuccess, onScanFailure };

  useEffect(() => {
    const timer = setTimeout(() => {
      const scanner = new Html5QrcodeScanner(
        "reader",
        { 
          fps: 15,
          qrbox: (viewfinderWidth, viewfinderHeight) => ({
            width: Math.min(viewfinderWidth * 0.9, 440),
            height: Math.min(viewfinderHeight * 0.55, 220),
          }),
          supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.PDF_417,
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
          ]
        },
        false
      );

      scanner.render((decodedText) => {
        const normalizedValue = decodedText.trim();
        if (normalizedValue) {
          callbacksRef.current.onScanSuccess(normalizedValue);
        }
      }, (error) => {
        callbacksRef.current.onScanFailure?.(error);
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
  }, []);

  return (
    <div id="reader" style={{ width: '100%', maxWidth: '480px', margin: '0 auto', border: '1px solid var(--line-soft)', borderRadius: '8px', overflow: 'hidden' }}></div>
  );
};
