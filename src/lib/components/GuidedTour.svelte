<script lang="ts">
  // Guided tour — short, hands-on paths for the three kinds of user: VJs,
  // projection mappers, and musicians syncing to a DAW. Each step points at
  // the real control and the app stays fully usable underneath: the dimming
  // is drawn by the highlight ring and ignores the pointer, so the user can
  // do each step themselves. Opened only from the welcome screen or the "?"
  // overlay, never by itself.
  import { onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { onboarding, type TourPath } from '$lib/stores/onboarding';
  import { vjClipLauncher } from '$lib/stores/vjClipLauncher';
  import { project } from '$lib/stores/layers';
  import { isMac } from '$lib/bridge';
  import { leftSidebarTab } from '$lib/stores/uiState';
  import { addLibraryShaderToDeck, addMappingSurface } from '$lib/onboarding/templates';

  type TourStep = {
    title: string;
    body: string;
    /** Short how-to lines shown under the body. */
    bullets?: string[];
    /** First selector that matches a visible, uncovered element is highlighted. */
    targets?: string[];
    /** Highlight the target even when canvas handles sit on top of it. */
    loose?: boolean;
    /** Opens or selects whatever the step talks about, as the user arrives. */
    prepare?: () => void | Promise<void>;
    action?: { label: string; run: () => void | Promise<void> };
  };
  type Path = {
    id: TourPath;
    name: string;
    detail: string;
    /** VJ mode or the mapping workspace. */
    mode: 'vj' | 'mapping';
    steps: TourStep[];
  };

  const mod = isMac ? 'Cmd' : 'Ctrl';
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const click = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.click();

  function openOutput() {
    window.dispatchEvent(new CustomEvent('ga-open-output-window'));
  }
  function closeSettings() {
    window.dispatchEvent(new CustomEvent('ga-close-settings'));
  }
  async function openMidiSettings(target: string) {
    window.dispatchEvent(new CustomEvent('open-settings'));
    await tick();
    window.dispatchEvent(new CustomEvent('ga-settings-section', { detail: { section: 'integrations:midi' } }));
    await wait(150);
    document.querySelector(`[data-tour="${target}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function openVjMedia() {
    if (document.querySelector('.right-panel-vj.collapsed')) click('.vj-right-tray-toggle');
  }
  function vjInspectorTab(label: string) {
    const tab = [...document.querySelectorAll<HTMLElement>('.effects-panel-vj .fx-tab')]
      .find((el) => el.textContent?.trim() === label);
    tab?.click();
  }
  function selectFirstVjRow() {
    if (!document.querySelector('.layer-row.selected')) click('.layer-row .layer-controls');
  }
  function sidebarTab(tab: 'layers' | 'screens') {
    leftSidebarTab.set(tab);
  }
  function selectFirstSurface() {
    const state = get(project);
    if (!state.selectedLayerId && state.layers[0]) project.selectLayer(state.layers[0].id);
  }

  const outro: TourStep = {
    title: "You're ready",
    body: 'Want a head start? A template opens a project that is already set up for a band, a club night, a liquid light show or projection mapping.',
    bullets: [
      'Take another path or this one again from the ? button at the bottom right',
      'File > New from Template opens the templates at any time',
    ],
    prepare: closeSettings,
  };

  const paths: Path[] = [
    {
      id: 'vj',
      name: 'VJ and live visuals',
      detail: 'Play clips to the music and mix them live',
      mode: 'vj',
      steps: [
        {
          title: 'Play your first visuals',
          body: 'This path covers the VJ deck: loading visuals, playing them, layering them, adding effects and sending them to a projector. It takes about three minutes.',
          bullets: ['Every step can be skipped with Next', 'Esc leaves the tour at any time'],
        },
        {
          title: 'Your Media Library',
          body: 'Everything you can play lives here.',
          bullets: [
            'FX holds the shaders, JS holds code sketches, SAVED holds looks you kept',
            'VID and IMG hold your own videos and pictures, SRC holds cameras and live inputs',
            'Drag any item onto an empty cell in the deck',
            'Add Files imports media, or drop files from your computer straight onto a row',
          ],
          targets: ['.right-panel-vj'],
          prepare: openVjMedia,
          action: {
            label: 'Add one for me',
            run: async () => {
              const state = get(vjClipLauncher);
              if (!state.clipGrid[0]?.[0]) await addLibraryShaderToDeck('STAGE-BeamRig', 0, 0);
            },
          },
        },
        {
          title: 'Play a clip',
          body: 'Each cell in the deck is a clip. Rows are layers and the numbered buttons along the top are columns.',
          bullets: [
            'Click a clip to play it',
            'Click another clip in the same row to switch to it, since a row plays one clip at a time',
            'Click a column number to play that whole column at once',
            'Right-click a clip for its options',
          ],
          targets: ['.layer-row .clip-cell.has-clip', '.layer-row .clip-cell'],
          action: {
            label: 'Play it for me',
            run: () => {
              const state = get(vjClipLauncher);
              const row = state.clipGrid.findIndex((cells) => cells.some(Boolean));
              if (row < 0) return;
              vjClipLauncher.triggerClip(row, state.clipGrid[row].findIndex(Boolean), 'A');
            },
          },
        },
        {
          title: 'What your audience sees',
          body: 'This preview is the finished picture. Everything that leaves the app, from the projector to screens and recordings, comes from here.',
          bullets: ['With Split Deck A/B on, small Deck A and Deck B monitors appear beside it'],
          targets: ['.program-preview'],
        },
        {
          title: 'Layers stack from the top',
          body: 'Each row is a layer, and the top row sits on top of the ones below.',
          bullets: [
            'The fader sets how much of the row shows',
            'S solos the row, M mutes it and the square stops it',
            'The blend menu sets how the row mixes with the rows under it',
            'Drag the thumbnail on the left to move the row up or down',
          ],
          targets: ['.layer-row .layer-controls'],
        },
        {
          title: 'Add effects',
          body: 'Effects can sit on the whole output, on one row or on one clip.',
          bullets: [
            'Comp: effects on everything that leaves the app',
            'Layer: effects on the selected row, whatever clip it plays',
            'Clip: effects that travel with one clip',
            'Press + Add on a tab to choose an effect',
          ],
          targets: ['.effects-panel-vj'],
          prepare: () => { selectFirstVjRow(); vjInspectorTab('Layer'); },
        },
        {
          title: 'Play to the music',
          body: 'Tempo drives launches, beat effects and audio-synced looks.',
          bullets: [
            'Tap: tap along to set the tempo',
            'Detect tempo: follow the music coming into your audio input',
            'Quantize: set it to 1 bar and the clips you click wait for the next bar',
            'Nudge: push the beat earlier or later to line it up with the band',
          ],
          targets: ['.bpm-tap-widget'],
        },
        {
          title: 'Two decks and a crossfader',
          body: 'Split Deck A/B gives you two decks with a crossfader between them, so you can line up the next look while the current one plays.',
          bullets: [
            'The Split Deck A/B button sits in the bar above the deck while you are live',
            'Switch it on, load Deck B, then move the crossfader to change over',
          ],
          targets: ['.ab-toggle-btn'],
        },
        {
          title: 'Your projector',
          body: 'Send the picture to a projector or a second screen.',
          bullets: [
            'Open the output window with the button below, or with Output Window in the main toolbar',
            'Drag that window onto the projector screen',
            'Stage Edit splits the picture across several screens',
          ],
          targets: ['button[title^="Edit live 2D stage"]'],
          action: { label: 'Open the output window', run: openOutput },
        },
        outro,
      ],
    },
    {
      id: 'mapping',
      name: 'Projection mapping',
      detail: 'Fit visuals onto stages, walls and objects',
      mode: 'mapping',
      steps: [
        {
          title: 'Map onto real things',
          body: 'This path covers adding surfaces, fitting them to real objects, choosing what plays on them and sending them to your projectors. It takes about three minutes.',
          bullets: ['Point your projector at the object first so you can see the result as you go', 'Esc leaves the tour at any time'],
          prepare: () => sidebarTab('layers'),
        },
        {
          title: 'Add a surface',
          body: 'Each surface is a layer. Add one for every object or wall you want to cover, such as a drum riser, a screen or a column.',
          bullets: ['Add Layer opens a menu of layer types', 'The newest layer sits on top of the others'],
          targets: ['.layer-panel .add-layer-wrapper .btn-add'],
          prepare: () => sidebarTab('layers'),
          action: {
            label: 'Add one for me',
            run: async () => {
              const before = get(project).layers.length;
              await addMappingSurface(`Surface ${before + 1}`);
            },
          },
        },
        {
          title: 'Fit it to the object',
          body: 'With the surface selected, its handles appear on the canvas.',
          bullets: [
            'Drag the four corner handles onto the corners of your object',
            'Drag the centre handle to move it and the top circle to rotate it',
            'Arrow keys nudge the selection for fine alignment',
            'For curved or uneven surfaces, set Warp Mode to Mesh in its properties and pull the grid points',
          ],
          targets: ['.canvas-wrapper'],
          loose: true,
          prepare: selectFirstSurface,
        },
        {
          title: 'Choose what plays on it',
          body: 'Swap the test pattern for real content.',
          bullets: [
            'Drag a shader, video or image from the Media Library onto the surface',
            'When a shader is selected, its controls appear above the library',
          ],
          targets: ['.media-tray'],
          prepare: selectFirstSurface,
        },
        {
          title: 'Fine-tune the surface',
          body: 'The selected surface’s properties sit under the layer list.',
          bullets: [
            'Opacity and blend mode set how it mixes with surfaces underneath',
            'Content Fit and Source Crop decide which part of the picture lands on it',
            'Edge Feather softens its edges',
          ],
          targets: ['.layer-properties'],
          prepare: async () => {
            sidebarTab('layers');
            selectFirstSurface();
            await tick();
            await wait(150);
            document.querySelector('.layer-properties')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          },
        },
        {
          title: 'Several projectors',
          body: 'Screens are the output regions your projectors and senders show.',
          bullets: [
            'Add a Screen for each projector',
            'Each Screen has its own warp, edge blending and effects',
            'Where two projectors overlap, blending hides the seam',
          ],
          targets: ['.left-sidebar'],
          prepare: () => sidebarTab('screens'),
        },
        {
          title: 'Rehearse before you arrive',
          body: 'Map Sim shows your mapping on a 3D model of the room, so you can plan the show before you are on site.',
          targets: ['.map-sim-btn'],
          prepare: () => sidebarTab('layers'),
        },
        {
          title: 'Your projector',
          body: 'Send the mapping to the real projector.',
          bullets: [
            'Output Window opens the output in its own window',
            'Drag that window onto the projector screen and every surface lands on its object',
          ],
          targets: ['.toolbar-center .output-btn'],
          action: { label: 'Open the output window', run: openOutput },
        },
        outro,
      ],
    },
    {
      id: 'music',
      name: 'Musician with a DAW',
      detail: 'Lock visuals to your sound, your tempo and your controllers',
      mode: 'mapping',
      steps: [
        {
          title: 'Play in time with your music',
          body: 'This path covers listening to your sound, following your DAW’s tempo and mapping your MIDI controllers. It takes about three minutes.',
          bullets: ['Esc leaves the tour at any time'],
          prepare: closeSettings,
        },
        {
          title: 'Listen to the sound',
          body: 'Give Ghost Arcade an audio input so the visuals can react.',
          bullets: [
            'Click the microphone to start listening',
            'The arrow next to it picks the input: your audio interface, a mixer feed or a mic',
            'The meter beside it shows the level coming in',
          ],
          targets: ['.audio-input-picker'],
          prepare: closeSettings,
        },
        {
          title: 'Make the visuals react',
          body: 'Any parameter can follow the music.',
          bullets: [
            'Click Mod beside a parameter to drive it from an audio band, an LFO or the beat',
            'Many shaders in the library react to sound on their own',
            'In VJ mode, the macro knobs along the top reshape the whole look at once',
          ],
          prepare: closeSettings,
        },
        {
          title: 'Set the tempo',
          body: 'Beat-synced launches and effects follow this tempo.',
          bullets: [
            'Tap: tap along to set it by hand',
            'Detect tempo: follow the music coming into your audio input',
            'Or let your DAW set it, which is the next step',
          ],
          targets: ['.bpm-tap-widget'],
          prepare: closeSettings,
        },
        {
          title: 'Follow your DAW’s clock',
          body: 'MIDI clock locks Ghost Arcade to your DAW’s tempo.',
          bullets: [
            'In your DAW, send MIDI clock to a MIDI port, such as the IAC Driver on a Mac or loopMIDI on Windows',
            'Here, turn on Receive MIDI Clock and choose that port',
            'Send MIDI Clock does the opposite, if the visuals should lead',
          ],
          targets: ['[data-tour="midi-clock"]'],
          prepare: () => openMidiSettings('midi-clock'),
        },
        {
          title: 'Or use Ableton Link',
          body: 'Link keeps tempo in sync over your network, with no cables or MIDI ports.',
          bullets: [
            'Works with Ableton Live, Bitwig, Serato, Rekordbox and other Link apps on the same network',
            'Turn on Enable Ableton Link and the tempo stays locked both ways',
            'If MIDI clock is also coming in, it takes priority',
          ],
          targets: ['[data-tour="ableton-link"]', '[data-tour="ableton-link-title"]'],
          prepare: () => openMidiSettings('ableton-link'),
        },
        {
          title: 'Map your controllers',
          body: 'Put any control in the app on a knob, fader, pad or a note from your DAW.',
          bullets: [
            `Press ${mod}+M or Enter MIDI Learn`,
            'Click the control you want to map',
            'Move the knob, fader or pad, or send the note, and it is mapped',
            `Press ${mod}+M again when you are done`,
          ],
          targets: ['[data-tour="midi-learn"]'],
          prepare: () => openMidiSettings('midi-learn'),
        },
        outro,
      ],
    },
  ];

  let rect: { x: number; y: number; w: number; h: number } | null = null;
  let cardEl: HTMLDivElement | null = null;
  let cardPos = { left: 0, top: 0 };
  let busy = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  $: open = $onboarding.tourOpen;
  $: path = paths.find((p) => p.id === $onboarding.tourPath) ?? null;
  $: steps = path?.steps ?? [];
  $: index = Math.min($onboarding.tourStep, Math.max(0, steps.length - 1));
  $: step = path ? steps[index] : null;
  $: isLast = !!path && index === steps.length - 1;

  /** The part of an element actually on screen: clipped by the window and
   *  by any scrolling panel it sits in. */
  function visiblePart(el: HTMLElement): DOMRect | null {
    const r = el.getBoundingClientRect();
    let left = Math.max(r.left, 0);
    let top = Math.max(r.top, 0);
    let right = Math.min(r.right, window.innerWidth);
    let bottom = Math.min(r.bottom, window.innerHeight);
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (!/(auto|scroll|hidden)/.test(style.overflow + style.overflowY + style.overflowX)) continue;
      const p = parent.getBoundingClientRect();
      left = Math.max(left, p.left);
      top = Math.max(top, p.top);
      right = Math.min(right, p.right);
      bottom = Math.min(bottom, p.bottom);
    }
    if (right - left <= 0 || bottom - top <= 0) return null;
    return new DOMRect(left, top, right - left, bottom - top);
  }

  function findTarget(selectors: string[] | undefined, loose = false): DOMRect | null {
    for (const selector of selectors ?? []) {
      for (const el of document.querySelectorAll(selector)) {
        const r = visiblePart(el as HTMLElement);
        if (!r || r.width <= 4 || r.height <= 4) continue;
        if (loose) return r;
        // Skip copies hidden under another panel (the main toolbar keeps its
        // own tempo controls underneath VJ mode). The tour's own card is
        // ignored, since it may be sitting over the target right now.
        const top = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          .find((hit) => !hit.closest('.tour-layer'));
        if (top && (el === top || el.contains(top))) return r;
      }
    }
    return null;
  }

  function measure() {
    if (!open) return;
    const target = step ? findTarget(step.targets, step.loose) : null;
    const pad = 6;
    rect = target
      ? { x: target.left - pad, y: target.top - pad, w: target.width + pad * 2, h: target.height + pad * 2 }
      : null;
    const cw = cardEl?.offsetWidth ?? 380;
    const ch = cardEl?.offsetHeight ?? 220;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 16;
    let left = (vw - cw) / 2;
    let top = (vh - ch) / 2;
    if (rect) {
      left = rect.x + rect.w / 2 - cw / 2;
      if (rect.y + rect.h + margin + ch < vh) top = rect.y + rect.h + margin;
      else if (rect.y - margin - ch > 0) top = rect.y - margin - ch;
      else if (rect.x - margin - cw > 0) { left = rect.x - margin - cw; top = rect.y + rect.h / 2 - ch / 2; }
      else if (rect.x + rect.w + margin + cw < vw) { left = rect.x + rect.w + margin; top = rect.y + rect.h / 2 - ch / 2; }
    }
    cardPos = {
      left: Math.round(Math.max(margin, Math.min(vw - cw - margin, left))),
      top: Math.round(Math.max(margin, Math.min(vh - ch - margin, top))),
    };
  }

  // Put the user in the workspace the path is about: VJ mode for the VJ
  // path, the main window for mapping and DAW sync. Checked on every step in
  // case something switched it in between.
  $: if (open && path && index >= 0) {
    const vjOpen = get(vjClipLauncher).isOpen;
    // Open and live, as the VJ button does: clips only fire on a live deck.
    if (path.mode === 'vj' && !vjOpen) { vjClipLauncher.setOpen(true); vjClipLauncher.setLive(true); }
    if (path.mode === 'mapping' && vjOpen) vjClipLauncher.setOpen(false);
  }
  // Run each step's set-up once, when the user arrives on it.
  let preparedKey = '';
  $: if (open && path && step) {
    const key = `${path.id}:${index}`;
    if (key !== preparedKey) {
      preparedKey = key;
      void Promise.resolve(step.prepare?.()).then(() => setTimeout(measure, 300));
    }
  } else if (!open) {
    preparedKey = '';
  }
  $: if (open) {
    if (!timer) timer = setInterval(measure, 250);
    void tick().then(measure);
  } else if (timer) {
    clearInterval(timer);
    timer = null;
  }
  $: if (open && (index >= 0 || path)) void tick().then(measure);

  function go(to: number) {
    onboarding.setTourStep(Math.max(0, Math.min(steps.length - 1, to)));
  }

  async function runAction() {
    if (!step?.action || busy) return;
    busy = true;
    try { await step.action.run(); } finally { busy = false; }
    setTimeout(measure, 350);
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); onboarding.endTour(); }
  }

  onDestroy(() => { if (timer) clearInterval(timer); });
</script>

<svelte:window onkeydown={onKey} onresize={measure} />

{#if open}
  <div class="tour-layer" aria-live="polite">
    {#if rect}
      <div class="tour-ring" style="left:{rect.x}px;top:{rect.y}px;width:{rect.w}px;height:{rect.h}px"></div>
    {:else}
      <div class="tour-dim"></div>
    {/if}

    {#if !path}
      <div class="tour-card tour-chooser" bind:this={cardEl} style="left:{cardPos.left}px;top:{cardPos.top}px"
        role="dialog" aria-labelledby="tour-title">
        <p class="tour-eyebrow">Guided tour</p>
        <h2 id="tour-title">What brings you to Ghost Arcade?</h2>
        <p class="tour-body">Pick a path and we’ll show you the parts that matter for it. You can take the others later from the ? button.</p>
        <div class="tour-paths">
          {#each paths as option (option.id)}
            <button class="tour-path" onclick={() => onboarding.choosePath(option.id)}>
              <span class="tour-path-icon" aria-hidden="true">
                {#if option.id === 'vj'}
                  <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M10 8.5v4l3.5-2z" /><path d="M7 20h10" /></svg>
                {:else if option.id === 'mapping'}
                  <svg viewBox="0 0 24 24"><path d="M3 8l9-4 9 4-9 4z" /><path d="M3 8v8l9 4 9-4V8" /><path d="M12 12v8" /></svg>
                {:else}
                  <svg viewBox="0 0 24 24"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></svg>
                {/if}
              </span>
              <span class="tour-path-text">
                <span class="tour-path-name">{option.name}</span>
                <span class="tour-path-detail">{option.detail}</span>
              </span>
              <svg class="tour-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          {/each}
        </div>
        <div class="tour-nav">
          <button class="tour-ghost" onclick={() => onboarding.endTour()}>Not now</button>
        </div>
      </div>
    {:else if step}
      <div class="tour-card" bind:this={cardEl} style="left:{cardPos.left}px;top:{cardPos.top}px"
        role="dialog" aria-labelledby="tour-title">
        <div class="tour-head">
          <p class="tour-eyebrow">{path.name}</p>
          <div class="tour-dots" aria-label="Step {index + 1} of {steps.length}">
            {#each steps as _s, i}
              <span class="tour-dot" class:done={i < index} class:current={i === index}></span>
            {/each}
          </div>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p class="tour-body">{step.body}</p>
        {#if step.bullets?.length}
          <ul class="tour-bullets">
            {#each step.bullets as line}
              <li>{line}</li>
            {/each}
          </ul>
        {/if}
        {#if step.action}
          <button class="tour-action" disabled={busy} onclick={runAction}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3L4 14h7l-1 7 9-11h-7z" /></svg>
            {step.action.label}
          </button>
        {/if}
        <div class="tour-nav">
          <button class="tour-ghost" onclick={() => onboarding.endTour()}>End tour</button>
          <div class="tour-nav-right">
            {#if index > 0}
              <button class="tour-back" onclick={() => go(index - 1)}>Back</button>
            {:else}
              <button class="tour-back" onclick={() => onboarding.choosePath(null)}>Other paths</button>
            {/if}
            {#if isLast}
              <button class="tour-back" onclick={() => onboarding.openTemplates()}>Browse templates</button>
              <button class="tour-next" onclick={() => onboarding.endTour()}>Finish</button>
            {:else}
              <button class="tour-next" onclick={() => go(index + 1)}>
                Next
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .tour-layer {
    position: fixed;
    inset: 0;
    /* Above Settings, which the DAW path opens. */
    z-index: 210000;
    pointer-events: none;
  }
  .tour-dim {
    position: absolute;
    inset: 0;
    background: rgba(3, 4, 8, 0.6);
  }
  .tour-ring {
    position: absolute;
    border-radius: 12px;
    border: 1.5px solid rgba(168, 188, 255, 0.95);
    box-shadow:
      0 0 0 9999px rgba(3, 4, 8, 0.6),
      0 0 0 4px rgba(143, 180, 255, 0.18),
      0 0 28px rgba(143, 180, 255, 0.45);
    transition: left 0.25s ease, top 0.25s ease, width 0.25s ease, height 0.25s ease;
    animation: ring-pulse 2.4s ease-in-out infinite;
  }
  @keyframes ring-pulse {
    50% { box-shadow: 0 0 0 9999px rgba(3, 4, 8, 0.6), 0 0 0 7px rgba(143, 180, 255, 0.1), 0 0 36px rgba(143, 180, 255, 0.55); }
  }

  .tour-card {
    position: absolute;
    width: 400px;
    max-width: calc(100vw - 32px);
    box-sizing: border-box;
    pointer-events: auto;
    padding: 20px 20px 16px;
    border-radius: 16px;
    color: #e9edf5;
    background: rgba(15, 17, 24, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.09);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(143, 180, 255, 0.05) inset;
    backdrop-filter: blur(18px);
    transition: left 0.25s ease, top 0.25s ease;
  }
  .tour-chooser { width: 440px; }
  .tour-bullets {
    margin: -4px 0 14px;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 7px;
  }
  .tour-bullets li {
    position: relative;
    padding-left: 16px;
    font-size: 13px;
    line-height: 1.45;
    color: #c4cbd8;
  }
  .tour-bullets li::before {
    content: '';
    position: absolute;
    left: 2px;
    top: 0.55em;
    width: 6px;
    height: 6px;
    border-radius: 2px;
    background: linear-gradient(135deg, #8fa8ff, #b993ff);
  }

  .tour-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  .tour-eyebrow {
    margin: 0;
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    text-transform: uppercase;
    color: var(--ga-blue-200, #a8bcff);
  }
  .tour-chooser .tour-eyebrow { margin-bottom: 8px; }
  .tour-dots { display: flex; gap: 5px; }
  .tour-dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.14);
    transition: width 0.2s, background 0.2s;
  }
  .tour-dot.done { background: rgba(143, 180, 255, 0.5); }
  .tour-dot.current { width: 18px; background: #a8bcff; }

  h2 {
    margin: 0 0 8px;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #f4f6fb;
  }
  .tour-body {
    margin: 0 0 14px;
    font-size: 13px;
    line-height: 1.55;
    color: #aab3c4;
  }

  button {
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .tour-action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    margin-bottom: 14px;
    padding: 10px 12px;
    border-radius: 10px;
    color: #dfe7ff;
    background: linear-gradient(135deg, rgba(110, 145, 255, 0.2), rgba(170, 120, 255, 0.14));
    border: 1px solid rgba(143, 180, 255, 0.4);
    font-weight: 600;
  }
  .tour-action:hover:not(:disabled) { border-color: rgba(170, 200, 255, 0.85); }
  .tour-action:disabled { opacity: 0.6; cursor: progress; }
  .tour-action svg { width: 15px; height: 15px; fill: #a8bcff; }

  .tour-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .tour-nav-right { display: flex; gap: 6px; }
  .tour-ghost {
    padding: 7px 0;
    background: none;
    border: none;
    color: #7f889b;
  }
  .tour-ghost:hover { color: #c9d4ee; }
  .tour-back {
    padding: 7px 12px;
    border-radius: 9px;
    color: #d6dceb;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .tour-back:hover { border-color: rgba(255, 255, 255, 0.25); }
  .tour-next {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 7px 12px 7px 14px;
    border-radius: 9px;
    border: none;
    color: #0b0f1d;
    font-weight: 650;
    background: linear-gradient(135deg, #8fa8ff, #b993ff);
    box-shadow: 0 6px 18px rgba(110, 120, 255, 0.35);
  }
  .tour-next svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .tour-paths { display: grid; gap: 8px; margin-bottom: 14px; }
  .tour-path {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 12px;
    text-align: left;
    color: inherit;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    transition: background 0.15s, border-color 0.15s;
  }
  .tour-path:hover, .tour-path:focus-visible {
    background: rgba(143, 180, 255, 0.07);
    border-color: rgba(143, 180, 255, 0.4);
    outline: none;
  }
  .tour-path-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: rgba(143, 180, 255, 0.1);
    border: 1px solid rgba(143, 180, 255, 0.18);
  }
  .tour-path-icon svg {
    width: 19px;
    height: 19px;
    fill: none;
    stroke: #a8bcff;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tour-path-text { display: grid; gap: 2px; }
  .tour-path-name { font-size: 13px; font-weight: 650; color: #f1f4fa; }
  .tour-path-detail { font-size: 12px; color: #98a1b3; }
  .tour-chevron {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: #6f788a;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.15s, stroke 0.15s;
  }
  .tour-path:hover .tour-chevron { transform: translateX(3px); stroke: #c9d4ee; }

  @media (prefers-reduced-motion: reduce) {
    .tour-ring { animation: none; transition: none; }
    .tour-card { transition: none; }
  }
</style>
