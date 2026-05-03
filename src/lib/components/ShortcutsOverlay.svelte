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
