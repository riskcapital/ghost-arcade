/** Manufacturer protocols and page references: docs/midi-controller-lights.md. */
export type ControllerProfileId = 'generic' | 'apc40-mk2' | 'apc-mini-mk2' | 'launchpad-x' | 'launchpad-mini-mk3';
export interface ControllerProfile {
  id: ControllerProfileId; label: string; rows: number; columns: number;
  note: (row: number, column: number) => number;
  channel: number; enter: number[][]; leave: number[][];
}
const apcMode = (mode: number) => [0xf0, 0x47, 0x7f, 0x29, 0x60, 0, 4, mode, 2, 0, 8, 0xf7];
const launchpadMode = (device: number, mode: number) => [0xf0, 0, 0x20, 0x29, 2, device, 0x0e, mode, 0xf7];
export const controllerProfiles: Record<ControllerProfileId, ControllerProfile> = {
  generic: { id: 'generic', label: 'Learned pads only', rows: 0, columns: 0, note: () => 0, channel: 0, enter: [], leave: [] },
  'apc40-mk2': { id: 'apc40-mk2', label: 'Akai APC40 mkII', rows: 5, columns: 8,
    note: (r, c) => (4 - r) * 8 + c, channel: 0, enter: [apcMode(0x41)], leave: [apcMode(0x40)] },
  'apc-mini-mk2': { id: 'apc-mini-mk2', label: 'Akai APC mini mk2', rows: 8, columns: 8,
    note: (r, c) => (7 - r) * 8 + c, channel: 6, enter: [], leave: [] },
  'launchpad-x': { id: 'launchpad-x', label: 'Novation Launchpad X', rows: 8, columns: 8,
    note: (r, c) => (8 - r) * 10 + c + 1, channel: 0, enter: [launchpadMode(0x0c, 1)], leave: [launchpadMode(0x0c, 0)] },
  'launchpad-mini-mk3': { id: 'launchpad-mini-mk3', label: 'Novation Launchpad Mini mk3', rows: 8, columns: 8,
    note: (r, c) => (8 - r) * 10 + c + 1, channel: 0, enter: [launchpadMode(0x0d, 1)], leave: [launchpadMode(0x0d, 0)] },
};
export function detectControllerProfile(name: string): ControllerProfileId {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/apc40(mkii|mk2)/.test(n)) return 'apc40-mk2';
  if (/apcmini(mkii|mk2)/.test(n)) return 'apc-mini-mk2';
  if (n.includes('launchpadx') || n.includes('lpxmidi')) return 'launchpad-x';
  if (/launchpadmini(mkiii|mk3)/.test(n) || n.includes('lpminimk3')) return 'launchpad-mini-mk3';
  return 'generic';
}
export function controllerCell(profile: ControllerProfile, note: number): [number, number] | null {
  for (let r = 0; r < profile.rows; r++) for (let c = 0; c < profile.columns; c++) {
    if (profile.note(r, c) === note) return [r, c];
  }
  return null;
}
