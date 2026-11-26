<script lang="ts">
  import { getRawElectronApi } from '$lib/bridge';
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
  const api = (): Api | null => (typeof window !== 'undefined' ? (getRawElectronApi() ?? null) : null);

  const load = $derived(
    Object.entries($nativeCloudLoadStates).find(([id]) => id.endsWith(layerSuffix))?.[1],
  );
  // Right after a pick the core still reports the scan it had: give the new
  // file a few seconds to reach it before calling a default scan a failure.
  let settled = $state(true);
  let firstRun = true;
  const scanPath = $derived(scan?.assetRef.originalPath);
  $effect(() => {
    void scanPath;
    if (firstRun) { firstRun = false; return; }
    settled = false;
    const timer = setTimeout(() => (settled = true), 4000);
    return () => clearTimeout(timer);
  });
  // A picked scan that still came back as the default was refused or never sent.
  const failed = $derived(!!load && (load.state === 'failed' || (settled && !!scan && load.state === 'ready' && !!load.isDefault)));
  const stale = $derived(!settled && !!scan && load?.state === 'ready' && !!load.isDefault);
  const failReason = $derived(load?.state === 'failed' ? load.reason : failed ? 'The file was not sent to the renderer' : undefined);
  const status = $derived(
    !load ? '' : failed ? 'Could not read this file' : load.state === 'loading' || stale ? 'Loading…' : load.state === 'ready' ? `Ready · ${load.points.toLocaleString()} points` : '',
  );
  $effect(() => {
    if (failed) console.warn('[EngineScanPicker] scan failed to load', scan?.assetRef.originalPath ?? '(default)', failReason);
  });

  async function pick() {
    const a = api();
    if (!a) return;
    const r = await a.invoke('open_project_dialog', { title: 'Point cloud scan', filters: [{ name: 'Point cloud (.ply)', extensions: ['ply'] }] }).catch(() => null);
    if (!r) console.warn('[EngineScanPicker] the file dialog failed');
    else if (!r.canceled && r.filePath) {
      if (/\.ply$/i.test(r.filePath)) onpick(engineScanFromPath(r.filePath));
      else console.warn('[EngineScanPicker] not a .ply file', r.filePath);
    }
  }
</script>

<div class="scan">
  <span class="ga-eyebrow">Scan</span>
  <span class="name" title={scan?.assetRef.originalPath ?? 'The scan that comes with the app'}>{scan?.name ?? 'Default scan'}</span>
  {#if status}<span class="state" class:failed title={failReason}>{status}</span>{/if}
  <button class="text-btn small" onclick={pick} disabled={!api()} title="Pick a .ply point cloud for this voice">Pick .ply…</button>
  {#if scan}<button class="text-btn small" onclick={() => onpick(undefined)} title="Go back to the scan that comes with the app">Default</button>{/if}
</div>

<style>
  .scan { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 4px 0; font-size: 11px; }
  .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .state { opacity: 0.75; }
  .state.failed { color: var(--ga-danger, #e5484d); opacity: 1; }
</style>
