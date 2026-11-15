<script lang="ts">
  /**
   * The Timeline's toolbar: one 40 px row of clusters, as pro editors have
   * it. Left: transport and time (home, play, stop, loop with what happens
   * at the end, the time readout, tempo, timecode). Middle: the editing
   * tools, snapping, the grid, the ruler and zoom (once there is something
   * to edit). Right: the show's audio output, Record, a compact GO and
   * Perform, then the window buttons (room to work, help, more, close).
   *
   * It reads the show through slices; the time readout is the only part that
   * follows the playhead. Icons are blue (structure); coral only for what is
   * live (Record on, Loop on, taken over).
   */
  import type { Snippet } from 'svelte';
  import { get } from 'svelte/store';
  import { showTimeline, SHOW_MIN_ZOOM, SHOW_MAX_ZOOM, type ShowEndAction } from '../../../stores/showTimeline';
  import type { ShowSnapGrid } from '../../../types';
  import { formatBarsBeats } from '../../../show/tempoMap';
  import { timecodeChase } from '../../../show/timecode/timecodeChase';
  import { liveTakeover, takeoverSummary } from '../../../show/takeover/liveTakeover';
  import { openExternalUrl } from '$lib/bridge';
  import { tooltipsEnabled } from '../../../help/preferences';
  import { onboarding } from '../../../stores/onboarding';
  import { showSlice } from './timelineSlices';
  import { formatPrecise } from './timeFormat';
  import { EDIT_TOOLS, editTool, type EditTool } from './editTools';
  import { linePenTool } from './lineUi';
  import { transportFit } from './transportFit';
  import { sideColumn, performShown } from './sideColumn';
  import { roomToWork, toggleRoomToWork } from './roomToWork';
  import TimelineIcon, { type TimelineIconName } from './TimelineIcon.svelte';
  import TlPopover from './TlPopover.svelte';
  import OutputButton from './OutputButton.svelte';
  import ShowAudioDelayBadge from './ShowAudioDelayBadge.svelte';
  import { rehearsalAudioDelayActive } from '../../../show/rehearsal/editorRehearsal';
  import LineRecordControls from './LineRecordControls.svelte';

  interface Props {
    /** The Timeline document (the Show keeps its own tools in `showDocTools`). */
    isTimeline: boolean;
    zoomBy: (factor: number) => void;
    zoomFit: () => void;
    onclear: () => void;
    /** GO in the toolbar: shown, what it does, and the standby's name. */
    goShown: boolean;
    goTitle: string;
    goWord: string;
    go: () => void;
    /** The Timeline has something to edit (blocks of any kind). */
    hasBlocks: boolean;
    /** Tools that only the Show document has (preset select, transition chip…). */
    showDocTools?: Snippet;
  }
  let { isTimeline, zoomBy, zoomFit, onclear, goShown, goTitle, goWord, go, hasBlocks, showDocTools }: Props = $props();

  /** The Timeline guide on the website. */
  const TIMELINE_HELP_URL = 'https://ghostarcade.live/docs/timeline';
  const MOD_KEY = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';

  const isPlaying = showSlice('isPlaying');
  const currentTime = showSlice('currentTime');
  const duration = showSlice('duration');
  const loop = showSlice('loop');
  const endAction = showSlice('endAction');
  const tempo = showSlice('tempo');
  const snapEnabled = showSlice('snapEnabled');
  const snapGrid = showSlice('snapGrid');
  const rulerMode = showSlice('rulerMode');
  const zoom = showSlice('zoom');
  const selection = showSlice('selection');
  const audioTracks = showSlice('audioTracks');
  const layerTracks = showSlice('layerTracks');

  // The Timeline plays even empty (time to listen and to record into); the Show needs something on it.
  const canPlay = $derived($duration > 0 || isTimeline);

  const END_ACTIONS: Array<{ value: ShowEndAction; label: string; short: string }> = [
    { value: 'hold', label: 'Hold the last look', short: 'Hold' },
    { value: 'rewind', label: 'Back to the start', short: 'Back to start' },
    { value: 'blackout', label: 'Blackout', short: 'Blackout' },
  ];
  const endShort = $derived(END_ACTIONS.find((a) => a.value === $endAction)?.short ?? 'Hold');

  const SNAP_GRID_CHOICES: Array<{ value: ShowSnapGrid; label: string }> = [
    { value: 'bar', label: '1 bar' },
    { value: 'beat', label: '1 beat' },
    { value: 'half', label: '½ beat' },
    { value: 'quarter', label: '¼ beat' },
    { value: 'sixteenth', label: '1/16' },
    { value: 'seconds', label: '¼ second' },
  ];

  const TOOL_ICONS: Record<EditTool, TimelineIconName> = {
    select: 'select', razor: 'razor', ripple: 'ripple', roll: 'roll', slip: 'slip', forward: 'forward',
  };

  // ── Timecode, Link, MIDI clock ─────────────────────────────────────────
  const chaseStatus = timecodeChase.status;
  const chaseSettings = timecodeChase.settings;
  const tc = $derived($chaseStatus);
  const LOCK_TEXT: Record<string, string> = { searching: 'TC searching', locked: 'TC locked', freewheel: 'TC freewheel', lost: 'TC lost' };
  const BEAT_LOCK_TEXT: Record<string, Record<string, string>> = {
    link: { searching: 'Link searching', locked: 'Link', freewheel: 'Link freewheel', lost: 'Link lost' },
    midiClock: { searching: 'Clock searching', locked: 'Clock', freewheel: 'Clock freewheel', lost: 'Clock lost' },
    liveSong: { searching: 'Live searching', locked: 'Live', freewheel: 'Live freewheel', lost: 'Live lost' },
  };
  const tcSource = $derived($chaseSettings.source);
  const tcText = $derived((BEAT_LOCK_TEXT[tcSource] ?? LOCK_TEXT)[tc.lock] ?? tc.lock);
  const tcSourceName = $derived(tcSource === 'link' ? 'Link' : tcSource === 'liveSong' ? 'Live' : 'MIDI clock');
  const tcMismatchText = $derived(tc.mismatch && tc.sourceBpm !== null && tc.showBpm !== null
    ? `${tcSourceName} is at ${tc.sourceBpm.toFixed(1)} BPM, the show's map at ${tc.showBpm.toFixed(1)} BPM. Still following; the audio plays at ${tcSourceName}'s tempo.`
    : '');
  const tcNoticeText = $derived(tc.notice === 'linkNoPeers'
    ? 'No Link peers: start Live or another Link app, or set Link to start on the show\'s Play (Settings > Show control > Timecode).'
    : tc.notice === 'linkStartsWithSession'
      ? 'The show starts with the Link session: press Play in Live or another Link app.'
      : tc.notice === 'liveNotConnected'
        ? 'Live is not connected: open the Ableton panel and check the Ghost Arcade control surface in Live.'
        : '');
  const tcWarn = $derived(!!tcNoticeText || !!tcMismatchText || tc.lock === 'lost');

  // ── Taken over ────────────────────────────────────────────────────────
  const takeover = $derived(takeoverSummary($liveTakeover));

  // ── Menus ─────────────────────────────────────────────────────────────
  type Menu = 'loop' | 'tc' | 'help' | 'more' | null;
  let menu: Menu = $state(null);
  let loopAnchor: HTMLElement | undefined = $state();
  let tcAnchor: HTMLElement | undefined = $state();
  let helpAnchor: HTMLElement | undefined = $state();
  let moreAnchor: HTMLElement | undefined = $state();
  function toggleMenu(m: Exclude<Menu, null>) { menu = menu === m ? null : m; }

  function openShortcuts() {
    menu = null;
    window.dispatchEvent(new CustomEvent('ga-open-shortcuts', { detail: { section: 'timeline' } }));
  }
  function openTimecodeSettings() {
    menu = null;
    window.dispatchEvent(new CustomEvent('open-settings'));
    setTimeout(() => window.dispatchEvent(new CustomEvent('ga-settings-section', { detail: { section: 'show:timecode' } })), 0);
  }
  function startTour() {
    menu = null;
    onboarding.startTour('timeline');
  }

  // How tight the toolbar is (0 roomy … 3 tightest): stepped up until the
  // clusters fit on one row. 1: shorter labels; 2: icons only for Snap,
  // Record's mode and Perform, no total; 3: the tools as one menu.
  const FIT_MAX = 3;
  let fit = $state(0);
  const selectedTempo = $derived($selection?.kind === 'tempo');
