/**
 * Lightweight error reporter — captures unhandled errors into a circular buffer
 * stored in localStorage. Provides getErrorLog() for diagnostics UI.
 */

const STORAGE_KEY = 'ill-error-log';
const MAX_ENTRIES = 50;

export interface ErrorEntry {
  timestamp: string;
  message: string;
  stack?: string;
  source?: string;
}

let initialized = false;

function getLog(): ErrorEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ErrorEntry[];
  } catch {
    return [];
  }
}

function saveLog(entries: ErrorEntry[]) {
  try {
    // Keep only the most recent entries
    const trimmed = entries.slice(-MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function pushEntry(entry: ErrorEntry) {
  const log = getLog();
  log.push(entry);
  saveLog(log);
}

/** Install global error handlers. Call once at app startup. */
export function initErrorReporter() {
  if (initialized) return;
  initialized = true;

  window.onerror = (message, source, lineno, colno, error) => {
    pushEntry({
      timestamp: new Date().toISOString(),
      message: String(message),
      stack: error?.stack,
      source: source ? `${source}:${lineno}:${colno}` : undefined,
    });
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    pushEntry({
      timestamp: new Date().toISOString(),
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      source: 'unhandledrejection',
    });
  });
}

/**
 * Record an error that was caught before it could reach the global handlers.
 *
 * A <svelte:boundary> handles the error itself, so window.onerror never sees
 * it. Without this, a section that fails to render would show its fallback
 * and leave nothing in Diagnostics, which is the one place a user can copy
 * the actual message from to report it.
 */
export function recordError(error: unknown, source: string) {
  pushEntry({
    timestamp: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    source,
  });
}

/** Get all captured error entries (most recent last). */
export function getErrorLog(): ErrorEntry[] {
  return getLog();
}

/** Clear the error log. */
export function clearErrorLog() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
