<script lang="ts">
  import { onMount } from 'svelte';
  import VJClipGrid from './VJClipGrid.svelte';
  import VJMixerStrip from './VJMixerStrip.svelte';
  import VJMasterSection from './VJMasterSection.svelte';
  import VJBlockSelector from './VJBlockSelector.svelte';
  import VJColumnTriggers from './VJColumnTriggers.svelte';
  import VJEffectsPanel from './VJEffectsPanel.svelte';
  import VJShaderPanel from './VJShaderPanel.svelte';
  import MobileCrossfaderStrip from './MobileCrossfaderStrip.svelte';
  import MobileMacroBank from './MobileMacroBank.svelte';
  import MobileSnapshotBank from './MobileSnapshotBank.svelte';
  import MobileTempoStrip from './MobileTempoStrip.svelte';
  import MobileBankToggle from './MobileBankToggle.svelte';
  import type { EffectType, EffectParams, Effect } from '../../types';

  // VJ state from desktop sync
  export let vjClipsState: any = null;

  // ── Existing callbacks (Bank A only — kept for backward compat) ──
  export let onTriggerClip: (layerIndex: number, columnIndex: number) => void = () => {};
  export let onTriggerColumn: (columnIndex: number) => void = () => {};
  export let onStopLayer: (layerIndex: number) => void = () => {};
  export let onStopAll: () => void = () => {};
  export let onSetBlock: (blockId: string) => void = () => {};
  export let onToggleLive: () => void = () => {};
  export let onSetLayerOpacity: (layerIndex: number, opacity: number) => void = () => {};
  export let onSetLayerBlendMode: (layerIndex: number, blendMode: string) => void = () => {};
  export let onSetMasterOpacity: (opacity: number) => void = () => {};

  // ── New per-bank callbacks (added v0.3.x for dual-deck support) ──
  // The MobileApp wraps each of these to set the `bank` field on the WS
  // payload before sending. Falls back to the Bank A callbacks above when
  // these aren't supplied so the controller stays usable on older builds.
  export let onTriggerClipBank: ((layerIndex: number, columnIndex: number, bank: 'A' | 'B') => void) | null = null;
  export let onTriggerColumnBank: ((columnIndex: number, bank: 'A' | 'B') => void) | null = null;
  export let onStopLayerBank: ((layerIndex: number, bank: 'A' | 'B') => void) | null = null;
  export let onSetLayerOpacityBank: ((layerIndex: number, opacity: number, bank: 'A' | 'B') => void) | null = null;
  export let onSetLayerBlendModeBank: ((layerIndex: number, blendMode: string, bank: 'A' | 'B') => void) | null = null;

  // Layer effect callbacks
  export let onAddLayerEffect: (layerIndex: number, effectType: EffectType) => void = () => {};
  export let onRemoveLayerEffect: (layerIndex: number, effectId: string) => void = () => {};
  export let onToggleLayerEffect: (layerIndex: number, effectId: string) => void = () => {};
  export let onUpdateLayerEffectParams: (layerIndex: number, effectId: string, params: Partial<EffectParams>) => void = () => {};

  // Composition effect callbacks
  export let onAddCompEffect: (effectType: EffectType) => void = () => {};
  export let onRemoveCompEffect: (effectId: string) => void = () => {};
  export let onToggleCompEffect: (effectId: string) => void = () => {};
  export let onUpdateCompEffectParams: (effectId: string, params: Partial<EffectParams>) => void = () => {};

  // Clip effect callbacks
  export let onAddClipEffect: (layerIndex: number, columnIndex: number, effectType: EffectType) => void = () => {};
  export let onRemoveClipEffect: (layerIndex: number, columnIndex: number, effectId: string) => void = () => {};
  export let onToggleClipEffect: (layerIndex: number, columnIndex: number, effectId: string) => void = () => {};
  export let onUpdateClipEffectParams: (layerIndex: number, columnIndex: number, effectId: string, params: Partial<EffectParams>) => void = () => {};

  // Shader callback
  export let onUpdateShaderValue: (layerIndex: number, paramName: string, value: any) => void = () => {};

  // Composition effects synced from desktop
  export let compositionEffects: Effect[] = [];

  // ── Performer-surface callbacks (added v0.3.x) ──
  export let onCrossfaderChange: (value: number) => void = () => {};
  export let onCrossfaderToggle: (enabled: boolean) => void = () => {};
  export let onCrossfaderTransition: (transition: string) => void = () => {};
  export let onCrossfaderCurve: (curve: string) => void = () => {};
  /** Output blend mode for the dual-deck composite. New in v2.2 — the
   *  X-fader's secondary dropdown was previously a fader-curve picker
   *  (linear / equal-power / sharp). Operator found that confusing;
   *  it's now a layer blend-mode picker. */
  export let onCrossfaderBlendMode: (blendMode: string) => void = () => {};
  export let onCutA: () => void = () => {};
  export let onCutB: () => void = () => {};
  export let onMacroValueChange: (macroId: string, value: number) => void = () => {};
  export let onSnapshotRecall: (idx: number) => void = () => {};
  export let onSnapshotSave: (idx: number) => void = () => {};
  export let onTapTempo: () => void = () => {};
  export let onClearManualBPM: () => void = () => {};
  export let onQuantizationChange: (grid: string) => void = () => {};
  export let onClearPendingTriggers: () => void = () => {};
  // Beat pulse from desktop's `beat_pulse` channel — bypasses the
  // throttled vj_clips_sync so the TAP button can flash in tempo.
  export let beatPulseCount: number = 0;
  export let beatPulseIntensity: number = 0;

  let isTablet = false;
  let isLandscape = false;
  let controllerEl: HTMLDivElement;

  // Show max 6 layers in mixer, scroll for more
  const MAX_VISIBLE_LAYERS = 6;

  // Active deck when crossfader is OFF (single-deck view). When the
  // crossfader is ON, both decks are visible side by side and this
  // mirrors `vjClipsState.selectedDeck` from the desktop.
  let activeBank: 'A' | 'B' = 'A';

  // Performer drawer toggles. Macros / snapshots live in a collapsible
  // drawer to keep the main launcher uncluttered.
  let perfDrawerOpen = false;
  // Which bottom panel tab is active on phones (where we can't show all
  // panels at once).
  let phoneTab: 'mixer' | 'macros' | 'snaps' | 'effects' | 'shader' = 'mixer';
  // Tablet center tabs — between the deck opacity faders the user
  // toggles between Shader Params and Effects for the selected deck/clip.
  let centerTab: 'shader' | 'effects' = 'shader';

  function checkDevice() {
    isTablet = window.innerWidth >= 768;
    isLandscape = window.innerWidth > window.innerHeight;
  }

  onMount(() => {
    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => {
      window.removeEventListener('resize', checkDevice);
    };
  });

  // Sync local activeBank with desktop selectedDeck only on the RISING
  // edge of crossfaderEnabled. After that, the user's local bank toggle
  // is in charge — without this guard, every WS sync overwrote local
  // selection. Tracking with a `wasOn` flag makes it idempotent.
  let wasCrossfaderOn = false;
  $: {
    const isOn = !!vjClipsState?.crossfaderEnabled;
    if (isOn && !wasCrossfaderOn && vjClipsState?.selectedDeck) {
      activeBank = vjClipsState.selectedDeck;
    }
    wasCrossfaderOn = isOn;
  }

  // Derived data — bank-aware
  $: blocks = vjClipsState?.blocks || [];
  $: activeBlockId = vjClipsState?.activeBlockId || '';
  $: activeBlock = blocks.find((b: any) => b.id === activeBlockId) || null;
  $: clipGridA = activeBlock?.clipGrid || [];
  $: clipGridB = activeBlock?.bankBClipGrid || [];
  $: layerStatesA = vjClipsState?.layerStates || [];
  $: layerStatesB = vjClipsState?.bankBLayerStates || [];
  $: numColumns = clipGridA[0]?.length || clipGridB[0]?.length || 8;
  $: isLive = vjClipsState?.isLive || false;
  $: masterOpacity = vjClipsState?.masterOpacity ?? 1;
  $: crossfaderOn = !!vjClipsState?.crossfaderEnabled;
  $: crossfaderValue = vjClipsState?.crossfaderValue ?? 0;
  $: crossfaderTransition = vjClipsState?.crossfaderTransition ?? 'dissolve';
  $: crossfaderCurve = vjClipsState?.crossfaderCurve ?? 'equal-power';
  $: crossfaderBlendMode = vjClipsState?.crossfaderBlendMode ?? 'normal';

  // ── Single-deck-view shortcuts (used when crossfader is OFF or for the
  // shader/effects panels which only show the active deck's state).
  // Bank B falls back to Bank A if Bank B is empty (older desktop builds
  // without dual-deck support send empty `bankB*` arrays). Without the
  // fallback, switching to Bank B on an older desktop showed a blank
  // grid with no recourse since the user's BankToggle still said 'B'.
  $: bankBHasContent = clipGridB.length > 0 && layerStatesB.length > 0;
  $: effectiveBank = (activeBank === 'B' && bankBHasContent) ? 'B' : 'A';
  $: activeGrid = effectiveBank === 'A' ? clipGridA : clipGridB;
  $: activeStates = effectiveBank === 'A' ? layerStatesA : layerStatesB;

  // ── Effective callbacks: prefer per-bank if provided, else fall back ──
  function triggerClip(layerIndex: number, columnIndex: number, bank: 'A' | 'B') {
    if (onTriggerClipBank) onTriggerClipBank(layerIndex, columnIndex, bank);
    else if (bank === 'A') onTriggerClip(layerIndex, columnIndex);
  }
  function triggerColumn(columnIndex: number, bank: 'A' | 'B') {
    if (onTriggerColumnBank) onTriggerColumnBank(columnIndex, bank);
    else if (bank === 'A') onTriggerColumn(columnIndex);
  }
  function stopLayer(layerIndex: number, bank: 'A' | 'B') {
    if (onStopLayerBank) onStopLayerBank(layerIndex, bank);
    else if (bank === 'A') onStopLayer(layerIndex);
  }
  function setLayerOpacity(layerIndex: number, opacity: number, bank: 'A' | 'B') {
    if (onSetLayerOpacityBank) onSetLayerOpacityBank(layerIndex, opacity, bank);
    else if (bank === 'A') onSetLayerOpacity(layerIndex, opacity);
  }
  function setLayerBlendMode(layerIndex: number, blendMode: string, bank: 'A' | 'B') {
    if (onSetLayerBlendModeBank) onSetLayerBlendModeBank(layerIndex, blendMode, bank);
    else if (bank === 'A') onSetLayerBlendMode(layerIndex, blendMode);
  }
