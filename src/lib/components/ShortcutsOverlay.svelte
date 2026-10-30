<script lang="ts">
  import { isMac } from '$lib/bridge';
  import { uiLanguage, resetLanguageToEnglish } from '$lib/i18n';
  export let visible = false;
  export let onClose: () => void;
  export let onTour: () => void = () => {};
  export let onTemplates: () => void = () => {};

  const mod = isMac ? 'Cmd' : 'Ctrl';
</script>

{#if visible}
  <div data-help-page="interface" class="shortcut-overlay-backdrop" onclick={onClose}>
    <div class="shortcut-overlay" onclick={(e) => e.stopPropagation()}>
      <header class="shortcut-overlay-header modal-header">
        <h2 class="shortcut-overlay-title">Keyboard shortcuts</h2>
        <button aria-label="Close keyboard shortcuts" class="shortcut-overlay-close" onclick={onClose}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
      </header>
      <div class="shortcut-overlay-body">
      {#if $uiLanguage !== 'en'}
        <!-- Always in English, so it can be found from any language. -->
        <button class="shortcut-english-btn" translate="no" onclick={resetLanguageToEnglish}>
          Switch to English <span>({mod}+Shift+E)</span>
        </button>
      {/if}
      <div class="shortcut-start">
        <button class="shortcut-start-btn" onclick={onTour}>Take the tour</button>
        <button class="shortcut-start-btn" onclick={onTemplates}>Start from a template</button>
      </div>
      <div class="shortcut-columns">
        <div class="shortcut-section">
          <h3>General</h3>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>N</kbd><span>New project</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>O</kbd><span>Open project</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>S</kbd><span>Save</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd><span>Save as</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>Z</kbd><span>Undo</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd><span>Redo</span></div>
        </div>
        <div class="shortcut-section">
          <h3>Layers</h3>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>C</kbd><span>Copy layer(s)</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>V</kbd><span>Paste layer(s)</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>D</kbd><span>Duplicate layer</span></div>
          <div class="shortcut-row"><kbd>Delete</kbd><span>Remove selected keyframe or layer</span></div>
          <div class="shortcut-row"><kbd>{isMac ? 'Fn+Delete' : 'Backspace'}</kbd><span>Remove selected keyframe or layer</span></div>
        </div>
        <div class="shortcut-section">
          <h3>Mapping</h3>
          <div class="shortcut-row"><kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd><span>Move the selected point (or the layers) one pixel</span></div>
          <div class="shortcut-row"><kbd>Shift</kbd>+<kbd>↑</kbd><span>Ten pixels at a time</span></div>
          <div class="shortcut-row"><kbd>Alt</kbd>+<kbd>↑</kbd><span>A tenth of a pixel</span></div>
          <div class="shortcut-row"><kbd>Shift</kbd><span>Hold while dragging for fine movement</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd><span>Hold while dragging to move without snapping</span></div>
          <div class="shortcut-row"><kbd>Esc</kbd><span>Let go of the selected point</span></div>
        </div>
        <div class="shortcut-section">
          <h3>Control &amp; view</h3>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>M</kbd><span>Toggle MIDI Learn</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>,</kbd><span>Settings</span></div>
          <div class="shortcut-row"><kbd>Space</kbd><span>Hold + drag to pan (show tray closed)</span></div>
          <div class="shortcut-row"><kbd>Esc</kbd><span>Exit drawing, MIDI / keyboard edit, or help</span></div>
          <div class="shortcut-row"><kbd>?</kbd><span>Toggle this help</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd><span>Interface language back to English</span></div>
        </div>
        <div class="shortcut-section">
          <h3>Show timeline</h3>
          <div class="shortcut-row"><kbd>Space</kbd><span>Play / pause (show tray open)</span></div>
        </div>
        <div class="shortcut-section">
          <h3>Output</h3>
          <div class="shortcut-row"><kbd>B</kbd><span>Blackout toggle</span></div>
          <div class="shortcut-row"><kbd>T</kbd><span>Cycle test patterns</span></div>
        </div>
        <div class="shortcut-section">
          <h3>VJ mode</h3>
          <div class="shortcut-row"><kbd>1</kbd>-<kbd>9</kbd><span>Trigger columns 1-9</span></div>
          <div class="shortcut-row"><kbd>0</kbd><span>Trigger column 10</span></div>
          <div class="shortcut-row"><kbd>F1</kbd>-<kbd>F8</kbd><span>Switch blocks 1-8</span></div>
        </div>
      </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Bug fix (Mar 2026): the component had NO style block at all, so
     `?` button "did nothing" — the overlay rendered but was invisible
     (unpositioned divs at the document end). Adding proper modal
     styling with backdrop, centered card, z-index above all panels. */
  .shortcut-overlay-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    cursor: pointer;
  }
  .shortcut-overlay-backdrop {
    background: color-mix(in srgb, var(--ga-void, #0a0908) 76%, transparent);
    backdrop-filter: blur(8px);
  }

  .shortcut-overlay {
    width: 100%;
    max-width: 760px;
    max-height: calc(100vh - 96px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--ga-faceplate-bg, var(--ga-panel, #100f0d));
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    box-shadow: inset 0 1px 0 var(--ga-metal-hi, rgba(255, 255, 255, 0.08)), 0 24px 80px rgba(0, 0, 0, 0.58);
    color: var(--ga-ink-1, #ada9a2);
    font-size: var(--ga-text-body);
    font-family: var(--ga-font-ui, 'Geist', system-ui, sans-serif);
    cursor: default;
  }
  .shortcut-overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }
  .shortcut-overlay-title {
    margin: 0;
    font-size: var(--ga-text-heading);
    font-weight: var(--ga-weight-title);
    line-height: 1.3;
    letter-spacing: 0;
    text-transform: none;
    color: var(--ga-ink-0, #f2ede4);
  }
  .shortcut-overlay-close {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    display: inline-grid;
    place-items: center;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-2, #89857e);
    cursor: pointer;
    transition: color 0.12s, background 0.12s, border-color 0.12s;
  }
  .shortcut-overlay-close:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    background: var(--ga-raise, #26221c);
    border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13));
  }
  .shortcut-overlay-close:disabled { opacity: 0.35; cursor: not-allowed; }

  .shortcut-overlay-body {
    padding: 16px;
    overflow-y: auto;
  }
  .shortcut-start {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 16px;
  }
  .shortcut-start-btn,
  .shortcut-english-btn {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: var(--ga-control-h);
    padding: 0 12px;
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }
  .shortcut-start-btn:hover,
  .shortcut-english-btn:hover {
    color: var(--ga-ink-0, #f2ede4);
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
  }
  .shortcut-english-btn {
    margin: 0 0 12px;
    background: var(--ga-selection-bg, #1f3170);
    border-color: var(--ga-selection-line, #5278ff);
    color: var(--ga-selection-ink, #e0e8ff);
  }
  .shortcut-english-btn span { font-weight: var(--ga-weight-body); opacity: 0.8; }
  .shortcut-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px 24px;
  }
  .shortcut-section h3 {
    margin: 0 0 6px;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking);
    text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
  }
  .shortcut-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 24px;
    color: var(--ga-ink-2, #89857e);
  }
  .shortcut-row span { flex: 1; margin-left: 6px; color: var(--ga-ink-1, #ada9a2); }
  .shortcut-row kbd {
    box-sizing: border-box;
    display: inline-grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: 3px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-0, #f2ede4);
  }
</style>
