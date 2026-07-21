<script lang="ts">
  import { onMount } from 'svelte';
  import { project } from '../stores/layers';
  import type {
    WLEDColorSource,
    WLEDEffect,
    WLEDEffectBlendMode,
    WLEDEffectTarget,
    WLEDPatternId,
    WLEDSpeedMode,
  } from '../types';
  import {
    WLED_PATTERN_CATALOG,
    WLED_PATTERN_CATEGORIES,
    createWLEDEffect,
    getWLEDPatternDefinition,
  } from '../wled/effects';

  let selectedPattern: WLEDPatternId = 'chase';
  let expandedEffectId: string | null = null;
  let heldEffects: Record<string, boolean> = {};
  let holdRestore: Record<string, boolean> = {};

  $: effects = $project.wledEffects ?? [];
  $: automation = $project.wledEffectAutomation ?? {
    playing: false,
    mode: 'beat' as const,
    beats: 8,
    seconds: 4,
    order: 'forward' as const,
  };

  function addEffect(pattern = selectedPattern) {
    const effect = createWLEDEffect(pattern, effects.length);
    project.addWLEDEffect(effect);
    expandedEffectId = effect.id;
  }

  function updateEffect(effectId: string, fields: Partial<WLEDEffect>) {
    project.updateWLEDEffect(effectId, fields);
  }

  function toggleEffect(effect: WLEDEffect) {
    updateEffect(effect.id, { active: !effect.active });
  }

  function beginHold(effectId: string) {
    if (heldEffects[effectId]) return;
    const effect = effects.find(item => item.id === effectId);
    if (!effect) return;
    holdRestore = { ...holdRestore, [effectId]: effect.active };
    heldEffects = { ...heldEffects, [effectId]: true };
    updateEffect(effectId, { active: true });
  }

  function endHold(effectId: string) {
    if (!heldEffects[effectId]) return;
    const restore = holdRestore[effectId] ?? false;
    const nextHeld = { ...heldEffects };
    const nextRestore = { ...holdRestore };
    delete nextHeld[effectId];
    delete nextRestore[effectId];
    heldEffects = nextHeld;
    holdRestore = nextRestore;
    updateEffect(effectId, { active: restore });
  }

  function handleHoldStart(event: PointerEvent, effectId: string) {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    beginHold(effectId);
  }

  function handleHoldEnd(event: PointerEvent, effectId: string) {
    event.stopPropagation();
    endHold(effectId);
  }

  function targetValue(target: WLEDEffectTarget): string {
    if (target.mode === 'group') return `group:${target.groupId ?? ''}`;
    if (target.mode === 'controller') return `controller:${target.controllerId ?? ''}`;
    if (target.mode === 'range') return `range:${target.controllerId ?? ''}:${target.rangeId ?? ''}`;
    return 'all';
  }

  function parseTarget(value: string): WLEDEffectTarget {
    const [mode, controllerId, rangeId] = value.split(':');
    if (mode === 'group') return { mode: 'group', groupId: controllerId };
    if (mode === 'controller') return { mode: 'controller', controllerId };
    if (mode === 'range') return { mode: 'range', controllerId, rangeId };
    return { mode: 'all' };
  }

  function updateParam(effect: WLEDEffect, key: string, value: number) {
    updateEffect(effect.id, { params: { ...effect.params, [key]: value } });
  }

  onMount(() => {
    const handleControl = (event: Event) => {
      const detail = (event as CustomEvent<{
        effectId?: string;
        action?: 'toggle' | 'hold';
        pressed?: boolean;
      }>).detail;
      if (!detail?.effectId || !detail.action) return;
      const effect = effects.find(item => item.id === detail.effectId);
      if (!effect) return;
      if (detail.action === 'toggle') {
        if (detail.pressed) toggleEffect(effect);
      } else if (detail.pressed) {
        beginHold(effect.id);
      } else {
        endHold(effect.id);
      }
    };
    window.addEventListener('vj-led-effect-control', handleControl);
    return () => window.removeEventListener('vj-led-effect-control', handleControl);
  });
</script>

