import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';

const EMAIL_KEY = 'skyrun_session_email';
const VERIFIED_KEY = 'skyrun_session_email_verified';
const RESEND_SECONDS = 60;

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

// Shows the address without exposing all of it, for example c•••••9@gmail.com.
const maskEmail = (email: string): string => {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  const hidden = '•'.repeat(Math.max(3, name.length - 2));
  return `${name.slice(0, 1)}${hidden}${name.slice(-1)}@${domain}`;
};

// Reads the status saved at sign-in, so opening the dialog never waits on the server.
const readSavedStatus = () => {
  try {
    return {
      email: sessionStorage.getItem(EMAIL_KEY) || '',
      verified: sessionStorage.getItem(VERIFIED_KEY) === '1',
    };
  } catch {
    return { email: '', verified: false };
  }
};

const saveStatus = (email: string, verified: boolean) => {
  try {
    sessionStorage.setItem(EMAIL_KEY, email);
    sessionStorage.setItem(VERIFIED_KEY, verified ? '1' : '0');
  } catch {
    // Storage can be blocked; the dialog still works for this visit.
  }
};

type Stage = 'view' | 'enter' | 'code';

interface RecoveryEmailDialogProps {
  onClose: () => void;
}

// Recovery email, handled the way account settings usually do it:
// view the address (masked) and its status, change it with the password, then confirm a 6-digit code.
export const RecoveryEmailDialog: React.FC<RecoveryEmailDialogProps> = ({ onClose }) => {
  const saved = readSavedStatus();
  const [stage, setStage] = useState<Stage>(() => {
    if (saved.email && saved.verified) return 'view';
    if (saved.email) return 'code';
    return 'enter';
  });
  const [savedEmail, setSavedEmail] = useState(saved.email);
  const [verified, setVerified] = useState(saved.verified);
  const [email, setEmail] = useState(saved.email);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Counts down before a new code can be requested.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(seconds => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const sendCode = async () => {
    setError(null);
    setMessage(null);
    if (!email.trim()) return setError('Enter an email address.');
    if (!password) return setError('Enter your current password to confirm this change.');
    setBusy(true);
    try {
      const result = await requestJson<{ email: string; emailVerified: boolean }>('/account/recovery-email', {
        method: 'PUT',
        body: { email: email.trim(), currentPassword: password },
      });
      setSavedEmail(result.email);
      setVerified(result.emailVerified);
      saveStatus(result.email, result.emailVerified);
      setPassword('');
      setCode('');
      setStage('code');
      setCooldown(RESEND_SECONDS);
      setMessage(`We sent a 6-digit code to ${maskEmail(result.email)}. It expires in 15 minutes.`);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send the code. Try again.');
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
      const result = await requestJson<{ email: string; emailVerified: boolean }>('/account/recovery-email/verify', {
        method: 'POST',
        body: { code: code.trim() },
      });
      setVerified(result.emailVerified);
      saveStatus(result.email, result.emailVerified);
      setCode('');
      setStage('view');
      setMessage('Your recovery email is verified.');
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Could not verify the code.');
    } finally {
      setBusy(false);
    }
  };

  const startChange = () => {
    setError(null);
    setMessage(null);
    setEmail(savedEmail);
    setPassword('');
    setStage('enter');
  };

  const footer = (
    <div className="flex-row-gap">
      {stage === 'view' && <button className="olive-button btn-outline" onClick={onClose}>Done</button>}
      {stage !== 'view' && (
        <button className="olive-button btn-outline" onClick={() => (savedEmail && stage !== 'enter' ? setStage('view') : onClose())}>
          {savedEmail && stage === 'code' ? 'Back' : 'Cancel'}
        </button>
      )}
      {stage === 'enter' && (
        <button className="olive-button" onClick={sendCode} disabled={busy}>
          {busy ? 'Sending…' : 'Send Verification Code'}
        </button>
      )}
      {stage === 'code' && (
        <button className="olive-button" onClick={verifyCode} disabled={busy}>
          {busy ? 'Checking…' : 'Verify Email'}
        </button>
      )}
    </div>
  );

  return (
    <Modal isOpen={true} onClose={onClose} title="Recovery Email" type="mini" footer={footer}>
      <div className="recovery-dialog">
        {stage === 'view' && (
          <>
            <p className="recovery-dialog-intro">
              We use this address to send password reset codes. Only verified addresses can receive them.
            </p>
            <div className="recovery-address">
              <div>
                <div className="recovery-address-label">Recovery email</div>
                <div className="recovery-address-value">{maskEmail(savedEmail)}</div>
              </div>
              <span className={`recovery-badge ${verified ? 'is-verified' : 'is-pending'}`}>
                <i className={`bx ${verified ? 'bx-check-circle' : 'bx-time-five'}`} aria-hidden="true"></i>
                {verified ? 'Verified' : 'Not verified'}
              </span>
            </div>
            <button type="button" className="recovery-link" onClick={startChange}>
              Change recovery email
            </button>
          </>
        )}

        {stage === 'enter' && (
          <>
            <p className="recovery-dialog-intro">
              {savedEmail
                ? 'Enter the new address and your current password. We will send a code to the new address.'
                : 'Add an address to receive password reset codes. We will send a code to it to confirm it is yours.'}
            </p>
            <div className="form-group">
              <label className="label-micro" htmlFor="recovery-email-input">Email address</label>
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

        {stage === 'code' && (
          <>
            <p className="recovery-dialog-intro">
              Enter the 6-digit code we sent to <strong>{maskEmail(savedEmail)}</strong>.
            </p>
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
            </div>
            <div className="recovery-resend-row">
              <span className="recovery-hint">Didn&apos;t get it? Check your spam folder.</span>
              {cooldown > 0 ? (
                <span className="recovery-hint">Send again in {cooldown}s</span>
              ) : (
                <button type="button" className="recovery-link" onClick={startChange}>
                  Send a new code
                </button>
              )}
            </div>
          </>
        )}

        {message && <p className="recovery-message is-success" role="status">{message}</p>}
        {error && <p className="recovery-message is-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
};
