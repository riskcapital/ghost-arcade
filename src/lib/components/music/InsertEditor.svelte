<script lang="ts">
  /**
   * A channel's insert effects (or the master's): as many as you like, from
   * every effect the studio has, played in order top to bottom. Drag one, or
   * use its arrows, to move it; its light bypasses it (a bypassed effect is
   * taken out of the signal, so it costs nothing).
   */
  import { launchClockTempo } from '../../stores/launchClock';
  import { generateUUID } from '../../utils/uuid';
  import { MACRO_FX, macroFxDef, type MacroFxType } from '../../music/macroFx';
  import { INSTRUMENT_LABELS } from '../../music/instruments';
  import { musicStudio } from '../../music/musicStudioStore';
  import { insertEditorChannel } from '../../music/studioUi';
  import { findClip } from '../../music/session';
  import type { InstrumentId } from '../../music/noteEvents';
  import StudioKnob from './StudioKnob.svelte';

  const channel = $derived($insertEditorChannel);
  const chain = $derived(channel ? ($musicStudio.inserts[channel] ?? []) : []);
  const clipName = $derived(channel?.startsWith('clip:') ? (findClip($musicStudio.session, channel.slice(5))?.clip.name ?? 'Clip') : null);
  const name = $derived(channel === 'master' ? 'Master' : clipName ? `${clipName} (clip)` : channel ? (INSTRUMENT_LABELS[channel as InstrumentId] ?? channel) : '');
  const tempo = launchClockTempo();
  let dragging = $state<string | null>(null);

  function add(e: Event) {
    const el = e.target as HTMLSelectElement;
    if (channel && el.value) musicStudio.addInsert(channel, generateUUID(), el.value as MacroFxType);
    el.value = '';
  }

  function drop(e: DragEvent, index: number) {
    e.preventDefault();
    if (channel && dragging) musicStudio.moveInsert(channel, dragging, index);
    dragging = null;
  }
</script>

{#if channel}
  <aside class="editor" class:over={!!clipName} aria-label="{name} effects">
    <header>
      <div class="title">
        <span class="ga-eyebrow">Insert effects</span>
        <h2>{name}</h2>
      </div>
      <select value="" onchange={add} aria-label="Add an effect">
        <option value="" disabled>Add effect…</option>
        <optgroup label="Classic">{#each MACRO_FX.filter((d) => d.group !== 'wild') as def (def.type)}<option value={def.type}>{def.label}</option>{/each}</optgroup>
            <optgroup label="Wild">{#each MACRO_FX.filter((d) => d.group === 'wild') as def (def.type)}<option value={def.type} title={def.blurb ?? ''}>{def.label}</option>{/each}</optgroup>
      </select>
      <button class="close" onclick={() => insertEditorChannel.set(null)} aria-label="Close effects"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
    </header>

    <div class="scroll">
      {#each chain as fx, i (fx.id)}
        {@const def = macroFxDef(fx.type)}
        <div
          class="fx"
          class:off={!fx.enabled}
          class:dragging={dragging === fx.id}
          draggable="true"
          ondragstart={() => (dragging = fx.id)}
          ondragend={() => (dragging = null)}
          ondragover={(e) => e.preventDefault()}
          ondrop={(e) => drop(e, i)}
          role="listitem"
        >
          <div class="fx-head">
            <span class="grip" aria-hidden="true">⋮⋮</span>
            <button class="power" class:on={fx.enabled} onclick={() => musicStudio.toggleInsert(channel, fx.id)} aria-pressed={fx.enabled} aria-label="{def.label} on" title={fx.enabled ? 'Bypass' : 'Turn on'}></button>
            <span class="fx-name">{i + 1}. {def.label}</span>
            <button class="icon" disabled={i === 0} onclick={() => musicStudio.moveInsert(channel, fx.id, i - 1)} aria-label="Move {def.label} up" title="Earlier in the chain"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5L6 4.5 9 7.5" /></svg></button>
            <button class="icon" disabled={i === chain.length - 1} onclick={() => musicStudio.moveInsert(channel, fx.id, i + 1)} aria-label="Move {def.label} down" title="Later in the chain"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5 9 4.5" /></svg></button>
            <button class="icon" onclick={() => musicStudio.removeInsert(channel, fx.id)} aria-label="Remove {def.label}" title="Remove"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" /></svg></button>
          </div>
          <div class="params">
            {#each def.params as pd (pd.key)}
              {@const param = fx.params[pd.key]}
              {#if param}
                <StudioKnob label={pd.label} value={param.value} defaultValue={pd.value} size={30} format={(v) => pd.format(v, tempo)} onchange={(v) => musicStudio.setInsertParam(channel, fx.id, pd.key, v)} />
              {/if}
            {/each}
          </div>
        </div>
      {:else}
        <p class="empty">No effects on {name} yet. Add as many as you like; they play in order, top to bottom. A tape echo into a spring is a dub classic.</p>
      {/each}
    </div>
  </aside>
{/if}

<style>
  .editor {
    position: absolute;
    top: var(--ga-bar-h, 48px);
    right: 0;
    bottom: 0;
    /* Covers the right rack exactly: its column plus the view's side padding. */
    width: calc(var(--studio-right-w, 356px) + 14px);
    z-index: 8;
    display: flex;
    flex-direction: column;
    background: var(--studio-panel);
    border-left: 1px solid var(--studio-edge);
    box-shadow: -18px 0 40px rgba(0, 0, 0, 0.55);
  }
  /* A clip's chain opens over the clip editor. */
  .editor.over { z-index: 95; }
  header { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--studio-edge-soft); }
  .title { flex: 1; }
  h2 { margin: 2px 0 0; font-size: var(--ga-text-heading, 16px); font-weight: var(--ga-weight-title, 650); }
  header select { height: var(--ga-control-h, 26px); }
  .close, .icon {
    width: var(--ga-control-h, 26px);
    height: var(--ga-control-h, 26px);
    padding: 0;
    display: grid;
    place-items: center;
    border: 1px solid var(--studio-edge-soft);
    background: transparent;
    color: var(--studio-muted);
    border-radius: var(--studio-radius);
    cursor: pointer;
  }
  .icon { width: 22px; height: 22px; }
  .icon:disabled { opacity: 0.35; cursor: default; }
  .close svg { width: 14px; height: 14px; }
  .icon svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .close:hover, .icon:hover:not(:disabled) { color: var(--studio-ink); border-color: var(--studio-edge); }
  .scroll { flex: 1; overflow: auto; padding: 6px 16px 16px; }
  .fx { padding: 8px 0 10px; border-top: 1px solid var(--studio-edge-soft); }
  .fx.off { opacity: 0.5; }
  .fx.dragging { opacity: 0.35; }
  .fx-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
  .grip { cursor: grab; color: var(--studio-muted); font-size: 10px; letter-spacing: -2px; }
  .fx-name { flex: 1; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-title, 650); }
  .power { width: 14px; height: 14px; padding: 0; border-radius: 50%; border: 1px solid var(--studio-edge); background: transparent; cursor: pointer; }
  .power.on { background: var(--studio-accent); border-color: var(--studio-accent); box-shadow: 0 0 6px var(--studio-accent); }
  .params { display: flex; flex-wrap: wrap; gap: 10px 8px; }
  .empty { margin: 10px 0; color: var(--studio-muted); font-size: var(--ga-text-meta, 11px); line-height: 1.5; }
</style>
