<script lang="ts">
  // Linux, render core on a software rasterizer: check the machine, say what
  // was found and how to fix it, and offer Ghost Arcade 1.9, which draws
  // through OpenGL and runs where 2.x cannot reach the GPU.
  import { onMount } from 'svelte';
  import { invoke, openExternalUrl } from '$lib/bridge';
  import { diagnoseLinuxGpu, LEGACY_DOWNLOADS, type LinuxGpuDiagnosis, type LinuxGpuSetup } from '$lib/linuxGpuSetup';

  let { adapterName = null, onClose = () => {} }: { adapterName?: string | null; onClose?: () => void } = $props();

  const DISMISSED_KEY = 'ga.linuxGpuNoticeDismissed';
  let diagnosis = $state<LinuxGpuDiagnosis | null>(null);
  let copied = $state<string | null>(null);

  onMount(async () => {
    try { if (window.localStorage?.getItem(DISMISSED_KEY)) { onClose(); return; } } catch { /* storage unavailable */ }
    try {
      const setup = await invoke('linux_gpu_setup') as LinuxGpuSetup | null;
      if (setup) diagnosis = diagnoseLinuxGpu(setup);
      else onClose();
    } catch {
      onClose();
    }
  });

  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      copied = command;
      setTimeout(() => { if (copied === command) copied = null; }, 1600);
    } catch { /* clipboard unavailable: the command stays visible to select */ }
  }

  function close(persist: boolean) {
    if (persist) {
      try { window.localStorage?.setItem(DISMISSED_KEY, '1'); } catch { /* storage unavailable */ }
    }
    onClose();
  }
</script>

{#if diagnosis}
  <div class="linux-gpu-backdrop" role="presentation">
    <div class="linux-gpu-notice" role="alertdialog" aria-labelledby="linux-gpu-title" aria-describedby="linux-gpu-finding">
      <h3 id="linux-gpu-title">Your graphics card is not being used</h3>
      <p id="linux-gpu-finding" class="finding">{diagnosis.finding}</p>
      {#if adapterName}<p class="adapter">Drawing on: <code>{adapterName}</code></p>{/if}
      <ol class="steps">
        {#each diagnosis.steps as step, i (i)}
          <li>
            <span>{step.text}</span>
            {#if step.command}
              <div class="command">
                <code>{step.command}</code>
                <button type="button" onclick={() => copy(step.command!)}>{copied === step.command ? 'Copied' : 'Copy'}</button>
              </div>
            {/if}
          </li>
        {/each}
      </ol>
      <div class="downloads">
        <span>Ghost Arcade 1.9 for Linux:</span>
        <button type="button" class="primary" onclick={() => openExternalUrl(LEGACY_DOWNLOADS.appImage)}>Download AppImage</button>
        <button type="button" onclick={() => openExternalUrl(LEGACY_DOWNLOADS.deb)}>Download .deb (Ubuntu, Debian)</button>
      </div>
      <div class="actions">
        <button type="button" onclick={() => close(true)}>Don't show again</button>
        <button type="button" class="primary" onclick={() => close(false)}>Continue in software</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .linux-gpu-backdrop {
    position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.55); padding: 16px;
  }
  .linux-gpu-notice {
    width: min(620px, 100%); max-height: calc(100vh - 32px); overflow-y: auto;
    background: rgba(14, 15, 20, 0.98); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.6); color: #e8e8ee; font-size: 13px; padding: 20px 22px;
  }
  h3 { margin: 0 0 8px; font-size: 16px; }
  .finding { margin: 0 0 6px; line-height: 1.45; }
  .adapter { margin: 0 0 12px; color: #9da3b0; font-size: 12px; }
  .steps { margin: 0 0 14px; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; line-height: 1.4; }
  .command { display: flex; gap: 8px; align-items: center; margin-top: 5px; }
  code { font-family: var(--ga-font-mono, ui-monospace, monospace); font-size: 12px; }
  .command code {
    flex: 1; padding: 6px 8px; border-radius: 6px; background: #07080b; border: 1px solid rgba(255, 255, 255, 0.1);
    user-select: all; overflow-x: auto; white-space: nowrap;
  }
  .downloads, .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .downloads { padding: 12px 0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
  .downloads span { color: #9da3b0; margin-right: 4px; }
  .actions { justify-content: flex-end; padding-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
  button {
    background: none; border: 1px solid rgba(255, 255, 255, 0.18); color: #d5d8e0; border-radius: 6px;
    padding: 6px 12px; cursor: pointer; font-size: 12px; white-space: nowrap;
  }
  button:hover { border-color: rgba(255, 255, 255, 0.4); color: #fff; }
  button.primary { background: var(--ga-blue-a28, rgba(82, 120, 255, 0.28)); border-color: var(--ga-blue-300, #7d9bff); color: #fff; }
</style>
