<script lang="ts">
  /**
   * A cloud engine voice's scan: pick a .ply (the main process grants the
   * picked file; nothing else widens) or go back to the bundled default.
   * Shows the core's load state for the voice's layer.
   */
  import { nativeCloudLoadStates } from '../../renderer/manifestParams';
  import { engineScanFromPath, type EngineScan } from '../../music/engineVoices';

  let { scan, layerSuffix, onpick }: {
    scan: EngineScan | undefined;
    /** The end of the voice's layer id (`:<index>` or `:<item id>`), to find its load state. */
    layerSuffix: string;
    onpick: (scan: EngineScan | undefined) => void;
  } = $props();

  type Api = { invoke: (c: string, a?: unknown) => Promise<{ canceled: boolean; filePath: string | null }> };
  const api = (): Api | null => (typeof window !== 'undefined' ? ((window as unknown as { electronAPI?: Api }).electronAPI ?? null) : null);

  const load = $derived(
    Object.entries($nativeCloudLoadStates).find(([id]) => id.endsWith(layerSuffix))?.[1],
  );
  const status = $derived(
    !load ? '' : load.state === 'loading' ? 'Loading…' : load.state === 'ready' ? `Ready · ${load.points.toLocaleString()} points` : 'Could not read this file',
  );

  async function pick() {
    const a = api();
    if (!a) return;
    const r = await a.invoke('open_project_dialog', { title: 'Point cloud scan', filters: [{ name: 'Point cloud (.ply)', extensions: ['ply'] }] }).catch(() => null);
    if (r && !r.canceled && r.filePath) onpick(engineScanFromPath(r.filePath));
  }
</script>

<div class="scan">
  <span class="ga-eyebrow">Scan</span>
  <span class="name" title={scan?.assetRef.originalPath ?? 'The scan that comes with the app'}>{scan?.name ?? 'Default scan'}</span>
  {#if status}<span class="state" class:failed={load?.state === 'failed'} title={load?.state === 'failed' ? load.reason : undefined}>{status}</span>{/if}
  <button class="text-btn small" onclick={pick} disabled={!api()} title="Pick a .ply point cloud for this voice">Pick .ply…</button>
  {#if scan}<button class="text-btn small" onclick={() => onpick(undefined)} title="Go back to the scan that comes with the app">Default</button>{/if}
</div>

<style>
  .scan { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 4px 0; font-size: 11px; }
  .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .state { opacity: 0.75; }
  .state.failed { color: var(--ga-danger, #e5484d); opacity: 1; }
</style>
