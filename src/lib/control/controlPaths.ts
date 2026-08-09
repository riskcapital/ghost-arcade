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
  { path: 'vj:master:opacity', label: 'VJ master opacity' },
  { path: 'vj:crossfader:value', label: 'A/B crossfader' },
  { path: 'vj:stopall', label: 'Stop all VJ clips' },
  { path: 'map:preset:0', label: 'Mapping preset 1' },
  { path: 'map:layer:opacity', label: 'Selected mapping layer opacity' },
  { path: 'map:media:play', label: 'Selected media play / pause' },
  { path: 'map:media:restart', label: 'Selected media restart' },
];

/** Accept old documentation/user syntax while keeping one router contract. */
export function normalizeControlPath(path: string): string {
  const compact = path.trim().replace(/\s+/g, '');
  return compact
    .replace(/^mapping:/i, 'map:')
    .replace(/^(vj(?:-b)?):layer:(\d+):/i, '$1:$2:')
    .toLowerCase();
}

function isIndex(value: string | undefined): boolean {
  return value !== undefined && /^\d+$/.test(value);
}

export function validateControlPath(path: string): ControlPathValidation {
  const normalized = normalizeControlPath(path);
  if (!normalized) return { valid: false, normalized, reason: 'Enter a parameter path.' };

  const parts = normalized.split(':');
  const scope = parts[0];
  if (!['map', 'vj', 'vj-b', 'sv'].includes(scope)) {
    return {
      valid: false,
      normalized,
      reason: 'Path must begin with map:, vj:, vj-b:, or sv:.',
    };
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
      return ['play', 'restart', 'position'].includes(parts[2] ?? '')
        ? { valid: true, normalized, reason: null }
        : { valid: false, normalized, reason: 'Media actions are play, restart, or position.' };
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
      return ['play', 'restart', 'mirror', 'position'].includes(parts[3] ?? '')
        ? { valid: true, normalized, reason: null }
        : { valid: false, normalized, reason: 'Video actions are play, restart, mirror, or position.' };
    }
    if (['opacity', 'blend', 'solo', 'mute', 'shader', 'splat', 'model3d', 'plugin'].includes(property ?? '')) {
      return { valid: true, normalized, reason: null };
    }
    return { valid: false, normalized, reason: `Unknown VJ layer property "${property ?? ''}".` };
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
  if (['mode', 'stopall', 'quantize', 'quantize-clear'].includes(target ?? '')) {
    return { valid: true, normalized, reason: null };
  }

  return { valid: false, normalized, reason: `Unknown VJ target "${target ?? ''}".` };
}
