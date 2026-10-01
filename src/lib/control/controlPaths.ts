export interface ControlPathValidation {
  valid: boolean;
  normalized: string;
  reason: string | null;
}

export interface ControlPathExample {
  path: string;
  label: string;
}

export const CONTROL_PATH_EXAMPLES: ControlPathExample[] = [
  { path: 'vj:0:trigger:0', label: 'Deck A layer 1, clip 1' },
  { path: 'vj-b:0:trigger:0', label: 'Deck B layer 1, clip 1' },
  { path: 'vj:0:opacity', label: 'Deck A layer 1 opacity' },
  { path: 'vj:0:video:play', label: 'Deck A layer 1 play / pause' },
  { path: 'vj:0:video:restart', label: 'Deck A layer 1 restart' },
  { path: 'vj:0:video:scratch', label: 'Deck A layer 1 video scratch (hold frame)' },
  { path: 'vj-b:0:video:scratch', label: 'Deck B layer 1 video scratch (hold frame)' },
  { path: 'vj:master:opacity', label: 'VJ master opacity' },
  { path: 'vj:crossfader:value', label: 'A/B crossfader' },
  { path: 'vj:stopall', label: 'Stop all VJ clips' },
  { path: 'vj:rec', label: 'Start / stop output recording' },
  { path: 'vj:tap', label: 'Tap tempo' },
  { path: 'vj:0:blend:next', label: 'Deck A layer 1 next blend mode' },
  { path: 'tray:browse', label: 'Media Library browse (encoder)' },
  { path: 'tray:load', label: 'Load highlighted Media Library item' },
  { path: 'tray:rec', label: 'Record highlighted live source to a clip' },
  { path: 'map:preset:0', label: 'Mapping preset 1' },
  { path: 'map:layer:opacity', label: 'Selected mapping layer opacity' },
  { path: 'map:media:play', label: 'Selected media play / pause' },
  { path: 'map:media:restart', label: 'Selected media restart' },
  { path: 'map:media:scratch', label: 'Selected media scratch (hold frame)' },
  { path: 'show:go', label: 'Cue list GO' },
  { path: 'show:back', label: 'Cue list Back' },
  { path: 'show:stop', label: 'Cue list Stop' },
  { path: 'show:reset', label: 'Cue list Reset to the first cue' },
  { path: 'show:cue:0', label: 'Fire cue 1 of the cue list' },
];

export const SHOW_CONTROL_ACTIONS = ['go', 'back', 'stop', 'reset'] as const;

/** Accept old documentation/user syntax while keeping one router contract. */
export function normalizeControlPath(path: string): string {
  const compact = path.trim().replace(/\s+/g, '');
  return compact
    .replace(/^mapping:/i, 'map:')
    .replace(/^(vj(?:-b)?):layer:(\d+):/i, '$1:$2:')
    .toLowerCase();
}

export function isVideoScratchPath(path: string): boolean {
  return /^(?:map:media:scratch|vj(?:-b)?:\d+:video:scratch)$/.test(normalizeControlPath(path));
}

function isIndex(value: string | undefined): boolean {
  return value !== undefined && /^\d+$/.test(value);
}

