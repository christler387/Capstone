import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';

interface RecoveryStatus {
  email: string;
  emailVerified: boolean;
}

async function requestJson<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Request failed with ${response.status}`);
  return data as T;
}

interface RecoveryEmailDialogProps {
  onClose: () => void;
}

// Sets the recovery email used for password reset codes, and confirms it with a code sent by email.
export const RecoveryEmailDialog: React.FC<RecoveryEmailDialogProps> = ({ onClose }) => {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    requestJson<RecoveryStatus>('/account/recovery-email')
      .then(current => {
        setStatus(current);
        setEmail(current.email);
      })
      .catch(loadError => setError(loadError instanceof Error ? loadError.message : 'Could not load your recovery email.'));
  }, []);

  const saveEmail = async () => {
    setError(null);
    setMessage(null);
    if (!email.trim()) return setError('Enter an email address.');
    if (!password) return setError('Enter your current password to change the recovery email.');
    setBusy(true);
    try {
      const saved = await requestJson<RecoveryStatus>('/account/recovery-email', {
        method: 'PUT',
        body: { email: email.trim(), currentPassword: password },
      });
      setStatus(saved);
      setPassword('');
      setCode('');
      setMessage(`We sent a 6-digit code to ${saved.email}. Enter it below to verify.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the recovery email.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setError(null);
    setMessage(null);
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the email.');
    setBusy(true);
    try {
      const verified = await requestJson<RecoveryStatus>('/account/recovery-email/verify', {
        method: 'POST',
        body: { code: code.trim() },
      });
      setStatus(verified);
      setCode('');
      setMessage('Recovery email verified. You can now reset your password with it.');
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Could not verify the code.');
    } finally {
      setBusy(false);
    }
  };

  const awaitingCode = Boolean(status?.email) && !status?.emailVerified;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Recovery Email"
      type="mini"
      footer={
        <div className="flex-row-gap">
          <button className="olive-button btn-outline" onClick={onClose}>Close</button>
          {awaitingCode ? (
            <button className="olive-button" onClick={verifyCode} disabled={busy}>
              {busy ? 'Checking…' : 'Verify Email'}
            </button>
          ) : (
            <button className="olive-button" onClick={saveEmail} disabled={busy}>
              {busy ? 'Sending…' : 'Save & Send Code'}
            </button>
          )}
        </div>
      }
    >
      <div className="recovery-dialog">
        <p className="recovery-dialog-intro">
          This email address receives password reset codes. It is verified with a code sent to it.
        </p>

        {status?.email && (
          <div className={`recovery-status ${status.emailVerified ? 'is-verified' : 'is-pending'}`}>
            <i className={`bx ${status.emailVerified ? 'bx-check-circle' : 'bx-time-five'}`} aria-hidden="true"></i>
            <span>
              {status.email} · {status.emailVerified ? 'Verified' : 'Not verified yet'}
            </span>
          </div>
        )}

        {!awaitingCode && (
          <>
            <div className="form-group">
              <label className="label-micro" htmlFor="recovery-email-input">Recovery email</label>
              <input
                id="recovery-email-input"
                type="email"
                className="form-input"
                value={email}
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="label-micro" htmlFor="recovery-password-input">Current password</label>
              <input
                id="recovery-password-input"
                type="password"
                className="form-input"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </>
        )}

        {awaitingCode && (
          <div className="form-group">
            <label className="label-micro" htmlFor="recovery-code-input">Verification code</label>
            <input
              id="recovery-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="form-input recovery-code-input"
              value={code}
              maxLength={6}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
            <button type="button" className="recovery-resend" onClick={() => setStatus(current => (current ? { ...current, email: '' } : current))}>
              Use a different email or send a new code
            </button>
          </div>
        )}

        {message && <p className="recovery-message is-success" role="status">{message}</p>}
        {error && <p className="recovery-message is-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
};
