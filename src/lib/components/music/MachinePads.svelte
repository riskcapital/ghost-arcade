<script lang="ts">
  /**
   * The drum machine's pads: sixteen to play with the mouse, the letter keys
   * (1-4, Q-R, A-F, Z-V) or a pad controller (notes 36-51). Where a pad is hit
   * sets how hard: the top edge is loudest. The pads fill the column.
   *
   * The pad last played is the one the strip under them edits: its sound
   * (any sound from any kit, or one built from the engine's sound types,
   * heard before it goes on), its effects (the studio's insert effects, on a
   * channel of its own), tune, level and control jack. The kit menu saves
   * what the pads play as a kit of yours.
   */
  import { onDestroy, onMount } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { musicKeysYield, isTypingTarget } from '../../music/musicKeyboard';
  import { insertEditorChannel } from '../../music/studioUi';
  import {
    KIT_FAMILY_LABELS, MACHINE_KITS, PAD_KEYS, USER_FAMILY_LABEL, padForKey,
    type KitFamily,
  } from '../../music/drumMachine/machineKits';
  import {
    addPad, deleteKit, editBeat, ensureMachine, machinePadFlash, machinePicker, padChannel, playPad, playingKit, renameKit,
    saveKitAs, savedKits, selectKit, userKits,
  } from '../../music/drumMachine/machineRuntime';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';
  import SoundLibrary from './SoundLibrary.svelte';

  let { selected = $bindable(0) }: { selected?: number } = $props();

  const beat = $derived($musicStudio.machine);
  const mine = $derived.by(() => { void $savedKits; return userKits(beat); });
  const kit = $derived.by(() => { void $savedKits; return playingKit(beat); });
  const families = Object.keys(KIT_FAMILY_LABELS) as KitFamily[];
  const allKits = $derived([...mine, ...MACHINE_KITS]);
  const kitIndex = $derived(allKits.findIndex((k) => k.id === kit.id));
  const isMine = $derived(mine.some((k) => k.id === kit.id));
  const swapped = $derived(beat.padSounds[selected] !== null);
  const padFx = $derived(($musicStudio.inserts[padChannel(selected)] ?? []).filter((f) => f.enabled).length);

  function stepKit(by: number) {
    const n = allKits.length;
    selectKit(allKits[(kitIndex + by + n) % n].id);
  }

  const held = new Set<number>();

  function down(e: PointerEvent, pad: number) {
    if (e.button !== 0) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const share = 1 - (e.clientY - r.top) / r.height;
    playPad(pad, 0.4 + 0.6 * Math.max(0, Math.min(1, share)));
    selected = pad;

  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(document.activeElement)) return;
    const pad = padForKey(e.key);
    if (pad < 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat || held.has(pad)) return;
    held.add(pad);
    playPad(pad, e.shiftKey ? 1 : 0.8, 'keyboard');
    selected = pad;
  }

  function onKeyUp(e: KeyboardEvent) {
    const pad = padForKey(e.key);
    if (pad >= 0 && held.delete(pad)) e.stopPropagation();
  }

  onMount(() => {
    ensureMachine();
    musicKeysYield.set(true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
  });
  onDestroy(() => {
    musicKeysYield.set(false);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
  });

  function setPad(field: 'padLevel' | 'padTune', v: number) {
    editBeat((b) => ({ ...b, [field]: b[field].map((x, i) => (i === selected ? v : x)) }));
  }

  // ── Kit menu ──
  let naming = $state<null | 'save' | 'rename'>(null);
  let kitName = $state('');
  function onKitMenu(value: string) {
    if (value === 'save') {
      kitName = isMine ? kit.name : `My ${kit.name}`;
      naming = 'save';
    } else if (value === 'rename') {
      kitName = kit.name;
      naming = 'rename';
    } else if (value === 'delete') deleteKit(kit.id);
    else if (value === 'reset') editBeat((b) => ({ ...b, padSounds: b.padSounds.map(() => null) }));
  }
  function commitName() {
    if (naming === 'save') saveKitAs(kitName);
    else if (naming === 'rename') renameKit(kit.id, kitName);
    naming = null;
  }

  // ── More slots: as many rows of pads as the column has room for ──
  const PAD_MIN = 64;
  let gridEl = $state<HTMLElement | null>(null);
  let fitRows = $state(8);
  $effect(() => {
    if (!gridEl) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      const size = Math.max(PAD_MIN, (w - 3 * 6) / 4);
      fitRows = Math.max(4, Math.floor((e.contentRect.height + 6) / (size + 6)));
    });
    ro.observe(gridEl);
    return () => ro.disconnect();
  });
  /** Empty slots after the pads, up to the rows that fit: click one to add a pad there. */
  const emptySlots = $derived(Math.max(0, fitRows * 4 - kit.pads.length));

  function newPadAt() {
    const index = addPad();
    if (index < 0) return;
    selected = index;
    openPicker(true);
  }

  // ── Sound library ──
  const picking = $derived($machinePicker !== null);
  function openPicker(addToSequencer = false) {
    machinePicker.set({ pad: selected, addTrack: addToSequencer });
  }
  // The library opened on a pad selects it.
  $effect(() => {
    const p = $machinePicker;
    if (p && p.pad !== selected) selected = p.pad;
  });
