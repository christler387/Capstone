import { Item, Movement } from './types';

const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  health: () => request<{ ok: boolean }>('/health'),
  getInventory: () => request<Item[]>('/inventory'),
  createInventory: (item: Item) => request<Item>('/inventory', { method: 'POST', body: JSON.stringify(item) }),
  updateInventory: (id: string, item: Item) => request<Item>(`/inventory/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(item) }),
  deleteInventory: (id: string) => request<void>(`/inventory/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getMovements: () => request<Movement[]>('/movements'),
  createMovement: (movement: Movement) => request<Movement>('/movements', { method: 'POST', body: JSON.stringify(movement) }),
  deleteMovement: (id: string) => request<void>(`/movements/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
