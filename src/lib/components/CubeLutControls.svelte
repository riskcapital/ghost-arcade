<script lang="ts">
  import { onDestroy } from 'svelte';
  import { MAX_CUBE_LUT_TEXT_LENGTH, type CubeLut } from '../color/cubeLut';
  let { lut, contextKey, onChange }: { lut?: CubeLut; contextKey: string; onChange: (lut: CubeLut | undefined) => void } = $props();
  let input: HTMLInputElement;
  let busy = $state(false);
  let error = $state('');
  let worker: Worker | undefined;
  let generation = 0;
  $effect(() => { contextKey; generation++; worker?.terminate(); worker = undefined; busy = false; error = ''; });
  onDestroy(() => { generation++; worker?.terminate(); });
  async function load(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = '';
    if (!file) return;
    const token = ++generation;
    busy = true; error = '';
    try {
      if (!/\.cube$/i.test(file.name)) throw new Error('Choose a .cube LUT file.');
      if (file.size > MAX_CUBE_LUT_TEXT_LENGTH) throw new Error('Choose a LUT smaller than 32 MB.');
      const text = await file.text();
      if (token !== generation) return;
      worker = new Worker(new URL('../color/cubeLut.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ lut?: CubeLut; error?: string }>) => {
        if (token !== generation) return;
        worker?.terminate(); worker = undefined; busy = false;
        if (event.data.error) { error = event.data.error; return; }
        if (event.data.lut) onChange(event.data.lut);
      };
      worker.onerror = () => { if (token === generation) { error = 'Could not read this LUT. Try loading it again.'; busy = false; worker?.terminate(); worker = undefined; } };
      worker.postMessage({ text, name: file.name.replace(/\.cube$/i, '') });
    } catch (cause) {
      if (token === generation) { busy = false; error = cause instanceof Error ? cause.message : 'Could not load LUT.'; }
    }
  }
</script>
<div data-help-page="effects" class="lut-control">
  <input bind:this={input} type="file" accept=".cube" onchange={load} aria-label="Import color LUT" />
  <div class="lut-info"><span class="lut-name" title={lut?.title}>{lut ? (lut.title || 'Untitled LUT') : 'No LUT loaded'}</span><span class="lut-detail">{lut ? `${lut.size} × ${lut.size} × ${lut.size} · Saved with project` : '3D .cube · Original color until loaded'}</span></div>
  <button class="load" disabled={busy} onclick={() => input.click()}>{busy ? 'Loading…' : lut ? 'Replace' : 'Load .cube'}</button>
  {#if lut}<button class="clear" disabled={busy} aria-label="Remove color LUT" title="Remove LUT" onclick={() => { error = ''; onChange(undefined); }}>×</button>{/if}
</div>
{#if error}<p data-help-page="effects" class="lut-error" role="alert">{error}</p>{/if}
<style>
  .lut-control { display:flex; align-items:center; gap:8px; padding:10px; margin:4px 0 12px; border:1px solid #303744; border-radius:8px; background:#101319; }
  input { display:none; }
  .lut-info { min-width:0; flex:1; display:flex; flex-direction:column; gap:3px; }
  .lut-name { color:#e2e7ef; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lut-detail { color:#909ba9; font-size:10px; }
  button { padding:6px 9px; border:1px solid #3c527e; border-radius:6px; color:#e0e9ff; background:#182d57; font:inherit; font-size:11px; white-space:nowrap; cursor:pointer; }
  button:hover { background:#203c70; } button:focus-visible { outline:2px solid #7197e7; outline-offset:2px; } button:disabled { opacity:.5; cursor:wait; }
  .clear { background:transparent; border-color:transparent; color:#99a4b4; font-size:16px; padding:2px 5px; }
  .lut-error { font-size:11px; color:#edb6ac; line-height:1.4; margin:4px 0 10px; }
</style>
