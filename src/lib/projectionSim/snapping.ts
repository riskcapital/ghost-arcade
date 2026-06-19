import type { ProjectionSimObject, ProjectionSimScene, ProjectionSimVec3 } from './types';

export type ProjectionSimAxis = 'x' | 'y' | 'z';

export interface ProjectionSimSnapSettings {
  enabled: boolean;
  touch: boolean;
  equalSpacing: boolean;
  threshold: number;
}

export interface ProjectionSimSnapGuide {
  axis: ProjectionSimAxis;
  kind: 'touch' | 'align' | 'spacing' | 'ground';
  label: string;
  delta: number;
}

export interface ProjectionSimObjectBounds {
  id: string;
  center: ProjectionSimVec3;
  size: ProjectionSimVec3;
  min: ProjectionSimVec3;
  max: ProjectionSimVec3;
}

type AxisIndex = 0 | 1 | 2;

const AXES: Array<{ axis: ProjectionSimAxis; index: AxisIndex }> = [
  { axis: 'x', index: 0 },
  { axis: 'y', index: 1 },
  { axis: 'z', index: 2 },
];

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function sizeForObject(object: ProjectionSimObject, scale: ProjectionSimVec3 = object.scale): ProjectionSimVec3 {
  const sx = Math.max(0.001, Math.abs(scale[0]));
  const sy = Math.max(0.001, Math.abs(scale[1]));
  const sz = Math.max(0.001, Math.abs(scale[2]));
  if (object.primitive === 'plane') return [sx, sy, Math.max(0.001, sz * 0.06)];
  return [sx, sy, sz];
}

export function getProjectionSimObjectBounds(
  object: ProjectionSimObject,
  position: ProjectionSimVec3 = object.position,
  scale: ProjectionSimVec3 = object.scale,
): ProjectionSimObjectBounds {
  const size = sizeForObject(object, scale);
  return {
    id: object.id,
    center: [...position] as ProjectionSimVec3,
    size,
    min: [
      position[0] - size[0] / 2,
      position[1] - size[1] / 2,
      position[2] - size[2] / 2,
    ],
    max: [
      position[0] + size[0] / 2,
      position[1] + size[1] / 2,
      position[2] + size[2] / 2,
    ],
  };
}

function otherBounds(scene: ProjectionSimScene, movingId: string): ProjectionSimObjectBounds[] {
  return scene.objects
    .filter((object) => object.id !== movingId && object.visible !== false)
    .map((object) => getProjectionSimObjectBounds(object));
}

function closestGuide(
  current: { delta: number; guide: ProjectionSimSnapGuide } | null,
  next: { delta: number; guide: ProjectionSimSnapGuide },
): { delta: number; guide: ProjectionSimSnapGuide } {
  if (!current) return next;
  return Math.abs(next.delta) < Math.abs(current.delta) ? next : current;
}

function findTouchSnap(
  moving: ProjectionSimObjectBounds,
  others: ProjectionSimObjectBounds[],
  axis: ProjectionSimAxis,
  index: AxisIndex,
  threshold: number,
): { delta: number; guide: ProjectionSimSnapGuide } | null {
  let best: { delta: number; guide: ProjectionSimSnapGuide } | null = null;
  const axisLabel = axis.toUpperCase();

  if (axis === 'y') {
    const groundDelta = -moving.min[index];
    if (Math.abs(groundDelta) <= threshold) {
      best = closestGuide(best, {
        delta: groundDelta,
        guide: { axis, kind: 'ground', label: `${axisLabel} floor`, delta: groundDelta },
      });
    }
  }

  for (const other of others) {
    const candidates = [
      { delta: other.max[index] - moving.min[index], kind: 'touch' as const, label: `${axisLabel} touch` },
      { delta: other.min[index] - moving.max[index], kind: 'touch' as const, label: `${axisLabel} touch` },
      { delta: other.min[index] - moving.min[index], kind: 'align' as const, label: `${axisLabel} edge` },
      { delta: other.max[index] - moving.max[index], kind: 'align' as const, label: `${axisLabel} edge` },
      { delta: other.center[index] - moving.center[index], kind: 'align' as const, label: `${axisLabel} center` },
    ];
    for (const candidate of candidates) {
      if (Math.abs(candidate.delta) > threshold) continue;
      best = closestGuide(best, {
        delta: candidate.delta,
        guide: {
          axis,
          kind: candidate.kind,
          label: candidate.label,
          delta: candidate.delta,
        },
      });
    }
  }

  return best;
}

