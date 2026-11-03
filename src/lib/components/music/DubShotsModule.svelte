<script lang="ts">
  /**
   * The Dub set's echo shots: a grid of one-shot sounds, each thrown into its
   * own echo timed to the tempo. Press a pad to fire it (its tail rings on);
   * a pad with Hold keeps echoing while pressed. Right-click a pad to edit
   * its sound and echo.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { fireDubShot, releaseDubShot } from '../../music/musicRuntime';
  import { DUB_DIVISIONS, DUB_ECHOES, DUB_SOURCES, defaultDubShots, type DubDivision, type DubEcho, type DubShotSource } from '../../music/dubShots';
  import { insertEditorChannel } from '../../music/studioUi';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';

  const s = $derived($musicStudio);
  let lit = $state<Set<number>>(new Set());
  let editing = $state<number | null>(null);
  let held = new Map<number, number>();

  function down(e: PointerEvent, i: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    // Higher on the pad hits harder.
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const vel = Math.max(0.35, Math.min(1, 1 - (e.clientY - r.top) / r.height + 0.35));
    held.set(e.pointerId, i);
    fireDubShot(i, vel);
    lit = new Set([...lit, i]);
  }

  function up(e: PointerEvent) {
    const i = held.get(e.pointerId);
    if (i === undefined) return;
    held.delete(e.pointerId);
    releaseDubShot(i);
    const next = new Set(lit);
    next.delete(i);
    lit = next;
  }

  function menu(e: MouseEvent, i: number) {
    e.preventDefault();
    editing = editing === i ? null : i;
  }

  const shot = $derived(editing === null ? null : s.dubShots[editing]);
  const set = (patch: Parameters<typeof musicStudio.setDubShot>[1]) => editing !== null && musicStudio.setDubShot(editing, patch);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const fadeLabel = (v: number) => (v < 0.15 ? 'Short' : v > 0.85 ? 'Very long' : pct(v));
  const feedbackLabel = (v: number) => (v < 0.08 ? 'One' : v > 0.9 ? 'Endless' : pct(v));
</script>

<StudioModule title="Echo shots" subtitle={editing === null ? 'Right-click a pad to edit its echo' : `Editing ${shot?.name ?? ''}`} class="grow">
  {#snippet head()}
    <button class="studio-btn" class:on={(s.inserts.shots?.length ?? 0) > 0} onclick={() => insertEditorChannel.set($insertEditorChannel === 'shots' ? null : 'shots')} title="Effects on all the echo shots">FX{s.inserts.shots?.length ? ` ${s.inserts.shots.length}` : ''}</button>
  {/snippet}
  <div class="shots">
    {#each s.dubShots as d, i (i)}
      <button
        class="pad"
        class:lit={lit.has(i)}
        class:editing={editing === i}
        class:held={d.hold}
        onpointerdown={(e) => down(e, i)}
        onpointerup={up}
        onpointercancel={up}
        oncontextmenu={(e) => menu(e, i)}
        title="{d.name}: {DUB_SOURCES.find((x) => x.id === d.source)?.label}, {DUB_ECHOES.find((x) => x.id === d.echo)?.label.toLowerCase()} at {d.division}{d.hold ? ', hold to keep it going' : ''}. Right-click to edit."
        data-midi-path="studio:dubshot.{i + 1}"
        data-midi-label="Dub shot {i + 1}"
        data-midi-mode="toggle"
      >
        <span class="label">{d.name}</span>
        {#if d.hold}<span class="hold" aria-label="Hold to keep it going">∞</span>{/if}
      </button>
    {/each}
  </div>

  {#if shot && editing !== null}
    <div class="editor" role="dialog" aria-label="Edit {shot.name}">
      <div class="row">
        <input class="name" value={shot.name} onchange={(e) => set({ name: (e.target as HTMLInputElement).value })} aria-label="Name" />
        <button class="studio-btn" onclick={() => editing !== null && musicStudio.setDubShot(editing, defaultDubShots()[editing])} title="Back to this pad's preset">Reset</button>
        <button class="studio-btn" onclick={() => (editing = null)} aria-label="Close">Done</button>
      </div>
      <div class="row">
        <label>Sound
          <select value={shot.source} onchange={(e) => set({ source: (e.target as HTMLSelectElement).value as DubShotSource })}>
            {#each DUB_SOURCES as src (src.id)}<option value={src.id}>{src.label}</option>{/each}
          </select>
        </label>
        <label>Echo
          <select value={shot.echo} onchange={(e) => set({ echo: (e.target as HTMLSelectElement).value as DubEcho })}>
            {#each DUB_ECHOES as ec (ec.id)}<option value={ec.id}>{ec.label}</option>{/each}
          </select>
        </label>
        <label>Time
          <select value={shot.division} onchange={(e) => set({ division: (e.target as HTMLSelectElement).value as DubDivision })}>
            {#each DUB_DIVISIONS as dv (dv.id)}<option value={dv.id}>{dv.id}</option>{/each}
          </select>
        </label>
        <label class="check" title="Keep the echo going while the pad is held">
          <input type="checkbox" checked={shot.hold} onchange={() => set({ hold: !shot.hold })} /> Hold
        </label>
      </div>
      <div class="knobs">
        <StudioKnob label="Repeats" value={shot.feedback} defaultValue={0.5} size={26} format={feedbackLabel} onchange={(v) => set({ feedback: v })} title="From one slap-back to an endless echo" />
        <StudioKnob label="Tail" value={shot.fade} defaultValue={0.5} size={26} format={fadeLabel} onchange={(v) => set({ fade: v })} title="How long before the echo fades away" />
        <StudioKnob label="Tone" value={shot.tone} defaultValue={0.5} size={26} format={pct} onchange={(v) => set({ tone: v })} title="Dark to bright repeats; each repeat gets darker" />
        <StudioKnob label="Mix" value={shot.mix} defaultValue={0.6} size={26} format={pct} onchange={(v) => set({ mix: v })} title="Echo against the dry hit" />
        <StudioKnob label="Level" value={shot.level} defaultValue={0.8} size={26} format={pct} onchange={(v) => set({ level: v })} />
        <StudioKnob label="Pitch" value={shot.pitch} min={-12} max={12} defaultValue={0} size={26} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`} onchange={(v) => set({ pitch: Math.round(v) })} title="Semitones" />
      </div>
    </div>
  {/if}
</StudioModule>

<style>
  .shots {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    /* The rows share the space there is, down to a pad you can still hit; past that it scrolls. */
    grid-auto-rows: minmax(26px, 1fr);
    gap: 5px;
    overflow-y: auto;
  }
  .pad {
    position: relative;
    min-width: 0;
    min-height: 0;
    padding: 2px 6px;
    display: flex;
    align-items: center;
    overflow: hidden;
    border: 1px solid var(--studio-edge-soft);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    font-weight: var(--ga-weight-control, 600);
    text-align: left;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    transition: background-color 60ms linear, border-color 60ms linear;
  }
  .pad:hover { border-color: var(--studio-edge); }
  .pad.editing { border-color: var(--studio-accent); }
  .pad.lit { background: var(--studio-accent); border-color: var(--studio-accent); color: var(--studio-on-accent); transition: none; }
  /* The whole name, on two lines when it needs them: the echo timing is in the tooltip and the editor. */
  .label {
    max-width: 100%;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-height: 1.15;
    overflow-wrap: normal; word-break: keep-all;
    pointer-events: none;
  }
  .pad.held { padding-right: 16px; }
  .hold { position: absolute; right: 4px; top: 1px; font-size: 10px; color: var(--studio-muted); pointer-events: none; }
  .pad.lit .hold { color: var(--studio-on-accent); }
  .editor {
    margin-top: 6px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background: var(--studio-slot);
  }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .row label { display: inline-flex; align-items: center; gap: 4px; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .row select { max-width: 120px; }
  .name { flex: 1; min-width: 0; height: 22px; font: inherit; }
  .check { white-space: nowrap; }
  .knobs { display: flex; justify-content: space-between; gap: 4px; }
</style>
