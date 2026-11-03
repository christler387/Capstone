import React, { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanType, Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface BarcodeScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanFailure?: (error: string) => void;
}

// Ignore the same code for this long, so holding a label in view does not fire again and again.
const REPEAT_DELAY_MS = 1500;

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onScanSuccess, onScanFailure }) => {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const callbacksRef = useRef({ onScanSuccess, onScanFailure });
  callbacksRef.current = { onScanSuccess, onScanFailure };
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const [lastValue, setLastValue] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const scanner = new Html5QrcodeScanner(
        "reader",
        {
          // Faster frames and a sharper image make labels read sooner.
          fps: 30,
          qrbox: (viewfinderWidth, viewfinderHeight) => ({
            width: Math.min(viewfinderWidth * 0.9, 440),
            height: Math.min(viewfinderHeight * 0.55, 220),
          }),
          videoConstraints: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          // Use the browser's built-in barcode reader when it has one (Chrome and Edge), and fall back otherwise.
          useBarCodeDetectorIfSupported: true,
          showTorchButtonIfSupported: true,
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
        const value = decodedText.trim();
        if (!value) return;

        const now = Date.now();
        const last = lastScanRef.current;
        if (last && last.value === value && now - last.at < REPEAT_DELAY_MS) return;
        lastScanRef.current = { value, at: now };

        setLastValue(value);
        callbacksRef.current.onScanSuccess(value);
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
    <div className="barcode-scanner">
      <div id="reader" style={{ width: '100%', maxWidth: '480px', margin: '0 auto', border: '1px solid var(--line-soft)', borderRadius: '8px', overflow: 'hidden' }}></div>
      <div className={`barcode-status ${lastValue ? 'is-read' : ''}`} role="status" aria-live="polite">
        <i className={`bx ${lastValue ? 'bx-check-circle' : 'bx-scan'}`} aria-hidden="true"></i>
        <span>{lastValue ? `Read ${lastValue}` : 'Point the camera at a barcode'}</span>
      </div>
    </div>
  );
};
