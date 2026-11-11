/**
 * The Stage group's Screen FX and Effects rows in the Timeline tray: their
 * height, names, block colours and what a new block holds.
 */
import type { Effect, EffectType, StageEffect, StageEffectType } from '../../../types';
import { createDefaultStageEffect, getEffectDef, STAGE_EFFECT_CATALOG } from '../../../stores/stageEffects';
import { EFFECT_CATALOG } from '../../../effects/effectCatalog';
import { isNativeSelectableEffect } from '../../../renderer/nativeEffectCoverage';
import { generateUUID } from '../../../utils/uuid';
import { stageClipName, type StageClipRow, type TimelineStageClip } from '../../../timeline/stagefx/stageClips';

export const STAGE_FX_ROW_HEIGHT = 30;
export const STAGE_FX_ROWS: readonly StageClipRow[] = ['screenfx', 'effects'];
/** Both rows, under the Stage strip. */
export const STAGE_FX_ROWS_HEIGHT = STAGE_FX_ROWS.length * STAGE_FX_ROW_HEIGHT;

export const STAGE_ROW_NAMES: Record<StageClipRow, string> = { screenfx: 'Screen FX', effects: 'Effects' };

/** The row under a y inside the two rows. */
export function stageFxRowAtY(y: number): StageClipRow | null {
  if (y < 0) return null;
  return STAGE_FX_ROWS[Math.floor(y / STAGE_FX_ROW_HEIGHT)] ?? null;
}

/** Composition effects a block can switch on (those the native output runs). */
export const BLOCK_EFFECT_CATALOG = EFFECT_CATALOG.filter((e) => isNativeSelectableEffect(e.type));

export function effectLabel(type: EffectType | string): string {
  return EFFECT_CATALOG.find((e) => e.type === type)?.label ?? String(type);
}

export function blockName(c: TimelineStageClip): string {
  return stageClipName(c, effectLabel);
}

/** A Screen FX for a new block (a fresh copy, own id). */
export function newScreenFx(type: StageEffectType, from?: StageEffect | null): StageEffect {
  if (from) return { ...JSON.parse(JSON.stringify(from)), id: generateUUID(), enabled: true };
  return createDefaultStageEffect(type);
}

/** A composition effect for a new block (a fresh copy, own id). */
export function newBlockEffect(type: EffectType, params: Effect['params'], from?: Effect | null): Effect {
  if (from) return { ...JSON.parse(JSON.stringify(from)), id: generateUUID(), enabled: true };
  return { id: generateUUID(), type, enabled: true, params, opacity: 1, blendMode: 'normal' };
}

/** What "+" on a row picked. */
export interface StageBlockPick {
  screenFx?: { type: StageEffectType; from?: StageEffect };
  effect?: { type: EffectType; params: Effect['params']; from?: Effect };
}

export const SCREEN_FX_CHOICES = STAGE_EFFECT_CATALOG.filter((d) => d.type !== 'still');

export function screenFxIcon(type: StageEffectType): string {
  return getEffectDef(type)?.icon ?? '◆';
}

const HUES: Record<string, number> = {};
STAGE_EFFECT_CATALOG.forEach((d, i) => { HUES[d.type] = (i * 47) % 360; });

/** The block's background: a hint of the effect (its colours for a colour chase). */
export function stageBlockBackground(c: TimelineStageClip): string {
  if (c.row === 'screenfx') {
    const fx = c.screenFx!;
    if (fx.output && fx.output !== 'brightness') {
      return fx.colorStyle === 'rainbow'
        ? 'linear-gradient(90deg, #ff3b3b55, #ffd93b55, #3bff6e55, #3bb6ff55, #b33bff55)'
        : `linear-gradient(90deg, ${fx.color2 ?? '#00e5ff'}55, ${fx.color ?? '#ff2bd6'}66)`;
    }
    const h = HUES[fx.type] ?? 200;
    return `repeating-linear-gradient(90deg, hsl(${h} 80% 60% / 0.28) 0 10px, hsl(${h} 80% 30% / 0.12) 10px 22px)`;
  }
  return 'linear-gradient(180deg, rgba(167, 139, 250, 0.35), rgba(167, 139, 250, 0.12))';
}
