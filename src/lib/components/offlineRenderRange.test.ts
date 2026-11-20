import { describe, expect, it, vi } from 'vitest';
import { readable } from 'svelte/store';
import { render } from 'svelte/server';

// A 90 s Timeline with something on it.
vi.mock('./show/timeline/timelineSlices', () => ({
  showSlice: (key: string) => readable(({ duration: 90, workArea: null, audioTracks: [], doc: 'timeline' } as Record<string, unknown>)[key]),
}));
vi.mock('../stores/showTimeline', () => ({ showTimeline: { hasContent: () => true } }));
vi.mock('../recording/offlineRender', () => ({
  offlineRender: { ...readable({ flow: { kind: 'idle' }, startedAtMs: 0 }), getEngine: () => null, start: vi.fn(), cancel: vi.fn(), reset: vi.fn() },
  revealOutputPath: vi.fn(),
  DEFAULT_OFFLINE_SETTINGS: { durationSeconds: 10, fps: 30, width: 1920, height: 1080, filename: 'render', outputMode: 'mp4', quality: 'high', captureBackend: 'webgl' },
}));
vi.mock('../stores/layers', () => ({ project: readable({ width: 1920, height: 1080, layers: [] }) }));
vi.mock('../stores/audio', () => ({ audioInputType: readable('none'), audioIsActive: readable(false) }));
vi.mock('../audio/modulation', () => ({ isAudioDrivenMod: () => false, modulationStore: readable(new Map()) }));
vi.mock('../api/native-renderer', () => ({ getNativeRendererCapabilities: vi.fn(async () => null) }));
vi.mock('../bridge', () => ({ isDesktopApp: false, invoke: vi.fn(async () => null) }));

import OfflineRenderModal from './OfflineRenderModal.svelte';

describe('Render to video: the length it opens with', () => {
  it('renders the whole Timeline it highlights, not the 10 s default', () => {
    const { body } = render(OfflineRenderModal, { props: { isOpen: true } });
    expect(body).toMatch(/aria-checked="true"[^>]*data-range-show/);
    const summary = body.slice(body.indexOf('data-render-estimate'));
    // 90 s at 30 fps.
    expect(summary).toMatch(/<strong[^>]*>2700<\/strong> frames/);
  });
});

describe('Render to video: resolution tiles', () => {
  it('lights one tile when the project is 1920×1080 (not Project size and 1080p both)', () => {
    const { body } = render(OfflineRenderModal, { props: { isOpen: true } });
    const grid = body.slice(body.indexOf('preset-grid'), body.indexOf('render-w'));
    expect(grid.match(/preset-btn[^"]*\bactive\b/g) ?? []).toHaveLength(1);
  });
});
