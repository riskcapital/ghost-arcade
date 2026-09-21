import { describe, expect, it } from 'vitest';
import { macroAssignmentValue, macroTargetKey, normalizeMacroAssignment } from './macroAssignments';
const assignment = { target: { scope: 'vj-clip' as const, bank: 'B' as const, clipId: 'clip', effectId: 'fx', param: 'brightness' }, label: 'Brightness', min: -1, max: 1, from: 1, to: -1 };
describe('macro assignment ranges', () => {
  it('supports inverted, bounded and stationary ranges', () => {
    expect(macroAssignmentValue(assignment, 0)).toBe(1);
    expect(macroAssignmentValue(assignment, 0.5)).toBe(0);
    expect(macroAssignmentValue(assignment, 1)).toBe(-1);
    expect(macroAssignmentValue(assignment, 8)).toBe(-1);
    expect(macroAssignmentValue({ ...assignment, from: 0.3, to: 0.3 }, 0.8)).toBeCloseTo(0.3);
  });
  it('rejects invalid restored routes and clamps endpoints', () => {
    for (const invalid of [null, {}, { ...assignment, min: NaN }, { ...assignment, max: -2 }, { ...assignment, target: { ...assignment.target, param: '__proto__' } }, { ...assignment, target: { ...assignment.target, bank: 'C' } }]) expect(normalizeMacroAssignment(invalid)).toBeNull();
    expect(normalizeMacroAssignment({ ...assignment, from: 9, to: -9 })).toMatchObject({ from: 1, to: -1 });
  });
  it('keeps decks and identities distinct', () => {
    expect(macroTargetKey(assignment.target)).not.toBe(macroTargetKey({ ...assignment.target, bank: 'A' }));
    expect(macroTargetKey(assignment.target)).not.toBe(macroTargetKey({ ...assignment.target, clipId: 'other' }));
  });
});
