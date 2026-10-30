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
  .lut-control { display:flex; align-items:center; gap:8px; padding:8px 10px; margin:4px 0 12px; border:1px solid var(--ga-line-2); border-radius:var(--ga-r-soft); background:var(--ga-card); }
  input { display:none; }
  .lut-info { min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
  .lut-name { color:var(--ga-ink-0); font-size:var(--ga-text-control); font-weight:var(--ga-weight-control); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lut-detail { color:var(--ga-ink-2); font-size:var(--ga-text-meta); }
  button { height:var(--ga-control-h); padding:0 10px; border:1px solid var(--ga-line-2); border-radius:var(--ga-r-hard); color:var(--ga-ink-1); background:var(--ga-sub); font:inherit; font-size:var(--ga-text-control); font-weight:var(--ga-weight-control); white-space:nowrap; cursor:pointer; }
  button:hover:not(:disabled) { color:var(--ga-ink-0); border-color:var(--ga-line-3); } button:focus-visible { outline:2px solid var(--ga-focus); outline-offset:2px; } button:disabled { opacity:.5; cursor:wait; }
  .clear { width:var(--ga-control-h); padding:0; background:transparent; border-color:transparent; color:var(--ga-ink-2); font-size:16px; }
  .clear:hover:not(:disabled) { color:var(--ga-rec); border-color:transparent; }
  .lut-error { font-size:var(--ga-text-meta); color:var(--ga-rec); line-height:1.4; margin:4px 0 10px; }
</style>
