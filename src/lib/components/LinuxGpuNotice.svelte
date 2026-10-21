<script lang="ts">
  // Linux, render core on a software rasterizer: check the machine, say what
  // was found and how to fix it, and offer Ghost Arcade 1.9, which draws
  // through OpenGL and runs where 2.x cannot reach the GPU. Shown before the
  // welcome screen (App holds the welcome back until this closes), and in
  // the same visual language so the first launch reads as one sequence.
  import { onMount } from 'svelte';
  import { invoke, openExternalUrl } from '$lib/bridge';
  import { diagnoseLinuxGpu, LEGACY_DOWNLOADS, type LinuxGpuDiagnosis, type LinuxGpuSetup } from '$lib/linuxGpuSetup';

  let {
    adapterName = null,
    onClose = () => {},
    previewSetup = null,
  }: { adapterName?: string | null; onClose?: () => void; previewSetup?: LinuxGpuSetup | null } = $props();

  const DISMISSED_KEY = 'ga.linuxGpuNoticeDismissed';
  let diagnosis = $state<LinuxGpuDiagnosis | null>(null);
  let copied = $state<string | null>(null);
  let ready = $state(false);

  // The 1.9 offer gets its own card below, so it is not repeated as a step.
  const fixSteps = $derived(diagnosis ? diagnosis.steps.filter((step) => !/Ghost Arcade 1\.9/.test(step.text)) : []);
  const onlyLegacy = $derived(!!diagnosis && fixSteps.length === 0);

  onMount(async () => {
    if (previewSetup) {
      diagnosis = diagnoseLinuxGpu(previewSetup);
    } else {
      try { if (window.localStorage?.getItem(DISMISSED_KEY)) { onClose(); return; } } catch { /* storage unavailable */ }
      try {
        const setup = await invoke('linux_gpu_setup') as LinuxGpuSetup | null;
        if (setup) diagnosis = diagnoseLinuxGpu(setup);
        else { onClose(); return; }
      } catch {
        onClose();
        return;
      }
    }
    requestAnimationFrame(() => { ready = true; });
  });

  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      copied = command;
      setTimeout(() => { if (copied === command) copied = null; }, 1600);
    } catch { /* clipboard unavailable: the command stays visible to select */ }
  }

  function close(persist: boolean) {
    if (persist && !previewSetup) {
      try { window.localStorage?.setItem(DISMISSED_KEY, '1'); } catch { /* storage unavailable */ }
    }
    onClose();
  }
</script>

