<script lang="ts">
  import { onDestroy } from 'svelte';
  import { abletonLink } from '../sync/abletonLink';
  import { launchClock, setTempoNudgeInput, releaseTempoNudgeInputs, resyncLaunchClock } from '../stores/launchClock';
  $: following = $abletonLink.enabled && $abletonLink.peers > 0;
  const release = () => releaseTempoNudgeInputs('panel-tempo:');
  onDestroy(release);
  function down(event: PointerEvent, direction: -1 | 1) {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setTempoNudgeInput(`panel-tempo:pointer:${event.pointerId}`, direction);
  }
  function key(event: KeyboardEvent, direction: -1 | 1) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat) setTempoNudgeInput(`panel-tempo:key:${event.code}`, direction);
  }
</script>
<svelte:window onblur={release} onkeyup={(e) => setTempoNudgeInput(`panel-tempo:key:${e.code}`, 0)} />
<div data-help-page="midi-audio" class="tempo-controls" title={following ? 'Ableton Link controls tempo and phase' : 'Bend the local beat clock or set a new downbeat'}>
  <div class="nudge-group">
  <span class="nudge-label">Nudge</span>
  {#each [-1, 1] as direction}
    <button disabled={following} class:active={$launchClock.nudge === direction}
      aria-label={direction < 0 ? 'Hold to slow tempo' : 'Hold to speed up tempo'}
      title={following ? 'Disabled while following Ableton Link' : direction < 0 ? 'Hold to slow the beat clock by 4%' : 'Hold to speed up the beat clock by 4%'}
      onpointerdown={(e) => down(e, direction as -1 | 1)}
      onpointerup={(e) => setTempoNudgeInput(`panel-tempo:pointer:${e.pointerId}`, 0)}
      onlostpointercapture={(e) => setTempoNudgeInput(`panel-tempo:pointer:${e.pointerId}`, 0)}
      onkeydown={(e) => key(e, direction as -1 | 1)}
      data-midi-path="vj:tempo:nudge-{direction < 0 ? 'down' : 'up'}"
      data-midi-label={direction < 0 ? 'Tempo nudge down (hold)' : 'Tempo nudge up (hold)'}
      data-midi-mode="toggle" data-midi-min="0" data-midi-max="1">{direction < 0 ? '−' : '+'}</button>
  {/each}
  </div>
  <button disabled={following} onclick={() => resyncLaunchClock()}
    aria-label="Resync phrase" title={following ? 'Disabled while following Ableton Link' : 'Make now the downbeat; restart BPM-synced video and align synced LFOs'}
    data-midi-path="vj:tempo:resync" data-midi-label="Phrase resync" data-midi-mode="toggle">Resync</button>
</div>
<style>
  .tempo-controls { display: flex; align-items: center; gap: 6px; }
  .nudge-group { display: flex; align-items: center; height: var(--ga-bar-control-h, 30px); box-sizing: border-box; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard, 5px); background: var(--ga-card, #16140f); overflow: hidden; }
  .nudge-label { padding: 0 8px; font-size: var(--ga-text-control, 12px); font-weight: 600; color: var(--ga-ink-2); }
  button { height: var(--ga-bar-control-h, 30px); padding: 0 12px; border: 1px solid var(--ga-line-2); background: var(--ga-card, #16140f); color: var(--ga-ink-0); border-radius: var(--ga-r-hard, 5px); font: inherit; font-size: var(--ga-text-body, 13px); font-weight: 600; cursor: pointer; white-space: nowrap; }
  button:hover:not(:disabled) { border-color: var(--ga-line-3); }
  .nudge-group button { width: 28px; height: 100%; padding: 0; border: 0; border-left: 1px solid var(--ga-line-2); border-radius: 0; font-size: var(--ga-text-title, 14px); }
  button:focus-visible { outline: 2px solid var(--ga-focus, #8aa4ff); outline-offset: -2px; }
  button.active { border-color: var(--ga-selection-line); color: var(--ga-selection-ink); background: var(--ga-selection-bg); }
  button:disabled { opacity: 0.4; cursor: default; }
</style>
