import React, { useState } from 'react';

interface LoginProps {
  onLoginSuccess: (username: string, role: 'admin' | 'staff') => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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

      onLoginSuccess(data.username || inputUser, data.role);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to log in right now.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-col-center" style={{ minHeight: '100vh', padding: '2rem', background: 'var(--bg)' }}>
      <div 
        className="dash-card" 
        style={{ 
          maxWidth: '440px', 
          width: '100%', 
          padding: '2.5rem', 
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.05)'
        }}
      >
        <div className="flex-col" style={{ gap: '0.5rem', marginBottom: '2rem', textAlign: 'center' }}>
          <h1 className="title-main" style={{ fontSize: '2rem', marginTop: '0.5rem' }}>Skyrun Auto</h1>
        </div>

        {error && (
          <div 
            className="font-mono alert-text" 
            style={{ 
              fontSize: '11px', 
              padding: '0.75rem', 
              border: '1px solid var(--accent)', 
              background: 'rgba(255, 68, 68, 0.05)', 
              marginBottom: '1.5rem',
              borderRadius: 'var(--radius)'
            }}
          >
            <i className="bx bx-error-circle" style={{ marginRight: '6px', verticalAlign: 'middle' }}></i>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="flex-col-gap" style={{ gap: '1.25rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label-micro" htmlFor="username">Username</label>
            <input 
              type="text" 
              id="username" 
              className="form-input font-mono" 
              placeholder="e.g. admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label-micro" htmlFor="password">Password</label>
            <div style={{ position: 'relative' }}>
              <input 
                type={showPassword ? 'text' : 'password'} 
                id="password" 
                className="form-input font-mono" 
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  opacity: 0.5,
                  fontSize: '1.1rem',
                  color: 'var(--ink)'
                }}
                title={showPassword ? 'Hide Password' : 'Show Password'}
              >
                <i className={`bx ${showPassword ? 'bx-hide' : 'bx-show'}`}></i>
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            className="olive-button" 
            style={{ width: '100%', marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <i className="bx bx-loader-alt bx-spin"></i>
                <span>Verifying...</span>
              </>
            ) : (
              <span>Access System</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
