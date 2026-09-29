import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Login } from './Login';

describe('Login', () => {
  it('renders the branded login form matching the reference', () => {
    render(<Login onLoginSuccess={vi.fn()} />);

    expect(screen.getByText(/login/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Email$/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('shows validation error when fields are empty', async () => {
    const user = userEvent.setup();
    render(<Login onLoginSuccess={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(screen.getByText(/please fill in all fields/i)).toBeTruthy();
  });

  it('calls onLoginSuccess when a valid login succeeds', async () => {
    const user = userEvent.setup();
    const onLoginSuccess = vi.fn();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ username: 'admin', role: 'admin', email: 'admin@example.com', phone: '123' }),
    }));

    render(<Login onLoginSuccess={onLoginSuccess} />);

    await user.type(screen.getByLabelText(/^Email$/i), 'admin');
    await user.type(screen.getByLabelText(/^Password$/i), 'admin123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(onLoginSuccess).toHaveBeenCalledWith('admin', 'admin', 'admin@example.com', '123');

    vi.unstubAllGlobals();
  });
});
