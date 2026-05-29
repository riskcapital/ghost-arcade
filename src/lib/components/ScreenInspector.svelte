<script lang="ts">
  /**
   * ScreenInspector — bottom half of the Screens left-sidebar panel.
   *
   * Renders editable controls for the currently-selected Screen:
   *   - Identity (name, target type + spout sender name OR display picker)
   *   - Warp mode (rect / corners / mesh) + reset-warp action
   *   - Edge blend per edge + per-edge gamma overrides
   *   - Black-level lift (RGB + feather)
   *   - Color correction (brightness / contrast / gamma)
   *   - Rotation
   *   - Stage effect bind (drives screen brightness from a procedural
   *     stage-effect pattern)
   *   - Per-screen effect chain (Effect[] post-process)
   *
   * All edits go through `screenActions.update(id, partial)` so the
   * settings store is the single mutation point. The Screen Editor
   * canvas overlay (in Canvas.svelte / a sibling component) reads the
   * same store, so warp-handle drags and slider edits both reflect
   * live on the editor canvas.
   */
  import type { OutputSlice } from '../stores/settings';
  import { screenActions } from '../stores/screens';
  import { isDesktopApp, getTextureShareLabel } from '$lib/bridge';

  type DisplayInfo = {
    id: number; label: string; width: number; height: number;
    x: number; y: number; isPrimary: boolean; scaleFactor: number;
  };

  interface Props {
    screen: OutputSlice;
    displays: DisplayInfo[];
    openWindowIds: string[];
    onOpenOnDisplay: (s: OutputSlice) => void;
    onCloseOnDisplay: (s: OutputSlice) => void;
    onRefreshDisplays: () => void;
  }
  let { screen, displays, openWindowIds, onOpenOnDisplay, onCloseOnDisplay, onRefreshDisplays }: Props = $props();

  const tsLabel = getTextureShareLabel();

  function update(partial: Partial<OutputSlice>) {
    screenActions.update(screen.id, partial);
  }
</script>

