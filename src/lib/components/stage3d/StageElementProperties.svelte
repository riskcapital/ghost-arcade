<script lang="ts">
  /**
   * Inspector for a user-placed library element (truss, light, PA, deck).
   * Drives the stage3dScene store; the renderer rebuilds the element
   * when its params change and sync handles transform-only updates.
   */
  import { stage3dScene, setStage3DSelection } from '../../stage3d/store';
  import { ELEMENT_TYPES } from '../../stage3d/elementTypes';
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import { VJ_MIX_SOURCE_INDEX } from '../../types';
  import type { UserStageElement } from '../../stage3d/types';

  export let elementId: string;

  $: element = ($stage3dScene.userElements ?? []).find(e => e.id === elementId) ?? null;
  $: def = element ? ELEMENT_TYPES[element.type] : null;
  $: vjLayerCount = Math.max(0, $vjClipLauncher?.numLayers ?? 0);
  $: vjSourceOptions = [
    { value: 'solid', label: 'Solid color' },
    { value: 'master', label: 'Stage master' },
    { value: VJ_MIX_SOURCE_INDEX, label: 'VJ mix' },
    ...Array.from({ length: vjLayerCount }, (_, i) => ({ value: i, label: `VJ Layer ${i + 1}` })),
  ];

  function setPos(axis: 0 | 1 | 2, value: number) {
    if (!element) return;
    const p: [number, number, number] = [element.position[0], element.position[1], element.position[2]];
    p[axis] = value;
    stage3dScene.setUserElementTransform(elementId, { position: p });
  }

  function setRotationDeg(deg: number) {
    stage3dScene.setUserElementTransform(elementId, { rotationY: deg * Math.PI / 180 });
  }

  function setScale(s: number) {
    stage3dScene.setUserElementTransform(elementId, { scale: s });
  }

  function setParam(key: string, value: number | string) {
    stage3dScene.updateUserElementParams(elementId, { [key]: value });
  }

  function fieldValue(key: string): number | string {
    if (!element || !def) return '';
    return element.params[key] ?? def.defaults[key] ?? '';
  }

  function setSelectParam(key: string, raw: string, options: { value: number | string; label: string }[] = []) {
    const option = options.find(o => String(o.value) === raw);
    setParam(key, option?.value ?? raw);
  }

  function setVjSourceParam(key: string, raw: string) {
    if (raw === 'solid' || raw === 'master') {
      setParam(key, raw);
      return;
    }
    const numeric = Number(raw);
    setParam(key, Number.isFinite(numeric) ? numeric : raw);
  }

  function duplicate() {
    if (!element) return;
    const clone: UserStageElement = {
      ...element,
      id: `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      params: { ...element.params },
      position: [element.position[0] + 3, element.position[1], element.position[2] + 3],
    };
    stage3dScene.addUserElement(clone);
    setStage3DSelection(`element:${clone.id}`);
  }

  function remove() {
    if (!element) return;
    stage3dScene.removeUserElement(element.id);
    setStage3DSelection(null);
  }
</script>

{#if element && def}
<div class="props-body">
  <div class="ptitle">
    {def.label}
    <span class="badge">{element.type}</span>
  </div>

  <div class="field">
    <label>Position</label>
    <div class="xyz">
      <input type="number" step="0.5" value={element.position[0].toFixed(1)}
        oninput={(e) => setPos(0, parseFloat((e.target as HTMLInputElement).value) || 0)} />
      <input type="number" step="0.5" value={element.position[1].toFixed(1)}
        oninput={(e) => setPos(1, parseFloat((e.target as HTMLInputElement).value) || 0)} />
      <input type="number" step="0.5" value={element.position[2].toFixed(1)}
        oninput={(e) => setPos(2, parseFloat((e.target as HTMLInputElement).value) || 0)} />
    </div>
    <div class="xyz lab-row">
      <div class="lab">X</div><div class="lab">Y</div><div class="lab">Z</div>
    </div>
  </div>

  <div class="field">
    <label>Rotation Y <span class="v">{Math.round(element.rotationY * 180 / Math.PI)}°</span></label>
    <input type="range" min="-180" max="180" step="1"
      value={Math.round(element.rotationY * 180 / Math.PI)}
      oninput={(e) => setRotationDeg(parseFloat((e.target as HTMLInputElement).value))} />
  </div>

  <div class="field">
    <label>Scale <span class="v">{element.scale.toFixed(2)}×</span></label>
    <input type="range" min="0.2" max="4" step="0.05"
      value={element.scale}
      oninput={(e) => setScale(parseFloat((e.target as HTMLInputElement).value))} />
  </div>

  {#each def.fields as f}
    {#if f.type === 'color'}
      <div class="field">
        <label>{f.l}</label>
        <input type="color" value={fieldValue(f.k) as string}
          oninput={(e) => setParam(f.k, (e.target as HTMLInputElement).value)} />
      </div>
    {:else if f.type === 'vj-source'}
      <div class="field">
        <label>{f.l}</label>
        <select
          value={String(fieldValue(f.k) || 'solid')}
          onchange={(e) => setVjSourceParam(f.k, (e.target as HTMLSelectElement).value)}
        >
          {#each vjSourceOptions as opt}
            <option value={String(opt.value)}>{opt.label}</option>
          {/each}
        </select>
      </div>
    {:else if f.type === 'select'}
      <div class="field">
        <label>{f.l}</label>
        <select
          value={String(fieldValue(f.k))}
          onchange={(e) => setSelectParam(f.k, (e.target as HTMLSelectElement).value, f.options)}
        >
          {#each f.options ?? [] as opt}
            <option value={String(opt.value)}>{opt.label}</option>
          {/each}
        </select>
      </div>
    {:else}
      {@const cur = Number(fieldValue(f.k))}
      <div class="field">
        <label>{f.l} <span class="v">{f.int ? cur : (Math.round(cur * 100) / 100)}</span></label>
        <input type="range"
          min={f.min} max={f.max} step={f.step ?? 0.1}
          value={cur}
          oninput={(e) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            setParam(f.k, f.int ? Math.round(v) : v);
          }} />
      </div>
    {/if}
  {/each}

  <div class="prow">
    <button class="tbtn" onclick={duplicate}>⧉ Duplicate</button>
    <button class="tbtn danger" onclick={remove}>🗑 Delete</button>
  </div>
</div>
{:else}
  <div class="missing">Element no longer in scene.</div>
{/if}

<style>
  .props-body { display: flex; flex-direction: column; gap: 4px; }
  .ptitle {
    font-size: 16px;
    font-weight: 600;
    color: #fff;
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: #4af2ff;
    background: rgba(74, 242, 255, 0.1);
    padding: 3px 7px;
    border-radius: 4px;
    border: 1px solid rgba(74, 242, 255, 0.3);
  }
  .field { margin-bottom: 13px; }
  .field label {
    display: flex;
    justify-content: space-between;
    font-size: 12.5px;
    color: #c4ccd8;
    margin-bottom: 6px;
  }
  .field label .v {
    color: #4af2ff;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
  }
  .field input[type=range] {
    -webkit-appearance: none;
    width: 100%;
    height: 3px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.14);
    outline: none;
  }
  .field input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 13px; height: 13px;
    border-radius: 50%;
    background: #4af2ff;
    cursor: pointer;
    box-shadow: 0 0 8px rgba(74, 242, 255, 0.6);
  }
  .field input[type=range]::-moz-range-thumb {
    width: 13px; height: 13px;
    border: none; border-radius: 50%;
    background: #4af2ff;
    cursor: pointer;
  }
  .field input[type=color] {
    width: 100%; height: 30px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 7px;
    background: none;
    cursor: pointer;
    padding: 2px;
  }
  .field select {
    width: 100%;
    height: 31px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 7px;
    background: #10131a;
    color: #e9edf4;
    font: inherit;
    font-size: 12.5px;
    padding: 0 8px;
    cursor: pointer;
  }
  .field select:focus {
    outline: none;
    border-color: #4af2ff;
  }
  .xyz {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
  }
  .xyz input {
    font: inherit;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    background: #10131a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    color: #e9edf4;
    padding: 6px 7px;
    text-align: center;
    min-width: 0;
  }
  .xyz.lab-row { margin-top: 3px; }
  .xyz .lab {
    font-size: 10px;
    color: #8a93a3;
    text-align: center;
    letter-spacing: 0.1em;
  }
  .prow { display: flex; gap: 7px; margin-top: 6px; }
  .tbtn {
    flex: 1;
    font: inherit; font-size: 12.5px;
    color: #e9edf4;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 9px;
    cursor: pointer;
    text-align: center;
  }
  .tbtn:hover { border-color: #4af2ff; color: #4af2ff; }
  .tbtn.danger:hover { border-color: #ff5cb8; color: #ff5cb8; }
  .missing {
    color: #8a93a3;
    font-size: 13.5px;
    padding: 12px;
    text-align: center;
  }
</style>
