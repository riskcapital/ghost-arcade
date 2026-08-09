<script lang="ts">
  import { isMac } from '$lib/bridge';
  export let visible = false;
  export let onClose: () => void;

  const mod = isMac ? 'Cmd' : 'Ctrl';
</script>

{#if visible}
  <div class="shortcut-overlay-backdrop" onclick={onClose}>
    <div class="shortcut-overlay" onclick={(e) => e.stopPropagation()}>
      <button class="shortcut-overlay-close" onclick={onClose}>&times;</button>
      <h2 class="shortcut-overlay-title">Keyboard Shortcuts</h2>
      <div class="shortcut-columns">
        <div class="shortcut-section">
          <h3>General</h3>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>N</kbd><span>New project</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>O</kbd><span>Open project</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>S</kbd><span>Save</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd><span>Save As</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>Z</kbd><span>Undo</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>Y</kbd><span>Redo</span></div>
        </div>
        <div class="shortcut-section">
          <h3>Layers</h3>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>C</kbd><span>Copy layer(s)</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>V</kbd><span>Paste layer(s)</span></div>
          <div class="shortcut-row"><kbd>{mod}</kbd>+<kbd>D</kbd><span>Duplicate layer</span></div>
          <div class="shortcut-row"><kbd>Delete</kbd><span>Remove layer</span></div>
          <div class="shortcut-row"><kbd>{isMac ? 'Fn+Delete' : 'Backspace'}</kbd><span>Remove layer</span></div>
        </div>
        <div class="shortcut-section">
          <h3>View</h3>
          <div class="shortcut-row"><kbd>Space</kbd><span>Hold to pan viewport</span></div>
          <div class="shortcut-row"><kbd>Esc</kbd><span>Exit drawing / edit mode</span></div>
          <div class="shortcut-row"><kbd>?</kbd><span>Toggle this help</span></div>
        </div>
        <div class="shortcut-section">
          <h3>Output</h3>
          <div class="shortcut-row"><kbd>B</kbd><span>Blackout toggle</span></div>
          <div class="shortcut-row"><kbd>T</kbd><span>Cycle test patterns</span></div>
        </div>
        <div class="shortcut-section">
          <h3>VJ Mode</h3>
          <div class="shortcut-row"><kbd>1</kbd>-<kbd>9</kbd><span>Trigger columns 1-9</span></div>
          <div class="shortcut-row"><kbd>0</kbd><span>Trigger column 10</span></div>
          <div class="shortcut-row"><kbd>F1</kbd>-<kbd>F8</kbd><span>Switch blocks 1-8</span></div>
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
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    cursor: pointer;
  }
  .shortcut-overlay {
    position: relative;
    background: #15151a;
    border: 1px solid rgba(187, 134, 252, 0.4);
    border-radius: 10px;
    padding: 24px 28px;
    max-width: 760px;
    max-height: calc(100vh - 96px);
    width: 100%;
    overflow-y: auto;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04);
    color: var(--text-primary, #ddd);
    font-family: var(--ga-font-ui, 'Geist', system-ui, sans-serif);
    cursor: default;
  }
  .shortcut-overlay-close {
    position: absolute;
    top: 10px;
    right: 12px;
    background: transparent;
    border: none;
    color: var(--text-muted, #888);
    font-size: 23px;
    cursor: pointer;
    width: 32px;
    height: 32px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
  .shortcut-overlay-close:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
  .shortcut-overlay-title {
    margin: 0 0 18px;
    font-size: 19px;
    font-weight: 600;
    color: #BB86FC;
  }
  .shortcut-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 18px 24px;
  }
  .shortcut-section h3 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: #BB86FC;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .shortcut-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 13px;
    color: var(--text-primary, #ccc);
  }
  .shortcut-row span { flex: 1; color: var(--text-secondary, #aaa); }
  .shortcut-row kbd {
    display: inline-block;
    padding: 2px 6px;
    background: #2a2a30;
    border: 1px solid #444;
    border-radius: 3px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 12px;
    color: var(--text-primary, #e0e0e0);
    min-width: 18px;
    text-align: center;
  }
</style>
