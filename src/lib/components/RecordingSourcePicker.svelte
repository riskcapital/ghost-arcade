<!--
  RecordingSourcePicker — the small caret beside REC.

  Picks what a desktop recording captures (the composition, one VJ layer,
  one mapping layer, or one Screen's output) and the file it writes
  (H.264 MP4 by default; ProRes / HAP when the bundled FFmpeg has them,
  ProRes 4444 and HAP Alpha keeping transparency). The source is per
  session; the codec is saved in Settings > Recording.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { project } from '../stores/layers';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { settings } from '../stores/settings';
  import { invoke, isElectron } from '../bridge';
  import {
    listRecordingSources,
    mergeRecordingCodecAvailability,
    recordingCodecOption,
    recordingRequest,
    recordingSource,
    recordingSourceKey,
    resolveRecordingSourceChoice,
    type RecordingCodecOption,
  } from '../recording/recordingSources';

  export let disabled = false;
  export let compact = false;

  let open = false;
  let rootEl: HTMLDivElement | null = null;
  let codecs: RecordingCodecOption[] = mergeRecordingCodecAvailability(null);

  $: vjState = $vjClipLauncher;
  $: vjRows = vjState && (vjState.isOpen || vjState.isLive)
    ? Array.from({ length: vjState.numLayers ?? 0 }, (_, index) => ({
        index,
        name: vjState.layerStates?.[index]?.activeClip?.name ?? null,
      }))
    : [];
  $: sources = listRecordingSources({
    vjLayers: vjRows,
    layers: ($project?.layers ?? []).map((layer: any) => ({ id: layer.id, name: layer.name, type: layer.type })),
    screens: ($settings?.output?.slices ?? []).map((slice: any) => ({ id: slice.id, name: slice.name, enabled: slice.enabled })),
  });
  $: chosen = resolveRecordingSourceChoice($recordingSource, sources);
  $: chosenKey = recordingSourceKey(chosen);
  $: codecId = recordingCodecOption($settings?.recording?.nativeCodec).id;
  $: request = recordingRequest(chosen, codecId);
  $: groups = ['Composition', 'VJ layers', 'Layers', 'Screens']
    .map(group => ({ group, options: sources.filter(option => option.group === group) }))
    .filter(entry => entry.options.length > 0);
  $: summary = `${request.label} · ${request.codec.label}`;
  $: screenAlphaNote = chosen.kind === 'screen' && request.codec.alpha;

  async function loadCodecs() {
    if (!isElectron) return;
    try {
      const result = await invoke<{ codecs?: Array<{ id: string; available?: boolean; reason?: string }> }>('native_recording_codecs');
      codecs = mergeRecordingCodecAvailability(result?.codecs ?? null);
    } catch {
      /* H.264 stays available */
    }
  }

  function toggle() {
    if (disabled) return;
    open = !open;
    if (open) void loadCodecs();
  }

  function onWindowPointer(event: PointerEvent) {
    if (open && rootEl && !rootEl.contains(event.target as Node)) open = false;
  }

  function onKey(event: KeyboardEvent) {
    if (open && event.key === 'Escape') open = false;
  }

  onMount(() => {
    void loadCodecs();
    window.addEventListener('pointerdown', onWindowPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onWindowPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  });
</script>

<div class="rec-source" class:compact bind:this={rootEl}>
  <button
    class="rec-source-toggle"
    class:active={chosen.kind !== 'composition' || codecId !== 'h264'}
    onclick={toggle}
    {disabled}
    title={`Recording: ${summary}`}
    aria-label="Recording source and format"
    aria-expanded={open}
    data-testid="rec-source-toggle"
  >
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </button>
  {#if open}
    <div class="rec-source-pop" role="dialog" aria-label="Recording source and format">
      <div class="rec-source-section" role="group" aria-label="Record">
        {#each groups as entry}
          <div class="rec-source-group">{entry.group}</div>
          {#each entry.options as option}
            <button
              class="rec-source-item"
              class:selected={option.key === chosenKey}
              onclick={() => recordingSource.set(option.source)}
              data-rec-source={option.key}
            >{option.label}</button>
          {/each}
        {/each}
      </div>
      <div class="rec-source-section" role="group" aria-label="Format">
        <div class="rec-source-group">Format</div>
        {#each codecs as codec}
          <button
            class="rec-source-item"
            class:selected={codec.id === codecId}
            disabled={!codec.available}
            title={codec.reason ?? ''}
            onclick={() => settings.setNativeRecordingCodec(codec.id)}
            data-rec-codec={codec.id}
          >{codec.label}{codec.available ? '' : ' (unavailable)'}</button>
        {/each}
      </div>
      <p class="rec-source-hint">
        {#if screenAlphaNote}
          A Screen records what its projector shows, so it has no transparency.
        {:else if request.alpha}
          Empty areas record transparent.
        {:else if chosen.kind === 'layer'}
          The layer on its own at full opacity, over black, with its effects.
        {:else if chosen.kind === 'screen'}
          Exactly what this Screen shows, after crop, warp, masks and blend.
        {:else}
          The composition, as it goes to the output.
        {/if}
      </p>
    </div>
  {/if}
</div>

<style>
  .rec-source {
    position: relative;
    display: flex;
    align-items: center;
  }
  .rec-source-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 32px;
    padding: 0;
    background: transparent;
    border: 1px solid rgba(255, 68, 56, 0.25);
    border-left: none;
    color: var(--ga-ink-2, rgba(255, 255, 255, 0.6));
    border-radius: 0 var(--ga-r-hard, 2px) var(--ga-r-hard, 2px) 0;
    cursor: pointer;
  }
  .compact .rec-source-toggle {
    height: var(--vj-control-h, 26px);
  }
  .rec-source-toggle.active {
    color: var(--ga-rec, #ff4438);
  }
  .rec-source-toggle:hover:not(:disabled) {
    background: rgba(255, 68, 56, 0.10);
  }
  .rec-source-toggle:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .rec-source-pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 2000;
    width: 260px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--ga-panel, #111316);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 7px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    color: var(--ga-ink-0, #eee);
    font-size: 12px;
  }
  .rec-source-section {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 260px;
    overflow-y: auto;
  }
  .rec-source-group {
    padding: 4px 6px 2px;
    color: var(--ga-ink-2, rgba(255, 255, 255, 0.5));
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .rec-source-item {
    text-align: left;
    padding: 5px 8px;
    background: transparent;
    border: none;
    border-radius: var(--ga-r-hard, 2px);
    color: inherit;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rec-source-item:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
  }
  .rec-source-item.selected {
    background: rgba(255, 68, 56, 0.16);
    color: var(--ga-rec, #ff4438);
  }
  .rec-source-item:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .rec-source-hint {
    margin: 0;
    color: var(--ga-ink-2, rgba(255, 255, 255, 0.55));
    font-size: 11px;
    line-height: 1.35;
  }
</style>
