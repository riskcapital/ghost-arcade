<script lang="ts">
  /**
   * Scene-wide lighting controls for Ghost Stage.
   *
   * Drives stage3dScene.lighting which the renderer applies per frame
   * on top of the active venue's baseline:
   *   • Room intensity   → multiplier on hemi/key/fill/rim lights
   *   • Floor darkness   → lerp floor colour to black
   *   • Screen boost     → multiplier on LED emissive
   *   • Exposure         → tone-mapping exposure (mostly a no-op since
   *                        we run NoToneMapping, kept for future ACES)
   *   • Truss colour     → repaints every tagged truss material live
   *   • Key X/Y/Z        → key directional light position offset
   *   • Key colour       → key light colour override
   *   • Shadows toggle   → disables shadow map rendering on every light
   */
  import { stage3dScene } from '../../stage3d/store';
  import { DEFAULT_LIGHTING, type Stage3DLighting, type Vec3 } from '../../stage3d/types';

  $: lighting = ({ ...DEFAULT_LIGHTING, ...($stage3dScene.lighting ?? {}) }) as Stage3DLighting;

  function patch<K extends keyof Stage3DLighting>(field: K, value: Stage3DLighting[K]) {
    stage3dScene.setLighting({ [field]: value } as Partial<Stage3DLighting>);
  }
  function setKeyAxis(axis: 0 | 1 | 2, value: number) {
    const cur = lighting.keyPosition ?? [18, 34, 24];
    const next: Vec3 = [cur[0], cur[1], cur[2]];
    next[axis] = value;
    patch('keyPosition', next);
  }
  function reset() { stage3dScene.resetLighting(); }
  function resetTruss() { stage3dScene.setLighting({ trussColor: '' }); }
  function resetKeyPosition() { stage3dScene.setLighting({ keyPosition: null }); }
  function resetKeyColor() { stage3dScene.setLighting({ keyColor: '' }); }
</script>

<div class="lighting">
  <div class="head">
    <span>Lighting</span>
    <button class="reset" onclick={reset} title="Reset to venue defaults">Reset</button>
  </div>

  <label class="row">
    <span>Room intensity</span>
    <input type="range" min="0" max="2.5" step="0.05"
      value={lighting.roomIntensity}
      oninput={(e) => patch('roomIntensity', parseFloat((e.target as HTMLInputElement).value))} />
    <span class="val">{lighting.roomIntensity.toFixed(2)}×</span>
  </label>

  <label class="row">
    <span>Floor darkness</span>
    <input type="range" min="0" max="1" step="0.02"
      value={lighting.floorDarkness}
      oninput={(e) => patch('floorDarkness', parseFloat((e.target as HTMLInputElement).value))} />
    <span class="val">{Math.round(lighting.floorDarkness * 100)}%</span>
  </label>

  <label class="row">
    <span>Screen boost</span>
    <input type="range" min="0.2" max="20" step="0.1"
      value={lighting.screenBoost}
      oninput={(e) => patch('screenBoost', parseFloat((e.target as HTMLInputElement).value))} />
    <span class="val">{lighting.screenBoost.toFixed(1)}×</span>
  </label>

  <label class="row">
    <span>Screen glow</span>
    <input type="range" min="0" max="5" step="0.05"
      value={lighting.screenLightInfluence}
      oninput={(e) => patch('screenLightInfluence', parseFloat((e.target as HTMLInputElement).value))} />
    <span class="val">{lighting.screenLightInfluence.toFixed(2)}×</span>
  </label>

  <label class="row">
    <span>Exposure</span>
    <input type="range" min="0.1" max="3" step="0.05"
      value={lighting.exposure || 1}
      oninput={(e) => patch('exposure', parseFloat((e.target as HTMLInputElement).value))} />
    <span class="val">{(lighting.exposure || 1).toFixed(2)}×</span>
  </label>

  <div class="divider"></div>

  <div class="sub-head">
    <span>Key light</span>
    <button class="mini" onclick={resetKeyPosition} title="Restore venue position">↺ pos</button>
    <button class="mini" onclick={resetKeyColor} title="Restore venue colour">↺ col</button>
  </div>

  {#each [['X', 0], ['Y', 1], ['Z', 2]] as [label, idx]}
    <label class="row">
      <span>Key {label}</span>
      <input type="range" min="-80" max="80" step="1"
        value={(lighting.keyPosition ?? [18, 34, 24])[idx as number]}
        oninput={(e) => setKeyAxis(idx as 0 | 1 | 2, parseFloat((e.target as HTMLInputElement).value))} />
      <span class="val">{(lighting.keyPosition ?? [18, 34, 24])[idx as number].toFixed(0)}</span>
    </label>
  {/each}

  <label class="row truss-row">
    <span>Key colour</span>
    <input type="color"
      value={lighting.keyColor || '#ffffff'}
      oninput={(e) => patch('keyColor', (e.target as HTMLInputElement).value)} />
    <button class="mini" onclick={resetKeyColor} title="Reset">↺</button>
  </label>

  <label class="row toggle-row">
    <span>Shadows</span>
    <input type="checkbox" checked={lighting.shadows}
      onchange={(e) => patch('shadows', (e.target as HTMLInputElement).checked)} />
    <span class="val">{lighting.shadows ? 'on' : 'off'}</span>
  </label>

  <div class="divider"></div>

  <label class="row truss-row">
    <span>Truss colour</span>
    <input type="color"
      value={lighting.trussColor || '#9aa3ad'}
      oninput={(e) => patch('trussColor', (e.target as HTMLInputElement).value)} />
    <button class="mini" onclick={resetTruss} title="Restore venue baseline">↺</button>
  </label>
</div>

<style>
  .lighting {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 4px 0 8px;
  }
  .head, .sub-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: #8a93a3;
    margin-bottom: 2px;
  }
  .sub-head { color: #6c7280; }
  .reset {
    font: inherit;
    font-size: 12px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #c4ccd8;
    padding: 3px 8px;
    border-radius: 5px;
    cursor: pointer;
    text-transform: none;
    letter-spacing: 0.04em;
  }
  .reset:hover { color: #4af2ff; border-color: #4af2ff; }
  .divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 3px 0;
  }
  .row {
    display: grid;
    grid-template-columns: 92px 1fr 52px;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #c4ccd8;
  }
  .row input[type=range] {
    -webkit-appearance: none;
    width: 100%;
    height: 3px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.14);
    outline: none;
  }
  .row input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 13px; height: 13px;
    border-radius: 50%;
    background: #4af2ff;
    cursor: pointer;
    box-shadow: 0 0 8px rgba(74, 242, 255, 0.6);
  }
  .row input[type=range]::-moz-range-thumb {
    width: 13px; height: 13px;
    border: none; border-radius: 50%;
    background: #4af2ff;
    cursor: pointer;
  }
  .val {
    text-align: right;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: #4af2ff;
  }
  .truss-row {
    grid-template-columns: 92px 1fr 28px;
  }
  .truss-row input[type=color] {
    width: 100%;
    height: 26px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 5px;
    background: none;
    cursor: pointer;
    padding: 2px;
  }
  .toggle-row {
    grid-template-columns: 92px 1fr 52px;
  }
  .toggle-row input[type=checkbox] {
    width: 16px;
    height: 16px;
    accent-color: #4af2ff;
    cursor: pointer;
  }
  .mini {
    font: inherit;
    font-size: 12px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #c4ccd8;
    border-radius: 5px;
    height: 22px;
    cursor: pointer;
    padding: 0 6px;
  }
  .mini:hover { color: #4af2ff; border-color: #4af2ff; }
</style>