function findEqualSpacingSnap(
  moving: ProjectionSimObjectBounds,
  others: ProjectionSimObjectBounds[],
  axis: ProjectionSimAxis,
  index: AxisIndex,
  threshold: number,
): { delta: number; guide: ProjectionSimSnapGuide } | null {
  const sorted = [...others].sort((a, b) => a.center[index] - b.center[index]);
  let best: { delta: number; guide: ProjectionSimSnapGuide } | null = null;

  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i];
    const right = sorted[i + 1];
    if (left.max[index] <= moving.min[index] && moving.max[index] <= right.min[index]) {
      const idealMin = (left.max[index] + right.min[index] - moving.size[index]) / 2;
      const delta = idealMin - moving.min[index];
      if (Math.abs(delta) <= threshold) {
        best = closestGuide(best, {
          delta,
          guide: {
            axis,
            kind: 'spacing',
            label: `${axis.toUpperCase()} equal gap ${round((right.min[index] - left.max[index] - moving.size[index]) / 2)}`,
            delta,
          },
        });
      }
    }
  }

  const referenceGaps: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].min[index] - sorted[i].max[index];
    if (gap >= 0.02) referenceGaps.push(gap);
  }

  for (const other of sorted) {
    for (const referenceGap of referenceGaps) {
      const afterDelta = other.max[index] + referenceGap - moving.min[index];
      if (Math.abs(afterDelta) <= threshold) {
        best = closestGuide(best, {
          delta: afterDelta,
          guide: {
            axis,
            kind: 'spacing',
            label: `${axis.toUpperCase()} gap ${round(referenceGap)}`,
            delta: afterDelta,
          },
        });
      }

      const beforeDelta = other.min[index] - referenceGap - moving.max[index];
      if (Math.abs(beforeDelta) <= threshold) {
        best = closestGuide(best, {
          delta: beforeDelta,
          guide: {
            axis,
            kind: 'spacing',
            label: `${axis.toUpperCase()} gap ${round(referenceGap)}`,
            delta: beforeDelta,
          },
        });
      }
    }
  }

  return best;
}

export function snapProjectionSimObjectTransform(
  scene: ProjectionSimScene,
  object: ProjectionSimObject,
  patch: Partial<ProjectionSimObject>,
  settings: ProjectionSimSnapSettings,
): { patch: Partial<ProjectionSimObject>; guides: ProjectionSimSnapGuide[] } {
  if (!settings.enabled || !patch.position) return { patch, guides: [] };

  const nextPosition = [...patch.position] as ProjectionSimVec3;
  const nextScale = (patch.scale ? [...patch.scale] : [...object.scale]) as ProjectionSimVec3;
  const others = otherBounds(scene, object.id);
  const guides: ProjectionSimSnapGuide[] = [];

  for (const { axis, index } of AXES) {
    const moving = getProjectionSimObjectBounds(object, nextPosition, nextScale);
    let best: { delta: number; guide: ProjectionSimSnapGuide } | null = null;
    const touchSnap = settings.touch ? findTouchSnap(moving, others, axis, index, settings.threshold) : null;
    const spacingSnap = settings.equalSpacing ? findEqualSpacingSnap(moving, others, axis, index, settings.threshold) : null;
    if (touchSnap) best = closestGuide(best, touchSnap);
    if (spacingSnap) best = closestGuide(best, spacingSnap);
    if (!best || Math.abs(best.delta) > settings.threshold) continue;
    nextPosition[index] = round(nextPosition[index] + best.delta);
    guides.push({ ...best.guide, delta: round(best.delta) });
  }

  return {
    patch: { ...patch, position: nextPosition },
    guides,
  };
}

export function spaceProjectionSimObjectsEvenly(
  objects: ProjectionSimObject[],
  axis: ProjectionSimAxis,
): ProjectionSimObject[] {
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const candidates = objects.filter((object) => object.visible !== false && !object.locked);
  if (candidates.length < 3) return objects;

  const sorted = candidates
    .map((object) => ({ object, bounds: getProjectionSimObjectBounds(object) }))
    .sort((a, b) => a.bounds.center[axisIndex] - b.bounds.center[axisIndex]);

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const spanStart = first.bounds.min[axisIndex];
  const spanEnd = last.bounds.max[axisIndex];
  const totalSize = sorted.reduce((sum, item) => sum + item.bounds.size[axisIndex], 0);
  const gap = Math.max(0, (spanEnd - spanStart - totalSize) / (sorted.length - 1));

  let cursor = spanStart;
  const positions = new Map<string, ProjectionSimVec3>();
  for (const item of sorted) {
    const next = [...item.object.position] as ProjectionSimVec3;
    next[axisIndex] = round(cursor + item.bounds.size[axisIndex] / 2);
    positions.set(item.object.id, next);
    cursor += item.bounds.size[axisIndex] + gap;
  }

  return objects.map((object) => {
    const position = positions.get(object.id);
    return position ? { ...object, position } : object;
  });
}
