import type { SVClipAssignment } from '../types';
import type { VJClip, VJDeck } from '../stores/vjClipLauncher';

export function performerTargetDeck(state: {
  crossfaderEnabled: boolean;
  selectedDeck: VJDeck;
}): VJDeck {
  return state.crossfaderEnabled ? state.selectedDeck : 'A';
}

export function performerAssignmentDeck(assignment: SVClipAssignment): VJDeck {
  return assignment.performerDeck ?? 'A';
}

export function createNativePerformerShaderClip(
  assignment: SVClipAssignment,
  id: string,
): VJClip | null {
  if (assignment.type !== 'shader' || !assignment.shaderCode) return null;

  return {
    id,
    type: 'shader',
    name: assignment.shaderName || 'Shader',
    src: assignment.shaderSrc || '',
    thumbnail: assignment.shaderThumbnail,
    shaderCode: assignment.shaderCode,
    shaderValues: { ...(assignment.manifestDefaults ?? {}) },
  };
}
