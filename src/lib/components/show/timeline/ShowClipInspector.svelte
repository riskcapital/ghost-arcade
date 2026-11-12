<script lang="ts">
  /**
   * The selected block's timing: name, media (with Replace), start, length,
   * in point, speed, what happens at the media's end, fades, the crossfade
   * from the block before, and colour. What the block looks like (shader
   * parameters, sketch controls, opacity, blend mode) is edited in the normal
   * panels, which show the block while it is selected (see showBlockEdit).
   * With several blocks selected it says how many and offers Delete.
   */
  import type { ShowClipEndBehaviour, ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../../types';
  import { showTimeline } from '../../../stores/showTimeline';
  import { showToast } from '../../../stores/errorToast';
  import { findJunctionPredecessor } from '../../../show/showJunctions';
  import { mediaEnd, SHOW_MAX_RATE, SHOW_MIN_RATE } from '../../../show/tracks/showTrackEval';
  import { maxClipDurationForMedia } from '../../../show/tracks/showTrackEdit';
  import { clipMediaFromFile, clipMediaFromTrayPayload, MEDIA_SOURCE_DRAG_TYPE } from './clipMedia';
  import WhereEditor from './WhereEditor.svelte';

  interface Props {
    clip: ShowLayerClip | null;
    track: ShowLayerTrack | null;
    count: number;
    ondelete: () => void;
    onclose: () => void;
  }

  let { clip, track, count, ondelete, onclose }: Props = $props();

  const END_OPTIONS: Array<{ value: ShowClipEndBehaviour; label: string; hint: string }> = [
    { value: 'stop', label: 'Stop', hint: 'The clip ends with its media' },
    { value: 'loop', label: 'Loop', hint: 'Plays the media again from the start' },
    { value: 'hold', label: 'Hold', hint: 'Freezes on the last frame' },
  ];
  const SWATCHES = ['', '#ff6f5e', '#f0c674', '#5fdc76', '#5ce1e6', '#5278ff', '#c77dff'];

  const locked = $derived(!!track?.locked);
  const isVideo = $derived(clip?.media.kind === 'video');
  const prev = $derived(clip && track ? findJunctionPredecessor(track.clips, clip) : null);
  const maxXfade = $derived(clip && prev ? Math.min(prev.duration, clip.duration) : 0);
  const xfadeOn = $derived(clip?.transitionIn === 'dissolve' && maxXfade > 0);
  const mediaLength = $derived(clip ? mediaEnd(clip.media) : Infinity);

  function num(e: Event): number {
    return parseFloat((e.currentTarget as HTMLInputElement).value);
  }

  /**
   * Apply a typed number, then show what the clip really has. When the show
   * refuses the value (an overlap) or clamps it, the clip's value does not
   * change, so Svelte would leave the refused number standing in the box.
   */
  function commit(e: Event, apply: (v: number) => void, shown: (c: ShowLayerClip) => number | undefined) {
    const input = e.currentTarget as HTMLInputElement;
    apply(num(e));
    const id = clip?.id;
    const live = id ? showTimeline.findLayerClip(id)?.clip : undefined;
    const v = live ? shown(live) : undefined;
    if (v !== undefined && Number.isFinite(v)) input.value = v.toFixed(2);
  }

  function setStart(v: number) {
    if (!clip || !Number.isFinite(v)) return;
    showTimeline.moveLayerClipsAcross([clip.id], Math.max(0, v) - clip.startTime, 0);
  }
  function setDuration(v: number) {
    if (!clip || !Number.isFinite(v)) return;
    showTimeline.trimLayerClip(clip.id, 'end', clip.startTime + Math.max(0.1, v), { snap: false });
  }
  /** Typed and picked values are one undo step each; the opacity slider
   *  coalesces while it is dragged. */
  function patch(p: Partial<ShowLayerClip>, continuous = false) {
    if (!clip) return;
    showTimeline.updateLayerClip(clip.id, p, { discrete: !continuous });
  }
  function setEnd(value: ShowClipEndBehaviour) {
    if (!clip) return;
    const next = { ...clip, endBehaviour: value };
    // A clip switched to 'stop' cannot outlast its media.
    const room = maxClipDurationForMedia(next);
    patch({ endBehaviour: value, duration: Math.min(clip.duration, room) });
  }
  function setXfade(on: boolean, duration?: number) {
    if (!clip) return;
    if (!on) return patch({ transitionIn: 'cut', transitionDuration: undefined });
    const d = Math.max(0.1, Math.min(maxXfade, duration ?? clip.transitionDuration ?? 1));
    patch({ transitionIn: 'dissolve', transitionDuration: d });
  }

  // ── Replace ──────────────────────────────────────────────────────────
  let fileInput: HTMLInputElement | undefined = $state();
  let replaceHover = $state(false);

  async function replaceFromFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !clip) return;
    try {
      const media = await clipMediaFromFile(file);
      patch({ media });
    } catch (err) {
      showToast(`${file.name}: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }
  }

  function replaceDragOver(e: DragEvent) {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes(MEDIA_SOURCE_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
    replaceHover = true;
  }
  function replaceDrop(e: DragEvent) {
    replaceHover = false;
    const raw = e.dataTransfer?.getData(MEDIA_SOURCE_DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    let media: ShowClipMedia | null;
    try { media = clipMediaFromTrayPayload(JSON.parse(raw)); } catch { media = null; }
    if (media) patch({ media });
  }
</script>

<div class="show-inspector" data-clip-inspector>
  {#if count > 1 || !clip}
    <span class="insp-title">Blocks</span>
    <span class="insp-hint">{count} selected</span>
    <button class="insp-delete" onclick={ondelete}>Delete</button>
    <button aria-label="Close block inspector" class="insp-close" onclick={onclose}>×</button>
  {:else}
    <span class="insp-title">Block timing</span>
    <label class="insp-field">
      <span>Name</span>
      <input
        type="text"
        class="clip-name"
        value={clip.label ?? ''}
        placeholder={clip.media.name}
        disabled={locked}
        onchange={(e) => patch({ label: (e.currentTarget as HTMLInputElement).value || undefined })}
        data-clip-label
      />
    </label>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      class="insp-media"
      class:hover={replaceHover}
      ondragover={replaceDragOver}
      ondragleave={() => (replaceHover = false)}
      ondrop={replaceDrop}
      title="Drop a card from the media tray here to replace the media"
    >
      <span class="insp-media-name media-name">{clip.media.name}</span>
      <button class="insp-chip" disabled={locked} onclick={() => fileInput?.click()}>Replace</button>
      <input class="hidden-file" type="file" accept="video/*,image/*,.fs,.isf,.mov,.mkv,.mxf,.hap" bind:this={fileInput} onchange={replaceFromFile} />
    </span>
    <label class="insp-field">
      <span>Start</span>
      <input type="number" min="0" step="0.1" value={clip.startTime.toFixed(2)} disabled={locked} onchange={(e) => commit(e, setStart, (c) => c.startTime)} data-clip-start />
      <span class="insp-unit">s</span>
    </label>
    <label class="insp-field">
      <span>Length</span>
      <input type="number" min="0.1" step="0.1" value={clip.duration.toFixed(2)} disabled={locked} onchange={(e) => commit(e, setDuration, (c) => c.duration)} data-clip-duration />
      <span class="insp-unit">s</span>
    </label>
    {#if isVideo}
      <label class="insp-field" title={Number.isFinite(mediaLength) ? `The media is ${mediaLength.toFixed(2)} s long` : ''}>
        <span>In</span>
        <input type="number" min="0" step="0.1" value={clip.inPoint.toFixed(2)} disabled={locked} onchange={(e) => commit(e, (v) => patch({ inPoint: Math.max(0, v || 0) }), (c) => c.inPoint)} data-clip-in />
        <span class="insp-unit">s</span>
      </label>
      <label class="insp-field">
        <span>Speed</span>
        <input type="number" min={SHOW_MIN_RATE} max={SHOW_MAX_RATE} step="0.05" value={(clip.rate ?? 1).toFixed(2)} disabled={locked} onchange={(e) => commit(e, (v) => patch({ rate: Math.max(SHOW_MIN_RATE, Math.min(SHOW_MAX_RATE, v || 1)) }), (c) => c.rate ?? 1)} data-clip-rate />
        <span class="insp-unit">×</span>
      </label>
      <label class="insp-field">
        <span>At end</span>
        <select value={clip.endBehaviour} disabled={locked} onchange={(e) => setEnd((e.currentTarget as HTMLSelectElement).value as ShowClipEndBehaviour)} data-clip-end>
          {#each END_OPTIONS as opt (opt.value)}
            <option value={opt.value} title={opt.hint}>{opt.label}</option>
          {/each}
        </select>
      </label>
    {/if}
    <label class="insp-field">
      <span>Fade in</span>
      <input type="number" min="0" step="0.1" value={clip.fadeIn.toFixed(2)} disabled={locked} onchange={(e) => commit(e, (v) => patch({ fadeIn: Math.max(0, v || 0) }), (c) => c.fadeIn)} data-clip-fade-in />
      <span class="insp-unit">s</span>
    </label>
    <label class="insp-field">
      <span>Fade out</span>
      <input type="number" min="0" step="0.1" value={clip.fadeOut.toFixed(2)} disabled={locked} onchange={(e) => commit(e, (v) => patch({ fadeOut: Math.max(0, v || 0) }), (c) => c.fadeOut)} data-clip-fade-out />
      <span class="insp-unit">s</span>
    </label>
    {#if prev}
      <label class="insp-field" title="Crossfade from the clip before, centered on the cut">
        <span>Crossfade</span>
        <input type="checkbox" checked={xfadeOn} disabled={locked} onchange={(e) => setXfade((e.currentTarget as HTMLInputElement).checked)} data-clip-xfade />
        {#if xfadeOn}
          <input class="insp-short" type="number" min="0.1" max={maxXfade} step="0.1" value={Math.min(maxXfade, clip.transitionDuration ?? 1).toFixed(2)} disabled={locked} onchange={(e) => commit(e, (v) => setXfade(true, v), (c) => Math.min(maxXfade, c.transitionDuration ?? 1))} data-clip-xfade-duration />
          <span class="insp-unit">s</span>
        {/if}
      </label>
    {/if}
    {#if !locked}
      <WhereEditor where={clip.where} target={{ scope: 'block', id: clip.id }} />
    {/if}
    <span class="insp-swatches" role="group" aria-label="Block color">
      {#each SWATCHES as sw (sw)}
        <button
          class="insp-swatch"
          class:on={(clip.color ?? '') === sw}
          style:background={sw || 'transparent'}
          disabled={locked}
          onclick={() => patch({ color: sw || undefined })}
          title={sw ? 'Block color' : 'Row color'}
          aria-label={sw ? 'Block color' : 'Row color'}
        ></button>
      {/each}
    </span>
    <span class="insp-hint" title="Click a block to edit it: the Properties and Shader Parameters panels show the block's own values while it is selected.">Look, opacity and blend: in Properties and Shader Parameters</span>
    {#if locked}
      <span class="insp-warn">Row locked</span>
    {/if}
    <button class="insp-delete" disabled={locked} onclick={ondelete}>Delete</button>
    <button aria-label="Close block inspector" class="insp-close" onclick={onclose}>×</button>
  {/if}
</div>

<style>
  .show-inspector {
    display: flex;
    align-items: center;
    gap: 10px 12px;
    min-height: 36px;
    padding: 4px 12px;
    background: var(--ga-card, #121217);
    border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-1, #bbb);
    flex: 0 0 auto;
    flex-wrap: wrap;
  }
  .insp-title {
    color: #FFD96B;
    font-weight: var(--ga-weight-control, 600);
    padding-right: 12px;
    border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
  }
  .insp-field { display: flex; align-items: center; gap: 6px; }
  .insp-field > span { color: var(--ga-ink-2, #888); }
  .insp-field input[type="number"],
  .insp-field input[type="text"],
  .insp-field select {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-slot, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e8e8e8);
    font-size: var(--ga-text-control, 12px);
    padding: 0 6px;
    width: 64px;
    outline: none;
    font-family: inherit;
  }
  .insp-field input[type="number"] { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .insp-field input[type="text"] { width: 120px; }
  .insp-field select { width: 72px; }
  .insp-field input.insp-short { width: 60px; }
  .insp-range { width: 80px; }
  .insp-unit { color: var(--ga-ink-2, #888); }
  .insp-hint { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); }
  .insp-media {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 1px 2px 1px 6px;
    border: 1px dashed transparent;
    border-radius: 3px;
  }
  .insp-media.hover { border-color: #FFD96B; }
  .insp-media-name {
    max-width: 150px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ga-ink-1, #bbb);
  }
  .insp-chip {
    height: var(--ga-control-h-sm, 22px);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #bbb);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
    font-family: inherit;
  }
  .insp-chip:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); color: var(--ga-ink-0, #fff); }
  .hidden-file { display: none; }
  .insp-swatches { display: flex; gap: 3px; }
  .insp-swatch {
    width: 14px;
    height: 14px;
    padding: 0;
    border-radius: 3px;
    border: 1px solid var(--ga-line-3, rgba(255, 255, 255, 0.24));
    cursor: pointer;
  }
  .insp-swatch.on { box-shadow: 0 0 0 1px #FFD96B; }
  .insp-warn { color: var(--ga-rec, #FF6B6B); font-size: var(--ga-text-meta, 11px); }
  .insp-delete {
    margin-left: auto;
    height: var(--ga-control-h-sm, 22px);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--ga-rec, #ff4757) 40%, transparent);
    color: var(--ga-rec, #FF4757);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
    font-family: inherit;
  }
  .insp-delete:hover:not(:disabled) { background: color-mix(in srgb, var(--ga-rec, #ff4757) 14%, transparent); }
  .insp-delete:disabled { opacity: 0.4; cursor: default; }
  .insp-close {
    background: none;
    border: none;
    color: var(--ga-ink-2, #888);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .insp-close:hover { color: var(--ga-ink-0, #fff); }
</style>
