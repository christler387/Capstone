import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BarcodeScanner } from './BarcodeScanner';

interface ScannerDialogProps {
  onScanSuccess: (value: string) => boolean | void;
  onClose: () => void;
}

// Centered camera dialog for reading a barcode into the Add Item form.
export const ScannerDialog: React.FC<ScannerDialogProps> = ({ onScanSuccess, onClose }) => {
  const scanSuccessRef = useRef(onScanSuccess);
  const hasScannedRef = useRef(false);
  const lastRejectedValueRef = useRef<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    scanSuccessRef.current = onScanSuccess;
  }, [onScanSuccess]);

  // The scanner can report the same code several times before the dialog closes.
  const handleScan = useCallback((value: string) => {
    if (hasScannedRef.current || lastRejectedValueRef.current === value) return;
    const accepted = scanSuccessRef.current(value);
    if (accepted === false) {
      lastRejectedValueRef.current = value;
      setWarning('That barcode is already registered to another item. Scan a different barcode.');
      return;
    }
    hasScannedRef.current = true;
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="scanner-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="scanner-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scanner-dialog-title"
      >
        <div className="scanner-dialog-header">
          <div>
            <h2 id="scanner-dialog-title" className="scanner-dialog-title">Scan barcode</h2>
            <p className="scanner-dialog-subtitle">Hold the barcode steady inside the frame.</p>
          </div>
          <button
            type="button"
            className="scanner-dialog-close"
            onClick={onClose}
            aria-label="Close scanner"
          >
            <i className="bx bx-x" aria-hidden="true"></i>
          </button>
        </div>

        <div className="scanner-dialog-body">
          <BarcodeScanner onScanSuccess={handleScan} />
          {warning && (
            <p role="alert" className="scanner-dialog-warning">
              <i className="bx bx-error-circle" aria-hidden="true"></i> {warning}
            </p>
          )}
        </div>

        <div className="scanner-dialog-footer">
          <button type="button" className="scanner-dialog-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
