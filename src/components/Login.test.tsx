import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Login } from './Login';

describe('Login', () => {
  it('shows validation error when fields are empty', async () => {
    const user = userEvent.setup();
    render(<Login onLoginSuccess={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /access system/i }));

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

    await user.type(screen.getByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/password/i), 'admin123');
    await user.click(screen.getByRole('button', { name: /access system/i }));

    expect(onLoginSuccess).toHaveBeenCalledWith('admin', 'admin', 'admin@example.com', '123');

    vi.unstubAllGlobals();
  });
});
