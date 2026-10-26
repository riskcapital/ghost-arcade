import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const { shouldRestoreEditorFocus, outputOnEditorDisplay } = createRequire(import.meta.url)('../../../electron/output-focus.cjs');

const projector = { x: 1920, y: 0, width: 1920, height: 1080, attached: true, fullscreen: true };

describe('shouldRestoreEditorFocus', () => {
  it('gives focus back to the editor when the output opens on another display', () => {
    expect(shouldRestoreEditorFocus({ platform: 'darwin', config: projector, editorWasFocused: true, sameDisplay: false })).toBe(true);
  });

  it('lets the output come forward on the editor display', () => {
    expect(shouldRestoreEditorFocus({ platform: 'darwin', config: projector, editorWasFocused: true, sameDisplay: true })).toBe(false);
  });

  it('always keeps focus for the editor underlay preview', () => {
    const underlay = { ...projector, underlay: true, always_on_bottom: true };
    expect(shouldRestoreEditorFocus({ platform: 'darwin', config: underlay, editorWasFocused: true, sameDisplay: true })).toBe(true);
  });

  it('leaves focus alone when the editor did not have it', () => {
    expect(shouldRestoreEditorFocus({ platform: 'darwin', config: projector, editorWasFocused: false, sameDisplay: false })).toBe(false);
  });

  it('leaves focus alone when the output is hidden or the display is unknown', () => {
    expect(shouldRestoreEditorFocus({ platform: 'darwin', config: { attached: false }, editorWasFocused: true, sameDisplay: false })).toBe(false);
    expect(shouldRestoreEditorFocus({ platform: 'darwin', config: { fullscreen: true }, editorWasFocused: true, sameDisplay: null })).toBe(false);
  });

  it('does nothing outside macOS', () => {
    expect(shouldRestoreEditorFocus({ platform: 'win32', config: projector, editorWasFocused: true, sameDisplay: false })).toBe(false);
  });
});

describe('outputOnEditorDisplay', () => {
  const screen = {
    getDisplayMatching: (rect: { x: number }) => ({ id: rect.x >= 1920 ? 2 : 1 }),
  };

  it('compares the displays of the output rect and the editor', () => {
    expect(outputOnEditorDisplay(screen, { x: 0, y: 0, width: 1600, height: 900 }, projector)).toBe(false);
    expect(outputOnEditorDisplay(screen, { x: 100, y: 0, width: 1600, height: 900 }, { ...projector, x: 200 })).toBe(true);
  });

  it('is unknown without a rect', () => {
    expect(outputOnEditorDisplay(screen, { x: 0, y: 0, width: 1600, height: 900 }, { attached: true })).toBe(null);
  });
});
