// Keeps the screen awake while the studio is in use.
//
// A screen wake lock is released by the system every time the page is hidden (app switcher, a
// phone call, Control Center on some devices) and is not given back. Requesting it once on launch
// therefore lets the phone auto-lock mid-set after the first interruption. This holder asks again
// whenever the app returns to the foreground and whenever the performer touches the screen
// without a lock held.

type Sentinel = { release: () => Promise<void>; addEventListener: (type: 'release', listener: () => void) => void };
type Host = {
  nav: { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } };
  doc: Pick<Document, 'addEventListener' | 'removeEventListener'> & { visibilityState: string };
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
};

export function keepAwake(host?: Host) {
  const { nav, doc, win } = host ?? { nav: navigator as unknown as Host['nav'], doc: document, win: window };
  let lock: Sentinel | null = null, pending = false, stopped = false;
  const request = async () => {
    if (stopped || pending || lock || doc.visibilityState !== 'visible' || !nav.wakeLock) return;
    pending = true;
    try {
      const next = await nav.wakeLock.request('screen');
      if (stopped) { void next.release().catch(() => {}); return; }
      lock = next;
      next.addEventListener('release', () => { if (lock === next) lock = null; });
    } catch {
      // Refused (low power mode, no user gesture yet). The next return or touch tries again.
    } finally {
      pending = false;
    }
  };
  const wake = () => { void request(); };
  doc.addEventListener('visibilitychange', wake);
  win.addEventListener('focus', wake);
  win.addEventListener('pageshow', wake);
  win.addEventListener('pointerdown', wake, { passive: true });
  wake();
  return {
    /** True while the system reports the lock as held. */
    get held() { return !!lock; },
    stop() {
      stopped = true;
      doc.removeEventListener('visibilitychange', wake);
      win.removeEventListener('focus', wake);
      win.removeEventListener('pageshow', wake);
      win.removeEventListener('pointerdown', wake);
      const current = lock; lock = null;
      void current?.release().catch(() => {});
    },
  };
}