</script>

{#if !vjClipsState}
  <div class="vj-empty">
    <div class="empty-icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
    </div>
    <p class="empty-title">No VJ Session Active</p>
    <p class="empty-hint">Open the VJ panel on the desktop to start</p>
  </div>
{:else if isTablet}
  <!-- ═══════════════════════════════════════════════════════════════ -->
  <!--  TABLET / iPad LAYOUT (v2 — performer-organized)                 -->
  <!--                                                                  -->
  <!--  ROW 1  Snapshots (single dense row, all 16 always visible)      -->
  <!--  ROW 2  Header strip (block selector + bank toggle)              -->
  <!--  ROW 3  Main work area (clips + xfader on top, opacity + tabs    -->
  <!--         on bottom)                                                -->
  <!--  ROW 4  Bottom controls (macros + tempo/quant + master)           -->
  <!--                                                                  -->
  <!--  Design rules:                                                   -->
  <!--    - Snaps stay at the top so scene recall is always one tap     -->
  <!--      from anywhere on the surface.                               -->
  <!--    - Clip grids flank the X-fader so the operator can trigger    -->
  <!--      from either deck without moving their hands far.            -->
  <!--    - Per-deck opacity faders sit DIRECTLY UNDER their deck so    -->
  <!--      the wiring is visually obvious — fader L1 is layer 1 of     -->
  <!--      the deck above it.                                          -->
  <!--    - Shader/effects tabs in the middle are the only "drilled-in" -->
  <!--      controls; everything else is one-tap from rest position.    -->
  <!--    - Bottom row groups all build / energy / safety controls      -->
  <!--      (macros, tempo, master, STOP) on one easy-to-reach line.    -->
  <!-- ═══════════════════════════════════════════════════════════════ -->
  <div class="vj-controller tablet" class:landscape={isLandscape} class:portrait={!isLandscape} bind:this={controllerEl}>

    <!-- ROW 1: Snapshots (single dense row across the top) -->
    {#if vjClipsState.snapshots && vjClipsState.snapshots.length > 0}
      <div class="snaps-top-row">
        <MobileSnapshotBank
          snapshots={vjClipsState.snapshots}
          activeId={vjClipsState.activeSnapshotId ?? null}
          onRecall={onSnapshotRecall}
          onSave={onSnapshotSave}
          topRow={true}
        />
      </div>
    {/if}

    <!-- ROW 2: Header strip (block + bank toggle) -->
    {#if blocks.length > 1 || !crossfaderOn}
      <div class="header-strip">
        {#if blocks.length > 1}
          <div class="header-slot block">
            <VJBlockSelector {blocks} {activeBlockId} {onSetBlock} />
          </div>
        {/if}
        {#if !crossfaderOn}
          <div class="header-slot bank">
            <MobileBankToggle activeBank={activeBank} onChange={(b) => activeBank = b} />
          </div>
        {/if}
      </div>
    {/if}

    <!-- ROW 3: Main work area -->
    <div class="main-work-area" class:dual={crossfaderOn}>
      {#if crossfaderOn}
        <!-- ─── Top sub-row: Deck A clips | X-fader | Deck B clips ─── -->
        <div class="deck-clips-row">
          <div class="deck-clips a">
            <div class="deck-tag a">DECK A</div>
            <div class="deck-grid-wrap">
              <VJClipGrid
                clipGrid={clipGridA}
                layerStates={layerStatesA}
                {numColumns}
                isTablet={true}
                onTriggerClip={(li, ci) => triggerClip(li, ci, 'A')}
                onStopLayer={(li) => stopLayer(li, 'A')}
              />
              <VJColumnTriggers {numColumns} isTablet={true} onTriggerColumn={(ci) => triggerColumn(ci, 'A')} />
            </div>
          </div>

          <div class="xfader-stack">
            <MobileCrossfaderStrip
              enabled={crossfaderOn}
              value={crossfaderValue}
              transition={crossfaderTransition}
              curve={crossfaderCurve}
              blendMode={crossfaderBlendMode}
              selectedDeck={vjClipsState.selectedDeck ?? 'A'}
              orientation="vertical"
              compact={true}
              onChange={onCrossfaderChange}
              onToggleEnabled={onCrossfaderToggle}
              onCutA={onCutA}
              onCutB={onCutB}
              onTransitionChange={onCrossfaderTransition}
              onCurveChange={onCrossfaderCurve}
              onBlendModeChange={onCrossfaderBlendMode}
            />
          </div>

          <div class="deck-clips b">
            <div class="deck-tag b">DECK B</div>
            <div class="deck-grid-wrap">
              <VJClipGrid
                clipGrid={clipGridB}
                layerStates={layerStatesB}
                {numColumns}
                isTablet={true}
                onTriggerClip={(li, ci) => triggerClip(li, ci, 'B')}
                onStopLayer={(li) => stopLayer(li, 'B')}
              />
              <VJColumnTriggers {numColumns} isTablet={true} onTriggerColumn={(ci) => triggerColumn(ci, 'B')} />
            </div>
          </div>
        </div>

        <!-- ─── Bottom sub-row: A opacity | shader/fx tabs | B opacity ─── -->
        <div class="deck-controls-row">
          <div class="deck-mixer-strip a">
            {#each layerStatesA.slice(0, MAX_VISIBLE_LAYERS) as layerState, layerIndex}
              <VJMixerStrip
                {layerIndex}
                {layerState}
                isTablet={true}
                compact={true}
                faderHeight={112}
                onOpacityChange={(li, o) => setLayerOpacity(li, o, 'A')}
                onBlendModeChange={(li, b) => setLayerBlendMode(li, b, 'A')}
                onStopLayer={(li) => stopLayer(li, 'A')}
              />
            {/each}
          </div>

          <div class="center-tabs">
            <div class="center-tabs-bar">
              <button class="ctab" class:active={centerTab === 'shader'}  onclick={() => centerTab = 'shader'}>SHADER</button>
              <button class="ctab" class:active={centerTab === 'effects'} onclick={() => centerTab = 'effects'}>EFFECTS</button>
            </div>
            <div class="center-tabs-content">
              {#if centerTab === 'shader'}
                <VJShaderPanel
                  layerStates={layerStatesA}
                  {onUpdateShaderValue}
                />
              {:else}
                <VJEffectsPanel
                  layerStates={layerStatesA}
                  {compositionEffects}
                  clipGrid={clipGridA}
                  {onAddLayerEffect}
                  {onRemoveLayerEffect}
                  {onToggleLayerEffect}
                  {onUpdateLayerEffectParams}
                  {onAddCompEffect}
                  {onRemoveCompEffect}
                  {onToggleCompEffect}
                  {onUpdateCompEffectParams}
                  {onAddClipEffect}
                  {onRemoveClipEffect}
                  {onToggleClipEffect}
                  {onUpdateClipEffectParams}
                />
              {/if}
            </div>
          </div>

          <div class="deck-mixer-strip b">
            {#each layerStatesB.slice(0, MAX_VISIBLE_LAYERS) as layerState, layerIndex}
              <VJMixerStrip
                {layerIndex}
                {layerState}
                isTablet={true}
                compact={true}
                faderHeight={112}
                onOpacityChange={(li, o) => setLayerOpacity(li, o, 'B')}
                onBlendModeChange={(li, b) => setLayerBlendMode(li, b, 'B')}
                onStopLayer={(li) => stopLayer(li, 'B')}
              />
            {/each}
          </div>
        </div>
      {:else}
        <!-- ─── Single-deck (xfader off): full clip grid + opacity-row + tabs ─── -->
        <div class="single-deck-clips">
          <VJClipGrid
            clipGrid={activeGrid}
            layerStates={activeStates}
            {numColumns}
            isTablet={true}
            onTriggerClip={(li, ci) => triggerClip(li, ci, activeBank)}
            onStopLayer={(li) => stopLayer(li, activeBank)}
          />
          <VJColumnTriggers {numColumns} isTablet={true} onTriggerColumn={(ci) => triggerColumn(ci, activeBank)} />
        </div>
        <div class="single-controls-row">
          <div class="deck-mixer-strip">
            {#each activeStates.slice(0, MAX_VISIBLE_LAYERS) as layerState, layerIndex}
              <VJMixerStrip
                {layerIndex}
                {layerState}
                isTablet={true}
                compact={true}
                faderHeight={128}
                onOpacityChange={(li, o) => setLayerOpacity(li, o, activeBank)}
                onBlendModeChange={(li, b) => setLayerBlendMode(li, b, activeBank)}
                onStopLayer={(li) => stopLayer(li, activeBank)}
              />
            {/each}
          </div>
          <div class="center-tabs single">
            <div class="center-tabs-bar">
              <button class="ctab" class:active={centerTab === 'shader'}  onclick={() => centerTab = 'shader'}>SHADER</button>
              <button class="ctab" class:active={centerTab === 'effects'} onclick={() => centerTab = 'effects'}>EFFECTS</button>
            </div>
            <div class="center-tabs-content">
              {#if centerTab === 'shader'}
                <VJShaderPanel
                  layerStates={activeStates}
                  {onUpdateShaderValue}
                />
              {:else}
                <VJEffectsPanel
                  layerStates={activeStates}
                  {compositionEffects}
                  clipGrid={activeGrid}
                  {onAddLayerEffect}
                  {onRemoveLayerEffect}
                  {onToggleLayerEffect}
                  {onUpdateLayerEffectParams}
                  {onAddCompEffect}
                  {onRemoveCompEffect}
                  {onToggleCompEffect}
                  {onUpdateCompEffectParams}
                  {onAddClipEffect}
                  {onRemoveClipEffect}
                  {onToggleClipEffect}
                  {onUpdateClipEffectParams}
                />
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- ROW 4: Bottom controls.
         LANDSCAPE: macros + tempo + master on a single horizontal row.
         PORTRAIT: macros take a dedicated full-width row on top, then
         tempo + master split 50/50 on a second row underneath. The
         portrait split is forced via .vj-controller.tablet.portrait
         CSS so each block has thumb-friendly horizontal real estate
         on the narrower 1024px iPad-portrait viewport. -->
    <div class="bottom-controls-row">
      {#if vjClipsState.macros && vjClipsState.macros.length > 0}
        <div class="bc-slot macros">
          <MobileMacroBank
            macros={vjClipsState.macros}
            onValueChange={onMacroValueChange}
            compact={true}
          />
        </div>
      {/if}
      <div class="bc-portrait-pair">
        <div class="bc-slot tempo">
          <MobileTempoStrip
            bpm={vjClipsState.bpm}
            manualBPM={vjClipsState.manualBPM}
            {beatPulseCount}
            {beatPulseIntensity}
            quantization={vjClipsState.quantization}
            pendingTriggerCount={vjClipsState.pendingTriggerCount ?? 0}
            onTap={onTapTempo}
            onClearManualBPM={onClearManualBPM}
            onQuantizationChange={onQuantizationChange}
            onClearPending={onClearPendingTriggers}
            compact={true}
          />
        </div>
        <div class="bc-slot master">
          <VJMasterSection
            {masterOpacity}
            {isLive}
            onMasterOpacityChange={onSetMasterOpacity}
            {onToggleLive}
            {onStopAll}
            compact={true}
          />
        </div>
      </div>
    </div>
  </div>

{:else}
  <!-- ═══════════════════════════════════════════════════════════════ -->
  <!--  PHONE LAYOUT                                                    -->
  <!--  Top: tempo + bank toggle (compact)                             -->
  <!--  Middle: clip grid for active deck (single-deck only on phone)  -->
  <!--  Tab strip: Mixer / Macros / Snaps / FX / Shader                -->
  <!--  Bottom: master section                                          -->
  <!--  Crossfader gets a slim horizontal strip when enabled           -->
  <!-- ═══════════════════════════════════════════════════════════════ -->
  <div class="vj-controller phone" class:landscape={isLandscape} bind:this={controllerEl}>
    <!-- Top: tempo strip (always visible — primary surface) -->
    <div class="phone-top-strip">
      <MobileTempoStrip
        bpm={vjClipsState.bpm}
        manualBPM={vjClipsState.manualBPM}
        {beatPulseCount}
        {beatPulseIntensity}
        quantization={vjClipsState.quantization}
        pendingTriggerCount={vjClipsState.pendingTriggerCount ?? 0}
        onTap={onTapTempo}
        onClearManualBPM={onClearManualBPM}
        onQuantizationChange={onQuantizationChange}
        onClearPending={onClearPendingTriggers}
        compact={true}
      />
    </div>

    <!-- Bank toggle + block selector row -->
    <div class="phone-control-row">
      {#if blocks.length > 1}
        <VJBlockSelector {blocks} {activeBlockId} {onSetBlock} />
      {/if}
      <MobileBankToggle activeBank={activeBank} onChange={(b) => activeBank = b} compact={true} />
    </div>

    <!-- Crossfader strip (horizontal, only when enabled) -->
    {#if crossfaderOn}
      <div class="phone-xfader-strip">
        <MobileCrossfaderStrip
          enabled={crossfaderOn}
          value={crossfaderValue}
          transition={crossfaderTransition}
          curve={crossfaderCurve}
          selectedDeck={vjClipsState.selectedDeck ?? 'A'}
          orientation="horizontal"
          onChange={onCrossfaderChange}
          onToggleEnabled={onCrossfaderToggle}
          onCutA={onCutA}
          onCutB={onCutB}
          onTransitionChange={onCrossfaderTransition}
          onCurveChange={onCrossfaderCurve}
        />
      </div>
    {/if}

    {#if isLandscape}
      <!-- LANDSCAPE: Side-by-side layout for clip grid + active tab panel -->
      <div class="landscape-layout">
        <div class="landscape-grid-side">
          <VJClipGrid
            clipGrid={activeGrid}
            layerStates={activeStates}
            {numColumns}
            isTablet={false}
            onTriggerClip={(li, ci) => triggerClip(li, ci, activeBank)}
            onStopLayer={(li) => stopLayer(li, activeBank)}
          />
          <VJColumnTriggers {numColumns} onTriggerColumn={(ci) => triggerColumn(ci, activeBank)} />
        </div>
        <div class="landscape-mixer-side">
          {#each activeStates as layerState, layerIndex}
            <VJMixerStrip
              {layerIndex}
              {layerState}
              isTablet={true}
              onOpacityChange={(li, o) => setLayerOpacity(li, o, activeBank)}
              onBlendModeChange={(li, b) => setLayerBlendMode(li, b, activeBank)}
              onStopLayer={(li) => stopLayer(li, activeBank)}
            />
          {/each}
        </div>
      </div>
    {:else}
      <!-- PORTRAIT: Clip grid + tab strip -->
      <div class="vj-section grid-section">
        <VJClipGrid
          clipGrid={activeGrid}
          layerStates={activeStates}
          {numColumns}
          isTablet={false}
          onTriggerClip={(li, ci) => triggerClip(li, ci, activeBank)}
          onStopLayer={(li) => stopLayer(li, activeBank)}
        />
        <VJColumnTriggers {numColumns} onTriggerColumn={(ci) => triggerColumn(ci, activeBank)} />
      </div>

      <!-- Phone tab strip — switches the bottom panel content -->
      <div class="phone-tab-strip">
        <button class="tab-btn" class:active={phoneTab === 'mixer'} onclick={() => phoneTab = 'mixer'}>MIX</button>
        {#if vjClipsState.macros && vjClipsState.macros.length > 0}
          <button class="tab-btn" class:active={phoneTab === 'macros'} onclick={() => phoneTab = 'macros'}>MAC</button>
        {/if}
        {#if vjClipsState.snapshots && vjClipsState.snapshots.length > 0}
          <button class="tab-btn" class:active={phoneTab === 'snaps'} onclick={() => phoneTab = 'snaps'}>SNAP</button>
        {/if}
        <button class="tab-btn" class:active={phoneTab === 'shader'} onclick={() => phoneTab = 'shader'}>SHD</button>
        <button class="tab-btn" class:active={phoneTab === 'effects'} onclick={() => phoneTab = 'effects'}>FX</button>
      </div>

      <!-- Phone tab content -->
      <div class="phone-tab-content">
        {#if phoneTab === 'mixer'}
          <div class="phone-mixer">
            {#each activeStates as layerState, layerIndex}
              <VJMixerStrip
                {layerIndex}
                {layerState}
                isTablet={false}
                onOpacityChange={(li, o) => setLayerOpacity(li, o, activeBank)}
                onBlendModeChange={(li, b) => setLayerBlendMode(li, b, activeBank)}
                onStopLayer={(li) => stopLayer(li, activeBank)}
              />
            {/each}
          </div>
        {:else if phoneTab === 'macros' && vjClipsState.macros}
          <MobileMacroBank
            macros={vjClipsState.macros}
            onValueChange={onMacroValueChange}
            compact={true}
          />
        {:else if phoneTab === 'snaps' && vjClipsState.snapshots}
          <MobileSnapshotBank
            snapshots={vjClipsState.snapshots}
            activeId={vjClipsState.activeSnapshotId ?? null}
            onRecall={onSnapshotRecall}
            onSave={onSnapshotSave}
            compact={true}
          />
        {:else if phoneTab === 'shader'}
          <VJShaderPanel
            layerStates={activeStates}
            {onUpdateShaderValue}
          />
        {:else if phoneTab === 'effects'}
          <VJEffectsPanel
            layerStates={activeStates}
            {compositionEffects}
            clipGrid={activeGrid}
            onAddLayerEffect={onAddLayerEffect}
            onRemoveLayerEffect={onRemoveLayerEffect}
            onToggleLayerEffect={onToggleLayerEffect}
            onUpdateLayerEffectParams={onUpdateLayerEffectParams}
            {onAddCompEffect}
            {onRemoveCompEffect}
            {onToggleCompEffect}
            {onUpdateCompEffectParams}
            {onAddClipEffect}
            {onRemoveClipEffect}
            {onToggleClipEffect}
            {onUpdateClipEffectParams}
          />
        {/if}
      </div>
    {/if}

    <!-- Master section (pinned to bottom) -->
    <VJMasterSection
      {masterOpacity}
      {isLive}
      onMasterOpacityChange={onSetMasterOpacity}
      {onToggleLive}
      {onStopAll}
    />
  </div>
{/if}

<style>
  /* ── Empty State ── */
  .vj-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: rgba(255, 255, 255, 0.3);
    padding: 40px;
  }
  .empty-icon { opacity: 0.3; }
  .empty-title {
    font-size: 18px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
  }
  .empty-hint { font-size: 14px; }

  /* ── Controller Container ── */
  .vj-controller {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    height: 100%;
    min-height: 0;
    background: var(--bg-primary, #0a0a0c);
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
  }

  /* ── Tablet Layout (v2.1.2) ──
     4-row stack. The bottom row is now CONTENT-SIZED (`auto`) instead
     of clamped to a fixed pixel band — earlier versions used either
     `minmax(64px, 86px)` (clipped the macros) or `clamp(96px, 12vh,
     116px)` (left a black gap under the macros + tap + master because
     the row was always taller than its tallest child). Letting the
     row size to its content means the bottom strip hugs the macros'
     natural ~88px height with no leftover space + no clipping. The
     1fr row above absorbs the rest of the viewport. */
  .vj-controller.tablet {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    height: 100%;
    min-height: 0;
    max-height: 100%;
    overflow: hidden;
  }

  /* ROW 1 — snaps */
  .snaps-top-row {
    flex-shrink: 0;
    background: rgba(0, 0, 0, 0.4);
  }

  /* ROW 2 — header strip */
  .header-strip {
    display: flex;
    gap: 8px;
    padding: 4px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.01);
    flex-shrink: 0;
    align-items: stretch;
    flex-wrap: wrap;
    min-height: 36px;
  }
  .header-slot { display: flex; align-items: center; flex-shrink: 0; }
  .header-slot.bank { margin-left: auto; }

  /* ROW 3 — main work area (clips on top, opacity+tabs below).
     Bumped the controls sub-row from minmax(180px, 220px) → minmax(
     220px, 280px). The non-compact VJMixerStrip is ~260px tall (label
     + solo/mute + 180px fader + value + blend dropdown + stop) and
     the 220px cap was clipping the bottom of the strip behind the
     macros bar. The 280px upper bound still leaves ~75% of the main
     area for the clip grids on a 12.9" iPad in landscape. */
  .main-work-area {
    --clip-label-width: 44px;
    --clip-cell-min-height: clamp(38px, 5.4vh, 48px);
    --column-trigger-height: 30px;
    display: grid;
    grid-template-rows: minmax(0, 1fr) clamp(196px, 28vh, 224px);
    min-height: 0;
    overflow: hidden;
  }
  .main-work-area.dual {
    --clip-label-width: 40px;
    --clip-cell-min-height: clamp(32px, 4.8vh, 40px);
    --column-trigger-height: 28px;
  }
  .vj-controller.tablet.portrait .main-work-area.dual {
    --clip-label-width: 38px;
    --clip-cell-min-height: clamp(32px, 3.8vh, 40px);
    --column-trigger-height: 26px;
  }

  /* DUAL-DECK: top sub-row = three columns (A clips | xfader | B clips).
     min-height: 0 is required because this is a grid child of a 1fr
     row — without it Chromium defaults to min-content height and the
     clip grids overflow downward into the controls row below. */
  .deck-clips-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    min-height: 0;
    height: 100%;
    overflow: hidden;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .deck-clips {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }
  .deck-clips.a { border-right: 1px solid rgba(79, 195, 247, 0.18); }
  .deck-clips.b { border-left: 1px solid rgba(206, 147, 216, 0.18); }
  .deck-tag {
    font-size: 12px;
    font-weight: 800;
    text-align: center;
    padding: 4px 0;
    letter-spacing: 1.8px;
    flex-shrink: 0;
  }
  .deck-tag.a {
    background: rgba(79, 195, 247, 0.12);
    color: #4FC3F7;
    text-shadow: 0 0 6px rgba(79, 195, 247, 0.4);
  }
  .deck-tag.b {
    background: rgba(206, 147, 216, 0.12);
    color: #CE93D8;
    text-shadow: 0 0 6px rgba(206, 147, 216, 0.4);
  }
  .deck-grid-wrap {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    overflow-y: hidden;
    overflow-x: hidden;
    min-height: 0;
  }
  /* Crossfader column between deck A and deck B clip grids. The
     MobileCrossfaderStrip has a fixed inner height (~280px: 200px
     fader + cut buttons + transition/blend dropdowns + padding) so
     stretching its outer wrapper doesn't grow the visible control —
     instead we anchor the wrapper's content to the BOTTOM of the
     column with `justify-content: flex-end` and zero bottom padding
     so the crossfader's bottom edge lands on EXACTLY the same line
     as the column-trigger row at the bottom of the deck-clips
     columns (their outer flex containers also end at the row's
     bottom boundary). */
  .xfader-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    padding: 4px 5px 0;
    background: rgba(255, 255, 255, 0.02);
    border-left: 1px solid rgba(255, 255, 255, 0.06);
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  /* DUAL-DECK: bottom sub-row = three columns (A opacity | tabs | B opacity).
     Height is set by the parent's grid-template-rows (180-220px); we
     just fill it. */
  .deck-controls-row {
    display: grid;
    grid-template-columns: minmax(168px, 0.9fr) minmax(210px, 1.15fr) minmax(168px, 0.9fr);
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .deck-mixer-strip {
    display: flex;
    gap: 4px;
    padding: 4px 6px;
    background: rgba(255, 255, 255, 0.015);
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    flex-shrink: 0;
    align-items: center;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }
  .deck-mixer-strip.a { border-right: 1px solid rgba(79, 195, 247, 0.15); }
  .deck-mixer-strip.b { border-left: 1px solid rgba(206, 147, 216, 0.15); }

  /* SINGLE-DECK (xfader off) */
  .single-deck-clips {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .single-controls-row {
    display: grid;
    grid-template-columns: minmax(220px, 0.85fr) minmax(260px, 1.35fr);
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .single-controls-row .deck-mixer-strip {
    border-right: 1px solid rgba(255, 255, 255, 0.06);
  }

  /* CENTER TABS (shader / effects panel between the opacity strips) */
  .center-tabs {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 0;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.015);
  }
  .center-tabs-bar {
    display: flex;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }
  .ctab {
    flex: 1;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-right: 1px solid rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.45);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 1.5px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: all 0.12s;
  }
  .ctab:last-child { border-right: none; }
  .ctab:hover { color: rgba(255, 255, 255, 0.7); }
  .ctab.active {
    color: #fff;
    background: rgba(255, 255, 255, 0.05);
    box-shadow: inset 0 -2px 0 var(--accent-primary, #FF6B6B);
  }
  .center-tabs-content {
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }

  /* ROW 4 — bottom controls (macros + tempo/quant + master).
     Two layouts share this markup:

     LANDSCAPE (default): single horizontal row. Macros take 1fr,
     tempo + master are content-sized on the right. .bc-portrait-pair
     is `display: contents` so its children flatten into the parent
     flex line.

     PORTRAIT: macros get a dedicated 100%-width row on top, then
     .bc-portrait-pair becomes a 50/50 grid below. Done by flipping
     .bottom-controls-row to flex-wrap + setting macros to flex-basis
     100% so the pair drops to a second visual row.

     Both modes are content-height — the parent grid track is `auto`
     so the strip hugs its tallest child with no leftover black bar. */
  .bottom-controls-row {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
  .bc-slot {
    display: flex;
    align-items: center;
    min-width: 0;
    border-right: 1px solid rgba(255, 255, 255, 0.05);
    overflow: hidden;
  }
  .bc-slot:last-child { border-right: none; }
  .bc-slot.macros {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0 4px;
    /* Allow horizontal scroll only when the 8 knobs genuinely don't
       fit (small iPads). At 48px each + 4px gaps that's 412px, which
       comfortably fits on every iPad in landscape. */
    overflow-x: auto;
    overflow-y: hidden;
  }
  .bc-slot.tempo { flex: 0 0 auto; padding: 0 6px; }
  .bc-slot.master { flex: 0 0 auto; padding: 0 6px; }

  /* By default the portrait-pair wrapper is invisible in flex flow —
     its children behave as siblings of .bc-slot.macros so the whole
     row reads as one horizontal line. In portrait this changes (see
     below). */
  .bc-portrait-pair {
    display: contents;
    min-width: 0;
  }

  .bc-slot.tempo :global(.tempo-strip.compact),
  .bc-slot.master :global(.master-section.compact) {
    max-width: 100%;
  }

  .vj-controller.tablet.portrait .deck-controls-row {
    grid-template-columns: minmax(128px, 0.85fr) minmax(180px, 1.2fr) minmax(128px, 0.85fr);
  }
  .vj-controller.tablet.portrait .single-controls-row {
    grid-template-columns: minmax(180px, 0.8fr) minmax(220px, 1.4fr);
  }

  /* ── PORTRAIT LAYOUT OVERRIDES ──
     iPad in portrait (1024w × 1366h logical pixels). The single-row
     bottom strip squeezes macros into ~400px and pushes the master
     fader off-screen. Operator: "put the macros 100% width across.
     and put the tempo/master in 50/50 columns (portrait only)."
     Implementation: let the row wrap, force macros to take 100% of
     the line so it claims the first visual row, then make the
     portrait-pair a 50/50 grid that lands underneath. */
  .vj-controller.tablet.portrait .bottom-controls-row {
    flex-wrap: wrap;
  }
  .vj-controller.tablet.portrait .bc-slot.macros {
    flex: 1 1 100%;
    min-width: 100%;
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    justify-content: center;
  }
  .vj-controller.tablet.portrait .bc-portrait-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
    min-width: 0;
    align-items: center;
  }
  .vj-controller.tablet.portrait .bc-slot.tempo,
  .vj-controller.tablet.portrait .bc-slot.master {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
    justify-content: center;
  }
  .vj-controller.tablet.portrait .bc-slot.tempo :global(.tempo-strip.compact),
  .vj-controller.tablet.portrait .bc-slot.master :global(.master-section.compact) {
    width: 100%;
    justify-content: center;
  }
  /* Macros bank on portrait gets the full row width — let it stretch
     out so the 8 knobs space evenly with breathing room rather than
     bunching on the left. */
  .vj-controller.tablet.portrait .bc-slot.macros :global(.macro-bank) {
    width: 100%;
    justify-content: space-around;
  }
  .vj-controller.tablet.portrait .bc-slot.macros :global(.macro-bank .knobs) {
    width: 100%;
    justify-content: space-around;
  }

  .panel-header {
    font-size: 11px;
    font-weight: 800;
    color: rgba(255, 255, 255, 0.35);
    letter-spacing: 1.5px;
    padding: 5px 8px 3px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  /* ── Phone Layout ── */
  .vj-section { flex-shrink: 0; }
  .grid-section { border-bottom: 1px solid rgba(255, 255, 255, 0.06); }

  .phone-top-strip {
    padding: 4px 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.01);
    flex-shrink: 0;
  }
  .phone-control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    gap: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.01);
    flex-shrink: 0;
  }
  .phone-xfader-strip {
    padding: 4px 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .phone-tab-strip {
    display: flex;
    gap: 2px;
    padding: 4px 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.02);
    flex-shrink: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .tab-btn {
    flex: 1 1 auto;
    min-width: 44px;
    padding: 6px 4px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.5px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: all 0.1s;
  }
  .tab-btn.active {
    background: rgba(255, 200, 100, 0.12);
    border-color: rgba(255, 200, 100, 0.5);
    color: #ffc864;
    box-shadow: 0 0 6px rgba(255, 200, 100, 0.3);
  }

  .phone-tab-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 6px;
    -webkit-overflow-scrolling: touch;
  }
  .phone-mixer {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Phone landscape */
  .landscape-layout {
    display: grid;
    grid-template-columns: 1fr auto;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .landscape-grid-side {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }
  .landscape-mixer-side {
    display: flex;
    gap: 4px;
    padding: 6px;
    overflow-y: auto;
    overflow-x: hidden;
    background: rgba(255, 255, 255, 0.01);
    border-left: 1px solid rgba(255, 255, 255, 0.06);
  }
</style>
