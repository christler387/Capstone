// Small JSON helper for the stock card and supplier screens. Same behaviour as the helper in App.tsx.
const API_BASE = '/api';

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // Not JSON: keep the text as it is.
    }
    throw new Error(message || `Request failed with ${response.status}`);
  }

  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