</script>

<StudioModule title="Pads" subtitle={kit.name} grow class="machine-pads">
  {#snippet head()}
    <StudioJack id="cv:pad.any" label="Any" title="Every pad's hits, as a control signal" />
    <StudioJack id="audio:drums" label="Out" title="Drum sound" />
  {/snippet}
  <div class="body">
    <div class="kit-row">
      <button class="studio-btn arrow" onclick={() => stepKit(-1)} aria-label="Previous kit" title="Previous kit">‹</button>
      <select value={kit.id} onchange={(e) => selectKit((e.target as HTMLSelectElement).value)} aria-label="Kit" title={kit.blurb}>
        {#if mine.length}
          <optgroup label={USER_FAMILY_LABEL}>
            {#each mine as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
          </optgroup>
        {/if}
        {#each families as f (f)}
          <optgroup label={KIT_FAMILY_LABELS[f]}>
            {#each MACHINE_KITS.filter((k) => k.family === f) as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
          </optgroup>
        {/each}
      </select>
      <button class="studio-btn arrow" onclick={() => stepKit(1)} aria-label="Next kit" title="Next kit">›</button>
      <select class="kit-menu" value="" onchange={(e) => { const el = e.target as HTMLSelectElement; onKitMenu(el.value); el.value = ''; }} aria-label="Kit menu" title="Save the pads as a kit of yours, rename or delete one">
        <option value="" disabled>Kit…</option>
        <option value="save">Save as my kit…</option>
        {#if isMine}<option value="rename">Rename…</option><option value="delete">Delete this kit</option>{/if}
        {#if beat.padSounds.some((p) => p)}<option value="reset">Put back the kit's own sounds</option>{/if}
      </select>
    </div>
    {#if naming}
      <form class="name-row" onsubmit={(e) => { e.preventDefault(); commitName(); }}>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={kitName} autofocus aria-label="Kit name" onkeydown={(e) => { if (e.key === 'Escape') naming = null; }} />
        <button class="studio-btn" type="submit">{naming === 'save' ? 'Save' : 'Rename'}</button>
        <button class="studio-btn" type="button" onclick={() => (naming = null)}>Cancel</button>
      </form>
    {:else}
      <p class="blurb">{kit.blurb}</p>
    {/if}

    <div class="pads" role="group" aria-label="Drum pads" bind:this={gridEl}>
      {#each kit.pads as p, i (i)}
        <button
          class="pad"
          class:sel={selected === i}
          class:swapped={beat.padSounds[i] !== null}
          onpointerdown={(e) => down(e, i)}
          title="{p.name}: {PAD_KEYS[i] ? `key ${PAD_KEYS[i].toUpperCase()}, ` : ''}note {36 + i}. Hit near the top for louder."
          aria-label="{p.name} pad"
        >
          {#key $machinePadFlash[i]}<span class="flash" class:go={$machinePadFlash[i] > 0}></span>{/key}
          <span class="name">{p.name}</span>
          <span class="foot">
            <span class="key">{PAD_KEYS[i]?.toUpperCase() ?? i + 1}</span>
            {#if ($musicStudio.inserts[padChannel(i)] ?? []).some((f) => f.enabled)}<span class="fx-dot" title="Has effects">FX</span>{/if}
          </span>
        </button>
      {/each}
      {#each Array.from({ length: emptySlots }, (_, i) => i) as i (i)}
        <button class="pad empty" onclick={newPadAt} title="Add a pad here and pick its sound" aria-label="Add a pad">+</button>
      {/each}
    </div>

    <div class="pad-strip">
      <div class="sel-col">
        <span class="ga-eyebrow sel-name">{kit.pads[selected]?.name}{swapped ? ' ·' : ''}</span>
        <div class="sel-btns">
          <button class="studio-btn" class:on={picking} onclick={() => openPicker()} title="Pick another sound for this pad">Sound</button>
          <button class="studio-btn" class:on={padFx > 0} onclick={() => insertEditorChannel.set(padChannel(selected))} title="This pad's own effects">FX{padFx ? ` ${padFx}` : ''}</button>
        </div>
      </div>
      <StudioKnob label="Tune" value={beat.padTune[selected] ?? 0.5} defaultValue={0.5} size={32} onchange={(v) => setPad('padTune', v)} format={(v) => `${Math.round((v - 0.5) * 24)} st`} />
      <StudioKnob label="Level" value={beat.padLevel[selected] ?? 0.5} defaultValue={0.5} size={32} onchange={(v) => setPad('padLevel', v)} />
      <StudioJack id="cv:pad.{selected}" label="Hits" title="{kit.pads[selected]?.name} hits, as a control signal: patch it to a visual" />
    </div>

  </div>
</StudioModule>

<SoundLibrary />

<style>
  .body { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .kit-row { display: flex; gap: 4px; align-items: center; }
  .kit-row select { flex: 1; min-width: 0; }
  .kit-row .kit-menu { flex: 0 0 56px; }
  .arrow { width: 24px; padding: 0; }
  .blurb { margin: 4px 0 8px; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); line-height: 1.3; min-height: 2.6em; }
  .name-row { display: flex; gap: 4px; margin: 4px 0 8px; min-height: 2.6em; align-items: center; }
  .name-row input, .build-row input { flex: 1; min-width: 0; height: 22px; border: 1px solid var(--studio-edge); background: var(--studio-slot); color: var(--studio-ink); border-radius: var(--studio-radius); padding: 0 6px; font: inherit; font-size: 11px; }
  /* The pads take whatever height the column has. */
  /* Square pads, four across; the column shows as many rows as fit, and scrolls past that. */
  .pads { flex: 1 1 0; min-height: 200px; display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: max-content; align-content: start; gap: 6px; overflow-y: auto; scrollbar-width: thin; }
  .pad {
    position: relative;
    aspect-ratio: 1;
    min-height: 0;
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background: linear-gradient(180deg, var(--studio-cell), var(--studio-slot));
    color: var(--studio-ink);
    padding: 6px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: stretch;
    overflow: hidden;
    cursor: pointer;
    touch-action: none;
  }
  .pad:hover { border-color: var(--studio-muted); }
  .pad.empty { justify-content: center; align-items: center; background: transparent; border-style: dashed; border-color: var(--studio-edge-soft); color: var(--studio-muted); font-size: 16px; }
  .pad.sel { border-color: var(--studio-accent); }
  .pad .name { position: relative; font-size: 11px; line-height: 1.15; text-align: left; }
  .pad.swapped .name { font-style: italic; }
  .foot { position: relative; display: flex; justify-content: space-between; align-items: flex-end; }
  .pad .key { font-size: 9px; color: var(--studio-muted); }
  .fx-dot { font-size: 8px; color: var(--studio-accent); }
  .flash { position: absolute; inset: 0; background: var(--studio-accent); opacity: 0; pointer-events: none; }
  .flash.go { animation: pad-hit 0.22s ease-out; }
  @keyframes pad-hit { from { opacity: 0.75; } to { opacity: 0; } }
  .pad-strip { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .sel-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .sel-name { overflow: hidden; text-overflow: ellipsis; }
  .sel-btns { display: flex; gap: 4px; }
  .sel-btns .studio-btn { padding: 0 8px; }

</style>