<div class="inspector">
  <!-- Identity & target ─────────────────────────────────────────── -->
  <section class="sec">
    <input
      class="name-input"
      value={screen.name}
      onchange={(e) => update({ name: (e.target as HTMLInputElement).value })}
      placeholder="Screen name"
    />

    <label class="field">
      <span class="lbl">Send to</span>
      <select
        value={screen.targetType ?? 'sender'}
        onchange={(e) => {
          const t = (e.target as HTMLSelectElement).value as 'sender' | 'display';
          update({ targetType: t, ...(t === 'sender' ? { displayId: null } : {}) });
        }}
      >
        <option value="sender">{tsLabel} / NDI sender</option>
        <option value="display" disabled={!isDesktopApp}>Physical display</option>
      </select>
    </label>

    {#if (screen.targetType ?? 'sender') === 'display'}
      <label class="field">
        <span class="lbl">Display</span>
        <select
          value={screen.displayId ?? ''}
          onchange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            update({ displayId: v === '' ? null : parseInt(v) });
          }}
        >
          <option value="">— pick —</option>
          {#each displays as d}
            <option value={d.id}>{d.label || `Display ${d.id}`} ({d.width}×{d.height}{d.isPrimary ? ' · primary' : ''})</option>
          {/each}
        </select>
        <button class="icon-btn" title="Refresh display list" onclick={onRefreshDisplays}>↻</button>
      </label>
      {#if screen.displayId != null && displays.find(d => d.id === screen.displayId)?.isPrimary}
        <p class="warn-banner">
          ⚠ This is your primary display. Opening here will cover the editor. Press <kbd>Esc</kbd> in the slice window to close it.
        </p>
      {/if}
      <div class="field">
        <span class="lbl">&nbsp;</span>
        {#if openWindowIds.includes(screen.id)}
          <button class="full-btn danger" onclick={() => onCloseOnDisplay(screen)}>Close on display</button>
        {:else}
          <button class="full-btn" disabled={screen.displayId == null} onclick={() => onOpenOnDisplay(screen)}>Open on display</button>
        {/if}
      </div>
    {:else}
      <label class="field">
        <span class="lbl">Sender</span>
        <input
          type="text"
          value={screen.spoutName}
          oninput={(e) => update({ spoutName: (e.target as HTMLInputElement).value })}
        />
      </label>
    {/if}
  </section>

  <!-- Slice ────────────────────────────────────────────────────────
       Per-Screen geometric warp (corners/mesh) was removed — all
       geometric warping is now done ONCE, globally, by the Master Warp.
       A Screen is simply a rectangular SLICE of that warped total
       output. Set the slice rectangle by dragging on the editor canvas
       or the top-down preview; only orientation lives here. -->
  <section class="sec">
    <h4>Slice</h4>
    <p class="hint">This screen takes a rectangular slice of the total (master-warped) output. Drag its rectangle on the canvas or the preview above to set it.</p>
    <label class="field">
      <span class="lbl">Rotation</span>
      <select value={screen.rotation} onchange={(e) => update({ rotation: parseInt((e.target as HTMLSelectElement).value) as 0 | 90 | 180 | 270 })}>
        <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
      </select>
    </label>
  </section>

  <!-- Edge blend ───────────────────────────────────────────────── -->
  <section class="sec">
    <h4>Edge Blend</h4>
    <div class="quad">
      <label><span>L</span><input type="range" min="0" max="0.5" step="0.01" value={screen.edgeBlendLeft}
        oninput={(e) => update({ edgeBlendLeft: parseFloat((e.target as HTMLInputElement).value) })} />
        <em>{Math.round(screen.edgeBlendLeft * 100)}%</em></label>
      <label><span>R</span><input type="range" min="0" max="0.5" step="0.01" value={screen.edgeBlendRight}
        oninput={(e) => update({ edgeBlendRight: parseFloat((e.target as HTMLInputElement).value) })} />
        <em>{Math.round(screen.edgeBlendRight * 100)}%</em></label>
      <label><span>T</span><input type="range" min="0" max="0.5" step="0.01" value={screen.edgeBlendTop}
        oninput={(e) => update({ edgeBlendTop: parseFloat((e.target as HTMLInputElement).value) })} />
        <em>{Math.round(screen.edgeBlendTop * 100)}%</em></label>
      <label><span>B</span><input type="range" min="0" max="0.5" step="0.01" value={screen.edgeBlendBottom}
        oninput={(e) => update({ edgeBlendBottom: parseFloat((e.target as HTMLInputElement).value) })} />
        <em>{Math.round(screen.edgeBlendBottom * 100)}%</em></label>
      <label><span>γ</span><input type="range" min="1" max="4" step="0.1" value={screen.edgeBlendGamma}
        oninput={(e) => update({ edgeBlendGamma: parseFloat((e.target as HTMLInputElement).value) })} />
        <em>{screen.edgeBlendGamma.toFixed(1)}</em></label>
    </div>
  </section>

  <!-- Black level ─────────────────────────────────────────────── -->
  <section class="sec">
    <h4>Black-Level Lift</h4>
    <div class="quad">
      <label><span>R</span><input type="range" min="0" max="0.1" step="0.001" value={screen.blackLevelR ?? 0}
        oninput={(e) => update({ blackLevelR: parseFloat((e.target as HTMLInputElement).value) })} />
        <em>{((screen.blackLevelR ?? 0) * 100).toFixed(1)}%</em></label>
      <label><span>G</span><input type="range" min="0" max="0.1" step="0.001" value={screen.blackLevelG ?? 0}
        oninput={(e) => update({ blackLevelG: parseFloat((e.target as HTMLInputElement).value) })} />
        <em>{((screen.blackLevelG ?? 0) * 100).toFixed(1)}%</em></label>
      <label><span>B</span><input type="range" min="0" max="0.1" step="0.001" value={screen.blackLevelB ?? 0}
        oninput={(e) => update({ blackLevelB: parseFloat((e.target as HTMLInputElement).value) })} />
        <em>{((screen.blackLevelB ?? 0) * 100).toFixed(1)}%</em></label>
      <label><span>Feather</span><input type="range" min="0" max="1" step="0.01" value={screen.blackLevelFeather ?? 0.5}
        oninput={(e) => update({ blackLevelFeather: parseFloat((e.target as HTMLInputElement).value) })} />
        <em>{Math.round((screen.blackLevelFeather ?? 0.5) * 100)}%</em></label>
    </div>
  </section>

  <!-- Color correction ─────────────────────────────────────────── -->
  <section class="sec">
    <h4>Color Correction</h4>
    <div class="quad">
      <label><span>Brt</span><input type="range" min="0" max="2" step="0.01" value={screen.brightness}
        oninput={(e) => update({ brightness: parseFloat((e.target as HTMLInputElement).value) })} />
        <em>{(screen.brightness * 100).toFixed(0)}%</em></label>
      <label><span>Con</span><input type="range" min="0" max="2" step="0.01" value={screen.contrast}
        oninput={(e) => update({ contrast: parseFloat((e.target as HTMLInputElement).value) })} />
        <em>{(screen.contrast * 100).toFixed(0)}%</em></label>
      <label><span>Gam</span><input type="range" min="0.2" max="5" step="0.05" value={screen.gamma}
        oninput={(e) => update({ gamma: parseFloat((e.target as HTMLInputElement).value) })} />
        <em>{screen.gamma.toFixed(2)}</em></label>
    </div>
  </section>

</div>

<style>
  .inspector {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sec {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 5px;
    padding: 8px;
  }
  .sec h4 {
    margin: 0 0 8px 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #aaa;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .name-input {
    width: 100%;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #eee;
    font-size: 13px;
    margin-bottom: 8px;
    font-family: inherit;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .field .lbl {
    flex: 0 0 60px;
    color: #888;
    font-size: 11px;
  }
  .field input[type="text"],
  .field input[type="number"],
  .field select {
    flex: 1;
    padding: 4px 6px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #ddd;
    font-size: 11px;
    font-family: inherit;
  }
  .icon-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #ccc;
    cursor: pointer;
    padding: 3px 8px;
    font-size: 12px;
  }
  .full-btn {
    flex: 1;
    padding: 5px 8px;
    background: rgba(187, 134, 252, 0.08);
    border: 1px solid rgba(187, 134, 252, 0.25);
    border-radius: 3px;
    color: #BB86FC;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
  }
  .full-btn:hover:not(:disabled) { background: rgba(187, 134, 252, 0.15); }
  .full-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .full-btn.ghost {
    background: transparent;
    color: #888;
    border-color: rgba(255, 255, 255, 0.08);
  }
  .full-btn.danger {
    background: rgba(255, 100, 100, 0.08);
    border-color: rgba(255, 100, 100, 0.3);
    color: #ff8080;
  }
  .hint {
    margin: 4px 0 0 0;
    color: #666;
    font-size: 10.5px;
    line-height: 1.4;
  }
  .warn-banner {
    margin: 6px 0 0 0;
    padding: 6px 8px;
    background: rgba(255, 180, 60, 0.12);
    border: 1px solid rgba(255, 180, 60, 0.35);
    border-radius: 4px;
    color: #ffc875;
    font-size: 11px;
    line-height: 1.4;
  }
  .warn-banner kbd {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    padding: 0 5px;
    font-family: ui-monospace, monospace;
    font-size: 10px;
  }
</style>
