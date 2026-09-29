import React, { useRef, useState } from 'react';
import catsImage from '../assets/cats.png';
import skyrunLogo from '../assets/Skyrun.png';

interface LoginProps {
  onLoginSuccess: (username: string, role: 'admin' | 'staff', email?: string | null, phone?: string | null) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

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
      const response = await fetch('http://localhost:3001/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: inputUser, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Invalid login details. Try admin/admin123 or staff/staff123');
      }

      onLoginSuccess(data.username || inputUser, data.role, data.email || null, data.phone || null);
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
          <img className="brand-logo" src={skyrunLogo} alt="" aria-hidden="true" />
          <span className="brand-wordmark">SKYRUN</span>
        </div>

        <h1 className="login-title">Login</h1>

        {error && (
          <div className="login-alert">
            <i className="bx bx-error-circle" aria-hidden="true"></i>
            {error}
          </div>
        )}

        <form noValidate onSubmit={handleLogin} className="login-form">
          <div className="input-block">
            <label htmlFor="username">Email</label>
            <input
              type="text"
              id="username"
              placeholder="username@gmail.com"
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
      </div>

      <div className="login-art" aria-hidden="true">
        <img src={catsImage} alt="" />
      </div>
    </div>
  );
};
