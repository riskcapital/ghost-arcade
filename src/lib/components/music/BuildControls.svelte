<script lang="ts">
  /**
   * Build-up and drop, under the live output in every set. Build starts a
   * build that lands on a bar line (press again to cancel); Drop lands it on
   * the next bar. Right-click Build to set its roll, filter and effects, and
   * a scene or set to bring in on the drop.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { buildState, cancelBuild, dropNow, toggleBuild } from '../../music/musicRuntime';
  import { BUILD_FILTERS, BUILD_LENGTHS, BUILD_ROLLS, BUILD_STYLES, type BuildFilter, type BuildLength, type BuildRoll, type BuildStyle } from '../../music/buildDrop';
  import { STUDIO_SETS, type StudioSet } from '../../music/studioSets';
  import { DROP_FX, DROP_FX_RELEASES, STROBE_MAX_HZ, type DropFxId, type DropFxRelease } from '../../music/dropFx';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';

  const s = $derived($musicStudio);
  const b = $derived(s.build);
  const building = $derived($buildState.phase === 'building');
  let editing = $state(false);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<div class="build" role="group" aria-label="Build-up and drop">
  <button
    class="go"
    class:on={building}
    style="--p: {$buildState.progress}"
    onclick={toggleBuild}
    oncontextmenu={(e) => { e.preventDefault(); editing = !editing; }}
    title={building ? 'Building: press again to cancel' : `Build up for ${b.bars} bar${b.bars === 1 ? '' : 's'} and drop on the bar line. Right-click to edit.`}
    data-midi-path="studio:build.toggle"
    data-midi-label="Build up (again to cancel)"
    data-midi-mode="toggle"
  >
    <span class="fill" aria-hidden="true"></span>
    <span class="txt">Build</span>
  </button>
  <button class="go drop" onclick={dropNow} title="Drop on the next bar line" data-midi-path="studio:build.drop" data-midi-label="Drop on the next bar" data-midi-mode="toggle">Drop</button>
  <select value={b.bars} onchange={(e) => musicStudio.setBuild({ bars: +(e.target as HTMLSelectElement).value as BuildLength })} aria-label="Build length" title="How long the build runs">
    {#each BUILD_LENGTHS as n}<option value={n}>{n} bar{n === 1 ? '' : 's'}</option>{/each}
  </select>
  <select value={b.style} onchange={(e) => musicStudio.setBuild({ style: (e.target as HTMLSelectElement).value as BuildStyle })} aria-label="Build style">
    {#each BUILD_STYLES as st (st.id)}<option value={st.id}>{st.label}</option>{/each}
  </select>
  <StudioJack id="cv:build.progress" label="Build" title="How far the build has got, 0 to 1, as a control signal" />

  {#if editing}
    <div class="editor" role="dialog" aria-label="Edit the build">
      <div class="row">
        <label>Roll
          <select value={b.roll} onchange={(e) => musicStudio.setBuild({ roll: (e.target as HTMLSelectElement).value as BuildRoll })}>
            {#each BUILD_ROLLS as r (r.id)}<option value={r.id}>{r.label}</option>{/each}
          </select>
        </label>
        <label>Filter
          <select value={b.filter} onchange={(e) => musicStudio.setBuild({ filter: (e.target as HTMLSelectElement).value as BuildFilter })}>
            {#each BUILD_FILTERS as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
          </select>
        </label>
        <label class="check"><input type="checkbox" checked={b.kickOut} onchange={() => musicStudio.setBuild({ kickOut: !b.kickOut })} /> Beat drops out</label>
        <label class="check"><input type="checkbox" checked={b.gap} onchange={() => musicStudio.setBuild({ gap: !b.gap })} /> Gap before the drop</label>
      </div>
      <div class="row">
        <label>Drop FX
          <select value={b.dropFx} onchange={(e) => musicStudio.setBuild({ dropFx: (e.target as HTMLSelectElement).value as DropFxId })} title="A look on the whole output: creeps in with the build, hits on the drop, then lets go">
            {#each DROP_FX as fx (fx.id)}<option value={fx.id}>{fx.label}</option>{/each}
          </select>
        </label>
        {#if b.dropFx !== 'none'}
          <StudioKnob label="Amount" value={b.dropFxAmount} size={26} format={pct} onchange={(v) => musicStudio.setBuild({ dropFxAmount: v })} title="How hard the look hits on the drop" />
          <label>Release
            <select value={b.dropFxRelease} onchange={(e) => musicStudio.setBuild({ dropFxRelease: +(e.target as HTMLSelectElement).value as DropFxRelease })} title="How long it takes to let go after the drop">
              {#each DROP_FX_RELEASES as r}<option value={r}>{r === 2 ? '1/2 bar' : r === 4 ? '1 bar' : '2 bars'}</option>{/each}
            </select>
          </label>
        {/if}
        {#if b.dropFx === 'strobe'}<span class="warn">Flashing light. Kept under {STROBE_MAX_HZ} flashes a second.</span>{/if}
      </div>
      <div class="row">
        <StudioKnob label="Riser" value={b.riser} size={26} format={pct} onchange={(v) => musicStudio.setBuild({ riser: v })} title="The riser and noise sweep" />
        <StudioKnob label="Sends" value={b.sends} size={26} format={pct} onchange={(v) => musicStudio.setBuild({ sends: v })} title="How far the echo and reverb open" />
        <StudioKnob label="Impact" value={b.impact} size={26} format={pct} onchange={(v) => musicStudio.setBuild({ impact: v })} title="The boom and crash on the drop" />
        <label>On the drop
          <select value={b.dropScene ?? ''} onchange={(e) => musicStudio.setBuild({ dropScene: (e.target as HTMLSelectElement).value || null })}>
            <option value="">No scene</option>
            {#each s.scenes as sc (sc.id)}<option value={sc.id}>{sc.name}</option>{/each}
          </select>
        </label>
        <label>Set
          <select value={b.dropSet ?? ''} onchange={(e) => musicStudio.setBuild({ dropSet: ((e.target as HTMLSelectElement).value || null) as StudioSet | null })}>
            <option value="">Stay</option>
            {#each STUDIO_SETS as st (st.id)}<option value={st.id}>{st.label}</option>{/each}
          </select>
        </label>
        <span class="spacer"></span>
        {#if building}<button class="studio-btn" onclick={cancelBuild}>Cancel build</button>{/if}
        <button class="studio-btn" onclick={() => (editing = false)}>Done</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .build { position: relative; display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .go {
    position: relative;
    height: var(--ga-control-h, 26px);
    min-width: 64px;
    padding: 0 12px;
    overflow: hidden;
    border: 1px solid var(--studio-edge);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: 700;
    cursor: pointer;
  }
  .go.on { border-color: var(--studio-accent); }
  /* The build's progress fills the button from the left. */
  .fill { position: absolute; inset: 0; width: calc(var(--p, 0) * 100%); background: var(--studio-accent-soft); pointer-events: none; }
  .go.on .fill { background: var(--studio-accent); opacity: 0.55; }
  .txt { position: relative; }
  .drop:hover, .go:hover { border-color: var(--studio-accent); }
  select { height: var(--ga-control-h, 26px); max-width: 110px; }
  .editor {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    z-index: 10;
    width: max-content;
    max-width: 640px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background: var(--studio-panel);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .row label { display: inline-flex; align-items: center; gap: 5px; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); white-space: nowrap; }
  .spacer { flex: 1; }
  .warn { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); max-width: 220px; white-space: normal; }
</style>