</script>

<div
  class="tlbar"
  class:fit1={fit >= 1}
  class:fit2={fit >= 2}
  class:fit3={fit >= 3}
  use:transportFit={{ max: FIT_MAX, set: (level) => (fit = level) }}
  data-transport-fit={fit}
  data-timeline-toolbar
>
  <!-- Transport and time -->
  <div class="cl" data-help="Transport: go to the start, play, stop, loop (and what happens at the end), the time and the tempo." data-toolbar-transport>
    <span class="title" data-show-doc-name>{isTimeline ? 'Timeline' : 'Show'}</span>
    <button class="b icon" onclick={() => showTimeline.seek(0)} title="Go to the start (Home)" aria-label="Go to the start"><TimelineIcon name="home" /></button>
    <button
      class="b play"
      class:playing={$isPlaying}
      disabled={!canPlay}
      onclick={() => showTimeline.togglePlay()}
      title={$isPlaying ? 'Pause (Space)' : 'Play (Space)'}
      aria-label={$isPlaying ? 'Pause' : 'Play'}
      data-show-play
    ><TimelineIcon name={$isPlaying ? 'pause' : 'play'} size={15} /></button>
    <button class="b icon" onclick={() => showTimeline.stop()} title="Stop and go back to the start" aria-label="Stop"><TimelineIcon name="stop" size={14} /></button>
    <span class="split" class:on={$loop}>
      <button class="b" onclick={() => showTimeline.setLoop(!$loop)} title={$loop ? 'Loop is on: the show (or the in and out points) plays again from the start' : 'Loop the show (with in and out points: between them)'} aria-label="Loop" aria-pressed={$loop} data-show-loop>
        <TimelineIcon name="loop" /><span class="lbl hide1">{$loop ? 'Loop' : endShort}</span>
      </button>
      <button class="b caret" bind:this={loopAnchor} onclick={() => toggleMenu('loop')} title="At the end of the show" aria-label="At the end of the show" aria-expanded={menu === 'loop'} data-show-end-menu><TimelineIcon name="caret" size={12} /></button>
    </span>
    <span class="readout" title={$tempo ? 'Time at the playhead / the show\'s length │ bar, beat and sixteenth' : 'Time at the playhead / the show\'s length'}>
      <span class="t">{formatPrecise($currentTime)}</span>
      <span class="tot hide2">/ {formatPrecise($duration)}</span>
      {#if $tempo}<span class="bars" data-show-bars-readout>{formatBarsBeats($tempo, $currentTime, true)}</span>{/if}
    </span>
    <button
      class="b box chip"
      class:sel={selectedTempo}
      onclick={() => showTimeline.select(selectedTempo ? null : { kind: 'tempo', id: 'tempo' })}
      title="The show's tempo map: BPM, time signature and where bar 1 is"
      data-show-tempo
    ><TimelineIcon name="tempo" /><span class="num">{$tempo ? `${Math.round($tempo.segments[0].bpm * 10) / 10} BPM` : 'Tempo'}</span></button>
    {#if tc.lock !== 'off'}
      <button
        class="b box chip tc"
        class:locked={tc.lock === 'locked'}
        class:warn={tcWarn}
        bind:this={tcAnchor}
        onclick={() => toggleMenu('tc')}
        title={tc.error ?? `${tcText}${tc.rate ? `, ${tc.rate} fps` : ''}`}
        data-show-tc-badge
      ><span class="tc-dot"></span><span class="num">{tcText}{tc.rate ? ` ${tc.rate} fps` : ''}{tc.label ? ` ${tc.label}` : ''}{tc.waiting ? ' · next bar' : ''}</span>{#if tcWarn}<span class="warn-dot" aria-hidden="true"></span>{/if}</button>
    {/if}
  </div>

  <!-- Editing -->
  {#if !isTimeline || hasBlocks}
    <div class="cl sep" data-help="Editing: the tools (with their keys), snapping, the snap grid, the ruler and zoom." data-toolbar-edit>
      {#if isTimeline && $layerTracks.length}
        <span class="seg tools full-tools" role="group" aria-label="Editing tool" data-show-tool>
          {#each EDIT_TOOLS as tool (tool.id)}
            <button class:on={$editTool === tool.id} onclick={() => editTool.set(tool.id)} title="{tool.label} ({tool.key}): {tool.hint}" aria-label={tool.label} aria-pressed={$editTool === tool.id} data-tool={tool.id}><TimelineIcon name={TOOL_ICONS[tool.id]} /></button>
          {/each}
          <button class:on={$linePenTool} onclick={() => linePenTool.set(!$linePenTool)} title="Draw lines: press and draw on a line lane" aria-label="Draw lines" aria-pressed={$linePenTool} data-line-pen-tool><TimelineIcon name="pen" /></button>
        </span>
        <select
          class="sel-tool small-tools"
          value={$editTool}
          onchange={(e) => editTool.set((e.currentTarget as HTMLSelectElement).value as EditTool)}
          title={EDIT_TOOLS.find((t) => t.id === $editTool)?.hint ?? ''}
          aria-label="Editing tool"
        >
          {#each EDIT_TOOLS as tool (tool.id)}<option value={tool.id}>{tool.label} ({tool.key})</option>{/each}
        </select>
      {/if}
      <button class="b box" class:sel={$snapEnabled} onclick={() => showTimeline.setSnapEnabled(!$snapEnabled)} title="Snap to the grid, block edges, the playhead and markers (S). Hold {MOD_KEY} while dragging to move freely." aria-label="Snap" aria-pressed={$snapEnabled} data-show-snap>
        <TimelineIcon name="snap" /><span class="lbl hide2">Snap</span>
      </button>
      {#if $tempo}
        <select class="grid-sel" value={$snapGrid} onchange={(e) => showTimeline.setSnapGrid((e.currentTarget as HTMLSelectElement).value as ShowSnapGrid)} title="Snap grid" aria-label="Snap grid">
          {#each SNAP_GRID_CHOICES as g (g.value)}<option value={g.value}>{g.label}</option>{/each}
        </select>
        <span class="seg" role="group" aria-label="Ruler">
          <button class:on={$rulerMode === 'bars'} onclick={() => showTimeline.setRulerMode('bars')} title="Ruler in bars and beats" data-show-ruler-bars>Bars</button>
          <button class:on={$rulerMode === 'time'} onclick={() => showTimeline.setRulerMode('time')} title="Ruler in minutes and seconds">Time</button>
        </span>
      {/if}
      <button class="b icon" onclick={() => zoomBy(1 / 1.25)} disabled={$zoom <= SHOW_MIN_ZOOM} title="Zoom out (−)" aria-label="Zoom out"><TimelineIcon name="zoom-out" /></button>
      <button class="b icon" onclick={() => zoomBy(1.25)} disabled={$zoom >= SHOW_MAX_ZOOM} title="Zoom in (=)" aria-label="Zoom in"><TimelineIcon name="zoom-in" /></button>
      <button class="b icon" onclick={zoomFit} title="Zoom to fit the show (\)" aria-label="Zoom to fit"><TimelineIcon name="fit" /></button>
    </div>
  {/if}

  {#if showDocTools}
    <div class="cl sep">{@render showDocTools()}</div>
  {/if}

  <span class="grow"></span>

  {#if $audioTracks.length > 0 || $rehearsalAudioDelayActive > 0}
    <div class="cl" data-help="The show's audio output: level, sound card and mute. It turns coral and says why when the show is silent." data-toolbar-output>
      <ShowAudioDelayBadge />
      {#if $audioTracks.length > 0}<OutputButton hasAudio={$audioTracks.length > 0} />{/if}
    </div>
  {/if}

  {#if isTimeline}
    <div class="cl sep" data-help="Show control: Record what you change onto the Timeline, GO (the step on standby) and the Perform tab (cues, pads, takeover)." data-toolbar-show>
      <LineRecordControls />
      {#if goShown}
        <button class="go-mini" onclick={go} title={goTitle} data-midi-path="show:go" data-section-go data-toolbar-go>GO{#if goWord}<span class="go-sb hide2">{goWord}</span>{/if}</button>
      {/if}
      <button
        class="b box"
        class:sel={$performShown}
        onclick={() => sideColumn.send({ kind: 'toggle', tab: 'perform' })}
        title="Perform: GO, the cue list, pads and taking rows over live"
        aria-pressed={$performShown}
        data-perform-toggle
      >
        <TimelineIcon name="pads" /><span class="lbl hide2">Perform</span>
        {#if takeover.count > 0}<span class="pill-on" data-takeover-pill title="Rows taken over live; the show runs on underneath">Taken over · {takeover.count}</span>{/if}
      </button>
    </div>
  {/if}

  <div class="cl sep win">
    {#if isTimeline}
      <button class="b icon" class:sel={$roomToWork} onclick={toggleRoomToWork} title={$roomToWork ? 'Back to the docked Timeline (`)' : 'Room to work: the Timeline over the whole window (`)'} aria-label="Room to work" aria-pressed={$roomToWork} data-room-to-work>
        <TimelineIcon name={$roomToWork ? 'collapse' : 'expand'} />
      </button>
    {/if}
    <button class="b icon" bind:this={helpAnchor} onclick={() => toggleMenu('help')} title="Help" aria-label="Timeline help" aria-expanded={menu === 'help'} data-timeline-help><TimelineIcon name="help" /></button>
    <button class="b icon" bind:this={moreAnchor} onclick={() => toggleMenu('more')} title="More" aria-label="More" aria-expanded={menu === 'more'} data-timeline-more><TimelineIcon name="more" /></button>
    <button class="b icon" onclick={() => showTimeline.setOpen(false)} title={isTimeline ? 'Close the Timeline' : 'Close the show timeline'} aria-label="Close" data-timeline-close><TimelineIcon name="close" /></button>
  </div>
</div>

{#if menu === 'loop'}
  <TlPopover anchor={loopAnchor} onclose={() => (menu = null)} label="At the end of the show">
    <div class="tl-mi-head">At the end</div>
    {#each END_ACTIONS as a (a.value)}
      <button class="tl-mi" class:on={$endAction === a.value} role="menuitemradio" aria-checked={$endAction === a.value}
        onclick={() => { showTimeline.setEndAction(a.value); if (get(showTimeline).loop) showTimeline.setLoop(false); menu = null; }}
        data-show-end={a.value}>
        {#if $endAction === a.value && !$loop}<TimelineIcon name="check" size={14} />{:else}<span class="mi-gap"></span>{/if}{a.label}
      </button>
    {/each}
    <div class="tl-mi-sep"></div>
    <button class="tl-mi" class:on={$loop} onclick={() => { showTimeline.setLoop(!$loop); menu = null; }}>
      {#if $loop}<TimelineIcon name="check" size={14} />{:else}<span class="mi-gap"></span>{/if}Loop: play again from the start
    </button>
  </TlPopover>
{/if}

{#if menu === 'tc'}
  <TlPopover anchor={tcAnchor} onclose={() => (menu = null)} width={320} label="Timecode">
    <div class="tl-mi-head">{tcText}</div>
    {#if tc.error}<div class="tl-pop-row tc-text">{tc.error}</div>{/if}
    {#if tcNoticeText}<div class="tl-pop-row tc-text warn" data-show-link-notice>{tcNoticeText}</div>{/if}
    {#if tcMismatchText}<div class="tl-pop-row tc-text warn" data-show-tempo-mismatch>{tcMismatchText}</div>{/if}
    <div class="tl-mi-sep"></div>
    <button class="tl-mi" onclick={openTimecodeSettings}><TimelineIcon name="gear" size={14} />Timecode and Link settings</button>
  </TlPopover>
{/if}

{#if menu === 'help'}
  <TlPopover anchor={helpAnchor} onclose={() => (menu = null)} align="end" width={260} label="Timeline help">
    <button class="tl-mi" onclick={openShortcuts} data-timeline-keys><TimelineIcon name="keyboard" size={14} />Keyboard shortcuts<span class="tl-mi-key">?</span></button>
    <button class="tl-mi" onclick={startTour} data-timeline-tour><TimelineIcon name="play" size={14} />Timeline tour<span class="tl-mi-key">6 steps</span></button>
    <button class="tl-mi" class:on={$tooltipsEnabled} onclick={() => tooltipsEnabled.set(!$tooltipsEnabled)} aria-pressed={$tooltipsEnabled}>
      <TimelineIcon name="help" size={14} />Hover help for each area<span class="tl-mi-key">F1</span>
    </button>
    <div class="tl-mi-sep"></div>
    <button class="tl-mi" onclick={() => { menu = null; void openExternalUrl(TIMELINE_HELP_URL); }}><TimelineIcon name="out" size={14} />Guide on ghostarcade.live</button>
  </TlPopover>
{/if}

{#if menu === 'more'}
  <TlPopover anchor={moreAnchor} onclose={() => (menu = null)} align="end" width={250} label="More">
    <button class="tl-mi" onclick={() => { menu = null; openTimecodeSettings(); }}><TimelineIcon name="gear" size={14} />Timecode and Link settings</button>
    <button class="tl-mi" onclick={() => { menu = null; showTimeline.openDoc(isTimeline ? 'show' : 'timeline'); }} data-open-other-doc>
      <TimelineIcon name="out" size={14} />{isTimeline ? 'Open the Show' : 'Open the Timeline'}
    </button>
    <div class="tl-mi-sep"></div>
    <button class="tl-mi danger" onclick={() => { menu = null; onclear(); }} data-timeline-clear><TimelineIcon name="trash" size={14} />{isTimeline ? 'Clear the Timeline…' : 'Clear the show…'}</button>
  </TlPopover>
{/if}

<style>
  .tlbar {
    position: relative;
    flex: 0 0 auto;
    height: var(--tl-toolbar-h, 40px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    align-content: flex-start;
    column-gap: 12px;
    padding: 0 10px 0 12px;
    box-sizing: border-box;
    overflow: hidden;
    background: var(--ga-bar, #100f0d);
    border-bottom: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    white-space: nowrap;
  }
  .cl { display: flex; align-items: center; gap: 4px; height: var(--tl-toolbar-h, 40px); flex: 0 0 auto; }
  .cl.sep { padding-left: 12px; border-left: 1px solid var(--ga-line, rgba(245, 236, 222, 0.07)); height: 24px; }
  .grow { flex: 1 1 0; min-width: 0; height: 1px; }
  .title { font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); color: var(--ga-ink-0, #f2ede4); margin-right: 8px; }
  .fit1 .title { display: none; }

  .b {
    height: var(--ga-control-h, 26px);
    min-width: 26px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid transparent;
    border-radius: var(--ga-r-hard, 5px);
    background: transparent;
    color: var(--ga-ink-0, #f2ede4);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    white-space: nowrap;
    cursor: pointer;
  }
  .b :global(.tl-icon) { color: var(--ga-icon, #5278ff); }
  .b:hover:not(:disabled) { background: var(--ga-raise, #26221c); }
  .b:disabled { opacity: 0.4; cursor: default; }
  .b.icon { padding: 0; width: 26px; }
  .b.box { background: var(--ga-card, #16140f); border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13)); }
  .b.sel { background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); color: var(--ga-selection-ink, #e0e8ff); }
  .b.sel :global(.tl-icon) { color: var(--ga-selection-ink, #e0e8ff); }
  .b.play { width: 30px; height: 30px; padding: 0; border-radius: 50%; background: var(--ga-ink-0, #f2ede4); margin: 0 2px; }
  .b.play :global(.tl-icon) { color: var(--ga-void, #0a0908); }
  .b.play:hover:not(:disabled) { background: #fff; }
  .b.play.playing { background: var(--tl-on, #ff725f); }
  .b.caret { padding: 0 4px; min-width: 18px; }
  .b.caret :global(.tl-icon) { color: var(--ga-ink-2, #89857e); }
  .split { display: inline-flex; align-items: center; border-radius: var(--ga-r-hard, 5px); }
  .split .b:first-child { padding-right: 4px; }
  .split .lbl { color: var(--ga-ink-1, #ada9a2); font-weight: 500; }
  .split.on { background: var(--tl-on-soft, rgba(255, 114, 95, 0.13)); box-shadow: inset 0 0 0 1px var(--tl-on-line, rgba(255, 114, 95, 0.46)); }
  .split.on .b :global(.tl-icon), .split.on .lbl { color: var(--tl-on, #ff725f); }

  .readout {
    height: 30px;
    padding: 0 10px;
    margin-left: 4px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line, rgba(245, 236, 222, 0.07));
    border-radius: var(--ga-r-hard, 5px);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-variant-numeric: tabular-nums;
  }
  .readout .t { font-size: 15px; font-weight: 500; color: var(--ga-ink-0, #f2ede4); letter-spacing: 0.01em; min-width: 52px; }
  .readout .tot { font-size: 11px; color: var(--ga-ink-2, #89857e); }
  .readout .bars { font-size: 11px; color: var(--ga-ink-1, #ada9a2); padding-left: 8px; border-left: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); min-width: 44px; }
  .chip .num { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-variant-numeric: tabular-nums; }
  .tc { position: relative; }
  .tc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ga-ink-2, #89857e); }
  .tc.locked .tc-dot { background: var(--ga-green, #46d18a); }
  .warn-dot { position: absolute; top: 3px; right: 3px; width: 6px; height: 6px; border-radius: 50%; background: var(--tl-on, #ff725f); }
  :global(.tl-pop) .tc-text { white-space: normal; font-size: 11px; color: var(--ga-ink-1, #ada9a2); line-height: 1.4; }
  :global(.tl-pop) .tc-text.warn { color: var(--tl-on-ink, #ffd9d2); }

  .seg {
    display: inline-flex;
    height: var(--ga-control-h, 26px);
    padding: 2px;
    gap: 2px;
    box-sizing: border-box;
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
  }
  .seg > button {
    min-width: 22px;
    padding: 0 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: 600;
    cursor: pointer;
  }
  .seg > button :global(.tl-icon) { color: var(--ga-ink-1, #ada9a2); }
  .seg.tools > button { padding: 0 4px; min-width: 24px; }
  .seg > button:hover:not(.on) { background: var(--ga-raise, #26221c); }
  .seg > button.on { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); box-shadow: inset 0 0 0 1px var(--ga-selection-line, #5278ff); }
  .seg > button.on :global(.tl-icon) { color: var(--ga-selection-ink, #e0e8ff); }
  .small-tools { display: none; }
  .fit3 .full-tools { display: none; }
  .fit3 .small-tools { display: inline-block; }
  select.grid-sel, select.sel-tool {
    height: var(--ga-control-h, 26px);
    padding: 0 6px;
    background: var(--ga-card, #16140f);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-0, #f2ede4);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: 600;
    cursor: pointer;
  }
  .fit2 .hide2, .fit1 .hide1 { display: none; }

  .go-mini {
    height: var(--ga-control-h, 26px);
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-accent-gradient, linear-gradient(135deg, #f6fafd 0%, #cfdde9 42%, #92aabf 100%));
    color: #0b1020;
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: 800;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .go-mini:hover { filter: brightness(1.06); }
  .go-sb { font-weight: 600; letter-spacing: 0; color: #2a3546; font-size: 11px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
  .pill-on {
    height: 18px;
    padding: 0 6px;
    border-radius: 9px;
    display: inline-flex;
    align-items: center;
    background: var(--tl-on, #ff725f);
    color: #1a0a06;
    font-size: 10px;
    font-weight: 750;
  }
  .mi-gap { width: 14px; flex: 0 0 auto; }
</style>
