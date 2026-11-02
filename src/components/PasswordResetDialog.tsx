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

const STEP_LABELS = ['Email', 'Code', 'Done'];
const MIN_PASSWORD_LENGTH = 8;

type Step = 'email' | 'reset' | 'done';

const stepNumber = (step: Step) => (step === 'email' ? 0 : step === 'reset' ? 1 : 2);

interface PasswordResetDialogProps {
  onClose: () => void;
}

// Forgot password: the user asks for a code to their verified recovery email, then sets a new password.
export const PasswordResetDialog: React.FC<PasswordResetDialogProps> = ({ onClose }) => {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const longEnough = newPassword.length >= MIN_PASSWORD_LENGTH;
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === newPassword;

  const requestCode = async () => {
    setError(null);
    setMessage(null);
    if (!email.trim()) return setError('Enter your recovery email.');
    setBusy(true);
    try {
      const result = await postJson<{ message: string }>('/password/forgot', { email: email.trim() });
      setMessage(result.message);
      setCode('');
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
    if (!longEnough) return setError(`The new password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
    if (!passwordsMatch) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await postJson('/password/reset', { email: email.trim(), code: code.trim(), newPassword });
      setNewPassword('');
      setConfirmPassword('');
      setStep('done');
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  };

  const backToEmail = () => {
    setError(null);
    setMessage(null);
    setStep('email');
  };

  const footer = (
    <div className="flex-row-gap">
      {step !== 'done' && (
        <button className="olive-button btn-outline" onClick={onClose}>Cancel</button>
      )}
      {step === 'done' && (
        <button className="olive-button" onClick={onClose}>Back to sign in</button>
      )}
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
  );

  return (
    <Modal isOpen={true} onClose={onClose} title="Reset Password" type="mini" footer={footer}>
      <div className="recovery-dialog">
        {step !== 'done' && (
          <ol className="recovery-steps" aria-label="Progress">
            {STEP_LABELS.map((label, index) => {
              const current = stepNumber(step);
              const state = index < current ? 'is-done' : index === current ? 'is-active' : '';
              return (
                <li key={label} className={`recovery-step ${state}`} aria-current={index === current ? 'step' : undefined}>
                  <span className="recovery-step-dot">
                    {index < current ? <i className="bx bx-check" aria-hidden="true"></i> : index + 1}
                  </span>
                  {label}
                </li>
              );
            })}
          </ol>
        )}

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
                autoFocus
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
                autoFocus
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="form-group">
              <label className="label-micro" htmlFor="reset-new-password">New password</label>
              <div className="recovery-password-wrap">
                <input
                  id="reset-new-password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  value={newPassword}
                  autoComplete="new-password"
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="recovery-toggle"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <i className={`bx ${showPassword ? 'bx-hide' : 'bx-show'}`} aria-hidden="true"></i>
                </button>
              </div>
            </div>
            <div className="form-group">
              <label className="label-micro" htmlFor="reset-confirm-password">Confirm new password</label>
              <input
                id="reset-confirm-password"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                value={confirmPassword}
                autoComplete="new-password"
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            <ul className="recovery-rules">
              <li className={longEnough ? 'is-met' : ''}>
                <i className={`bx ${longEnough ? 'bx-check-circle' : 'bx-circle'}`} aria-hidden="true"></i>
                At least {MIN_PASSWORD_LENGTH} characters
              </li>
              <li className={passwordsMatch ? 'is-met' : ''}>
                <i className={`bx ${passwordsMatch ? 'bx-check-circle' : 'bx-circle'}`} aria-hidden="true"></i>
                Passwords match
              </li>
            </ul>
            <div className="recovery-resend-row">
              <span className="recovery-hint">Didn&apos;t get it? Check your spam folder.</span>
              <button type="button" className="recovery-link" onClick={backToEmail}>
                Send a new code
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className="recovery-success" role="status">
            <span className="recovery-success-icon">
              <i className="bx bx-check" aria-hidden="true"></i>
            </span>
            <h3>Password changed</h3>
            <p>You can now sign in with your new password.</p>
          </div>
        )}

        {error && <p className="recovery-message is-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
};
