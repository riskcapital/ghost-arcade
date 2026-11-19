<script lang="ts">
  /**
   * The right rack's top: the clips playing now that have visuals (studio
   * session clips and Ableton Live clips alike), in the order they draw,
   * each with its layers, a quick opacity and blend, and Edit for the full
   * editor (ClipStackEditor). Fire a row and each of its clips shows here.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { playingStacks, stayingStacks, type StackEntry } from '../../music/stackRuntime';
  import { hasVisuals, type ClipStack, type StackItem } from '../../music/clipStack';
  import { stackEditor } from '../../music/studioUi';
  import { liveSource } from '../../music/visualVoices';
  import { BLEND_MODE_ORDER, blendModeLabel, type BlendMode } from '../../types';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';

  const s = $derived($musicStudio);
  // Read through the studio store so an edit shows here at once.
  const rows = $derived(stayingStacks($playingStacks).map((entry) => {
    void s;
    return { entry, stack: entry.resolve() };
  }).filter((r): r is { entry: StackEntry; stack: ClipStack } => hasVisuals(r.stack)).reverse());
  let open = $state<string | null>(null);

  function save(entry: StackEntry, stack: ClipStack) {
    if (entry.clipId) musicStudio.setClipStack(entry.clipId, stack);
    else if (entry.liveKey) musicStudio.setLiveStack(entry.liveKey, stack);
  }
  function edit(entry: StackEntry) {
    const title = `${entry.trackName} · ${entry.clipName}`;
    if (entry.clipId) stackEditor.set({ kind: 'clip', clipId: entry.clipId, title });
    else if (entry.liveKey) stackEditor.set({ kind: 'live', key: entry.liveKey, title, follow: liveSource(entry.track.replace(/^live:/, '')) });
  }
  const kind = (item: StackItem) => (item.voice ? 'Audio shader' : ({ video: 'Video', image: 'Image', shader: 'Shader', sketch: 'Sketch' } as Record<string, string>)[item.media?.kind ?? ''] ?? 'Layer');
  const percent = (v: number) => `${Math.round(v * 100)}%`;
</script>

<StudioModule title="Now playing" subtitle={rows.length === 1 ? '1 clip with visuals' : rows.length ? `${rows.length} clips with visuals` : ''}>
  {#if !rows.length}
    <p class="none">Clips with visuals show here while they play, top drawing over the rest. Give a clip visuals with its picture button in the session grid.</p>
  {:else}
    <ol class="clips">
      {#each rows as { entry, stack } (entry.uid)}
        <li>
          <div class="line">
            <button class="fold" onclick={() => (open = open === entry.uid ? null : entry.uid)} aria-expanded={open === entry.uid} aria-label="Layers of {entry.clipName}">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d={open === entry.uid ? 'M3 4.5l3 3 3-3' : 'M4.5 3l3 3-3 3'} /></svg>
            </button>
            <span class="who" title="{entry.trackName} · {entry.clipName}"><span class="track">{entry.trackName}</span> {entry.clipName}</span>
            <select value={stack.blend} onchange={(e) => save(entry, { ...stack, blend: (e.target as HTMLSelectElement).value as BlendMode })} aria-label="Blend of {entry.clipName}'s visuals" title="How its visuals blend over the ones below">
              {#each BLEND_MODE_ORDER as mode (mode)}<option value={mode}>{blendModeLabel(mode)}</option>{/each}
            </select>
            <StudioKnob label="" title="How much of its visuals show" value={stack.opacity} defaultValue={1} size={18} format={percent} onchange={(v) => save(entry, { ...stack, opacity: v })} />
            <button class="studio-btn edit" onclick={() => edit(entry)}>Edit</button>
          </div>
          {#if open === entry.uid}
            <ul class="layers">
              {#each stack.items as item (item.id)}
                <li><span class="kind">{kind(item)}</span> {item.name}{#if item.effects.length}<span class="fx"> · with effects</span>{/if}</li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</StudioModule>

<style>
  .none { margin: 0; font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--studio-muted); }
  .clips { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; max-height: 220px; overflow-y: auto; }
  .clips > li { border-bottom: 1px solid var(--studio-edge-soft); padding: 3px 0; }
  .clips > li:last-child { border-bottom: 0; }
  .line { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .fold { flex: 0 0 auto; width: 16px; height: 18px; padding: 0; border: 0; background: none; color: var(--studio-muted); cursor: pointer; }
  .fold svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .who { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-meta, 11px); color: var(--studio-ink); }
  .track { color: var(--studio-muted); font-size: var(--ga-text-micro, 9px); text-transform: uppercase; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); }
  select { flex: 0 1 86px; min-width: 0; height: 20px; font-size: var(--ga-text-meta, 11px); }
  .edit { flex: 0 0 auto; height: 20px; padding: 0 8px; font-size: var(--ga-text-meta, 11px); }
  .layers { list-style: none; margin: 2px 0 2px 22px; padding: 0; display: flex; flex-direction: column; gap: 1px; font-size: var(--ga-text-meta, 11px); color: var(--studio-ink); }
  .kind, .fx { color: var(--studio-muted); }
</style>
