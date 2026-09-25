import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../bridge', () => ({ isDesktopApp: false, isElectron: false, invoke: vi.fn() }));
// The settings store reads localStorage and paints the colour scheme on load.
vi.hoisted(() => {
  const store = new Map<string, string>();
  const noop = () => {};
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    },
    document: {
      documentElement: { style: { setProperty: noop, removeProperty: noop }, dataset: {}, classList: { add: noop, remove: noop, toggle: noop } },
      addEventListener: noop,
      querySelector: () => null,
    },
  });
});
import { settings } from '../stores/settings';

/**
 * Recording audio has always been on by default and the recorder and the
 * native clip audio tap both honour `recording.includeAudio`, but nothing in
 * the UI could change it. The Settings panel's Recording section carries the
 * toggle now.
 */
const panel = readFileSync(join(process.cwd(), 'src', 'lib', 'components', 'SettingsPanel.svelte'), 'utf8');
const sectionStart = panel.indexOf("{#if selectedSection === 'recording'}");
const section = panel.slice(sectionStart, panel.indexOf('</section>', sectionStart));

describe('recording settings', () => {
  it('shows an Include Audio toggle in the Recording section', () => {
    expect(section).toContain('<span class="label-text">Include Audio</span>');
    const row = section.slice(section.indexOf('Include Audio'), section.indexOf('Auto-Download'));
    expect(row).toContain('class="toggle"');
    expect(row).toContain('checked={$settings.recording.includeAudio !== false}');
    expect(row).toContain('onchange={handleIncludeAudioChange}');
    const handler = panel.slice(panel.indexOf('function handleIncludeAudioChange'), panel.indexOf('async function handlePickDirectory'));
    expect(handler).toContain('settings.setIncludeAudio(checked)');
  });

  it('defaults to on and the setter turns it off and on', () => {
    expect(settings.get().recording.includeAudio).toBe(true);
    settings.setIncludeAudio(false);
    expect(settings.get().recording.includeAudio).toBe(false);
    settings.setIncludeAudio(true);
    expect(settings.get().recording.includeAudio).toBe(true);
  });
});
