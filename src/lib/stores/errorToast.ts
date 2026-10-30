import { writable } from 'svelte/store';

export interface Toast {
  id: number;
  message: string;
  type: 'error' | 'warning' | 'info';
}

export const toasts = writable<Toast[]>([]);

// Counter rather than Date.now(): two toasts in the same millisecond would
// share an id and break the keyed #each in ToastContainer.
let nextId = 1;

export function showToast(message: string, type: 'error' | 'warning' | 'info' = 'error') {
  const id = nextId++;
  toasts.update(t => [...t, { id, message, type }]);
  setTimeout(() => {
    toasts.update(t => t.filter(toast => toast.id !== id));
  }, 5000);
}

export function dismissToast(id: number) {
  toasts.update(t => t.filter(toast => toast.id !== id));
}
