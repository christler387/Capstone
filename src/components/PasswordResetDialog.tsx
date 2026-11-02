import React, { useState } from 'react';
import { Modal } from './Modal';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Request failed with ${response.status}`);
  return data as T;
}

interface PasswordResetDialogProps {
  onClose: () => void;
}

// Forgot password: the user asks for a code to their verified recovery email, then sets a new password.
export const PasswordResetDialog: React.FC<PasswordResetDialogProps> = ({ onClose }) => {
  const [step, setStep] = useState<'email' | 'reset' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestCode = async () => {
    setError(null);
    setMessage(null);
    if (!email.trim()) return setError('Enter your recovery email.');
    setBusy(true);
    try {
      const result = await postJson<{ message: string }>('/password/forgot', { email: email.trim() });
      setMessage(result.message);
      setStep('reset');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the email.');
    if (newPassword.length < 8) return setError('The new password must be at least 8 characters long.');
    if (newPassword !== confirmPassword) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await postJson('/password/reset', { email: email.trim(), code: code.trim(), newPassword });
      setStep('done');
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Reset Password"
      type="mini"
      footer={
        <div className="flex-row-gap">
          <button className="olive-button btn-outline" onClick={onClose}>
            {step === 'done' ? 'Back to sign in' : 'Cancel'}
          </button>
          {step === 'email' && (
            <button className="olive-button" onClick={requestCode} disabled={busy}>
              {busy ? 'Sending…' : 'Send Code'}
            </button>
          )}
          {step === 'reset' && (
            <button className="olive-button" onClick={resetPassword} disabled={busy}>
              {busy ? 'Saving…' : 'Set New Password'}
            </button>
          )}
        </div>
      }
    >
      <div className="recovery-dialog">
        {step === 'email' && (
          <>
            <p className="recovery-dialog-intro">
              Enter the recovery email on your account. If it is verified, we will send a 6-digit code to it.
            </p>
            <div className="form-group">
              <label className="label-micro" htmlFor="reset-email-input">Recovery email</label>
              <input
                id="reset-email-input"
                type="email"
                className="form-input"
                value={email}
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </>
        )}

        {step === 'reset' && (
          <>
            {message && <p className="recovery-message is-success" role="status">{message}</p>}
            <div className="form-group">
              <label className="label-micro" htmlFor="reset-code-input">Code from the email</label>
              <input
                id="reset-code-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="form-input recovery-code-input"
                value={code}
                maxLength={6}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="form-group">
              <label className="label-micro" htmlFor="reset-new-password">New password</label>
              <input
                id="reset-new-password"
                type="password"
                className="form-input"
                value={newPassword}
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="label-micro" htmlFor="reset-confirm-password">Confirm new password</label>
              <input
                id="reset-confirm-password"
                type="password"
                className="form-input"
                value={confirmPassword}
                autoComplete="new-password"
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            <button type="button" className="recovery-resend" onClick={() => { setStep('email'); setError(null); }}>
              Send a new code
            </button>
          </>
        )}

        {step === 'done' && (
          <p className="recovery-message is-success" role="status">
            Your password has been changed. You can sign in with the new password.
          </p>
        )}

        {error && <p className="recovery-message is-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
};
