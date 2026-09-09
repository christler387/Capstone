import { Item, Movement } from './types';

const API_BASE = '/api';
const clientApiKey = import.meta.env.VITE_API_KEY;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(clientApiKey ? { 'X-API-Key': clientApiKey } : {}),
      ...(options?.headers || {}),
    },
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
  getInventoryInsights: (inventory: Item[], movements: Movement[]) => request<{ insight: string; model: string }>('/insights', {
    method: 'POST',
    body: JSON.stringify({ inventory, movements }),
  }),
  getInventory: () => request<Item[]>('/inventory'),
  createInventory: (item: Item) => request<Item>('/inventory', { method: 'POST', body: JSON.stringify(item) }),
  updateInventory: (id: string, item: Item) => request<Item>(`/inventory/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(item) }),
  deleteInventory: (id: string) => request<void>(`/inventory/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getMovements: () => request<Movement[]>('/movements'),
  createMovement: (movement: Movement) => request<Movement>('/movements', { method: 'POST', body: JSON.stringify(movement) }),
  deleteMovement: (id: string) => request<void>(`/movements/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createUser: (user: { username: string; password: string; role: 'admin' | 'staff'; displayName?: string }) => request<{ ok: boolean; username: string }>('/users', {
    method: 'POST',
    body: JSON.stringify(user),
  }),
  changePassword: (username: string, currentPassword: string, newPassword: string) => request<{ ok: boolean; username: string }>('/users/change-password', {
    method: 'PUT',
    body: JSON.stringify({ username, currentPassword, newPassword }),
  }),
  changeUsername: (currentUsername: string, currentPassword: string, newUsername: string) => request<{ ok: boolean; username: string }>('/users/change-username', {
    method: 'PUT',
    body: JSON.stringify({ currentUsername, currentPassword, newUsername }),
  }),
};
