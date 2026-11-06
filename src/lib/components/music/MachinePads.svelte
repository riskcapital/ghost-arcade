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
    KIT_FAMILY_LABELS, MACHINE_KITS, PAD_KEYS, SOUND_MODELS, USER_FAMILY_LABEL, padForKey,
    type KitFamily, type MachinePad,
  } from '../../music/drumMachine/machineKits';
  import {
    addPad, addTrack, auditionSound, deleteKit, editBeat, ensureMachine, machinePadFlash, machinePicker, padChannel, playPad, playingKit, renameKit,
    saveKitAs, savedKits, selectKit, setPadSound, userKits,
  } from '../../music/drumMachine/machineRuntime';
  import type { DrumSound } from '../../music/tone/toneTypes';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';

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
    if (picking) machinePicker.set(pad);
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
    newPad = index;
    openPicker();
  }

  // ── Sound picker ──
  const picking = $derived($machinePicker !== null);
  let browseKit = $state('');
  let tab = $state<'kits' | 'build'>('kits');
  const browsed = $derived(allKits.find((k) => k.id === (browseKit || kit.id)) ?? kit);
  let built = $state<{ model: string; sound: DrumSound; name: string; role: MachinePad['role'] }>({ ...SOUND_MODELS[0], model: SOUND_MODELS[0].id, name: SOUND_MODELS[0].label, sound: { ...SOUND_MODELS[0].sound } });

  function openPicker() {
    browseKit = kit.id;
    machinePicker.set(selected);
  }
  /** A pad just added: once it has its sound, it goes into the sequencer too. */
  let newPad = -1;
  function closePicker() {
    machinePicker.set(null);
    newPad = -1;
  }
  // The sequencer can open the picker on a pad too.
  $effect(() => {
    if ($machinePicker !== null && $machinePicker !== selected) selected = $machinePicker;
  });
  function usePad(p: MachinePad) {
    setPadSound(selected, JSON.parse(JSON.stringify(p)));
    if (newPad === selected) addTrack(selected);
    closePicker();
  }
  function pickModel(id: string) {
    const m = SOUND_MODELS.find((x) => x.id === id)!;
    built = { model: m.id, name: m.label, role: m.role, sound: { ...m.sound } };
    auditionSound(built.sound);
  }
  /** Knobs over a sound's settings, 0-1, each mapped onto a useful range. */
  const PITCH = { min: Math.log(30), max: Math.log(12000) };
  function setBuilt(field: 'freq' | 'decay' | 'tone' | 'bend', v: number) {
    const sound = { ...built.sound };
    if (field === 'freq') sound.freq = Math.round(Math.exp(PITCH.min + v * (PITCH.max - PITCH.min)));
    else if (field === 'decay') sound.decay = +(0.01 * Math.pow(300, v)).toFixed(3);
    else if (field === 'tone') sound.tone = v;
    else sound.bend = +((v - 0.5) * 8).toFixed(2);
    built = { ...built, sound };
  }
  const builtKnob = $derived({
    freq: (Math.log(built.sound.freq) - PITCH.min) / (PITCH.max - PITCH.min),
    decay: Math.log(built.sound.decay / 0.01) / Math.log(300),
    tone: built.sound.tone,
    bend: (built.sound.bend ?? 0) / 8 + 0.5,
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
          <button class="studio-btn" class:on={picking} onclick={() => (picking ? closePicker() : openPicker())} title="Pick another sound for this pad">Sound</button>
          <button class="studio-btn" class:on={padFx > 0} onclick={() => insertEditorChannel.set(padChannel(selected))} title="This pad's own effects">FX{padFx ? ` ${padFx}` : ''}</button>
        </div>
      </div>
      <StudioKnob label="Tune" value={beat.padTune[selected] ?? 0.5} defaultValue={0.5} size={32} onchange={(v) => setPad('padTune', v)} format={(v) => `${Math.round((v - 0.5) * 24)} st`} />
      <StudioKnob label="Level" value={beat.padLevel[selected] ?? 0.5} defaultValue={0.5} size={32} onchange={(v) => setPad('padLevel', v)} />
      <StudioJack id="cv:pad.{selected}" label="Hits" title="{kit.pads[selected]?.name} hits, as a control signal: patch it to a visual" />
    </div>

    {#if picking}
      <div class="picker" role="dialog" aria-label="Sound for {kit.pads[selected]?.name}">
        <header>
          <span class="ga-eyebrow">Sound for pad {selected + 1}</span>
          <div class="seg">
            <button class:on={tab === 'kits'} onclick={() => (tab = 'kits')}>From kits</button>
            <button class:on={tab === 'build'} onclick={() => (tab = 'build')}>Build one</button>
          </div>
          <button class="studio-btn" onclick={closePicker} aria-label="Close">Done</button>
        </header>
        {#if tab === 'kits'}
          <select bind:value={browseKit} aria-label="Kit to pick from">
            {#if mine.length}<optgroup label={USER_FAMILY_LABEL}>{#each mine as k (k.id)}<option value={k.id}>{k.name}</option>{/each}</optgroup>{/if}
            {#each families as f (f)}
              <optgroup label={KIT_FAMILY_LABELS[f]}>{#each MACHINE_KITS.filter((k) => k.family === f) as k (k.id)}<option value={k.id}>{k.name}</option>{/each}</optgroup>
            {/each}
          </select>
          <p class="hint">Click to hear, double-click (or Use) to put it on the pad.</p>
          <div class="sounds">
            {#each browsed.pads as p, i (i)}
              <div class="sound">
                <button class="hear" onclick={() => auditionSound(p.sound)} ondblclick={() => usePad(p)} title="Hear {p.name}">{p.name}</button>
                <button class="use" onclick={() => usePad(p)} title="Put {p.name} on pad {selected + 1}">Use</button>
              </div>
            {/each}
          </div>
          {#if swapped}<button class="studio-btn wide" onclick={() => { setPadSound(selected, null); closePicker(); }}>Put back the kit's own sound</button>{/if}
        {:else}
          <div class="models">
            {#each SOUND_MODELS as m (m.id)}
              <button class="studio-btn" class:on={built.model === m.id} onclick={() => pickModel(m.id)}>{m.label}</button>
            {/each}
          </div>
          <div class="build-knobs">
            <StudioKnob label="Pitch" value={builtKnob.freq} defaultValue={0.4} size={34} onchange={(v) => setBuilt('freq', v)} format={() => `${built.sound.freq} Hz`} />
            <StudioKnob label="Decay" value={builtKnob.decay} defaultValue={0.5} size={34} onchange={(v) => setBuilt('decay', v)} format={() => `${built.sound.decay}s`} />
            <StudioKnob label="Tone" value={builtKnob.tone} defaultValue={0.5} size={34} onchange={(v) => setBuilt('tone', v)} />
            <StudioKnob label="Bend" value={builtKnob.bend} defaultValue={0.5} size={34} onchange={(v) => setBuilt('bend', v)} format={() => `${built.sound.bend ?? 0} oct`} />
          </div>
          <div class="build-row">
            <input bind:value={built.name} aria-label="Sound name" maxlength="24" />
            <button class="studio-btn" onclick={() => auditionSound(built.sound)}>Hear</button>
            <button class="studio-btn on" onclick={() => usePad({ name: built.name || 'Sound', role: built.role, sound: built.sound })}>Use</button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</StudioModule>

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

  .picker {
    position: absolute; left: 0; right: 0; top: 0; bottom: 64px; z-index: 3;
    display: flex; flex-direction: column; gap: 6px; padding: 8px;
    background: var(--studio-panel); border: 1px solid var(--studio-edge); border-radius: var(--studio-radius);
    overflow-y: auto;
  }
  .picker header { display: flex; align-items: center; gap: 6px; justify-content: space-between; }
  .seg { display: inline-flex; border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); overflow: hidden; }
  .seg button { border: 0; background: transparent; color: var(--studio-ink-1); padding: 0 8px; height: 22px; font: inherit; font-size: 11px; cursor: pointer; }
  .seg button + button { border-left: 1px solid var(--studio-edge-soft); }
  .seg button.on { color: var(--studio-on-accent); background: var(--studio-accent); }
  .hint { margin: 0; font-size: 10px; color: var(--studio-muted); }
  .sounds { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .sound { display: flex; border: 1px solid var(--studio-edge-soft); border-radius: var(--studio-radius); overflow: hidden; }
  .sound .hear { flex: 1; min-width: 0; height: 26px; border: 0; background: var(--studio-cell); color: var(--studio-ink); font: inherit; font-size: 11px; text-align: left; padding: 0 6px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sound .hear:hover { background: var(--studio-slot); }
  .sound .use { border: 0; border-left: 1px solid var(--studio-edge-soft); background: transparent; color: var(--studio-accent); font: inherit; font-size: 10px; padding: 0 6px; cursor: pointer; }
  .wide { width: 100%; }
  .models { display: flex; flex-wrap: wrap; gap: 4px; }
  .models .studio-btn { padding: 0 6px; font-size: 10px; height: 20px; }
  .build-knobs { display: flex; justify-content: space-around; padding: 4px 0; }
  .build-row { display: flex; gap: 4px; align-items: center; }
</style>
