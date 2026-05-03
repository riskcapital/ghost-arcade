import { writable } from 'svelte/store';

export interface Toast {
  id: number;
  message: string;
  type: 'error' | 'warning' | 'info';
}

export const toasts = writable<Toast[]>([]);

export function showToast(message: string, type: 'error' | 'warning' | 'info' = 'error') {
  const id = Date.now();
  toasts.update(t => [...t, { id, message, type }]);
  setTimeout(() => {
    toasts.update(t => t.filter(toast => toast.id !== id));
  }, 5000);
}

export function dismissToast(id: number) {
  toasts.update(t => t.filter(toast => toast.id !== id));
}