export function validateControlPath(path: string): ControlPathValidation {
  const normalized = normalizeControlPath(path);
  if (!normalized) return { valid: false, normalized, reason: 'Enter a parameter path.' };

  const parts = normalized.split(':');
  const scope = parts[0];
  if (!['map', 'vj', 'vj-b', 'sv', 'show', 'tray'].includes(scope)) {
    return {
      valid: false,
      normalized,
      reason: 'Path must begin with map:, vj:, vj-b:, sv:, show:, or tray:.',
    };
  }

  if (scope === 'tray') {
    return ['tab', 'next', 'prev', 'browse', 'load', 'rec'].includes(parts[1] ?? '')
      ? { valid: true, normalized, reason: null }
      : { valid: false, normalized, reason: 'Tray actions are tab, next, prev, browse, load, or rec.' };
  }

  if (scope === 'show') {
    if ((SHOW_CONTROL_ACTIONS as readonly string[]).includes(parts[1] ?? '') && parts.length === 2) {
      return { valid: true, normalized, reason: null };
    }
    if (parts[1] === 'cue' && isIndex(parts[2]) && parts.length === 3) {
      return { valid: true, normalized, reason: null };
    }
    return { valid: false, normalized, reason: 'Show paths are show:go, show:back, show:stop, show:reset or show:cue:<zero-based index>.' };
  }

  if (scope === 'sv') {
    return parts.length >= 2
      ? { valid: true, normalized, reason: null }
      : { valid: false, normalized, reason: 'Performer paths need an action or parameter.' };
  }

  if (scope === 'map') {
    const target = parts[1];
    if (target === 'preset') {
      return isIndex(parts[2])
        ? { valid: true, normalized, reason: null }
        : { valid: false, normalized, reason: 'Mapping preset paths use map:preset:<zero-based index>.' };
    }
    if (target === 'media') {
      return ['play', 'restart', 'position', 'scratch'].includes(parts[2] ?? '')
        ? { valid: true, normalized, reason: null }
        : { valid: false, normalized, reason: 'Media actions are play, restart, position, or scratch.' };
    }
    if (['layer', 'effect', 'gpu', 'shader', 'plugin', 'splat', 'model3d', 'stage-effect'].includes(target ?? '')) {
      return parts.length >= 3
        ? { valid: true, normalized, reason: null }
        : { valid: false, normalized, reason: `The ${target} path needs a property or action.` };
    }
    return { valid: false, normalized, reason: `Unknown mapping target "${target ?? ''}".` };
  }

  const target = parts[1];
  if (isIndex(target)) {
    const property = parts[2];
    if (property === 'trigger') {
      return isIndex(parts[3])
        ? { valid: true, normalized, reason: null }
        : { valid: false, normalized, reason: 'Clip triggers use vj:<layer>:trigger:<column>.' };
    }
    if (property === 'video') {
      return ['play', 'restart', 'mirror', 'position', 'scratch', 'audio', 'audiomute', 'audiovolume', 'audiopan'].includes(parts[3] ?? '')
        ? { valid: true, normalized, reason: null }
        : { valid: false, normalized, reason: 'Video actions are play, restart, mirror, position, or scratch.' };
    }
    if (['opacity', 'blend', 'solo', 'mute', 'audiovolume', 'audiopan', 'autopilot', 'shader', 'splat', 'model3d', 'plugin'].includes(property ?? '')) {
      return { valid: true, normalized, reason: null };
    }
    return { valid: false, normalized, reason: `Unknown VJ layer property "${property ?? ''}".` };
  }

  if (target === 'group') {
    const valid = !!parts[2] && (
      (parts[3] === 'level' && parts.length === 4) ||
      (parts[3] === 'column' && parts.length === 5 && isIndex(parts[4])) ||
      (parts[3] === 'fx' && !!parts[4] && (
        (['mix', 'enabled'].includes(parts[5]) && parts.length === 6) ||
        (parts[5] === 'param' && !!parts[6] && parts.length === 7)))
    );
    return { valid, normalized, reason: valid ? null : 'Group paths require an ID and level, column, or effect parameter.' };
  }
  if (['column', 'block', 'stage', 'snapshot'].includes(target ?? '')) {
    return isIndex(parts[2])
      ? { valid: true, normalized, reason: null }
      : { valid: false, normalized, reason: `${target} paths require a zero-based index.` };
  }
  if (['master', 'crossfader', 'stage-effect', 'led-effect', 'macro'].includes(target ?? '')) {
    return parts.length >= 3
      ? { valid: true, normalized, reason: null }
      : { valid: false, normalized, reason: `The ${target} path needs a property or action.` };
  }
  if (['mode', 'stopall', 'quantize', 'quantize-clear', 'rec', 'tap'].includes(target ?? '')) {
    return { valid: true, normalized, reason: null };
  }

  return { valid: false, normalized, reason: `Unknown VJ target "${target ?? ''}".` };
}
