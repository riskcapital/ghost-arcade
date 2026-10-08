import { mount } from 'svelte';
import { ARCADE_THEME } from './lib/theming/themes/arcade';
import './lib/mobile/studio/theme.css';
import NativeStudioApp from './lib/components/studio/NativeStudioApp.svelte';

// Reuse the desktop's pure theme definition without importing desktop stores.
for (const [name, value] of Object.entries(ARCADE_THEME.tokens)) {
  const variable = name.replace(/([A-Z0-9])/g, '-$1').toLowerCase();
  document.documentElement.style.setProperty(`--ga-${variable}`, value);
}

document.documentElement.dataset.theme = 'arcade';

// Native shell switches between the saved standalone set and authenticated companion mode.
// Desktop and legacy remote surfaces keep their existing entry points.
try {
  mount(NativeStudioApp, { target: document.getElementById('app')! });
} catch (error) {
  const app = document.getElementById('app')!;
  const message = document.createElement('p');
  message.textContent = `Ghost Arcade could not open: ${error instanceof Error ? error.message : 'Unknown error'}`;
  message.style.cssText = 'padding:32px;color:white;font:16px system-ui';
  app.replaceChildren(message);
} finally {
  document.getElementById('splash')?.remove();
}
