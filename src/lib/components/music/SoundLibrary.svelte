<script lang="ts">
  /**
   * The drum machine's sound library: every drum and percussion sound, from
   * every kit (yours too) and the library's own (lasers, the vibraslap and
   * more), grouped and searchable. Click a sound to hear it; double-click it,
   * or press Use, to put it on the pad. "Build one" makes a sound from the
   * engine's sound types instead.
   */
  import {
    LIBRARY_GROUPS, SOUND_MODELS, soundLibrary, type LibraryGroup, type MachinePad,
  } from '../../music/drumMachine/machineKits';
  import {
    addTrack, auditionSound, machinePicker, playingKit, setPadSound, userKits, savedKits,
  } from '../../music/drumMachine/machineRuntime';
  import { musicStudio } from '../../music/musicStudioStore';
  import type { DrumSound } from '../../music/tone/toneTypes';
  import StudioKnob from './StudioKnob.svelte';

  const pick = $derived($machinePicker);
  const beat = $derived($musicStudio.machine);
  const library = $derived.by(() => { void $savedKits; return soundLibrary(userKits(beat)); });
  const padName = $derived(pick ? (playingKit(beat).pads[pick.pad]?.name ?? `Pad ${pick.pad + 1}`) : '');

  let tab = $state<'library' | 'build'>('library');
  let group = $state<LibraryGroup | 'all'>('all');
  let query = $state('');
  let heard = $state<string | null>(null);

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return library.filter((s) => (group === 'all' || s.group === group) && (!q || s.pad.name.toLowerCase().includes(q) || s.from.toLowerCase().includes(q)));
  });
  const counts = $derived(Object.fromEntries(LIBRARY_GROUPS.map((g) => [g.id, library.filter((s) => s.group === g.id).length])));

  function hear(id: string, p: MachinePad) {
    heard = id;
    auditionSound(p.sound);
  }

  function use(p: MachinePad) {
    if (!pick) return;
    setPadSound(pick.pad, JSON.parse(JSON.stringify(p)));
    if (pick.addTrack) addTrack(pick.pad);
    close();
  }

  function close() {
    machinePicker.set(null);
  }

  // ── Build one ──
  let built = $state<{ model: string; name: string; role: MachinePad['role']; sound: DrumSound }>({ model: SOUND_MODELS[0].id, name: SOUND_MODELS[0].label, role: SOUND_MODELS[0].role, sound: { ...SOUND_MODELS[0].sound } });
  function pickModel(id: string) {
    const m = SOUND_MODELS.find((x) => x.id === id)!;
    built = { model: m.id, name: m.label, role: m.role, sound: { ...m.sound } };
    auditionSound(built.sound);
  }
  const PITCH = { min: Math.log(30), max: Math.log(12000) };
  function setBuilt(field: 'freq' | 'decay' | 'tone' | 'bend', v: number) {
    const sound = { ...built.sound };
    if (field === 'freq') sound.freq = Math.round(Math.exp(PITCH.min + v * (PITCH.max - PITCH.min)));
    else if (field === 'decay') sound.decay = +(0.01 * Math.pow(300, v)).toFixed(3);
    else if (field === 'tone') sound.tone = v;
    else sound.bend = +((v - 0.5) * 8).toFixed(2);
    built = { ...built, sound };
  }
  const knob = $derived({
    freq: (Math.log(built.sound.freq) - PITCH.min) / (PITCH.max - PITCH.min),
    decay: Math.log(built.sound.decay / 0.01) / Math.log(300),
    tone: built.sound.tone,
    bend: (built.sound.bend ?? 0) / 8 + 0.5,
  });

  function onKey(e: KeyboardEvent) {
    if (pick && e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if pick}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div class="browser" role="dialog" aria-label="Sounds for {padName}">
      <header>
        <h2>Sound for pad {pick.pad + 1}</h2>
        <div class="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'library'} class:on={tab === 'library'} onclick={() => (tab = 'library')}>Library</button>
          <button role="tab" aria-selected={tab === 'build'} class:on={tab === 'build'} onclick={() => (tab = 'build')}>Build one</button>
        </div>
        {#if tab === 'library'}
          <input class="search" type="search" placeholder="Search sounds" bind:value={query} aria-label="Search sounds" />
          <span class="count">{shown.length} sounds · click to hear, double-click to use</span>
        {/if}
        <span class="spacer"></span>
        {#if beat.padSounds[pick.pad]}
          <button class="text-btn" onclick={() => { setPadSound(pick.pad, null); close(); }}>Put back the kit's own</button>
        {/if}
        <button class="close" onclick={close} aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      </header>

      {#if tab === 'library'}
        <div class="body">
          <nav class="groups" aria-label="Groups">
            <button class:on={group === 'all'} onclick={() => (group = 'all')}>All <span>{library.length}</span></button>
            {#each LIBRARY_GROUPS as g (g.id)}
              <button class:on={group === g.id} onclick={() => (group = g.id)}>{g.label} <span>{counts[g.id]}</span></button>
            {/each}
          </nav>
          <div class="grid">
            {#each shown as s (s.id)}
              <div class="tile" class:heard={heard === s.id}>
                <button class="hear" onclick={() => hear(s.id, s.pad)} ondblclick={() => use(s.pad)} title="Hear {s.pad.name}">
                  <span class="name">{s.pad.name}</span>
                  <span class="from">{s.from}</span>
                </button>
                <button class="use" onclick={() => use(s.pad)} title="Put {s.pad.name} on the pad">Use</button>
              </div>
            {/each}
            {#if !shown.length}<p class="empty">No sounds match.</p>{/if}
          </div>
        </div>
      {:else}
        <div class="build">
          <div class="models">
            {#each SOUND_MODELS as m (m.id)}
              <button class="text-btn" class:on={built.model === m.id} onclick={() => pickModel(m.id)}>{m.label}</button>
            {/each}
          </div>
          <div class="knobs">
            <StudioKnob label="Pitch" value={knob.freq} defaultValue={0.4} size={44} onchange={(v) => setBuilt('freq', v)} format={() => `${built.sound.freq} Hz`} />
            <StudioKnob label="Decay" value={knob.decay} defaultValue={0.5} size={44} onchange={(v) => setBuilt('decay', v)} format={() => `${built.sound.decay}s`} />
            <StudioKnob label="Tone" value={knob.tone} defaultValue={0.5} size={44} onchange={(v) => setBuilt('tone', v)} />
            <StudioKnob label="Bend" value={knob.bend} defaultValue={0.5} size={44} onchange={(v) => setBuilt('bend', v)} format={() => `${built.sound.bend ?? 0} oct`} />
          </div>
          <div class="build-row">
            <input class="search" bind:value={built.name} aria-label="Sound name" maxlength="24" />
            <button class="text-btn" onclick={() => auditionSound(built.sound)}>Hear</button>
            <button class="text-btn on" onclick={() => use({ name: built.name || 'Sound', role: built.role, sound: built.sound })}>Use</button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: rgba(0, 0, 0, 0.45); }
  .browser {
    width: min(1000px, 94vw);
    height: min(680px, 88vh);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    background: var(--studio-panel);
    border: 1px solid var(--studio-edge);
    border-radius: var(--ga-r-soft, 8px);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    color: var(--studio-ink);
  }
  header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  h2 { margin: 0; font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); }
  .seg { display: inline-flex; border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); overflow: hidden; }
  .seg button { border: 0; background: transparent; color: var(--studio-ink-1); padding: 0 10px; height: 24px; font: inherit; cursor: pointer; }
  .seg button + button { border-left: 1px solid var(--studio-edge-soft); }
  .seg button.on { color: var(--studio-on-accent); background: var(--studio-accent); }
  .search { width: 180px; height: var(--ga-control-h, 26px); padding: 0 8px; border: 1px solid var(--studio-edge); background: var(--studio-slot); color: var(--studio-ink); border-radius: var(--studio-radius); font: inherit; }
  .count { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .spacer { flex: 1; }
  .text-btn.on { color: var(--studio-accent); border-color: var(--studio-accent); }
  .close { width: 26px; height: 26px; padding: 0; display: grid; place-items: center; border: 1px solid var(--studio-edge); background: transparent; color: var(--studio-muted); border-radius: var(--studio-radius); cursor: pointer; }
  .close svg { width: 14px; height: 14px; }
  .body { flex: 1; min-height: 0; display: flex; gap: 12px; }
  .groups { flex: 0 0 170px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
  .groups button { display: flex; justify-content: space-between; height: 28px; padding: 0 10px; border: 1px solid transparent; border-radius: var(--studio-radius); background: transparent; color: var(--studio-ink-1); font: inherit; text-align: left; cursor: pointer; }
  .groups button span { color: var(--studio-muted); font-size: 11px; }
  .groups button:hover { background: var(--studio-cell); }
  .groups button.on { border-color: var(--studio-accent); color: var(--studio-ink); }
  .grid { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); grid-auto-rows: min-content; gap: 6px; align-content: start; }
  .tile { display: flex; border: 1px solid var(--studio-edge-soft); background: var(--studio-cell); border-radius: var(--studio-radius); overflow: hidden; }
  .tile:hover { border-color: var(--studio-edge); }
  .tile.heard { border-color: var(--studio-accent); }
  .hear { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 7px 8px; border: 0; background: transparent; color: var(--studio-ink); font: inherit; text-align: left; cursor: pointer; }
  .name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-title, 650); }
  .from { font-size: 10px; color: var(--studio-muted); }
  .use { border: 0; border-left: 1px solid var(--studio-edge-soft); background: transparent; color: var(--studio-accent); font: inherit; font-size: 11px; padding: 0 10px; cursor: pointer; }
  .use:hover { background: var(--studio-slot); }
  .empty { color: var(--studio-muted); }
  .build { flex: 1; display: flex; flex-direction: column; gap: 18px; padding: 8px 0; }
  .models { display: flex; flex-wrap: wrap; gap: 6px; }
  .knobs { display: flex; gap: 32px; padding: 8px 0; }
  .build-row { display: flex; gap: 6px; align-items: center; }
</style>
