<script lang="ts">
  /**
   * The drum machine's pads: sixteen to play with the mouse, the letter keys
   * (1-4, Q-R, A-F, Z-V) or a pad controller (notes 36-51). Where a pad is hit
   * sets how hard: the top edge is loudest. The kit is chosen above them, and
   * the pad last played gets its tune, level and control jack below.
   */
  import { onDestroy, onMount } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { musicKeysYield, isTypingTarget } from '../../music/musicKeyboard';
  import { KIT_FAMILY_LABELS, MACHINE_KITS, PAD_KEYS, machineKitById, padForKey, type KitFamily } from '../../music/drumMachine/machineKits';
  import { editBeat, ensureMachine, machinePadFlash, playPad } from '../../music/drumMachine/machineRuntime';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';

  let { selected = $bindable(0) }: { selected?: number } = $props();

  const beat = $derived($musicStudio.machine);
  const kit = $derived(machineKitById(beat.kitId));
  const families = Object.keys(KIT_FAMILY_LABELS) as KitFamily[];
  const kitIndex = $derived(MACHINE_KITS.findIndex((k) => k.id === kit.id));

  function setKit(id: string) {
    editBeat((b) => ({ ...b, kitId: id }));
  }

  function stepKit(by: number) {
    const n = MACHINE_KITS.length;
    setKit(MACHINE_KITS[(kitIndex + by + n) % n].id);
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
</script>

<StudioModule title="Pads" subtitle={kit.name}>
  {#snippet head()}
    <StudioJack id="cv:pad.any" label="Any" title="Every pad's hits, as a control signal" />
    <StudioJack id="audio:drums" label="Out" title="Drum sound" />
  {/snippet}
  <div class="kit-row">
    <button class="studio-btn arrow" onclick={() => stepKit(-1)} aria-label="Previous kit" title="Previous kit">‹</button>
    <select value={kit.id} onchange={(e) => setKit((e.target as HTMLSelectElement).value)} aria-label="Kit" title={kit.blurb}>
      {#each families as f (f)}
        <optgroup label={KIT_FAMILY_LABELS[f]}>
          {#each MACHINE_KITS.filter((k) => k.family === f) as k (k.id)}
            <option value={k.id}>{k.name}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
    <button class="studio-btn arrow" onclick={() => stepKit(1)} aria-label="Next kit" title="Next kit">›</button>
  </div>
  <p class="blurb">{kit.blurb}</p>
  <div class="pads" role="group" aria-label="Drum pads">
    {#each kit.pads as p, i (i)}
      <button
        class="pad"
        class:sel={selected === i}
        onpointerdown={(e) => down(e, i)}
        title="{p.name}: key {PAD_KEYS[i].toUpperCase()}, note {36 + i}. Hit near the top for louder."
        aria-label="{p.name} pad"
      >
        {#key $machinePadFlash[i]}<span class="flash" class:go={$machinePadFlash[i] > 0}></span>{/key}
        <span class="name">{p.name}</span>
        <span class="key">{PAD_KEYS[i].toUpperCase()}</span>
      </button>
    {/each}
  </div>
  <div class="pad-strip">
    <span class="ga-eyebrow sel-name">{kit.pads[selected]?.name}</span>
    <StudioKnob label="Tune" value={beat.padTune[selected] ?? 0.5} defaultValue={0.5} size={34} onchange={(v) => setPad('padTune', v)} format={(v) => `${Math.round((v - 0.5) * 24)} st`} />
    <StudioKnob label="Level" value={beat.padLevel[selected] ?? 0.5} defaultValue={0.5} size={34} onchange={(v) => setPad('padLevel', v)} />
    <StudioJack id="cv:pad.{selected}" label="Hits" title="{kit.pads[selected]?.name} hits, as a control signal: patch it to a visual" />
  </div>
</StudioModule>

<style>
  .kit-row { display: flex; gap: 4px; align-items: center; }
  .kit-row select { flex: 1; min-width: 0; }
  .arrow { width: 24px; padding: 0; }
  .blurb { margin: 4px 0 8px; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); line-height: 1.3; min-height: 2.6em; }
  .pads { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .pad {
    position: relative;
    aspect-ratio: 1;
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background: linear-gradient(180deg, var(--studio-cell), var(--studio-slot));
    color: var(--studio-ink);
    padding: 5px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-start;
    overflow: hidden;
    cursor: pointer;
    touch-action: none;
  }
  .pad:hover { border-color: var(--studio-muted); }
  .pad.sel { border-color: var(--studio-accent); }
  .pad .name { position: relative; font-size: 10px; line-height: 1.15; text-align: left; }
  .pad .key { position: relative; font-size: 9px; color: var(--studio-muted); }
  .flash { position: absolute; inset: 0; background: var(--studio-accent); opacity: 0; pointer-events: none; }
  .flash.go { animation: pad-hit 0.22s ease-out; }
  @keyframes pad-hit { from { opacity: 0.75; } to { opacity: 0; } }
  .pad-strip { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .sel-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
</style>
