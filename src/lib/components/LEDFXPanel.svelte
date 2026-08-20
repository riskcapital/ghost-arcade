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
  import { t } from '../i18n';

  const COLOR_PATTERN_OPTIONS = [
    { id: 0, labelKey: 'led.fx.colorPatterns.solid' },
    { id: 1, labelKey: 'led.fx.colorPatterns.gradient' },
    { id: 2, labelKey: 'led.fx.colorPatterns.everyOther' },
    { id: 3, labelKey: 'led.fx.colorPatterns.blocks' },
    { id: 4, labelKey: 'led.fx.colorPatterns.random' },
    { id: 5, labelKey: 'led.fx.colorPatterns.wave' },
  ];
  const COLOR_PALETTES = [
    { id: 'white', labelKey: 'led.fx.palettes.white', colors: ['#ffffff', '#ffffff', '#ffffff', '#ffffff'] },
    { id: 'fire-embers', labelKey: 'led.fx.palettes.fireEmbers', colors: ['#ff3100', '#ff8a00', '#ffd166', '#3a0900'] },
    {
      id: 'green-lanterns',
      labelKey: 'led.fx.palettes.greenLanterns', colors: ['#00ff8a', '#7cff6b', '#1a5f35', '#d8ffe0'],
    },
    { id: 'fireflies', labelKey: 'led.fx.palettes.fireflies', colors: ['#ecff91', '#a8ff4f', '#2a5d18', '#fff6a6'] },
    { id: 'cyber', labelKey: 'led.fx.palettes.cyber', colors: ['#00f0ff', '#ff2bd6', '#6633ff', '#ffffff'] },
    { id: 'ocean', labelKey: 'led.fx.palettes.ocean', colors: ['#00d4ff', '#006eff', '#00ffb3', '#001a3a'] },
  ];

  let selectedPattern: WLEDPatternId = 'solid-color';
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
    const effect = effects.find((item) => item.id === effectId);
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

  function patternLabel(pattern: WLEDPatternId): string {
    const definition = getWLEDPatternDefinition(pattern);
    return $t(`led.fx.patterns.${definition.id}.label`);
  }

  function patternDescription(pattern: WLEDPatternId): string {
    const definition = getWLEDPatternDefinition(pattern);
    return $t(`led.fx.patterns.${definition.id}.description`);
  }

  function categoryLabel(category: string): string {
    return $t(`led.fx.categories.${category}`);
  }

  function targetModeLabel(mode: string): string {
    return $t(`led.fx.targetModes.${mode}`);
  }

  function effectName(effect: WLEDEffect, pattern: WLEDPatternId): string {
    const definition = getWLEDPatternDefinition(pattern);
    return effect.name === definition.label ? patternLabel(pattern) : effect.name;
  }

  function setColorCount(effect: WLEDEffect, count: number) {
    updateParam(effect, 'colorCount', Math.max(1, Math.min(4, count)));
  }

  function applyColorPalette(effect: WLEDEffect, colors: string[]) {
    updateEffect(effect.id, {
      color: colors[0] ?? effect.color,
      secondaryColor: colors[1] ?? effect.secondaryColor,
      tertiaryColor: colors[2] ?? effect.tertiaryColor,
      quaternaryColor: colors[3] ?? effect.quaternaryColor,
      colorSource: 'custom',
    });
  }

  onMount(() => {
    const handleControl = (event: Event) => {
      const detail = (event as CustomEvent<{
        effectId?: string;
        action?: 'toggle' | 'hold';
        pressed?: boolean;
      }>).detail;
      if (!detail?.effectId || !detail.action) return;
      const effect = effects.find((item) => item.id === detail.effectId);
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
      <strong>{$t('led.fx.title')}</strong>
      <span>{$t('led.fx.status', {
          values: {
            live: effects.filter((effect) => effect.active).length,
            loaded: effects.length,
          },
        })}</span>
    </div>
    <button
      class:active={automation.playing}
      class="automation-play"
      onclick={() => project.updateWLEDEffectAutomation({ playing: !automation.playing })}
      title={$t(automation.playing ? 'led.fx.automation.stopTitle' : 'led.fx.automation.startTitle')}
    >{automation.playing ? 'Ⅱ' : '▶'}</button>
  </header>

  <div class="automation-bar">
    <select
      value={automation.mode}
      onchange={(event) => project.updateWLEDEffectAutomation({
        mode: (event.target as HTMLSelectElement).value as 'beat' | 'time',
        })}
    >
      <option value="beat">{$t('led.fx.automation.beat')}</option>
      <option value="time">{$t('led.fx.automation.time')}</option>
    </select>
    {#if automation.mode === 'beat'}
      <input
        type="number"
        min="1"
        max="128"
        step="1"
        value={automation.beats}
        onchange={(event) => project.updateWLEDEffectAutomation({
          beats: Math.max(1, parseInt((event.target as HTMLInputElement).value, 10) || 1),
          })}
        aria-label={$t('led.fx.automation.beatsAria')}
      />
      <span>{$t('led.fx.automation.beatsUnit')}</span>
    {:else}
      <input
        type="number"
        min="0.1"
        max="120"
        step="0.1"
        value={automation.seconds}
        onchange={(event) => project.updateWLEDEffectAutomation({
          seconds: Math.max(0.1, parseFloat((event.target as HTMLInputElement).value) || 0.1),
          })}
        aria-label={$t('led.fx.automation.secondsAria')}
      />
      <span>{$t('led.fx.automation.secondsUnit')}</span>
    {/if}
    <select
      value={automation.order}
      onchange={(event) => project.updateWLEDEffectAutomation({
        order: (event.target as HTMLSelectElement).value as 'forward' | 'random' | 'pingpong',
        })}
      aria-label={$t('led.fx.automation.orderAria')}
    >
      <option value="forward">{$t('led.fx.automation.forward')}</option>
      <option value="random">{$t('led.fx.automation.random')}</option>
      <option value="pingpong">{$t('led.fx.automation.pingpong')}</option>
    </select>
  </div>

  <section class="catalog">
    <div class="catalog-title">
      <span>{$t('led.fx.catalog.title')}</span>
      <small>{$t('led.fx.catalog.count', { values: { count: WLED_PATTERN_CATALOG.length} })}</small>
    </div>
    <label class="catalog-picker">
      <span>{$t('led.fx.catalog.pattern')}</span>
      <select
        value={selectedPattern}
        title={patternDescription(selectedPattern)}
        onchange={(event) => (selectedPattern = (event.target as HTMLSelectElement).value as WLEDPatternId)}
      >
        {#each WLED_PATTERN_CATEGORIES as category (category.id)}
          <optgroup label={categoryLabel(category.id)}>
            {#each WLED_PATTERN_CATALOG.filter((pattern) => pattern.category === category.id) as pattern (pattern.id)}
              <option value={pattern.id}>{patternLabel(pattern.id)}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </label>
    <div class="catalog-add">
      <div>
        <strong>{patternLabel(selectedPattern)}</strong>
        <span>{patternDescription(selectedPattern)}</span>
      </div>
      <button onclick={() => addEffect()}>{$t('led.fx.catalog.add')}</button>
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
            title={$t(effect.active ? 'led.fx.effect.turnOffTitle' : 'led.fx.effect.latchOnTitle')}
            data-midi-path={`vj:led-effect:${effect.id}:toggle`}
            data-midi-label={$t('led.fx.effect.toggleLabel', { values: { name: effectName(effect, effect.pattern) } })}
            data-midi-mode="toggle"
            data-midi-min="0"
            data-midi-max="1"
          ><span></span></button>
          <button
            class="effect-name"
            onclick={() => (expandedEffectId = expandedEffectId === effect.id ? null : effect.id)}
          >
            <strong>{effectName(effect, effect.pattern)}</strong>
            <span>{categoryLabel(definition.category)} · {targetModeLabel(effect.target.mode)}</span>
          </button>
          <button
            class="hold"
            class:active={!!heldEffects[effect.id]}
            title={$t('led.fx.effect.holdTitle', { values: { name: effectName(effect, effect.pattern) } })}
            data-midi-path={`vj:led-effect:${effect.id}:hold`}
            data-midi-label={$t('led.fx.effect.holdLabel', { values: { name: effectName(effect, effect.pattern) } })}
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
            title={$t(effect.enabled ? 'led.fx.effect.includedTitle' : 'led.fx.effect.excludedTitle')}
          >{effect.enabled ? '↻' : '⊘'}</button>
          <button
            class="remove"
            onclick={() => project.removeWLEDEffect(effect.id)}
            title={$t('led.fx.effect.removeTitle')}>×</button>
        </div>

        {#if expandedEffectId === effect.id}
          <div class="effect-controls">
            <label class="wide">
              <span>{$t('led.fx.controls.name')}</span>
              <input
                type="text"
                value={effect.name}
                onchange={(event) => updateEffect(effect.id, {
                  name: (event.target as HTMLInputElement).value || definition.label,
                  })}
              />
            </label>
            <label class="wide">
              <span>{$t('led.fx.controls.target')}</span>
              <select
                value={targetValue(effect.target)}
                onchange={(event) => updateEffect(effect.id, {
                  target: parseTarget((event.target as HTMLSelectElement).value),
                  })}
              >
                <option value="all">{$t('led.fx.controls.entireRig')}</option>
                {#each $project.wledGroups ?? [] as group (group.id)}
                  <option value={`group:${group.id}`}>{$t('led.fx.controls.group')} · {group.name}</option>
                {/each}
                {#each $project.wledControllers ?? [] as controller (controller.id)}
                  <option value={`controller:${controller.id}`}>{$t('led.fx.controls.controller')} · {controller.name}</option>
                  {#each controller.ranges ?? [] as range (range.id)}
                    <option value={`range:${controller.id}:${range.id}`}>{$t('led.fx.controls.range')} · {controller.name} / {range.name}</option>
                  {/each}
                {/each}
              </select>
            </label>
            <label>
              <span>{$t('led.fx.controls.amount')} <b>{Math.round(effect.amount * 100)}%</b></span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={effect.amount}
                oninput={(event) => updateEffect(effect.id, {
                  amount: parseFloat((event.target as HTMLInputElement).value),
                  })}
              />
            </label>
            <label>
              <span>{$t('led.fx.controls.blend')}</span>
              <select
                value={effect.blendMode}
                onchange={(event) => updateEffect(effect.id, {
                  blendMode: (event.target as HTMLSelectElement).value as WLEDEffectBlendMode,
                  })}
              >
                <option value="replace">{$t('led.fx.controls.blendModes.replace')}</option>
                <option value="add">{$t('led.fx.controls.blendModes.add')}</option>
                <option value="multiply">{$t('led.fx.controls.blendModes.multiply')}</option>
                <option value="gate">{$t('led.fx.controls.blendModes.gate')}</option>
                <option value="colorize">{$t('led.fx.controls.blendModes.colorize')}</option>
              </select>
            </label>
            <label>
              <span>{$t('led.fx.controls.timing')}</span>
              <select
                value={effect.speedMode}
                onchange={(event) => updateEffect(effect.id, {
                  speedMode: (event.target as HTMLSelectElement).value as WLEDSpeedMode,
                  })}
              >
                <option value="manual">{$t('led.fx.controls.speedModes.manual')}</option>
                <option value="bpm">{$t('led.fx.controls.speedModes.bpm')}</option>
              </select>
            </label>
            {#if effect.speedMode === 'bpm'}
              <label>
                <span>{$t('led.fx.controls.cyclesPerBeat')} <b>{effect.beatDivision.toFixed(2)}</b></span>
                <input
                  type="range"
                  min="0.0625"
                  max="4"
                  step="0.0625"
                  value={effect.beatDivision}
                  oninput={(event) => updateEffect(effect.id, {
                    beatDivision: parseFloat((event.target as HTMLInputElement).value),
                    })}
                />
              </label>
            {:else}
              <label>
                <span>{$t('led.fx.controls.speed')} <b>{effect.speed.toFixed(2)}</b></span>
                <input
                  type="range"
                  min="0.01"
                  max="4"
                  step="0.01"
                  value={effect.speed}
                  oninput={(event) => updateEffect(effect.id, {
                    speed: parseFloat((event.target as HTMLInputElement).value),
                    })}
                />
              </label>
            {/if}
            {#if effect.pattern === 'solid-color'}
              <label class="wide">
                <span>{$t('led.fx.controls.colorPreset')}</span>
                <select
                  value=""
                  onchange={(event) => {
                    const preset = COLOR_PALETTES.find((item) => item.id === (event.target as HTMLSelectElement).value);
                    if (preset) applyColorPalette(effect, preset.colors);
                    (event.target as HTMLSelectElement).value = '';
                  }}
                >
                  <option value="">{$t('led.fx.catalog.choosePreset')}</option>
                  {#each COLOR_PALETTES as preset (preset.id)}
                    <option value={preset.id}>{$t(preset.labelKey)}</option>
                  {/each}
                </select>
              </label>
              <label>
                <span>{$t('led.fx.controls.colorCount')}</span>
                <select
                  value={Math.round(effect.params.colorCount ?? 1)}
                  onchange={(event) => setColorCount(effect, parseInt((event.target as HTMLSelectElement).value, 10))}
                >
                  <option value="1">{$t('led.fx.controls.colorCounts.one')}</option>
                  <option value="2">{$t('led.fx.controls.colorCounts.two')}</option>
                  <option value="3">{$t('led.fx.controls.colorCounts.three')}</option>
                  <option value="4">{$t('led.fx.controls.colorCounts.four')}</option>
                </select>
              </label>
              <label>
                <span>{$t('led.fx.controls.pattern')}</span>
                <select
                  value={Math.round(effect.params.colorPattern ?? 0)}
                  onchange={(event) => updateParam(effect, 'colorPattern', parseInt((event.target as HTMLSelectElement).value, 10))}
                >
                  {#each COLOR_PATTERN_OPTIONS as option (option.id)}
                    <option value={option.id}>{$t(option.labelKey)}</option>
                  {/each}
                </select>
              </label>
              <label>
                <span>{$t('led.fx.controls.colorA')}</span>
                <input
                  type="color"
                  value={effect.color}
                  oninput={(event) => updateEffect(effect.id, {
                    color: (event.target as HTMLInputElement).value,
                    })}
                />
              </label>
              {#if (effect.params.colorCount ?? 1) >= 2}
                <label>
                  <span>{$t('led.fx.controls.colorB')}</span>
                  <input
                    type="color"
                    value={effect.secondaryColor}
                    oninput={(event) => updateEffect(effect.id, {
                      secondaryColor: (event.target as HTMLInputElement).value,
                      })}
                  />
                </label>
              {/if}
              {#if (effect.params.colorCount ?? 1) >= 3}
                <label>
                  <span>{$t('led.fx.controls.colorC')}</span>
                  <input
                    type="color"
                    value={effect.tertiaryColor ?? '#ffd166'}
                    oninput={(event) => updateEffect(effect.id, {
                      tertiaryColor: (event.target as HTMLInputElement).value,
                      })}
                  />
                </label>
              {/if}
              {#if (effect.params.colorCount ?? 1) >= 4}
                <label>
                  <span>{$t('led.fx.controls.colorD')}</span>
                  <input
                    type="color"
                    value={effect.quaternaryColor ?? '#7cff6b'}
                    oninput={(event) => updateEffect(effect.id, {
                      quaternaryColor: (event.target as HTMLInputElement).value,
                      })}
                  />
                </label>
              {/if}
            {:else}
              <label class="wide">
                <span>{$t('led.fx.controls.colorSource')}</span>
                <select
                  value={effect.colorSource}
                  onchange={(event) => updateEffect(effect.id, {
                    colorSource: (event.target as HTMLSelectElement).value as WLEDColorSource,
                    })}
                >
                  <option value="shader">{$t('led.fx.controls.colorSources.shader')}</option>
                  <option value="palette">{$t('led.fx.controls.colorSources.palette')}</option>
                  <option value="custom">{$t('led.fx.controls.colorSources.custom')}</option>
                  <option value="rainbow">{$t('led.fx.controls.colorSources.rainbow')}</option>
                </select>
              </label>
              {#if effect.colorSource === 'custom'}
                <label>
                  <span>{$t('led.fx.controls.colorA')}</span>
                  <input
                    type="color"
                    value={effect.color}
                    oninput={(event) => updateEffect(effect.id, {
                      color: (event.target as HTMLInputElement).value,
                      })}
                  />
                </label>
                <label>
                  <span>{$t('led.fx.controls.colorB')}</span>
                  <input
                    type="color"
                    value={effect.secondaryColor}
                    oninput={(event) => updateEffect(effect.id, {
                      secondaryColor: (event.target as HTMLInputElement).value,
                      })}
                  />
                </label>
              {/if}
            {/if}
            {#each ['width', 'tail', 'density'] as key}
              <label>
                <span>{$t(`led.fx.controls.params.${key}`)} <b>{Math.round((effect.params[key] ?? 0.5) * 100)}%</b></span>
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
      <div class="empty">{$t('led.fx.empty')}</div>
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
  .catalog-picker { padding: 8px; border-bottom: 1px solid #24242b; }
  .catalog-picker span { color: #85858f; text-transform: uppercase; letter-spacing: 0.7px; }
  .catalog-picker select { min-width: 0; width: 100%; padding: 6px; }
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
