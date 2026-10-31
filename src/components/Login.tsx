import React, { useCallback, useEffect, useRef, useState } from 'react';
import skyrunLogo from '../assets/Skyrun.png';
import { SessionNoticeDialog } from './SessionNoticeDialog';

interface LoginProps {
  onLoginSuccess: (username: string, role: 'admin' | 'staff', email?: string, phone?: string) => void;
  notice?: string | null;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess, notice }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState<'request' | 'verify' | 'reset'>('request');
  const [recoveryUsername, setRecoveryUsername] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isNoticeOpen, setIsNoticeOpen] = useState(Boolean(notice));
  const [isLoading, setIsLoading] = useState(false);
  const closeNotice = useCallback(() => setIsNoticeOpen(false), []);

  // Open the notice again whenever a new one arrives (for example, another timeout).
  useEffect(() => {
    setIsNoticeOpen(Boolean(notice));
  }, [notice]);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const handleRecoveryRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);
    setIsLoading(true);
    try {
      const response = await fetch('/api/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: recoveryUsername.trim(),
          email: recoveryEmail.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to send a verification code.');
      }
      setRecoveryStep('verify');
      setSuccessNotice(data.message);
    } catch (recoveryError) {
      setError(recoveryError instanceof Error ? recoveryError.message : 'Unable to send a verification code.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyRecoveryCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);
    setIsLoading(true);
    try {
      const response = await fetch('/api/password-reset/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: recoveryUsername.trim(),
          email: recoveryEmail.trim(),
          code: recoveryCode.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to verify the code.');
      }
      setResetToken(data.resetToken);
      setRecoveryStep('reset');
      setSuccessNotice('Code verified. Choose a new password.');
    } catch (recoveryError) {
      setError(recoveryError instanceof Error ? recoveryError.message : 'Unable to verify the code.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);
    if (newPassword.length < 4) {
      setError('Password must be at least 4 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/password-reset/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resetToken}`,
        },
        body: JSON.stringify({ newPassword }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to reset your password.');
      }
      setIsForgotPassword(false);
      setPassword('');
      setResetToken('');
      setRecoveryCode('');
      setNewPassword('');
      setConfirmNewPassword('');
      setSuccessNotice('Password reset. You can now sign in with your new password.');
    } catch (recoveryError) {
      setError(recoveryError instanceof Error ? recoveryError.message : 'Unable to reset your password.');
    } finally {
      setIsLoading(false);
    }
  };

  const returnToLogin = () => {
    setIsForgotPassword(false);
    setError(null);
    setSuccessNotice(null);
    setRecoveryCode('');
    setResetToken('');
    setNewPassword('');
    setConfirmNewPassword('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const inputUser = username.trim();

    if (!inputUser || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: inputUser, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Invalid login details. Try admin/admin123 or staff/staff123');
      }

      onLoginSuccess(data.username || inputUser, data.role, data.email, data.phone);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to log in right now.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-panel">
        <div className="brand-lockup" aria-label="Skyrun brand">
          <span className="brand-wordmark">SKYRUN</span>
        </div>

        <h1 className="login-title">{isForgotPassword ? 'Reset password' : 'Login'}</h1>

        {error && (
          <div className="login-alert">
            <i className="bx bx-error-circle" aria-hidden="true"></i>
            {error}
          </div>
        )}
        {successNotice && (
          <div className="login-success" role="status">{successNotice}</div>
        )}

        {notice && isNoticeOpen && (
          <SessionNoticeDialog message={notice} onClose={closeNotice} />
        )}

        {!isForgotPassword ? (
        <form noValidate onSubmit={handleLogin} className="login-form">
          <div className="input-block">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  passwordInputRef.current?.focus();
                }
              }}
              disabled={isLoading}
              required
            />
          </div>

          <div className="input-block">
            <label htmlFor="password">Password</label>
            <div className="password-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                placeholder="Password"
                ref={passwordInputRef}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? 'Hide Password' : 'Show Password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <i className={`bx ${showPassword ? 'bx-hide' : 'bx-show'}`} aria-hidden="true"></i>
              </button>
            </div>
          </div>

          <button
            type="button"
            className="forgot-password-link"
            onClick={() => {
              setError(null);
              setSuccessNotice(null);
              setIsForgotPassword(true);
              setRecoveryStep('request');
              setRecoveryUsername(username);
            }}
          >
            Forgot password?
          </button>

          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? (
              <>
                <i className="bx bx-loader-alt bx-spin" aria-hidden="true"></i>
                <span>Verifying...</span>
              </>
            ) : (
              <span>Sign in</span>
            )}
          </button>
        </form>
        ) : recoveryStep === 'request' ? (
          <form noValidate onSubmit={handleRecoveryRequest} className="login-form">
            <p className="recovery-help">
              Enter your username and the recovery email address on your account.
            </p>
            <div className="input-block">
              <label htmlFor="recovery-username">Username</label>
              <input
                type="text"
                id="recovery-username"
                autoComplete="username"
                value={recoveryUsername}
                onChange={(e) => setRecoveryUsername(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            <div className="input-block">
              <label htmlFor="recovery-email">Recovery email</label>
              <input
                type="email"
                id="recovery-email"
                autoComplete="email"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            <button type="submit" className="login-button" disabled={isLoading}>
              {isLoading ? 'Sending code...' : 'Send verification code'}
            </button>
            <button type="button" className="forgot-password-link" onClick={returnToLogin}>
              Back to sign in
            </button>
          </form>
        ) : recoveryStep === 'verify' ? (
          <form noValidate onSubmit={handleVerifyRecoveryCode} className="login-form">
            <p className="recovery-help">
              Enter the six-digit code sent to your recovery email.
            </p>
            <div className="input-block">
              <label htmlFor="recovery-code">Verification code</label>
              <input
                type="text"
                id="recovery-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, ''))}
                disabled={isLoading}
                required
              />
            </div>
            <button type="submit" className="login-button" disabled={isLoading}>
              {isLoading ? 'Verifying code...' : 'Verify code'}
            </button>
            <button
              type="button"
              className="forgot-password-link"
              disabled={isLoading}
              onClick={() => {
                setRecoveryStep('request');
                setRecoveryCode('');
                setError(null);
                setSuccessNotice(null);
              }}
            >
              Use another email or resend code
            </button>
          </form>
        ) : (
          <form noValidate onSubmit={handlePasswordReset} className="login-form">
            <p className="recovery-help">
              Choose a new password. Your reset authorization expires in five minutes.
            </p>
            <div className="input-block">
              <label htmlFor="new-password">New password</label>
              <input
                type="password"
                id="new-password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            <div className="input-block">
              <label htmlFor="confirm-new-password">Confirm new password</label>
              <input
                type="password"
                id="confirm-new-password"
                autoComplete="new-password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            <button type="submit" className="login-button" disabled={isLoading}>
              {isLoading ? 'Resetting...' : 'Reset password'}
            </button>
            <button
              type="button"
              className="forgot-password-link"
              disabled={isLoading}
              onClick={() => {
                setRecoveryStep('request');
                setRecoveryCode('');
                setResetToken('');
                setNewPassword('');
                setConfirmNewPassword('');
                setError(null);
                setSuccessNotice(null);
              }}
            >
              Request another code
            </button>
          </form>
        )}
      </div>

      <div className="login-art" aria-hidden="true">
        <img src={skyrunLogo} alt="" />
      </div>
    </div>
  );
};
