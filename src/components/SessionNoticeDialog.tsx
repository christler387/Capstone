import React, { useEffect, useRef } from 'react';

interface SessionNoticeDialogProps {
  message: string;
  onClose: () => void;
}

// Centered notification shown on the login page after the session times out.
export const SessionNoticeDialog: React.FC<SessionNoticeDialogProps> = ({ message, onClose }) => {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmButtonRef.current?.focus();
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
      className="session-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="session-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-dialog-title"
        aria-describedby="session-dialog-message"
      >
        <button
          type="button"
          className="session-dialog-close"
          onClick={onClose}
          aria-label="Close notification"
        >
          <i className="bx bx-x" aria-hidden="true"></i>
        </button>

        <div className="session-dialog-icon" aria-hidden="true">
          <i className="bx bx-time-five"></i>
        </div>

        <h2 id="session-dialog-title" className="session-dialog-title">
          You have been signed out
        </h2>
        <p id="session-dialog-message" className="session-dialog-message">
          {message}
        </p>

        <button
          ref={confirmButtonRef}
          type="button"
          className="session-dialog-action"
          onClick={onClose}
        >
          Got it
        </button>
      </div>
    </div>
  );
};