{#if diagnosis}
  <div class="gpu-notice" class:ready role="presentation">
    <div class="gpu-card" role="alertdialog" aria-modal="true" aria-labelledby="gpu-title" aria-describedby="gpu-finding">
      <header class="gpu-head">
        <span class="gpu-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2" /><rect x="8" y="9.5" width="8" height="5" rx="1" /><path d="M7 3v3M12 3v3M17 3v3M7 18v3M12 18v3M17 18v3" /></svg>
          <span class="gpu-alert">!</span>
        </span>
        <div>
          <p class="eyebrow">Graphics check</p>
          <h2 id="gpu-title">Your graphics card is not being used</h2>
        </div>
      </header>

      <p id="gpu-finding" class="finding">{diagnosis.finding}</p>
      {#if adapterName}
        <p class="adapter">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>
          <span>Drawing on <code>{adapterName}</code>, so visuals will be slow.</span>
        </p>
      {/if}

      {#if fixSteps.length}
        <section class="block">
          <h3>Fix it on this machine</h3>
          <ol class="steps">
            {#each fixSteps as step, i (i)}
              <li>
                <span class="num" aria-hidden="true">{i + 1}</span>
                <div class="step-body">
                  <span>{step.text}</span>
                  {#if step.command}
                    <div class="command">
                      <code>{step.command}</code>
                      <button type="button" class="copy" class:done={copied === step.command} onclick={() => copy(step.command!)}>
                        {#if copied === step.command}
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>Copied
                        {:else}
                          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>Copy
                        {/if}
                      </button>
                    </div>
                  {/if}
                </div>
              </li>
            {/each}
          </ol>
        </section>
      {/if}

      <section class="legacy" class:solo={onlyLegacy}>
        <div class="legacy-text">
          <p class="legacy-eyebrow">{onlyLegacy ? 'Recommended' : 'Or skip the setup'}</p>
          <h3>Ghost Arcade Studio runs on this machine as it is</h3>
          <p>It draws through OpenGL, so it works without these drivers. It installs beside Pro, and your shaders and projects open in both.</p>
        </div>
        <div class="legacy-actions">
          <button type="button" class="primary" onclick={() => openExternalUrl(LEGACY_DOWNLOADS.appImage)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></svg>
            Download AppImage
          </button>
          <button type="button" onclick={() => openExternalUrl(LEGACY_DOWNLOADS.deb)}>Download .deb (Ubuntu, Debian)</button>
        </div>
      </section>

      <footer class="actions">
        <button type="button" class="ghost" onclick={() => close(true)}>Don't show again</button>
        <button type="button" class="continue" onclick={() => close(false)}>Continue in software</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .gpu-notice {
    position: fixed;
    inset: 0;
    /* Above the welcome screen (20000) and the tour; below Settings is not
       a concern since nothing else opens before this is answered. */
    z-index: 22000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
    overflow: auto;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(255, 170, 90, 0.10), transparent 60%),
      rgba(5, 6, 10, 0.86);
    backdrop-filter: blur(10px);
    color: #e9edf5;
    opacity: 0;
    transition: opacity 0.4s ease;
  }
  .gpu-notice.ready { opacity: 1; }

  .gpu-card {
    width: min(640px, 100%);
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    box-sizing: border-box;
    padding: 26px 26px 20px;
    border-radius: 18px;
    background: rgba(14, 16, 22, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.09);
    box-shadow: 0 40px 120px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 190, 120, 0.04) inset;
    transform: translateY(12px) scale(0.985);
    transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .ready .gpu-card { transform: none; }

  .gpu-head { display: flex; gap: 14px; align-items: center; margin-bottom: 14px; }
  .gpu-icon {
    position: relative;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 13px;
    background: linear-gradient(135deg, rgba(255, 176, 96, 0.22), rgba(255, 120, 90, 0.12));
    border: 1px solid rgba(255, 176, 96, 0.35);
  }
  .gpu-icon svg { width: 24px; height: 24px; fill: none; stroke: #ffc58a; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .gpu-alert {
    position: absolute;
    right: -5px;
    top: -5px;
    width: 18px;
    height: 18px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    font: 800 11px/1 system-ui, sans-serif;
    color: #1a0d03;
    background: #ffb060;
    box-shadow: 0 0 0 3px rgba(14, 16, 22, 0.94);
  }
  .eyebrow, .legacy-eyebrow {
    margin: 0 0 3px;
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #ffc58a;
  }
  h2 { margin: 0; font-size: 21px; line-height: 1.25; font-weight: 700; letter-spacing: -0.01em; color: #f4f6fb; }
  h3 { margin: 0 0 10px; font-size: 13px; font-weight: 650; color: #e9edf5; }

  .finding { margin: 0 0 10px; font-size: 13.5px; line-height: 1.55; color: #c3cad8; }
  .adapter {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 18px;
    font-size: 12px;
    color: #98a1b3;
  }
  .adapter svg { width: 15px; height: 15px; flex: 0 0 auto; fill: none; stroke: #98a1b3; stroke-width: 1.8; stroke-linecap: round; }
  code { font-family: var(--ga-font-mono, ui-monospace, 'SF Mono', Menlo, monospace); font-size: 12px; }
  .adapter code { color: #e9edf5; padding: 1px 6px; border-radius: 5px; background: rgba(255, 255, 255, 0.06); }

  .block { margin-bottom: 16px; }
  .steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .steps li { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; font-size: 13px; line-height: 1.5; color: #d4dae5; }
  .num {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-top: 1px;
    border-radius: 7px;
    font-size: 11.5px;
    font-weight: 700;
    color: #e9edf5;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .step-body { min-width: 0; display: grid; gap: 7px; }
  .command { display: flex; gap: 8px; align-items: stretch; }
  .command code {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: #07080b;
    border: 1px solid rgba(255, 255, 255, 0.09);
    color: #e9edf5;
    user-select: all;
    overflow-x: auto;
    white-space: nowrap;
  }

  .legacy {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 14px;
    align-items: center;
    padding: 16px;
    margin-bottom: 16px;
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(110, 145, 255, 0.14), rgba(170, 120, 255, 0.10));
    border: 1px solid rgba(143, 180, 255, 0.3);
  }
  .legacy.solo { border-color: rgba(143, 180, 255, 0.55); box-shadow: 0 10px 34px rgba(80, 110, 255, 0.16); }
  .legacy .legacy-eyebrow { color: var(--ga-blue-200, #a8bcff); }
  .legacy h3 { margin: 0 0 4px; font-size: 14.5px; color: #f1f4fa; }
  .legacy p { margin: 0; font-size: 12.5px; line-height: 1.5; color: #aab3c4; }
  .legacy-actions { display: grid; gap: 7px; justify-items: stretch; }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font: inherit;
    font-size: 12.5px;
    padding: 8px 13px;
    border-radius: 9px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.04);
    color: #dfe4ee;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover { border-color: rgba(255, 255, 255, 0.32); color: #fff; }
  button svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  button.primary {
    border: none;
    color: #0b0f1d;
    font-weight: 650;
    background: linear-gradient(135deg, #8fa8ff, #b993ff);
    box-shadow: 0 6px 18px rgba(110, 120, 255, 0.35);
  }
  button.copy { padding: 0 11px; font-size: 12px; }
  button.copy.done { color: #46d18a; border-color: rgba(70, 209, 138, 0.45); }

  .actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }
  button.ghost { border-color: transparent; background: none; color: #8a93a5; padding-left: 0; }
  button.ghost:hover { color: #d4dae5; }
  button.continue { font-weight: 600; }

  @media (max-width: 560px) {
    .legacy { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    .gpu-notice, .gpu-card { transition: none; }
  }
</style>
