<script lang="ts">
  /**
   * Settings > Show Control > Start at boot. Machine-level, not saved with
   * the project: stored by the main process (electron/show-startup.cjs).
   */
  import { onMount } from 'svelte';
  import { refreshShowStartup, showStartupInfo, updateShowStartup, type ShowStartupConfig } from '../../show/showStartup';

  let error = '';
  let busy = false;
  $: info = $showStartupInfo;
  $: config = info?.config ?? null;
  const desktop = typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: unknown }).electronAPI;

  onMount(() => {
    if (desktop) refreshShowStartup().catch((e) => (error = String(e?.message ?? e)));
  });

  async function patch(p: Partial<ShowStartupConfig>) {
    busy = true;
    error = '';
    try {
      await updateShowStartup(p);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function browse() {
    try {
      const api = (window as unknown as { electronAPI: { invoke: (c: string, a?: unknown) => Promise<{ canceled: boolean; filePath: string | null }> } }).electronAPI;
      const result = await api.invoke('open_project_dialog', { title: 'Project to open at start' });
      if (!result.canceled && result.filePath) await patch({ projectPath: result.filePath });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="st-panel" data-startup-settings>
  {#if !desktop}
    <p class="sc-hint">Start at boot needs the desktop app.</p>
  {:else if !config}
    <p class="sc-hint">Loading…</p>
  {:else}
    {#if info?.session.showMode}
      <div class="st-banner">This launch is running in show mode. Start the app with --no-show-mode to open it normally.</div>
    {/if}
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Launch at login</span>
        <span class="sc-hint">
          Starts Ghost Arcade when this computer's user logs in.
          {#if info?.loginItem.simulated}(Development build: the login item is simulated, nothing is registered with the system.){/if}
        </span>
      </div>
      <input type="checkbox" checked={config.launchAtLogin} disabled={busy} onchange={(e) => patch({ launchAtLogin: e.currentTarget.checked })} data-startup-login />
    </div>
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Show mode on every launch</span>
        <span class="sc-hint">Opens the project below, opens the outputs and starts the show, with no prompts.</span>
      </div>
      <input type="checkbox" checked={config.showMode} disabled={busy} onchange={(e) => patch({ showMode: e.currentTarget.checked })} data-startup-showmode />
    </div>
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Project</span>
        <span class="sc-hint st-path">{config.projectPath || 'None chosen: show mode keeps whatever opens by default.'}</span>
      </div>
      <div class="st-buttons">
        <button onclick={browse} disabled={busy}>Choose…</button>
        {#if config.projectPath}<button onclick={() => patch({ projectPath: '' })} disabled={busy}>Clear</button>{/if}
      </div>
    </div>
    <div class="sc-row">
      <div class="sc-label"><span class="sc-title">Open the outputs fullscreen</span></div>
      <input type="checkbox" checked={config.openOutputs} disabled={busy} onchange={(e) => patch({ openOutputs: e.currentTarget.checked })} />
    </div>
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Then</span>
        <span class="sc-hint">Choose "Nothing" to leave starting to the schedule.</span>
      </div>
      <select value={config.autoStart} disabled={busy} onchange={(e) => patch({ autoStart: e.currentTarget.value as ShowStartupConfig['autoStart'] })} data-startup-autostart>
        <option value="go">GO on the cue list</option>
        <option value="timeline">Play the show timeline</option>
        <option value="none">Nothing</option>
      </select>
    </div>
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Suppress prompts</span>
        <span class="sc-hint">No welcome, crash recovery, update or unsaved-changes dialogs; alerts become notifications.</span>
      </div>
      <input type="checkbox" checked={config.suppressPrompts} disabled={busy} onchange={(e) => patch({ suppressPrompts: e.currentTarget.checked })} />
    </div>
  {/if}
  {#if error}<p class="st-error">{error}</p>{/if}
</div>

<style>
  .st-panel { display: flex; flex-direction: column; gap: 4px; }
  .st-banner {
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid rgba(240, 198, 116, 0.4);
    background: rgba(240, 198, 116, 0.08);
    color: #f0c674;
    font-size: 12px;
  }
  .st-path { word-break: break-all; font-family: var(--font-jetbrains), monospace; }
  .st-buttons { display: flex; gap: 6px; }
  .st-buttons button {
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 4px;
    border: 1px solid #33333a;
    background: #15151b;
    color: #ddd;
    cursor: pointer;
  }
  .st-error { color: #ff8a80; font-size: 12px; }
</style>
