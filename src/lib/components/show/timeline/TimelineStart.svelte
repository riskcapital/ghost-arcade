<script lang="ts">
  /**
   * The Inspector with nothing selected. On an empty Timeline: "Start a show"
   * in three steps (add audio, fill the pieces, play it). Otherwise a line
   * saying what selecting does. Both end with the ways to learn the
   * Timeline: the tour, the keys sheet and hover help (F1).
   */
  import { onboarding } from '../../../stores/onboarding';
  import { tooltipsEnabled } from '../../../help/preferences';
  import TimelineIcon from './TimelineIcon.svelte';

  interface Props {
    /** Nothing on the Timeline yet. */
    empty: boolean;
    onaddaudio: () => void;
  }
  let { empty, onaddaudio }: Props = $props();
</script>

<div class="ts" data-timeline-start>
  {#if empty}
    <div class="ts-head">
      <b>Start a show</b>
      <small>Three steps. Everything else appears as you use it.</small>
    </div>
    <ol class="ts-steps">
      <li>
        <span class="ts-n">1</span>
        <div>
          <b>Add audio</b>
          <p>Drop a file on the Audio row, or choose one. Tempo and bars come from it.</p>
          <button class="ts-btn" onclick={onaddaudio} data-start-add-audio><TimelineIcon name="plus" size={13} />Choose audio…</button>
        </div>
      </li>
      <li>
        <span class="ts-n">2</span>
        <div>
          <b>Fill the pieces</b>
          <p><TimelineIcon name="sparkle" size={12} /> Auto show builds sections, content, looks and Screen FX from the music. Or drag media onto a piece's row.</p>
        </div>
      </li>
      <li>
        <span class="ts-n">3</span>
        <div>
          <b>Play it</b>
          <p><kbd>Space</kbd> plays and stops. <kbd>Enter</kbd> is GO once there are sections or cues.</p>
        </div>
      </li>
    </ol>
  {:else}
    <p class="ts-idle insp-idle-hint">Click a block to see its settings here.</p>
  {/if}
  <div class="ts-learn">
    <span class="ts-eyebrow">Learn the Timeline</span>
    <button class="ts-link" onclick={() => onboarding.startTour('timeline')} data-start-tour><TimelineIcon name="play" size={12} />Timeline tour<span class="ts-key">6 steps</span></button>
    <button class="ts-link" onclick={() => window.dispatchEvent(new CustomEvent('ga-open-shortcuts', { detail: { section: 'timeline' } }))}><TimelineIcon name="keyboard" size={13} />Keyboard shortcuts<span class="ts-key">?</span></button>
    <button class="ts-link" class:on={$tooltipsEnabled} onclick={() => tooltipsEnabled.set(!$tooltipsEnabled)} aria-pressed={$tooltipsEnabled}><TimelineIcon name="help" size={13} />Hover help for each area<span class="ts-key">F1</span></button>
  </div>
</div>

<style>
  .ts { display: flex; flex-direction: column; gap: 12px; color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-control, 12px); }
  .ts-head b { display: block; font-size: var(--ga-text-title, 14px); font-weight: 650; color: var(--ga-ink-0, #f2ede4); }
  .ts-head small { display: block; margin-top: 2px; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); }
  .ts-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .ts-steps li { display: flex; gap: 10px; padding: 12px 0; border-top: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); }
  .ts-steps b { display: block; font-size: var(--ga-text-body, 13px); font-weight: 600; color: var(--ga-ink-0, #f2ede4); margin-bottom: 4px; }
  .ts-steps p { margin: 0; font-size: var(--ga-text-meta, 11px); line-height: 1.5; color: var(--ga-ink-1, #ada9a2); }
  .ts-steps p :global(.tl-icon) { display: inline-block; vertical-align: -2px; color: var(--ga-icon, #5278ff); }
  .ts-n { flex: 0 0 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: var(--ga-ink-0, #f2ede4); box-shadow: inset 0 0 0 1px var(--ga-line-3, rgba(245, 236, 222, 0.24)); }
  .ts-steps li:first-child .ts-n { background: var(--ga-ink-0, #f2ede4); color: var(--ga-void, #0a0908); box-shadow: none; }
  kbd { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: 10px; color: var(--ga-ink-1, #ada9a2); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-bottom-width: 2px; border-radius: 3px; padding: 0 4px; }
  .ts-btn {
    margin-top: 8px; height: var(--ga-control-h, 26px); padding: 0 10px; display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: var(--ga-card, #16140f);
    color: var(--ga-ink-0, #f2ede4); font: inherit; font-weight: 600; cursor: pointer;
  }
  .ts-btn :global(.tl-icon) { color: var(--ga-icon, #5278ff); }
  .ts-btn:hover { background: var(--ga-raise, #26221c); }
  .ts-idle { margin: 0; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); }
  .ts-learn { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); }
  .ts-eyebrow { font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2, #89857e); margin-bottom: 2px; }
  .ts-link {
    height: 28px; padding: 0 10px; display: flex; align-items: center; gap: 8px;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: transparent;
    color: var(--ga-ink-0, #f2ede4); font: inherit; font-weight: 600; text-align: left; cursor: pointer;
  }
  .ts-link :global(.tl-icon) { color: var(--ga-icon, #5278ff); }
  .ts-link:hover { background: var(--ga-raise, #26221c); }
  .ts-link.on { border-color: var(--ga-selection-line, #5278ff); }
  .ts-key { margin-left: auto; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: 10px; color: var(--ga-ink-2, #89857e); }
</style>
