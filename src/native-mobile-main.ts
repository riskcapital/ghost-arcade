import { mount } from 'svelte';
import { initErrorReporter } from './lib/utils/errorReporter';
import { silenceThreeSerializationNoise } from './lib/utils/silenceThreePatches';
import './lib/theming/store';
import './lib/theming/fonts.css';
import './lib/theming/studio-skin.css';
import { installRangeProgressSync } from './lib/theming/rangeProgress';

installRangeProgressSync();
silenceThreeSerializationNoise();
initErrorReporter();

type MobileMode = 'standalone' | 'remote';

const MOBILE_MODE_KEY = 'ga-mobile-mode';

function isNativeShell(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('hidden');
    setTimeout(() => splash.remove(), 600);
  }
}

async function mountMobile(mode: MobileMode | null) {
  const target = document.getElementById('app')!;
  target.innerHTML = '';

  if (mode === 'standalone') {
    const { default: StandaloneApp } = await import('./lib/components/StandaloneApp.svelte');
    mount(StandaloneApp, {
      target,
      props: { onSwitchMode: () => switchMobileMode() },
    });
    return;
  }

  if (mode === 'remote') {
    const { default: MobileApp } = await import('./lib/components/MobileApp.svelte');
    mount(MobileApp, { target });
    return;
  }

  const { default: MobileModeSelect } = await import('./lib/components/MobileModeSelect.svelte');
  mount(MobileModeSelect, {
    target,
    props: {
      onSelect: (picked: MobileMode) => {
        try { localStorage.setItem(MOBILE_MODE_KEY, picked); } catch { /* private mode */ }
        void mountMobile(picked);
      },
    },
  });
}

function switchMobileMode() {
  try { localStorage.removeItem(MOBILE_MODE_KEY); } catch { /* private mode */ }
  void mountMobile(null);
}

async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');

  if (isNativeShell()) {
    let stored: MobileMode | null = null;
    try {
      const raw = localStorage.getItem(MOBILE_MODE_KEY);
      if (raw === 'standalone' || raw === 'remote') stored = raw;
    } catch { /* private mode: show picker every launch */ }
    await mountMobile(stored);
    hideSplash();
    return;
  }

  if (mode === 'mobile-standalone' || mode === 'standalone') {
    await mountMobile('standalone');
    hideSplash();
    return;
  }

  if (mode === 'mobile-remote' || mode === 'remote') {
    await mountMobile('remote');
    hideSplash();
    return;
  }

  await mountMobile(null);
  hideSplash();
}

void init();
