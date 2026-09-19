import { describe, expect, it, vi } from 'vitest';
import { ControllerLights, feedbackFrame, pairedOutput, clipPadState } from './controllerLights';
import { controllerProfiles, controllerCell, detectControllerProfile } from './controllerProfiles';
import type { VJClipLauncherState } from '../stores/vjClipLauncher';
import type { MidiStoreState, MidiMapping } from './midiTypes';
import type { ControllerLightsSettings } from './controllerLightsStore';
const clip = (id: string) => ({ id, type: 'image', name: id, src: `/${id}.png` });
const state = () => ({ isOpen: true, isLive: true, selectedDeck: 'A', crossfaderEnabled: true,
  clipGrid: [[clip('a'), clip('b'), null]], bankBClipGrid: [[clip('c')]],
  layerStates: [{ activeClip: clip('a') }], bankBLayerStates: [{ activeClip: clip('c') }],
  pendingTriggers: [], blocks: [], activeBlockId: 'main', crossfaderValue: 0 } as unknown as VJClipLauncherState);
const settings = (): ControllerLightsSettings => ({ enabled: true, outputId: 'out', profile: 'apc-mini-mk2',
  deck: 'selected', columnPage: 0, rowPage: 0, gridInput: true, status: '' });
const midi = (): MidiStoreState => ({ devices: [], mappings: [], selectedDeviceId: null } as unknown as MidiStoreState);
const output = () => ({ id: 'out', name: 'APC mini mk2', state: 'connected' as const, send: vi.fn() });
const mapping = (number: number, path: string) => ({ number, path, type: 'note', channel: 0 } as MidiMapping);
describe('controller protocols and feedback', () => {
  it('uses distinct protocol layouts and setup messages', () => {
    expect(controllerProfiles['apc-mini-mk2'].note(0, 0)).toBe(56);
    expect(controllerProfiles['apc40-mk2'].note(0, 0)).toBe(32);
    expect(controllerProfiles['launchpad-x'].note(0, 0)).toBe(81);
    expect(controllerProfiles['launchpad-mini-mk3'].note(7, 7)).toBe(18);
    expect(controllerProfiles['launchpad-x'].enter).toEqual([[240, 0, 32, 41, 2, 12, 14, 1, 247]]);
    expect(controllerProfiles['launchpad-mini-mk3'].leave).toEqual([[240, 0, 32, 41, 2, 13, 14, 0, 247]]);
    expect(controllerProfiles['apc40-mk2'].enter[0][7]).toBe(0x41);
    for (const profile of Object.values(controllerProfiles)) {
      const notes = new Set<number>();
      for (let r = 0; r < profile.rows; r++) for (let c = 0; c < profile.columns; c++) {
        const note = profile.note(r, c); notes.add(note);
        expect(controllerCell(profile, note)).toEqual([r, c]);
      }
      expect(notes.size).toBe(profile.rows * profile.columns);
      expect(controllerCell(profile, 127)).toBeNull();
    }
  });
  it('does not confuse older models or ambiguous output ports', () => {
    expect(detectControllerProfile('APC40')).toBe('generic');
    expect(detectControllerProfile('APC mini')).toBe('generic');
    expect(detectControllerProfile('APC40 mkII')).toBe('apc40-mk2');
    expect(detectControllerProfile('LPX MIDI')).toBe('launchpad-x');
    const input = { id: 'in', name: 'APC mini mk2 Input', manufacturer: 'Akai', state: 'connected' as const };
    const out = { ...output(), name: 'APC mini mk2 Output' };
    expect(pairedOutput(input, [out])).toBe(out);
    expect(pairedOutput(input, [out, { ...out, id: 'other' }])).toBeUndefined();
    expect(pairedOutput(input, [{ ...out, name: 'Unrelated' }])).toBeUndefined();
  });
  it('shows active identity, queued participants, deck colors and paged content', () => {
    const s = state(), conf = settings(), profile = controllerProfiles['apc-mini-mk2'];
    s.pendingTriggers = [{ kind: 'column', bank: 'A', columnIndex: 1, layerIndices: [0] } as any];
    const frame = feedbackFrame(s, conf, profile, [], true);
    expect(frame.find(l => l.note === 56)).toEqual({ status: 0x96, note: 56, value: 21 });
    expect(frame.find(l => l.note === 57)?.value).toBe(13);
    expect(feedbackFrame(s, conf, profile, [], false).find(l => l.note === 57)?.value).toBe(0);
    s.pendingTriggers[0].layerIndices = [];
    expect(clipPadState(s, 'A', 0, 1)).toBe('loaded');
    s.selectedDeck = 'B';
    expect(feedbackFrame(s, conf, profile, [], true)[0].value).toBe(45);
    s.crossfaderEnabled = false;
    expect(feedbackFrame(s, conf, profile, [], true)[0].value).toBe(0);
    s.selectedDeck = 'A'; conf.columnPage = 1; s.clipGrid[0][8] = clip('page') as any;
    expect(feedbackFrame(s, conf, profile, [], true)[0].value).toBe(23);
    s.layerStates[0].activeClip = clip('old-block') as any;
    expect(clipPadState(s, 'A', 0, 0)).toBe('loaded');
  });
  it('renders learned clip and toggle feedback from current app state', () => {
    const s = state(), conf = settings(), generic = controllerProfiles.generic;
    const mappings = [mapping(60, 'vj:0:trigger:0'), mapping(61, 'vj:crossfader:enabled'), mapping(62, 'unknown:path')];
    expect(feedbackFrame(s, conf, generic, mappings, true)).toEqual([
      { status: 144, note: 60, value: 127 }, { status: 144, note: 61, value: 127 },
    ]);
    s.layerStates[0].activeClip = null; s.crossfaderEnabled = false;
    expect(feedbackFrame(s, conf, generic, mappings, true).map(l => l.value)).toEqual([20, 0]);
  });
  it('sends only changed lights and clears removed mappings, old ports, and mixer close', () => {
    const engine = new ControllerLights(vi.fn()), out = output(), s = state(), m = midi(), conf = settings();
    engine.render(s, m, conf, [out], false, 0);
    expect(out.send).toHaveBeenCalledTimes(64);
    out.send.mockClear(); engine.render(s, m, conf, [out], false, 100);
    expect(out.send).not.toHaveBeenCalled();
    s.layerStates[0].activeClip = clip('b') as any;
    engine.render(s, m, conf, [out], false, 100);
    expect(out.send).toHaveBeenCalledTimes(2);
    const second = { ...output(), id: 'new' }; conf.outputId = 'new'; out.send.mockClear();
    engine.render(s, m, conf, [out, second], false, 100);
    expect(out.send).toHaveBeenCalledTimes(64);
    expect(out.send.mock.calls.every(call => call[0][2] === 0)).toBe(true);
    second.send.mockClear(); s.isOpen = false;
    engine.render(s, m, conf, [second], false, 100);
    expect(second.send).toHaveBeenCalledTimes(64);
    engine.clear(); expect(second.send).toHaveBeenCalledTimes(64);
  });
  it('initializes and exits device mode, refuses missing SysEx and catches unplug failures', () => {
    const status = vi.fn(), engine = new ControllerLights(status), out = output(), conf = settings();
    conf.profile = 'launchpad-x';
    engine.render(state(), midi(), conf, [out], false, 0);
    expect(out.send).not.toHaveBeenCalled();
    engine.render(state(), midi(), conf, [out], true, 0);
    expect(out.send.mock.calls[0][0]).toEqual(controllerProfiles['launchpad-x'].enter[0]);
    engine.clear(); expect(out.send.mock.calls.at(-1)?.[0]).toEqual(controllerProfiles['launchpad-x'].leave[0]);
    out.send.mockImplementation(() => { throw new Error('unplugged'); });
    expect(() => engine.render(state(), midi(), conf, [out], true, 0)).not.toThrow();
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining('unplugged'));
  });
});
