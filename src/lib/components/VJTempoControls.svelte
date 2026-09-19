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
<div class="tempo-controls" title={following ? 'Ableton Link controls tempo and phase' : 'Bend the local beat clock or set a new downbeat'}>
  {#each [-1, 1] as direction}
    <button disabled={following} class:active={$launchClock.nudge === direction}
      aria-label={direction < 0 ? 'Hold to slow tempo' : 'Hold to speed up tempo'}
      onpointerdown={(e) => down(e, direction as -1 | 1)}
      onpointerup={(e) => setTempoNudgeInput(`panel-tempo:pointer:${e.pointerId}`, 0)}
      onlostpointercapture={(e) => setTempoNudgeInput(`panel-tempo:pointer:${e.pointerId}`, 0)}
      onkeydown={(e) => key(e, direction as -1 | 1)}
      data-midi-path="vj:tempo:nudge-{direction < 0 ? 'down' : 'up'}"
      data-midi-label={direction < 0 ? 'Tempo nudge down (hold)' : 'Tempo nudge up (hold)'}
      data-midi-mode="toggle" data-midi-min="0" data-midi-max="1">NUDGE {direction < 0 ? '−' : '+'}</button>
  {/each}
  <button disabled={following} onclick={() => resyncLaunchClock()}
    aria-label="Resync phrase" title={following ? 'Disabled while following Ableton Link' : 'Make now the downbeat; restart BPM-synced video and align synced LFOs'}
    data-midi-path="vj:tempo:resync" data-midi-label="Phrase resync" data-midi-mode="toggle">RESYNC</button>
</div>
<style>
  .tempo-controls { display: flex; gap: 3px; }
  button { padding: 6px; border: 1px solid #444; background: #222; color: #ccc; border-radius: 4px; font-size: 10px; cursor: pointer; white-space: nowrap; }
  button.active { border-color: #46d18a; color: #b4ffcf; background: #183225; }
  button:disabled { opacity: 0.4; cursor: default; }
</style>