<div class="led-fx-panel">
  <header class="panel-heading">
    <div>
      <strong>LED FX</strong>
      <span>{effects.filter(effect => effect.active).length} live · {effects.length} loaded</span>
    </div>
    <button
      class:active={automation.playing}
      class="automation-play"
      onclick={() => project.updateWLEDEffectAutomation({ playing: !automation.playing })}
      title={automation.playing ? 'Stop LED sequence' : 'Start LED sequence'}
    >{automation.playing ? 'Ⅱ' : '▶'}</button>
  </header>

  <div class="automation-bar">
    <select
      value={automation.mode}
      onchange={(event) => project.updateWLEDEffectAutomation({
        mode: (event.target as HTMLSelectElement).value as 'beat' | 'time'
      })}
    >
      <option value="beat">Beat</option>
      <option value="time">Time</option>
    </select>
    {#if automation.mode === 'beat'}
      <input
        type="number"
        min="1"
        max="128"
        step="1"
        value={automation.beats}
        onchange={(event) => project.updateWLEDEffectAutomation({
          beats: Math.max(1, parseInt((event.target as HTMLInputElement).value, 10) || 1)
        })}
        aria-label="Beats per LED effect"
      />
      <span>beats</span>
    {:else}
      <input
        type="number"
        min="0.1"
        max="120"
        step="0.1"
        value={automation.seconds}
        onchange={(event) => project.updateWLEDEffectAutomation({
          seconds: Math.max(0.1, parseFloat((event.target as HTMLInputElement).value) || 0.1)
        })}
        aria-label="Seconds per LED effect"
      />
      <span>sec</span>
    {/if}
    <select
      value={automation.order}
      onchange={(event) => project.updateWLEDEffectAutomation({
        order: (event.target as HTMLSelectElement).value as 'forward' | 'random' | 'pingpong'
      })}
      aria-label="LED sequence order"
    >
      <option value="forward">Forward</option>
      <option value="random">Random</option>
      <option value="pingpong">Ping pong</option>
    </select>
  </div>

  <section class="catalog">
    <div class="catalog-title">
      <span>Pattern Catalog</span>
      <small>{WLED_PATTERN_CATALOG.length} patterns</small>
    </div>
    {#each WLED_PATTERN_CATEGORIES as category (category.id)}
      {@const patterns = WLED_PATTERN_CATALOG.filter(pattern => pattern.category === category.id)}
      <details open={category.id === 'movement'}>
        <summary>{category.label}<span>{patterns.length}</span></summary>
        <div class="pattern-grid">
          {#each patterns as pattern (pattern.id)}
            <button
              class:selected={selectedPattern === pattern.id}
              onclick={() => selectedPattern = pattern.id}
              title={pattern.description}
            >{pattern.label}</button>
          {/each}
        </div>
      </details>
    {/each}
    <div class="catalog-add">
      <div>
        <strong>{getWLEDPatternDefinition(selectedPattern).label}</strong>
        <span>{getWLEDPatternDefinition(selectedPattern).description}</span>
      </div>
      <button onclick={() => addEffect()}>+ Add</button>
    </div>
  </section>

  <section class="effect-stack">
    {#each effects as effect (effect.id)}
      {@const definition = getWLEDPatternDefinition(effect.pattern)}
      <article class:live={effect.active} class:held={!!heldEffects[effect.id]}>
        <div class="effect-heading">
          <button
            class="latch"
            class:active={effect.active}
            onclick={() => toggleEffect(effect)}
            aria-pressed={effect.active}
            title={effect.active ? 'Turn effect off' : 'Latch effect on'}
            data-midi-path={`vj:led-effect:${effect.id}:toggle`}
            data-midi-label={`LED FX Toggle: ${effect.name}`}
            data-midi-mode="toggle"
            data-midi-min="0"
            data-midi-max="1"
          ><span></span></button>
          <button
            class="effect-name"
            onclick={() => expandedEffectId = expandedEffectId === effect.id ? null : effect.id}
          >
            <strong>{effect.name}</strong>
            <span>{definition.category} · {effect.target.mode}</span>
          </button>
          <button
            class="hold"
            class:active={!!heldEffects[effect.id]}
            title={`Hold to show ${effect.name}`}
            data-midi-path={`vj:led-effect:${effect.id}:hold`}
            data-midi-label={`LED FX Hold: ${effect.name}`}
            data-midi-mode="toggle"
            data-midi-min="0"
            data-midi-max="1"
            data-keyboard-mode="momentary"
            onpointerdown={(event) => handleHoldStart(event, effect.id)}
            onpointerup={(event) => handleHoldEnd(event, effect.id)}
            onpointercancel={(event) => handleHoldEnd(event, effect.id)}
            onlostpointercapture={(event) => handleHoldEnd(event, effect.id)}
          >▶</button>
          <button
            class="sequence"
            class:included={effect.enabled}
            onclick={() => updateEffect(effect.id, { enabled: !effect.enabled })}
            title={effect.enabled ? 'Included in sequence' : 'Excluded from sequence'}
          >{effect.enabled ? '↻' : '⊘'}</button>
          <button
            class="remove"
            onclick={() => project.removeWLEDEffect(effect.id)}
            title="Remove LED effect"
          >×</button>
        </div>

        {#if expandedEffectId === effect.id}
          <div class="effect-controls">
            <label class="wide">
              <span>Name</span>
              <input
                type="text"
                value={effect.name}
                onchange={(event) => updateEffect(effect.id, {
                  name: (event.target as HTMLInputElement).value || definition.label
                })}
              />
            </label>
            <label class="wide">
              <span>Target</span>
              <select
                value={targetValue(effect.target)}
                onchange={(event) => updateEffect(effect.id, {
                  target: parseTarget((event.target as HTMLSelectElement).value)
                })}
              >
                <option value="all">Entire LED rig</option>
                {#each $project.wledGroups ?? [] as group (group.id)}
                  <option value={`group:${group.id}`}>Group · {group.name}</option>
                {/each}
                {#each $project.wledControllers ?? [] as controller (controller.id)}
                  <option value={`controller:${controller.id}`}>Controller · {controller.name}</option>
                  {#each controller.ranges ?? [] as range (range.id)}
                    <option value={`range:${controller.id}:${range.id}`}>Range · {controller.name} / {range.name}</option>
                  {/each}
                {/each}
              </select>
            </label>
            <label>
              <span>Amount <b>{Math.round(effect.amount * 100)}%</b></span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={effect.amount}
                oninput={(event) => updateEffect(effect.id, {
                  amount: parseFloat((event.target as HTMLInputElement).value)
                })}
              />
            </label>
            <label>
              <span>Blend</span>
              <select
                value={effect.blendMode}
                onchange={(event) => updateEffect(effect.id, {
                  blendMode: (event.target as HTMLSelectElement).value as WLEDEffectBlendMode
                })}
              >
                <option value="replace">Replace</option>
                <option value="add">Add</option>
                <option value="multiply">Multiply</option>
                <option value="gate">Gate</option>
                <option value="colorize">Colorize</option>
              </select>
            </label>
            <label>
              <span>Timing</span>
              <select
                value={effect.speedMode}
                onchange={(event) => updateEffect(effect.id, {
                  speedMode: (event.target as HTMLSelectElement).value as WLEDSpeedMode
                })}
              >
                <option value="manual">Manual</option>
                <option value="bpm">BPM sync</option>
              </select>
            </label>
            {#if effect.speedMode === 'bpm'}
              <label>
                <span>Cycles / beat <b>{effect.beatDivision.toFixed(2)}</b></span>
                <input
                  type="range"
                  min="0.0625"
                  max="4"
                  step="0.0625"
                  value={effect.beatDivision}
                  oninput={(event) => updateEffect(effect.id, {
                    beatDivision: parseFloat((event.target as HTMLInputElement).value)
                  })}
                />
              </label>
            {:else}
              <label>
                <span>Speed <b>{effect.speed.toFixed(2)}</b></span>
                <input
                  type="range"
                  min="0.01"
                  max="4"
                  step="0.01"
                  value={effect.speed}
                  oninput={(event) => updateEffect(effect.id, {
                    speed: parseFloat((event.target as HTMLInputElement).value)
                  })}
                />
              </label>
            {/if}
            <label class="wide">
              <span>Color source</span>
              <select
                value={effect.colorSource}
                onchange={(event) => updateEffect(effect.id, {
                  colorSource: (event.target as HTMLSelectElement).value as WLEDColorSource
                })}
              >
                <option value="shader">Live content pixels</option>
                <option value="palette">Dominant content palette</option>
                <option value="custom">Custom colors</option>
                <option value="rainbow">Rainbow</option>
              </select>
            </label>
            {#if effect.colorSource === 'custom'}
              <label>
                <span>Color A</span>
                <input
                  type="color"
                  value={effect.color}
                  oninput={(event) => updateEffect(effect.id, {
                    color: (event.target as HTMLInputElement).value
                  })}
                />
              </label>
              <label>
                <span>Color B</span>
                <input
                  type="color"
                  value={effect.secondaryColor}
                  oninput={(event) => updateEffect(effect.id, {
                    secondaryColor: (event.target as HTMLInputElement).value
                  })}
                />
              </label>
            {/if}
            {#each ['width', 'tail', 'density'] as key}
              <label>
                <span>{key[0].toUpperCase() + key.slice(1)} <b>{Math.round((effect.params[key] ?? 0.5) * 100)}%</b></span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={effect.params[key] ?? 0.5}
                  oninput={(event) => updateParam(
                    effect,
                    key,
                    parseFloat((event.target as HTMLInputElement).value)
                  )}
                />
              </label>
            {/each}
          </div>
        {/if}
      </article>
    {/each}

    {#if effects.length === 0}
      <div class="empty">Choose any pattern above and add it to build your performance bank.</div>
    {/if}
  </section>
</div>

<style>
  .led-fx-panel { display: grid; gap: 8px; color: #c9c9d0; font-size: 10px; }
  button, input, select { font: inherit; }
  button, select, input[type='text'], input[type='number'] {
    border: 1px solid #33333c; border-radius: 3px; background: #111116; color: #c9c9d0;
  }
  button { cursor: pointer; }
  .panel-heading, .automation-bar, .catalog-title, .catalog-add, .effect-heading {
    display: flex; align-items: center;
  }
  .panel-heading { justify-content: space-between; padding: 2px 1px 7px; }
  .panel-heading > div { display: grid; gap: 2px; }
  .panel-heading strong, .catalog-title span { color: #ff7768; letter-spacing: 1px; }
  .panel-heading span, .catalog-title small { color: #696973; font-size: 8px; text-transform: uppercase; }
  .automation-play { width: 31px; height: 27px; }
  .automation-play.active { border-color: #4fd59a; color: #4fd59a; }
  .automation-bar { gap: 5px; padding: 7px; border: 1px solid #2d2d34; background: #0e0e13; }
  .automation-bar select { min-width: 0; padding: 4px; }
  .automation-bar select:last-child { margin-left: auto; }
  .automation-bar input { width: 38px; padding: 4px; }
  .automation-bar span { color: #71717a; }
  .catalog { border: 1px solid #2d2d34; background: #0e0e13; }
  .catalog-title { justify-content: space-between; padding: 8px; border-bottom: 1px solid #28282e; }
  details { border-bottom: 1px solid #24242b; }
  summary {
    display: flex; justify-content: space-between; padding: 7px 8px; color: #a8a8b0;
    cursor: pointer; text-transform: uppercase; letter-spacing: 0.7px;
  }
  summary span { color: #555560; }
  .pattern-grid {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; padding: 0 7px 7px;
  }
  .pattern-grid button {
    min-height: 28px; padding: 4px 6px; overflow: hidden; color: #8f8f99;
    text-align: left; text-overflow: ellipsis; white-space: nowrap;
  }
  .pattern-grid button:hover, .pattern-grid button.selected { border-color: #ff7768; color: #f0f0f3; }
  .pattern-grid button.selected { background: #291817; }
  .catalog-add { gap: 7px; padding: 8px; }
  .catalog-add div { display: grid; min-width: 0; gap: 2px; }
  .catalog-add strong { color: #eeeeef; }
  .catalog-add span { color: #6f6f78; font-size: 8px; line-height: 1.35; }
  .catalog-add button {
    flex: 0 0 auto; margin-left: auto; padding: 6px 8px; border-color: #8b4138; color: #ff7768;
  }
  .effect-stack { display: grid; gap: 5px; }
  article { border: 1px solid #303038; background: #111116; }
  article.live { border-color: #3e9d75; }
  article.held { box-shadow: inset 3px 0 #4fd59a; }
  .effect-heading { gap: 4px; min-height: 38px; padding: 5px; }
  .latch { display: grid; width: 27px; height: 27px; place-items: center; border-radius: 50%; }
  .latch span { width: 9px; height: 9px; border: 1px solid #666671; border-radius: 50%; }
  .latch.active { border-color: #4fd59a; }
  .latch.active span { border-color: #4fd59a; background: #4fd59a; box-shadow: 0 0 8px #4fd59a; }
  .effect-name {
    display: grid; min-width: 0; flex: 1; gap: 1px; border: 0; background: transparent; text-align: left;
  }
  .effect-name strong { overflow: hidden; color: #e6e6e9; text-overflow: ellipsis; white-space: nowrap; }
  .effect-name span { color: #64646f; font-size: 8px; text-transform: uppercase; }
  .hold, .sequence, .remove { width: 27px; height: 27px; }
  .hold.active { border-color: #4fd59a; color: #4fd59a; }
  .sequence.included { border-color: #298b68; color: #4fd59a; }
  .remove { color: #e75c5c; }
  .effect-controls {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;
    padding: 9px; border-top: 1px solid #2b2b31;
  }
  label { display: grid; min-width: 0; gap: 4px; }
  label.wide { grid-column: 1 / -1; }
  label > span { display: flex; justify-content: space-between; color: #85858f; text-transform: capitalize; }
  label b { color: #4bd7ff; font-weight: 400; }
  label select, label input[type='text'] { min-width: 0; width: 100%; padding: 5px; }
  label input[type='range'] { min-width: 0; width: 100%; accent-color: #4fd59a; }
  label input[type='color'] {
    width: 100%; height: 27px; padding: 1px; border: 1px solid #33333c; background: #0a0a0e;
  }
  .empty {
    padding: 14px; border: 1px dashed #36363e; color: #6e6e78; text-align: center; line-height: 1.5;
  }
</style>
