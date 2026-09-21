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
  <div class="nudge-group">
  <span class="nudge-label">NUDGE</span>
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
    data-midi-path="vj:tempo:resync" data-midi-label="Phrase resync" data-midi-mode="toggle">RESYNC</button>
</div>
<style>
  .tempo-controls { display: flex; align-items: center; gap: 4px; }
  .nudge-group { display: flex; align-items: center; height: 28px; box-sizing: border-box; border: 1px solid #444; border-radius: 4px; background: #222; overflow: hidden; }
  .nudge-label { padding: 0 5px; font-size: 10px; color: #aaa; }
  button { height: 28px; padding: 0 6px; border: 1px solid #444; background: #222; color: #ccc; border-radius: 4px; font-size: 10px; cursor: pointer; white-space: nowrap; }
  .nudge-group button { width: 24px; height: 26px; padding: 0; border: 0; border-left: 1px solid #444; border-radius: 0; font-size: 15px; }
  button:focus-visible { outline: 2px solid #bb86fc; outline-offset: -2px; }
  button.active { border-color: #46d18a; color: #b4ffcf; background: #183225; }
  button:disabled { opacity: 0.4; cursor: default; }
</style>
